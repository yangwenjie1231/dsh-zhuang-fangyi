/**
 * 庄方宜主题 · 调色板（唯一数据源）
 *
 * ── 设计原则 ──────────────────────────────────────────────────────────
 *
 * 1. **骨架中性，点缀有色**。色阶（`--dsw-static-neutral-bluish-*`）是界面的
 *    骨架，面板、边框、次级文字都由它派生 —— 一旦带明显色相，整屏都会发脏。
 *    实测教训：把强调色相以 sin 曲线抹满整条色阶，会得到 `#EEEDCE`/`#5A5B33`
 *    这种橄榄泥色，观感廉价。所以色阶饱和度上限 8%，色相只做极轻渗透。
 *
 * 2. **每个模式只调 ~22 个角色**，其余 100+ 个 token 由角色派生。这样 4 套预设
 *    的观感一致、可整体微调，也不会出现某套预设某个 token 忘了改。
 *
 * 3. **分层靠描边而非填色**。外壳的浅色主题里 `bg-base`/`layer-1`/`layer-3`
 *    全部映射到同一级 `static-00`，层次感来自边框与极浅的填充差。照搬这个
 *    逻辑，而不是给每层一个明显不同的绿。
 *
 * 4. **每个 token 必须同时给 light / dark**。外壳 `validateOverrides` 对裸字符串
 *    直接抛错，原文即 "a single value goes illegible when the user switches
 *    color scheme"。
 *
 * 5. 所有取色经 `contrast.js` 断言（正文 4.5:1 / 大字图形 3:1 / 焦点环 3:1）。
 *
 * ── 配色来源 ──────────────────────────────────────────────────────────
 * 官方素材量化提取：荧光黄绿 #F2E957 · 青 #75DCD9 · 酒红 #D86766 ·
 * 橄榄绿 #9EBD87 · 米白 #E8D4D2；大招形态 墨青 #1D3D30 · 冰白青 #D2E7E0 ·
 * 香槟金 #C4D579。
 */

/** 中性色阶的 19 个级数（与外壳 design-platform.css 的命名一致）。 */
export const RAMP_STEPS = [
  '00', '50', '60', '75', '100', '150', '200', '300', '400',
  '500', '600', '700', '750', '800', '850', '875', '900', '950', '1000'
]

/** 色阶变量前缀。 */
export const RAMP_PREFIX = '--dsw-static-neutral-bluish-'

/** 外壳的专业明度骨架（百分比）。浅端密、深端密、中间跨度大。 */
const LIGHTNESS = [
  100, 98, 96.5, 95.3, 93.5, 93.1, 90.8, 82.5, 70,
  62.2, 52.7, 40, 27.6, 21.4, 17.6, 13.9, 10.8, 8.6, 7.1
]

/* ------------------------------------------------------------------ *
 * 颜色工具
 * ------------------------------------------------------------------ */

/** `#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` → [r,g,b,a?]（a 为 0..1）。 */
export function parseColor (value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  let hex = text.startsWith('#') ? text.slice(1) : null
  if (hex === null) {
    const m = /^rgba?\(([^)]+)\)$/i.exec(text)
    if (m === null) return null
    const parts = m[1].split(/[,\s/]+/).filter(Boolean)
    if (parts.length < 3) return null
    const nums = parts.map(p => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)))
    if (nums.some(Number.isNaN)) return null
    const out = nums.slice(0, 3).map(n => Math.max(0, Math.min(255, Math.round(n))))
    if (nums.length > 3) out.push(Math.max(0, Math.min(1, nums[3])))
    return out
  }
  if (hex.length === 3 || hex.length === 4) hex = hex.split('').map(c => c + c).join('')
  if (hex.length !== 6 && hex.length !== 8) return null
  if (!/^[0-9a-f]+$/i.test(hex)) return null
  const out = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
  if (hex.length === 8) out.push(parseInt(hex.slice(6, 8), 16) / 255)
  return out
}

/** 序列化为 CSS 颜色；alpha < 1 时输出 8 位 hex。 */
export function formatColor (rgba) {
  const [r, g, b, a] = rgba
  const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  if (a === undefined || a >= 0.999) return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
  return `#${h(r)}${h(g)}${h(b)}${h(a * 255)}`.toUpperCase()
}

