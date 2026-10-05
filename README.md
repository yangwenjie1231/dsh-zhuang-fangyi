# dsh-zhuang-fangyi

庄方宜主题 for DeepSeek Harness —— 4 套官方配色预设 × 浅色/深色各自完整适配，附官方素材壁纸、观测台（官方右栏标签页 + 浮层兜底）与头像气泡重绘。

非官方同人作品；配色与素材取自《明日方舟：终末地》官方公开物料的量化提取。

## 特性

- **接入官方主题体系**：注册 4 预设 × 2 明暗 = 8 个主题进「外观」下拉，与其它主题插件互不干扰。
- **浅色与深色各自适配**：每个 token 都提供两套值，明暗切换由外壳属性驱动，纯 CSS 跟随。
- **可跟随系统**：默认走 token 层而不改 preference，`prefers-color-scheme` 不被锁定。
- **观测台**：会话读数（轮次/步数/速率/token/缓存/上下文）+ 运行耗时 + 配色色板 + 壁纸切换。**优先作为官方右栏标签页**（`sidebarRightTabs` 扩展席位，与文件/终端并列、可拖拽调宽），右栏收起时以浮层显示在右侧 —— 两条路径由 `railOwner()` 单点裁决，不会同时让位。
- **皮肤层**：助手头像与气泡/输入框重绘（可单独关闭）。
- **官方取色**：荧光黄绿 `#F2E957` / 青 `#75DCD9` / 酒红 `#D86766` / 橄榄绿 `#9EBD87` / 米白 `#E8D4D2`；大招形态 墨青 `#1D3D30` / 冰白青 `#D2E7E0` / 香槟金 `#C4D579`。
- **双壳适配**：桌面端与网页端跑的是**两套类名完全不同的壳**，插件用「语义锚点 → 哈希反查 → 后缀兜底」三层定位同时兼容（详见 [`docs/双壳适配说明.md`](docs/双壳适配说明.md)）。
- **竖图不裁人**：`portrait` / `vertical` 这类竖图自动改用 `contain` 完整显示，两侧由同图重模糊垫底填充（判据来自生成器产出的 `art/wallpapers.json`，不硬编码图名）。
- **无构建步骤**：两个半边都是手写 JS，除外壳已提供的 `react` 外零依赖。
- **强调色自选**：`accentHue` 可把强调色转到任意色相（0–359°），保留原配色饱和度；明度按对比度自动校正，**任意色相都可读**（有 672 项色相扫描兜底）。
- **可验证**：`npm test` 串起 312 项对比度断言 + **672 项强调色色相扫描** + 341 项浏览器半边无头测试（桩忠实复刻插槽冲突校验、官方 tab 注册契约、样式表形态与壁纸渲染链）。另有 `/diag` 真机自检（含壁纸渲染五环探针）。

## 与 Mornye（莫宁 Observation Skin）的对照

