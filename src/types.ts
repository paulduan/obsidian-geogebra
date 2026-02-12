/**
 * Rendering modes corresponding to different code block languages.
 */
export enum RenderMode {
    Geometry2D = '2d',
    Geometry3D = '3d',
    Graph = 'graph',
}

/**
 * Map of code block language identifiers to rendering modes.
 */
export const LANGUAGE_MODE_MAP: Record<string, RenderMode> = {
    'geogebra': RenderMode.Geometry2D,
    'ggb': RenderMode.Geometry2D,
    'geogebra-3d': RenderMode.Geometry3D,
    'ggb-3d': RenderMode.Geometry3D,
    'geogebra-graph': RenderMode.Graph,
    'ggb-graph': RenderMode.Graph,
};
