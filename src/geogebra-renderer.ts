/**
 * GeoGebra Renderer
 *
 * Creates real GeoGebra applets and executes GeoGebra commands
 * via the evalCommand API. Full GeoGebra compatibility.
 */
import { loadGeoGebra, getGeoGebraVersion } from './geogebra-loader';
import { RenderMode } from './types';

declare const GGBApplet: any;

/** Map RenderMode to GeoGebra app name */
const APP_NAMES: Record<RenderMode, string> = {
    [RenderMode.Geometry2D]: 'classic',
    [RenderMode.Geometry3D]: '3d',
    [RenderMode.Graph]: 'graphing',
};

/** Default perspectives for each mode */
const DEFAULT_PERSPECTIVES: Record<RenderMode, string> = {
    [RenderMode.Geometry2D]: 'AG',  // Algebra panel (left) + Graphics
    [RenderMode.Geometry3D]: 'AT',  // Algebra panel (left) + 3D view
    [RenderMode.Graph]: 'AG',      // Algebra panel (left) + Graphics
};

/** Default heights for each mode */
const DEFAULT_HEIGHTS: Record<RenderMode, number> = {
    [RenderMode.Geometry2D]: 500,
    [RenderMode.Geometry3D]: 750,
    [RenderMode.Graph]: 500,
};

let appletCounter = 0;

/** Wait for next animation frame (element has layout dimensions) */
function waitForLayout(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/**
 * Parsed parameters from code block frontmatter.
 * Lines starting with @ are treated as parameters:
 *   @height 600
 *   @width 800
 *   @perspective AG   (A=Algebra, G=Graphics, T=3D, S=Spreadsheet)
 *   @toolbar true
 *   @grid true
 *   @axes true
 */
export interface AppletParams {
    width?: number;
    height?: number;
    perspective?: string;
    toolbar?: boolean;
    grid?: boolean;
    axes?: boolean;
    /** Hide the virtual keyboard button at bottom-left */
    keyboard?: boolean;
    /** Coordinate system bounds: [xMin, xMax, yMin, yMax] */
    range?: [number, number, number, number];
    /** Center point of the view: [x, y] for 2D or [x, y, z] for 3D */
    center?: number[];
    /** Zoom level (visible units from center): used with @center */
    zoom?: number;
}

function parseSource(source: string): { params: AppletParams; commands: string[] } {
    const params: AppletParams = {};
    const commands: string[] = [];

    for (const raw of source.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;

        // Parse @key value parameters
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
                    // @center x,y  or  @center x,y,z  for 3D
                    const parts = val.split(/[,\s]+/).map(Number);
                    if (parts.length >= 2 && parts.every(n => !isNaN(n))) {
                        params.center = parts.slice(0, parts.length >= 3 ? 3 : 2);
                    }
                    break;
                }
                case 'zoom':
                    // @zoom 10  — visible units from center in each direction
                    params.zoom = parseFloat(val);
                    break;
                case 'range': {
                    // @range xMin,xMax,yMin,yMax  e.g. @range -10,10,-5,5
                    const r = val.split(/[,\s]+/).map(Number);
                    if (r.length >= 4 && r.every(n => !isNaN(n))) {
                        params.range = [r[0], r[1], r[2], r[3]];
                    }
                    break;
                }
            }
            continue;
        }

        commands.push(line);
    }

    return { params, commands };
}

/**
 * Render a GeoGebra code block into the given container.
 */