本插件的设计参考了开源项目 [Mornye-Observation-Skin](https://github.com/is-limo/Mornye-Observation-Skin)
（`data-plugin-css` 哈希反查、状态推导优先级、原生面板让位策略均学自它，MIT）。
功能对照如下：

| 能力 | Mornye 0.4.2 | 本插件 |
|---|---|---|
| 明暗适配 | 仅浅色完整，**深色回退官方** | 浅色/深色各自完整适配（8 主题） |
| 观测台载体 | 页面内浮层 | **官方右栏标签页**（+ 浮层兜底，单点裁决） |
| 适配壳版本 | 桌面 0.1.7-rc.2（锁死） | 桌面 **0.2.0-rc.2** + 双壳三层定位（Web 代码兼容、未真机验证） |
| 壁纸 | 无 | 8 张 × 明暗两版 = 16 张官方素材 WebP；透明度/模糊/位置可调；**竖图自动 contain + 模糊垫底**（不裁人） |
| 统计 | 轮/步/缓存，`—` 兜底 | 同策略，另解析 tok/s、token 总量、上下文占比（六卡自适应 240–380px） |
| 状态区 | RUNNING/TOOL/DONE/ERROR/STOPPED + 耗时 | tool/running/error/stopped/done + 运行耗时（1s 走字，`running↔tool` 不重置） |
| 强调色自选 | **有**（三种预设强调色，固定） | **有且更开放**：任意色相 0–359°，且明度自动校正保证可读（672 项扫描） |
| 静止模式 | **有**（开关） | **有**（跟随系统 / 静止），只关本插件自己的过渡，不越权全局 |
| 聊天导航 | **有**（读页面 DOM，只覆盖已加载内容） | **不实现** —— 官方已提供且更强，见下方「为什么不重复实现聊天导航」 |
| 自动化测试 | Playwright runtime/parity + 语义契约 | 341 无头断言 + 312 对比度断言 + 672 色相扫描 + `/diag` 真机自检（Playwright 见 P2） |
| 发行工程 | ZIP + install/uninstall + SHA256SUMS + PRIVACY | 同套（见 `tools/package.ps1`、`PRIVACY.md`、`ASSETS-NOTICE.md`） |

> **对照原则**：只把「官方没有、Mornye 有」算作缺口。官方已有的能力直接用官方实现，
> 不重复造 —— 否则做出的是更差的版本，还会与官方 UI 打架。

### 为什么不重复实现聊天导航

规划中曾把「本地聊天导航」列为本插件的主要缺口（因为 Mornye 有）。**核实官方后撤销了这项**：

| | Mornye 的导航 | 官方已有 |
|---|---|---|
| 数据源 | 读**页面 DOM**（只覆盖已加载内容） | **Host 投影 `turnOutline`**（覆盖全部已开始轮次，含未加载） |
| 覆盖 | 当前页可见内容 | 全部轮次 |
| 定位 | `scrollIntoView` | 官方轮次导航轨（右侧刻度梯，10px 间距，可滚动，支持加载更早历史） |
| 搜索 | 有 | `dsh-client-ui-trajectory` 提供（含时间线、token 用量、TTFT 耗时） |

即：Mornye 的导航是在**较老壳版本**（0.1.7-rc.2）上补的 DOM 版；在本插件适配的
0.2.0-rc.2 上，官方已把这件事做得更根本。自己再做一遍只会**更差且重复**，所以不做。

**对标收尾**：Mornye 有、官方没有的剩余项是外观控制器的**强调色自选** ——
该项已在 v0.3.0 实现（`accentHue`，任意色相 + 对比度自动校正），见下方「强调色色相」一节。

## 安装

```sh
# 从本地目录装进 desktop profile
dsh plugin --profile desktop add /path/to/dsh-zhuang-fangyi
```

或手动：把本目录放到 `$DSH_HOME/profiles/<profile>/node_modules/dsh-zhuang-fangyi`，
并在该 profile 的 `package.json` 里加依赖与 `dsh.profile.bundles` 条目，然后**重启 DSH**。

### 改代码后怎么生效

| 改了什么 | 生效方式 |
|---|---|
| `client.js` | 走 HMR（模块注册表按 mtime/size 派生 revision），必要时刷新页面 |
| `index.js` / `src/*.js` | **必须重启 DSH** |

`plugin_manager` 的 disable → enable 只重跑 `apply()`，**不会**重新 `import`
依赖模块 —— Node 的 ESM 缓存按路径生效，所以改了 `index.js` 或 `src/*.js`
后页面仍是旧代码。这不是代码写错了。

用构建标记可以一眼确认跑的是哪一版（`tools/deploy.ps1` 部署时写入）：

```powershell
Invoke-WebRequest http://127.0.0.1:19387/api/zhuang-fangyi/themes | % Content
# {"build":"20261005-123748", ...}   ← 与部署时间一致即已生效
```

### 从发行 ZIP 安装（用户视角）

```powershell
# 解压发行包后，先校验再安装：
.\install.ps1 -DshPath 'D:\path\to\DeepSeek Harness' -CheckOnly
.\install.ps1 -DshPath 'D:\path\to\DeepSeek Harness'
```

`install.ps1` 会把插件写入 `profiles/desktop/node_modules`、更新 profile 的依赖与
bundles 条目，并**备份 `package.json` 原始字节**供 `uninstall.ps1` 还原。
发行包由 `tools/package.ps1` 生成（ZIP + `SHA256SUMS.txt`，按明确文件清单打包）。

## 设置

「设置 → 庄方宜」：

| 分组 | 项 |
|---|---|
| 主题 | 启用 · 配色预设（本体黄绿 / 大招墨青金 / 青 / 酒红）· 明暗模式（跟随系统 / 固定浅色 / 固定深色） |
| 背景 | 背景图（**缩略图条**，随明暗显示对应版本）· 不透明度 0–45% · 模糊 0–16px · 位置（铺满 / 靠右 / 平铺） |
| 装饰 | **强调色色相**（0–359° 或「预设」）· **静止模式**（跟随系统 / 静止）· 等高线细边框 · 强调色微光 · 空白页头像 · 标题栏跟随 |
| 皮肤 | 右侧观测栏 · 观测栏宽度 240–380px · 头像与气泡重绘 |

底部两个按钮：**恢复默认**（`POST {"reset":true}` 真正写回 `defaultSettings()`）与**重试**（重新保存当前设置）。
侧栏底部另有一键开关。

### 观测台的双路径行为

| 当前状态 | 谁来显示观测台 |
|---|---|
| 右栏**收起** | **浮层**（`shell.overlay`，`position:fixed` 贴右边、避让 40px 标题栏） |
| 右栏**展开** | **官方标签页**（自动 `openTab`，与文件/终端并列、可拖拽调宽） |
| tab 挂着但面板收起 | 浮层接手 —— 官方实现里 docked 内容**收起时仍挂载**（只是平移出右边缘），所以「挂着」不等于「看得见」 |
| 用户手动关掉我们的 tab | 不反复重开（尊重选择），浮层也不接管（面板还开着，可从「指南」重开） |
| 视口 < 1180px | 隐藏（同 Mornye 断点） |
| 原生面板（文件/终端等）已开 | 不代为展开用户的面板；观测台作为 tab 并存其中 |

- 两路径的裁决函数是 `railOwner()`，判定条件是**两个**：`tabMounted > 0`（tab 真的挂着内容）
  **且** `nativeRightbarOpen()`（面板确实展开）。只看前者会在收起后误判 —— 那时 tab
  仍挂载但已移出可视区，结果**两边都看不见**（实测踩过两次：一次是「注册≠打开」，
  一次是「挂着≠可见」）。
- 观测台**刻意不读取消息正文** —— 读数只来自外壳已渲染的统计行，本插件是皮肤，
  不该碰会话内容（隐私边界见 [`PRIVACY.md`](PRIVACY.md)）。
- **头像与气泡**：助手消息旁显示圆形头像 + 「庄方宜」标签；用户气泡与输入框
  改为细边框 + 圆角。

设置落盘于 `$DSH_HOME/zhuang-fangyi/settings.json`（临时文件 + rename 原子写）。
文件损坏时会备份为 `.corrupt-<时间戳>` 并回落默认值，**不覆盖**原文件。
设置结构版本 v3（v1→v2 加观测栏/气泡，v2→v3 加强调色色相与静止模式）；
旧文件会**无损升级**（新键补默认值，已有字段全部保留）。

### 强调色色相（`accentHue`）为什么不能只转色相

`accentHue` 允许把强调色转到任意色相（0–359°），保留原配色的饱和度。

**最初的实现只旋转色相、保留明度**，理由是「预设的 `accentLight` 明度已按可读性
调过，换色相后依然成立」。这个推理**是错的** —— 相对亮度取决于色相：人眼对绿最
敏感、对蓝最迟钝，同一明度下黄绿转蓝后亮度显著下降。

`contrast.js` 里有一条**色相扫描**（12 色相 × 4 预设 × 2 明暗 × 7 断言 = 672 项）
把这件事变成了可测量的：初版实现**有 62 项跌破阈值**，例如

- `wine/light` 转 60°（黄）：链接 3.25:1 < 4.5（变亮 → 在浅底上不够暗）
- `burst/dark` 转 240°（蓝）：链接 4.16:1 < 4.5（变暗 → 在深底上不够亮）

**修法**：`rotateAccent()` 改为**以对比度目标反解明度** —— 保留饱和度，明度在
原值附近搜索，使该色对**全部参照面**都达标。参照面必须逐一满足，因为
`link` 要同时读在 4 个面上，其中一个（`specific-bubble` = `brandSoft`）
**本身由强调色派生**，换色相时前景与背景一起动，是自指约束。

改完后 672 项全通过 —— 即**任意色相都保持可读**。这条扫描是 `accentHue` 的
安全网：以后调色板配方若破坏了这个性质，`npm test` 会直接失败。

## 实现依据

以下结论全部从运行中的外壳源码核实（`app.asar` 内 `@deepseek-ai/dsh-client-ui-theme`、
`dsh-client-ui-layout`、`dsh-desktop`），不是推测：

| 事实 | 对实现的影响 |
|---|---|
| `validateOverrides` 对裸字符串**直接抛错**，原文 `a single value goes illegible when the user switches color scheme` | 每个 token 必须同时给 `{light, dark}` |
| `composeActive()` 按 `active.colorScheme` 从 `{light,dark}` 二选一 | 只给一套 → 另一套是 `undefined` → 切主题即失效 |
| 内置 `light`/`dark` 主题的 token 表**是空的**，真调色板在 CSS 的 `body{}` / `body[data-ds-dark-theme]{}` | 基线不能读注册表，只能读计算样式 |
| presenter 把 token 写成 **body 的行内样式**（先 `removeProperty` 全部旧的再写新的） | ① 外部 CSS 压不过它 → 壁纸透明必须做进 token 值本身；② 层一撤就恢复默认 |
| 切明暗 = presenter 增删 `body[data-ds-dark-theme]` | 壁纸明暗两版可**纯 CSS 跟随** |
| `setTheme` 只在 `isThemePreference(id)` 时写盘，而内置偏好只有 `light`/`dark`/`system` | **第三方主题 id 不持久化** → 插件自己存设置并在启动时重设 |
| `register` 的 disposer 在 preference 指向自己时重置为 `system` | 卸载即干净还原，无需手动复位 |
| token 名不设白名单 | 可覆盖 `--dsw-static-*` 色阶，也可补外壳未定义的 `--dsw-alias-focus-ring-color` |
| 外壳的 `specific-*` 一族是 `--dsw-specific-*`（**没有** `alias`） | 写错前缀不会报错，只会静默失效 → `contrast.js` 用真实 token 名清单逐条校验 |
| **桌面端与网页端是两套壳**（`BynINW_*`/`rightbarCol` vs `pI_x6G_*`/`detailsCol`） | 右栏选择器两个后缀都要写；定位改用三层策略 |
| 外壳为每个 CSS Module 插入 `style[data-plugin-css]`，内含真实类名 | 可反查当前哈希，不必猜 → 跨版本自愈 |
| 桌面壳暴露 456 个 `data-*` 语义锚点 | 优先用锚点定位，比类名稳 |
| **桌面端 `tapIndex` 从不执行**：`dsh-app://` 协议处理器直接从磁盘读 `dsh-web-frontend/dist/index.html`，只注入 `__DSH_BOOT_READY__`，不经过 Host 的 webServer | 宿主注入的 CSS 在桌面端一个字都不出现 → 客户端必须自己 `fetch('/style.css')` 并插 `<style>`。这正是最初「只改了配色」的根因 |
| 客户端插样式表用 `el.textContent = css`，**不能带 `<style>` 标签** | `/style.css` 必须发纯 CSS（`structureCss()`）；带标签会让浏览器把紧随的 `html{}` 块整块丢弃 → `--zf-art-*` 全失效 → **壁纸画不出来**（而观测台样式仍正常，极具迷惑性） |
| Node ESM 按路径缓存，disable/enable 不重新 import | 改 Host 侧代码必须重启 DSH → 加构建标记以便判别 |

### 两层覆盖

1. **19 级中性色阶** `--dsw-static-neutral-bluish-*` —— 只在 `body{}` 定义一次，
   明暗两套 alias 各自引用其中不同级数。覆盖一次色阶 = 明暗双向同时生效，
   并自动兜住未列举的组件。
2. **语义 alias 直写** —— 色阶只给整体色调倾向；浅色下 `bg-base`、`layer-1`、
   `layer-3`、按钮、输入框**全部映射到同一级 `static-00`**，分层靠描边而非填色，
   必须直写才能给出层次。

### 配色：色度、以及为什么必须「按面积分配」

HSL 的饱和度是**相对**量，在明度两端会被压缩。同一个 `s=0.13`：

- `L=96.5%` → `#F7F7F5`，几乎纯灰（肉眼看不出颜色）
- `L=50%` → 明显有色

界面底色恰恰全在明度两端（浅色 89–99%、深色 8–21%），所以「调饱和度」在底色上
几乎无效。改用**色度**（`max-min`，0..255）—— 绝对量，直接对应「看起来有多少颜色」：

```
S = chroma / (255 · (1-|2L-1|))
```

这样无论明度多高多低，色相都保持同样的可见强度。见 `src/palette.js` 的 `tint()`。

**但色度不能当成「整体染色」的旋钮** —— 这里踩过两次坑：

| 版本 | 做法 | 反馈 |
|---|---|---|
| v1 | 表面色度 3–5 | 整屏发灰，「太丑」 |
| v2 | 表面色度 12–22 | 「像给整个画面加了一层滤镜」 |
| **v3（当前）** | **按面积分配** | 近中性底 + 主题色点缀 |

v3 的原则：**色度按面积分配**。

| 面积 | 部位 | 色度 | 作用 |
|---|---|---|---|
| 大面积 | `base` / `surface` / `surfaceAlt` / `sidebar` | **2–6** | 近中性，只留一丝冷暖暗示 |
| 中面积 | `code` / `codeBanner` / `inlineCode` | 7–10 | 把代码块从底上分出来 |
| 选中态 | `navActive` / `brandSoft` / 气泡 | 15–21 | 明显带主题色，但不抢眼 |
| 小面积 | `brand` / `link` / `focusRing` | **58–155** | 主题色只在这里出现 |

大面积带色相必然显脏、像滤镜 —— 真实界面的大面积色度都很低
（GitHub dark `#0D1117` 色度 10、VS Code `#1E1E1E` 色度 0）。

这也正是「更明显的主题色」的正确实现：**不是把底色染绿，而是让强调色在近中性
的底上跳出来**。调色时改 `PRESET_SPECS` 里的 `hue` 与 `chroma` 两个数即可。

### 为什么「跟随系统」用 `overrideTokens` 而不是 `setTheme`

桌面版下，`setTheme(固定id)` 会让 presenter 把 `html[data-ds-theme-source]` 设为该
scheme，桌面壳 preload 再转发给 `nativeTheme.themeSource` —— 一旦如此，
`prefers-color-scheme` 就被**锁定**，系统换主题不再触发。

所以「跟随系统」走 token 层（不改 preference，`data-ds-theme-source` 保持 `system`），
「固定浅色/深色」才走注册表。两条路径各司其职。

### 壁纸的「纱」为什么不能改 token

最初给 `--dsw-alias-bg-base` 套 alpha 让外壳透出壁纸，实测**无效**：presenter 把
全部 token 写成 body 的**行内样式**，行内优先级高于任何样式表规则。

正确做法：**不动 token**，而是把外壳那几层不透明的背景改成半透明。半透明色由
客户端按当前预设与明暗算好，写成 `--zf-veil*`（外壳不认识的新变量）。

还有个容易错的点：外壳是嵌套的，若给每层都套 alpha，可见度会**连乘**
（两层各 0.83 只剩 0.69；实测「壁纸完全看不见」时只剩 3%）。所以外层
（`body` / `#root` / frame）全部透明，**只让三个列各带一层纱**。

### 壁纸渲染链（五环，逐环可诊断）

壁纸从设置到画出来要经过五环，**任一环断掉的表现都是「背景没反应」**，
所以 `/diag` 里有一条 `wallpaper` 探针逐环报告计算值：

| 环 | 内容 | 断掉的表现 |
|---|---|---|
| ① 属性 | `html[data-zf-wallpaper]` / `body[data-zf-wallpaper]` | 整条链不启动 |
| ② 间接引用 | 行内 `--zf-art-src: var(--zf-art-<id>)` | 计算值为空 |
| ③ 被引用变量 | 样式表 `html{ --zf-art-<id>: url(...) }` | ② 解析失败 → 整条属性失效 |
| ④ 绘制层 | `html::before` 的 `background-image` 计算值 | `none` = 没画 |
| ⑤ 上层透明 | 纱色 / frame / 中栏的实际背景 | 不透明就盖住壁纸 |

**第 ③ 环曾经断过很久**：`/style.css` 带了 `<style>` 标签，浏览器把紧随的
`html{}` 块整块丢弃 → 21 个 `--zf-art-*` 全没定义 → 壁纸怎么都出不来，
而观测台样式（在文件后半段）完全正常。详见
[`docs/双壳适配说明.md`](docs/双壳适配说明.md) 第八节。

### 竖图为什么要 `contain` + 模糊垫底

`portrait`（1080×1920）与 `vertical`（1440×2560）宽高比 0.56，用 `cover` 铺横屏
只能看到**中间约 40% 的高度** —— 人物被裁成一条、脸被放大 1.24 倍。

做法：前景层 `::before` 用 `contain` 完整显示（取景 `center 22%` 保住头部），
新增 `::after` 垫底层用同图 `cover` 铺满 + `blur(64px)` + 按明暗压暗，填两侧空隙。
判据来自 `art/wallpapers.json`（`prepare-art.py` 按宽高比生成，**不硬编码图名**），
清单缺失时回落 `cover`，不会坏。横图完全不变（垫底 `none`，零额外开销）。

### 桌面版 / 网页版

详见 [`docs/双壳适配说明.md`](docs/双壳适配说明.md)。要点：

| 维度 | 网页版 | 桌面版 |
|---|---|---|
| 宿主 | 同进程 | **独立 Node 进程**（`@deepseek-ai/dsh-desktop-host`） |
| 外壳来源 | profile `node_modules` | `app.asar` 自带 |
| AppFrame 类名 | `pI_x6G_*`，右栏 `detailsCol` | `BynINW_*`，右栏 `rightbarCol` |
| `data-platform` / `data-windows-titlebar` / `data-fullscreen` | 无 | preload 注入 |
| 品牌插槽（`sidebar.brand.mark` 等） | 只声明、不渲染 | **有渲染方**（带 fallback） |
| 原生标题栏配色 | — | **自动跟随**：preload 的 probe + `MutationObserver`(body 的 `style`) + canvas 取色 → IPC `setTitleBarOverlay`。因为 presenter 正是写 body 行内样式，本插件改 token 即触发，无需额外代码 |
| macOS 侧栏 | 实色 | `background:0 0` + vibrancy + `color-mix` 二次混合 |

壁纸规则不依赖任何 `data-*` 桌面标记，所以两端行为一致。

## 开发

```sh
npm test                     # 语法 + 312 对比度 + 672 色相扫描 + 341 无头测试
node tools/test-client.mjs   # 只跑浏览器半边无头测试（341 项）
python tools/prepare-art.py  # 从 庄方宜素材\ 重建 art/ 与 art/wallpapers.json
python tools/solve-palette.py --verify   # 只跑配色断言（调色时用）
.\tools\deploy.ps1           # 部署到 profile（PS7 下直接跑；含构建标记 + 校验）
python tools/ensure-bom.py   # 编辑过 .ps1 后补回 UTF-8 BOM（PS 5.1 兼容退路）
.\tools\package.ps1          # 打发行包（ZIP + SHA256SUMS + 包内构建标记）
```

- 配色改动改 `src/palette.js`，跑 `npm test` —— 对比度不达标会直接失败。
  调色时可先用 `tools/solve-palette.py` 迭代（它跑同一组断言，改参数即可重算）。
- `tools/test-client.mjs` 用桩 ctx 跑真实 `client.js`，覆盖注册、两条生效路径、
  明暗分流、设置边界、id 冲突、卸载还原，以及双壳定位/打标/观察器。
  **桩 CSS 直接用真实 `structureStyle()` 产物**（占位串会让「被引用变量解析不出来」
  这类问题在测试里隐身）；桩 DOM 也提供 `getComputedStyle`，壁纸渲染链因此可断言。
- **改 `art/` 相关**：`prepare-art.py` 会顺带产出 `art/wallpapers.json`（每张图的
  尺寸/宽高比/`fit`）。竖图判据来自它 —— 想调整「哪张算竖图」，改生成器里的
  阈值（现为宽高比 < 0.87），不要在插件代码里硬编码图名。
- `tools/deploy.ps1` 做三件事：**先删旧目录再复制**（`Copy-Item -Recurse` 到已存在
  的目录会嵌套出 `art\art\`，导致「部署成功但跑的还是旧文件」）、打构建标记、
  逐文件校验大小。
- 文案内联在 `client.js` 的 `DICT`（zh 为准，en 同 key 集），与同 profile 的参考插件一致。

## 素材来源

`庄方宜素材\`（394 个文件 / 10.8 GB，索引见其中的 `索引.md`），取自
<https://wiki.skland.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=1132>
及官方公开物料。`tools/prepare-art.py` 只读取、不修改源素材。

头像来自 `15-头像/聊天头像.webp`（156×156 透明底官方正脸），由
`prepare-art.py` 做圆形羽化后输出 512×512。

## 授权与数据边界

- 插件代码 MIT；角色形象与美术素材版权归鹰角网络（Hypergryph）所有，仅作个人非商业使用
  —— 完整归属见 [`ASSETS-NOTICE.md`](ASSETS-NOTICE.md)。
- 零遥测、零远程脚本、不读会话库与消息正文 —— 数据边界见 [`PRIVACY.md`](PRIVACY.md)。

