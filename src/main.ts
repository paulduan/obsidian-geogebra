import { Plugin, MarkdownPostProcessorContext } from 'obsidian';
import { RenderMode, LANGUAGE_MODE_MAP } from './types';
import { renderGeoGebra } from './geogebra-renderer';
import { installInterceptor, removeInterceptor } from './geogebra-loader';

const MODE_LABELS: Record<RenderMode, string> = {
    [RenderMode.Geometry2D]: '2D Geometry',
    [RenderMode.Geometry3D]: '3D Geometry',
    [RenderMode.Graph]: 'Function Graph',
};

export default class GeoGebraPlugin extends Plugin {
    async onload(): Promise<void> {
        console.log('[GeoGebra] Loading plugin');
        installInterceptor();

        for (const [lang, mode] of Object.entries(LANGUAGE_MODE_MAP)) {
            this.registerMarkdownCodeBlockProcessor(
                lang,
                (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
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

        // Reset button
        const resetBtn = header.createEl('button', {
            cls: 'ggb-header-btn ggb-reset-btn',
            text: '↺ Reset',
            attr: { title: 'Restore to initial state', disabled: 'true' },
        });

        // Render
        renderGeoGebra(container, source, mode, (resetFn) => {
            resetBtn.removeAttribute('disabled');
            resetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                resetFn();
            });
        });
    }

    onunload(): void {
        console.log('[GeoGebra] Unloading plugin');
        removeInterceptor();
    }
}
