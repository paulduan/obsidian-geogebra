/**
 * 渲染模式枚举与语言映射
 *
 * 定义了三种 GeoGebra 渲染模式，以及 Obsidian 代码块语言标识到渲染模式的映射关系。
 * 不同模式对应不同的 GeoGebra 引擎（classic / 3d / graphing）。
 */

/**
 * 渲染模式枚举，对应不同的 GeoGebra 应用类型。
 *
 * - Geometry2D: 2D 几何模式，使用 'classic' 引擎，支持所有几何命令（Segment, Locus 等）
 * - Geometry3D: 3D 几何模式，使用 '3d' 引擎，支持空间几何（Sphere, Cylinder 等）
 * - Graph:      函数图像模式，使用 'graphing' 引擎，仅支持函数绘图，不支持几何命令
 */
export enum RenderMode {
    Geometry2D = '2d',
    Geometry3D = '3d',
    Graph = 'graph',
}

/**
 * 代码块语言标识 → 渲染模式的映射表。
 *
 * 用户在 Obsidian 中创建代码块时，通过语言标识选择渲染模式：
 *   ```geogebra       → 2D 几何
 *   ```ggb            → 2D 几何（简写）
 *   ```geogebra-3d    → 3D 几何
 *   ```ggb-3d         → 3D 几何（简写）
 *   ```geogebra-graph → 函数图像
 *   ```ggb-graph      → 函数图像（简写）
 */
export const LANGUAGE_MODE_MAP: Record<string, RenderMode> = {
    'geogebra': RenderMode.Geometry2D,
    'ggb': RenderMode.Geometry2D,
    'geogebra-3d': RenderMode.Geometry3D,
    'ggb-3d': RenderMode.Geometry3D,
    'geogebra-graph': RenderMode.Graph,
    'ggb-graph': RenderMode.Graph,
};
