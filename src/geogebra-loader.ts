/**
 * GeoGebra Loader
 *
 * Comprehensive CSP bypass for GeoGebra in Obsidian:
 * 1. DOM interception: Patches appendChild/insertBefore to catch <script>/<link> creation
 * 2. XHR interception: Patches XMLHttpRequest to proxy GeoGebra API calls
 * 3. Fetch interception: Patches window.fetch for GeoGebra URLs
 * 4. All external requests routed through Obsidian's requestUrl (Node.js HTTP)
 * 5. Scripts executed via eval() (works in Electron context)
 * 6. CSS injected as inline <style> (Obsidian allows unsafe-inline styles)
 */
import { requestUrl } from 'obsidian';

const GGB_HOSTS = ['geogebra.org', 'geogebra.net'];

// Cache fetched content to avoid redundant network requests
const textCache = new Map<string, Promise<string>>();
const binaryCache = new Map<string, Promise<ArrayBuffer>>();

let interceptorInstalled = false;
let origAppendChild: typeof Node.prototype.appendChild;
let origInsertBefore: typeof Node.prototype.insertBefore;
let origXHROpen: typeof XMLHttpRequest.prototype.open;
let origXHRSend: typeof XMLHttpRequest.prototype.send;
let origFetch: typeof window.fetch;
let origScriptSrcDescriptor: PropertyDescriptor | undefined;

// Track which XHR instances need interception
const xhrInterceptMap = new WeakMap<XMLHttpRequest, { url: string; method: string }>();

/**
 * GWT cache/fragment URL pattern:
 * - 32-char hex .cache.js files (permutation scripts)
 * - deferredjs/ paths (code-split fragments)
 * - .cache.html files
 */
const GWT_FRAGMENT_RE = /^(?:.*\/)?[A-F0-9]{32}\.cache\.js$/i;
const GWT_DEFERRED_RE = /deferredjs\//;

function isGeoGebraUrl(url: string): boolean {
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return false;
    return GGB_HOSTS.some(host => url.includes(host));
}

/**
 * Check if a URL is a GeoGebra resource loaded from a wrong origin
 * (e.g. app://obsidian.md/) and resolve it to the correct CDN URL.
 *
 * GeoGebra's GWT code uses relative paths for:
 * - GWT permutation files: 9CB48E...cache.js
 * - Code-split fragments: deferredjs/123/10.cache.js
 * - CSS bundles: css/bundles/bundle.css, css/fonts.css, etc.
 * - JS resources: js/...
 *
 * When loaded via eval(), these resolve to app://obsidian.md/ instead of CDN.
 */
function resolveMisroutedUrl(url: string): string | null {
    if (!ggbVersion) return null;
    // GWT core scripts live under web3d/
    const cdnBase = `https://www.geogebra.org/apps/${ggbVersion}/web3d/`;
    // CSS, JS resources and HTML are one level up (app version root)
    const appBase = `https://www.geogebra.org/apps/${ggbVersion}/`;

    // Already a GeoGebra URL - no correction needed
    if (isGeoGebraUrl(url)) return null;

    // Strip app:// origin to get the relative path
    const relativePath = url.replace(/^app:\/\/[^/]+\//, '');

    // GWT cache files (32-char hex hash + .cache.js)
    const filename = relativePath.split('/').pop() || '';
    if (GWT_FRAGMENT_RE.test(filename)) {
        return cdnBase + filename;
    }

    // GWT deferred JS (code splitting)
    const deferredMatch = relativePath.match(/deferredjs\/.*$/);
    if (deferredMatch) {
        return cdnBase + deferredMatch[0];
    }

    // GeoGebra CSS files live at apps/{version}/css/, NOT web3d/css/
    if (relativePath.startsWith('css/') && relativePath.endsWith('.css')) {
        return appBase + relativePath;
    }

    // GeoGebra font JS files (LaTeX renderer) - live under web3d/fonts/
    // Strip query string for matching but keep the clean path
    const cleanPath = relativePath.replace(/\?.*$/, '');
    if (cleanPath.startsWith('fonts/') && cleanPath.endsWith('.js')) {
        return cdnBase + cleanPath;
    }

    // GeoGebra JS resources (at app version root)
    if (cleanPath.startsWith('js/') && cleanPath.endsWith('.js')) {
        return appBase + cleanPath;
    }

    // GeoGebra HTML resources
    if (cleanPath.endsWith('.html') && !cleanPath.includes('obsidian')) {
        return appBase + cleanPath;
    }

    return null;
}

/**
 * Check if a URL needs interception (GeoGebra CDN or misrouted GWT fragment).
 * Returns the correct CDN URL to fetch, or null if no interception needed.
 */
function getInterceptUrl(url: string): string | null {
    if (isGeoGebraUrl(url)) return url;
    return resolveMisroutedUrl(url);
}

/**
 * Fetch text content via Obsidian's requestUrl (bypasses CSP). Cached.
 */
/** Standard browser headers to avoid 403 from CDN */
const BROWSER_HEADERS: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.geogebra.org/',
    'Origin': 'https://www.geogebra.org',
};

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
 * Fetch binary content via Obsidian's requestUrl (bypasses CSP). Cached.
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

