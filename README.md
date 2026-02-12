# Obsidian GeoGebra Plugin

在 Obsidian 笔记中直接渲染 GeoGebra 图形。支持 2D 几何、3D 几何和函数图像三种模式，使用 GeoGebra 原生 API 渲染，完整支持 GeoGebra 命令语法。

## 功能

- **三种渲染模式**：2D 几何、3D 几何、函数图像
- **代数面板**：左侧显示所有变量、公式和滑块
- **动画支持**：通过 `SetAnimating` / `StartAnimation` 驱动点动画
- **自定义参数**：通过 `@key value` 控制画布大小、视图布局等
- **重置按钮**：一键恢复到初始状态（而非清空画布）
- **完整 CSP 绕过**：自动处理 Obsidian 的内容安全策略限制

## 安装

### 方式一：直接复制（推荐）

1. 将以下三个文件复制到你的 Obsidian vault 的插件目录：

```
<你的vault>/.obsidian/plugins/obsidian-geogebra/
├── main.js
├── manifest.json
└── styles.css
```

2. 重启 Obsidian，在 **设置 → 社区插件** 中启用 "GeoGebra Renderer"。

### 方式二：从源码构建

```bash
git clone <repo-url> obsidian-geogebra-plugin
cd obsidian-geogebra-plugin
npm install
npm run build
```

构建完成后，将 `main.js`、`manifest.json`、`styles.css` 复制到你的 vault 插件目录。

## 使用方法

在 Obsidian 笔记中创建代码块，语言标识决定渲染模式：

| 语言标识 | 模式 | 说明 |
|---------|------|------|
| `geogebra` 或 `ggb` | 2D 几何 | 平面几何、解析几何 |
| `geogebra-3d` 或 `ggb-3d` | 3D 几何 | 空间几何、立体图形 |
| `geogebra-graph` 或 `ggb-graph` | 函数图像 | 函数绘图 |

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

### 参数控制

在代码块开头使用 `@key value` 语法设置参数：

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
| `@height` | 画布高度（像素） | 2D: 500, 3D: 750, Graph: 500 | `@height 700` |
| `@width` | 画布宽度（像素） | 自动适应容器宽度 | `@width 900` |
| `@perspective` | 视图布局 | 2D/Graph: `AG`, 3D: `AT` | `@perspective G` |
| `@toolbar` | 显示工具栏 | `false` | `@toolbar true` |
| `@grid` | 显示网格 | GeoGebra 默认 | `@grid true` |
| `@axes` | 显示坐标轴 | GeoGebra 默认 | `@axes true` |
| `@keyboard` | 显示左下角虚拟键盘按钮 | `true` | `@keyboard false` |
| `@center` | 视图中心点坐标 | 自动 | 2D: `@center 3,5`　3D: `@center 0,0,6` |
| `@zoom` | 视野范围（从中心到边界的单位数） | `15` | `@zoom 20` |
| `@range` | 坐标系精确范围 | 自动 | `@range -10,10,-5,5` |

#### 视图布局（perspective）说明

| 字符 | 含义 |
|------|------|
| `A` | 代数面板（Algebra） |
| `G` | 平面图形视图（Graphics） |
| `T` | 3D 视图（Three-D） |
| `S` | 电子表格（Spreadsheet） |

组合示例：
- `AG` — 代数面板 + 平面图形（默认）
- `G` — 仅平面图形（无代数面板）
- `AT` — 代数面板 + 3D 视图
- `AGT` — 代数面板 + 平面图形 + 3D 视图

#### 视图控制（center / zoom / range）

通过 `@center`、`@zoom`、`@range` 控制视图的初始位置和缩放。

**`@center`** — 设置视图中心点：

- 2D 模式：`@center x,y`，例如 `@center 3,5`
- 3D 模式：`@center x,y,z`，例如 `@center 0,0,6`

**`@zoom`** — 设置视野范围（从中心到边界的单位数），通常与 `@center` 搭配使用：

