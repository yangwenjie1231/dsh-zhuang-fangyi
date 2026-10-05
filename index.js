/**
 * 庄方宜主题 · Host 半身
 *
 * 职责：
 *   1. 持久化设置（`$DSH_HOME/zhuang-fangyi/settings.json`，临时文件 + rename 原子写）
 *   2. 提供浏览器半边需要的 JSON 与静态资源路由
 *   3. `tapIndex` 在 `</head>` 前内联首帧 token + 壁纸样式，消除启动闪白
 *
 * 关于首帧：外壳的 presenter 会把 token 逐条 `setProperty` 到 body 的行内样式，
 * 但内置 light/dark 主题的 tokens 是**空对象**，所以在浏览器半边跑起来之前，
 * 页面上没有任何主题色 —— 这一帧就是默认蓝白。tapIndex 在服务端渲染阶段就把
 * 与首帧等价的 `<style>` 写进 HTML，用户看不到那一帧。
 *
 * 依赖取舍：`webServer` 走嵌套 `ctx.inject` fiber（参考已验证的插件写法）。
 * 它可能在 apply 时尚未提供（插件先于浏览器半边加载），一次性 `ctx.get` 会拿到
 * undefined 并导致路由永不注册；嵌套 inject 会在服务可用时回调，服务被替换时重跑。
 * 缺它时本插件不半残：配色仍由浏览器半边独立工作。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { PRESET_IDS, PRESETS, buildTokens, overridesFor, themeDefinitions } from './src/palette.js'
import {
  SETTINGS_VERSION,
  BACKGROUNDS,
  defaultSettings,
  normalizeSettings
} from './src/settings.js'

/** 插件标识（Loader 行 id、token 层 source、样式标记共用）。 */
export const name = 'zhuang-fangyi'

/** 无硬依赖；`webServer` 由嵌套 inject 处理。 */
export const inject = []

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ART_DIR = path.join(HERE, 'art')
const DATA_DIR_NAME = 'zhuang-fangyi'
const ROUTE_PREFIX = '/api/zhuang-fangyi'

/**
 * 构建标记。由 `tools/deploy.ps1` 在部署时写入（取源文件 mtime），
 * 用于确认**运行中的宿主进程到底跑的是哪一版代码**。
 *
 * 为什么需要它：宿主进程会缓存 ESM 模块。`plugin_manager` 的
 * disable → enable 只重跑 `apply()`，**不会**重新 `import` 依赖模块
 * （`src/palette.js` 等）。所以改了配色后可能「文件已更新、页面仍是旧色」。
 * 有了这个标记，一次 HTTP 探活就能判断是否需要重启宿主。
 */
const PLUGIN_BUILD = '__ZF_BUILD__'

/** 单文件大小上限（壁纸 12MB、图标 1MB）。 */
const MAX_ART_BYTES = 12 * 1024 * 1024

