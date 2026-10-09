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
 * ── 关于「导出但只在本文件用」的符号（0.12.0 明确）────────────────────
 *
 * 本文件里的 `parseColor` / `mixColor` / `withAlpha` / `tint` / `adjust` /
 * `buildRamp` / `rotateAccent` / `deriveAliases` / `tokensForScheme` /
 * `themeId` / `themeLabel` / `RAMP_STEPS` / `RAMP_PREFIX` 都只有本文件内部
 * 调用，**但刻意保留 `export`**：它们是这条配色管线的分层构件
 * （取色 → 混色 → 色阶 → 角色 → token），导出后读代码的人能顺着名字
 * 找到每一层的定义与文档，而不是面对一堆内部私有函数。
 *
 * 判据与「真死代码」的区别：**删掉会不会让管线读不懂**。
 *   · 会 → 保留导出（本节这些）；
 *   · 不会、且零调用、且注释还声称有人用 → 删除
 *     （0.12.0 删了 `lightestOf` / `darkestOf`，见下方说明）。
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
    // ⚠️ `code` 必须与 `base` 拉开足够距离：它曾经是 11.2（与 base 只差 2.6
    // 个百分点），修好 shiki 底色后发现**深色下看不出那是个代码块** ——
    // 实测亮度差只有 0.0032–0.0061。
    //
    // 只提到 14.5（差 5.9 个百分点）还不够：**亮度曲线在暗端是非线性的**，
    // 所以同样的百分点间距，base 越亮的预设绝对差越小 —— `wine`
    // （`surfaceShiftDark = +1.6`，base 最亮）实测只有 0.0099，仍是
    // 「几乎看不出」。现在给到 8.4 个百分点，实测差 0.0147–0.0192。
    //
    // `codeBanner`（标题条）与 `inlineCode`（行内代码）同步上调，保持
    // 「行内 > 标题条 > 代码块 > 画布」的层级不倒挂。
    base: 8.6, surface: 12.4, surfaceAlt: 16.4, surfaceSunken: 20.4,
    sidebar: 10.4, overlay: 16.4, code: 17.0, codeBanner: 20.2, inlineCode: 21.4
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
 * 预设规格 —— **风格预设**，不只是配色。
 *
 * 每套预设是一整套视觉性格，用户切换时应当**一眼看出不同**，而不是
 * 「只有按钮换了个颜色」。因此除了色相，每套还带材质维度：
 *
 *   hue / hueDark        表面与文字的色相（取自官方素材量化）
 *   chroma / chromaDark  色度（0..255）—— 「看起来有多少颜色」的绝对量
 *   surfaceShift         表面明度基调偏移（百分点）。正=更亮更轻，负=更沉
 *   textSoft             文字对比倾向：true = 柔和（正文稍淡），false = 锐利
 *   borderAlpha          边框不透明度基调（0..1）
 *   defaultBackground    这套预设配套的默认壁纸（预设联动）
 *   combo                一键推荐组合的其余几项（C14，见 `recommendCombo`）
 *   accent               深色模式的强调色（官方本色）
 *   accentLight          浅色模式的强调色（压深到可读）
 *   label                显示名
 *
 * ── 为什么 chroma 必须差异化（旧版的核心问题）────────────────────────
 *
 * 旧版四套预设的 `chroma/chromaDark` **全是 5/6**，只换 hue；而 hue 对
 * 大面积表面的影响又被 v3 的「按面积分配」刻意压到极低。两者叠加的结果是：
 * **切预设 ≈ 只换了强调色**，背景几乎不动 —— 用户反馈「切换主题就改个配色
 * 会不会太少了」，指的就是这个。
 *
 * 现在每套给定不同的色度与明度基调：
 *   · 本体黄绿  克制、明亮（低色度 + 正明度偏移）—— 白天工作台
 *   · 大招墨青金 厚重、深沉（高色度 + 负明度偏移）—— 深夜指挥室
 *   · 青        清爽、中性（中色度）—— 通用
 *   · 酒红      浓郁、偏暖（中高色度 + 微负偏移）—— 夜间阅读
 *
 * 官方取色：本体 荧光黄绿 `#F2E957`、青 `#75DCD9`、酒红 `#D86766`；
 * 大招 墨青 `#1D3D30`、香槟金 `#C4D579`。色相由这些值换算：
 * 黄绿 56.5°、墨青 155.6°、青 178.3°、酒红 0.5°。
 */