export async function renderGeoGebra(
    container: HTMLElement,
    source: string,
    mode: RenderMode,
    onResetReady?: (resetFn: () => void) => void
): Promise<void> {
    const appletId = `ggb-applet-${Date.now()}-${++appletCounter}`;
    const appletDiv = container.createDiv({ cls: 'ggb-applet-container' });
    appletDiv.id = appletId;

    // Show loading state
    const loadingEl = container.createDiv({ cls: 'ggb-loading' });
    loadingEl.setText('Loading GeoGebra...');

    // Parse parameters and commands from source
    const { params: userParams, commands } = parseSource(source);
    console.log(`[GeoGebra] Rendering ${mode} applet (${APP_NAMES[mode]}) with ${commands.length} commands, params:`, userParams);

    // Capture any unhandled errors during GeoGebra initialization
    const errorCapture: string[] = [];
    const errorHandler = (event: ErrorEvent) => {
        if (event.filename?.includes('web3d') || event.filename?.includes('geogebra') || event.filename?.includes('VM')) {
            errorCapture.push(`${event.message} at ${event.filename}:${event.lineno}`);
            console.error(`[GeoGebra] Caught error: ${event.message}`, event);
        }
    };
    window.addEventListener('error', errorHandler);

    try {
        await loadGeoGebra();

        if (typeof GGBApplet === 'undefined') {
            throw new Error('GGBApplet not available after loading');
        }

        loadingEl.setText('Initializing applet...');

        // Wait for DOM layout so we can measure the actual container width
        await waitForLayout();
        await waitForLayout();

        const measuredWidth = appletDiv.clientWidth || appletDiv.offsetWidth
            || container.clientWidth || container.offsetWidth || 800;
        const width = userParams.width || Math.max(measuredWidth, 400);
        const height = userParams.height || DEFAULT_HEIGHTS[mode];

        // Apply user-specified height to the container so it doesn't collapse
        if (userParams.height) {
            appletDiv.style.minHeight = `${userParams.height}px`;
        }

        console.log(`[GeoGebra] Measured container width: ${measuredWidth}px → using ${width}x${height}`);

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                const errMsg = errorCapture.length > 0
                    ? `GeoGebra errors:\n${errorCapture.join('\n')}`
                    : 'GeoGebra applet initialization timed out (60s). Check console for details.';
                reject(new Error(errMsg));
            }, 60000);

            const perspective = userParams.perspective || DEFAULT_PERSPECTIVES[mode];
            const showToolBar = userParams.toolbar ?? false;

            const params: Record<string, any> = {
                id: appletId,
                appName: APP_NAMES[mode],
                width,
                height,
                perspective,
                scaleContainerClass: 'ggb-applet-container',
                showAlgebraInput: userParams.keyboard ?? true,
                showKeyboardOnFocus: userParams.keyboard ?? true,
                algebraInputPosition: 'algebra',
                showToolBar,
                showToolBarHelp: false,
                showMenuBar: false,
                showResetIcon: false,
                enableLabelDrags: true,
                enableShiftDragZoom: true,
                enableRightClick: true,
                enableCAS: false,
                enableAnimation: true,
                allowStyleBar: false,
                errorDialogsActive: false,
                useBrowserForJS: false,
                preventFocus: true,
                appletOnLoad: (api: any) => {
                    clearTimeout(timeout);
                    window.removeEventListener('error', errorHandler);
                    console.log(`[GeoGebra] Applet ${appletId} ready, executing ${commands.length} commands...`);
                    loadingEl.remove();

                    // Apply grid/axes settings before commands
                    if (userParams.grid !== undefined) {
                        api.setGridVisible(userParams.grid);
                    }
                    if (userParams.axes !== undefined) {
                        api.setAxesVisible(userParams.axes, userParams.axes);
                    }

                    executeCommands(api, commands);

                    // Apply coordinate system settings after commands
                    // 3D needs longer delay for the 3D view to fully initialize
                    const viewDelay = mode === RenderMode.Geometry3D ? 800 : 300;
                    const apply3DView = (api: any, cx: number, cy: number, cz: number, z: number) => {
                        api.evalCommand('SetActiveView(2)');
                        const cmd = `SetCoordSystem(${cx - z}, ${cx + z}, ${cy - z}, ${cy + z}, ${cz - z}, ${cz + z})`;
                        api.evalCommand(cmd);
                        console.log(`[GeoGebra] 3D SetCoordSystem: ${cmd}`);
                        // Also try JS API as fallback
                        try {
                            api.setCoordSystem(cx - z, cx + z, cy - z, cy + z, cz - z, cz + z);
                        } catch (_) { /* ignore */ }
                    };
                    setTimeout(() => {
                        try {
                            if (mode === RenderMode.Geometry3D) {
                                // ── 3D view adjustment ──
                                if (userParams.center || userParams.zoom) {
                                    const cx = userParams.center?.[0] ?? 0;
                                    const cy = userParams.center?.[1] ?? 0;
                                    const cz = userParams.center?.[2] ?? 0;
                                    const z = userParams.zoom || 15;
                                    apply3DView(api, cx, cy, cz, z);
                                    // Retry after another delay to ensure 3D view is ready
                                    setTimeout(() => {
                                        try { apply3DView(api, cx, cy, cz, z); } catch (_) {}
                                    }, 1000);
                                } else if (userParams.range) {
                                    api.evalCommand('SetActiveView(2)');
                                    const [x0, x1, y0, y1] = userParams.range;
                                    api.evalCommand(`SetCoordSystem(${x0}, ${x1}, ${y0}, ${y1}, ${x0}, ${x1})`);
                                    console.log(`[GeoGebra] 3D range set from @range`);
                                } else {
                                    // Auto-fit
                                    api.evalCommand('SetActiveView(2)');
                                    try {
                                        api.evalCommand('SelectAll()');
                                        api.evalCommand('ZoomToFit()');
                                        api.evalCommand('SelectAll()');
                                    } catch {}
                                }
                            } else if (userParams.range) {
                                // ── 2D explicit range ──
                                const [xMin, xMax, yMin, yMax] = userParams.range;
                                api.setCoordSystem(xMin, xMax, yMin, yMax);
                                console.log(`[GeoGebra] 2D range: [${xMin}, ${xMax}, ${yMin}, ${yMax}]`);
                            } else if (userParams.center) {
                                // ── 2D center + zoom ──
                                const [cx, cy] = userParams.center;
                                const z = userParams.zoom || 10;
                                api.setCoordSystem(cx - z, cx + z, cy - z, cy + z);
                                console.log(`[GeoGebra] 2D center=(${cx},${cy}) zoom=${z}`);
                            } else {
                                // ── Auto-fit ──
                                try {
                                    api.evalCommand('SelectAll()');
                                    api.evalCommand('ZoomToFit()');
                                    api.evalCommand('SelectAll()');
                                } catch {}
                            }
                            console.log(`[GeoGebra] View adjustment applied`);
                        } catch (e) {
                            console.warn('[GeoGebra] View adjustment failed:', e);
                        }
                    }, viewDelay);

                    // Save initial state for reset (after auto-center settles)
                    // For 3D with center/zoom, wait longer due to retry
                    const saveDelay = (mode === RenderMode.Geometry3D && (userParams.center || userParams.zoom)) ? 2500 : 800;
                    setTimeout(() => {
                        try {
                            const savedState = api.getBase64();
                            console.log(`[GeoGebra] Initial state saved (${savedState.length} chars)`);
                            if (onResetReady) {
                                onResetReady(() => {
                                    console.log(`[GeoGebra] Restoring initial state...`);
                                    api.setBase64(savedState);
                                });
                            }
                        } catch (e) {
                            console.warn('[GeoGebra] Could not save initial state:', e);
                        }
                    }, saveDelay);

                    resolve();
                },
            };

            try {
                console.log(`[GeoGebra] Creating GGBApplet(appName="${APP_NAMES[mode]}", ${width}x${height})...`);
                const applet = new GGBApplet(params, true);

                const ver = getGeoGebraVersion();
                if (ver) {
                    const codebase = `https://www.geogebra.org/apps/${ver}/web3d/`;
                    console.log(`[GeoGebra] Setting codebase: ${codebase}`);
                    applet.setHTML5Codebase(codebase);
                }

                console.log(`[GeoGebra] Injecting into #${appletId}...`);
                applet.inject(appletId);
                console.log(`[GeoGebra] inject() called, waiting for appletOnLoad callback...`);
            } catch (e) {
                clearTimeout(timeout);
                window.removeEventListener('error', errorHandler);
                reject(e);
            }
        });

    } catch (e) {
        window.removeEventListener('error', errorHandler);
        loadingEl.remove();
        console.error('[GeoGebra] Render failed:', e);
        const msg = (e as Error).message || String(e);
        container.createDiv({
            cls: 'geogebra-error',
            text: `Failed to render GeoGebra: ${msg}`,
        });
    }
}

