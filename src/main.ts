import { Plugin, MarkdownPostProcessorContext, PluginSettingTab, App, Setting } from 'obsidian';
import { RenderMode, LANGUAGE_MODE_MAP } from './types';
import { renderGeoGebra, setCacheDir } from './geogebra-renderer';
import { installInterceptor, removeInterceptor } from './geogebra-loader';

const MODE_LABELS: Record<RenderMode, string> = {
    [RenderMode.Geometry2D]: '2D Geometry',
    [RenderMode.Geometry3D]: '3D Geometry',
    [RenderMode.Graph]: 'Function Graph',
};

interface GeoGebraSettings {
    cacheDir: string;
}

const DEFAULT_SETTINGS: GeoGebraSettings = {
    cacheDir: '.obsidian/plugins/obsidian-geogebra/cache',
};

export default class GeoGebraPlugin extends Plugin {
    settings: GeoGebraSettings = DEFAULT_SETTINGS;

    async onload(): Promise<void> {
        console.log('[GeoGebra] Loading plugin');
        await this.loadSettings();
        installInterceptor();
        setCacheDir(this.app.vault, this.settings.cacheDir);

        this.addSettingTab(new GeoGebraSettingTab(this.app, this));

        for (const [lang, mode] of Object.entries(LANGUAGE_MODE_MAP)) {
            this.registerMarkdownCodeBlockProcessor(
                lang,
                (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
                    this.processBlock(source, el, mode);
                }
            );
        }
    }

    private processBlock(source: string, el: HTMLElement, mode: RenderMode): void {
        const container = el.createDiv({ cls: `geogebra-container geogebra-mode-${mode}` });

        // Header with mode badge + reset button
        const header = container.createDiv({ cls: 'ggb-header' });
        header.createEl('span', {
            cls: 'ggb-mode-badge',
            text: MODE_LABELS[mode],
        });
        header.createDiv({ cls: 'ggb-header-spacer' });

        const resetBtn = header.createEl('button', {
            cls: 'ggb-header-btn ggb-reset-btn',
            attr: { title: 'Restore to initial state', disabled: 'true' },
        });
        resetBtn.innerHTML = '<span class="ggb-btn-icon">↺</span> Reset';

        renderGeoGebra(container, source, mode, {
            onResetReady: (resetFn) => {
                resetBtn.removeAttribute('disabled');
                resetBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    resetFn();
                });
            },
        });
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    onunload(): void {
        console.log('[GeoGebra] Unloading plugin');
        removeInterceptor();
    }
}

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
                    setCacheDir(this.plugin.app.vault, this.plugin.settings.cacheDir);
                }));
    }
}
