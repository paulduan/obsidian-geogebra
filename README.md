# Obsidian GeoGebra Plugin

在 Obsidian 中渲染交互式 GeoGebra 图形。支持 2D 几何、3D 几何和函数图像三种模式，使用 GeoGebra 原生 API，完整支持 GeoGebra 命令语法。

## 功能

- **三种渲染模式**：2D 几何（`classic`）、3D 几何（`3d`）、函数图像（`classic`）
- **完整 GeoGebra 命令**：支持所有 GeoGebra 构造命令和 API 调用
- **动画支持**：通过 `SetAnimating` / `StartAnimation` 驱动滑块和点动画
- **自定义参数**：通过 `@key value` 控制画布大小、视图范围、缩放等
- **默认隐藏代数面板**：界面更简洁，`@keyboard true` 可开启
- **3D 滑块覆盖层**：自动检测 Slider 命令，在 3D 画布上叠加可拖动滑块
- **函数交点点击显示**：2D/Graph 模式下点击函数曲线自动显示交点坐标
- **自动标签显示**：几何对象自动显示名称，函数显示表达式
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
| `geogebra-graph` / `ggb-graph` | 函数图像 | `classic` | 纯函数绘图、函数交点分析 |

> **注意**：`geogebra-graph` 使用 `classic` 引擎（非 `graphing`），以支持 perspective 面板控制。所有 GeoGebra 构造命令（`Segment`、`Point(path)`、`Locus`、`Slider` 等）在三种模式下均可使用。

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

#### 滑块与轨迹

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
| `@perspective` | 视图布局 | 2D/Graph: `G`, 3D: `T`（默认隐藏代数面板） | `@perspective AG` |
| `@toolbar` | 显示工具栏 | `false` | `@toolbar true` |
| `@grid` | 显示网格 | GeoGebra 默认 | `@grid true` |
| `@axes` | 显示坐标轴 | GeoGebra 默认 | `@axes true` |
| `@keyboard` | 显示代数面板/输入框 | `false` | `@keyboard true` |
| `@center` | 视图中心点 | 自动 | `@center 3,5` / `@center 0,0,6` |
| `@zoom` | 从中心到边界的可见单位数 | `15` | `@zoom 20` |
| `@range` | 坐标系精确范围 | 自动 | `@range -10,10,-5,5` |
| `@scale` | 整体缩放比例 | `1` | `@scale 0.6` |

#### 代数面板控制

默认所有模式隐藏左侧代数面板，界面更简洁。可通过以下方式控制：

- **`@keyboard true`** — 显示代数面板（perspective 自动变为 `AG` / `AT`）
- **`@keyboard false`**（默认） — 隐藏代数面板
- **`@perspective AG`** — 手动指定视图布局，优先级最高

> 3D 模式使用原生 `3d` 应用，代数面板通过加载后调用 `api.setPerspective('T')` 隐藏。

#### 视图布局（perspective）

| 字符 | 含义 |
|------|------|
| `A` | 代数面板（Algebra） |
| `G` | 平面图形视图（Graphics） |
| `T` | 3D 视图（Three-D） |
| `S` | 电子表格（Spreadsheet） |

组合示例：`G`（仅图形，默认）、`AG`（代数 + 图形）、`T`（仅 3D，默认）、`AT`（代数 + 3D）

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

> 3D 模式下，坐标系范围会自动扩展到包含原点 (0,0,0)，确保坐标轴始终可见。

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

### 智能功能

#### 3D 滑块覆盖层

3D 模式隐藏代数面板后，GeoGebra 内部滑块不可见。插件自动检测 `Slider()` 命令，在 3D 画布左下角叠加半透明 HTML 滑块控件，拖动时通过 `api.setValue()` 实时同步 GeoGebra 变量。

````markdown
```geogebra-3d
side = 3
t = Slider(0, 1, 0.01)
gap = 2
Ar = (0, 0, -t * gap)
Br = (side, 0, -t * gap)
```
````