export const PRESET_SPECS = {
  zhuang: {
    label: '本体黄绿',
    // 风格：克制、明亮的白天工作台
    style: '明亮轻盈',
    hue: 58, hueDark: 58,
    chroma: 4, chromaDark: 7,
    surfaceShift: 1.4, surfaceShiftDark: -0.6,
    textSoft: false,
    borderAlpha: 0.72,
    // 0.9.0：推荐壁纸从 0.8.0 扩充后的 58 张里重新配对（原先只在老 8 张里选）。
    // 只改「推荐」，不改用户当前设置 —— 推荐不自动应用的原则不变。
    defaultBackground: 'off05',
    // C14 一键推荐组合：明亮轻盈 → 无衬线、薄纱、标准宽度
    combo: { fontFamily: 'sans', backgroundOpacity: 10, contentWidth: 'auto' },
    accent: '#F2E957',
    // 浅色强调色要压得够深：它同时当链接（压在最亮的 surfaceAlt 上达 4.5:1）
    // 与焦点环（压在 surfaceSunken 上达 3:1）。黄绿色相本身亮度高，
    // 所以比其它预设需要更低的明度。
    accentLight: '#4E6409'
  },
  burst: {
    label: '大招墨青金',
    // 风格：厚重、深沉的深夜指挥室
    style: '厚重深沉',
    hue: 156, hueDark: 156,
    chroma: 8, chromaDark: 11,
    surfaceShift: -1.0, surfaceShiftDark: -1.8,
    textSoft: true,
    borderAlpha: 0.9,
    // 厚重深沉 → 霓虹星空（天然暗调 + 星光粒子，与墨青金的主题色同一冷调）
    defaultBackground: 'sce01',
    // C14：厚重深沉 → 衬线、更实的纱（压住壁纸细节）、紧凑列宽（专注）
    combo: { fontFamily: 'serif', backgroundOpacity: 22, contentWidth: 'compact' },
    accent: '#C4D579',
    accentLight: '#17513E'
  },
  cyan: {
    label: '青',
    // 风格：清爽、中性的通用工作台
    style: '清爽中性',
    hue: 178, hueDark: 178,
    chroma: 6, chromaDark: 8,
    surfaceShift: 0.6, surfaceShiftDark: 0.8,
    textSoft: false,
    borderAlpha: 0.6,
    // 清爽中性 → 荷塘古树（青绿大留白，官方 2844×1600）
    defaultBackground: 'off02',
    // C14：清爽中性 → 圆体、最薄的纱、标准宽度
    combo: { fontFamily: 'rounded', backgroundOpacity: 12, contentWidth: 'auto' },
    accent: '#75DCD9',
    accentLight: '#0A5B5E'
  },
  wine: {
    label: '酒红',
    // 风格：浓郁、偏暖的夜间阅读
    style: '浓郁暖调',
    hue: 2, hueDark: 2,
    chroma: 7, chromaDark: 10,
    surfaceShift: -0.4, surfaceShiftDark: 1.6,
    textSoft: true,
    borderAlpha: 0.8,
    // 浓郁暖调 → 暖木长廊（暖黄灯光室内；原推荐 promo 是绿发双人，与酒红主题完全脱节）
    defaultBackground: 'sce17',
    // C14：浓郁暖调 → 衬线、偏实的纱、宽松列宽（长文阅读）
    combo: { fontFamily: 'serif', backgroundOpacity: 26, contentWidth: 'wide' },
    accent: '#E08B87',
    accentLight: '#8A2F2B'
  },
  /**
   * ── 0.11.0 新增：补色相空档 ───────────────────────────────────────────
   *
   * 原四套的色相是 2 / 58 / 156 / 178，**58→156 之间空了 98°** —— 而
   * 官方配色里的橄榄绿 `#9EBD87` 正好落在这个空档（94°）。
   *
   * 色度刻意取 **5**（低于 wine 的 7、burst 的 8）：这是 0.6.0 的核心教训 ——
   * 四套 `chroma` 全相同时「切预设≈只换强调色」。新套要与已有四套在
   * **色度与明度基调**上也拉开，而不只是色相不同。
   */
  olive: {
    label: '橄榄绿',
    // 风格：自然、沉稳的绿意工作台（介于 zhuang 的明亮与 burst 的深沉之间）
    style: '自然沉稳',
    hue: 94, hueDark: 94,
    chroma: 5, chromaDark: 9,
    surfaceShift: 0.2, surfaceShiftDark: -0.4,
    textSoft: false,
    borderAlpha: 0.78,
    // 自然沉稳 → 荷塘绿调（青绿大留白，与色相同调）
    defaultBackground: 'sce10',
    // C14：自然沉稳 → 圆体、中等的纱、标准宽度
    combo: { fontFamily: 'rounded', backgroundOpacity: 16, contentWidth: 'auto' },
    accent: '#9EBD87',
    // 浅色强调色必须压深：橄榄绿本身亮度高，直接用会跌破 4.5:1（与 zhuang 同理）
    accentLight: '#3F5A16'
  },
  /**
   * 极简留白（0.11.0）。色相 5° 与 wine(2°) 接近 —— 但两者靠**色度与明度**
   * 区分：`sand` 的色度只有 **2**（全场最低，现有最低是 zhuang 的 4），
   * 表面基调偏亮（+1.1），观感是「几乎无色的暖白」；而 `wine` 色度 7、
   * 基调微沉，是「浓郁的酒红」。这正是 0.6.0 那条教训的用法：
   * **色相不是唯一的区分维度**，色度与明度基调同样决定观感。
   */
  sand: {
    label: '米白暖',
    // 风格：极简、留白的纸面感
    style: '极简留白',
    hue: 5, hueDark: 5,
    chroma: 2, chromaDark: 4,
    surfaceShift: 1.1, surfaceShiftDark: -0.2,
    textSoft: false,
    borderAlpha: 0.5,
    // 极简留白 → 白底立绘（大面积留白，与「纸面感」一致）
    defaultBackground: 'off07',
    // C14：极简留白 → 无衬线、最薄的纱（露出纸面感）、宽松列宽
    combo: { fontFamily: 'sans', backgroundOpacity: 8, contentWidth: 'wide' },
    accent: '#E8D4D2',
    // 米白本身极亮，强调色必须显著压深才能当链接
    accentLight: '#7A4A44'
  },
  /**
   * 冷冽通透（0.11.0）。色相 160° 与 burst(156°) 接近 —— 同样靠色度与
   * 明度区分：`frost` 色度 **3**、表面基调**偏亮**（+1.0），是「冰白青的
   * 通透感」；`burst` 色度 8、基调深沉（−1.0），是「深夜指挥室」。
   * 两者在明暗两档上都是相反的极端，切过去一眼能看出不同。
   */
  frost: {
    label: '冰白青',
    // 风格：冷冽、通透的高调工作台
    style: '冷冽通透',
    hue: 160, hueDark: 160,
    chroma: 3, chromaDark: 5,
    surfaceShift: 1.0, surfaceShiftDark: 0.2,
    textSoft: false,
    borderAlpha: 0.55,
    // 冷冽通透 → 宽幅雪景（灰白山峦，与冰白青同调）
    defaultBackground: 'sce20',
    // C14：冷冽通透 → 无衬线、薄纱、标准宽度
    combo: { fontFamily: 'sans', backgroundOpacity: 12, contentWidth: 'auto' },
    accent: '#D2E7E0',
    // 冰白青极亮，浅色档必须压深到能当链接
    accentLight: '#1F5A50'
  },
  /**
   * 暖亮通用（0.11.0）。色相 71° 落在 zhuang(58°) 与 olive(94°) 之间 ——
   * 三者靠**色度**区分：zhuang 4 / olive 5 / amber **7**（偏高），
   * 且 amber 的明度基调最亮（+1.6），观感是「暖金的阳光工作台」。
   * 香槟金 `#C4D579` 是官方大招形态的配色，此前只用作 burst 的强调色。
   */
  amber: {
    label: '香槟金',
    // 风格：暖亮、通透的日间工作台
    style: '暖亮通用',
    hue: 71, hueDark: 71,
    chroma: 7, chromaDark: 9,
    surfaceShift: 1.6, surfaceShiftDark: -0.8,
    textSoft: false,
    borderAlpha: 0.75,
    // 暖亮通用 → 暖木长廊（暖黄灯光，与香槟金同调）
    defaultBackground: 'sce17',
    // C14：暖亮通用 → 衬线、中等的纱、标准宽度
    combo: { fontFamily: 'serif', backgroundOpacity: 14, contentWidth: 'auto' },
    accent: '#C4D579',
    // 香槟金亮度高，浅色档压深到深橄榄才能当链接
    accentLight: '#5A5A0A'
  }
}