// ─────────────────────────────────────────────
// DOM Interception (appendChild / insertBefore)
// ─────────────────────────────────────────────

async function handleScriptInterception(
    parent: Node,
    child: HTMLScriptElement,
    fetchUrl: string,
    evalContext?: Window,
    refNode?: Node | null
): Promise<void> {
    try {
        const code = await fetchText(fetchUrl);

        // Strategy: Create a Blob URL and let the browser load the script
        // natively. This preserves the correct execution context (critical
        // for GWT's iframe-based .cache.js which needs `parent`, `window`,
        // `document` to resolve in the iframe scope).
        const blob = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const filename = fetchUrl.split('/').pop()?.substring(0, 60) || 'unknown';

        // Swap the src to blob URL
        child.removeAttribute('src');
        child.src = blobUrl;

        // Wrap the existing onload/onerror to add logging and cleanup
        const origOnload = child.onload;
        const origOnerror = child.onerror;
        child.onload = function (ev: Event) {
            URL.revokeObjectURL(blobUrl);
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
            // Blob URL blocked by CSP? Fall back to eval approach.
            try {
                if (evalContext && evalContext !== window) {
                    evalContext.eval(code);
                } else {
                    (0, eval)(code);
                }
                console.log(`[GeoGebra] Executed script via eval fallback: ${filename}`);
            } catch (e2) {
                console.error(`[GeoGebra] Eval fallback also failed: ${filename}`, e2);
            }
            if (origOnerror) {
                try { (origOnerror as Function).call(this, ev); } catch {}
            }
        };

        // Actually append the script to the DOM so it loads naturally
        if (refNode !== undefined && refNode !== null) {
            origInsertBefore.call(parent, child, refNode);
        } else {
            origAppendChild.call(parent, child);
        }
        console.log(`[GeoGebra] Appended script with blob URL: ${filename}`);
    } catch (e) {
        console.error(`[GeoGebra] Failed to handle script: ${fetchUrl}`, e);
        if (child.onerror) { try { (child.onerror as any)(e); } catch {} }
        try { child.dispatchEvent(new Event('error')); } catch {}
    }
}

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
        style.setAttribute('data-geogebra-src', fetchUrl);
        origAppendChild.call(document.head, style);
        console.log(`[GeoGebra] Injected CSS: ${fetchUrl.split('/').pop()?.substring(0, 50)}`);
        if (child.onload) { try { child.onload(new Event('load') as any); } catch {} }
        try { child.dispatchEvent(new Event('load')); } catch {}
    } catch (e) {
        console.error(`[GeoGebra] Failed to load CSS: ${fetchUrl}`, e);
        if (refNode !== undefined) {
            origInsertBefore.call(parent, child, refNode);
        } else {
            origAppendChild.call(parent, child);
        }
    }
}

/**
 * Check if a node is a script element (works across iframe boundaries
 * where instanceof HTMLScriptElement fails).
 */
