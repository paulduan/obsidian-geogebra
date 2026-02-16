/**
 * GeoGebra 资源加载器 —— CSP 绕过核心模块
 *
 * Obsidian 基于 Electron 运行，有严格的内容安全策略（CSP），阻止从外部 CDN
 * 加载脚本和样式。GeoGebra 依赖大量从 geogebra.org 动态加载的 JS/CSS 资源，
 * 因此需要多层拦截来绕过 CSP 限制。
 *
 * 拦截策略（共三层）：
 *
 * 1. DOM 拦截 —— Patch appendChild / insertBefore
 *    捕获 GeoGebra 动态创建的 <script> 和 <link> 元素，
 *    将 src/href 替换为 Blob URL 或内联 <style>。
 *
 * 2. XHR 拦截 —— Patch XMLHttpRequest.open / send
 *    捕获 GeoGebra 的 AJAX 请求，通过 Obsidian 的 requestUrl 代理。
 *
 * 3. Fetch 拦截 —— Patch window.fetch
 *    捕获 GeoGebra 使用 fetch API 发起的请求。
 *
 * 所有外部请求最终通过 Obsidian 的 requestUrl() API（底层使用 Node.js HTTP）
 * 完成，不受浏览器 CSP 限制。
 *
 * 额外处理：
 * - Script.src setter 拦截：捕获通过设置 src 属性加载的脚本（如字体加载器）
 * - GWT iframe 补丁：GeoGebra 使用 GWT 框架，在 iframe 中运行代码，
 *   需要递归 patch iframe 的 Node.prototype
 * - URL 修正：将 app://obsidian.md/ 开头的错误路径重定向到 GeoGebra CDN
 */
import { requestUrl } from 'obsidian';

// ─── 常量和缓存 ─────────────────────────────────────────────

/** GeoGebra 相关的 CDN 域名 */
const GGB_HOSTS = ['geogebra.org', 'geogebra.net'];

/** 文本资源缓存（URL → Promise<string>），避免重复网络请求 */
const textCache = new Map<string, Promise<string>>();
/** 二进制资源缓存（URL → Promise<ArrayBuffer>） */
const binaryCache = new Map<string, Promise<ArrayBuffer>>();

// ─── 拦截器状态 ─────────────────────────────────────────────
// 保存原始方法的引用，卸载插件时用于恢复

let interceptorInstalled = false;
/** 原始 Node.prototype.appendChild */
let origAppendChild: typeof Node.prototype.appendChild;
/** 原始 Node.prototype.insertBefore */
let origInsertBefore: typeof Node.prototype.insertBefore;
/** 原始 XMLHttpRequest.prototype.open */
let origXHROpen: typeof XMLHttpRequest.prototype.open;
/** 原始 XMLHttpRequest.prototype.send */
let origXHRSend: typeof XMLHttpRequest.prototype.send;
/** 原始 window.fetch */
let origFetch: typeof window.fetch;
/** 原始 HTMLScriptElement.prototype.src 的属性描述符 */
let origScriptSrcDescriptor: PropertyDescriptor | undefined;

/** WeakMap 追踪需要拦截的 XHR 实例及其目标 URL */
const xhrInterceptMap = new WeakMap<XMLHttpRequest, { url: string; method: string }>();

// ─── URL 识别与修正 ─────────────────────────────────────────

/**
 * GWT 缓存文件的 URL 模式：
 * - 32 位十六进制哈希 + .cache.js（GWT 排列脚本）
 * - deferredjs/ 路径（GWT 代码分割片段）
 */
const GWT_FRAGMENT_RE = /^(?:.*\/)?[A-F0-9]{32}\.cache\.js$/i;
const GWT_DEFERRED_RE = /deferredjs\//;

/** 判断 URL 是否是 GeoGebra CDN 地址 */
function isGeoGebraUrl(url: string): boolean {
    if (!url || url.startsWith('data:')) return false;
    // blob: URL 不算 GeoGebra URL（它们是我们创建的代理 URL）
    if (url.startsWith('blob:')) return false;
    return GGB_HOSTS.some(host => url.includes(host));
}

/**
 * 修正被错误路由到 app://obsidian.md/ 或 blob: URL 的 GeoGebra 资源 URL。
 *
 * 背景：GeoGebra 的 GWT 代码使用相对路径加载资源，但通过 blob URL 或 eval()
 * 执行后，这些相对路径会解析到 app://obsidian.md/ 或 blob:... 而非 GeoGebra CDN。
 *
 * 需要修正的资源类型：
 * - GWT 排列文件：9CB48E...cache.js → CDN/web3d/xxx.cache.js
 * - 代码分割片段：deferredjs/123/10.cache.js → CDN/web3d/deferredjs/...
 * - CSS 文件：css/bundles/bundle.css → CDN/css/...
 * - 字体 JS：fonts/xxx.js → CDN/web3d/fonts/...
 * - JS 资源：js/xxx.js → CDN/web3d/js/...
 * - HTML 资源：xxx.html → CDN/xxx.html
 *
 * @returns 修正后的 CDN URL，如果不需要修正则返回 null
 */