/** 全部预设的**风格摘要**（供设置页显示「这套是什么感觉」）。 */
export const PRESET_STYLES = Object.fromEntries(
  Object.entries(PRESET_SPECS).map(([id, spec]) => [id, {
    label: spec.label,
    style: spec.style ?? '',
    background: spec.defaultBackground ?? null,
    borderAlpha: spec.borderAlpha ?? 0.8
  }])
)

/**
 * 一键推荐组合（C14）。
 *
 * 「切预设只改了配色」的下一步：预设既然是**一整套视觉性格**，那用户还得
 * 自己去壁纸条里找配套图、去排版里挑字体、去滑杆调不透明度 —— 选择成本高，
 * 而且大多数人调不出「对味」的组合。这个函数把这几项**一次配好**。
 *
 * ── 为什么是纯函数、且由宿主算 ────────────────────────────────────────
 *
 * 客户端半边是自包含 bundle（`window.__ModuleLoader__`，**不能 import src/**），
 * 所以组合定义只能跟 `presetStyles` 一样由宿主下发 —— 否则「哪套预设配哪种
 * 字体」会变成客户端里一份手抄的副本，两份一定会漂移（这个项目刚因为手抄
 * 发布清单漏掉 LICENSE 栽过一次）。
 *
 * 纯函数还带来一个好处：可以直接在 `contrast.js` 与无头测试里断言，
 * 不需要 DOM。
 *
 * ── 覆盖范围刻意收窄 ──────────────────────────────────────────────────
 *
 * 只覆盖「观感组合」四项：预设 / 壁纸 / 不透明度 / 排版。
 * **不碰** `enabled`（开关）、`scheme`（明暗偏好）、`rail`（皮肤层）、
 * `motion`（无障碍相关）—— 那些是功能与可访问性设置，不该被一个「换个风格」
 * 的按钮改掉。尤其是 `motion`：用户的「减少动态效果」是系统级偏好，
 * 被主题按钮覆盖属于越权。
 *
 * @param {string} presetId
 * @returns {{preset:string, background:string, backgroundOpacity:number, fontFamily:string, contentWidth:string}|null}
 */