/** sRGB 线性插值。 */
export function mixColor (a, b, t) {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (ca === null || cb === null) return a
  const k = Math.max(0, Math.min(1, t))
  const aa = ca[3] === undefined ? 1 : ca[3]
  const ab = cb[3] === undefined ? 1 : cb[3]
  const out = [0, 1, 2].map(i => ca[i] + (cb[i] - ca[i]) * k)
  const alpha = aa + (ab - aa) * k
  return formatColor(alpha >= 0.999 ? out : [...out, alpha])
}

/** 给颜色套一个 alpha（8 位 hex）。 */
export function withAlpha (value, alpha) {
  const c = parseColor(value)
  if (c === null) return value
  return formatColor([c[0], c[1], c[2], Math.max(0, Math.min(1, alpha))])
}

/** 相对亮度（WCAG）。 */
export function luminance (value) {
  const c = parseColor(value)
  if (c === null) return null
  const [r, g, b] = c.slice(0, 3).map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 对比度；不可解析时返回 null（调用方跳过，不猜）。 */
export function contrast (a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** RGB → {h:0..360, s:0..1, l:0..1}。 */
function rgbToHsl (rgb) {
  const [r, g, b] = rgb.slice(0, 3).map(v => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s, l }
}

/** {h,s,l} → `#RRGGBB`。 */
function hslToHex (h, s, l) {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.max(0, Math.min(1, s))
  const lig = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lig - c / 2
  let rgb
  if (hue < 60) rgb = [c, x, 0]
  else if (hue < 120) rgb = [x, c, 0]
  else if (hue < 180) rgb = [0, c, x]
  else if (hue < 240) rgb = [0, x, c]
  else if (hue < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return formatColor(rgb.map(v => (v + m) * 255))
}

/**
 * 按「绝对色度」生成颜色 —— 比直接给 HSL 饱和度可靠得多。
 *
 * ── 为什么必须用色度而不是饱和度 ────────────────────────────────────────
 *
 * HSL 的饱和度是**相对**量，在明度两端会被压缩。同一个 `s=0.13`：
 *
 *   L=96.5% → `#F7F7F5`   几乎纯灰（肉眼看不出颜色）
 *   L=50%   → 明显有色
 *
 * 界面底色恰恰全在明度两端（浅色 89~99%、深色 8~21%），所以「调饱和度」
 * 这个做法在底色上几乎无效 —— 初版配色把饱和度设到 0.13 仍然整屏发灰，
 * 用户反馈「太丑」，根因就在这里。
 *
 * 色度（`max-min`，0..255）是**绝对**量，直接对应「看起来有多少颜色」。
 * 由 `chroma = (1-|2L-1|)·S·255` 反解出需要的饱和度：
 *
 *     S = chroma / (255 · (1-|2L-1|))
 *
 * 这样无论明度多高多低，色相都保持同样的可见强度。
 *
 * @param {number} hue - 色相 0..360
 * @param {number} lightness - 明度 0..1
 * @param {number} chroma - 目标色度 0..255
 * @returns {string} `#RRGGBB`
 */
export function tint (hue, lightness, chroma) {
  const l = Math.max(0, Math.min(1, lightness))
  const span = 1 - Math.abs(2 * l - 1)
  if (span <= 1e-6) return hslToHex(hue, 0, l)
  const s = Math.min(1, (chroma / 255) / span)
  return hslToHex(hue, s, l)
}

/** 调色：改明度 / 改饱和度 / 调色相。 */
export function adjust (value, { l: dl = 0, s: ds = 0, h: dh = 0 } = {}) {
  const c = parseColor(value)
  if (c === null) return value
  const hsl = rgbToHsl(c)
  return hslToHex(hsl.h + dh, hsl.s + ds, Math.max(0, Math.min(1, hsl.l + dl)))
}

/* ------------------------------------------------------------------ *
 * 色阶生成
 * ------------------------------------------------------------------ */

/**
 * 生成 19 级近中性色阶。
 *
 * 明度照搬外壳的专业骨架；色相来自预设，**色度**由 `spec.chroma` 控制。
 *
 * 色阶是界面的骨架（大量面板、边框、次级文字都由它派生），所以要克制 ——
 * 但不能克制到没有颜色。初版把饱和度压到 ≤4%，结果浅色端几乎纯灰，
 * 整屏发灰，用户反馈「太丑」。
 *
 * 这一版改用绝对色度：浅色端给少量（视觉更敏感），深色端给多一些
 * （深色底需要更高的色度才能察觉同样多的颜色）。
 *
 * @param {object} spec
 * @param {number} spec.hue - 色相 0..360
 * @param {number} [spec.chroma] - 浅色端色度 0..255
 * @param {number} [spec.chromaDark] - 深色端色度 0..255
 * @returns {{ light: string[], dark: string[] }} 各 19 个色值
 */
export function buildRamp ({ hue, chroma = 13, chromaDark = 20 }) {
  const out = { light: [], dark: [] }
  for (let i = 0; i < RAMP_STEPS.length; i += 1) {
    const l = LIGHTNESS[i] / 100
    // 越靠深色端给越多色度：深色底上低色度几乎看不出来
    const t = i / (RAMP_STEPS.length - 1)
    out.light.push(tint(hue, l, chroma * (1 + t * 0.5)))
    out.dark.push(tint(hue, l, chromaDark * (1 + t * 0.5)))
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 预设规格 → 角色表
 * ------------------------------------------------------------------ */

/**
 * 明度骨架。表面与文字的明度都由这里统一决定，色相/色度来自预设规格。
 *
 * 这样做的原因：4 套预设 × 2 明暗 × ~28 个角色 = 224 个色值。逐条手写
 * 必然出现「某套预设某个面偏亮」这类不一致；把明度集中在一处，
 * 换配色时只需改色相与色度两个数。
 */
const SURFACE_L = {
  light: {
    base: 95.0, surface: 98.4, surfaceAlt: 91.0, surfaceSunken: 86.8,
    sidebar: 93.0, overlay: 98.4, code: 91.6, codeBanner: 89.0, inlineCode: 91.0
  },
  dark: {
    base: 8.6, surface: 12.4, surfaceAlt: 16.4, surfaceSunken: 20.4,
    sidebar: 10.4, overlay: 16.4, code: 11.2, codeBanner: 14.6, inlineCode: 16.4
  }
}

/**
 * 文字明度。
 *
 * 浅色模式的 `textFaint` / `textMuted` 必须够深 —— 它们要压在最深的那个
 * 表面（`surfaceAlt`，L≈92.8%）上仍达 4.5:1，所以 L 不能超过约 45%。
 * 这是 `contrast.js` 里最容易失败的一项，调色时先看它。
 */
const TEXT_L = {
  light: { text: 12.5, textMuted: 29.0, textFaint: 38.0 },
  dark: { text: 92.0, textMuted: 72.0, textFaint: 62.5 }
}

/**
 * 预设规格。
 *
 *   hue / hueDark      表面与文字的色相（取自官方素材量化）
 *   chroma / chromaDark 色度（0..255）—— 「看起来有多少颜色」的绝对量
 *   accent             深色模式的强调色（官方本色）
 *   accentLight        浅色模式的强调色（压深到可读）
 *   label              显示名
 *
 * 官方取色：本体 荧光黄绿 `#F2E957`、青 `#75DCD9`、酒红 `#D86766`；
 * 大招 墨青 `#1D3D30`、香槟金 `#C4D579`。色相由这些值换算：
 * 黄绿 56.5°、墨青 155.6°、青 178.3°、酒红 0.5°。
 */
export const PRESET_SPECS = {
  zhuang: {
    label: '本体黄绿',
    hue: 58, hueDark: 58,
    chroma: 5, chromaDark: 6,
    accent: '#F2E957',
    // 浅色强调色要压得够深：它同时当链接（压在最亮的 surfaceAlt 上达 4.5:1）
    // 与焦点环（压在 surfaceSunken 上达 3:1）。黄绿色相本身亮度高，
    // 所以比其它预设需要更低的明度。
    accentLight: '#4E6409'
  },
  burst: {
    label: '大招墨青金',
    hue: 156, hueDark: 156,
    chroma: 5, chromaDark: 6,
    accent: '#C4D579',
    accentLight: '#17513E'
  },
  cyan: {
    label: '青',
    hue: 178, hueDark: 178,
    chroma: 5, chromaDark: 6,
    accent: '#75DCD9',
    accentLight: '#0A5B5E'
  },
  wine: {
    label: '酒红',
    hue: 2, hueDark: 2,
    chroma: 5, chromaDark: 6,
    accent: '#E08B87',
    accentLight: '#8A2F2B'
  }
}

/**
 * 一组颜色里**最亮**的那个（按相对亮度）。
 *
 * 用于浅色模式：强调色要在最亮的面上仍然够暗，才算可读。
 */
export function lightestOf (colors) {
  let best = null
  let bestLum = -1
  for (const c of colors) {
    const l = luminance(c)
    if (l !== null && l > bestLum) { bestLum = l; best = c }
  }
  return best ?? undefined
}

/**
 * 一组颜色里**最暗**的那个（按相对亮度）。
 *
 * 用于深色模式：强调色要在最暗的面上仍然够亮，才算可读。
 */
export function darkestOf (colors) {
  let best = null
  let bestLum = 2
  for (const c of colors) {
    const l = luminance(c)
    if (l !== null && l < bestLum) { bestLum = l; best = c }
  }
  return best ?? undefined
}

/**
 * 由一个预设 + 明暗生成完整角色表。
 *
 * 角色说明（每个模式各一套）：
 *
 *   base            画布底色（app 背景）
 *   surface         抬起面板（卡片 / 菜单 / 输入框）
 *   surfaceAlt      嵌套面（二级面板 / 悬停底）
 *   surfaceSunken   下沉面（代码块 / 选择器）
 *   sidebar         侧栏
 *   overlay         浮层 / 气泡
 *   text            正文
 *   textMuted       次要文字
 *   textFaint       三级文字（说明 / 占位）
 *   brand           强调色填充（按钮 / 选中 / 开关）
 *   brandHover      强调色悬停
 *   brandInk        强调色填充上的文字
 *   brandSoft       强调色浅底（选中项 / 气泡）
 *   brandSoftInk    浅底上的文字
 *   link            链接色（需在 base 上可读）
 *   tintRgb         边框基色（配 alpha 用）
 *   focusRing       焦点环
 *   code            代码块底
 *   codeBanner      代码块标题条
 *   inlineCode      行内代码
 *   scrollbar1/2    滚动条常态 / 悬停
 *   toast           提示条底 / 字
 *   tooltip         浮标底
 *   skeleton        骨架屏
 *   navActive       侧栏选中项底
 *   navHover        侧栏悬停项底
 *
 * @param {string} presetId
 * @param {'light'|'dark'} scheme
 * @returns {Record<string,string>} 角色表
 */
export function buildRoles (presetId, scheme, accentHue = ACCENT_HUE_PRESET) {
  const spec = PRESET_SPECS[presetId]
  if (spec === undefined) throw new Error(`未知预设：${presetId}`)
  const dark = scheme === 'dark'
  const hue = dark ? spec.hueDark : spec.hue
  const c = dark ? spec.chromaDark : spec.chroma
  const L = SURFACE_L[scheme]
  const T = TEXT_L[scheme]
  const r = {}

  // ── 表面：色度按「视觉敏感度」分配 —— 浅色端给少，深色端给多 ──
  r.base = tint(hue, L.base / 100, c * 0.45)
  r.surface = tint(hue, L.surface / 100, c * 0.40)
  r.surfaceAlt = tint(hue, L.surfaceAlt / 100, c * 0.80)
  r.surfaceSunken = tint(hue, L.surfaceSunken / 100, c * 0.90)
  r.sidebar = tint(hue, L.sidebar / 100, c * 1.00)
  r.overlay = tint(hue, L.overlay / 100, c * 0.40)
  r.code = tint(hue, L.code / 100, c * 1.30)
  r.codeBanner = tint(hue, L.codeBanner / 100, c * 1.60)
  r.inlineCode = tint(hue, L.inlineCode / 100, c * 1.40)

  // ── 文字：带一点色相，避免死黑死白 ──
  r.text = tint(hue, T.text / 100, c * 0.25)
  r.textMuted = tint(hue, T.textMuted / 100, c * 0.35)
  r.textFaint = tint(hue, T.textFaint / 100, c * 0.40)

  // ── 强调色：深色用官方本色，浅色用压深版（可按 accentHue 旋转色相）──
  //
  // 换色相时按**最难读的那个底**做明度校正：`link` 要在 4 个面上达 4.5:1
  // （base / 气泡 / 代码块 / 二级面），取其中最亮的（浅色）或最暗的（深色）
  // 作为参照，并留出 `link`/`focusRing` 相对 `brand` 的明度偏移余量。
  // 详见 `rotateAccent` 的注释与 `contrast.js` 的色相扫描。
  // `link` 要同时读在 4 个面上，其中一个（`specific-bubble` = `brandSoft`）
  // **本身由强调色派生** —— 换色相时前景与背景一起动，是自指约束，
  // 所以必须把这几个真实的底都拿来逐一求解，不能只挑一个「最难的面」。
  const accentSurfaces = [r.base, r.surfaceAlt, r.code, r.brandSoft]
  r.brand = rotateAccent(dark ? spec.accent : spec.accentLight, accentHue, {
    againstAll: accentSurfaces,
    // link 在深色下比 brand 暗 0.02、focusRing 又偏移，所以按比 4.5 更严的
    // 目标求解，给派生色留出余量（避免「brand 达标、link 不达标」）。
    minRatio: 5.4
  })
  r.brandHover = adjust(r.brand, { l: dark ? 0.06 : 0.05, s: 0.02 })
  r.brandInk = dark ? r.base : '#FFFFFF'
  r.brandSoft = tint(hue, (dark ? 20.0 : 90.5) / 100, c * 3.50)
  r.brandSoftInk = r.brand
  r.link = dark ? adjust(r.brand, { l: -0.02 }) : r.brand
  r.focusRing = adjust(r.brand, { l: dark ? -0.06 : 0.04 })
  r.tintRgb = r.text

  // ── 其余面 ──
  r.navActive = tint(hue, (dark ? 19.0 : 88.5) / 100, c * 3.00)
  r.navHover = tint(hue, (dark ? 15.0 : 92.0) / 100, c * 1.20)
  r.scrollbar1 = tint(hue, (dark ? 20.0 : 84.0) / 100, c * 1.10)
  r.scrollbar2 = tint(hue, (dark ? 27.0 : 74.0) / 100, c * 1.30)
  r.toast = tint(hue, (dark ? 20.4 : 17.0) / 100, c * 0.90)
  r.toastInk = tint(hue, (dark ? 90.0 : 95.0) / 100, c * 0.30)
  r.tooltip = tint(hue, (dark ? 20.4 : 13.0) / 100, c * 0.90)
  r.skeleton = r.text + (dark ? '14' : '0A')

  return r
}

/* ------------------------------------------------------------------ *
 * 强调色色相覆盖（accentHue）
 * ------------------------------------------------------------------ */

/** `accentHue` 的「不覆盖」取值：沿用预设自带的强调色。 */
export const ACCENT_HUE_PRESET = 'preset'

/**
 * 把 `accentHue` 归一化为 `'preset'` 或 0..360 的整数。
 *
 * 非法输入一律回落 `'preset'`（设置损坏时宁可没效果，也不要给出怪色）。
 */
export function normalizeAccentHue (value) {
  if (value === ACCENT_HUE_PRESET || value === undefined || value === null) return ACCENT_HUE_PRESET
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ACCENT_HUE_PRESET
  const wrapped = ((Math.round(n) % 360) + 360) % 360
  return wrapped
}

/**
 * 按目标色相旋转一个强调色，并**自动校正明度**以保住可读性。
 *
 * ── 为什么不能只转色相（实测数据驱动）──────────────────────────────
 *
 * 最初只改色相、保留原明度，理由是「预设的 accentLight 明度是按可读性调过的，
 * 换色相后明度约束依然成立」。**这个推理是错的** —— 相对亮度取决于色相：
 * 人眼对绿最敏感、对蓝最迟钝。同一明度下，黄绿转成蓝后亮度显著下降。
 *
 * 实测（`contrast.js` 的色相扫描，12 色相 × 4 预设 × 2 明暗 × 3 断言）：
 * 只转色相会有 **62 项跌破阈值**，例如
 *   · wine/light 转 60°（黄）：链接 3.25:1 < 4.5（变亮 → 在浅底上不够暗）
 *   · burst/dark 转 240°（蓝）：链接 4.16:1 < 4.5（变暗 → 在深底上不够亮）
 *
 * ── 做法：以「对比度目标」为准，反解明度 ────────────────────────────
 *
 * 保留饱和度，明度则在原值附近搜索，使该颜色相对**参照底色**的对比度不低于
 * 阈值（浅色强调色按浅色底、深色按深色底）。搜索是单调的：向目标方向微调
 * 明度直到达标，最多若干步；找不到就用最接近的一档（并由对比度测试兜住）。
 *
 * @param {string} value 预设自带的强调色
 * @param {string|number} accentHue `'preset'` 或 0..360
 * @param {object} [opts]
 * @param {string} [opts.against] 参照底色（hex）。给了才做明度校正。
 * @param {number} [opts.minRatio] 目标对比度，默认 4.5（链接级）
 */
export function rotateAccent (value, accentHue, opts = {}) {
  const target = normalizeAccentHue(accentHue)
  if (target === ACCENT_HUE_PRESET) return value
  const c = parseColor(value)
  if (c === null) return value
  const hsl = rgbToHsl(c)
  if (Math.abs(target - hsl.h) < 1e-6) return value
  let l = hsl.l
  const minRatio = opts.minRatio ?? 4.5
  // 参照面：`against`（单个）或 `againstAll`（多个，需全部满足）
  const surfaces = opts.againstAll ?? (opts.against !== undefined ? [opts.against] : [])
  if (surfaces.length > 0) {
    // 注意：其中一个参照面可能**由强调色自身派生**（气泡底 = brandSoft）。
    // 这里把它当作固定色 —— 迭代求解会在下面的循环里重新评估，
    // 但由于 brandSoft 只随**色相/明度配方**变、不随本次求解的明度变
    // （它的明度是常量 90.5/20），所以固定参照是准确的。
    const ok = (lightness) => {
      const cand = hslToHex(target, hsl.s, lightness)
      return surfaces.every((bg) => {
        const ratio = contrast(cand, bg)
        return ratio !== null && ratio >= minRatio
      })
    }
    if (!ok(l)) {
      // 方向由参照面的平均亮度决定：浅底 → 压深；深底 → 提亮
      const lums = surfaces.map((c) => luminance(c)).filter((x) => x !== null)
      const avg = lums.length > 0 ? lums.reduce((a, b) => a + b, 0) / lums.length : 0
      const darken = avg > 0.5
      let found = null
      for (let step = 1; step <= 80; step += 1) {
        const cand = darken ? l - step * 0.01 : l + step * 0.01
        if (cand < 0 || cand > 1) break
        if (ok(cand)) { found = cand; break }
      }
      // 该方向走到头也没达标 → 试反方向（极端色相可能出现）
      if (found === null) {
        for (let step = 1; step <= 80; step += 1) {
          const cand = darken ? l + step * 0.01 : l - step * 0.01
          if (cand < 0 || cand > 1) break
          if (ok(cand)) { found = cand; break }
        }
      }
      l = found !== null ? found : (darken ? 0 : 1)
    }
  }
  return hslToHex(target, hsl.s, l)
}

/** 全部预设 × 明暗的角色表（Host 通过 `/themes` 交给浏览器半边算「纱」色）。 */
export const PRESETS = Object.fromEntries(
  Object.keys(PRESET_SPECS).map(id => [id, {
    label: PRESET_SPECS[id].label,
    accent: PRESET_SPECS[id].accent,
    light: buildRoles(id, 'light'),
    dark: buildRoles(id, 'dark')
  }])
)

/** 预设 id 顺序。 */
export const PRESET_IDS = Object.keys(PRESETS)

/** 默认预设。 */
export const DEFAULT_PRESET = 'zhuang'

/* ------------------------------------------------------------------ *
 * 角色 → token 派生
 * ------------------------------------------------------------------ */

/**
 * 由一个模式的角色表派生全部 alias token。
 *
 * 派生规则刻意保持简单可读：每一条都能一句话说清「它是什么」，而不是
 * 逐 token 手写魔数 —— 后者在 4 套预设 × 2 模式 × 100+ token 的规模下
 * 必然出现观感不一致。
 *
 * @param {object} r - 角色表
 * @returns {Record<string,string>} token 短名 → 色值
 */
export function deriveAliases (r) {
  const b1 = 0.07
  const b2 = 0.12
  const b3 = 0.18
  const b4 = 0.26
  return {
    /* 画布与面板 */
    'bg-base': r.base,
    'bg-layer-1': r.surface,
    'bg-layer-2': r.surfaceAlt,
    'bg-layer-3': r.surfaceSunken,
    'bg-overlay': r.overlay,
    'bg-module-platform': r.surfaceAlt,
    'bg-multi-select': r.surfaceAlt,
    'bg-document-preview': r.surfaceSunken,
    'bg-skeleton': r.skeleton,

    /* 侧栏与菜单 */
    'specific-sidebar-fill': r.sidebar,
    'specific-menu': r.surface,
    'specific-input-major': r.surface,
    'specific-login-input': r.surfaceAlt,
    'specific-selector': r.surfaceAlt,
    'specific-tip': r.surfaceAlt,
    'specific-sidebar-nav-item-active': r.navActive,
    'specific-sidebar-nav-item-active-accent': r.brandSoft,
    'specific-sidebar-nav-item-hover': r.navHover,

    /* 气泡 */
    'specific-bubble': r.brandSoft,
    'specific-bubble-highlight': adjust(r.brandSoft, { l: -0.03 }),

    /* 强调色 */
    'brand-primary': r.brand,
    'brand-primary-invert': r.brand,
    'brand-primary-new-color': r.brand,
    'brand-text': r.brand,
    'state-business-primary': r.link,
    'state-business-tertiary': r.brandSoft,
    'link': r.link,

    /* 文字 */
    'label-primary': r.text,
    'label-primary-bluish': r.text,
    'label-primary-dimmed': adjust(r.text, { l: 0.04 }),
    'label-primary-foreground': r.brandInk,
    'label-primary-inverted': r.brandInk,
    'label-secondary': r.textMuted,
    'label-tertiary': r.textFaint,
    'label-caption': r.textFaint,
    'label-document-preview': r.textMuted,
    'label-dimmed': r.brandSoft,

    /* 边框：以 tintRgb 配 alpha，与外壳同构 */
    'border-l1': withAlpha(r.tintRgb, b1),
    'border-l2': withAlpha(r.tintRgb, b2),
    'border-l2-darkmode-thin': withAlpha(r.tintRgb, b1),
    'border-l3': withAlpha(r.tintRgb, b3),
    'border-l4': withAlpha(r.tintRgb, b4),
    'border-inverted': withAlpha(r.tintRgb, 0),
    'border-inverted2': withAlpha(r.tintRgb, b1),

    /* 按钮 */
    'button-primary-fill': r.brand,
    'button-primary-hover': r.brandHover,
    'button-primary-dimmed': r.brandSoft,
    'button-elevated-fill': r.surface,
    'button-floating-fill': r.surface,
    'button-floating-hover': r.surfaceAlt,
    'button-ghost-active-fill': r.brandSoft,
    'button-ghost-active-hover': adjust(r.brandSoft, { l: -0.03 }),
    'button-ghost-active-border': r.textFaint,
    'button-contrast-fill': r.textMuted,
    'button-info-fill': r.link,
    'button-info-hover': r.brandHover,

    /* 交互底 */
    'interactive-bg-hover': withAlpha(r.tintRgb, b1),
    'interactive-bg-active': withAlpha(r.tintRgb, b2),
    'interactive-bg-hover-accent': withAlpha(r.tintRgb, b3),
    'interactive-bg-hover-solid': r.surfaceAlt,
    'interactive-bg-hover-danger': withAlpha('#EC1313', 0.05),

    /* 代码 */
    'markdown-code-block': r.code,
    'markdown-code-block-banner': r.codeBanner,
    'markdown-code-segment-selected': r.surface,
    'markdown-code-segment-unselected': r.code,
    'markdown-inline-code': r.inlineCode,
    'markdown-placeholder': r.surfaceAlt,
    'markdown-tag': r.surfaceAlt,
    'markdown-citation': r.surfaceSunken,

    /* 其它面 */
    'switch-thumb': r.brandInk,
    'focus-ring-color': r.focusRing,
    'menu-group-header-fill': withAlpha(r.surface, 0.94),
    'menu-icon': r.text,
    'scrollbar-bg-l1': r.scrollbar1,
    'scrollbar-bg-l2': r.scrollbar1,
    'scrollbar-hover-l1': r.scrollbar2,
    'scrollbar-hover-l2': r.scrollbar2,
    'toast-bg': r.toast,
    'toast-label': r.toastInk,
    'tooltip-bg': r.tooltip,
    'turn-trigger-bg': r.code,
    'turn-trigger-bg-hover': withAlpha(r.tintRgb, b1),
    'settings-card-fill': r.surface,
    'settings-card-stroke': withAlpha(r.tintRgb, b4),
    'onboarding-card-fill': withAlpha(r.surface, 0.8),
    'onboarding-secondary-fill': r.surface,
    'onboarding-accent': r.brand,
    'onboarding-checkbox-border': withAlpha(r.tintRgb, 0.2)
  }
}

/**
 * 短名 → 外壳真实 token 名。
 *
 * 外壳命名并不统一：语义 alias 用 `--dsw-alias-`，但 `specific-*` 一族是
 * `--dsw-specific-*`（没有 `alias`）。写错前缀不会报错，只会静默变成一个
 * 外壳不认识的变量 —— 所以 `contrast.js` 会拿真实 token 名清单逐条校验。
 */
export function tokenName (short) {
  if (short.startsWith('specific-')) return `--dsw-${short}`
  return `--dsw-alias-${short}`
}

/**
 * 把预设展开为「色阶 + alias」的完整 token 表。
 * @param {string} presetId
 * @returns {{ light: Record<string,string>, dark: Record<string,string> }}
 */
export function buildTokens (presetId, accentHue = ACCENT_HUE_PRESET) {
  const preset = PRESETS[presetId]
  if (preset === undefined) throw new Error(`未知预设：${presetId}`)
  const spec = PRESET_SPECS[presetId]
  const ramp = buildRamp(spec)
  const light = {}
  const dark = {}
  RAMP_STEPS.forEach((step, i) => {
    const name = RAMP_PREFIX + step
    light[name] = ramp.light[i]
    dark[name] = ramp.dark[i]
  })
  // 强调色可能被 accentHue 覆盖，所以角色表要**按需重算**而不是直接用静态 PRESETS
  const hue = normalizeAccentHue(accentHue)
  const roles = hue === ACCENT_HUE_PRESET
    ? { light: preset.light, dark: preset.dark }
    : { light: buildRoles(presetId, 'light', hue), dark: buildRoles(presetId, 'dark', hue) }
  for (const [short, value] of Object.entries(deriveAliases(roles.light))) {
    light[tokenName(short)] = value
  }
  for (const [short, value] of Object.entries(deriveAliases(roles.dark))) {
    dark[tokenName(short)] = value
  }
  return { light, dark }
}

/** 转成 `ctx.theme.register()` 需要的扁平 token 表。 */
export function tokensForScheme (presetId, scheme, accentHue = ACCENT_HUE_PRESET) {
  return buildTokens(presetId, accentHue)[scheme]
}

/** 转成 `ctx.theme.overrideTokens()` 需要的 `{ token: { light, dark } }`。 */
export function overridesFor (presetId, accentHue = ACCENT_HUE_PRESET) {
  const { light, dark } = buildTokens(presetId, accentHue)
  const out = {}
  for (const name of Object.keys(light)) out[name] = { light: light[name], dark: dark[name] }
  return out
}

/** 主题 id：`zhuang-light` / `zhuang-dark` …（进「外观」下拉用）。 */
export function themeId (presetId, scheme) {
  return `${presetId}-${scheme}`
}

/** 主题显示名。 */
export function themeLabel (presetId, scheme) {
  const preset = PRESETS[presetId]
  if (preset === undefined) return presetId
  return `庄方宜 · ${preset.label}（${scheme === 'dark' ? '深色' : '浅色'}）`
}

/** 全部 8 个主题定义（4 预设 × 2 明暗）。 */
export function themeDefinitions (accentHue = ACCENT_HUE_PRESET) {
  const out = []
  for (const presetId of PRESET_IDS) {
    for (const scheme of ['light', 'dark']) {
      out.push({
        id: themeId(presetId, scheme),
        colorScheme: scheme,
        label: themeLabel(presetId, scheme),
        tokens: tokensForScheme(presetId, scheme, accentHue)
      })
    }
  }
  return out
}
