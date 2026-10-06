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

import { PRESET_IDS, PRESETS, PRESET_STYLES, buildTokens, codeTokens, overridesFor, themeDefinitions } from './src/palette.js'
import { fontCss } from './src/fonts.js'
import {
  SETTINGS_VERSION,
  BACKGROUNDS,
  defaultSettings,
  normalizeSettings
} from './src/settings.js'

/** 插件标识（Loader 行 id、token 层 source、样式标记共用）。 */
export const name = 'zhuang-fangyi'

/**
 * 客户端要的原始色阶：`roles[preset][scheme]`（它据此算壁纸的「纱」色、画预设色板）。
 *
 * B9：把**代码高亮的 token 色**并进同一份色阶里（键 `shiki`）—— 客户端本来就
 * 在同一个对象上读 `base`/`sidebar`，顺手就能读到，不必改 `applyStyleVars`
 * 的签名（它有 4 个调用点）。
 *
 * ⚠️ 键名**不能叫 `code`**：色阶里本来就有 `code`（代码块**底色**，见
 * `markdown-code-block`）—— 实测撞过一次，会把底色覆盖成 token 表。
 *
 * ⚠️ 必须 `{ ...r.light }` **展开复制**：`PRESETS[id].light` 是模块级共享对象，
 * 直接往它上面挂键会污染同进程里的其它消费者。测试盯着这一点。
 */