export function recommendCombo (presetId) {
  const spec = PRESET_SPECS[presetId]
  if (spec === undefined) return null
  const combo = spec.combo ?? {}
  return {
    preset: presetId,
    background: spec.defaultBackground ?? 'none',
    backgroundOpacity: combo.backgroundOpacity ?? 14,
    fontFamily: combo.fontFamily ?? 'default',
    contentWidth: combo.contentWidth ?? 'auto'
  }
}

/** 全部预设的推荐组合（随 `/themes` 一起下发，客户端不重复定义）。 */
export const PRESET_COMBOS = Object.fromEntries(
  Object.keys(PRESET_SPECS).map(id => [id, recommendCombo(id)])
)

/*
 * 0.12.0 删除了两个导出：`lightestOf()` 与 `darkestOf()`。
 *
 * 两者零调用 —— 当年为「强调色要压在最亮/最暗的面上仍可读」而写，
 * 但实际实现走的是 `surfaces` + `luminance()` 的**内联比较**
 * （见下方 `buildRoles` 里的 `const lums = surfaces.map(...)`），
 * 那两个函数从未被接上。
 *
 * `luminance()` 保留：它有 12 处真实调用（含测试）。
 */

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

  // ── 风格预设：明度基调偏移（正=更亮更轻，负=更沉）────────────────────
  //
  // 这是「切预设看不出区别」的主要修复手段。旧版只换 hue，而 hue 对大面积
  // 表面的影响被下面的「按面积分配」刻意压到极低 —— 实测四套预设的 base
  // 亮度差在深色下只有 0.0001（肉眼不可辨）。明度基调才是可感知的维度。
  const shift = (dark ? spec.surfaceShiftDark : spec.surfaceShift) ?? 0
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const L = Object.fromEntries(
    Object.entries(SURFACE_L[scheme]).map(([k, v]) => [k, clamp(v + shift, 2, 99)])
  )

  // ── 风格预设：文字对比倾向（柔和 = 正文离底色近一点）────────────────
  //
  // ⚠️ 幅度只能给 **2.0** —— 实测数据：给 4.5 时 `burst/light` 与 `wine/light`
  // 的「三级文字 / 二级面」跌破 4.5:1（实测 4.20–4.41:1）。`textFaint` 要压
  // 在最亮的表面（surfaceAlt）上仍达 4.5:1，是 `contrast.js` 里最容易失败的
  // 一项，几乎没有余量。
  //
  // 也就是说：**「文字更柔和」这个风格维度的可用幅度非常小**。这是设计约束，
  // 不是可以调的参数 —— 想要更明显的差异只能靠明度基调与色度（那两个空间大）。
  // 若将来要更柔，正确做法是同时把 `SURFACE_L` 的 surfaceAlt 压深，而不是
  // 单独拉高文字明度。
  const soft = spec.textSoft === true
  const TEXT_SOFT_DELTA = 2.0
  const T = soft
    ? Object.fromEntries(
        Object.entries(TEXT_L[scheme]).map(([k, v]) => [
          k,
          scheme === 'light' ? v + TEXT_SOFT_DELTA : v - TEXT_SOFT_DELTA
        ])
      )
    : TEXT_L[scheme]

  const r = {}
  // 边框强度基调（供 deriveAliases 缩放 border-l1..l4）
  r.borderAlpha = spec.borderAlpha ?? 0.8

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

  // ── 状态色（成功 / 警告 / 错误 / 空闲）──────────────────────────────
  //
  // 外壳引用这些 token **261 次**（`state-error-primary` 一项就 142 次），
  // 而旧版**一个都没注册** —— 于是成功/警告/错误在任何预设下都长得一样
  // （外壳默认的蓝红绿），与主题色系不协调。这是「切主题只改一部分」的
  // 最大来源。
  //
  // 设计原则：**状态色必须保持语义可辨识** —— 绿就是绿、琥珀就是琥珀、
  // 红就是红。所以色相**锚定在语义色相上**（不跟随预设 hue），只让
  // **明度骨架**（跟随预设的 surfaceShift）与**色度尺度**（跟随预设的
  // chroma 性格）向主题靠拢。把「错误」染成主题色是错的：用户会认不出它。
  //
  // 明度取「该色相在对应底色上可读」的值：浅色模式压深，深色模式提亮。
  const STATE_HUE = { success: 145, warn: 42, error: 8, idle: 215 }
  //
  // ── 色度为什么用「固定基线 + 预设微调」而不是 `c * N` ──────────────
  //
  // `tint(hue, l, chroma)` 的 chroma 是 **0..255 的绝对色度**。表面色的
  // chroma 只有 4–11（刻意压得很低，大面积不显脏），所以 `c * 1.9 ≈ 21`
  // 算出来的状态色是**灰的**（实测 `#9AAFA3` 灰绿 / `#B4A29F` 灰粉）——
  // 完全起不到「一眼看出这是错误」的提示作用。
  //
  // 状态色是**语义色**，它需要自己的稳定可辨识度：基线取 60，再按预设的
  // 色度性格做 ±20% 微调（让四套预设的状态色有细微差异，但都清晰可辨）。
  // 实测 chroma≈60 得到 `#87C9A3`（明确的绿）、`#71DF9F`（鲜明的绿）。
  const STATE_CHROMA = 60
  const sc = STATE_CHROMA * (0.85 + Math.min(c, 14) / 14 * 0.3)
  /** 生成一个状态色：明度按明暗与预设偏移取值。 */
  const state = (hueDeg, lLight, lDark) =>
    tint(hueDeg, (dark ? lDark : lLight) / 100, sc)
  // 明度随预设的明度基调微调（±1.5 内），保持与表面同调
  const sShift = clamp(shift * 0.8, -1.5, 1.5)

  r.stateSuccess = state(STATE_HUE.success, 34.0 + sShift, 66.0 + sShift)
  r.stateSuccess2 = adjust(r.stateSuccess, { l: dark ? -0.10 : 0.12 })
  r.stateSuccess3 = adjust(r.stateSuccess, { l: dark ? -0.20 : 0.24 })
  r.stateWarn = state(STATE_HUE.warn, 42.0 + sShift, 72.0 + sShift)
  r.stateWarn2 = adjust(r.stateWarn, { l: dark ? -0.10 : 0.12 })
  r.stateWarn3 = adjust(r.stateWarn, { l: dark ? -0.20 : 0.24 })
  // 警告文字：要在底色上达 4.5:1，所以浅色压得更深
  r.stateWarnLabel = tint(STATE_HUE.warn, (dark ? 76.0 : 32.0) / 100, sc * 0.85)
  r.stateError = state(STATE_HUE.error, 44.0 + sShift, 68.0 + sShift)
  r.stateError2 = adjust(r.stateError, { l: dark ? -0.12 : 0.14 })
  // 空闲：低饱和中性，跟预设色相走（它不是语义色，只是「无事发生」）。
  // ⚠️ 明度必须按明暗分开：旧写法两边都用 55%，在浅色底上对比度不足
  // （实测 `zhuang/light` 与 `cyan/light` 跌破 3:1）。浅色要压到 42%。
  // 色度也用固定基线（c 的尺度算出来是灰的，同状态色的理由）。
  r.stateIdle = tint(hue, (dark ? 58.0 : 42.0) / 100, 26)

  // 深潜（推理）标签：外壳给它单独的色，14 次引用
  // 深潜（推理）标签用**预设色相**（它是主题的一部分，不是语义色），
  // 但色度同样要够：按 c 的尺度算出来会灰，所以用固定基线。
  const labelChroma = 34
  r.labelDeepDiving = tint(hue, (dark ? 70.0 : 40.0) / 100, labelChroma)
  r.labelDeepDivingShimmer = tint(hue, (dark ? 84.0 : 30.0) / 100, labelChroma * 1.2)
  r.labelShimmer = tint(hue, (dark ? 88.0 : 26.0) / 100, labelChroma * 0.7)

  // 状态色也要能压在底色上读（供 contrast.js 断言）
  r.stateSuccessInk = r.stateSuccess
  r.stateErrorInk = r.stateError

  // 四级文字：比 textFaint 更淡一档。
  // 它只在**明暗已确定**的地方才能算（浅色要更深、深色要更亮），
  // 所以放在 buildRoles 里而不是 deriveAliases。
  r.labelQuaternary = adjust(r.textFaint, { l: dark ? -0.06 : 0.08 })

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
  // ── 边框强度：按预设的 `borderAlpha` 基调缩放 ────────────────────────
  //
  // 0.8 是基准（四套预设的 borderAlpha 为 0.72/0.9/0.6/0.8），所以
  // `k = 1` 时与旧版完全一致 —— 保持向后兼容，不改变默认观感。
  // 「厚重深沉」的 0.9 会得到更实的边框，「清爽中性」的 0.6 更轻。
  const bk = (r.borderAlpha ?? 0.8) / 0.8
  const b1 = 0.07 * bk
  const b2 = 0.12 * bk
  const b3 = 0.18 * bk
  const b4 = 0.26 * bk
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
    'onboarding-checkbox-border': withAlpha(r.tintRgb, 0.2),

    /* ══════════════════════════════════════════════════════════════════
     * 补齐外壳实际使用的 alias（旧版缺 41 个）
     *
     * 外壳共 120 个 alias token，旧版只注册 77 个。**没注册的 token，外壳会
     * 用回它自己的默认值** —— 于是「切主题只有一部分控件变色」。这里按外壳
     * 的**引用次数**从高到低补齐（引用多 = 出现得多）。
     *
     * 分组依据是语义，不是字母序 —— 每一条都能一句话说清「它是什么」。
     * ══════════════════════════════════════════════════════════════════ */

    /* ── 状态色（外壳引用 261 次，旧版一个都没有）───────────────────── */
    // 语义色相锚定（绿/琥珀/红），明度与色度向预设靠拢 —— 详见 buildRoles
    'state-success-primary': r.stateSuccess,
    'state-success-secondary': r.stateSuccess2,
    'state-success-tertiary': r.stateSuccess3,
    'state-warn-primary': r.stateWarn,
    'state-warn-secondary': r.stateWarn2,
    'state-warn-tertiary': r.stateWarn3,
    'state-warn-label': r.stateWarnLabel,
    'state-error-primary': r.stateError,
    'state-error-secondary': r.stateError2,
    'state-idle-primary': r.stateIdle,
    'label-error': r.stateError,

    /* ── 推理（深潜）标签与微光 ─────────────────────────────────────── */
    'label-deep-diving': r.labelDeepDiving,
    'label-deep-diving-shimmer': r.labelDeepDivingShimmer,
    'label-shimmer': r.labelShimmer,

    /* ── 工具栏按钮（用户反馈的「某些按钮不变色」）──────────────────── */
    'button-tool-bar-fill': r.surfaceAlt,
    'button-tool-bar-fill-invisible': withAlpha(r.surfaceAlt, 0),
    'button-tool-bar-hover': r.surfaceSunken,

    /* ── 分层背景与填充（bg-l1/l2 是「层」的编号，不是 1/2 级）──────── */
    'bg-l1': r.surface,
    'bg-l2': r.surfaceAlt,
    'bg-layer-4': r.surfaceSunken,
    'fill-l1': withAlpha(r.tintRgb, b1),
    'fill-l2': withAlpha(r.tintRgb, b2),
    'fill-tertiary': withAlpha(r.tintRgb, 0.10),
    'fill-tsp-secondary': withAlpha(r.tintRgb, 0.06),

    /* ── 遮罩层（bg-mask-* 由浅到深：1 最浅、3 最深）───────────────── */
    'bg-mask-1': withAlpha(r.base, 0.35),
    'bg-mask-2': withAlpha(r.base, 0.55),
    'bg-mask-3': withAlpha(r.base, 0.75),
    'bg-mask-drop': withAlpha(r.base, 0.5),
    'bg-mask-photo': withAlpha(r.base, 0.65),

    /* ── 选区与分隔 ─────────────────────────────────────────────────── */
    'bg-document-selection': withAlpha(r.brand, 0.28),
    'separator-primary': withAlpha(r.tintRgb, 0.10),

    /* ── 代码 / 文件 diff（保持「增绿删红」的语义，但**必须是半透明底**）──
     *
     * ⚠️ 这一族全是**背景色**（壳里 `background: var(--dsw-alias-code-diff-added)`、
     * `file-diff-*-bg` 同理，全仓无一处当文字色用）。壳的默认值就是半透明
     * （暗色 `green-500-a12`、亮色 `green-500-a08`）。
     *
     * 第一版这里写成了**不透明**的状态色 —— 于是 diff 的「新增行」变成一条实心
     * 亮绿带，把上面的代码文字（浅灰白）压没了。用户截图反馈「修改的代码看不到了
     * （被色块覆盖）」。教训：**给背景用的 token 别用不透明的正文色**。
     *
     * 修法：用「代码块底色 + 状态色」按比例合成一个**不透明**的浅色调 ——
     *   · 视觉上与「半透明绿铺在代码底上」等价；
     *   · 但它是实色，diff 行上的文字对比度**可以算**，能被对比度套件盯住。
     * 比例对齐壳的默认观感（12% / 8%）。
     */
    'code-diff-added': diffTint(r.code, r.stateSuccess, r.text),
    'code-diff-deleted': diffTint(r.code, r.stateError, r.text),
    'file-diff-added-bg': diffTint(r.code, r.stateSuccess, r.text),
    'file-diff-added-gutter': diffTint(r.code, r.stateSuccess, r.text),
    'file-diff-added-marker': withAlpha(r.stateSuccess, 0.55),
    'file-diff-deleted-bg': diffTint(r.code, r.stateError, r.text),
    'file-diff-deleted-gutter': diffTint(r.code, r.stateError, r.text),
    'file-diff-deleted-marker': withAlpha(r.stateError, 0.55),

    /* ── 其余文字层级与浮标 ─────────────────────────────────────────── */
    'label-quaternary': r.labelQuaternary,
    'tooltip-key-bg': adjust(r.tooltip, { l: 0.06 })
  }
}