> 设置 `@keyboard true` 可改用原生代数面板中的滑块。`@keyboard false` 时使用自定义 HTML 覆盖层。

#### 函数交点点击显示

2D/Graph 模式下，如果代码块中定义了多个函数，插件自动预计算所有函数对的交点。交点默认隐藏，点击函数曲线时显示该函数的所有交点（红色大点 + 坐标标签），再次点击隐藏。

````markdown
```geogebra-graph
@keyboard false
f(x) = x^2 - 2*x + 1
g(x) = sin(x)
h(x) = sqrt(abs(x))
```
````

#### 自动标签显示

隐藏代数面板后，GeoGebra 不会自动显示对象标签。插件在命令执行后主动为所有对象开启标签：

- **函数**：显示 `NAME_VALUE` 样式（如 `f(x) = x^2`）
- **点、线、多边形等几何对象**：显示名称
- **数值变量、滑块、布尔值、列表、图片、文本**：不显示标签

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

路径上的点也可以动画：

````markdown
```geogebra
topEdge = Segment((0, 4), (6, 4))
P = Point(topEdge)
SetAnimating(P, true)
SetAnimationSpeed(P, 2)
StartAnimation()
```
````

### 文本与 LaTeX 样式

GeoGebra 的 `Text()` 命令支持 LaTeX 渲染。通过第 3、4 个参数启用：

```
Text("内容", (x, y), true, true)
```

- 第 3 个参数 `true` = 启用 LaTeX 渲染
- 第 4 个参数 `true` = 启用变量替换（变量值实时更新）

#### 字号控制（LaTeX）

| 命令 | 效果 |
|------|------|
| `\tiny` | 极小 |
| `\small` | 小 |
| `\normalsize` | 标准 |
| `\large` | 稍大 |
| `\Large` | 大 |
| `\LARGE` | 很大 |
| `\huge` | 巨大 |
| `\Huge` | 最大 |

#### 颜色控制（LaTeX）

```
\textcolor{red}{文字}
\textcolor{blue}{文字}
\textcolor{green}{文字}
```

#### 示例

````markdown
```geogebra
@keyboard false
a = 6
h = 4
A = (0, 0)
B = (a, 0)
C = (a, h)
D = (0, h)
rect = Polygon(A, B, C, D)
cutLength = Distance(A, B)
txt1 = Text("\textcolor{red}{\Large cutLength = " + cutLength + "}", (0.2, 5.5), true, true)
```
````

### API 命令（JS API Handler）

以下命令由插件拦截，通过 GeoGebra JavaScript API 直接执行（部分命令只能通过 JS API 调用，不支持 evalCommand）：

| 命令 | 说明 |
|------|------|
| `SetAnimating(name, true/false)` | 设置对象动画 |
| `StartAnimation()` | 开始动画 |
| `StopAnimation()` | 停止动画 |
| `SetAnimationSpeed(name, speed)` | 设置动画速度 |
| `SetColor(name, r, g, b)` | 设置颜色（RGB 数字） |
| `SetColor(name, "Red")` | 设置颜色（颜色名：Red, Blue, Green, Yellow, Orange, Purple, Cyan, Magenta, Pink, Brown, Black, White, Gray 等 20+） |
| `SetVisible(name, true/false)` | 设置可见性 |
| `SetFixed(name, true/false)` | 固定对象 |
| `SetLineThickness(name, thickness)` | 设置线宽 |
| `SetPointSize(name, size)` | 设置点大小 |
| `SetFilling(name, value)` | 设置填充透明度（0~1） |
| `SetCaption(name, "text")` | 设置标题文字 |
| `SetLabelVisible(name, true/false)` | 显示/隐藏标签 |

### GeoGebra 脚本命令参考