export function rolesPayload (accentHue) {
  return Object.fromEntries(PRESET_IDS.map(id => {
    const r = PRESETS[id]
    if (r.light === undefined) return [id, null]
    return [id, {
      light: { ...r.light, shiki: codeTokens(id, 'light', accentHue) },
      dark: { ...r.dark, shiki: codeTokens(id, 'dark', accentHue) }
    }]
  }))
}

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
  // 启动动效用的干员立绘（tools/prepare-splash.py 产出）
  out.add('splash.webp')
  out.add('splash-sm.webp')
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
     *
     * ⚠️ B6 之后垫底改成 **-3**：中间那格（-2）留给换图时的「上一张」临时层
     * （`.zf-art-fade`），三层顺序 = 垫底 → 旧图 → 当前图。
     */
    'html[data-zf-wallpaper]::after{',
    '  content:"";position:fixed;inset:0;z-index:-3;pointer-events:none;',
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
    /* ── 换壁纸时的交叉淡入（B6，用户「还可以怎么完善」）──────────────────
     *
     * `background-image` **不能过渡** —— 换图是瞬切（`啪` 一下）。做法：
     *   ① 换图**之前**，客户端把 `html::before` 的**计算绘制快照**（图/size/
     *      position/repeat/filter/transform）抄到一层临时元素上，它此刻与旧图
     *      逐像素一致；
     *   ② 写新的 `--zf-art-src`（当前层立刻变新图，在临时层之上）；
     *   ③ 下一帧给临时层打 `data-zf-art-out` → 240ms 淡出 → **移除元素**。
     *
     * 三层都在根层叠上下文、都在 body 内容之下：
     *   html::after（模糊垫底）-3  ·  .zf-art-fade（上一张）-2  ·  html::before（当前）-1
     *
     * 元素是**临时**的：淡完即移除 —— 不留「常驻空元素 + 永久合成层」。
     * 动效模式 `reduced` / 系统 `prefers-reduced-motion` → 客户端直接切图、
     * 连层都不建；下面那条媒体查询是第二道保险（万一别处漏判）。
     */
    '.zf-art-fade{',
    '  position:fixed;inset:0;z-index:-2;pointer-events:none;',
    '  opacity:1;transition:opacity 240ms ease-out;',
    '}',
    '.zf-art-fade[data-zf-art-out]{ opacity:0; }',
    '@media (prefers-reduced-motion: reduce){ .zf-art-fade{ transition:none; } }',
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
    /* 左栏：**内层组件那层底也要跟着走**（用户：「这个地方也变成透明的」）
     *
     * 壳源码实测（app.asar 里 AppFrame 与 SidebarRoot 两个模块）：
     *
     *   .BynINW_sidebarCol{ background:var(--dsw-specific-sidebar-fill); … }
     *   ._2H3hWW_root    { background:var(--dsw-specific-sidebar-fill); … }  ← 内层再铺一层
     *   [data-platform=darwin] ._2H3hWW_root{ background:0 0 }               ← 只有 macOS 透明
     *
     * 也就是 Windows 上侧栏是**两层同色不透明底**叠着：纱画在 `sidebarCol` 上，
     * 内层组件再铺一层不透明同色 → 纱被打回去，左栏看着是实的。
     *
     * macOS 那条 `background:0 0` 恰好证明了结构：**列负责铺面、内层组件透明**，
     * 官方只是没给 Windows 写后一半（因为 Windows 的列本来不透明）。
     *
     * ── 修法：在列上把 token 改掉，而不是去点名内层组件 ─────────────────
     *
     * 自定义属性按**最近祖先**解析：在列上把 `--dsw-specific-sidebar-fill`
     * 置为透明，内层组件引用的那个变量就地变透明。好处：
     *   · **不依赖类名哈希**（内层组件的本地名是 `root`，太通用，写不得 ——
     *      `[class*="_root"]` 这类模糊兜底实测会把整个侧栏刷透明）
     *   · 纯 CSS，**首帧**就生效，不用等客户端打标
     *   · 内层以后再多包一层同样的底，也一起透明
     *
     * ⚠️ 加 `!important`：外壳 presenter 会把 token 写成**行内样式**（见上文
     * 「纱为什么不能改 token」）。行内样式只对它所在的那个元素有优先级，
     * 但为防 presenter 把这条写到了列元素自己身上，这里直接按 important 来。
     *
     * ⚠️ 只在壁纸开启时改：关掉壁纸时界面回到官方不透明配色，那时内层那层底
     * 是官方设计的一部分（列与内层同色，本就看不出来），不该动。
     */
    'body[data-zf-wallpaper] [data-zf-sidebar],',
    'body[data-zf-wallpaper] [class*="_sidebarCol"]{',
    '  --dsw-specific-sidebar-fill:transparent !important;',
    '  background:var(--zf-veil-sidebar) !important;',
    '}',
    /* 会话列表底部的渐隐：官方是「透明 → `--dsw-specific-sidebar-fill`」，
     * 用来把列表淡入侧栏底色。上面把那个 token 置透明后，这条会**整条失效**
     * （透明渐到透明），列表底部变成硬切。改成渐到同一层纱色 ——
     * 该淡出的照样淡出，而且渐的终点正好等于它背后的颜色。 */
    'body[data-zf-wallpaper] [data-zf-sidebar] [class*="_fade"],',
    'body[data-zf-wallpaper] [class*="_sidebarCol"] [class*="_fade"]{',
    '  background:linear-gradient(to bottom, transparent, var(--zf-veil-sidebar)) !important;',
    '}',
    // 右栏两套壳名字不同：桌面 `rightbarCol`、Web `detailsCol`。都要写。
    'body[data-zf-wallpaper] [data-zf-center],',
    'body[data-zf-wallpaper] [data-zf-rightbar],',
    'body[data-zf-wallpaper] [class*="_centerCol"],',
    'body[data-zf-wallpaper] [class*="_rightbarCol"],',
    'body[data-zf-wallpaper] [class*="_detailsCol"]{',
    '  background:var(--zf-veil) !important;',
    '}',

    /* ── dockkit pane：右栏「开始」页与 tab 条的公共底 ────────────────────
     *
     * 用户反馈：「开始页背景还是黑色的」「tab 条背景也还是黑色的」。
     *
     * ── 壳源码实测（dsh-web-frontend/dist/assets/index-*.css）───────────
     *
     *   ._tabHost_6nhg2_162:not(._float_6nhg2_156),
     *   ._emptyTabHost_6nhg2_143{ background: var(--dsw-alias-bg-base) }
     *
     * 而 JS 里 **tabHost 就是 pane 本身**（源码实测）：
     *
     *   className: ue(ve.tabHost, x ? ve.float : ve.pane)
     *   children : [ tabHostHeader(含 tab 条), tabHostBody(含页面内容) ]
     *
     * 所以 tab 条和页面内容**都直接坐在这一层不透明底上**。两个被反馈的
     * 元素自己都没有背景，黑色 100% 来自这里：
     *
     *   .unKlVG_guide{...}   ← 开始页容器：无 background
     *   ._tabStrip_6nhg2_237{...}  ← tab 条：无 background
     *
     * 它盖住了我们画在 rightbarCol 上的纱 —— 这就是「右栏一直是黑的」的原因
     * （不是纱没生效，是上面还压着一层不透明底）。
     *
     * ── 处理 ──────────────────────────────────────────────────────────
     *
     * 壁纸开启时让 docked pane 透明，露出 rightbarCol 的纱（`--zf-veil`）——
     * 与中栏**同一个变量**，所以可见度天然一致，滑杆也一起跟随。
     *
     * ── 三处刻意的「不碰」────────────────────────────────────────────
     *
     *   · 浮窗 pane（`data-dockkit-float`）仍保持官方 layer-2 不透明底 ——
     *     它是弹出窗口，需要实体感（选择器里 `:not([class*="_float"])` 就是它）
     *   · 官方拖拽停靠时的 `_dockScrim_`（bg-base 72% + blur）不动
     *   · active tab 的选中色 chip（`--dsw-alias-markdown-tag`）保留 ——
     *     它是状态指示，透明掉就看不出当前在哪一页
     *
     * ── 锚点为什么这样选（三层定位器的第 1、3 层）──────────────────────
     *
     * 首选**语义属性**：壳给 docked pane 打 `data-dockkit-pane`、给空 pane 打
     * `data-dockkit-empty`（源码实测）—— 跨版本最稳，Web 壳同源也命中。
     * 再补一层类名后缀兜底 `[class*="_tabHost"]`：pane 没有标签页时
     * `data-dockkit-pane` 不会渲染（源码里是 `!x && w ? a.id : undefined`），
     * 那时只有类名能命中。
     */
    'body[data-zf-wallpaper] [data-dockkit-pane],',
    'body[data-zf-wallpaper] [data-dockkit-empty],',
    'body[data-zf-wallpaper] [class*="_tabHost"]:not([class*="_float"]),',
    'body[data-zf-wallpaper] [class*="_emptyTabHost"]{',
    '  background:transparent !important;',
    '}',

    /* ── 输入区那条「座位」渐变（用户「这里的黑色渐变背景也给去掉」）───────
     *
     * 用户贴了输入区整棵 DOM。壳源码实测
     * （`@deepseek-ai/dsh-client-ui-conversation/lib/client.js` 里内联的 CSS）：
     *
     *   .Dc7zOa_composerSeat{ z-index:7; position:sticky; bottom:0;
     *     background: linear-gradient(180deg,
     *       color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px,
     *       var(--dsw-alias-bg-base) 36px); }        ← 36px 内渐到不透明底色
     *
     * 这条的**用意是好的**：输入条坐在一个 sticky/absolute 的「座位」上，消息会
     * 从它底下滚过去，渐到不透明底色能让文字消失在输入区上方，不至于糊在卡片边。
     * 但壁纸模式下 `--dsw-alias-bg-base` 是我们主题的**不透明**底色 —— 于是那里
     * 成了一条**黑色渐变带**，正好盖住壁纸。
     *
     * 处理：壁纸开启时不涂（透明），那条带子露出它下面中栏的纱 —— 与周围同色，
     * 不再有「另一块底」的边界。
     *
     * ⚠️ 代价如实记下：座位不再遮滚动中的文字，消息会显示到卡片上沿；卡片本身
     * 不透明，所以只有它上方那圈留白里看得到。若嫌吵，可改成「渐到纱色」或
     * 「backdrop-filter 糊一道」——两者都比现在这条黑带轻。
     *
     * 锚点：`_composerSeat` 是这个模块专有的本地名，比哈希稳；官方两条规则
     * （`_root[data-phase=active]` 与 `_embeddedBody[data-content-phase=active]`）
     * 都带 `!important` 压得过。
     */
    'body[data-zf-wallpaper] [class*="_composerSeat"]{',
    '  background:transparent !important;',
    '}',

    /* ── 去掉 Windows 中栏左上角那个「悬浮圆角」（用户反馈）──────────────
     *
     * 官方 Windows 壳有一条设计（源码实测）：
     *
     *   [data-windows-titlebar] .BynINW_frame{ --dsh-windows-content-radius:16px }
     *   [data-windows-titlebar] .BynINW_centerCol{
     *     background: var(--dsw-alias-bg-base);
     *     border-radius: var(--dsh-windows-content-radius) 0 0 0;  ← 左上 16px
     *     corner-shape: round
     *   }
     *
     * **它的用意**：标题栏那条 40px 带子铺 `--dsw-specific-sidebar-fill`
     * （一个不透明色），中栏左上角切个圆角，让中栏"浮"在标题栏上 ——
     * 类似 macOS 红绿灯那片留白。
     *
     * **为什么在主题里要去掉**：我们已经让标题栏透明（`--zf-veil-sidebar`
     * 的纱层透出壁纸），中栏也透明 —— **圆角两侧都是同一张壁纸**，
     * 于是它不再表达任何"层次"，只剩一个莫名的缺口（用户截图反馈
     * 「左上角的圆角看起来很奇怪」）。
     *
     * 判据：**只在壁纸开启时**去掉。关掉壁纸时界面回到官方不透明配色，
     * 那时圆角仍有意义（标题栏色 vs 中栏色），不该动官方的设计。
     *
     * 用 `--dsh-windows-content-radius:0` 而不是覆盖 `border-radius` ——
     * 尊重官方的取值方式（它把这个半径做成了变量，就是留给主题调的）。
     */
    'body[data-zf-wallpaper] [data-zf-frame],',
    'body[data-zf-wallpaper] [class*="_frame"]{',
    '  --dsh-windows-content-radius:0px;',
    '}',

    /* ── 让 Windows 原生标题栏条带**透明**（壁纸透上去）──────────────────
     *
     * 用户截图反馈「右侧透明壁纸能不能覆盖更大的区域」——量了像素才定位：
     *
     *   y=0..56, x<213   亮度 67–74  ← 透壁纸
     *   y=0..56, x>213   亮度 27     ← 恒定暗色 rgb(28,28,21)，无壁纸
     *
     * 那块是**原生标题栏条带**（Electron 的 `titleBarOverlay`，由**浏览器
     * 进程画在网页之上**，文档里任何 z-index 都碰不到它）。
     *
     * ── 但它的颜色**可以**改：桌面 preload 的探针机制（源码实测）──────
     *
     *   const probe = document.createElement("span")
     *   probe.style.cssText =
     *     "position:fixed;visibility:hidden;pointer-events:none;" +
     *     "background-color:var(--dsw-specific-sidebar-fill);" +   // ← 条带色
     *     "color:var(--dsw-alias-label-primary)"
     *   document.body.append(probe)
     *   // → getComputedStyle(probe) → canvas 归一化 → IPC →
     *   //   mainWindow.setTitleBarOverlay({ color, symbolColor })
     *
     * 主进程的颜色校验接受 alpha，preload 又用 canvas 归一化成
     * `rgba(r, g, b, a)` —— 所以**把探针底色设成透明**，那条带子就透明，
     * 壁纸透上去，─ □ ✕ 浮在壁纸上。
     *
     * ── 为什么直接改探针元素而不是改变量（550c 记录的坑）───────────────
     *
     * 探针的 `background-color` 是**行内样式**且引用
     * `var(--dsw-specific-sidebar-fill)`。自定义属性按**最近祖先**解析：
     * 该变量定义在 `body` 上（外壳 presenter 写的），所以在 `html` 上写
     * `!important` **压不过** body 上的普通声明。必须**直接选中探针元素**。
     *
     * 选择器：`body > span[style*="visibility:hidden"]` —— 探针是 body 的
     * **直接子元素**且带这段行内样式，特征唯一；再加 `:not([class])` 收一道。
     *
     * ⚠️ 只在**壁纸开启**时透明：关掉壁纸时界面回到官方不透明配色，那时
     * 条带应当保持主题色（官方设计），不该透明。
     * ⚠️ `-webkit-app-region:drag` 不受影响 —— 拖拽区是 `_frame::before`，
     * 那条仍在（下一条规则只改它的背景纱）。
     */
    // ⚠️ 属性值里的冒号**后面有空格**（`style.cssText` 序列化的结果）：
    //      "position: fixed; visibility: hidden; pointer-events: none; …"
    //    写成 `[style*="visibility:hidden"]`（无空格）会 **0 命中** ——
    //    实测确认过。用更短的 `[style*="visibility"]` 更稳：
    //    它不依赖空格，也不依赖属性顺序。
    'body[data-zf-wallpaper] > span[style*="visibility"]:not([class]){',
    '  background-color:transparent !important;',
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

    /* ── 选中文字与输入光标（用户「还可以怎么完善」里的 B4 / B5）──────────
     *
     * 这两处**每天都在碰**，却一直没管过：
     *   · `::selection` 从未设置 → 用浏览器默认蓝，在壁纸上很跳；
     *   · `caret-color` 从未设置 → 系统默认色，少了那点「同一套色」。
     *
     * 都取 alias，不硬编码：
     *   · 选中底色 = 强调色兑 30% 透明（`color-mix`），文字保持 `label-primary`
     *     —— 底色只做提示，不能把字压花；
     *   · 光标 = 强调色**本体**：它只有一个字符宽，取色可以大胆。
     *
     * 门控用 `body[data-zf-theme]`（主题启用标记，与各装饰开关无关）——
     * 挂在 `data-zf-glow` 上会变成「关掉微光，选中色也回默认」，那是两回事。
     *
     * `forced-colors` 下交还系统（高对比模式的可读性优先，与既有做法一致）。
     */
    'body[data-zf-theme] ::selection{',
    '  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent);',
    '  color:var(--dsw-alias-label-primary);',
    '}',
    // 只在**真能输入**的地方设光标：对话输入框 + 可编辑区 + 原生表单控件
    'body[data-zf-theme] [data-composer-input],',
    'body[data-zf-theme] [contenteditable="true"],',
    'body[data-zf-theme] input,',
    'body[data-zf-theme] textarea{',
    '  caret-color:var(--dsw-alias-brand-primary);',
    '}',
    '@media (forced-colors: active){',
    '  body[data-zf-theme] ::selection{ background:Highlight; color:HighlightText; }',
    '  body[data-zf-theme] [data-composer-input],',
    '  body[data-zf-theme] [contenteditable="true"],',
    '  body[data-zf-theme] input,',
    '  body[data-zf-theme] textarea{ caret-color:auto; }',
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
    /* ── 观测栏背景：**不再自己算一档**（用户：「跟随全局，不要单独设置」）──
     *
     * 原先这里走自己的一套 —— 自己的变量 `--zf-rail-veil` + 自己的底色
     * `--dsw-alias-bg-layer-1`：
     *
     *   background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) <keep>%, transparent)
     *
     * 它的**数值**确实来自同一个滑杆（`keep = 1 - 背景不透明度`），但它是
     * **又涂一层** —— 观测栏浮在中栏之上，中栏自己已经有一层纱：
     *
     *   · 14% 档：中栏 alpha 0.86，观测栏再叠 0.86 → 合起来 0.98（几乎全实）
     *   · 90% 档：中栏 0.10 叠 0.10 → 约 0.19（仍比别处实一截）
     *
     * 所以「数值跟随全局」并不等于「看起来跟随全局」，用户看到的就是这个差。
     *
     * 现在**什么都不涂**：观测栏背景透明，露出的就是它下面中栏那层纱 ——
     * 所见即全局那一档，结构上不可能再不一致。分隔由 `border-left` 负责。
     *
     * `backdrop-filter` 保留：它**不改变透明度**（纱是一层纯色，模糊它还是那个
     * 色），只把壁纸细节糊掉 —— 是高档位下小字号的可读性保险（见
     * `src/settings.js` 里 90% 上限那段说明）。18px 是实测的观感/性能折中。
     */
    '  background:transparent;',
    '  border-left:1px solid var(--dsw-alias-border-l2);',
    '  backdrop-filter:blur(18px) saturate(1.1);',
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
    /* ── 材质深度档位（由客户端按当前预设写 `data-zf-depth`）──────────
     *
     * 映射放在这里而不是 palette.js：`depth` 是**纯呈现档位**（三个字符串），
     * 不是配色数据 —— 放 palette 里会让「配色模块」承担样式职责。
     */
    'body[data-zf-depth]{ --zf-depth-set:1; }',
    /* ── 壁纸「本预设推荐」标记 ────────────────────────────────────────
     *
     * 用户明确要求：配套壁纸**只作推荐**，切换预设**不自动改**壁纸
     * （`settings.background` 一个字节都不动）。所以这里只画一个不干扰的
     * 小圆点，真正的选择权仍在用户手里。
     *
     * ⚠️ `corner-shape:round !important` 必须写：外壳有一条全局规则
     *   @supports (corner-shape:superellipse(1.5)){
     *     *, :before, :after{ corner-shape: var(--dsw-corner-shape) }
     *   }
     * 把**所有元素与伪元素**都设成超椭圆圆角，会把 `border-radius:50%`
     * 渲染成「圆角方形」。本文件里 `.zf-rail__avatar` 与助手头像
     * （`::before`）都踩过这个坑，处理方式一致。
     *
     * 注意：这个圆点是**圆形标记**（与「不要圆角」的约束不冲突）——
     * 全仓除此之外不新增任何 border-radius。
     */
    '.zf-art-recommended{ position:relative; }',
    '.zf-art-recommended::after{',
    '  content:"";position:absolute;top:3px;right:3px;width:7px;height:7px;',
    '  border-radius:50% !important;corner-shape:round !important;',
    '  background:var(--dsw-alias-brand-primary);',
    // 描边用面板底色，保证压在任何缩略图上都看得清（深浅两套自适应）
    '  box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1);',
    '  pointer-events:none;',
    '}',
    '.zf-rail__swatches{ display:flex;flex-direction:column;gap:6px; }',
    '.zf-rail__swatch{',
    '  width:100%;height:28px;border-radius:7px;cursor:pointer;padding:0 9px;box-sizing:border-box;',
    '  display:inline-flex;align-items:center;justify-content:space-between;gap:6px;',
    '  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);',
    '  color:var(--dsw-alias-label-secondary);font-size:11px;',
    '}',
    '.zf-rail__swatch:hover{ border-color:var(--dsw-alias-border-l4);color:var(--dsw-alias-label-primary); }',
    /* ── 观测栏壁纸缩略图网格 ────────────────────────────────────────────
     *
     * 取代原先的「全宽文字列表」：8 张壁纸占 8 行、只显示名字、把观测栏
     * 撑得又长又空，而且看不出壁纸长什么样（用户截图反馈「有点丑」）。
     * 3 列网格一屏放得下，与设置页的缩略图条视觉一致。
     *
     * 缩略图是 128×80 的 WebP（`prepare-art.py` 产出），比例 1.6:1；
     * 这里用 `aspect-ratio:8/5` 对齐，`object-fit:cover` 裁齐。
     */
    '.zf-rail__artgrid{',
    '  display:grid;grid-template-columns:repeat(3, 1fr);gap:6px;',
    '}',
    '.zf-rail__art{',
    '  position:relative;padding:0;cursor:pointer;overflow:hidden;',
    '  aspect-ratio:8 / 5;box-sizing:border-box;',
    '  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;',
    '  background:var(--dsw-alias-bg-layer-2);',
    '}',
    '.zf-rail__art img{ width:100%;height:100%;object-fit:cover;display:block; }',
    '.zf-rail__art:hover{ border-color:var(--dsw-alias-border-l4); }',
    // 选中态：主题色描边 + 轻微提亮（不靠 ✓ 也能看出选了哪个）
    '.zf-rail__art[aria-pressed="true"]{',
    '  border:2px solid var(--dsw-alias-brand-primary);',
    '}',
    // 「无」项：居中文字，与缩略图同尺寸保持网格整齐
    '.zf-rail__art--none{',
    '  display:flex;align-items:center;justify-content:center;',
    '  color:var(--dsw-alias-label-tertiary);font-size:11px;',
    '}',
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
     * ── 关键是「不要干预折叠」（实测踩过两次）──────────────────────────
     *
     * 聊天区是**虚拟化列表**，外壳自己有一条折叠规则：
     *
     *   [class*="_flowItem"]:is(:empty,
     *     :has(>[data-slot="conversation.chat.node"]:empty)){ height:0 }
     *
     * 它是**两个条件**：行本身空 **或** 它的 slot 子节点空。
     *
     * **第一次踩坑**（用户截图反馈空白）：我最初写 `min-height:48px;
     * padding:22px 0 2px 58px`，用 `min-height` 强行撑开了本该 `height:0`
     * 的行 → 折叠后留下大片空白，虚拟化列表的高度估算也失准。
     * 修法：用与外壳相同的折叠条件**取反**，只在真的没折叠时才加占位。
     *
     * **第二次踩坑**（用户截图反馈「折叠效果很奇怪」）：光靠上面那两条
     * **不够** —— 折叠的「思考」行**不是空的**，它有自己的 24px 摘要行
     * （`▾ 思考 · The user wants me to...`）。于是：
     *   · `:not(:empty)` 通过 → 我们加了 44px 左内距 + 28px 头像
     *   · 但该行实际高度只有 24px（外壳的 `contain:size layout` +
     *     `height:calc(24px + var(--dsh-content-font-delta))`）
     *   · 结果头像与摘要行**挤在一起**、文字被右推
     *
     * 外壳其实给了**专用语义标记**（源码实测）：
     *
     *   const processHidden = controllerInactive || foldable && processMember && !processOpen
     *   ...
     *   "data-turn-process-hidden": processHidden || void 0,
     *
     * 折叠时该属性**存在**（`true`），展开时不存在（`void 0` → 不渲染属性）。
     *
     * **第三次踩坑**（用户又贴 HTML 反馈「显示效果还是不太好」）：
     * 上面三条**仍然不够**。用户给的那行长这样：
     *
     *   data-chat-flow-kind="assistant-step"
     *   data-chat-group-part="reasoning"        ← ★ 推理组
     *   data-turn-process-member="true"
     *   （**没有** data-turn-process-hidden）    ← 所以三条判据全通过
     *     └─ 内部 _3GBCTG_root[data-variant=think]（无 data-expanded）
     *          → 外壳锁死 height:calc(24px + delta)
     *
     * 也就是说：**单行内的折叠**（那行自己的 `aria-expanded="false"`）与
     * **整段过程的折叠**（`data-turn-process-hidden`）是两回事。前者不受
     * 后者约束，于是 28px 头像又被塞进 24px 行。
     *
     * 外壳文档把 `groupPart` 的语义写得很清楚：
     *   「`groupPart` selects **reasoning or response** in the Assistant renderer」
     * 所以**只有 `response` 组是助手正文**，才该配头像；
     * `reasoning` 组是思考过程，一律不加 —— 这与「头像代表助手发言」
     * 的语义一致（思考不是发言）。
     *
     * 最终判据**四条并列**：行非空 **且** 子节点非空 **且** 不是折叠中的
     * 过程块 **且** **不是 reasoning 组**。
     *
     * ⚠️ 这里必须用 `:not([data-chat-group-part="reasoning"])`，**不能**用
     * `[data-chat-group-part="response"]` 正向匹配 —— 外壳把
     * `groupPart === undefined` 与 `"response"` **同等对待**（源码：
     * `flowKey = groupPart === void 0 || groupPart === "response" ? …`），
     * 而 `undefined` 时外壳**根本不渲染该属性**。正向匹配会漏掉那一类，
     * 结果是「有时有头像、有时没有」。
     *
     * 另外**不加 `min-height`**：行高由内容决定，我只在一旁放头像。
     * ══════════════════════════════════════════════════════════════════ */
    // 「助手正文」= 四条并列：非空 + 子节点非空 + 非折叠过程块 + 非 reasoning 组
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"]):not([data-turn-process-hidden]):not(:empty):not(:has(>[data-slot="conversation.chat.node"]:empty)){',
    '  position:relative;padding-left:44px;',
    '}',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"]):not([data-turn-process-hidden]):not(:empty):not(:has(>[data-slot="conversation.chat.node"]:empty))::before{',
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
    // 折叠行 / 空行 / 推理组：完全不加任何占位，交给外壳自己的高度约束
    //
    // ⚠️ `reasoning` 组必须在这里显式清零 —— 否则它会继承上面那条
    // 「加 44px 左内距」的规则（两者选择器不完全互补时会漏）。
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:empty,',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:has(>[data-slot="conversation.chat.node"]:empty),',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"][data-turn-process-hidden],',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"][data-chat-group-part="reasoning"]{',
    '  padding-left:0;min-height:0;',
    '}',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:empty::before,',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:has(>[data-slot="conversation.chat.node"]:empty)::before,',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"][data-turn-process-hidden]::before,',
    'body[data-zf-avatar] [data-chat-flow-kind="assistant-step"][data-chat-group-part="reasoning"]::before{',
    '  content:none;display:none;',
    '}',
    /* ── 代码块底色（修官方的变量作用域 bug）─────────────────────────────
     *
     * ── 症状（用户反馈「这一块一直都是白色的」）────────────────────────
     *
     * 代码块（shiki 高亮）的背景一直是白的，不受主题影响。
     *
     * ── 根因：`:root` 上的变量读不到 `body` 上的 alias（实测确认）────────
     *
     * 外壳的三层链条（源码实测）：
     *
     *   :root{ --dsw-static-neutral-bluish-*: #... }            ← 色阶在 :root
     *   body { --dsw-alias-markdown-code-block: var(--static) } ← alias 在 body
     *   :root{ --shiki-background: var(--dsw-alias-markdown-    ← shiki 又在 :root
     *                              code-block) }                  ✗ 读不到 body！
     *
     * **自定义属性在「声明它的那个元素」上做变量替换。** `html` 不是 `body`
     * 的后代，所以 `:root` 上解析 `var(--dsw-alias-markdown-code-block)` 失败
     * → `--shiki-background` 成为无效值 → 代码块的
     * `background-color:var(--shiki-background)` 退化为 `transparent`。
     *
     * 用 Edge headless 实测（真实 CSS 引擎，非推理）：
     *
     *   :root 上 --shiki-background 解析为  → ""（空）
     *   <pre> 计算 background-color         → rgba(0,0,0,0)
     *
     * ⚠️ 这是**官方自己的 bug**（默认主题下同样如此），不是我们引入的 ——
     * 但既然要做主题，就该顺手修掉：它让代码块在任何主题下都发白。
     *
     * ── 修法：在 `body` 上重声明 `--shiki-*` ────────────────────────────
     *
     * 把 shiki 变量**也**声明到 `body`（它能看到 `body` 自己的 alias），
     * 明暗两套就都自动跟随了。实测三选一对比：
     *
     *   A. body 上重声明 shiki      浅 rgb(232,232,234) / 深 rgb(43,43,46)  ✓
     *   B. html 上也放 alias         浅亮 / **深色失效**（alias 只有一套）   ✗
     *   C. !important 覆盖           正确，但需要 !important 且写死       ✓
     *
     * 选 A：不需要 `!important`、不写死颜色、明暗两套都跟随主题。
     *
     * 顺带把 `--shiki-foreground` 也一起修（同一个 bug，否则代码文字也会
     * 落到外壳默认色，与主题不一致）。
     */
    'body{',
    '  --shiki-background:var(--dsw-alias-markdown-code-block);',
    '  --shiki-foreground:var(--dsw-alias-label-primary);',
    '}',

    /* ── 无障碍：尊重系统的「减少透明度」与「高对比」偏好 ────────────────
     *
     * ── 为什么只做这两个（源码实测过的取舍）────────────────────────────
     *
     * 外壳的支持面（在 app.asar 里数出现次数）：
     *   prefers-reduced-motion        72 处  ← 已支持（我们的动效三态跟它）
     *   prefers-reduced-transparency   1 处  ← 支持（macOS 侧栏）
     *   forced-colors                  2 处  ← 支持
     *   prefers-contrast               0 处  ← **完全不支持**
     *
     * 所以：
     *   · 「减少透明度」与「高对比」**要**跟 —— 它们是真实存在的系统偏好，
     *     而我们的壁纸 + 纱层正是「大面积半透明」与「低对比文字」的来源；
     *   · `prefers-contrast: more` **不做** —— 外壳自己都不响应，我们单方面
     *     加深文字会让界面与官方组件风格割裂（半边深半边浅比不加深更糟）。
     *     等外壳支持了再跟。
     *
     * ⚠️ 这两条都**不改变用户设置**，只在呈现层生效：用户的
     * `backgroundOpacity` 等值原样保留，关掉系统偏好就恢复。
     */
    // 减少透明度：壁纸整层撤掉（半透明纱层对这类用户就是「看不清正文」），
    // 界面回到不透明底色。这是最彻底的处置，也最符合该偏好的意图。
    // ⚠️ 选择器必须**逐条对应**上面那组「纱」规则（含两套壳的类名与
    // `data-zf-*` 属性锚点）—— 只写一半会让部分列留着半透明，比不撤更难看。
    '@media (prefers-reduced-transparency:reduce){',
    '  html[data-zf-wallpaper]::before,',
    '  html[data-zf-wallpaper]::after{ display:none !important; }',
    '  body[data-zf-wallpaper] [data-zf-sidebar],',
    '  body[data-zf-wallpaper] [data-zf-center],',
    '  body[data-zf-wallpaper] [data-zf-rightbar],',
    '  body[data-zf-wallpaper] [class*="_sidebarCol"],',
    '  body[data-zf-wallpaper] [class*="_centerCol"],',
    '  body[data-zf-wallpaper] [class*="_rightbarCol"],',
    '  body[data-zf-wallpaper] [class*="_detailsCol"]{',
    '    background:var(--dsw-alias-bg-base) !important;',
    '  }',
    '}',
    // 高对比（forced-colors）：系统会强制替换颜色，背景图会盖住强制色
    // → 撤掉壁纸与模糊垫底，让强制色生效
    '@media (forced-colors:active){',
    '  html[data-zf-wallpaper]::before,',
    '  html[data-zf-wallpaper]::after{ display:none !important; }',
    '  .zf-splash__art{ display:none !important; }',
    '}',

    /* ── 排版（风格预设的第四个维度）────────────────────────────────────
     *
     * 属性驱动：客户端按设置写 `data-zf-font` / `data-zf-font-scale`，
     * 这里只放静态规则。详见 `src/fonts.js` 的说明（含实测数据）。
     */
    ...fontCss().split('\n'),

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
    '  body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"]):not([data-turn-process-hidden]):not(:empty):not(:has(>[data-slot="conversation.chat.node"]:empty)){ padding-left:34px; }',
    '  body[data-zf-avatar] [data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"]):not([data-turn-process-hidden]):not(:empty):not(:has(>[data-slot="conversation.chat.node"]:empty))::before{ width:22px;height:22px; }',
    '}',
    // 视口过窄时藏掉右栏，避免挤压中栏
    '@media (max-width:1180px){ .zf-rail{ display:none; } }',
    /* ── 启动动效（干员立绘入场）────────────────────────────────────────
     *
     * 立绘是**黑底**（源图四角 rgb(0,0,0)），所以用 `mix-blend-mode:screen`
     * 把黑融进界面 —— 这比抠图干净：边缘的笔触/光效都保留，且不需要 alpha。
     *
     * 层级：`z-index:40`，在 overlay(20) 之上、但**不拦截点击**
     * （`pointer-events:none`）—— 动效只是过场，不该挡住用户操作。
     *
     * 动画由 `animation` 一次跑完：淡入 + 轻微放大 → 停留 → 淡出。
     * `animation-fill-mode:forwards` 保证结束后停在透明态；
     * 组件随后自行卸载（见 client.js 的 Splash）。
     */
    '.zf-splash{',
    '  position:fixed;inset:0;z-index:40;pointer-events:none;',
    '  display:flex;align-items:center;justify-content:center;',
    // 底色用当前主题的画布色 —— 官方 boot 屏退场后，这一层立刻接管，
    // 视觉上就是「开场还在继续」，而不是「应用好了又弹一张图」。
    // 用 alpha 而非实色：万一动效被打断，底层应用仍能透出一点，不会像卡死。
    '  background:color-mix(in srgb, var(--dsw-alias-bg-base, Canvas) 96%, transparent);',
    '  overflow:hidden;',
    '  animation:zf-splash-veil var(--zf-splash-duration, 2400ms) ease-out forwards;',
    '}',
    '.zf-splash__art{',
    '  max-width:min(88vw, 1100px);max-height:88vh;object-fit:contain;',
    '  mix-blend-mode:screen;',      /* 黑底融掉，只留立绘 */
    '  filter:drop-shadow(0 24px 60px rgba(0,0,0,.55));',
    '  animation:zf-splash-in var(--zf-splash-duration, 2400ms) ease-out forwards;',
    '}',
    // 立绘：快速淡入（0→10%），长时间停留，末尾随底一起淡出
    '@keyframes zf-splash-in{',
    '  0%{ opacity:0; transform:scale(1.05); }',
    '  10%{ opacity:1; transform:scale(1); }',
    '  76%{ opacity:1; transform:scale(1.012); }',
    '  100%{ opacity:0; transform:scale(1.03); }',
    '}',
    // 底色：前 76% 保持不透明（遮住下面已就绪的应用，避免「两套 UI 同框」），
    // 末尾 24% 与立绘一起淡出，交出应用
    '@keyframes zf-splash-veil{',
    '  0%{ opacity:1; }',
    '  76%{ opacity:1; }',
    '  100%{ opacity:0; }',
    '}',
    // 窄屏换小图（省解码时间）
    '@media (max-width:900px){ .zf-splash__art{ max-width:94vw; } }',

    /* ── 动效三态（用户反馈：除了「跟随系统」和「关闭」还要有「开启」）──
     *
     *   on      强制开启动效 —— 即使系统开了「减少动态效果」也照常播放
     *   auto    跟随系统（默认）
     *   reduced 强制静止
     *
     * 三态由 `body[data-zf-motion]` 驱动，**不写全局** `*{transition:none}`
     * —— 那会连外壳的动画一起干掉，属于越权。只作用于本插件自己的元素。
     */
    // ① 静止：关掉本插件声明过的过渡与动画
    'body[data-zf-motion="reduced"] .zf-rail,',
    'body[data-zf-motion="reduced"] .zf-rail *,',
    'body[data-zf-motion="reduced"] .zf-nav,',
    'body[data-zf-motion="reduced"] .zf-nav *,',
    'body[data-zf-motion="reduced"] .zf-splash,',
    'body[data-zf-motion="reduced"] .zf-splash *{',
    '  transition:none !important;',
    '  animation:none !important;',
    '}',
    // ② 跟随系统：系统要求减少动效时，同「静止」
    '@media (prefers-reduced-motion:reduce){',
    '  .zf-rail, .zf-rail *, .zf-nav, .zf-nav *, .zf-splash, .zf-splash *{',
    '    transition:none !important;',
    '    animation:none !important;',
    '  }',
    '}',
    // ③ 开启：显式压过系统的减少动效（放在 @media 之后，靠选择器特异性 + 顺序取胜）
    'body[data-zf-motion="on"] .zf-rail,',
    'body[data-zf-motion="on"] .zf-rail *,',
    'body[data-zf-motion="on"] .zf-nav,',
    'body[data-zf-motion="on"] .zf-nav *,',
    'body[data-zf-motion="on"] .zf-splash,',
    'body[data-zf-motion="on"] .zf-splash *{',
    '  transition:revert !important;',
    '  animation:revert !important;',
    '}',
    /* ── 材质深度（风格预设的第三个维度）──────────────────────────────
     *
     * 外壳不暴露 `--dsw-alias-shadow-*`，只有 `--dsw-elevation-*` 三档
     * （panel / prominent / soft），且它们定义在 **`body, body *`** 上
     * （源码实测）—— 这个选择器特异性很高，普通 `body{}` 覆盖不掉，
     * 所以必须用**同选择器** + `!important`。
     *
     * 三档差异：
     *   flat（明亮轻盈）阴影最轻、描边最淡 —— 接近「纸面」
     *   soft（清爽中性/浓郁暖调）官方默认
     *   deep（厚重深沉）阴影最重、描边最实 —— 接近「实体面板」
     *
     * ⚠️ 描边色用的是 `--dsw-alias-border-l2-darkmode-thin`（外壳的默认引用），
     * 不是硬编码颜色 —— 这样它仍随主题变。
     */
    'body[data-zf-depth="flat"],body[data-zf-depth="flat"] *{',
    '  --dsw-elevation-stroke:0 0 0 .5px color-mix(in srgb, var(--dsw-elevation-stroke-color) 55%, transparent) !important;',
    '  --dsw-elevation-panel:var(--dsw-elevation-stroke), 0 2px 5px 0 rgba(0,0,0,.02) !important;',
    '  --dsw-elevation-prominent:var(--dsw-elevation-stroke), 0 2px 6px 0 rgba(0,0,0,.03) !important;',
    '  --dsw-elevation-soft:var(--dsw-elevation-stroke), 0 3px 10px 0 rgba(0,0,0,.02) !important;',
    '}',
    'body[data-zf-depth="deep"],body[data-zf-depth="deep"] *{',
    '  --dsw-elevation-stroke:0 0 0 .5px var(--dsw-elevation-stroke-color) !important;',
    '  --dsw-elevation-panel:var(--dsw-elevation-stroke), 0 5px 14px 0 rgba(0,0,0,.10), 0 0 26px 0 rgba(0,0,0,.07) !important;',
    '  --dsw-elevation-prominent:var(--dsw-elevation-stroke), 0 6px 18px 0 rgba(0,0,0,.14), 0 0 32px 0 rgba(0,0,0,.10) !important;',
    '  --dsw-elevation-soft:var(--dsw-elevation-stroke), 0 6px 22px 0 rgba(0,0,0,.10), 0 0 34px 0 rgba(0,0,0,.07) !important;',
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
          // 每套预设的「风格摘要」（显示名 / 材质倾向 / 推荐壁纸）。
          // 客户端用它：① 预设下拉显示「本体黄绿 · 明亮轻盈」；
          // ② 在壁纸选择器上给当前预设的推荐壁纸打标记（**只提示，不自动切换**）。
          presetStyles: PRESET_STYLES,
          overrides: Object.fromEntries(PRESET_IDS.map(id => [id, overridesFor(id, accentHue)])),
          roles: rolesPayload(accentHue),
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

  /**
   * 官方开机卡片的**主题 token**（纯 CSS）。
   *
   * ── 为什么要专门给它一份 token（而不是只靠遮罩盖住）────────────────
   *
   * 官方卡片（`[data-dsh-boot]`）的样式是**优先读主题 token** 的（源码实测）：
   *
   *   ._boot  { background: var(--dsw-alias-bg-base, var(--dsh-boot-bg, Canvas)) }
   *   ._wordmark { color: var(--dsw-alias-label-primary, var(--dsh-boot-label-primary)) }
   *   ._spinner:after { background: conic-gradient(var(--dsw-alias-brand-primary, ...) ...) }
   *
   * `--dsh-boot-*` 只是**兜底**。所以只要让主题 token 在卡片绘制前就位，
   * 卡片自己就会变成主题配色 —— 不需要去覆盖那几个兜底变量。
   *
   * ── 为什么必须在这一层给，而不是只靠 tapIndex ────────────────────────
   *
   * `tapIndex` 在桌面端**从不执行**（`dsh-app://` 直读磁盘），而
   * `webserver/index-inject` 的 style 行是**载体在文档解析阶段应用**的：
   * Web 渲染进 `<head>`、桌面在 settle `__DSH_BOOT_READY__` 之前逐行应用 ——
   * 而 boot 卡片是 `__DSH_BOOT_READY__` 之后由内核用 createElement 建的。
   * 所以这里的 token 一定**早于**卡片出现。
   *
   * ── 为什么挂 `:root` 而不是 `body` ───────────────────────────────────
   *
   * `tokenStyle()`（Web 端 tapIndex 用）挂在 `body{}` —— 因为外壳 presenter
   * 之后要把 token 写进 body 的行内样式。但这一份的读者是 **boot 卡片**，
   * 它挂在 `#root` 里；文档解析阶段 `body` 可能还不存在，挂 `body{}` 会失效。
   * 挂 `:root`（= `html`）是卡片与后续应用共同的祖先，稳妥。
   */
  function bootCardTokens () {
    const s = settings.get() ?? defaultSettings()
    const { light, dark } = buildTokens(s.preset, s.accentHue)
    const decl = (table, indent) =>
      Object.entries(table)
        .map(([k, v]) => `${indent}${k}:${v};`)
        .join('\n')
    return [
      '/* 庄方宜主题 · 官方开机卡片的主题色（早于卡片绘制）*/',
      // 亮色挂在 `:root`（html）—— 文档解析阶段 body 可能还不存在，
      // 挂 body 会失效；第一份必须是「无论何时都在」的那个祖先。
      ':root{',
      decl(light, '  '),
      '}',
      // 暗色挂在 `body[data-ds-dark-theme]` —— **这是外壳的真实约定**
      // （官方文档原文：presenter 把 `body[data-ds-dark-theme]` 投到 document）。
      // 不能写 `:root[data-ds-dark-theme]`：该属性从来不在 html 上，永远匹配不到。
      //
      // 位置也更对：boot 卡片在 `#root` 内、body 的后代，自定义属性按**最近祖先**
      // 解析，所以 body 上的暗色值会正确覆盖 `:root` 上的亮色值。
      'body[data-ds-dark-theme]{',
      decl(dark, '  '),
      '}'
    ].join('\n')
  }

  /**
   * 首帧样式：盖住官方开机卡片，并给遮罩层定好底色。
   *
   * 底色取主题画布色 —— 但此刻客户端还没跑，拿不到 presenter 写的 token，
   * 所以用预设里算好的 base 色（与随后应用的主题同色系，交接时看不出接缝）。
   */
  function firstFrameCss () {
    const s = settings.get()
    const scheme = s?.scheme === 'light' ? 'light' : 'dark'
    const preset = PRESETS[s?.preset]
    const bg = preset?.[scheme]?.base ?? '#151716'
    return [
      '/* 庄方宜主题 · 首帧（盖住官方开机卡片）*/',
      `html{background:${bg};}`,
      '#zf-first-frame{',
      '  position:fixed;inset:0;z-index:2147483000;',
      `  background:${bg};`,
      '  display:flex;align-items:center;justify-content:center;',
      '  pointer-events:none;',
      '  transition:opacity 260ms ease-out;',
      '}',
      '#zf-first-frame.zf-out{opacity:0;}',
      /* ⚠️ 关键：**不能**把官方卡片 `visibility:hidden` 掉。
       *
       * 那张卡片承载语义，不只是「加载中」：插件激活失败时它会切到**失败态**
       * （`_failed_*` 类，列出哪个插件没起来）。我最初写
       *
       *     [data-dsh-boot]{visibility:hidden !important;}
       *
       * 把整张卡片按掉 —— 结果是**失败信息也被一起藏了**：用户只看到我们这块
       * 遮罩停在那里，不知道有插件崩了。这是「把别人的语义节点当成可随意隐藏的
       * 装饰」的典型错误（同类教训：dsh-550c-boot 借 `data-dsh-boot-splash`
       * 标记，反被全家桶复用/删除）。
       *
       * 正确做法：**用自己的遮罩盖住它**（同 z-index 比拼，我们更高），
       * 并让脚本在检测到**失败态**时立刻撤离，把官方错误照原样露出来。
       */
      '#zf-first-frame.zf-bail{display:none;}'
    ].join('\n')
  }

  /**
   * 首帧脚本（同步执行，早于 boot 卡片绘制）。
   *
   * 职责：① 立刻插入遮罩（纯色）；② 提供 `end()` 让客户端在同一帧退役它；
   * ③ 自保 —— 官方卡片消失或超时后自行撤离，避免客户端出问题时挡住界面。
   */
  const FIRST_FRAME_JS = [
    '(function(){',
    '  if(document.getElementById("zf-first-frame"))return;',
    '  var d=document.createElement("div");d.id="zf-first-frame";',
    '  (document.body||document.documentElement).appendChild(d);',
    '  var ended=false;',
    '  function end(){',
    '    if(ended)return;ended=true;',
    '    var el=document.getElementById("zf-first-frame");',
    '    if(!el)return;',
    '    el.classList.add("zf-out");',
    '    setTimeout(function(){el.remove();},300);',
    '  }',
    '  window.__zfFirstFrame={end:end};',
    '  // 自保一：官方卡片消失（应用已挂载）→ 撤，再给 12s 绝对上限',
    '  var iv=setInterval(function(){',
    '    var boot=document.querySelector("[data-dsh-boot]");',
    '    if(boot===null){clearInterval(iv);end();return;}',
    '    // 自保二：官方卡片进入**失败态**（有插件没起来）→ 立刻让路，',
    '    // 让错误信息看得见。宁可少播一次开场，也不能把崩溃藏着。',
    '    if(boot.querySelector(\'[class*="_failed_"]\')){clearInterval(iv);bail();}',
    '  },250);',
    '  setTimeout(function(){clearInterval(iv);end();},12000);',
    '  // bail：无声撤离（不淡出），把官方卡片原样露出来',
    '  function bail(){',
    '    if(ended)return;ended=true;',
    '    var el=document.getElementById("zf-first-frame");',
    '    if(el)el.classList.add("zf-bail");',
    '    setTimeout(function(){if(el)el.remove();},0);',
    '  }',
    '})();'
  ].join('\n')

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

    /* ── 首帧注入：盖住官方开机卡片（走 `webserver/index-inject`）────────
     *
     * ── 为什么必须走这条路（而不是客户端插件）──────────────────────────
     *
     * 官方有一张开机卡片（`[data-dsh-boot]`，画的是 "HARNESS / Loading
     * plugins…"），由 shell 内核绘制，**等所有插件加载完才移除**。而
     * `shell.overlay` 这类插槽要等 shell 渲染后才存在 —— 所以**走插槽的开场
     * 动画永远排在官方卡片后面**（实测：卡片 67ms 出现、客户端遮罩 338ms
     * 才挂上、卡片 517ms 移除，中间 271ms 是客户端怎么调 z-index 都盖不住的）。
     *
     * `webserver/index-inject` 是官方留给插件的口子：它收集一张注入行表，
     * 由**载体**在页面解析阶段应用 ——
     *   · Web 载体：渲染进 index.html 的 `<head>`，早于 shell 的 module script；
     *   · 桌面载体：在 settle `__DSH_BOOT_READY__` **之前逐行应用**
     *     （`script` 行走 `createElement` 所以会执行）。
     * 两条路都发生在**内核建卡片之前**，于是卡片从来没被画到屏幕上。
     *
     * 行类型只支持纯 JSON 数据（`global` / `style` / `script` / `script-src` /
     * `html` / `meta`），所以这里推两行：一条 `style`、一条同步 `script`。
     *
     * ── 与客户端半边的约定（改一边要改另一边）──────────────────────────
     *
     *   `window.__zfFirstFrame.end()`  客户端遮罩挂载后调用它退役首帧
     *                                  （同一帧交接，无闪烁）
     * 首帧也不赖着不走：脚本自己每 250ms 看一次官方卡片，卡片消失就自行撤离，
     * 另有 12s 绝对上限 —— 即使客户端插件挂了，页面仍然可看可点。
     */
    scoped.on('webserver/index-inject', table => {
      // ① 官方卡片的主题色（无论开场动效开不开都要给 —— 关掉时卡片会露出来）
      table.push({ kind: 'style', text: bootCardTokens() })
      // ② 开场遮罩：关掉时不注入，一张黑屏都不出现
      if (settings.get()?.splash === false) return
      table.push({ kind: 'style', text: firstFrameCss() })
      table.push({ kind: 'script', placement: 'head', text: FIRST_FRAME_JS })
    })
  })
}

export { SETTINGS_VERSION }