function resolveMisroutedUrl(url: string): string | null {
    if (!ggbVersion) return null;
    // GWT 核心脚本在 web3d/ 目录下
    const cdnBase = `https://www.geogebra.org/apps/${ggbVersion}/web3d/`;
    // CSS、HTML 等资源在版本根目录下
    const appBase = `https://www.geogebra.org/apps/${ggbVersion}/`;

    // 已经是 GeoGebra URL，无需修正
    if (isGeoGebraUrl(url)) return null;

    // 去掉各种非标准前缀，得到相对路径
    // - app://obsidian.md/xxx → xxx
    // - blob:app://obsidian.md/uuid → uuid (filename 提取仍有效)
    // - blob:null/uuid → uuid
    let relativePath = url;
    relativePath = relativePath.replace(/^blob:/, '');          // 去掉 blob: 前缀
    relativePath = relativePath.replace(/^app:\/\/[^/]+\//, ''); // 去掉 app://host/
    relativePath = relativePath.replace(/^null\//, '');          // 去掉 null/ (某些 blob URL)
    relativePath = relativePath.replace(/^https?:\/\/[^/]+\//, ''); // 去掉 http(s)://host/

    // GWT 缓存文件（32 位哈希 + .cache.js）
    const filename = relativePath.split('/').pop() || '';
    if (GWT_FRAGMENT_RE.test(filename)) {
        return cdnBase + filename;
    }

    // GWT 延迟加载 JS（代码分割）
    const deferredMatch = relativePath.match(/deferredjs\/.*$/);
    if (deferredMatch) {
        return cdnBase + deferredMatch[0];
    }

    // CSS 文件位于 apps/{version}/css/，不在 web3d/ 下
    if (relativePath.startsWith('css/') && relativePath.endsWith('.css')) {
        return appBase + relativePath;
    }

    // 字体 JS 文件（LaTeX 渲染器）位于 web3d/fonts/
    const cleanPath = relativePath.replace(/\?.*$/, ''); // 去掉查询参数
    if (cleanPath.startsWith('fonts/') && cleanPath.endsWith('.js')) {
        return cdnBase + cleanPath;
    }

    // JS 资源（canvas-to-svg 等）位于 web3d/js/
    if (cleanPath.startsWith('js/') && cleanPath.endsWith('.js')) {
        return cdnBase + cleanPath;
    }

    // HTML 资源
    if (cleanPath.endsWith('.html') && !cleanPath.includes('obsidian')) {
        return appBase + cleanPath;
    }

    return null;
}

/**
 * 修正 GeoGebra CDN URL 中的子目录错误。
 * 部分 JS 资源应在 web3d/js/ 下，但 URL 可能错误地指向 apps/{version}/js/。
 */
function fixGeoGebraPath(url: string): string {
    if (!ggbVersion) return url;
    const versionPath = `/apps/${ggbVersion}/`;
    const web3dPath = `/apps/${ggbVersion}/web3d/`;
    // 将 apps/{version}/js/ 修正为 apps/{version}/web3d/js/
    if (url.includes(versionPath + 'js/') && !url.includes(web3dPath + 'js/')) {
        const fixed = url.replace(versionPath + 'js/', web3dPath + 'js/');
        console.log(`[GeoGebra] Fixed path: ${url.split('/').pop()} → web3d/js/`);
        return fixed;
    }
    return url;
}

/**
 * 判断 URL 是否需要拦截。
 * @returns 需要拦截时返回修正后的 CDN URL；不需要拦截返回 null
 */
function getInterceptUrl(url: string): string | null {
    if (!url) return null;
    if (isGeoGebraUrl(url)) return fixGeoGebraPath(url);
    // 跳过我们自己创建的 blob URL（避免无限递归拦截）
    // blob URL 格式为 blob:app://obsidian.md/uuid-only（没有路径后缀如 .cache.js）
    // GWT 生成的 misrouted URL 则有具体的文件后缀
    if (url.startsWith('blob:') && !url.includes('.cache.js') && !url.includes('deferredjs')) {
        return null;
    }
    return resolveMisroutedUrl(url);
}

// ─── 网络请求 ────────────────────────────────────────────────

/**
 * 模拟浏览器的 HTTP 请求头。
 * GeoGebra CDN 可能会根据 User-Agent 和 Referer 拒绝非浏览器请求（403），
 * 因此需要伪装成正常的 Chrome 浏览器请求。
 */
const BROWSER_HEADERS: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.geogebra.org/',
    'Origin': 'https://www.geogebra.org',
};

/**
 * 通过 Obsidian 的 requestUrl 获取文本资源（绕过 CSP）。
 * 结果被缓存，相同 URL 不会重复请求。
 */
function fetchText(url: string): Promise<string> {
    if (textCache.has(url)) return textCache.get(url)!;
    const promise = (async () => {
        console.log(`[GeoGebra] Fetching text: ${url.substring(0, 120)}`);
        const response = await requestUrl({ url, headers: BROWSER_HEADERS });
        console.log(`[GeoGebra] OK: ${url.split('/').pop()?.substring(0, 50)} (${response.text.length} bytes)`);
        return response.text;
    })();
    textCache.set(url, promise);
    return promise;
}

/**
 * 通过 Obsidian 的 requestUrl 获取二进制资源（绕过 CSP）。
 * 结果被缓存，相同 URL 不会重复请求。
 */
function fetchBinary(url: string): Promise<ArrayBuffer> {
    if (binaryCache.has(url)) return binaryCache.get(url)!;
    const promise = (async () => {
        console.log(`[GeoGebra] Fetching binary: ${url.substring(0, 120)}`);
        const response = await requestUrl({ url, headers: BROWSER_HEADERS });
        return response.arrayBuffer;
    })();
    binaryCache.set(url, promise);
    return promise;
}

// ─── 第一层拦截：DOM（appendChild / insertBefore） ───────────
// GeoGebra 通过动态创建 <script> 和 <link> 元素加载资源，
// 我们拦截 DOM 操作，将外部 URL 替换为 Blob URL 或内联样式。

/**
 * 处理被拦截的 <script> 元素。
 *
 * 策略：
 * 1. 通过 requestUrl 获取脚本内容
 * 2. 将内容转为 Blob URL
 * 3. 替换 script.src 为 Blob URL
 * 4. 使用原始 appendChild 将 script 插入 DOM，让浏览器自然执行
 *
 * 为什么用 Blob URL 而非 eval()：
 * GWT 的 .cache.js 在 iframe 中运行，需要 parent/window/document 指向
 * iframe 的作用域。Blob URL 方式可以保持正确的执行上下文。
 * 如果 Blob URL 被 CSP 阻止，则回退到 eval()。
 *
 * @param parent       script 元素的父节点
 * @param child        被拦截的 <script> 元素
 * @param fetchUrl     修正后的 CDN URL
 * @param evalContext   eval 的执行上下文（主窗口或 iframe）
 * @param refNode      insertBefore 的参考节点
 * @param nativeAppend 正确 realm 的原始 appendChild（用于跨 iframe 场景）
 * @param nativeInsert 正确 realm 的原始 insertBefore（用于跨 iframe 场景）
 */
async function handleScriptInterception(
    parent: Node,
    child: HTMLScriptElement,
    fetchUrl: string,
    evalContext?: Window,
    refNode?: Node | null,
    nativeAppend?: typeof Node.prototype.appendChild,
    nativeInsert?: typeof Node.prototype.insertBefore
): Promise<void> {
    // 使用传入的 realm 原始方法，回退到主窗口的（兜底）
    const appendFn = nativeAppend || origAppendChild;
    const insertFn = nativeInsert || origInsertBefore;

    try {
        const code = await fetchText(fetchUrl);

        // 创建 Blob URL，让浏览器以原生方式加载脚本
        const blob = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const filename = fetchUrl.split('/').pop()?.substring(0, 60) || 'unknown';

        // 保存原始 URL 到 data 属性（用于诊断和 GWT 脚本搜索回退）
        child.setAttribute('data-ggb-original-src', fetchUrl);

        // 替换 src 为 Blob URL
        child.removeAttribute('src');
        child.src = blobUrl;

        // 包装原始的 onload/onerror 回调，添加日志和清理逻辑
        const origOnload = child.onload;
        const origOnerror = child.onerror;

        child.onload = function (ev: Event) {
            URL.revokeObjectURL(blobUrl); // 释放 Blob URL 内存
            console.log(`[GeoGebra] Script loaded via blob: ${filename}`);
            if (origOnload) {
                try { origOnload.call(this, ev); } catch (e) {
                    console.warn(`[GeoGebra] onload callback error for ${filename}:`, e);
                }
            }
        };

        child.onerror = function (ev: Event | string) {
            URL.revokeObjectURL(blobUrl);
            console.warn(`[GeoGebra] Blob script failed for ${filename}, falling back to eval`);
            // Blob URL 可能被 CSP 阻止，回退到 eval 执行
            try {
                if (evalContext && evalContext !== window) {
                    evalContext.eval(code);  // 在 iframe 上下文中执行
                } else {
                    (0, eval)(code);  // 间接 eval，在全局作用域执行
                }
                console.log(`[GeoGebra] Executed script via eval fallback: ${filename}`);
            } catch (e2) {
                console.error(`[GeoGebra] Eval fallback also failed: ${filename}`, e2);
            }
            if (origOnerror) {
                try { (origOnerror as Function).call(this, ev); } catch {}
            }
        };

        // 使用正确 realm 的原始方法将 script 插入 DOM（触发浏览器加载 Blob URL）
        if (refNode !== undefined && refNode !== null) {
            insertFn.call(parent, child, refNode);
        } else {
            appendFn.call(parent, child);
        }
        console.log(`[GeoGebra] Appended script with blob URL: ${filename}`);
    } catch (e) {
        console.error(`[GeoGebra] Failed to handle script: ${fetchUrl}`, e);
        if (child.onerror) { try { (child.onerror as any)(e); } catch {} }
        try { child.dispatchEvent(new Event('error')); } catch {}
    }
}

/**
 * 处理被拦截的 <link> 元素（CSS 样式表）。
 *
 * 策略：通过 requestUrl 获取 CSS 内容，创建内联 <style> 注入到 <head>。
 * Obsidian 允许 unsafe-inline 样式，所以内联 <style> 不会被 CSP 阻止。
 */
async function handleLinkInterception(
    parent: Node,
    child: HTMLLinkElement,
    fetchUrl: string,
    refNode?: Node | null
): Promise<void> {
    try {
        const cssText = await fetchText(fetchUrl);
        const style = document.createElement('style');
        style.textContent = cssText;
        style.setAttribute('data-geogebra-src', fetchUrl); // 标记来源，便于调试
        origAppendChild.call(document.head, style);
        console.log(`[GeoGebra] Injected CSS: ${fetchUrl.split('/').pop()?.substring(0, 50)}`);
        // 触发 onload 事件，通知 GeoGebra CSS 已加载完成
        if (child.onload) { try { child.onload(new Event('load') as any); } catch {} }
        try { child.dispatchEvent(new Event('load')); } catch {}
    } catch (e) {
        console.error(`[GeoGebra] Failed to load CSS: ${fetchUrl}`, e);
        // 加载失败时放行原始 link 元素（可能在某些环境下仍可加载）
        if (refNode !== undefined) {
            origInsertBefore.call(parent, child, refNode);
        } else {
            origAppendChild.call(parent, child);
        }
    }
}

/**
 * 判断节点是否是 <script> 元素。
 * 使用 nodeName 而非 instanceof，因为跨 iframe 边界时 instanceof 会失败。
 */
function isScriptElement(node: Node): node is HTMLScriptElement {
    return node.nodeName === 'SCRIPT';
}

/**
 * 判断节点是否是 <link> 元素。
 * 不检查 rel='stylesheet'，因为 GeoGebra 可能在 appendChild 之后才设置 rel。
 */
function isLinkElement(node: Node): node is HTMLLinkElement {
    return node.nodeName === 'LINK';
}

/**
 * Patch 指定窗口的 Node.prototype.appendChild 和 insertBefore。
 * 对主窗口和每个 GWT iframe 都需要调用。
 *
 * 拦截逻辑：
 * - <script> 元素：检查 src，如果是 GeoGebra 资源则通过 CDN 代理加载
 * - <link> 元素：检查 href，如果是 GeoGebra CSS 则转为内联 <style>
 * - <iframe> 元素：检测到新 iframe 时自动 patch 其 Node.prototype
 */
function patchNodePrototype(win: Window, label: string): void {
    const proto = win.Node.prototype;
    const _origAppend = proto.appendChild;
    const _origInsert = proto.insertBefore;

    proto.appendChild = function <T extends Node>(child: T): T {
        // 拦截 <script> 元素
        if (isScriptElement(child)) {
            const src = child.getAttribute('src') || child.src || '';
            if (src) {
                const interceptUrl = getInterceptUrl(src);
                if (interceptUrl) {
                    console.log(`[GeoGebra][${label}] Intercepting script: ${src.substring(0, 80)} → CDN`);
                    // 传入本 realm 的原始 append/insert，确保跨 iframe 正常工作
                    handleScriptInterception(this, child, interceptUrl, win, null, _origAppend, _origInsert);
                    return child;
                }
            }
        }
        // 拦截 <link> 元素
        if (isLinkElement(child)) {
            const href = child.href || child.getAttribute('href') || '';
            if (href) {
                const interceptUrl = getInterceptUrl(href);
                if (interceptUrl) {
                    console.log(`[GeoGebra][${label}] Intercepting link: ${href.substring(0, 80)} → CDN`);
                    handleLinkInterception(this, child, interceptUrl);
                    return child;
                }
            }
        }
        // 放行其他元素，检测新 iframe 并自动 patch
        const result = _origAppend.call(this, child) as T;
        if (child.nodeName === 'IFRAME') {
            patchIframe(child as unknown as HTMLIFrameElement);
        }
        return result;
    };

    proto.insertBefore = function <T extends Node>(child: T, ref: Node | null): T {
        if (isScriptElement(child)) {
            const src = child.getAttribute('src') || child.src || '';
            if (src) {
                const interceptUrl = getInterceptUrl(src);
                if (interceptUrl) {
                    console.log(`[GeoGebra][${label}] Intercepting script: ${src.substring(0, 80)} → CDN`);
                    handleScriptInterception(this, child, interceptUrl, win, ref, _origAppend, _origInsert);
                    return child;
                }
            }
        }
        if (isLinkElement(child)) {
            const href = child.href || child.getAttribute('href') || '';
            if (href) {
                const interceptUrl = getInterceptUrl(href);
                if (interceptUrl) {
                    console.log(`[GeoGebra][${label}] Intercepting link: ${href.substring(0, 80)} → CDN`);
                    handleLinkInterception(this, child, interceptUrl, ref);
                    return child;
                }
            }
        }
        const result = _origInsert.call(this, child, ref) as T;
        if (child.nodeName === 'IFRAME') {
            patchIframe(child as unknown as HTMLIFrameElement);
        }
        return result;
    };
}

/** 已 patch 的 iframe 集合，避免重复 patch */
const patchedIframes = new WeakSet<HTMLIFrameElement>();

/**
 * Patch iframe 的 Node.prototype、XMLHttpRequest 和 fetch。
 *
 * GeoGebra 使用 GWT 框架，GWT 会创建 iframe 来执行编译后的 Java 代码。
 * 这些 iframe 内部也会动态创建 <script> 加载资源，以及通过 XHR/fetch
 * 加载 deferred JS 片段（代码分割），全部需要拦截。
 *
 * 每个 iframe 有独立的 JavaScript realm（独立的 Node.prototype、
 * XMLHttpRequest.prototype、window.fetch），必须分别 patch。
 *
 * 分两次 patch：
 * 1. 立即 patch（空白 iframe 创建时 contentWindow 已可用）
 * 2. load 事件后再次 patch（iframe 文档可能被替换）
 */
function patchIframe(iframe: HTMLIFrameElement): void {
    if (patchedIframes.has(iframe)) return;
    patchedIframes.add(iframe);

    /** 已 patch 的 iframe window 集合，避免重复 patch 同一个 window */
    const patchedWins = new WeakSet<Window>();

    function doPatch() {
        try {
            const iframeWin = iframe.contentWindow;
            if (!iframeWin || patchedWins.has(iframeWin)) return;
            patchedWins.add(iframeWin);

            // 1. Patch Node.prototype（拦截 <script> / <link> 的 DOM 注入）
            if (iframeWin.Node) {
                patchNodePrototype(iframeWin, 'iframe');
                console.log('[GeoGebra] Patched iframe Node.prototype');
            }

            // 2. Patch XMLHttpRequest（拦截 GWT deferred JS 片段的 XHR 请求）
            try {
                const iframeXHRProto = iframeWin.XMLHttpRequest?.prototype;
                if (iframeXHRProto && iframeXHRProto.open !== XMLHttpRequest.prototype.open) {
                    const _iframeOrigOpen = iframeXHRProto.open;
                    const _iframeOrigSend = iframeXHRProto.send;

                    iframeXHRProto.open = function (
                        method: string, url: string | URL, async?: boolean,
                        username?: string | null, password?: string | null
                    ): void {
                        const urlStr = url.toString();
                        const interceptUrl = getInterceptUrl(urlStr);
                        if (interceptUrl) {
                            xhrInterceptMap.set(this, { url: interceptUrl, method });
                            console.log(`[GeoGebra][iframe] XHR intercepted: ${method} ${urlStr.substring(0, 100)}`);
                        }
                        return _iframeOrigOpen.call(this, method, url, async ?? true, username, password);
                    };

                    iframeXHRProto.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
                        const interceptInfo = xhrInterceptMap.get(this);
                        if (interceptInfo) {
                            const { url } = interceptInfo;
                            requestUrl({ url, headers: BROWSER_HEADERS }).then(response => {
                                Object.defineProperty(this, 'readyState', { value: 4, writable: true, configurable: true });
                                Object.defineProperty(this, 'status', { value: 200, writable: true, configurable: true });
                                Object.defineProperty(this, 'statusText', { value: 'OK', writable: true, configurable: true });
                                Object.defineProperty(this, 'responseText', { value: response.text, writable: true, configurable: true });
                                Object.defineProperty(this, 'response', { value: response.text, writable: true, configurable: true });
                                Object.defineProperty(this, 'responseURL', { value: url, writable: true, configurable: true });
                                console.log(`[GeoGebra][iframe] XHR proxied OK: ${url.split('/').pop()?.substring(0, 50)}`);
                                this.dispatchEvent(new Event('readystatechange'));
                                this.dispatchEvent(new ProgressEvent('progress'));
                                this.dispatchEvent(new Event('load'));
                                this.dispatchEvent(new ProgressEvent('loadend'));
                                if (this.onreadystatechange) {
                                    try { this.onreadystatechange(new Event('readystatechange') as any); } catch {}
                                }
                                if (this.onload) {
                                    try { this.onload(new ProgressEvent('load') as any); } catch {}
                                }
                            }).catch(e => {
                                console.error(`[GeoGebra][iframe] XHR proxy failed: ${url}`, e);
                                Object.defineProperty(this, 'readyState', { value: 4, writable: true, configurable: true });
                                Object.defineProperty(this, 'status', { value: 0, writable: true, configurable: true });
                                this.dispatchEvent(new ProgressEvent('error'));
                                this.dispatchEvent(new ProgressEvent('loadend'));
                                if (this.onerror) {
                                    try { this.onerror(new ProgressEvent('error') as any); } catch {}
                                }
                            });
                            return;
                        }
                        return _iframeOrigSend.call(this, body);
                    };
                    console.log('[GeoGebra] Patched iframe XMLHttpRequest');
                }
            } catch (e) {
                console.warn('[GeoGebra] Failed to patch iframe XHR:', e);
            }

            // 3. Patch fetch（拦截 GWT 可能通过 fetch 加载的资源）
            try {
                if (iframeWin.fetch && iframeWin.fetch !== window.fetch) {
                    const _iframeOrigFetch = iframeWin.fetch.bind(iframeWin);
                    (iframeWin as any).fetch = async function (
                        input: RequestInfo | URL, init?: RequestInit
                    ): Promise<Response> {
                        const url = input instanceof Request ? input.url : input.toString();
                        const interceptUrl = getInterceptUrl(url);
                        if (interceptUrl) {
                            console.log(`[GeoGebra][iframe] Fetch intercepted: ${url.substring(0, 100)}`);
                            try {
                                const response = await requestUrl({ url: interceptUrl, headers: BROWSER_HEADERS });
                                const contentType = url.endsWith('.css') ? 'text/css'
                                    : url.endsWith('.js') ? 'application/javascript'
                                    : url.endsWith('.json') ? 'application/json'
                                    : 'application/octet-stream';
                                console.log(`[GeoGebra][iframe] Fetch proxied OK: ${url.split('/').pop()?.substring(0, 50)}`);
                                return new Response(response.text, {
                                    status: 200, statusText: 'OK',
                                    headers: new Headers({ 'Content-Type': contentType }),
                                });
                            } catch (e) {
                                console.error(`[GeoGebra][iframe] Fetch proxy failed: ${url}`, e);
                                throw e;
                            }
                        }
                        return _iframeOrigFetch(input, init);
                    };
                    console.log('[GeoGebra] Patched iframe fetch');
                }
            } catch (e) {
                console.warn('[GeoGebra] Failed to patch iframe fetch:', e);
            }
        } catch (e) {
            // 跨域 iframe 无法 patch（GWT iframe 不应是跨域的）
            console.warn('[GeoGebra] Failed to patch iframe:', e);
        }
    }

    doPatch();
    iframe.addEventListener('load', doPatch);
}

/**
 * 安装 DOM 拦截器。
 *
 * 除了 patch appendChild/insertBefore，还拦截 HTMLScriptElement.prototype.src
 * 的 setter。这是因为某些脚本（如 GeoGebra 的字体加载器）通过直接设置 src
 * 属性来加载脚本，绕过了 appendChild。
 */
function installDOMInterceptor(): void {
    // 保存原始方法
    origAppendChild = Node.prototype.appendChild;
    origInsertBefore = Node.prototype.insertBefore;

    // Patch 主窗口
    patchNodePrototype(window, 'main');

    // 拦截 script.src setter
    // 当设置 src 为需要拦截的 URL 时，先获取内容转为 Blob URL 再设置
    origScriptSrcDescriptor = Object.getOwnPropertyDescriptor(
        HTMLScriptElement.prototype, 'src'
    );
    if (origScriptSrcDescriptor && origScriptSrcDescriptor.set) {
        const origSet = origScriptSrcDescriptor.set;
        const origGet = origScriptSrcDescriptor.get;
        Object.defineProperty(HTMLScriptElement.prototype, 'src', {
            get() {
                return origGet ? origGet.call(this) : '';
            },
            set(value: string) {
                const interceptUrl = getInterceptUrl(value);
                if (interceptUrl) {
                    const scriptEl = this as HTMLScriptElement;
                    // 异步获取脚本内容并替换为 Blob URL
                    fetchText(interceptUrl).then(code => {
                        const blob = new Blob([code], { type: 'application/javascript' });
                        const blobUrl = URL.createObjectURL(blob);
                        origSet.call(scriptEl, blobUrl);
                        // 加载完成后释放 Blob URL 内存
                        scriptEl.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
                        scriptEl.addEventListener('error', () => URL.revokeObjectURL(blobUrl), { once: true });
                    }).catch(e => {
                        console.warn(`[GeoGebra] src interceptor fetch failed: ${value}`, e);
                        origSet.call(scriptEl, value); // 失败时使用原始 URL
                    });
                    return;
                }
                origSet.call(this, value);
            },
            configurable: true,
            enumerable: true,
        });
    }

    console.log('[GeoGebra] DOM interceptor installed');
}

// ─── 第二层拦截：XMLHttpRequest ──────────────────────────────
// GeoGebra 使用 XHR 加载数据资源，需要代理到 Obsidian 的 requestUrl。

/**
 * 安装 XHR 拦截器。
 *
 * 工作原理：
 * 1. Patch open() —— 检查 URL 是否需要拦截，记录到 WeakMap
 * 2. Patch send() —— 如果该 XHR 需要拦截，通过 requestUrl 代理请求，
 *    伪造 readyState/status/responseText，触发事件回调
 */
function installXHRInterceptor(): void {
    origXHROpen = XMLHttpRequest.prototype.open;
    origXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null
    ): void {
        const urlStr = url.toString();
        const interceptUrl = getInterceptUrl(urlStr);
        if (interceptUrl) {
            // 标记此 XHR 需要拦截
            xhrInterceptMap.set(this, { url: interceptUrl, method });
            console.log(`[GeoGebra] XHR intercepted: ${method} ${urlStr.substring(0, 100)}`);
        }
        // 始终调用原始 open（初始化 XHR 状态）
        return origXHROpen.call(this, method, url, async ?? true, username, password);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
        const interceptInfo = xhrInterceptMap.get(this);
        if (interceptInfo) {
            const { url } = interceptInfo;
            // 通过 Obsidian requestUrl 代理请求
            requestUrl({ url, headers: BROWSER_HEADERS }).then(response => {
                // 伪造 XHR 响应属性
                Object.defineProperty(this, 'readyState', { value: 4, writable: true, configurable: true });
                Object.defineProperty(this, 'status', { value: 200, writable: true, configurable: true });
                Object.defineProperty(this, 'statusText', { value: 'OK', writable: true, configurable: true });
                Object.defineProperty(this, 'responseText', { value: response.text, writable: true, configurable: true });
                Object.defineProperty(this, 'response', { value: response.text, writable: true, configurable: true });
                Object.defineProperty(this, 'responseURL', { value: url, writable: true, configurable: true });
                console.log(`[GeoGebra] XHR proxied OK: ${url.split('/').pop()?.substring(0, 50)}`);

                // 按正确顺序触发 XHR 事件
                this.dispatchEvent(new Event('readystatechange'));
                this.dispatchEvent(new ProgressEvent('progress'));
                this.dispatchEvent(new Event('load'));
                this.dispatchEvent(new ProgressEvent('loadend'));

                // 也直接调用回调函数（部分库只通过属性设置回调）
                if (this.onreadystatechange) {
                    try { this.onreadystatechange(new Event('readystatechange') as any); } catch {}
                }
                if (this.onload) {
                    try { this.onload(new ProgressEvent('load') as any); } catch {}
                }
            }).catch(e => {
                console.error(`[GeoGebra] XHR proxy failed: ${url}`, e);
                // 伪造错误响应
                Object.defineProperty(this, 'readyState', { value: 4, writable: true, configurable: true });
                Object.defineProperty(this, 'status', { value: 0, writable: true, configurable: true });
                this.dispatchEvent(new ProgressEvent('error'));
                this.dispatchEvent(new ProgressEvent('loadend'));
                if (this.onerror) {
                    try { this.onerror(new ProgressEvent('error') as any); } catch {}
                }
            });
            return; // 不调用原始 send
        }
        // 非拦截请求正常发送
        return origXHRSend.call(this, body);
    };

    console.log('[GeoGebra] XHR interceptor installed');
}

