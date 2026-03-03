/**
 * GeoGebra 渲染器
 *
 * 核心模块，负责：
 * 1. 解析代码块中的参数（@height, @range 等）和 GeoGebra 命令
 * 2. 创建 GeoGebra applet 实例并注入到 DOM
 * 3. 执行 GeoGebra 命令（evalCommand）和 API 调用（SetColor 等）
 * 4. 调整视图（坐标系范围、缩放、居中）
 * 5. 生成 PNG 快照并缓存（用于 PDF 导出）
 * 6. 提供重置功能（恢复到初始状态）
 */
import { loadGeoGebra, getGeoGebraVersion } from './geogebra-loader';
import { RenderMode } from './types';
import { renderMath, finishRenderMath, loadMathJax } from 'obsidian';

/** GGBApplet 由 deployggb.js 动态注入到 window 上，这里声明类型 */
declare const GGBApplet: any;

// ─── 内存缓存（用于 PDF 导出） ────────────────────────────────
// PDF 导出时 Obsidian 在分离的 DOM 中重新渲染 markdown，不等待 GeoGebra 加载。
// 内存缓存在首次渲染后保存 PNG 快照，PDF 导出时直接使用。
// 同步 Map，零延迟，不可能失败。重启 Obsidian 后需重新打开笔记生成缓存。

/** PNG 快照缓存：key → HTML img 标签（含 base64 数据） */
const memoryCache = new Map<string, string>();

// ─── 磁盘缓存（持久化，重启后可恢复） ─────────────────────────
let vaultAdapter: { read: (p: string) => Promise<string>; write: (p: string, d: string) => Promise<void>; exists: (p: string) => Promise<boolean>; mkdir: (p: string) => Promise<void>; list: (p: string) => Promise<{ files: string[]; folders: string[] }> } | null = null;
let cacheDirPath = '';

/**
 * 设置缓存目录。存储 vault adapter 引用，供磁盘读写使用。
 */
export function setCacheDir(vault: any, dir: string): void {
    vaultAdapter = vault?.adapter ?? null;
    cacheDirPath = dir || '';
}

/**
 * 启动时从磁盘预加载所有缓存条目到内存。
 * 必须在代码块处理器注册前调用，确保 PDF 导出能命中缓存。
 */
export async function preloadDiskCache(): Promise<void> {
    if (!vaultAdapter || !cacheDirPath) return;
    try {
        if (!(await vaultAdapter.exists(cacheDirPath))) return;
        const listing = await vaultAdapter.list(cacheDirPath);
        const files: string[] = listing?.files ?? [];
        let loaded = 0;
        for (const filePath of files) {
            if (!filePath.endsWith('.html')) continue;
            const segments = filePath.split('/');
            const key = segments[segments.length - 1].replace('.html', '');
            if (memoryCache.has(key)) continue;
            try {
                const content = await vaultAdapter.read(filePath);
                if (content && content.length > 100) {
                    memoryCache.set(key, content);
                    loaded++;
                }
            } catch { /* ignore individual file errors */ }
        }
        console.log(`[GeoGebra] Preloaded ${loaded} cache entries from disk (total: ${memoryCache.size})`);
    } catch (e) {
        console.warn('[GeoGebra] Failed to preload disk cache:', e);
    }
}

async function writeCacheToDisk(key: string, value: string): Promise<void> {
    if (!vaultAdapter || !cacheDirPath) return;
    try {
        if (!(await vaultAdapter.exists(cacheDirPath))) {
            await vaultAdapter.mkdir(cacheDirPath);
        }
        await vaultAdapter.write(`${cacheDirPath}/${key}.html`, value);
    } catch (e) {
        console.warn(`[GeoGebra] Disk cache write failed for ${key}:`, e);
    }
}

async function cacheGetFromDisk(key: string): Promise<string | null> {
    if (!vaultAdapter || !cacheDirPath) return null;
    try {
        const filePath = `${cacheDirPath}/${key}.html`;
        if (await vaultAdapter.exists(filePath)) {
            const content = await vaultAdapter.read(filePath);
            if (content && content.length > 100) {
                memoryCache.set(key, content);
                console.log(`[GeoGebra] Disk cache HIT ${key} (${(content.length / 1024).toFixed(0)}KB)`);
                return content;
            }
        }
    } catch (e) {
        console.warn(`[GeoGebra] Disk cache read failed for ${key}:`, e);
    }
    return null;
}

/**
 * 根据渲染模式和源码内容生成缓存键。
 * 使用简单哈希算法（DJB2 变体），将模式+源码映射为唯一字符串。
 */
function makeCacheKey(mode: RenderMode, source: string): string {
    let hash = 0;
    const str = mode + ':' + source.trim();
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return 'ggb_' + Math.abs(hash).toString(36);
}

/** 从内存缓存读取 */
function cacheGet(key: string): string | null {
    const val = memoryCache.get(key) ?? null;
    if (val) {
        console.log(`[GeoGebra] Cache HIT ${key} (${(val.length / 1024).toFixed(0)}KB)`);
    } else {
        console.log(`[GeoGebra] Cache MISS ${key} (total entries: ${memoryCache.size})`);
    }
    return val;
}

/** 写入内存缓存并异步持久化到磁盘 */
function cacheSet(key: string, value: string): void {
    memoryCache.set(key, value);
    console.log(`[GeoGebra] Cache SET ${key} (${(value.length / 1024).toFixed(0)}KB, total: ${memoryCache.size})`);
    writeCacheToDisk(key, value);
}

// ─── GeoGebra 引擎配置 ──────────────────────────────────────

/**
 * 渲染模式 → GeoGebra 应用名称的映射。
 *
 * - classic:  完整版 GeoGebra，支持所有几何命令（Segment, Locus, Slider 等）
 * - 3d:       专用 3D 计算器，自带 3D 视图
 * - graphing: 函数绘图计算器，仅支持函数定义，不支持几何命令
 *
 * 注意：如果需要 Segment/Locus/Point(path) 等几何命令，必须使用 classic 而非 graphing。
 */
const APP_NAMES: Record<RenderMode, string> = {
    [RenderMode.Geometry2D]: 'classic',
    [RenderMode.Geometry3D]: '3d',      // 使用原生 3d 应用，滑块可直接显示在画布上
    [RenderMode.Graph]: 'classic',   // 使用 classic 以支持 perspective 隐藏代数面板
};

/**
 * 各模式的默认视图布局（perspective）。
 * 字符含义：A=代数面板, G=平面图形, T=3D视图, S=电子表格
 */
const DEFAULT_PERSPECTIVES: Record<RenderMode, string> = {
    [RenderMode.Geometry2D]: 'G',   // 仅平面图形（隐藏代数面板）
    [RenderMode.Geometry3D]: 'T',   // 仅 3D 视图（隐藏代数面板）
    [RenderMode.Graph]: 'G',       // 仅平面图形（隐藏代数面板）
};

/** 各模式的默认画布高度（像素） */
const DEFAULT_HEIGHTS: Record<RenderMode, number> = {
    [RenderMode.Geometry2D]: 500,
    [RenderMode.Geometry3D]: 750,
    [RenderMode.Graph]: 500,
};

/** 全局 applet 计数器，用于生成唯一 DOM ID */
let appletCounter = 0;

/**
 * 等待浏览器下一帧渲染完成。
 * 用于确保 DOM 元素已完成布局，可以正确测量宽高。
 */