- 默认值 `15`，即中心向各方向可见 15 个单位
- `@zoom 5` 表示放大视图，`@zoom 50` 表示缩小视图

**`@range`** — 精确指定坐标系范围（优先级高于 center/zoom）：

- 格式：`@range xMin,xMax,yMin,yMax`
- 3D 模式下 zMin/zMax 自动取 xMin/xMax 的值

**示例：2D 指定视图中心和缩放**

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

**示例：3D 指定视图中心**

````markdown
```geogebra-3d
@center 0,0,6
@zoom 15
A = (0, 0, 0)
B = (0, 0, 12)
cyl = Cylinder(A, B, 2)
```
````

**示例：精确指定坐标范围**

````markdown
```geogebra
@range -5,15,-2,12
f(x) = x^2 / 10
```
````

### 动画示例

```markdown
```geogebra
@height 600
n = Slider(1, 10, 1)
A = (n, n^2)
SetAnimating(n, true)
StartAnimation()
```
```

### API 命令

除了标准的 GeoGebra 构造命令外，还支持以下脚本命令（直接调用 GeoGebra API）：

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

## 开发

### 项目结构

```
obsidian-geogebra-plugin/
├── src/
│   ├── main.ts              # 插件入口，注册代码块处理器
│   ├── geogebra-loader.ts   # CSP 绕过，资源加载拦截
│   ├── geogebra-renderer.ts # GeoGebra applet 创建与命令执行
│   └── types.ts             # 类型定义
├── styles.css               # 插件样式
├── manifest.json            # Obsidian 插件清单
├── esbuild.config.mjs       # 构建配置
├── version-bump.mjs         # 自动递增 patch 版本号
├── deploy.mjs               # 部署脚本（复制到 vault）
├── package.json
└── tsconfig.json
```

### 构建命令

```bash
# 安装依赖
npm install

# 开发构建
npm run dev

# 生产构建
npm run build

# 构建并部署到 vault（自动递增版本号，需修改 deploy.mjs 中的路径）
npm run deploy

# 仅递增版本号（不构建不部署）
npm run version-bump
```

### 部署脚本

`npm run deploy` 会依次执行：
1. **`version-bump.mjs`** — 自动递增 patch 版本号（如 `1.1.1` → `1.1.2`），同时更新 `manifest.json` 和 `package.json`
2. **`npm run build`** — 编译 TypeScript
3. **`deploy.mjs`** — 复制构建产物到 Obsidian vault

首次使用前需修改 `deploy.mjs` 中的 `VAULT_PLUGIN_DIR` 路径为你自己的 vault 位置：

```javascript
const VAULT_PLUGIN_DIR = join(
  process.env.HOME,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/<你的vault名>/.obsidian/plugins/obsidian-geogebra"
);
```

### 技术原理

Obsidian (Electron) 有严格的内容安全策略（CSP），阻止从外部 CDN 加载脚本和样式。本插件通过多层拦截绕过这一限制：

1. **DOM 拦截**：Patch `Node.prototype.appendChild`/`insertBefore`，捕获 `<script>` 和 `<link>` 元素的插入
2. **Script src 拦截**：Patch `HTMLScriptElement.prototype.src` setter，捕获字体等资源的加载
3. **XHR/Fetch 拦截**：Patch `XMLHttpRequest` 和 `window.fetch`，代理 GeoGebra 的数据请求
4. **跨 iframe 补丁**：GWT 框架在 iframe 中运行，递归 patch iframe 的 `Node.prototype`
5. **Blob URL 执行**：将拦截的脚本内容转为 Blob URL，在正确的 iframe 上下文中执行
6. **URL 重定向**：将 `app://obsidian.md/` 开头的错误路径重定向到正确的 GeoGebra CDN 地址

所有外部请求通过 Obsidian 的 `requestUrl()` API（基于 Node.js HTTP）完成，不受浏览器 CSP 限制。

## 许可

MIT