以下是 GeoGebra 官方全部脚本命令（[Scripting Commands](https://geogebra.github.io/docs/manual/en/commands/Scripting_Commands/)）的完整对照表。
未被插件拦截的命令通过 `evalCommand()` 直接传给 GeoGebra 执行，**无需额外配置，直接在代码块中使用即可**。

> 标记说明：✅ = 插件 JS API Handler | → = evalCommand 直通 | ✗ = 不适用

#### 对象属性命令

| 命令 | 状态 | 说明 |
|------|------|------|
| `SetColor(obj, r, g, b)` | ✅ | 颜色（支持颜色名） |
| `SetCaption(obj, "text")` | ✅ | 标题文字 |
| `SetFilling(obj, value)` | ✅ | 填充透明度 0~1 |
| `SetFixed(obj, true/false)` | ✅ | 固定/解锁对象 |
| `SetLineThickness(obj, t)` | ✅ | 线条粗细 |
| `SetPointSize(obj, s)` | ✅ | 点大小 |
| `SetLabelVisible(obj, bool)` | ✅ | 显示/隐藏标签 |
| `SetVisible(obj, bool)` | ✅ | 显示/隐藏对象 |
| `SetDynamicColor(obj, r, g, b, a)` | → | 动态颜色（基于变量） |
| `SetConditionToShowObject(obj, cond)` | → | 条件显隐 |
| `SetCoords(obj, x, y)` | → | 设置坐标 |
| `SetDecoration(obj, style)` | → | 装饰样式（角标记等） |
| `SetImage(obj, filename)` | → | 设置图片 |
| `SetLabelMode(obj, mode)` | → | 标签模式（0=名称, 1=名称+值, 2=值, 3=标题, 4=无） |
| `SetLayer(obj, layer)` | → | 图层 |
| `SetLevelOfDetail(obj, detail)` | → | 3D 细节级别 |
| `SetLineOpacity(obj, opacity)` | → | 线条透明度 0-255 |
| `SetLineStyle(obj, style)` | → | 线型（0=实线, 1=长虚线, 2=短虚线, 3=点线, 4=点划线） |
| `SetPointStyle(obj, style)` | → | 点样式（0=圆点, 1=叉, 2=空心圆, ...） |
| `SetTrace(obj, bool)` | → | 轨迹追踪 |
| `SetValue(obj, value)` | → | 设置数值 |
| `ShowLabel(obj, bool)` | → | 显示/隐藏标签 |

#### 动画命令

| 命令 | 状态 | 说明 |
|------|------|------|
| `SetAnimating(obj, bool)` | ✅ | 标记对象为可动画（JS API） |
| `SetAnimationSpeed(obj, speed)` | ✅ | 动画速度（JS API） |
| `StartAnimation()` | ✅ | 开始动画（JS API） |
| `StopAnimation()` | ✅ | 停止动画（JS API） |

#### 视图控制命令

| 命令 | 状态 | 说明 |
|------|------|------|
| `SetActiveView(viewId)` | → | 切换活跃视图（1=2D, 2=3D） |
| `SetPerspective(string)` | → | 视图布局 |
| `SetAxesRatio(x, y)` | → | 坐标轴比例 |
| `SetBackgroundColor(r, g, b)` | → | 背景色 |
| `SetSpinSpeed(speed)` | → | 3D 自动旋转速度 |
| `SetTooltipMode(obj, mode)` | → | 提示模式 |
| `SetViewDirection(direction)` | → | 3D 视角方向 |
| `SetVisibleInView(obj, view, bool)` | → | 指定视图中的可见性 |
| `CenterView(point)` | → | 视图居中到某点 |
| `Pan(dx, dy)` | → | 平移视图 |
| `ShowAxes(bool)` | → | 显示/隐藏坐标轴 |
| `ShowGrid(bool)` | → | 显示/隐藏网格 |
| `HideLayer(layer)` / `ShowLayer(layer)` | → | 图层显隐 |
| `ZoomIn(factor)` / `ZoomOut(factor)` | → | 缩放 |
| `UpdateConstruction()` | → | 强制重绘 |

#### 对象管理命令

| 命令 | 状态 | 说明 |
|------|------|------|
| `Slider(min, max, step)` | → | 创建滑块 |
| `Button("label")` | → | 创建按钮 |
| `Checkbox("label", obj)` | → | 创建复选框 |
| `InputBox(obj)` | → | 创建输入框 |
| `Delete(obj)` | → | 删除对象 |
| `Rename(obj, "newName")` | → | 重命名 |
| `SelectObjects(obj1, obj2, ...)` | → | 选中对象 |
| `CopyFreeObject(obj)` | → | 复制自由对象 |
| `AttachCopyToView(obj, view)` | → | 附加副本到视图 |

#### 文本 / 显示命令

| 命令 | 状态 | 说明 |
|------|------|------|
| `Text("内容", point, LaTeX, subst)` | → | 创建文本（支持 LaTeX） |
| `FormulaText(obj)` | → | 格式化公式显示 |
| `TableText({...})` | → | 表格 |
| `FractionText(num)` | → | 分数显示 |
| `SurdText(num)` | → | 根号显示 |

#### 高级 / 脚本命令

| 命令 | 状态 | 说明 |
|------|------|------|
| `Execute({"cmd1", "cmd2"})` | → | 批量执行命令 |
| `Repeat(n, "cmd")` | → | 重复执行 |
| `ParseToNumber(var, "expr")` | → | 解析字符串为数值 |
| `ParseToFunction(f, "expr")` | → | 解析字符串为函数 |
| `SetConstructionStep(n)` | → | 设置构造步骤 |
| `SetSeed(n)` | → | 设置随机种子 |
| `GetTime()` | → | 获取当前时间 |
| `StartRecord()` | → | 开始录制到电子表格 |
| `RunClickScript(obj)` | → | 执行对象的点击脚本 |
| `RunUpdateScript(obj)` | → | 执行对象的更新脚本 |
| `ExportImage(...)` | → | 导出图片 |
| `PlaySound(file)` | ✗ | Obsidian 环境不支持音频 |
| `ReadText("text")` | ✗ | 屏幕阅读器相关，不适用 |

#### 海龟画图命令

| 命令 | 状态 | 说明 |
|------|------|------|
| `Turtle()` | → | 创建海龟 |
| `TurtleForward(t, d)` / `TurtleBack(t, d)` | → | 前进/后退 |
| `TurtleLeft(t, a)` / `TurtleRight(t, a)` | → | 左转/右转 |
| `TurtleUp(t)` / `TurtleDown(t)` | → | 抬笔/落笔 |

### 3D 专用构造命令

以下命令仅在 3D 模式（`geogebra-3d`）中可用，全部通过 evalCommand 直接执行：

| 命令 | 说明 |
|------|------|
| `Cone(center, radius, height)` | 圆锥 |
| `Cube(point, point)` | 正方体 |
| `Cylinder(point1, point2, radius)` | 圆柱 |
| `Dodecahedron(point, point)` | 正十二面体 |
| `Icosahedron(point, point)` | 正二十面体 |
| `InfiniteCone(apex, axis, angle)` | 无限圆锥面 |
| `InfiniteCylinder(point, direction, radius)` | 无限圆柱面 |
| `Net(solid, number)` | 展开图 |
| `Octahedron(point, point)` | 正八面体 |
| `Plane(point1, point2, point3)` | 平面 |
| `PlaneBisector(segment)` | 中垂面 |
| `PerpendicularPlane(point, line)` | 垂直面 |
| `Prism(polygon, height)` | 棱柱 |
| `Pyramid(polygon, point)` | 棱锥 |
| `Sphere(center, radius)` | 球 |
| `Surface(expr, u, v, ...)` | 参数曲面 |
| `Tetrahedron(point, point)` | 正四面体 |
| `Top(solid)` / `Bottom(solid)` | 顶面/底面 |
| `Height(solid)` | 高 |
| `Volume(solid)` | 体积 |

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