const API_COMMAND_HANDLERS: Record<string, (api: any, args: string[]) => void> = {
    'SetAnimating': (api, args) => {
        const name = args[0]?.trim();
        const anim = args[1]?.trim().toLowerCase() !== 'false';
        if (name) api.setAnimating(name, anim);
    },
    'StartAnimation': (api) => { api.startAnimation(); },
    'StopAnimation': (api) => { api.stopAnimation(); },
    'SetAnimationSpeed': (api, args) => {
        const name = args[0]?.trim();
        const speed = parseFloat(args[1]?.trim());
        if (name && !isNaN(speed)) api.setAnimationSpeed(name, speed);
    },
    'SetColor': (api, args) => {
        const name = args[0]?.trim();
        const r = parseInt(args[1]?.trim()), g = parseInt(args[2]?.trim()), b = parseInt(args[3]?.trim());
        if (name) api.setColor(name, r, g, b);
    },
    'SetVisible': (api, args) => {
        const name = args[0]?.trim();
        const vis = args[1]?.trim().toLowerCase() !== 'false';
        if (name) api.setVisible(name, vis);
    },
    'SetFixed': (api, args) => {
        const name = args[0]?.trim();
        const fixed = args[1]?.trim().toLowerCase() !== 'false';
        if (name) api.setFixed(name, fixed);
    },
    'SetLineThickness': (api, args) => {
        const name = args[0]?.trim();
        const t = parseInt(args[1]?.trim());
        if (name && !isNaN(t)) api.setLineThickness(name, t);
    },
    'SetPointSize': (api, args) => {
        const name = args[0]?.trim();
        const s = parseInt(args[1]?.trim());
        if (name && !isNaN(s)) api.setPointSize(name, s);
    },
    'SetCaption': (api, args) => {
        const name = args[0]?.trim();
        const caption = args.slice(1).join(',').trim().replace(/^["']|["']$/g, '');
        if (name) api.setCaption(name, caption);
    },
    'SetLabelVisible': (api, args) => {
        const name = args[0]?.trim();
        const vis = args[1]?.trim().toLowerCase() !== 'false';
        if (name) api.setLabelVisible(name, vis);
    },
};

function tryApiCommand(api: any, cmd: string): boolean {
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

function executeCommands(api: any, commands: string[]): void {
    try {
        api.setErrorDialogsActive(false);
        for (const cmd of commands) {
            if (tryApiCommand(api, cmd)) continue;
            console.log(`[GeoGebra] evalCommand: ${cmd}`);
            const success = api.evalCommand(cmd);
            if (!success) {
                console.warn(`[GeoGebra] Command may have failed: ${cmd}`);
            }
        }
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
    } catch (e) {
        console.error('[GeoGebra] Error executing commands:', e);
    }
}