function isScriptElement(node: Node): node is HTMLScriptElement {
    return node.nodeName === 'SCRIPT';
}

/**
 * Check if a node is a <link> element (any kind - GeoGebra may set rel
 * AFTER appendChild, so we can't rely on rel='stylesheet' at append time).
 */
function isLinkElement(node: Node): node is HTMLLinkElement {
    return node.nodeName === 'LINK';
}

/**
 * Patch a window's Node.prototype to intercept script/link/iframe appending.
 * Called for main window AND for each GWT iframe.
 */
function patchNodePrototype(win: Window, label: string): void {
    const proto = win.Node.prototype;
    const _origAppend = proto.appendChild;
    const _origInsert = proto.insertBefore;

    proto.appendChild = function <T extends Node>(child: T): T {
        if (isScriptElement(child)) {
            const src = child.getAttribute('src') || child.src || '';
            if (src) {
                const interceptUrl = getInterceptUrl(src);
                if (interceptUrl) {
                    console.log(`[GeoGebra][${label}] Intercepting script: ${src.substring(0, 80)} → CDN`);
                    handleScriptInterception(this, child, interceptUrl, win);
                    return child;
                }
            }
        }
        if (isLinkElement(child)) {
            // Try resolved URL first (child.href), then raw attribute
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
        // Detect iframe creation → patch its prototypes too
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
                    handleScriptInterception(this, child, interceptUrl, win, ref);
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

/** Track patched iframes to avoid double-patching */
const patchedIframes = new WeakSet<HTMLIFrameElement>();

/**
 * Patch an iframe's Node.prototype so GWT scripts loaded inside it
 * are also intercepted and routed through the CDN.
 */
function patchIframe(iframe: HTMLIFrameElement): void {
    if (patchedIframes.has(iframe)) return;
    patchedIframes.add(iframe);

    function doPatch() {
        try {
            const iframeWin = iframe.contentWindow;
            if (iframeWin && iframeWin.Node) {
                patchNodePrototype(iframeWin, 'iframe');
                console.log('[GeoGebra] Patched iframe Node.prototype');
            }
        } catch (e) {
            // Cross-origin iframe - can't patch (shouldn't happen for GWT iframes)
        }
    }

    // Patch immediately (blank iframe has contentWindow right away)
    doPatch();
    // Also patch on load in case the document gets replaced
    iframe.addEventListener('load', doPatch);
}

function installDOMInterceptor(): void {
    origAppendChild = Node.prototype.appendChild;
    origInsertBefore = Node.prototype.insertBefore;

    // Patch the main window's Node.prototype
    patchNodePrototype(window, 'main');

    // Intercept HTMLScriptElement.src setter to catch script loading
    // that bypasses appendChild (e.g., GeoGebra's font loader).
    // When src is set to a URL needing interception, we redirect to a blob URL.
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
                    // Fetch the script content and replace with blob URL
                    fetchText(interceptUrl).then(code => {
                        const blob = new Blob([code], { type: 'application/javascript' });
                        const blobUrl = URL.createObjectURL(blob);
                        origSet.call(scriptEl, blobUrl);
                        // Clean up on load
                        scriptEl.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
                        scriptEl.addEventListener('error', () => URL.revokeObjectURL(blobUrl), { once: true });
                    }).catch(e => {
                        console.warn(`[GeoGebra] src interceptor fetch failed: ${value}`, e);
                        origSet.call(scriptEl, value);
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

// ─────────────────────────────────────────────
// XMLHttpRequest Interception
// ─────────────────────────────────────────────

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
            xhrInterceptMap.set(this, { url: interceptUrl, method });
            console.log(`[GeoGebra] XHR intercepted: ${method} ${urlStr.substring(0, 100)}`);
        }
        // Always call original open (needed for non-intercepted requests
        // and to properly initialize the XHR state)
        return origXHROpen.call(this, method, url, async ?? true, username, password);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
        const interceptInfo = xhrInterceptMap.get(this);
        if (interceptInfo) {
            const { url } = interceptInfo;
            // Use requestUrl to proxy the request
            requestUrl({ url, headers: BROWSER_HEADERS }).then(response => {
                // Override response properties
                Object.defineProperty(this, 'readyState', { value: 4, writable: true, configurable: true });
                Object.defineProperty(this, 'status', { value: 200, writable: true, configurable: true });
                Object.defineProperty(this, 'statusText', { value: 'OK', writable: true, configurable: true });
                Object.defineProperty(this, 'responseText', { value: response.text, writable: true, configurable: true });
                Object.defineProperty(this, 'response', { value: response.text, writable: true, configurable: true });
                Object.defineProperty(this, 'responseURL', { value: url, writable: true, configurable: true });
                console.log(`[GeoGebra] XHR proxied OK: ${url.split('/').pop()?.substring(0, 50)}`);

                // Fire events in proper order
                this.dispatchEvent(new Event('readystatechange'));
                this.dispatchEvent(new ProgressEvent('progress'));
                this.dispatchEvent(new Event('load'));
                this.dispatchEvent(new ProgressEvent('loadend'));

                // Also call onreadystatechange / onload directly if set
                if (this.onreadystatechange) {
                    try { this.onreadystatechange(new Event('readystatechange') as any); } catch {}
                }
                if (this.onload) {
                    try { this.onload(new ProgressEvent('load') as any); } catch {}
                }
            }).catch(e => {
                console.error(`[GeoGebra] XHR proxy failed: ${url}`, e);
                Object.defineProperty(this, 'readyState', { value: 4, writable: true, configurable: true });
                Object.defineProperty(this, 'status', { value: 0, writable: true, configurable: true });
                this.dispatchEvent(new ProgressEvent('error'));
                this.dispatchEvent(new ProgressEvent('loadend'));
                if (this.onerror) {
                    try { this.onerror(new ProgressEvent('error') as any); } catch {}
                }
            });
            return; // Don't call original send
        }
        return origXHRSend.call(this, body);
    };

    console.log('[GeoGebra] XHR interceptor installed');
}

// ─────────────────────────────────────────────
// Fetch Interception
// ─────────────────────────────────────────────

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
        return origFetch(input, init);
    };

    console.log('[GeoGebra] Fetch interceptor installed');
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Install ALL interceptors. Must be called before loading GeoGebra.
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
 * Remove all interceptors and restore original methods.
 */
export function removeInterceptor(): void {
    if (!interceptorInstalled) return;
    Node.prototype.appendChild = origAppendChild;
    Node.prototype.insertBefore = origInsertBefore;
    XMLHttpRequest.prototype.open = origXHROpen;
    XMLHttpRequest.prototype.send = origXHRSend;
    window.fetch = origFetch;
    // Restore original script src descriptor
    if (origScriptSrcDescriptor) {
        Object.defineProperty(HTMLScriptElement.prototype, 'src', origScriptSrcDescriptor);
    }
    interceptorInstalled = false;
    console.log('[GeoGebra] All interceptors removed');
}

/** Extracted GeoGebra CDN version (e.g. "5.2.909.9") */
let ggbVersion: string | null = null;

/** Get the extracted GeoGebra version string */
export function getGeoGebraVersion(): string | null {
    return ggbVersion;
}

/**
 * Load the GeoGebra deployment script.
 * After this resolves, window.GGBApplet is available.
 */
export async function loadGeoGebra(): Promise<void> {
    if ((window as any).GGBApplet) {
        console.log('[GeoGebra] GGBApplet already available');
        return;
    }

    installInterceptor();

    const deployUrl = 'https://www.geogebra.org/apps/deployggb.js';

    try {
        const code = await fetchText(deployUrl);

        // Extract version from the hardcoded moduleBase in deployggb.js
        // e.g. "https://www.geogebra.org/apps/5.2.909.9/"
        const versionMatch = code.match(/geogebra\.org\/apps\/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\//);
        if (versionMatch) {
            ggbVersion = versionMatch[1];
            console.log(`[GeoGebra] Detected version: ${ggbVersion}`);
        } else {
            console.warn('[GeoGebra] Could not extract version from deployggb.js');
        }

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