/** `$DSH_HOME` 优先，其次 `~/.dsh`（与外壳 home-paths 同一解析规则）。 */
function resolveDshHome () {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

/**
 * 极简 JSON 持久化：读损坏时把原文件改名保留，绝不静默覆盖用户数据。
 * 写入走 `临时文件 + rename`，崩溃不会留下半截文件。
 */
class JsonStore {
  constructor (file, fallback, { normalize, log } = {}) {
    this.file = file
    this.fallback = fallback
    this.normalize = normalize
    this.log = log
    this.value = this.#read()
    this.timer = null
  }

  #read () {
    let raw
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') this.log?.(`读取失败：${error?.message ?? error}`)
      return this.normalize ? this.normalize(this.fallback) : this.fallback
    }
    try {
      const parsed = JSON.parse(raw)
      return this.normalize ? this.normalize(parsed) : parsed
    } catch (error) {
      // 保留损坏文件：否则下一次写入会用默认值把它盖掉，用户设置无从恢复。
      try {
        const keep = `${this.file}.corrupt-${Date.now()}`
        fs.copyFileSync(this.file, keep)
        this.log?.(`设置文件损坏，已备份到 ${keep}：${error?.message ?? error}`)
      } catch { /* 无法写入的 home 不是这个文件的问题 */ }
      return this.normalize ? this.normalize(this.fallback) : this.fallback
    }
  }

  get () {
    return this.value
  }

  /** 合并补丁并安排一次合并写入。 */
  update (patch) {
    const next = { ...this.value, ...patch }
    this.value = this.normalize ? this.normalize(next) : next
    this.schedule()
    return this.value
  }

  replace (next) {
    this.value = this.normalize ? this.normalize(next) : next
    this.schedule()
    return this.value
  }

  schedule () {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 250)
    this.timer.unref?.()
  }

  /** 立即落盘（原子写）。 */
  flush () {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`
      fs.writeFileSync(tmp, `${JSON.stringify(this.value, null, 2)}\n`, 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (error) {
      this.log?.(`写入失败：${error?.message ?? error}`)
    }
  }

  dispose () {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.flush()
  }
}

/* ------------------------------------------------------------------ *
 * 静态资源
 * ------------------------------------------------------------------ */

const MIME = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2'
}

/**
 * 白名单：只服务本插件 art/ 下的已知文件，客户端不能任意指定路径。
 * 由 BACKGROUNDS + 固定图标清单派生，避免目录遍历。
 */
function artWhitelist () {
  const out = new Set()
  for (const id of Object.keys(BACKGROUNDS)) {
    const file = BACKGROUNDS[id]
    if (file === null) continue
    out.add(file)
    // 明暗两版：`x.webp` / `x-dark.webp`
    const darkFile = file.replace(/\.webp$/, '-dark.webp')
    out.add(darkFile)
    // 设置页缩略图：`thumbs/x.webp` / `thumbs/x-dark.webp`（prepare-art 产出）
    out.add(`thumbs/${file}`)
    out.add(`thumbs/${darkFile}`)
  }
  out.add('contour.webp')
  out.add('avatar.webp')
  out.add('icon.svg')
  out.add('favicon.svg')
  for (let i = 1; i <= 8; i += 1) out.add(`icons/spot-${i}.svg`)
  return out
}

const ART_WHITELIST = artWhitelist()

/** 读取一个白名单内的 art 文件。 */
function readArt (rel) {
  if (!ART_WHITELIST.has(rel)) return null
  // 双保险：拼出的绝对路径必须仍在 art/ 内
  const abs = path.resolve(ART_DIR, rel)
  if (!abs.startsWith(path.resolve(ART_DIR) + path.sep)) return null
  try {
    const stat = fs.statSync(abs)
    if (!stat.isFile() || stat.size > MAX_ART_BYTES) return null
    return { abs, size: stat.size, mime: MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' }
  } catch {
    return null
  }
}

/**
 * 每张壁纸的尺寸与 `fit`（cover / contain）。
 *
 * 来源是 `art/wallpapers.json` —— 由 `tools/prepare-art.py` 在生成时写出，
 * 里面已按宽高比判好「竖图用 contain」。**不在插件代码里硬编码图名**：
 * 以后加新图，生成器一跑就正确。
 *
 * 读不到清单时返回空对象 —— 客户端回落到 `cover`（旧行为，即竖图裁切），
 * 不会因此坏掉。
 */
let wallpaperMetaCache = null
function wallpaperMeta () {
  if (wallpaperMetaCache !== null) return wallpaperMetaCache
  try {
    const raw = fs.readFileSync(path.join(ART_DIR, 'wallpapers.json'), 'utf8')
    const parsed = JSON.parse(raw)
    wallpaperMetaCache = parsed?.wallpapers ?? {}
  } catch {
    wallpaperMetaCache = {}
  }
  return wallpaperMetaCache
}

/* ------------------------------------------------------------------ *
 * 首帧样式
 * ------------------------------------------------------------------ */

/**
 * 转义用于 `<style>` 的文本。
 *
 * 值本身全部来自固定表（预设色值 / 白名单文件名），没有用户输入；这里仍是
 * 一层廉价的纵深防御：万一将来把用户数据拼进来，`</style>` 不会提前闭合标签。
 */
function cssText (value) {
  return String(value).replace(/<\/style/gi, '<\\/style')
}

/**
 * 静态样式骨架（**CSS 结构的唯一来源**）。
 *
 * 分两块，职责不同：
 *
 *   · `tokenStyle(settings)` —— 预设 token 表。只在首帧需要：浏览器半边跑起来后
 *     会用 `overrideTokens`（跟随系统）或 `setTheme`（固定明暗）接管，此时它会
 *     把 `<style id="zf-boot-tokens">` 移除，避免两个来源同时存在。
 *
 *   · `structureStyle()` —— 壁纸与装饰的**结构**，全程常驻。它把所有随设置变化的
 *     量都写成自定义属性并给默认值，浏览器半边只改属性、不重建 CSS。
 *     这样 CSS 只有一份，客户端不会与宿主产生分叉。
 *
 * @param {object} settings - 归一化后的设置
 * @returns {string} `<style>` 标签；关闭时返回空串
 */
export function bootStyle (settings) {  if (!settings.enabled) return ''
  return cssText([tokenStyle(settings), structureStyle()].join('\n'))
}

/** 预设 token 表（首帧用；浏览器半边接管后移除）。 */
export function tokenStyle (settings) {
  // 首帧也要尊重 accentHue，否则启动瞬间的强调色与随后接管的不一致（会闪一下）
  const { light, dark } = buildTokens(settings.preset, settings.accentHue)
  const decl = (table, indent) =>
    Object.entries(table)
      .map(([k, v]) => `${indent}${k}:${v};`)
      .join('\n')
  return [
    '<style id="zf-boot-tokens">',
    '/* 庄方宜主题 · 首帧 token（浏览器半边接管后移除本标签） */',
    'body{',
    decl(light, '  '),
    '}',
    'body[data-ds-dark-theme]{',
    decl(dark, '  '),
    '}',
    '</style>'
  ].join('\n')
}

/**
 * 壁纸与装饰的结构样式。所有可变项都是自定义属性，客户端只写属性值。
 *
 * ── 为什么不用「降低 token 的 alpha」这个做法 ──────────────────────────
 *
 * 最初的实现是给 `--dsw-alias-bg-base` 套 alpha 让外壳透出壁纸。实测**无效**：
 * 外壳 presenter 会把快照里全部 token 逐条 `setProperty` 到 body 的**行内样式**，
 * 行内优先级高于任何样式表规则，所以我在样式表里写的半透明值被它的不透明值
 * 覆盖 —— 结果就是「只改了配色，壁纸完全看不见」。
 *
 * 正确做法：**不去动 token**，而是把外壳那几层不透明的背景改成半透明。
 * 半透明色由客户端算好（它知道当前预设的底色），写成 `--zf-veil*`，
 * 这些是外壳不认识的新变量，presenter 不会碰它们。可读性由这层「纱」保证：
 * 壁纸在最底层，纱覆盖其上，正文再压在纱上。
 *
 * 选择器说明 —— **两套壳，必须同时兼容**（实测确认，不是猜测）：
 *
 *   桌面端（本机实际运行）  0.2.0-rc.2，类名 `BynINW_*`，右栏叫 `rightbarCol`
 *   Web 端                  0.1.0-rc.7，类名 `pI_x6G_*`，右栏叫 `detailsCol`
 *
 * 所以：
 *   · 每处都写 `[class*="_xxxCol"]` 的**语义后缀**匹配（两套壳都命中）；
 *   · 右栏同时写 `_rightbarCol` 与 `_detailsCol`（只写一个必漏一半）；
 *   · 客户端用 `data-plugin-css` 反查真实哈希并打上 `data-zf-*`，
 *     样式表同时认这些自有属性 —— 首帧靠后缀匹配，之后靠打标，双保险。
 *
 * ── 这张样式表由谁注入（重要，踩过坑）──────────────────────────────────
 *
 * 宿主把本函数的产物同时用于两处：
 *   1. `bootStyle()` → `tapIndex`，**只在 Web 端有效**；
 *   2. `/api/zhuang-fangyi/style.css` → 浏览器半边**自己插 `<style>`**。
 *
 * 为什么必须两条路都走：桌面端的渲染进程**不经过 Host 的 HTTP 服务** ——
 * `app.asar` 的 `dsh-app://` 协议处理器直接从磁盘读
 * `@deepseek-ai/dsh-web-frontend/dist/index.html`，只额外注入一个
 * `__DSH_BOOT_READY__` 脚本。所以 `tapIndex` 在桌面端**从来不会执行**，
 * 靠它注入的 CSS 一个字都不会出现（壁纸、顶栏、右栏全部失效）。
 *
 * 这也解释了最初「只改了配色」的反馈：不是壁纸被纱遮住了，是壁纸的 CSS
 * 压根不存在 —— 而 token 是由浏览器半边 `overrideTokens` 独立生效的，
 * 所以只有配色变了。
 */
/**
 * 皮肤结构的**纯 CSS**（不含 `<style>` 标签）。
 *
 * ── 为什么必须区分「纯 CSS」与「带标签」两种形态（实测踩过，代价很大）──
 *
 * 客户端通过 `/style.css` 取回内容后是这样用的：
 *
 *     el.textContent = css      // el 是客户端自己建的 <style id="zf-style">
 *
 * 如果这里返回的字符串**自带 `<style id="zf-boot-css">` 与 `</style>`**，
 * 浏览器就要把 `<style id=...>` 当成 CSS 解析 —— 这是非法起始 token，
 * 解析器进入错误恢复，**紧随其后的 `html{...}` 规则块会被整块丢掉**。
 *
 * 后果极具迷惑性（实测全部命中）：
 *   · `--zf-veil` 仍正常 —— 它是 JS 行内写的字面 rgba，不依赖样式表；
 *   · `--zf-art-src` 计算值为空 —— 行内写的是 `var(--zf-art-<id>)`，
 *     而被引用变量定义在**被丢掉的那个 `html{}` 块**里 → 整条属性失效；
 *   · `.zf-rail` 等规则正常 —— 它们在文件后半段，错误恢复后能照常解析。
 *   → 表现就是「观测栏有样式，但壁纸怎么都出不来」。
 *
 * 所以：`/style.css` 发**纯 CSS**；`tapIndex` 那条路才用带标签的
 * `structureStyle()`（它插进 HTML 需要标签）。
 */
export function structureCss () {
  const artVars = []
  for (const [id, file] of Object.entries(BACKGROUNDS)) {
    if (file === null) continue
    const dark = file.endsWith('.webp') ? `${file.slice(0, -'.webp'.length)}-dark.webp` : file
    const url = name => `url("${ROUTE_PREFIX}/art/${encodeURIComponent(name)}")`
    artVars.push(`  --zf-art-${id}:${url(file)};`)
    artVars.push(`  --zf-art-${id}-dark:${url(dark)};`)
  }

  // 模糊层：只对壁纸本身模糊。
  //
  // 不能放在 html 的 ::after 上用 backdrop-filter —— 那会把它**下面所有内容**
  // 一起模糊（包括正文），因为它是覆盖全屏的独立层。正确做法是把模糊作用在
  // 壁纸那一层：用一张只含壁纸的伪元素，对它自身 filter:blur()。
  return [
    '/* 庄方宜主题 · 皮肤结构（客户端只改自定义属性） */',
    'html{',
    '  --zf-art-src:none;',
    '  --zf-art-size:cover;',
    '  --zf-art-position:center;',
    '  --zf-art-repeat:no-repeat;',
    // 垫底层（竖图用）：`none` 时不画，横图零开销
    '  --zf-art-backdrop:none;',
    '  --zf-backdrop-lum:0.62;',
    '  --zf-blur:0px;',
    // 模糊会糊掉四边，轻微放大避免露出底色边
    '  --zf-art-scale:1;',
    // 纱：半透明主题底色，覆盖在壁纸之上、正文之下。客户端按当前预设与明暗算好。
    '  --zf-veil:transparent;',
    '  --zf-veil-sidebar:transparent;',
    // 头像图（客户端也可覆盖）。助手消息头像与顶栏/右栏共用这一张。
    '  --zf-avatar-image:none;',
    // 顶栏高度：Windows 上并入系统标题栏带（不额外占高度），其它平台自行占位。
    '  --zf-rail-width:288px;',
    ...artVars,
    '}',
    // 壁纸画在 html 的 ::before 上（这样能单独对它做模糊，不影响内容）。
    //
    // 层级要注意：负 z-index 的元素会跑到**最近的层叠上下文**的背景之上、
    // 内容之下。html 是根层叠上下文，所以 z-index:-1 正好落在「html 背景之上、
    // body 及其后代之下」—— 这正是我们要的位置（body 已透明）。
    // 同时给 html 一个不透明背景色兜底，避免壁纸没加载时露白。
    'html[data-zf-wallpaper]{ background-color:var(--zf-veil,Canvas); }',
    /* ── 模糊垫底层（竖图专用，`fit=contain` 时才出现）────────────────────
     *
     * 问题：竖图（1080×1920，宽高比 0.56）用 `cover` 铺横屏，只能看到中间
     * 约 40% 的高度 —— 人物被裁成一条、脸被放大 1.24 倍（实测）。
     *
     * 方案：前景层改用 `contain` 完整显示整张竖图（不裁人），两侧留出的
     * 空隙由这一层填 —— 同一张图 `cover` 铺满 + 重模糊 + 压暗，
     * 形成「磨砂延伸」而不是生硬的纯色边。
     *
     * 层级：`::after` 用 z-index:-2，落在 `::before`（-1）**更下面**，
     * 所以前景永远盖在垫底之上。两者都在 html 根层叠上下文里，
     * 仍位于 body 内容之下。
     */
    'html[data-zf-wallpaper]::after{',
    '  content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;',
    '  background-image:var(--zf-art-backdrop,none);',
    '  background-size:cover;background-position:center;background-repeat:no-repeat;',
    // 重模糊 + 压暗：只做气氛，不抢前景；brightness 让深色主题下不过亮
    '  filter:blur(64px) saturate(1.15) brightness(var(--zf-backdrop-lum,0.62));',
    // 放大 1.15 避免 blur 在四边露白
    '  transform:scale(1.15);',
    '}',
    'html[data-zf-wallpaper]::before{',
    '  content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;',
    '  background-image:var(--zf-art-src);',
    '  background-size:var(--zf-art-size);',
    '  background-position:var(--zf-art-position);',
    '  background-repeat:var(--zf-art-repeat);',
    // 模糊会糊掉边缘，放大一点点避免露出白边
    '  filter:blur(var(--zf-blur));',
    '  transform:scale(var(--zf-art-scale,1));',
    '}',
    /* 竖图（contain）时前景的取景：`center 22%` 让头部/上半身落在可视区，
     * 而不是正中被裁。仅当 `--zf-art-fit` 为 contain 时由客户端写这个值。 */
    'html[data-zf-wallpaper][data-zf-art-fit="contain"]::before{',
    '  background-position:var(--zf-art-position,center 22%);',
    '}',
    // ── 纱的层次（这里最容易做错，值得说清）────────────────────────────
    //
    // 外壳的实际结构是嵌套的，每层都有自己的不透明背景：
    //     body
    //       └ #root > …frame…              background: --dsw-alias-bg-base
    //           ├ …sidebarCol…             background: --dsw-specific-sidebar-fill
    //           ├ …centerCol…              （无背景，透出 frame 的）
    //           └ …rightbarCol…            （无背景，透出 frame 的）
    //
    // 若给每层都套 alpha，壁纸可见度会**连乘**：两层各 0.83 就只剩 0.69。
    // 实测「壁纸设了却完全看不见」正是这个原因（两层相乘后只剩 3%）。
    //
    // 正确做法：外层（body / #root / frame）全部透明，**只让三个列各带一层纱**。
    // 三列铺满整个 frame，不会露底，且每处壁纸可见度都等于同一个 (1-alpha)。
    'body[data-zf-wallpaper]{ background-color:transparent !important; }',
    'body[data-zf-wallpaper] #root,',
    'body[data-zf-wallpaper] #root > *,',
    'body[data-zf-wallpaper] [data-zf-frame],',
    'body[data-zf-wallpaper] [class*="_frame"]{ background:transparent !important; }',
    // 中栏**内容**层：`ConversationRoot` 的根元素自己铺了不透明 `bg-base`
    // （`.Dc7zOa_root{background:var(--dsw-alias-bg-base)}`），会整个盖住壁纸。
    // 实测：中栏 153 个采样点唯一色数 = 1（纯色），就是被它挡的。
    //
    // **只认客户端打的精确锚点**，不要写 `[class*="_root"]` 这类模糊兜底 ——
    // `data-phase` 是通用属性（对话根 / 输入编辑器 / 重连指示器都在用），
    // 配合 `_root` 后缀会误伤一大片元素（实测把侧栏整个刷透明了）。
    'body[data-zf-wallpaper] [data-zf-content],',
    'body[data-zf-wallpaper] [data-zf-scroll]{ background:transparent !important; }',
    'body[data-zf-wallpaper] [data-zf-sidebar],',
    'body[data-zf-wallpaper] [class*="_sidebarCol"]{',
    '  background:var(--zf-veil-sidebar) !important;',
    '}',
    // 右栏两套壳名字不同：桌面 `rightbarCol`、Web `detailsCol`。都要写。
    'body[data-zf-wallpaper] [data-zf-center],',
    'body[data-zf-wallpaper] [data-zf-rightbar],',
    'body[data-zf-wallpaper] [class*="_centerCol"],',
    'body[data-zf-wallpaper] [class*="_rightbarCol"],',
    'body[data-zf-wallpaper] [class*="_detailsCol"]{',
    '  background:var(--zf-veil) !important;',
    '}',
    // Windows 标题栏拖拽区（frame 的 ::before，40px 高）也带一层纱，
    // 否则那一条会是全透明，与下面的侧栏/中栏不一致。
    'body[data-zf-wallpaper]:not([data-zf-opaque-titlebar]) [data-zf-frame]::before,',
    'body[data-zf-wallpaper]:not([data-zf-opaque-titlebar]) [class*="_frame"]::before{',
    '  background:var(--zf-veil-sidebar) !important;',
    '}',
    // macOS 侧栏在外壳里是 background:0 0 + vibrancy，纱已足够
    'html[data-platform=darwin] body[data-zf-wallpaper] [class*="sidebarCol"]{',
    '  background:var(--zf-veil-sidebar) !important;',
    '}',
    // 焦点环：外壳未定义 --dsw-alias-focus-ring-color，由本插件补上
    'body[data-zf-glow] :focus-visible{',
    '  outline:2px solid var(--dsw-alias-focus-ring-color);',
    '  outline-offset:2px;',
    '  box-shadow:0 0 0 6px color-mix(in srgb, var(--dsw-alias-focus-ring-color) 18%, transparent);',
    '}',
    // 等高线细边框：把侧栏右分割线换成主题色
    'body[data-zf-contour] [data-zf-sidebar],',
    'body[data-zf-contour] [class*="sidebarCol"]{',
    '  border-right-color:color-mix(in srgb, var(--dsw-alias-focus-ring-color) 30%, transparent) !important;',
    '}',

    /* ══════════════════════════════════════════════════════════════════
     * 右侧观测栏（顶栏已移除，见下）
     *
     * 挂在 `shell.overlay` 插槽里 —— 外壳原生渲染的浮动层：
     *   `.BynINW_overlayLayer{ z-index:20; pointer-events:none;
     *                          position:absolute; inset:0 }`
     * 子元素自动恢复 `pointer-events`。不硬贴 DOM 的原因：overlay 由 React
     * 管理，重渲染不会掉，也不与其它插件抢位置。
     *
     * ── 用 `position:fixed`（视口坐标），而不是 absolute ────────────────
     *
     * `overlayLayer` 的 `inset:0` 给出一个覆盖全屏的包含块。用 absolute 时
     * 元素相对它定位，虽然结果通常相同，但有两点不确定性：
     *
     *   1. overlay 是 grid 容器（`.frame{display:grid}`）的子元素，而三个列
     *      与它都没写 `grid-area`，**依赖自动放置**。我一度据此推断它会被挤到
     *      隐式第二行 —— 后来用 `getBoundingClientRect` 实测，overlay 就在
     *      `{x:0, y:0}`，**那个推断是错的**（截图量像素得出的结论不可靠）。
     *   2. `[data-windows-titlebar] .frame{ padding-top:40px }` 会让 absolute
     *      的坐标基准随壳版本变化。
     *
     * 用 `fixed` 相对**视口**定位，绕开这两个不确定性；代价是 frame 的
     * `padding-top` 对它无效，Windows 下要自己让开标题栏（见下面的规则）。
     * 这是「用确定的坐标基准换一点手工补偿」，比依赖 grid 自动放置的结果可靠。
     *
     * **教训**：位置问题要用 `getBoundingClientRect` 实测（`/diag` 的 `geom`
     * 字段就是为此加的），不要靠截图量像素反推 —— 我靠截图推断过一次，错了。
     *
     * ── 顶栏已按用户要求整体移除 ────────────────────────────────────────
     *
     * 原先另有 `.zf-topbar`（庄方宜头像 + 品牌名 + 预设·状态），已整体删除。
     * 用户反馈两个问题，都成立：
     *   · 它 `position:fixed` 浮在中栏上方，**压住了会话标题那一行**（截图可见
     *     标题被切掉半边）；
     *   · 内容全是冗余 —— 头像在侧栏品牌位与助手消息旁都有，预设与会话状态
     *     在右栏观测台里都有。
     *
     * 所以顶栏的组件、插槽注册与 CSS 全部删除，观测栏直接顶到最上边。
     * ══════════════════════════════════════════════════════════════════ */
    '.zf-rail{',
    // 顶栏已移除 → 直接顶到最上边（`top:0` 相对视口）
    '  position:fixed;top:0;bottom:0;right:0;',
    '  width:var(--zf-rail-width);box-sizing:border-box;',
    '  display:flex;flex-direction:column;gap:14px;padding:16px 14px;overflow-y:auto;',
    '  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 82%, transparent);',
    '  border-left:1px solid var(--dsw-alias-border-l2);',
    '  backdrop-filter:blur(10px);',
    '  font-size:12px;color:var(--dsw-alias-label-primary);',
    '  z-index:11;',
    '}',
    // fixed 定位不吃 frame 的 padding-top，Windows 下要自己让开原生标题栏
    'html[data-windows-titlebar] .zf-rail{',
    '  top:var(--dsh-windows-titlebar-height, 40px);',
    '}',
    'body[data-zf-rail="off"] .zf-rail{ display:none; }',
    // 中栏让位：只在本插件右栏可见时加内边距，否则会白白留一条空白。
    // **只在浮层路径生效** —— 走官方 tab 时容器由外壳提供，中栏已经让过位了，
    // 再加内边距会重复挤压。`tabRegistered` 时浮层不渲染，这条也就无害。
    'body[data-zf-rail="on"] [data-zf-center]{ padding-right:var(--zf-rail-width); }',

    /* ── 观测栏内部结构 ─────────────────────────────────────────────── */
    //
    // `.zf-rail__body` 是**内容容器**，两个容器共用：
    //   · 官方 tab（`sidebar.right.pane.tab`）：外壳给了面板背景/边框/滚动，
    //     所以这里只负责内部排版，**不能有定位、背景、边框**；
    //   · 浮层 `.zf-rail`：它自己带 `position:fixed` 与面板背景。
    '.zf-rail__body{',
    '  display:flex;flex-direction:column;gap:14px;',
    '  min-width:0;font-size:12px;color:var(--dsw-alias-label-primary);',
    '}',
    '.zf-rail__head{ display:flex;align-items:center;gap:9px; }',
    // `corner-shape:round` 必须写：外壳全局把 `*`/`::before`/`::after` 设成了
    // 超椭圆圆角（`corner-shape: var(--dsw-corner-shape)` = superellipse(1.5)），
    // 它会把 `border-radius:50%` 渲染成圆角方形而不是正圆。
    '.zf-rail__avatar{ width:32px;height:32px;flex:0 0 auto;object-fit:cover;border-radius:50% !important;corner-shape:round !important; }',
    '.zf-rail__title{ font-weight:600;font-size:13px; }',
    '.zf-rail__caption{ color:var(--dsw-alias-label-tertiary);font-size:11px; }',
    '.zf-rail__group{ display:flex;flex-direction:column;gap:7px; }',
    '.zf-rail__label{',
    '  color:var(--dsw-alias-label-tertiary);font-size:10px;',
    '  letter-spacing:.14em;text-transform:uppercase;',
    '}',
    '.zf-rail__row{ display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px; }',
    '.zf-rail__value{',
    '  font-family:Consolas,"Cascadia Mono",monospace;font-size:12px;',
    '  color:var(--dsw-alias-brand-primary);font-weight:600;',
    '}',
    // auto-fit：观测栏 240~380px 都能排（2~3 列自适应），6 张卡不溢出
    '.zf-rail__stats{ display:grid;grid-template-columns:repeat(auto-fit,minmax(76px,1fr));gap:8px; }',
    '.zf-rail__stat{',
    '  display:flex;flex-direction:column;gap:3px;padding:9px 8px;border-radius:9px;',
    '  background:var(--dsw-alias-bg-layer-2);',
    '  border:1px solid var(--dsw-alias-border-l1);min-width:0;',
    '}',
    '.zf-rail__stat b{',
    '  font-family:Consolas,"Cascadia Mono",monospace;font-size:15px;font-weight:600;',
    '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
    '}',
    '.zf-rail__stat span{ color:var(--dsw-alias-label-tertiary);font-size:10px; }',
    // 状态点：颜色随会话状态变（客户端写 data-zf-session-state）
    '.zf-rail__dot{',
    '  width:7px;height:7px;border-radius:50%;flex:0 0 auto;',
    '  background:var(--dsw-alias-state-idle-primary);',
    '}',
    '[data-zf-session-state="running"] .zf-rail__dot{ background:var(--dsw-alias-brand-primary); }',
    '[data-zf-session-state="tool"] .zf-rail__dot{ background:var(--dsw-alias-state-warn-primary); }',
    '[data-zf-session-state="error"] .zf-rail__dot{ background:var(--dsw-alias-state-error-primary); }',
    '[data-zf-session-state="done"] .zf-rail__dot{ background:var(--dsw-alias-state-success-primary); }',
    '[data-zf-session-state="stopped"] .zf-rail__dot{ background:var(--dsw-alias-state-warn-primary); }',
    '.zf-rail__swatches{ display:flex;flex-direction:column;gap:6px; }',
    '.zf-rail__swatch{',
    '  width:100%;height:28px;border-radius:7px;cursor:pointer;padding:0 9px;box-sizing:border-box;',
    '  display:inline-flex;align-items:center;justify-content:space-between;gap:6px;',
    '  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);',
    '  color:var(--dsw-alias-label-secondary);font-size:11px;',
    '}',
    '.zf-rail__swatch:hover{ border-color:var(--dsw-alias-border-l4);color:var(--dsw-alias-label-primary); }',
    '.zf-rail__swatch[aria-pressed="true"]{',
    '  border-color:var(--dsw-alias-brand-primary);',
    '  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-2));',
    '  color:var(--dsw-alias-label-primary);',
    '}',
    '.zf-rail__chip{ width:11px;height:11px;border-radius:3px;flex:0 0 auto; }',

    /* ══════════════════════════════════════════════════════════════════
     * 助手头像（气泡重绘在下面单独一段）
     *
     * 头像用 CSS `::before` 打在 `[data-chat-flow-kind="assistant-step"]` 上 ——
     * 这是**语义锚点**（桌面壳 456 个 data-* 之一），比类名稳。
     *
     * ── 关键是「不要干预折叠」（实测踩过，用户截图反馈空白）────────────
     *
     * 聊天区是**虚拟化列表**，外壳自己有一条折叠规则：
     *
     *   [class*="_flowItem"]:is(:empty,
     *     :has(>[data-slot="conversation.chat.node"]:empty)){ height:0 }
     *
     * 注意它是**两个条件**：行本身空 **或** 它的 slot 子节点空。过程块
     * （工具调用、推理）折叠后正是第二种 —— 行还在，但子节点空了。
     *
     * 我最初写 `min-height:48px; padding:22px 0 2px 58px`，用 `min-height`
     * 强行撑开了本该 `height:0` 的行 → 折叠后留下一大片空白；虚拟化列表的
     * 高度估算也会因此失准。
     *
     * 正确做法：**用与外壳相同的折叠条件取反**，只在「真的没折叠」时才
     * 加左侧占位。这样我的规则与外壳的折叠语义严格互补，不可能打架。
     *
     * 另外**不加 `min-height`**：行高由内容决定，我只在一旁放头像。
     * ══════════════════════════════════════════════════════════════════ */
    // 「未折叠」= 非空 且 slot 子节点非空 —— 与外壳的折叠条件严格取反
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:not(:empty):not(:has(>[data-slot="conversation.chat.node"]:empty)){',
    '  position:relative;padding-left:44px;',
    '}',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:not(:empty):not(:has(>[data-slot="conversation.chat.node"]:empty))::before{',
    '  content:"";position:absolute;top:2px;left:0;width:28px;height:28px;',
    // 去掉边框：用户反馈头像外面那圈黄绿描边难看（截图确认）。
    //
    // `corner-shape:round` 是**必须的**：外壳有一条全局规则
    //   @supports (corner-shape:superellipse(1.5)){
    //     *, :before, :after{ corner-shape: var(--dsw-corner-shape) }
    //   }
    // 把**所有元素与伪元素**都设成了超椭圆圆角。它会把 `border-radius:50%`
    // 渲染成「圆角方形」（squircle）而不是正圆 —— 用户截图里那个方圆角就是它。
    '  box-sizing:border-box;border:0;',
    '  border-radius:50% !important;corner-shape:round !important;',
    '  background-image:var(--zf-avatar-image);',
    '  background-position:center;background-size:cover;',
    '  pointer-events:none;',
    '}',
    // 折叠行 / 空行：完全不加任何占位，交给外壳的 height:0
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:empty,',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:has(>[data-slot="conversation.chat.node"]:empty){',
    '  padding-left:0;min-height:0;',
    '}',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:empty::before,',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:has(>[data-slot="conversation.chat.node"]:empty)::before{',
    '  content:none;display:none;',
    '}',
    // 用户气泡：细边框 + 圆角，去阴影
    'body[data-zf-avatar] [data-chat-flow-kind="user"] [data-zf-bubble],',
    'body[data-zf-avatar] [data-chat-flow-kind="steering"] [data-zf-bubble]{',
    '  border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:none;',
    '}',
    // 输入框：圆角 + 柔和投影
    'body[data-zf-avatar] [data-composer-card]{',
    '  border-radius:14px;',
    '  box-shadow:0 8px 26px color-mix(in srgb, var(--dsw-alias-bg-base) 26%, transparent);',
    '}',
    'body[data-zf-avatar] [data-composer-seat]{ padding-bottom:14px; }',
    // 窄屏降级
    '@media (max-width:520px){',
    '  body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:not(:empty):not(:has(>[data-slot="conversation.chat.node"]:empty)){ padding-left:34px; }',
    '  body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:not(:empty):not(:has(>[data-slot="conversation.chat.node"]:empty))::before{ width:22px;height:22px; }',
    '}',
    // 视口过窄时藏掉右栏，避免挤压中栏
    '@media (max-width:1180px){ .zf-rail{ display:none; } }',
    // 尊重系统的减弱动效（自动）
    '@media (prefers-reduced-motion:reduce){',
    '  .zf-rail{ transition:none; }',
    '}',
    // 静止模式（显式开关，对标 Mornye 的「静止模式」）：
    // 只关本插件自己声明的过渡，不去全局 * { transition:none } ——
    // 那会连外壳的动画一起干掉，属于越权。
    'body[data-zf-motion="reduced"] .zf-rail,',
    'body[data-zf-motion="reduced"] .zf-rail *,',
    'body[data-zf-motion="reduced"] .zf-nav *,',
    'body[data-zf-motion="reduced"] [data-zf-wallpaper]{',
    '  transition:none !important;',
    '  animation:none !important;',
    '}'
  ].join('\n')
}

/**
 * 供 `tapIndex` 注入的**带标签**形态（Web 端首帧用）。
 *
 * 桌面端永远不执行 `tapIndex`，所以这个形态只在 Web 端出现；桌面端走
 * `/style.css` + 客户端自插 —— 那条路必须用**纯 CSS**（见 `structureCss`）。
 */
export function structureStyle () {
  return `<style id="zf-boot-css">\n${structureCss()}\n</style>`
}
/* ------------------------------------------------------------------ *
 * 插件主体
 * ------------------------------------------------------------------ */

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 */
export function apply (ctx, config) {
  const logger = ctx.logger ?? console
  const home = resolveDshHome()
  const dataDir = path.join(home, DATA_DIR_NAME)

  let settings
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    settings = new JsonStore(path.join(dataDir, 'settings.json'), defaultSettings(), {
      normalize: normalizeSettings,
      log: message => logger.warn?.(`zhuang-fangyi: ${message}`)
    })
  } catch (error) {
    logger.warn?.(`zhuang-fangyi: 无法建立设置目录，改用内存默认值（${error?.message ?? error}）`)
    settings = new JsonStore(path.join(os.tmpdir(), 'zhuang-fangyi-settings.json'), defaultSettings(), {
      normalize: normalizeSettings
    })
  }

  ctx.effect(() => () => settings.dispose(), 'zhuang-fangyi: settings store')

  /**
   * 客户端自检上报的存放处（仅内存，不落盘）。
   *
   * 浏览器半边是否加载、插槽是否注册、样式表是否注入，宿主侧看不到 ——
   * 只能靠客户端主动上报。`GET /diag` 读取它。
   */
  const diag = { last: null }

  /* ---------------- 路由 ---------------- */

  const sendJson = (res, code, body) => {
    const text = JSON.stringify(body)
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(text)
    })
    res.end(text)
  }

  const readBody = req =>
    new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', chunk => {
        size += chunk.length
        if (size > 64 * 1024) {
          reject(new Error('请求体过大'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })

  /** `/api/zhuang-fangyi/*` 统一入口。 */
  async function api (req, res) {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      sendJson(res, 400, { error: 'bad url' })
      return
    }
    const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'

    try {
      if (route === '/settings') {
        if (req.method === 'GET') {
          sendJson(res, 200, { settings: settings.get(), presets: PRESET_IDS })
          return
        }
        if (req.method === 'POST' || req.method === 'PUT') {
          const raw = await readBody(req)
          let parsed
          try {
            parsed = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { error: 'invalid json' })
            return
          }
          // `{"reset": true}` = 恢复默认（设置页「恢复默认」按钮）。
          // 显式走 `defaultSettings()` 而不是靠「未知键被 normalize 忽略」的副作用，
          // 语义要写在脸上。
          const next = parsed?.reset === true
            ? settings.replace(defaultSettings())
            : settings.replace(parsed?.settings ?? parsed)
          settings.flush()
          sendJson(res, 200, { settings: next })
          return
        }
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }

      if (route === '/themes') {
        // 浏览器半边据此注册「外观」下拉里的主题，并用 roles 算壁纸的「纱」色。
        //
        // `accentHue` 必须在这里生效：主题的 token 表是**宿主算好下发**的
        // （客户端不 import palette.js），所以强调色色相覆盖要在这里算进去。
        // 客户端改 accentHue 后会重新拉这个接口并**重注册**主题。
        const accentHue = settings.get()?.accentHue
        sendJson(res, 200, {
          // 探活标记：宿主进程会缓存 ESM 模块，这个字段能一眼看出
          // 跑的是不是最新代码（`plugin_manager` 重载不一定能刷新依赖模块）。
          build: PLUGIN_BUILD,
          accentHue,
          themes: themeDefinitions(accentHue),
          presets: PRESET_IDS,
          overrides: Object.fromEntries(PRESET_IDS.map(id => [id, overridesFor(id, accentHue)])),
          roles: Object.fromEntries(PRESET_IDS.map(id => [id, PRESETS[id].light !== undefined
            ? { light: PRESETS[id].light, dark: PRESETS[id].dark }
            : null])),
          // 每张壁纸的尺寸与「该 cover 还是 contain」（由 prepare-art.py 产出）。
          // 竖图必须 contain，否则横屏下只看到中间 40% 的高度。
          wallpaperMeta: wallpaperMeta()
        })
        return
      }

      if (route === '/style.css') {
        // 皮肤结构样式表，供浏览器半边**自己插 `<style>`**。
        //
        // 桌面端的渲染进程直接从磁盘读 index.html（`dsh-app://` 协议），
        // 不经过 Host 的 HTTP 服务，所以 `tapIndex` 在桌面端永远不执行 ——
        // 必须让客户端自己取这份 CSS，否则壁纸/观测台全都不会出现。
        //
        // **必须发纯 CSS**：客户端是 `el.textContent = css`，带上 `<style>`
        // 标签会让浏览器把标签当 CSS 解析，紧跟的 `html{}` 块被整块丢弃，
        // `--zf-art-*` 全部失效 → 壁纸出不来（实测踩过，见 `structureCss` 注释）。
        const css = structureCss()
        const body = Buffer.from(css, 'utf8')
        res.writeHead(200, {
          'content-type': 'text/css; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': body.length
        })
        res.end(body)
        return
      }

      // 客户端自检上报。
      //
      // 为什么需要：浏览器半边是否真的加载、插槽是否真的注册、样式表是否真的
      // 注入，这些在宿主侧完全看不到 —— 只能靠客户端主动上报。
      // `GET /api/zhuang-fangyi/diag` 返回最近一次上报，用于诊断「插件没生效」。
      //
      // 注意 `dsh-client-modules` 会按包名缓存「是不是客户端包」的判定且
      // **永不过期**，所以插件集合变化必须重启 DSH；这个上报能立刻区分
      // 「代码有问题」和「浏览器半边压根没加载」。
      if (route === '/diag') {
        if (req.method === 'POST') {
          const raw = await readBody(req)
          try {
            diag.last = { ...JSON.parse(raw), at: new Date().toISOString() }
          } catch {
            diag.last = { error: 'invalid json', raw: raw.slice(0, 200), at: new Date().toISOString() }
          }
          sendJson(res, 200, { ok: true })
          return
        }
        sendJson(res, 200, {
          build: PLUGIN_BUILD,
          reported: diag.last,
          note: diag.last === null
            ? '浏览器半边从未上报 —— 说明它没有被加载（检查 dsh.client 声明与插件是否启用）'
            : '最近一次客户端自检'
        })
        return
      }

      if (route.startsWith('/art/')) {
        const rel = decodeURIComponent(route.slice('/art/'.length))
        const hit = readArt(rel)
        if (hit === null) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('not found')
          return
        }
        // 长缓存：文件名随内容变化，客户端无需重复拉取
        res.writeHead(200, {
          'content-type': hit.mime,
          'content-length': hit.size,
          'cache-control': 'public, max-age=604800, immutable'
        })
        fs.createReadStream(hit.abs).pipe(res)
        return
      }

      sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      logger.warn?.(`zhuang-fangyi: 路由失败（${error?.message ?? error}）`)
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
      else res.end()
    }
  }

  /* ---------------- 首帧注入 ---------------- */

  function tap (html) {
    const tag = bootStyle(settings.get())
    if (tag === '') return html
    // 插在 </head> 之前：晚于外壳的 <link rel=stylesheet>，同优先级下后者胜出
    const at = html.lastIndexOf('</head>')
    if (at < 0) return html.replace(/<body/i, `${tag}<body`)
    return `${html.slice(0, at)}${tag}\n${html.slice(at)}`
  }

  ctx.inject(['webServer'], scoped => {
    const server = scoped.webServer
    scoped.effect(
      () => server.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: api }),
      'zhuang-fangyi: api routes'
    )
    scoped.effect(
      () => server.tapIndex(tap),
      'zhuang-fangyi: first-paint tokens'
    )
    logger.info?.('zhuang-fangyi: 路由已挂载于 ' + ROUTE_PREFIX)
  })
}

export { SETTINGS_VERSION }
