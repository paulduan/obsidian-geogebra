# Obsidian GeoGebra Plugin

在 Obsidian 中渲染交互式 GeoGebra 图形。支持 2D 几何、3D 几何和函数图像三种模式，使用 GeoGebra 原生 API，完整支持 GeoGebra 命令语法。

## 功能

- **三种渲染模式**：2D 几何（`classic`）、3D 几何（`3d`）、函数图像（`graphing`）
- **完整 GeoGebra 命令**：支持所有 GeoGebra 构造命令和 API 调用
- **动画支持**：通过 `SetAnimating` / `StartAnimation` 驱动滑块和点动画
- **自定义参数**：通过 `@key value` 控制画布大小、视图范围、缩放等
- **重置按钮**：悬停显示，一键恢复到初始状态
- **PDF 导出**：自动将动态图形替换为静态 PNG 截图
- **CSP 绕过**：自动处理 Obsidian Electron 环境的内容安全策略限制

## 安装

### 方式一：直接复制

将以下三个文件复制到 vault 插件目录：

```
<vault>/.obsidian/plugins/obsidian-geogebra/
├── main.js
├── manifest.json
└── styles.css
```

重启 Obsidian，在 **设置 → 社区插件** 中启用 "GeoGebra Renderer"。

### 方式二：从源码构建

```bash
git clone <repo-url> obsidian-geogebra-plugin
cd obsidian-geogebra-plugin
npm install
npm run build
```

构建完成后，将 `main.js`、`manifest.json`、`styles.css` 复制到 vault 插件目录。

## 使用方法

在 Obsidian 笔记中创建代码块，语言标识决定渲染模式：

| 语言标识 | 模式 | GeoGebra 引擎 | 适用场景 |
|---------|------|---------------|---------|
| `geogebra` / `ggb` | 2D 几何 | `classic` | 平面几何、解析几何、滑块、Locus |
| `geogebra-3d` / `ggb-3d` | 3D 几何 | `3d` | 空间几何、立体图形 |
| `geogebra-graph` / `ggb-graph` | 函数图像 | `graphing` | 纯函数绘图 |

> **注意**：`Segment`、`Point(path)`、`Locus`、`Slider` 等几何命令仅在 `classic` 引擎中可用。如果需要这些命令，请使用 `geogebra` 而非 `geogebra-graph`。

### 基本示例

#### 2D 几何

````markdown
```geogebra
A = (1, 3)
B = (3, 4)
C = (5, 1)
poly1 = Polygon(A, B, C)
```
````

#### 3D 几何

````markdown
```geogebra-3d
A = (0, 0, 0)
B = (0, 0, 12)
cyl = Cylinder(A, B, 2)
S1 = (0, 0, 3)
ball1 = Sphere(S1, 2)
```
````

#### 函数图像

````markdown
```geogebra-graph
f(x) = sin(x)
g(x) = cos(x)
```
````

#### 滑块与轨迹（需使用 `geogebra`）

````markdown
```geogebra
a = Slider(0, 2, 0.01)
f = Segment((0,0), (0,a))
A = Point(f, 1)
t = y(A)
H = (sin(2π*t), 2t^(2))
c = Locus(H, A)
```
````

### 参数控制

在代码块开头使用 `@key value` 设置参数：

````markdown
```geogebra
@height 700
@axes true
@grid true
A = (1, 3)
B = (3, 4)
Line(A, B)
```
````

#### 可用参数

| 参数 | 说明 | 默认值 | 示例 |
|------|------|--------|------|
| `@height` | 画布高度（px） | 2D: 500, 3D: 750, Graph: 500 | `@height 700` |
| `@width` | 画布宽度（px） | 自动适应容器 | `@width 900` |
| `@perspective` | 视图布局 | 2D/Graph: `AG`, 3D: `AT` | `@perspective G` |
| `@toolbar` | 显示工具栏 | `false` | `@toolbar true` |
| `@grid` | 显示网格 | GeoGebra 默认 | `@grid true` |
| `@axes` | 显示坐标轴 | GeoGebra 默认 | `@axes true` |
| `@keyboard` | 显示虚拟键盘/代数输入 | `true` | `@keyboard false` |
| `@center` | 视图中心点 | 自动 | `@center 3,5` / `@center 0,0,6` |
| `@zoom` | 从中心到边界的可见单位数 | `15` | `@zoom 20` |
| `@range` | 坐标系精确范围 | 自动 | `@range -10,10,-5,5` |
| `@scale` | 整体缩放比例 | `1` | `@scale 0.6` |