function waitForLayout(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

// ─── 参数解析 ────────────────────────────────────────────────

/**
 * 代码块参数接口。
 * 用户通过 @key value 语法在代码块开头设置参数。
 */
export interface AppletParams {
    /** 画布宽度（像素），默认自适应容器宽度 */
    width?: number;
    /** 画布高度（像素） */
    height?: number;
    /** 视图布局字符串，如 'AG'（代数+图形）、'G'（仅图形）、'AT'（代数+3D） */
    perspective?: string;
    /** 是否显示工具栏 */
    toolbar?: boolean;
    /** 是否显示网格 */
    grid?: boolean;
    /** 是否显示坐标轴 */
    axes?: boolean;
    /** 是否显示虚拟键盘和代数输入框 */
    keyboard?: boolean;
    /** 坐标系精确范围：[xMin, xMax, yMin, yMax]，优先级高于 center/zoom */
    range?: [number, number, number, number];
    /** 视图中心点坐标：2D 为 [x, y]，3D 为 [x, y, z] */
    center?: number[];
    /** 缩放级别：从中心到各边界的可见单位数，配合 @center 使用 */
    zoom?: number;
    /** 整体缩放比例（CSS transform），如 0.6 表示缩小到 60% */
    scale?: number;
}

/**
 * 解析代码块源码，提取参数和命令。
 *
 * 源码格式：
 *   @height 600       ← 参数行（@key value）
 *   @grid true        ← 参数行
 *   # 这是注释       ← 注释行（# 或 // 开头），被忽略
 *   A = (1, 3)        ← GeoGebra 命令
 *   B = (3, 4)        ← GeoGebra 命令
 *
 * @returns params: 解析后的参数对象；commands: GeoGebra 命令数组
 */
function parseSource(source: string): { params: AppletParams; commands: string[] } {
    const params: AppletParams = {};
    const commands: string[] = [];

    for (const raw of source.split('\n')) {
        const line = raw.trim();
        // 跳过空行和注释行
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;

        // 匹配 @key value 格式的参数行
        const paramMatch = line.match(/^@(\w+)\s+(.+)$/);
        if (paramMatch) {
            const key = paramMatch[1].toLowerCase();
            const val = paramMatch[2].trim();
            switch (key) {
                case 'width':
                    params.width = parseInt(val);
                    break;
                case 'height':
                    params.height = parseInt(val);
                    break;
                case 'perspective':
                    params.perspective = val;
                    break;
                case 'toolbar':
                    params.toolbar = val.toLowerCase() === 'true' || val === '1';
                    break;
                case 'grid':
                    params.grid = val.toLowerCase() === 'true' || val === '1';
                    break;
                case 'axes':
                    params.axes = val.toLowerCase() === 'true' || val === '1';
                    break;
                case 'keyboard':
                    params.keyboard = val.toLowerCase() === 'true' || val === '1';
                    break;
                case 'center': {
                    // @center x,y 或 @center x,y,z（3D 模式）
                    const parts = val.split(/[,\s]+/).map(Number);
                    if (parts.length >= 2 && parts.every(n => !isNaN(n))) {
                        params.center = parts.slice(0, parts.length >= 3 ? 3 : 2);
                    }
                    break;
                }
                case 'zoom':
                    params.zoom = parseFloat(val);
                    break;
                case 'scale':
                    params.scale = parseFloat(val);
                    break;
                case 'range': {
                    // @range xMin,xMax,yMin,yMax（逗号或空格分隔）
                    const r = val.split(/[,\s]+/).map(Number);
                    if (r.length >= 4 && r.every(n => !isNaN(n))) {
                        params.range = [r[0], r[1], r[2], r[3]];
                    }
                    break;
                }
            }
            continue;
        }

        // 非参数行视为 GeoGebra 命令
        commands.push(line);
    }

    return { params, commands };
}

// ─── 渲染主流程 ──────────────────────────────────────────────

/** applet 加载完成后的回调接口 */
export interface AppletCallbacks {
    /** 当 applet 初始状态保存完毕时调用，传入重置函数 */
    onResetReady?: (resetFn: () => void) => void;
}

/**
 * 渲染 GeoGebra 代码块的主函数。
 *
 * 完整流程：
 * 1. 创建 DOM 结构（导出容器 + applet 容器 + 加载提示）
 * 2. 尝试从缓存加载 PNG（用于 PDF 导出的快速显示）
 * 3. 加载 GeoGebra JS SDK（deployggb.js）
 * 4. 测量容器尺寸，计算缩放参数
 * 5. 创建 GGBApplet 实例并注入 DOM
 * 6. applet 就绪后：执行命令 → 调整视图 → 保存初始状态 → 生成 PNG 快照
 * 7. 注册交互监听器，用户操作后自动更新 PNG 快照
 *
 * @param container  目标 DOM 容器
 * @param source     代码块原始文本
 * @param mode       渲染模式（2d / 3d / graph）
 * @param callbacks  回调函数（重置按钮就绪等）
 */
export async function renderGeoGebra(
    container: HTMLElement,
    source: string,
    mode: RenderMode,
    callbacks?: AppletCallbacks
): Promise<void> {
    const { onResetReady } = callbacks || {};
    const ck = makeCacheKey(mode, source);

    // ── 步骤 1：创建 DOM 结构 ──

    // 导出容器：用于存放 PDF 导出的静态 PNG 图片。
    // 屏幕上默认隐藏（display: none），仅在 @media print 和缓存回退时显示。
    const exportDiv = container.createDiv({ cls: 'ggb-export-container' });

    // ── 步骤 2：检查缓存 ──
    // PDF 导出时 Obsidian 会重新渲染 markdown 但不等 GeoGebra 加载完成，
    // 此时缓存的 PNG 图片可以立即显示在导出容器中。
    let hasCachedContent = false;
    console.log(`[GeoGebra] Block ${ck}: checking cache (isConnected=${container.isConnected}, source=${source.trim().substring(0, 40)}...)`);
    const cached = cacheGet(ck) || await cacheGetFromDisk(ck);
    if (cached) {
        exportDiv.innerHTML = cached;
        exportDiv.classList.add('ggb-export-active'); // 激活导出容器显示
        hasCachedContent = true;
        console.log(`[GeoGebra] Block ${ck}: cache loaded (${(cached.length / 1024).toFixed(0)}KB), exportDiv children: ${exportDiv.children.length}`);
    } else {
        console.log(`[GeoGebra] Block ${ck}: NO cache found`);
    }

    // 生成唯一 applet ID（时间戳 + 计数器）
    const appletId = `ggb-applet-${Date.now()}-${++appletCounter}`;
    // applet 容器：GeoGebra 将在此 div 内渲染交互式图形
    // 注意：不要修改 appletDiv 的 class，scaleContainerClass 依赖 'ggb-applet-container'
    const appletDiv = container.createDiv({ cls: 'ggb-applet-container' });
    appletDiv.id = appletId;
    // 3D 模式标记加到外层 container 上，用于 CSS 限定 transform-origin 规则
    if (mode === RenderMode.Geometry3D) {
        container.classList.add('ggb-3d');
    }

    // 加载提示：如果有缓存内容则隐藏（避免 PDF 导出时显示 "Loading..."）
    const loadingEl = container.createDiv({ cls: 'ggb-loading' });
    loadingEl.setText('Loading GeoGebra...');
    if (hasCachedContent) {
        loadingEl.style.display = 'none';
    }

    // 解析用户参数和 GeoGebra 命令
    const { params: userParams, commands } = parseSource(source);
    console.log(`[GeoGebra] Rendering ${mode} applet (${APP_NAMES[mode]}) with ${commands.length} commands, params:`, userParams);

    // ── 步骤 2.5：检测 PDF 导出上下文 ──
    // PDF 导出时 Obsidian 在分离的 DOM 中渲染 markdown，元素永远不会出现在
    // document 中。此时 GGBApplet.inject() 无法工作（依赖 getElementById）。
    // 检测方法：container.isConnected 为 false 表示不在 document DOM 树中。
    if (!container.isConnected) {
        await new Promise(r => setTimeout(r, 50));
    }
    if (!container.isConnected) {
        // 如果内存没有缓存，可能是并行的 live 渲染正在生成 PNG。
        // 轮询等待最多 ~20s（10 次 × 2s），给 live 渲染足够时间完成 PNG 捕获。
        if (!hasCachedContent) {
            console.log(`[GeoGebra] ★ PDF export: no cache for ${ck}, waiting for live rendering...`);
            for (let retry = 0; retry < 10; retry++) {
                await new Promise(r => setTimeout(r, 2000));
                const retryCache = cacheGet(ck) || await cacheGetFromDisk(ck);
                if (retryCache) {
                    exportDiv.innerHTML = retryCache;
                    exportDiv.classList.add('ggb-export-active');
                    hasCachedContent = true;
                    console.log(`[GeoGebra] ★ PDF export: cache appeared for ${ck} after ${(retry + 1) * 2}s wait`);
                    break;
                }
            }
        }

        console.log(`[GeoGebra] ★ PDF Export path for ${ck}: hasCachedContent=${hasCachedContent}, exportDiv.children=${exportDiv.children.length}, exportDiv.innerHTML.length=${exportDiv.innerHTML.length}`);
        if (hasCachedContent) {
            console.log(`[GeoGebra] ★ Detached DOM (PDF export): using cached content for ${ck} (${(exportDiv.innerHTML.length / 1024).toFixed(0)}KB)`);
            appletDiv.style.display = 'none';
            loadingEl.remove();
            container.classList.add('ggb-cache-only');
            exportDiv.style.display = 'block';
            return;
        } else {
            console.warn(`[GeoGebra] ★ Detached DOM (PDF export): NO CACHE for ${ck}, block will be empty!`);
            console.warn(`[GeoGebra] ★ Memory cache keys: [${Array.from(memoryCache.keys()).join(', ')}]`);
            appletDiv.style.display = 'none';
            loadingEl.remove();
            container.createDiv({
                cls: 'geogebra-error',
                text: 'GeoGebra: no cached image available for PDF export. View the note first to generate cache.',
            });
            return;
        }
    }

    // ── 步骤 3：错误捕获 ──
    // 监听 GeoGebra 初始化过程中的未捕获错误（来自 web3d、geogebra 脚本）
    const errorCapture: string[] = [];
    const errorHandler = (event: ErrorEvent) => {
        if (event.filename?.includes('web3d') || event.filename?.includes('geogebra') || event.filename?.includes('VM')) {
            errorCapture.push(`${event.message} at ${event.filename}:${event.lineno}`);
            console.error(`[GeoGebra] Caught error: ${event.message}`, event);
        }
    };
    window.addEventListener('error', errorHandler);

    try {
        // ── 步骤 4：加载 GeoGebra SDK ──
        await loadGeoGebra();

        if (typeof GGBApplet === 'undefined') {
            throw new Error('GGBApplet not available after loading');
        }

        loadingEl.setText('Initializing applet...');

        // 等待两帧以确保 DOM 布局完成，能正确测量容器宽度
        await waitForLayout();
        await waitForLayout();

        // ── 步骤 5：计算尺寸和缩放 ──

        // 测量容器实际宽度：从 appletDiv 开始向上遍历 DOM 树，
        // 找到第一个有实际宽度的元素。新创建的 div 可能还没有布局宽度，
        // 需要回退到父元素（Obsidian 的内容区域通常有明确宽度）。
        let measuredWidth = 0;
        let measureEl: HTMLElement | null = appletDiv;
        while (measureEl && measuredWidth < 100) {
            measuredWidth = measureEl.clientWidth || measureEl.offsetWidth || 0;
            measureEl = measureEl.parentElement;
        }
        if (measuredWidth < 100) measuredWidth = 800; // 最终兜底
        const scale = userParams.scale || 1;

        // GeoGebra 内部按 width/height 参数布局，然后通过 scaleContainerClass 缩放到容器宽度。
        // 3D 模式需要足够的内部宽度（≥1400px）才能让代数面板和 3D 视图并排显示。
        const width = userParams.width || Math.max(measuredWidth, mode === RenderMode.Geometry3D ? 1400 : 0);
        const height = userParams.height || DEFAULT_HEIGHTS[mode];

        // GeoGebra scaleContainerClass 产生的缩放比（内部宽度 > 容器时自动缩放）
        const ggbScale = (width > measuredWidth && measuredWidth > 0) ? measuredWidth / width : 1;
        // GeoGebra 缩放后的视觉高度
        const ggbVisualHeight = Math.round(height * ggbScale);
        // @scale 应用后的最终视觉尺寸（用于 PNG 导出、容器限制等）
        const visualWidth = Math.round(measuredWidth * scale);
        const visualHeight = Math.round(ggbVisualHeight * scale);

        /**
         * applet 加载后统一修正布局和应用 @scale 缩放。
         *
         * 问题背景：
         * 当 GeoGebra 的 scaleContainerClass 生效时（如 3D 模式内部宽度 1400px
         * 缩放到容器的 ~800px），CSS transform 不影响 DOM 布局，导致：
         * - DOM 高度仍为原始高度（750px），但视觉高度变小（~428px），产生底部间距
         * - 如果 transform-origin 不是 top left，内容还会偏移
         *
         * 修复策略：
         * 1. CSS 规则强制 transform-origin: top left（在 styles.css 中）
         * 2. 用 clip-path: inset() 只裁底部间距，绝不裁顶部（避免内容被遮挡）
         * 3. 用 negative margin-bottom 收缩布局空间（消除间距）
         * 4. 在此基础上叠加用户的 @scale
         *
         * 关键区别：不使用 overflow: hidden（会同时裁掉四个方向），
         * 而用 clip-path: inset(0 0 GAP 0) 只裁底部。
         */
        const applyAllSizing = () => {
            if (ggbScale < 1) {
                // ═══ 路径 A：3D 模式（GeoGebra 有内部缩放）═══
                // scaleContainerClass 把 1400px 缩放到 ~800px，CSS transform 不影响布局，
                // 导致 DOM 高度（750px）和视觉高度（~428px）不一致 → 底部间距。
                // 用 clip-path 只裁底部，不裁顶部。
                setTimeout(() => {
                    const domH = appletDiv.scrollHeight || appletDiv.offsetHeight;

                    // 测量 GeoGebra 内部 frame 的实际视觉高度
                    let visualH = ggbVisualHeight;
                    try {
                        for (const el of appletDiv.querySelectorAll('*')) {
                            const cs = window.getComputedStyle(el);
                            if (cs.transform && cs.transform !== 'none') {
                                const rect = (el as HTMLElement).getBoundingClientRect();
                                if (rect.height > 10) {
                                    visualH = Math.ceil(rect.height);
                                }
                                break;
                            }
                        }
                    } catch { /* 忽略 */ }

                    // clip-path 只裁底部间距，不裁顶部
                    const bottomGap = Math.max(0, domH - visualH - 5);
                    if (bottomGap > 0) {
                        appletDiv.style.clipPath = `inset(0px 0px ${bottomGap}px 0px)`;
                        appletDiv.style.marginBottom = `-${bottomGap}px`;
                    }

                    // 叠加 @scale
                    if (scale !== 1) {
                        appletDiv.style.transformOrigin = 'top left';
                        appletDiv.style.transform = `scale(${scale})`;
                        container.style.width = `${Math.round(measuredWidth * scale)}px`;
                        container.style.height = `${Math.round(visualH * scale)}px`;
                        container.style.overflow = 'hidden';
                    }

                    console.log(`[GeoGebra] 3D layout: domH=${domH}, visualH=${visualH}, gap=${bottomGap}, @scale=${scale}`);
                }, 600);

            } else if (scale !== 1) {
                // ═══ 路径 B：2D/Graph 模式 + @scale ═══
                // 无内部缩放，只需应用 CSS transform。
                // 不使用 overflow:hidden（会裁掉顶部溢出的内容），
                // 改用 negative margin 收缩底部间距。
                setTimeout(() => {
                    const actualH = appletDiv.scrollHeight || appletDiv.offsetHeight;
                    appletDiv.style.transformOrigin = 'top left';
                    appletDiv.style.transform = `scale(${scale})`;

                    // transform 不影响布局，appletDiv 仍占原始高度的空间。
                    // 用 negative margin 把多余的空间收回（视觉高度 = actualH * scale）。
                    const scaledH = Math.round(actualH * scale);
                    const gap = actualH - scaledH;
                    if (gap > 0) {
                        appletDiv.style.marginBottom = `-${gap}px`;
                    }

                    container.style.width = `${Math.round(measuredWidth * scale)}px`;
                    // 不设置 container.style.overflow = 'hidden'，避免裁掉顶部内容
                    console.log(`[GeoGebra] @scale ${scale}: actualH=${actualH}px, scaledH=${scaledH}px, gap=${gap}px`);
                }, 800); // 800ms 确保 GeoGebra 完全渲染后再测量
            }
            // 路径 C：2D/Graph 无 @scale → 不做任何调整
        };

        console.log(`[GeoGebra] Size: render ${width}x${height}, scale ${scale}, visual ${visualWidth}x${visualHeight}`);

        // ── 步骤 6：创建 applet 并等待加载 ──

        // 注入 GWT meta 标签，让 web3d.nocache.js 能直接找到 CDN baseUrl。
        // 背景：我们的 CSP 绕过把 script.src 替换为 blob URL，导致 GWT 搜索
        // <script src="...web3d.nocache.js"> 失败。通过 meta 标签提前告知 baseUrl，
        // GWT 优先读取 meta 而不搜索 script 标签。
        const ver = getGeoGebraVersion();
        let metaTag: HTMLMetaElement | null = null;
        if (ver) {
            metaTag = document.createElement('meta');
            metaTag.setAttribute('name', 'gwt:property');
            metaTag.setAttribute('content', `baseUrl=https://www.geogebra.org/apps/${ver}/web3d/`);
            document.head.appendChild(metaTag);
            console.log(`[GeoGebra] Injected GWT baseUrl meta tag (v${ver})`);
        }

        await new Promise<void>((resolve, reject) => {
            // 防止 appletOnLoad 和轮询回退重复触发初始化逻辑
            let callbackFired = false;
            // 轮询定时器：当 appletOnLoad 回调未触发时，通过检测 window 全局 API 来补救
            let pollTimer: ReturnType<typeof setInterval> | null = null;

            // 有缓存时超时更短（15s），因为缓存已经可以用于 PDF 导出
            // 无缓存时给 90s 等待 CDN 加载（.cache.js 约 7.7MB）
            const timeoutMs = hasCachedContent ? 15000 : 90000;
            const timeout = setTimeout(() => {
                if (pollTimer) clearInterval(pollTimer);
                window.removeEventListener('error', errorHandler);
                if (metaTag && metaTag.parentNode) metaTag.parentNode.removeChild(metaTag);
                if (hasCachedContent) {
                    // 有缓存 → 静默放弃实时 applet，使用缓存的 PNG
                    console.log(`[GeoGebra] Live applet timed out but cache available, using cached content`);
                    appletDiv.innerHTML = '';
                    appletDiv.style.display = 'none';
                    loadingEl.remove();
                    container.classList.add('ggb-cache-only');
                    container.style.height = '';
                    container.style.overflow = '';
                    resolve();
                } else {
                    // 无缓存 → 报错
                    const errMsg = errorCapture.length > 0
                        ? `GeoGebra errors:\n${errorCapture.join('\n')}`
                        : `GeoGebra applet initialization timed out (${timeoutMs / 1000}s). Check console for details.`;
                    reject(new Error(errMsg));
                }
            }, timeoutMs);

            // 确定视图布局：用户指定 > 自动检测 > 默认隐藏面板
            // 字符含义：A=代数面板, G=2D图形, T=3D视图
            // 注意：3D 模式使用 '3d' 应用，perspective 构造参数无效，
            //       面板隐藏在 appletOnLoad 中通过 api.setPerspective('T') 实现。
            let perspective = userParams.perspective || DEFAULT_PERSPECTIVES[mode];
            if (!userParams.perspective && mode !== RenderMode.Geometry3D) {
                if (userParams.keyboard === true) {
                    // @keyboard true → 显示代数面板
                    perspective = 'A' + perspective;
                }
                // 2D/Graph 模式下 perspective='G' 已包含 Graphics View，滑块自动可见
            }
            const showToolBar = userParams.toolbar ?? false;

            // GGBApplet 构造参数
            // 完整参数文档：https://wiki.geogebra.org/en/Reference:GeoGebra_App_Parameters
            const params: Record<string, any> = {
                id: appletId,
                appName: APP_NAMES[mode],        // 应用类型：classic / 3d / graphing
                width,
                height,
                perspective,                     // 视图布局
                scaleContainerClass: 'ggb-applet-container',
                showAlgebraInput: perspective.includes('A'),      // 有代数面板时开启输入框
                showKeyboardOnFocus: userParams.keyboard ?? false, // 聚焦时弹出虚拟键盘
                algebraInputPosition: 'algebra',
                showToolBar,
                showToolBarHelp: false,
                showMenuBar: false,
                showResetIcon: false,
                enableLabelDrags: true,          // 允许拖拽标签
                enableShiftDragZoom: true,       // 允许 Shift+拖拽缩放
                enableRightClick: true,          // 允许右键菜单
                enableCAS: false,                // 禁用 CAS（计算机代数系统）
                enableAnimation: true,           // 启用动画功能
                allowStyleBar: false,
                errorDialogsActive: false,       // 禁用错误弹窗
                useBrowserForJS: false,
                preventFocus: true,              // 防止自动获取焦点

                // ── applet 加载完成回调 ──
                // GeoGebra SDK 在 applet 完全初始化后调用此函数。
                // 也可能由下方的轮询回退机制手动调用（当 SDK 回调未触发时）。
                appletOnLoad: (api: any) => {
                    if (callbackFired) return; // 已由回调或轮询处理，防止重复执行
                    callbackFired = true;
                    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
                    clearTimeout(timeout);
                    window.removeEventListener('error', errorHandler);
                    if (metaTag && metaTag.parentNode) metaTag.parentNode.removeChild(metaTag);
                    console.log(`[GeoGebra] Applet ${appletId} ready, executing ${commands.length} commands...`);
                    loadingEl.remove();

                    // 实时 applet 已加载 → 隐藏缓存导出容器，显示 applet
                    exportDiv.classList.remove('ggb-export-active');
                    appletDiv.style.display = '';
                    applyAllSizing();

                    // 3D 模式（'3d' 应用）：初始化后通过 API 隐藏代数面板
                    // '3d' 应用不支持构造参数 perspective，需要加载后调用 setPerspective
                    if (mode === RenderMode.Geometry3D && userParams.keyboard !== true) {
                        try { api.setPerspective('T'); } catch { /* 忽略 */ }
                    }

                    // 应用网格/坐标轴设置
                    // 注意：setPerspective('T') 会重置坐标轴状态，
                    // 所以坐标轴设置必须在 setPerspective 之后执行。
                    // 如果用户未显式设置 @axes，3D 模式默认显示坐标轴。
                    if (userParams.axes !== undefined) {
                        api.setAxesVisible(userParams.axes, userParams.axes);
                        if (mode === RenderMode.Geometry3D) {
                            try { api.setAxesVisible(userParams.axes, userParams.axes, userParams.axes); } catch { /* 忽略 */ }
                        }
                    } else if (mode === RenderMode.Geometry3D) {
                        // setPerspective('T') 可能隐藏坐标轴，默认恢复显示
                        try {
                            api.setAxesVisible(true, true, true);
                        } catch {
                            api.setAxesVisible(true, true);
                        }
                    }
                    if (userParams.grid !== undefined) {
                        api.setGridVisible(userParams.grid);
                    }

                    // 执行所有 GeoGebra 命令
                    executeCommands(api, commands);

                    // ── 自定义滑块覆盖层 ──
                    // 3D 模式隐藏代数面板后，GeoGebra 滑块不可见。
                    // 检测 Slider() 命令，在画布底部叠加 HTML 滑块控件，
                    // 通过 api.setValue() 实时同步 GeoGebra 变量。
                    if (mode === RenderMode.Geometry3D && userParams.keyboard !== true) {
                        createSliderOverlay(api, commands, container);
                    }

                    // ── 自动标记函数交点 ──
                    // 2D/Graph 模式下，自动计算所有函数对的交点并标记为可点击的红色点
                    if (mode !== RenderMode.Geometry3D) {
                        addIntersectionPoints(api);
                    }

                    // 函数控制面板在 debouncedRefresh 定义之后创建（见下方）

                    // 3D 模式下默认线条较粗，自动调细（除非用户已通过 SetLineThickness 自定义）
                    if (mode === RenderMode.Geometry3D) {
                        try {
                            // 收集用户已手动设置线粗的对象名
                            const userThicknessNames = new Set(
                                commands
                                    .filter(c => /^SetLineThickness\s*\(/i.test(c))
                                    .map(c => c.match(/\(\s*(\w+)/)?.[1])
                                    .filter(Boolean)
                            );
                            const allNames = api.getAllObjectNames() || [];
                            for (const name of allNames) {
                                if (userThicknessNames.has(name)) continue; // 用户已自定义，跳过
                                const objType = api.getObjectType(name);
                                // 对线条类对象（线、线段、射线、圆、圆锥曲线、曲面边等）设置细线
                                if (['line', 'segment', 'ray', 'vector', 'conic', 'polygon',
                                     'polyline', 'locus', 'implicit', 'curve'].includes(objType)) {
                                    api.setLineThickness(name, 2);
                                }
                            }
                            console.log(`[GeoGebra] 3D line thickness reduced to 2`);
                        } catch { /* 忽略 */ }
                    }

                    // ── 视图调整 ──
                    // 命令执行完毕后调整坐标系，3D 模式需要更长的延迟等待视图初始化
                    const viewDelay = mode === RenderMode.Geometry3D ? 800 : 300;

                    /**
                     * 应用 3D 视图坐标系设置。
                     * 同时使用 evalCommand 和 JS API 两种方式，增加兼容性。
                     */
                    const apply3DView = (api: any, cx: number, cy: number, cz: number, z: number) => {
                        api.evalCommand('SetActiveView(2)');  // 2 = 3D 视图
                        // 坐标系范围：center ± zoom，但始终扩展到包含原点，
                        // 否则坐标轴（经过原点）会落在可视范围外。
                        const xMin = Math.min(cx - z, 0);
                        const xMax = Math.max(cx + z, 0);
                        const yMin = Math.min(cy - z, 0);
                        const yMax = Math.max(cy + z, 0);
                        const zMin = Math.min(cz - z, 0);
                        const zMax = Math.max(cz + z, 0);
                        const cmd = `SetCoordSystem(${xMin}, ${xMax}, ${yMin}, ${yMax}, ${zMin}, ${zMax})`;
                        api.evalCommand(cmd);
                        console.log(`[GeoGebra] 3D SetCoordSystem: ${cmd}`);
                        try {
                            api.setCoordSystem(xMin, xMax, yMin, yMax, zMin, zMax);
                        } catch (_) { /* 忽略 */ }
                        // SetCoordSystem 会重置坐标轴，需重新设置
                        if (userParams.axes !== false) {
                            try { api.setAxesVisible(true, true, true); } catch {
                                try { api.setAxesVisible(true, true); } catch { /* 忽略 */ }
                            }
                        }
                    };

                    setTimeout(() => {
                        try {
                            if (mode === RenderMode.Geometry3D) {
                                // ── 3D 视图调整 ──
                                if (userParams.center || userParams.zoom) {
                                    // 使用 @center 和 @zoom 设置 3D 视图范围
                                    const cx = userParams.center?.[0] ?? 0;
                                    const cy = userParams.center?.[1] ?? 0;
                                    const cz = userParams.center?.[2] ?? 0;
                                    const z = userParams.zoom || 15;
                                    apply3DView(api, cx, cy, cz, z);
                                    // 3D 视图初始化较慢，1 秒后重试确保生效
                                    setTimeout(() => {
                                        try { apply3DView(api, cx, cy, cz, z); } catch (_) {}
                                    }, 1000);
                                } else if (userParams.range) {
                                    // 使用 @range 精确设置 3D 坐标范围
                                    api.evalCommand('SetActiveView(2)');
                                    const [x0, x1, y0, y1] = userParams.range;
                                    // z 轴范围取 x 轴范围的值
                                    api.evalCommand(`SetCoordSystem(${x0}, ${x1}, ${y0}, ${y1}, ${x0}, ${x1})`);
                                    console.log(`[GeoGebra] 3D range set from @range`);
                                } else {
                                    // 无参数时自动适配所有对象：
                                    // ZoomToFit() 在 3D 模式下效果不佳，改为手动计算所有对象的
                                    // 3D 包围盒，然后用 SetCoordSystem 设置合适的坐标系范围。
                                    api.evalCommand('SetActiveView(2)');
                                    const autoFit3D = () => {
                                        try {
                                            const names = api.getAllObjectNames() || [];
                                            let mnX = Infinity, mxX = -Infinity;
                                            let mnY = Infinity, mxY = -Infinity;
                                            let mnZ = Infinity, mxZ = -Infinity;
                                            let found = false;

                                            // 只收集几何对象（点、线段端点等）的坐标，
                                            // 排除 slider/numeric/angle/boolean/function/text 等
                                            // 非几何对象——它们的 getXcoord 返回值不是空间坐标，
                                            // 会把包围盒撑得很大。
                                            const skipTypes = new Set([
                                                'numeric', 'angle', 'boolean', 'function',
                                                'text', 'list', 'image',
                                            ]);

                                            for (const nm of names) {
                                                try {
                                                    const objType = api.getObjectType(nm);
                                                    if (skipTypes.has(objType)) continue;
                                                    // 跳过不可见对象
                                                    try { if (!api.getVisible(nm)) continue; } catch { /* 默认包含 */ }

                                                    // 方法1：对点对象直接获取坐标
                                                    if (objType === 'point' || objType === 'point3d') {
                                                        const px = api.getXcoord(nm);
                                                        const py = api.getYcoord(nm);
                                                        if (typeof px === 'number' && !isNaN(px) &&
                                                            typeof py === 'number' && !isNaN(py)) {
                                                            mnX = Math.min(mnX, px); mxX = Math.max(mxX, px);
                                                            mnY = Math.min(mnY, py); mxY = Math.max(mxY, py);
                                                            found = true;
                                                        }
                                                    }

                                                    // 方法2：解析值字符串中的 3D 坐标 "(x, y, z)"
                                                    // 适用于 point3d 以及内嵌坐标的其他对象
                                                    const vs = api.getValueString(nm) || '';
                                                    const coordRegex = /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;
                                                    let m3;
                                                    while ((m3 = coordRegex.exec(vs)) !== null) {
                                                        const xv = parseFloat(m3[1]);
                                                        const yv = parseFloat(m3[2]);
                                                        const zv = parseFloat(m3[3]);
                                                        if (!isNaN(xv)) { mnX = Math.min(mnX, xv); mxX = Math.max(mxX, xv); }
                                                        if (!isNaN(yv)) { mnY = Math.min(mnY, yv); mxY = Math.max(mxY, yv); }
                                                        if (!isNaN(zv)) { mnZ = Math.min(mnZ, zv); mxZ = Math.max(mxZ, zv); }
                                                        found = true;
                                                    }
                                                } catch { /* 忽略单个对象的错误 */ }
                                            }

                                            if (found) {
                                                // z 轴如果没有 3D 坐标数据，默认 ±5
                                                if (mnZ === Infinity) { mnZ = -5; mxZ = 5; }

                                                // 每个轴独立计算范围和 padding（25%，最小 1 单位）
                                                const axisPad = (min: number, max: number) => {
                                                    const range = max - min || 5;
                                                    const p = Math.max(range * 0.25, 1);
                                                    return [min - p, max + p] as [number, number];
                                                };
                                                const [x0, x1] = axisPad(mnX, mxX);
                                                const [y0, y1] = axisPad(mnY, mxY);
                                                const [z0, z1] = axisPad(mnZ, mxZ);

                                                api.evalCommand('SetActiveView(2)');
                                                const cmd = `SetCoordSystem(${x0}, ${x1}, ${y0}, ${y1}, ${z0}, ${z1})`;
                                                api.evalCommand(cmd);
                                                console.log(`[GeoGebra] 3D auto-fit: x=[${x0.toFixed(1)},${x1.toFixed(1)}] y=[${y0.toFixed(1)},${y1.toFixed(1)}] z=[${z0.toFixed(1)},${z1.toFixed(1)}]`);
                                                try { api.setCoordSystem(x0, x1, y0, y1, z0, z1); } catch {}
                                            } else {
                                                // 无法获取坐标，使用较宽的默认范围
                                                apply3DView(api, 0, 0, 0, 15);
                                            }
                                        } catch {
                                            try {
                                                api.evalCommand('SelectAll()');
                                                api.evalCommand('ZoomToFit()');
                                                api.evalCommand('SelectAll()');
                                            } catch { /* 忽略 */ }
                                        }
                                    };
                                    autoFit3D();
                                    // 3D 视图初始化较慢，1 秒后重试确保生效
                                    setTimeout(autoFit3D, 1000);
                                }
                            } else if (userParams.range) {
                                // ── 2D 精确坐标范围 ──
                                const [xMin, xMax, yMin, yMax] = userParams.range;
                                api.setCoordSystem(xMin, xMax, yMin, yMax);
                                console.log(`[GeoGebra] 2D range: [${xMin}, ${xMax}, ${yMin}, ${yMax}]`);
                            } else if (userParams.center || userParams.zoom) {
                                // ── 2D 中心点 + 缩放（等比 1:1） ──
                                // @center 和 @zoom 可以单独使用或组合使用：
                                //   @center x,y @zoom r → 以 (x,y) 为中心，y 半径 r
                                //   @center x,y         → 以 (x,y) 为中心，自动计算半径
                                //   @zoom r             → 自动计算中心，使用半径 r
                                // x 范围根据容器宽高比自动扩展，保证坐标比例 1:1。
                                let cx = 0, cy = 0;
                                if (userParams.center) {
                                    [cx, cy] = userParams.center;
                                }
                                let z = userParams.zoom || 0;

                                // 如果没有指定 @center，从包围盒中心自动计算
                                if (!userParams.center) {
                                    try {
                                        const bbox = calcVisibleBBox2D(api);
                                        if (bbox) {
                                            cx = (bbox.mnX + bbox.mxX) / 2;
                                            cy = (bbox.mnY + bbox.mxY) / 2;
                                        }
                                    } catch { /* 使用默认 (0,0) */ }
                                }

                                // zoom 必须为正数（y 轴半径）。如果 ≤ 0 或未设置，
                                // 从包围盒自动计算：取中心到最远角的距离 + 20% padding。
                                if (z <= 0) {
                                    try {
                                        const bbox = calcVisibleBBox2D(api);
                                        if (bbox) {
                                            const hx = Math.max(Math.abs(bbox.mxX - cx), Math.abs(bbox.mnX - cx));
                                            const hy = Math.max(Math.abs(bbox.mxY - cy), Math.abs(bbox.mnY - cy));
                                            z = Math.max(hx, hy) * 1.25 + 0.3;
                                        } else {
                                            z = 5;
                                        }
                                    } catch { z = 5; }
                                    console.log(`[GeoGebra] 2D auto-zoom from bbox: z=${z.toFixed(1)}`);
                                }

                                // 根据容器宽高比扩展 x 范围，保证像素级 1:1 坐标比例
                                const ar = width / height;
                                const xr = z * ar;
                                api.setCoordSystem(cx - xr, cx + xr, cy - z, cy + z);
                                console.log(`[GeoGebra] 2D center=(${cx},${cy}) zoom=${z.toFixed(1)} ar=${ar.toFixed(2)} xRange=${(2*xr).toFixed(1)} yRange=${(2*z).toFixed(1)}`);
                            } else {
                                // ── 2D 自动适配（等比 1:1）──
                                // 混合策略：
                                //   1. 先让 GeoGebra ZoomToFit 计算所有对象（含 Locus/Curve）的边界
                                //   2. 读取 ZoomToFit 后的坐标系范围
                                //   3. 与我们自己扫描的 Text/Point 包围盒取并集
                                //   4. 加 padding + 宽高比修正，保证 1:1 且圆不变形
                                try {
                                    // 步骤 1：让 GeoGebra 计算全部对象的边界
                                    try {
                                        api.evalCommand('SelectAll()');
                                        api.evalCommand('ZoomToFit()');
                                        api.evalCommand('SelectAll()');
                                    } catch { /* 忽略 */ }

                                    // 步骤 2：读取 ZoomToFit 后的坐标系
                                    let mnX = -5, mxX = 5, mnY = -5, mxY = 5;
                                    try {
                                        const gxMin = api.getXmin();
                                        const gxMax = api.getXmax();
                                        const gyMin = api.getYmin();
                                        const gyMax = api.getYmax();
                                        if (typeof gxMin === 'number' && !isNaN(gxMin)) mnX = gxMin;
                                        if (typeof gxMax === 'number' && !isNaN(gxMax)) mxX = gxMax;
                                        if (typeof gyMin === 'number' && !isNaN(gyMin)) mnY = gyMin;
                                        if (typeof gyMax === 'number' && !isNaN(gyMax)) mxY = gyMax;
                                    } catch { /* 使用默认值 */ }
                                    console.log(`[GeoGebra] ZoomToFit bounds: x=[${mnX.toFixed(2)},${mxX.toFixed(2)}] y=[${mnY.toFixed(2)},${mxY.toFixed(2)}]`);

                                    // 步骤 3：与 Text/Point 扫描结果取并集
                                    const bbox = calcVisibleBBox2D(api);
                                    if (bbox) {
                                        mnX = Math.min(mnX, bbox.mnX);
                                        mxX = Math.max(mxX, bbox.mxX);
                                        mnY = Math.min(mnY, bbox.mnY);
                                        mxY = Math.max(mxY, bbox.mxY);
                                    }

                                    // 步骤 4：从合并后的包围盒计算等比坐标系
                                    const cx = (mnX + mxX) / 2;
                                    const cy = (mnY + mxY) / 2;
                                    const hx = (mxX - mnX) / 2;
                                    const hy = (mxY - mnY) / 2;
                                    const ar = width / height;

                                    // 加 10% padding（ZoomToFit 已经有些余量）
                                    const ryFromContent = hy * 1.1 + 0.2;
                                    const rxFromContent = hx * 1.1 + 0.2;
                                    const ry = Math.max(ryFromContent, rxFromContent / ar);
                                    const rx = ry * ar;

                                    api.setCoordSystem(cx - rx, cx + rx, cy - ry, cy + ry);
                                    console.log(`[GeoGebra] 2D auto-fit: center=(${cx.toFixed(2)},${cy.toFixed(2)}) rx=${rx.toFixed(2)} ry=${ry.toFixed(2)} ar=${ar.toFixed(2)} merged=[${mnX.toFixed(2)},${mxX.toFixed(2)},${mnY.toFixed(2)},${mxY.toFixed(2)}]`);
                                } catch {
                                    try {
                                        api.evalCommand('SelectAll()');
                                        api.evalCommand('ZoomToFit()');
                                        api.evalCommand('SelectAll()');
                                    } catch { /* 忽略 */ }
                                }
                            }
                            console.log(`[GeoGebra] View adjustment applied`);
                        } catch (e) {
                            console.warn('[GeoGebra] View adjustment failed:', e);
                        }
                    }, viewDelay);

                    // ── 保存初始状态（用于重置按钮） ──
                    // 3D 模式有视图调整重试（1s后），需要更长延迟等待完成
                    const saveDelay = mode === RenderMode.Geometry3D ? 2500 : 800;
                    setTimeout(() => {
                        try {
                            // 通过 getBase64() 保存完整的 applet 状态（XML + 构造数据）
                            const savedState = api.getBase64();
                            console.log(`[GeoGebra] Initial state saved (${savedState.length} chars)`);
                            if (onResetReady) {
                                // 通知 main.ts 重置函数已就绪，启用重置按钮
                                onResetReady(() => {
                                    console.log(`[GeoGebra] Restoring initial state...`);
                                    api.setBase64(savedState); // 恢复到保存的状态
                                });
                            }
                        } catch (e) {
                            console.warn('[GeoGebra] Could not save initial state:', e);
                        }
                    }, saveDelay);

                    // ── 生成 PDF 导出用的 PNG 快照 ──

                    /** 将当前导出容器的内容写入缓存 */
                    const saveExportToCache = () => {
                        if (exportDiv.innerHTML.length > 100) {
                            cacheSet(ck, exportDiv.innerHTML);
                        }
                    };

                    /** 生成 <img> 标签，内嵌 base64 PNG，附带缩放后的视觉宽度 */
                    const mkImg = (b64: string) =>
                        `<img src="data:image/png;base64,${b64}" class="ggb-export-img" style="width:${visualWidth}px;max-width:100%;height:auto;" alt="GeoGebra ${mode}">`;

                    /**
                     * 截取当前 applet 的 PNG/SVG 快照并注入到导出容器中。
                     * 按优先级尝试多种方式：getPNGBase64 → exportSVG → getScreenshotBase64。
                     *
                     * @param label 调试标签，标识这是第几次尝试
                     */
                    const injectPNGFallback = (label: string) => {
                        // 方案 1：同步 PNG 导出（2x 缩放，144 DPI）
                        try {
                            const b64 = api.getPNGBase64(2, false, 144);
                            if (b64 && b64.length > 100) {
                                exportDiv.innerHTML = mkImg(b64);
                                saveExportToCache();
                                console.log(`[GeoGebra] PNG cached [${label}] (${(b64.length / 1024).toFixed(0)}KB, visual ${visualWidth}px)`);
                                return;
                            }
                            console.log(`[GeoGebra] PNG empty [${label}]: getPNGBase64 returned ${b64?.length || 0} chars`);
                        } catch (e) {
                            console.log(`[GeoGebra] PNG failed [${label}]: getPNGBase64 error:`, e);
                        }

                        // 方案 2：SVG 导出（对 Locus、曲线等矢量图形更可靠）
                        try {
                            api.exportSVG((svgStr: string) => {
                                if (svgStr && svgStr.length > 100) {
                                    const svgB64 = btoa(unescape(encodeURIComponent(svgStr)));
                                    const imgTag = `<img src="data:image/svg+xml;base64,${svgB64}" class="ggb-export-img" style="width:${visualWidth}px;max-width:100%;height:auto;" alt="GeoGebra ${mode}">`;
                                    exportDiv.innerHTML = imgTag;
                                    saveExportToCache();
                                    console.log(`[GeoGebra] SVG cached [${label}] (${(svgStr.length / 1024).toFixed(0)}KB)`);
                                    return;
                                }
                                console.log(`[GeoGebra] SVG empty [${label}]: ${svgStr?.length || 0} chars`);
                            });
                        } catch (e) {
                            console.log(`[GeoGebra] SVG failed [${label}]:`, e);
                        }

                        // 方案 3：异步截图回退
                        try {
                            api.getScreenshotBase64((b64: string) => {
                                if (b64 && b64.length > 100) {
                                    exportDiv.innerHTML = mkImg(b64);
                                    saveExportToCache();
                                    console.log(`[GeoGebra] Screenshot cached [${label}] (${(b64.length / 1024).toFixed(0)}KB)`);
                                } else {
                                    console.log(`[GeoGebra] Screenshot empty [${label}]: ${b64?.length || 0} chars`);
                                }
                            });
                        } catch (e) {
                            console.log(`[GeoGebra] Screenshot failed [${label}]:`, e);
                        }
                    };

                    // 多轮 PNG 快照捕获（递增延迟），确保 Locus 等计算密集型构造完成渲染。
                    // 每次成功都会覆盖前一次的缓存，最终缓存的是渲染最完整的版本。
                    const pngDelays = [
                        saveDelay + 1000,   // ~1.8s: 快速首次捕获
                        saveDelay + 4000,   // ~4.8s: 标准延迟
                        saveDelay + 8000,   // ~8.8s: 复杂构造（Locus、大量交点等）
                        saveDelay + 15000,  // ~15.8s: 超重构造最终兜底
                    ];
                    for (let i = 0; i < pngDelays.length; i++) {
                        setTimeout(() => injectPNGFallback(`attempt ${i + 1}/${pngDelays.length}`), pngDelays[i]);
                    }

                    // ── 交互监听：用户操作后自动更新 PNG 快照 ──

                    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
                    /** 防抖刷新：600ms 内多次触发只执行一次 */
                    const debouncedRefresh = () => {
                        if (refreshTimer) clearTimeout(refreshTimer);
                        refreshTimer = setTimeout(() => injectPNGFallback('interaction'), 600);
                    };

                    try {
                        // 监听对象变化（拖拽点、调整滑块等）
                        api.registerUpdateListener(debouncedRefresh);
                    } catch { /* 忽略 */ }
                    try {
                        // 监听视图变化（平移、缩放、旋转等）
                        // 过滤掉高频事件以避免性能问题
                        api.registerClientListener((evt: any) => {
                            const t = evt?.type || evt;
                            if (typeof t !== 'string') return;
                            // 跳过高频鼠标事件和样式更新事件
                            if (/^(mouseDown|updateStyle|editorStart|editorKeyTyped|showStyleBar)$/i.test(t)) return;
                            debouncedRefresh();
                        });
                    } catch { /* 忽略 */ }

                    // ── 函数控制面板 ──
                    // 在图形容器左上角显示浮动面板，列出所有函数/曲线对象，
                    // 点击可切换显示/隐藏；切换后触发 PNG 快照刷新以保证 PDF 导出一致。
                    createFunctionPanel(api, container, debouncedRefresh);

                    resolve();
                },
            };

            // 创建 GGBApplet 实例并注入 DOM
            try {
                console.log(`[GeoGebra] Creating GGBApplet(appName="${APP_NAMES[mode]}", ${width}x${height})...`);
                const applet = new GGBApplet(params, true); // true = HTML5 only

                // 设置 GeoGebra CDN codebase（确保资源从正确版本加载）
                if (ver) {
                    const codebase = `https://www.geogebra.org/apps/${ver}/web3d/`;
                    console.log(`[GeoGebra] Setting codebase: ${codebase}`);
                    applet.setHTML5Codebase(codebase);
                }

                // 临时 patch document.getElementById 确保 GGBApplet.inject() 能找到元素。
                // GGBApplet 内部通过 getElementById(id) 查找目标容器，但在 Obsidian
                // 的虚拟滚动或延迟挂载场景下，getElementById 可能找不到我们创建的元素。
                const origGetElementById = document.getElementById.bind(document);
                const patchedGetById = function (id: string): HTMLElement | null {
                    if (id === appletId) return appletDiv;
                    return origGetElementById(id);
                };
                document.getElementById = patchedGetById as typeof document.getElementById;

                // 注入到 DOM，GeoGebra 将异步加载并最终触发 appletOnLoad 回调
                console.log(`[GeoGebra] Injecting into #${appletId}...`);
                applet.inject(appletId);
                console.log(`[GeoGebra] inject() called, waiting for appletOnLoad callback...`);

                // 恢复原始 getElementById（延迟恢复，inject 内部可能异步调用）
                setTimeout(() => {
                    if (document.getElementById === patchedGetById) {
                        document.getElementById = origGetElementById;
                    }
                }, 2000);

                // ── 轮询回退：检测 GeoGebra API 可用性 ──
                // GeoGebra 通过 Blob URL 加载脚本时，GWT 内部的 appletOnLoad 回调链
                // 可能断裂（执行上下文变化），导致回调永远不触发。
                // 但 GeoGebra 仍会将 API 注册为 window[appletId]。
                // 每 2 秒检查一次，发现 API 可用后手动触发初始化逻辑。
                pollTimer = setInterval(() => {
                    if (callbackFired) {
                        clearInterval(pollTimer!);
                        pollTimer = null;
                        return;
                    }
                    const api = (window as any)[appletId];
                    if (api && typeof api.evalCommand === 'function') {
                        console.log(`[GeoGebra] API detected via polling for ${appletId}, triggering manual init`);
                        clearInterval(pollTimer!);
                        pollTimer = null;
                        params.appletOnLoad(api);
                    }
                }, 2000);
            } catch (e) {
                if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
                clearTimeout(timeout);
                window.removeEventListener('error', errorHandler);
                if (metaTag && metaTag.parentNode) metaTag.parentNode.removeChild(metaTag);
                reject(e);
            }
        });

    } catch (e) {
        // ── 渲染失败处理 ──
        window.removeEventListener('error', errorHandler);
        loadingEl.remove();
        console.error('[GeoGebra] Render failed:', e);

        if (exportDiv.innerHTML.length > 100) {
            // 有缓存 → 降级显示缓存的 PNG（常见于 PDF 导出场景）
            console.log(`[GeoGebra] Render failed but cache available — showing cached content`);
            appletDiv.style.display = 'none';
            exportDiv.classList.add('ggb-export-active');
            container.classList.add('ggb-cache-only');
            container.style.height = '';
            container.style.overflow = '';
        } else {
            // 无缓存 → 显示错误信息
            const msg = (e as Error).message || String(e);
            container.createDiv({
                cls: 'geogebra-error',
                text: `Failed to render GeoGebra: ${msg}`,
            });
        }
    }
}

// ─── API 命令处理器 ──────────────────────────────────────────
// 部分命令需要通过 GeoGebra JS API 直接调用（而非 evalCommand），
// 例如 SetAnimating、SetColor 等。这里为每个支持的 API 命令定义处理器。

/**
 * API 命令 → 处理函数的映射表。
 * 命令格式：CommandName(arg1, arg2, ...)
 * 如果代码块中的命令匹配到此表中的命令名，则使用对应的 JS API 而非 evalCommand。
 */
const API_COMMAND_HANDLERS: Record<string, (api: any, args: string[]) => void> = {
    /** 设置对象动画状态 */
    'SetAnimating': (api, args) => {
        const name = args[0]?.trim();
        const anim = args[1]?.trim().toLowerCase() !== 'false';
        if (name) api.setAnimating(name, anim);
    },
    /** 开始全局动画 */
    'StartAnimation': (api) => { api.startAnimation(); },
    /** 停止全局动画 */
    'StopAnimation': (api) => { api.stopAnimation(); },
    /** 设置动画速度 */
    'SetAnimationSpeed': (api, args) => {
        const name = args[0]?.trim();
        const speed = parseFloat(args[1]?.trim());
        if (name && !isNaN(speed)) api.setAnimationSpeed(name, speed);
    },
    /** 设置对象颜色（支持 RGB 数字或颜色名称） */
    'SetColor': (api, args) => {
        const name = args[0]?.trim();
        if (!name) return;
        // 常用颜色名 → RGB 映射
        const COLOR_MAP: Record<string, [number, number, number]> = {
            'red': [255, 0, 0], 'green': [0, 128, 0], 'blue': [0, 0, 255],
            'yellow': [255, 255, 0], 'orange': [255, 165, 0], 'purple': [128, 0, 128],
            'cyan': [0, 255, 255], 'magenta': [255, 0, 255], 'black': [0, 0, 0],
            'white': [255, 255, 255], 'gray': [128, 128, 128], 'grey': [128, 128, 128],
            'pink': [255, 192, 203], 'brown': [139, 69, 19], 'darkred': [139, 0, 0],
            'darkblue': [0, 0, 139], 'darkgreen': [0, 100, 0], 'lightblue': [173, 216, 230],
            'lightgreen': [144, 238, 144], 'gold': [255, 215, 0], 'maroon': [128, 0, 0],
        };
        const colorName = args[1]?.trim().replace(/^["']|["']$/g, '').toLowerCase();
        const mapped = COLOR_MAP[colorName];
        if (mapped) {
            api.setColor(name, mapped[0], mapped[1], mapped[2]);
        } else {
            // 尝试解析为 RGB 数字
            const r = parseInt(args[1]?.trim()), g = parseInt(args[2]?.trim()), b = parseInt(args[3]?.trim());
            if (!isNaN(r) && !isNaN(g) && !isNaN(b)) api.setColor(name, r, g, b);
        }
    },
    /** 设置对象可见性 */
    'SetVisible': (api, args) => {
        const name = args[0]?.trim();
        const vis = args[1]?.trim().toLowerCase() !== 'false';
        if (name) api.setVisible(name, vis);
    },
    /** 固定/解锁对象（固定后不可拖拽） */
    'SetFixed': (api, args) => {
        const name = args[0]?.trim();
        const fixed = args[1]?.trim().toLowerCase() !== 'false';
        if (name) api.setFixed(name, fixed);
    },
    /** 设置线条粗细 */
    'SetLineThickness': (api, args) => {
        const name = args[0]?.trim();
        const t = parseInt(args[1]?.trim());
        if (name && !isNaN(t)) api.setLineThickness(name, t);
    },
    /** 设置点的大小 */
    'SetPointSize': (api, args) => {
        const name = args[0]?.trim();
        const s = parseInt(args[1]?.trim());
        if (name && !isNaN(s)) api.setPointSize(name, s);
    },
    /** 设置对象标题文字 */
    'SetCaption': (api, args) => {
        const name = args[0]?.trim();
        // 标题可能包含逗号，所以将除第一个参数外的所有部分重新拼接
        const caption = args.slice(1).join(',').trim().replace(/^["']|["']$/g, '');
        if (name) api.setCaption(name, caption);
    },
    // 注意：GeoGebra 没有 SetTextSize API。文本字号/颜色请在 Text() 中使用 LaTeX：
    // Text("\textcolor{red}{\Large 内容 = " + var + "}", (x, y), true, true)
    // LaTeX 字号：\tiny, \small, \normalsize, \large, \Large, \LARGE, \huge, \Huge
    /** 设置填充透明度（0~1） */
    'SetFilling': (api, args) => {
        const name = args[0]?.trim();
        const fill = parseFloat(args[1]?.trim());
        if (name && !isNaN(fill)) api.setFilling(name, fill);
    },
    /** 显示/隐藏对象标签 */
    'SetLabelVisible': (api, args) => {
        const name = args[0]?.trim();
        const vis = args[1]?.trim().toLowerCase() !== 'false';
        if (name) api.setLabelVisible(name, vis);
    },
};

/**
 * 尝试将命令作为 API 调用执行。
 * 如果命令匹配 API_COMMAND_HANDLERS 中的命令名，则通过 JS API 调用。
 *
 * @returns true 如果命令被识别并执行；false 如果不是 API 命令
 */
function tryApiCommand(api: any, cmd: string): boolean {
    // 匹配 CommandName(args) 格式
    const match = cmd.match(/^(\w+)\s*\((.*)\)\s*$/);
    if (!match) return false;
    const handler = API_COMMAND_HANDLERS[match[1]];
    if (!handler) return false;
    const args = match[2].split(',').map(a => a.trim());
    try {
        handler(api, args);
        console.log(`[GeoGebra] API call: ${match[1]}(${args.join(', ')})`);
    } catch (e) {
        console.warn(`[GeoGebra] API call failed: ${cmd}`, e);
    }
    return true;
}

/**
 * 执行所有 GeoGebra 命令。
 *
 * 处理流程：
 * 1. 禁用 GeoGebra 的错误弹窗（避免干扰用户）
 * 2. 逐条执行命令：先尝试作为 API 命令，失败则使用 evalCommand
 * 3. 延迟重新执行动画命令（确保对象已完全创建后再启动动画）
 * 4. 自动为函数对象显示标签（如 "f(x) = sin(x)"）
 *
 * 注意：evalCommand 的返回值不可靠（对 Segment、Locus 等几何命令会返回 false
 * 即使命令实际执行成功），因此不检查返回值。
 */
function executeCommands(api: any, commands: string[]): void {
    try {
        api.setErrorDialogsActive(false);

        for (const cmd of commands) {
            // 优先尝试 API 命令（SetAnimating, SetColor 等）
            if (tryApiCommand(api, cmd)) continue;
            // 普通 GeoGebra 构造命令通过 evalCommand 执行
            console.log(`[GeoGebra] evalCommand: ${cmd}`);
            api.evalCommand(cmd);
        }

        // 动画命令需要延迟执行：确保滑块等对象已完全创建
        const animCmds = commands.filter(cmd => {
            const m = cmd.match(/^(\w+)\s*\(/);
            return m && ['SetAnimating', 'StartAnimation', 'SetAnimationSpeed', 'StopAnimation'].includes(m[1]);
        });
        if (animCmds.length > 0) {
            setTimeout(() => {
                for (const cmd of animCmds) tryApiCommand(api, cmd);
                console.log(`[GeoGebra] Animation commands applied`);
            }, 300);
        }

        console.log(`[GeoGebra] All ${commands.length} commands executed`);

        // 自动为对象显示标签
        // perspective 为 'G'/'T'（无代数面板）时，GeoGebra 不会自动显示标签，需主动开启
        // 标签样式：0=仅名称, 1=名称+值, 2=仅值, 3=标题
        try {
            const allNames = api.getAllObjectNames() || [];
            // 不需要显示标签的辅助对象类型
            const silentTypes = new Set(['numeric', 'boolean', 'slider', 'list', 'image', 'text']);
            for (const name of allNames) {
                const objType = (api.getObjectType(name) || '').toLowerCase();
                if (silentTypes.has(objType)) continue;
                // 函数使用 NAME_VALUE 样式（如 "f(x) = x²"）
                if (objType === 'function') {
                    api.setLabelVisible(name, true);
                    api.setLabelStyle(name, 1);
                } else {
                    // 点、线、多边形等几何对象显示名称
                    api.setLabelVisible(name, true);
                    api.setLabelStyle(name, 0); // 仅名称
                }
            }
        } catch { /* 忽略 */ }
    } catch (e) {
        console.error('[GeoGebra] Error executing commands:', e);
    }
}

/**
 * 在 GeoGebra 画布底部创建自定义 HTML 滑块控件。
 *
 * 3D 模式隐藏代数面板后，GeoGebra 内部的 Slider 不可见。
 * 此函数从命令列表中解析 Slider() 定义，创建对应的 HTML <input type="range">
 * 元素，叠加在画布底部。用户拖动时通过 api.setValue() 实时更新 GeoGebra 变量。
 *
 * 命令格式：varName = Slider(min, max, step)
 */

/**
 * 计算 2D 模式下所有可见对象（含 Text 位置）的包围盒。
 *
 * 跳过不可见对象，将 Text 对象的位置坐标也纳入计算。
 * 返回 null 表示未找到任何有效坐标。
 */
function calcVisibleBBox2D(api: any): { mnX: number; mxX: number; mnY: number; mxY: number } | null {
    const names = api.getAllObjectNames() || [];
    const skipTypes = new Set(['numeric', 'angle', 'boolean', 'function', 'list', 'image']);
    let mnX = Infinity, mxX = -Infinity;
    let mnY = Infinity, mxY = -Infinity;
    let found = false;

    for (const nm of names) {
        try {
            const ot = (api.getObjectType(nm) || '').toLowerCase();
            try { if (!api.getVisible(nm)) continue; } catch { /* 默认包含 */ }

            if (ot === 'text') {
                const vs = api.getValueString(nm) || '';
                const coordRe = /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;
                let mc;
                while ((mc = coordRe.exec(vs)) !== null) {
                    const xv = parseFloat(mc[1]);
                    const yv = parseFloat(mc[2]);
                    if (!isNaN(xv) && !isNaN(yv)) {
                        mnX = Math.min(mnX, xv); mxX = Math.max(mxX, xv);
                        mnY = Math.min(mnY, yv); mxY = Math.max(mxY, yv);
                        found = true;
                    }
                }
                continue;
            }

            if (skipTypes.has(ot)) continue;

            if (ot === 'point') {
                const px = api.getXcoord(nm);
                const py = api.getYcoord(nm);
                if (typeof px === 'number' && !isNaN(px) &&
                    typeof py === 'number' && !isNaN(py)) {
                    mnX = Math.min(mnX, px); mxX = Math.max(mxX, px);
                    mnY = Math.min(mnY, py); mxY = Math.max(mxY, py);
                    found = true;
                }
            }

            const vs = api.getValueString(nm) || '';
            const coordRe = /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;
            let mc;
            while ((mc = coordRe.exec(vs)) !== null) {
                const xv = parseFloat(mc[1]);
                const yv = parseFloat(mc[2]);
                if (!isNaN(xv) && !isNaN(yv)) {
                    mnX = Math.min(mnX, xv); mxX = Math.max(mxX, xv);
                    mnY = Math.min(mnY, yv); mxY = Math.max(mxY, yv);
                    found = true;
                }
            }
        } catch { /* 忽略 */ }
    }

    return found ? { mnX, mxX, mnY, mxY } : null;
}
/**
 * 创建函数图像控制面板。
 *
 * 在 GeoGebra 图形左上角放置一个图标按钮，默认收起。
 * 点击图标展开面板，列出所有函数/曲线对象，每个可点击切换显示/隐藏。
 * 面板内提供"全部显示"和"全部隐藏"快捷按钮。
 * 再次点击图标或点击面板外区域收起面板。
 *
 * @param api       GeoGebra API 对象
 * @param container 外层 DOM 容器
 */
async function createFunctionPanel(api: any, container: HTMLElement, onVisibilityChange?: () => void): Promise<void> {
    try {
        // 预先加载 MathJax，确保 renderMath 可用
        try { await loadMathJax(); } catch { /* 忽略 */ }

        const allNames: string[] = api.getAllObjectNames() || [];
        const funcEntries: { name: string; expr: string; latex: string; color: string }[] = [];

        for (const name of allNames) {
            const objType = (api.getObjectType(name) || '').toLowerCase();
            if (objType !== 'function' && objType !== 'curve' && objType !== 'conic'
                && objType !== 'line' && objType !== 'implicit') continue;

            let expr = '';
            let latex = '';
            try {
                expr = api.getDefinitionString(name) || api.getValueString(name) || name;
            } catch { expr = name; }
            try {
                latex = api.getLaTeXString?.(name) || '';
            } catch { /* 忽略 */ }

            let color = '#4285f4';
            try {
                const r = api.getColor(name);
                if (r) color = r;
            } catch { /* 忽略 */ }

            funcEntries.push({ name, expr, latex, color });
        }

        if (funcEntries.length === 0) return;

        // ── 外层包装：图标 + 面板 ──
        const wrapper = document.createElement('div');
        wrapper.className = 'ggb-func-wrapper';

        // 触发按钮（默认可见的小图标）
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'ggb-func-toggle-btn';
        toggleBtn.title = 'Toggle function list';
        toggleBtn.innerHTML = '<span class="ggb-func-toggle-icon">𝑓</span>';
        wrapper.appendChild(toggleBtn);

        // 面板容器（默认隐藏）
        const panel = document.createElement('div');
        panel.className = 'ggb-func-panel';

        // ── 工具栏：全部显示 / 全部隐藏 ──
        const toolbar = document.createElement('div');
        toolbar.className = 'ggb-func-toolbar';

        const showAllBtn = document.createElement('button');
        showAllBtn.className = 'ggb-func-action-btn';
        showAllBtn.textContent = 'Show All';

        const hideAllBtn = document.createElement('button');
        hideAllBtn.className = 'ggb-func-action-btn';
        hideAllBtn.textContent = 'Hide All';

        toolbar.appendChild(showAllBtn);
        toolbar.appendChild(hideAllBtn);
        panel.appendChild(toolbar);

        // ── 函数列表 ──
        interface RowState { name: string; visible: boolean; row: HTMLElement; dot: HTMLElement; eye: HTMLElement }
        const rows: RowState[] = [];

        for (const entry of funcEntries) {
            let visible = true;
            try { visible = api.getVisible(entry.name); } catch { /* 默认可见 */ }

            const row = document.createElement('div');
            row.className = 'ggb-func-row';
            if (!visible) row.classList.add('ggb-func-hidden');

            const dot = document.createElement('span');
            dot.className = 'ggb-func-dot';
            dot.style.backgroundColor = entry.color;
            if (!visible) dot.style.opacity = '0.3';

            const label = document.createElement('span');
            label.className = 'ggb-func-label';
            label.title = entry.expr;
            if (entry.latex) {
                try {
                    const fullLatex = `${entry.name}(x) = ${entry.latex}`;
                    const mathEl = renderMath(fullLatex, false);
                    label.appendChild(mathEl);
                } catch {
                    label.textContent = entry.expr;
                }
            } else {
                label.textContent = entry.expr;
            }

            const eye = document.createElement('span');
            eye.className = 'ggb-func-eye';
            eye.textContent = visible ? '👁' : '—';

            const state: RowState = { name: entry.name, visible, row, dot, eye };
            rows.push(state);

            row.addEventListener('click', () => {
                state.visible = !state.visible;
                api.setVisible(state.name, state.visible);
                eye.textContent = state.visible ? '👁' : '—';
                row.classList.toggle('ggb-func-hidden', !state.visible);
                dot.style.opacity = state.visible ? '1' : '0.3';
                if (onVisibilityChange) onVisibilityChange();
            });

            row.appendChild(dot);
            row.appendChild(label);
            row.appendChild(eye);
            panel.appendChild(row);
        }

        // 更新所有行的 UI 状态
        const syncAllUI = () => {
            for (const s of rows) {
                s.eye.textContent = s.visible ? '👁' : '—';
                s.row.classList.toggle('ggb-func-hidden', !s.visible);
                s.dot.style.opacity = s.visible ? '1' : '0.3';
            }
        };

        showAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            for (const s of rows) {
                s.visible = true;
                api.setVisible(s.name, true);
            }
            syncAllUI();
            if (onVisibilityChange) onVisibilityChange();
        });

        hideAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            for (const s of rows) {
                s.visible = false;
                api.setVisible(s.name, false);
            }
            syncAllUI();
            if (onVisibilityChange) onVisibilityChange();
        });

        wrapper.appendChild(panel);

        // ── 展开/收起逻辑 ──
        let expanded = false;
        const setExpanded = (val: boolean) => {
            expanded = val;
            panel.classList.toggle('ggb-func-panel-open', expanded);
            toggleBtn.classList.toggle('ggb-func-toggle-active', expanded);
        };

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setExpanded(!expanded);
        });

        // 点击面板外区域收起
        document.addEventListener('click', (e) => {
            if (expanded && !wrapper.contains(e.target as Node)) {
                setExpanded(false);
            }
        });

        container.appendChild(wrapper);

        // 面板插入 DOM 后，触发 MathJax/KaTeX 排版
        try { finishRenderMath(); } catch { /* 忽略 */ }

        console.log(`[GeoGebra] Created function panel with ${funcEntries.length} entries`);
    } catch (e) {
        console.warn('[GeoGebra] Error creating function panel:', e);
    }
}

function createSliderOverlay(api: any, commands: string[], container: HTMLElement): void {
    // 解析 Slider 命令：name = Slider(min, max, step)
    const sliderRegex = /^(\w+)\s*=\s*Slider\s*\(\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*(?:,\s*([\d.eE+-]+))?\s*\)/i;
    const sliders: { name: string; min: number; max: number; step: number }[] = [];

    for (const cmd of commands) {
        const m = cmd.match(sliderRegex);
        if (m) {
            sliders.push({
                name: m[1],
                min: parseFloat(m[2]),
                max: parseFloat(m[3]),
                step: m[4] ? parseFloat(m[4]) : 0.1,
            });
        }
    }

    if (sliders.length === 0) return;

    // 创建滑块容器
    const overlay = document.createElement('div');
    overlay.className = 'ggb-slider-overlay';

    for (const s of sliders) {
        const row = document.createElement('div');
        row.className = 'ggb-slider-row';

        const label = document.createElement('span');
        label.className = 'ggb-slider-label';
        const currentVal = api.getValue(s.name) ?? s.min;
        label.textContent = `${s.name} = ${Number(currentVal.toFixed(4))}`;

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'ggb-slider-input';
        input.min = String(s.min);
        input.max = String(s.max);
        input.step = String(s.step);
        input.value = String(currentVal);

        // 拖动时实时更新 GeoGebra 变量
        input.addEventListener('input', () => {
            const val = parseFloat(input.value);
            api.setValue(s.name, val);
            label.textContent = `${s.name} = ${Number(val.toFixed(4))}`;
        });

        row.appendChild(label);
        row.appendChild(input);
        overlay.appendChild(row);
    }

    container.appendChild(overlay);
    console.log(`[GeoGebra] Created ${sliders.length} slider overlay(s)`);
}

/**
 * 自动计算所有函数对的交点并标记。
 *
 * 遍历所有函数对象，对每一对调用 GeoGebra 的 Intersect() 命令，
 * 生成的交点设置为红色大点，显示坐标标签，可点击拖拽。
 */
/**
 * 自动计算所有函数对的交点，初始隐藏。
 * 点击函数曲线时显示该函数的所有交点（含坐标标签），再次点击隐藏。
 *
 * 实现流程：
 * 1. 遍历函数对，逐对调用 Intersect() 计算交点
 * 2. 记录每个函数关联的交点名称
 * 3. 所有交点初始 setVisible(false)
 * 4. 注册 registerClickListener，点击函数时切换其交点显隐
 */
function addIntersectionPoints(api: any): void {
    try {
        const allNames = api.getAllObjectNames() || [];
        const funcNames = allNames.filter((n: string) => api.getObjectType(n) === 'function');

        if (funcNames.length < 2) return;

        // funcName → 关联的交点名称列表
        const funcPoints: Record<string, string[]> = {};
        for (const f of funcNames) funcPoints[f] = [];

        // 已找到的交点坐标列表（用于去重）
        const foundCoords: { x: number; y: number }[] = [];
        const DEDUP_THRESHOLD = 0.05; // 距离小于此阈值视为重复

        /** 检查新点是否与已有交点重复 */
        const isDuplicate = (px: number, py: number): boolean => {
            for (const c of foundCoords) {
                const dist = Math.sqrt((px - c.x) ** 2 + (py - c.y) ** 2);
                if (dist < DEDUP_THRESHOLD) return true;
            }
            return false;
        };

        /** 处理新增的交点：设置样式、记录关联、去重 */
        const processNewPoints = (beforeNames: Set<string>, fi: string, fj: string) => {
            const afterNames = api.getAllObjectNames() || [];
            for (const name of afterNames) {
                if (beforeNames.has(name)) continue;
                if (api.getObjectType(name) !== 'point') continue;

                // 获取坐标并去重
                const px = api.getXcoord(name);
                const py = api.getYcoord(name);
                if (typeof px === 'number' && !isNaN(px) &&
                    typeof py === 'number' && !isNaN(py)) {
                    if (isDuplicate(px, py)) {
                        // 重复交点，删除
                        try { api.deleteObject(name); } catch { /* 忽略 */ }
                        continue;
                    }
                    foundCoords.push({ x: px, y: py });
                }

                // 此交点属于两个函数
                funcPoints[fi].push(name);
                funcPoints[fj].push(name);

                // 样式：红色大点 + 坐标标签，初始隐藏
                api.setPointSize(name, 5);
                api.setColor(name, 220, 50, 50);
                api.setLabelStyle(name, 2);       // VALUE 样式 (x, y)
                api.setLabelVisible(name, false);
                api.setVisible(name, false);
            }
        };

        // 获取当前可见 x 范围，用于分段搜索
        let xMin = -10, xMax = 10;
        try {
            const gxMin = api.getXmin();
            const gxMax = api.getXmax();
            if (typeof gxMin === 'number' && !isNaN(gxMin)) xMin = gxMin;
            if (typeof gxMax === 'number' && !isNaN(gxMax)) xMax = gxMax;
        } catch { /* 使用默认值 */ }

        // 逐对计算交点
        for (let i = 0; i < funcNames.length; i++) {
            for (let j = i + 1; j < funcNames.length; j++) {
                // 阶段 1：标准 Intersect（对多项式函数能一次性找到所有代数交点）
                const before1 = new Set(api.getAllObjectNames() || []);
                try {
                    api.evalCommand(`Intersect(${funcNames[i]}, ${funcNames[j]})`);
                } catch { /* 忽略 */ }
                processNewPoints(before1, funcNames[i], funcNames[j]);

                // 阶段 2：分段数值搜索（对 sqrt、sin 等超越函数，标准 Intersect 可能漏点）
                // 将可见 x 范围分成若干小区间，逐段调用 Intersect(f, g, xStart, xEnd)
                const segCount = 20;
                const segWidth = (xMax - xMin) / segCount;
                for (let s = 0; s < segCount; s++) {
                    const sx = xMin + s * segWidth;
                    const ex = sx + segWidth;
                    const before2 = new Set(api.getAllObjectNames() || []);
                    try {
                        api.evalCommand(`Intersect(${funcNames[i]}, ${funcNames[j]}, ${sx}, ${ex})`);
                    } catch { continue; }
                    processNewPoints(before2, funcNames[i], funcNames[j]);
                }
            }
        }

        const totalPoints = new Set(Object.values(funcPoints).flat()).size;
        if (totalPoints === 0) return;

        // 当前激活的函数名（null = 无激活）
        let activeFunc: string | null = null;

        // 隐藏指定函数的所有交点
        const hidePoints = (funcName: string) => {
            for (const pt of funcPoints[funcName] || []) {
                api.setVisible(pt, false);
                api.setLabelVisible(pt, false);
            }
        };

        // 显示指定函数的所有交点
        const showPoints = (funcName: string) => {
            for (const pt of funcPoints[funcName] || []) {
                api.setVisible(pt, true);
                api.setLabelVisible(pt, true);
            }
        };

        // 注册点击事件监听
        api.registerClickListener((clickedName: string) => {
            const clickedType = api.getObjectType(clickedName);

            if (clickedType === 'function') {
                if (activeFunc === clickedName) {
                    // 再次点击同一函数 → 隐藏交点
                    hidePoints(clickedName);
                    activeFunc = null;
                } else {
                    // 切换到新函数：先隐藏旧的，再显示新的
                    if (activeFunc) hidePoints(activeFunc);
                    showPoints(clickedName);
                    activeFunc = clickedName;
                }
            } else if (clickedType !== 'point') {
                // 点击非函数/非交点区域 → 隐藏所有交点
                if (activeFunc) {
                    hidePoints(activeFunc);
                    activeFunc = null;
                }
            }
        });

        console.log(`[GeoGebra] Registered click-to-show for ${totalPoints} intersection point(s) across ${funcNames.length} functions`);
    } catch (e) {
        console.warn('[GeoGebra] Error setting up intersection points:', e);
    }
}
