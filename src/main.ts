/**
 * GeoGebra 插件入口
 *
 * 职责：
 * 1. 注册代码块处理器 —— 将 geogebra / ggb / geogebra-3d 等语言的代码块交给渲染器处理
 * 2. 管理插件生命周期 —— 安装/卸载 CSP 拦截器、初始化缓存目录
 * 3. 提供设置面板 —— 允许用户自定义缓存目录路径
 */
import { Plugin, MarkdownPostProcessorContext, PluginSettingTab, App, Setting } from 'obsidian';
import { RenderMode, LANGUAGE_MODE_MAP } from './types';
import { renderGeoGebra, setCacheDir } from './geogebra-renderer';
import { installInterceptor, removeInterceptor } from './geogebra-loader';

/** 插件设置接口 */
interface GeoGebraSettings {
    /** 缓存目录路径（相对于 vault 根目录），用于存储 PDF 导出用的 PNG 快照 */
    cacheDir: string;
}

/** 默认设置 */
const DEFAULT_SETTINGS: GeoGebraSettings = {
    cacheDir: '.obsidian/plugins/obsidian-geogebra/cache',
};

export default class GeoGebraPlugin extends Plugin {
    settings: GeoGebraSettings = DEFAULT_SETTINGS;

    /**
     * 插件加载时执行：
     * 1. 读取用户设置
     * 2. 安装 CSP 拦截器（使 GeoGebra CDN 资源能在 Electron 环境中加载）
     * 3. 设置缓存目录引用
     * 4. 注册所有支持的代码块语言处理器
     */
    async onload(): Promise<void> {
        console.log('[GeoGebra] Loading plugin');
        await this.loadSettings();

        // 安装网络拦截器，绕过 Obsidian 的 CSP 限制
        installInterceptor();

        // 设置 vault 引用和缓存目录，供渲染器写入 PNG 快照
        setCacheDir(this.app.vault, this.settings.cacheDir);

        // 添加设置面板
        this.addSettingTab(new GeoGebraSettingTab(this.app, this));

        // 遍历所有支持的语言标识，注册对应的代码块处理器
        for (const [lang, mode] of Object.entries(LANGUAGE_MODE_MAP)) {
            this.registerMarkdownCodeBlockProcessor(
                lang,
                (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
                    this.processBlock(source, el, mode);
                }
            );
        }
    }

    /**
     * 处理单个代码块：
     * 1. 创建容器 DOM 结构
     * 2. 创建浮动工具栏（包含重置按钮，鼠标悬停时显示）
     * 3. 调用 renderGeoGebra 渲染交互式 applet
     */
    private processBlock(source: string, el: HTMLElement, mode: RenderMode): void {
        // 外层容器，附带模式 CSS 类以便样式区分
        const container = el.createDiv({ cls: `geogebra-container geogebra-mode-${mode}` });

        // 浮动工具栏（鼠标悬停时显示），包含重置按钮
        const header = container.createDiv({ cls: 'ggb-header' });

        // 重置按钮：初始禁用，applet 加载完成后通过回调启用
        const resetBtn = header.createEl('button', {
            cls: 'ggb-header-btn ggb-reset-btn',
            attr: { title: 'Restore to initial state', disabled: 'true' },
        });
        resetBtn.innerHTML = '<span class="ggb-btn-icon">↺</span> Reset';

        // 渲染 GeoGebra applet，传入回调以在 applet 就绪后启用重置按钮
        renderGeoGebra(container, source, mode, {
            onResetReady: (resetFn) => {
                // applet 初始状态已保存，启用重置按钮
                resetBtn.removeAttribute('disabled');
                resetBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    resetFn(); // 调用 api.setBase64() 恢复初始状态
                });
            },
        });
    }

    /** 从 Obsidian 数据存储中加载设置 */
    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /** 保存设置到 Obsidian 数据存储 */
    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    /** 插件卸载时：移除所有 CSP 拦截器，恢复原始的 DOM/XHR/Fetch 方法 */
    onunload(): void {
        console.log('[GeoGebra] Unloading plugin');
        removeInterceptor();
    }
}

/**
 * 设置面板 —— 显示在 Obsidian 设置 → 社区插件 → GeoGebra Renderer 中。
 * 目前仅提供缓存目录路径配置。
 */
class GeoGebraSettingTab extends PluginSettingTab {
    plugin: GeoGebraPlugin;
    constructor(app: App, plugin: GeoGebraPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'GeoGebra Renderer Settings' });

        new Setting(containerEl)
            .setName('Cache directory')
            .setDesc('Directory for cached SVG/PNG exports (relative to vault root). Used for PDF export.')
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.cacheDir)
                .setValue(this.plugin.settings.cacheDir)
                .onChange(async (value) => {
                    this.plugin.settings.cacheDir = value || DEFAULT_SETTINGS.cacheDir;
                    await this.plugin.saveSettings();
                    // 实时更新渲染器的缓存目录引用
                    setCacheDir(this.plugin.app.vault, this.plugin.settings.cacheDir);
                }));
    }
}