#### 视图布局（perspective）

| 字符 | 含义 |
|------|------|
| `A` | 代数面板（Algebra） |
| `G` | 平面图形视图（Graphics） |
| `T` | 3D 视图（Three-D） |
| `S` | 电子表格（Spreadsheet） |

组合示例：`AG`（默认）、`G`（仅图形）、`AT`（代数 + 3D）、`AGT`（代数 + 图形 + 3D）

#### 视图控制

**`@center` + `@zoom`** — 设置视图中心和可见范围：

````markdown
```geogebra
@center 3,5
@zoom 10
@grid true
A = (1, 3)
B = (5, 7)
Segment(A, B)
```
````

**`@range`** — 精确指定坐标系范围（优先级高于 center/zoom）：

````markdown
```geogebra
@range -5,15,-2,12
f(x) = x^2 / 10
```
````

**`@scale`** — 缩放整个画布（文字、线条、点等比例缩放）：

````markdown
```geogebra
@scale 0.6
@height 800
A = (0,0)
B = (10,10)
Circle(A, B)
```
````

### 动画

````markdown
```geogebra
@height 600
n = Slider(1, 10, 1)
A = (n, n^2)
SetAnimating(n, true)
StartAnimation()
```
````

### API 命令

除标准 GeoGebra 构造命令外，支持以下脚本命令（直接调用 GeoGebra JS API）：

| 命令 | 说明 |
|------|------|
| `SetAnimating(name, true/false)` | 设置对象动画 |
| `StartAnimation()` | 开始动画 |
| `StopAnimation()` | 停止动画 |
| `SetAnimationSpeed(name, speed)` | 设置动画速度 |
| `SetColor(name, r, g, b)` | 设置颜色 |
| `SetVisible(name, true/false)` | 设置可见性 |
| `SetFixed(name, true/false)` | 固定对象 |
| `SetLineThickness(name, thickness)` | 设置线宽 |
| `SetPointSize(name, size)` | 设置点大小 |
| `SetCaption(name, "text")` | 设置标签 |
| `SetLabelVisible(name, true/false)` | 显示/隐藏标签 |

### PDF 导出

通过 Obsidian 的 **文件 → 导出为 PDF** 时，插件自动将交互式 applet 替换为静态 PNG 截图。

工作原理：
1. Applet 加载完成后自动截取 PNG 快照，存入缓存（文件 + localStorage）
2. 用户交互（拖拽、滑块）后自动更新快照
3. CSS `@media print` 规则在导出时隐藏动态 applet，显示静态图片

缓存目录可在 **设置 → GeoGebra Renderer → Cache directory** 中修改。

> PDF 中的图形为最后一次截图的快照。

## 开发

### 项目结构

```
src/
├── main.ts              # 插件入口，注册代码块处理器
├── geogebra-loader.ts   # CSP 绕过，DOM/XHR/Fetch 拦截
├── geogebra-renderer.ts # Applet 创建、命令执行、视图调整、缓存
└── types.ts             # RenderMode 枚举、语言映射
styles.css               # 插件样式
manifest.json            # Obsidian 插件清单
esbuild.config.mjs       # 构建配置
version-bump.mjs         # 自动递增 patch 版本号
deploy.mjs               # 部署到 vault 的脚本
```

### 构建命令

```bash
npm install        # 安装依赖
npm run dev        # 开发构建（含 sourcemap）
npm run build      # 生产构建（压缩）
npm run deploy     # 递增版本 + 构建 + 部署到 vault
```

### 部署

`npm run deploy` 依次执行：version-bump → build → deploy。

首次使用需修改 `deploy.mjs` 中的 `VAULT_PLUGIN_DIR` 为你的 vault 路径。

### CSP 绕过原理

Obsidian (Electron) 的 CSP 阻止从外部加载脚本和样式。本插件通过多层拦截绕过：

1. **DOM 拦截** — Patch `appendChild` / `insertBefore`，将外部脚本转为 Blob URL 加载
2. **Script.src 拦截** — Patch `HTMLScriptElement.prototype.src`，捕获动态加载的字体等资源
3. **XHR / Fetch 拦截** — 代理 GeoGebra 的数据请求
4. **跨 iframe 补丁** — 递归 patch GWT iframe 的 `Node.prototype`
5. **URL 修正** — 将 `app://obsidian.md/` 开头的错误路径重定向到 GeoGebra CDN

所有外部请求通过 Obsidian 的 `requestUrl()` API（Node.js HTTP）完成，不受浏览器 CSP 限制。

## 许可

MIT