/**
 * diff 行的底色：**代码块底色 + 状态色**按比例合成（返回不透明实色）。
 *
 * 为什么不直接用半透明色：`--dsw-alias-code-diff-added` 是铺在**代码块底色**上的
 * 一层纱，半透明时「行上的文字到底对比度多少」没法静态算 —— 而这一族正好踩过坑
 * （第一版给了不透明状态色，把文字压没了）。合成成实色之后，对比度可以算、
 * 可以被 `contrast.js` 盯住，观感与「纱铺在底上」等价。
 *
 * 明暗比例**从底色自身的明度判断**（不是从外部传 `dark`）：
 * `deriveAliases(r)` 只拿得到色阶，拿不到明暗标记 —— 第一版在这里写了 `dark`，
 * 直接 `ReferenceError`。底色亮度 < 0.5 即视为深色主题。
 *
 * @param {string} surface 代码块底色
 * @param {string} tint 状态色（成功绿 / 错误红）
 * @param {number} [darkRatio] 深色主题下的比例（默认 0.12，对齐外壳 green-500-a12）
 * @param {number} [lightRatio] 浅色主题下的比例（默认 0.08，对齐 green-500-a08）
 */
function diffTint (surface, tint, foreground) {
  // 取**刚好够辨认的最小浓度** —— 两个约束同时满足就停：
  //   ① 与代码底色看得出区别（对比度 ≥ 1.18：低于这个数在深色底上几乎看不出来）；
  //   ② 行上文字读得清（前景色对比度 ≥ 6:1，比 4.5 留余量 —— 行里还有次级文字色）。
  //
  // 为什么用「求解」而不是拍一个比例：不同预设的代码底色明暗差得多
  // （浅色 #F0F0EB / 深色 #2E2E25），同一个比例在两边观感完全不同。
  // 第一版把方向搞反了 —— 取「文字还能读的最大浓度」，结果浅色下浓到像块重高亮。
  const text = foreground ?? '#ffffff'
  for (const ratio of [0.06, 0.09, 0.12, 0.16, 0.20, 0.24, 0.28]) {
    const mixed = mixColor(surface, tint, ratio)
    const delta = contrast(mixed, surface)
    const textRatio = contrast(text, mixed)
    if (delta !== null && delta >= 1.18 && textRatio !== null && textRatio >= 6) return mixed
  }
  // 极端配色下都不满足：退回一个「看得见但轻」的值，交给对比度套件报警
  return mixColor(surface, tint, 0.16)
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

/**
 * 代码高亮的 token 键（对外壳真实变量名 `--shiki-token-<key>`）。
 *
 * **这是一份实测记录，不是猜的**：外壳的 `:root` 声明了这 9 个
 * （另有 `--shiki-background` / `--shiki-foreground`，那两个我们已在
 * `structureCss` 里重声明）。写错键名不会报错，只会静默失效 ——
 * 所以 `contrast.js` 会拿这份清单逐条校验。
 */
export const SHIKI_TOKEN_KEYS = [
  'comment', 'constant', 'function', 'keyword', 'link',
  'parameter', 'punctuation', 'string', 'string-expression'
]

/** 代码 token 的对比度下限（正文级；代码字号小，不给折扣）。 */
export const CODE_TOKEN_MIN_RATIO = 4.5

/**
 * 代码高亮的 token 色 —— 让语法高亮跟随预设。
 *
 * ── 为什么需要 ──────────────────────────────────────────────────────
 * 外壳给的是**写死的 OpenColor 字面色**（关键字粉 `#d6336c`、函数紫
 * `#6741d9`、字符串绿 `#2f9e44`…，暗色一套近似值），与四套预设毫无关系 ——
 * 切预设时代码块是唯一「不跟随」的大面积区域。
 *
 * ── 映射原则：语义优先，只有强调色家族跟随预设 ──────────────────────
 * 语法高亮有约定俗成的语义，全染成主题色就没有层次了。所以：
 *   · **保留语义**：字符串 = 成功绿、常量 = 警告琥珀、注释 = 弱化文字 ——
 *     这三条与 `STATE_HUE` 同源，本来就已经随预设的**明度骨架/色度**走；
 *   · **跟随预设**：关键字 = 预设强调色；函数 = 强调色提亮/压深一档
 *     （同族但可区分）；链接 = `link`；
 *   · 标点/参数用次级文字色，避免满屏彩色。
 *
 * ── 门禁（宁可少染，也不给不可读的代码）────────────────────────────
 * 每个 token 都要在**代码块底色**（`r.code`）上达到
 * `CODE_TOKEN_MIN_RATIO`；达不到就**不发这一条**，客户端不写该变量 →
 * 保留外壳默认色。`contrast.js` 有成对断言 + 「不许全被门禁砍光」的下限断言。
 */
export function codeTokens (presetId, scheme, accentHue = ACCENT_HUE_PRESET) {
  const r = buildRoles(presetId, scheme, accentHue)
  const dark = scheme === 'dark'
  const want = {
    keyword: r.brand,
    function: adjust(r.brand, { l: dark ? 0.10 : -0.10 }),
    string: r.stateSuccess,
    constant: r.stateWarn,
    comment: r.textFaint,
    parameter: r.textMuted,
    punctuation: r.textMuted,
    link: r.link,
    'string-expression': r.stateSuccess2 ?? r.stateSuccess
  }
  const out = {}
  for (const key of SHIKI_TOKEN_KEYS) {
    const picked = pickReadable(want[key], r.code, dark)
    if (picked !== null) out[key] = picked
  }
  return out
}

/**
 * 在代码块底色上挑一个「够读」的版本。
 *
 * 先试原色；不够就沿明度方向校正（**浅色压深、深色提亮**）最多两档；
 * 两档都不够 → 返回 `null`（该 token 不染，保留外壳默认色）。
 *
 * 为什么是「校正」而不是「砍掉」：实测浅色下琥珀常量色是 3.7:1、酒红预设的
 * 绿字符串刚好 4.4:1 —— 都只差一点。直接放弃会让代码块里**留下一个 OpenColor
 * 蓝**（外壳默认）与周围主题色打架；压深一档既过门禁又保住语义（`adjust`
 * 只动明度，「琥珀还是琥珀、绿还是绿」）。
 */
function pickReadable (base, surface, dark) {
  if (typeof base !== 'string') return null
  for (const step of [0, 0.06, 0.12, 0.18]) {
    const candidate = step === 0 ? base : adjust(base, { l: dark ? step : -step })
    const ratio = contrast(candidate, surface)
    if (ratio !== null && ratio >= CODE_TOKEN_MIN_RATIO) return candidate
  }
  return null
}