// ─── 第三层拦截：Fetch API ───────────────────────────────────

/**
 * 安装 Fetch 拦截器。
 *
 * 替换 window.fetch，对 GeoGebra 相关 URL 通过 requestUrl 代理，
 * 返回构造的 Response 对象。
 */
function installFetchInterceptor(): void {
    origFetch = window.fetch.bind(window);

    (window as any).fetch = async function (
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> {
        const url = input instanceof Request ? input.url : input.toString();
        const interceptUrl = getInterceptUrl(url);
        if (interceptUrl) {
            console.log(`[GeoGebra] Fetch intercepted: ${url.substring(0, 100)} → ${interceptUrl.substring(0, 100)}`);
            try {
                const response = await requestUrl({ url: interceptUrl, headers: BROWSER_HEADERS });
                // 根据文件扩展名推断 Content-Type
                const contentType = url.endsWith('.css') ? 'text/css'
                    : url.endsWith('.js') ? 'application/javascript'
                    : url.endsWith('.json') ? 'application/json'
                    : url.endsWith('.wasm') ? 'application/wasm'
                    : 'application/octet-stream';

                console.log(`[GeoGebra] Fetch proxied OK: ${url.split('/').pop()?.substring(0, 50)}`);
                return new Response(response.text, {
                    status: 200,
                    statusText: 'OK',
                    headers: new Headers({ 'Content-Type': contentType }),
                });
            } catch (e) {
                console.error(`[GeoGebra] Fetch proxy failed: ${url}`, e);
                throw e;
            }
        }
        // 非拦截请求使用原始 fetch
        return origFetch(input, init);
    };

    console.log('[GeoGebra] Fetch interceptor installed');
}

// ─── 公共 API ────────────────────────────────────────────────

/**
 * 安装所有拦截器（DOM + XHR + Fetch）。
 * 必须在加载 GeoGebra 之前调用。幂等：多次调用只执行一次。
 */
export function installInterceptor(): void {
    if (interceptorInstalled) return;
    interceptorInstalled = true;
    installDOMInterceptor();
    installXHRInterceptor();
    installFetchInterceptor();
    console.log('[GeoGebra] All interceptors active');
}

/**
 * 移除所有拦截器，恢复原始的 DOM/XHR/Fetch 方法。
 * 在插件卸载时调用，确保不影响 Obsidian 的其他功能。
 */
export function removeInterceptor(): void {
    if (!interceptorInstalled) return;
    Node.prototype.appendChild = origAppendChild;
    Node.prototype.insertBefore = origInsertBefore;
    XMLHttpRequest.prototype.open = origXHROpen;
    XMLHttpRequest.prototype.send = origXHRSend;
    window.fetch = origFetch;
    // 恢复 script.src 的原始属性描述符
    if (origScriptSrcDescriptor) {
        Object.defineProperty(HTMLScriptElement.prototype, 'src', origScriptSrcDescriptor);
    }
    interceptorInstalled = false;
    // 重置加载状态，下次插件加载时重新初始化
    loadingPromise = null;
    console.log('[GeoGebra] All interceptors removed');
}

// ─── GeoGebra SDK 加载 ──────────────────────────────────────

/** 从 deployggb.js 中提取的 GeoGebra CDN 版本号（如 "5.2.909.9"） */
let ggbVersion: string | null = null;

/** 获取当前加载的 GeoGebra 版本号 */
export function getGeoGebraVersion(): string | null {
    return ggbVersion;
}

/**
 * 加载 GeoGebra SDK（deployggb.js）。
 * 加载完成后 window.GGBApplet 可用。
 *
 * 特性：
 * - 幂等：如果 GGBApplet 已存在则立即返回
 * - 防并发：多个代码块同时调用时共享同一个加载 Promise
 * - 失败可重试：加载失败后重置状态，下次调用会重新尝试
 */
let loadingPromise: Promise<void> | null = null;

export function loadGeoGebra(): Promise<void> {
    // 已加载完成
    if ((window as any).GGBApplet) {
        return Promise.resolve();
    }
    // 正在加载中，复用同一个 Promise
    if (loadingPromise) return loadingPromise;

    loadingPromise = doLoadGeoGebra().catch(e => {
        // 加载失败，重置状态以允许重试
        loadingPromise = null;
        throw e;
    });
    return loadingPromise;
}

/**
 * 实际执行 GeoGebra SDK 加载的内部函数。
 *
 * 流程：
 * 1. 确保拦截器已安装
 * 2. 通过 requestUrl 获取 deployggb.js 的内容
 * 3. 从代码中提取 GeoGebra 版本号（用于后续资源 URL 的构造）
 * 4. 通过 eval() 执行 deployggb.js，将 GGBApplet 注入到 window
 */
async function doLoadGeoGebra(): Promise<void> {
    installInterceptor(); // 确保拦截器已安装

    const deployUrl = 'https://www.geogebra.org/apps/deployggb.js';

    try {
        const code = await fetchText(deployUrl);

        // 从 deployggb.js 中提取版本号
        // deployggb.js 内含硬编码的 CDN 路径如 "https://www.geogebra.org/apps/5.2.909.9/"
        const versionMatch = code.match(/geogebra\.org\/apps\/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\//);
        if (versionMatch) {
            ggbVersion = versionMatch[1];
            console.log(`[GeoGebra] Detected version: ${ggbVersion}`);
        } else {
            console.warn('[GeoGebra] Could not extract version from deployggb.js');
        }

        // 通过间接 eval 在全局作用域执行 deployggb.js
        console.log(`[GeoGebra] Executing deployggb.js (${code.length} bytes)...`);
        (0, eval)(code);

        const available = !!(window as any).GGBApplet;
        console.log(`[GeoGebra] deployggb.js executed. GGBApplet: ${available}`);

        if (!available) {
            throw new Error('GGBApplet not defined after executing deployggb.js');
        }
    } catch (e) {
        console.error('[GeoGebra] Failed to load deployggb.js:', e);
        throw e;
    }
}
