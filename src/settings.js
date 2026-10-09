/**
 * 庄方宜主题 · 设置模型（Host / Client 共用，唯一默认值来源）
 *
 * 持久化位置：`$DSH_HOME/zhuang-fangyi/settings.json`
 */

import {
  DEFAULT_PRESET,
  PRESET_IDS,
  ACCENT_HUE_PRESET,
  normalizeAccentHue
} from './palette.js'
import { normalizeFontFamily, normalizeFontScale } from './fonts.js'
import { WALLPAPERS, BACKGROUND_NONE } from './wallpaperCatalog.js'

/** 明暗模式。`system` 走 overrideTokens（不改 preference，保住跟随系统）。 */
export const SCHEMES = ['system', 'light', 'dark']

/**
 * 背景预设 id → art 目录下的文件名。
 *
 * 0.8.0 起从 `wallpaperCatalog.js` 派生（58 张手抄两遍必然漂移 —— 本仓库
 * 在 `PRESETS` / `FONTS` 上栽过同一种跟头）。导出的形状不变（`none: null` +
 * `id → 'wallpaper-<id>.webp'`），消费方与测试都不用动。
 */
export const BACKGROUNDS = {
  [BACKGROUND_NONE]: null,
  ...Object.fromEntries(WALLPAPERS.map((w) => [w.id, w.file]))
}

/** 壁纸的合法 id（含 `none`，不含 `'custom'` —— 那是运行时上传的哨兵值）。 */
export const BACKGROUND_IDS = BACKGROUND_NONE in BACKGROUNDS ? Object.keys(BACKGROUNDS) : []

/** 背景定位方式。 */
export const POSITIONS = ['cover', 'right', 'tile']

/**
 * 「自定义背景」的哨兵值。
 *
 * `settings.background` 复用同一个字段（这样「当前选哪张壁纸」只有一个来源，
 * 壁纸选择器不必分两套状态），但 `'custom'` **不在** `BACKGROUNDS` 里 ——
 * 它表示「用 `customBackground` 里那个上传的文件」。
 *
 * 为什么不塞进 `BACKGROUNDS`：那张表是**内置素材的单一事实来源**，还被
 * `artWhitelist()` 与 `structureCss()` 消费（后者在模块加载时静态生成
 * `--zf-art-<id>` 变量）。把运行时的自定义图混进去，会让「静态可枚举」
 * 这个前提失效。
 */
export const CUSTOM_BACKGROUND = 'custom'

/**
 * 背景不透明度上限。
 *
 * 演变：30% → 45% → 90%。
 *
 *   · 30% 是「alpha 连乘」bug 未修时的保守值 —— 那时纱层叠了好几层，
 *     30% 之外都看不清正文；
 *   · 连乘修掉后（body/frame/content 全透明、纱只上一次）提到 45%；
 *   · 用户要求「观测台和侧栏能不能是透明的」→ 再提到 **90%**：
 *     45% 时纱仍有 55% 不透明，壁纸透不出来，够不到「透明」。
 *
 * ⚠️ 90% 意味着纱只剩 10% —— 正文可读性靠**观测栏自己的 backdrop-filter
 * 模糊**兜（`.zf-rail` 有 18px 模糊）。侧栏没有模糊，所以在很高档位下
 * 文字可能与壁纸细节打架；这是用户的选择，滑杆就在设置页，随时可回调。
 * 默认值仍是 14%（观感稳妥）。
 */
export const BG_OPACITY_MAX = 90

/**
 * 设置结构版本。
 *
 *   v1 → v2：加入观测栏 / 头像气泡重绘（顶栏后来移除）
 *   v2 → v3：加入强调色色相覆盖（`accentHue`）与动效模式（`motion`）
 *   v3 → v4：加入排版（`fontFamily` / `fontScale`）
 *   v4 → v5：加入阅读宽度（`contentWidth`）
 *   v5 → v6：加入明暗分档预设（`presetLight` / `presetDark`）
 *            与壁纸轮播（`backgroundRotate` / `backgroundRotateOrder`）
 *   v6 → v7：加入自定义背景（`customBackground`）
 *   v7 → v8：加入轮播自定义列表（`rotateLists` / `rotateActive`）
 */
export const SETTINGS_VERSION = 8

/**
 * 动效模式取值。
 *
 *   `on`      强制开启动效（即使系统开了「减少动态效果」）
 *   `auto`    跟随系统 `prefers-reduced-motion`（默认）
 *   `reduced` 强制静止
 *
 * 用户反馈要「跟随系统和关闭之外还要有一个开启」—— 因为系统层面开了
 * 减少动效、但希望这个插件仍然有动效时，`auto` 无法表达。
 */
export const MOTION_MODES = ['on', 'auto', 'reduced']

/** 右侧观测栏宽度范围（px）。 */
export const RAIL_WIDTH = { min: 240, max: 380, default: 288 }

/**
 * 阅读宽度（正文列宽）三档。
 *
 * 外壳把 `--dsh-chat-content-width` 声明在**承载它的那个元素自己**身上
 * （实测源码：`[data-conversation-content]` 上写着
 * `--dsh-chat-content-width: var(--dsh-chat-user-width, clamp(680px, calc(列宽 * .64), 920px))`）。
 * 自定义属性按最近祖先解析 —— 元素**自己的**声明永远赢过继承值，所以
 * 写 `html` / `body` 都没用，必须覆盖到那个元素（客户端用 `!important` 行内写）。
 *
 * `auto` = 不干预，交还外壳（列宽的 64%，上限 920px）。
 */
export const CONTENT_WIDTH_MODES = ['auto', 'compact', 'wide']
export const CONTENT_WIDTH_PX = { compact: '760px', wide: '1080px' }

/**
 * 壁纸轮播间隔（C15）。
 *
 * `off` = 不轮播（默认）。三档固定值，不做自由输入 —— 轮播是「偶尔换个心情」，
 * 不需要精确控制；档位制也让 UI 与断言都简单。
 */
export const ROTATE_MODES = ['off', '60s', '5m', '30m']

/** 间隔档位 → 毫秒（`off` 不在表里）。 */
export const ROTATE_MS = { '60s': 60_000, '5m': 300_000, '30m': 1_800_000 }

/** 轮播顺序：顺序 / 随机。 */
export const ROTATE_ORDERS = ['sequential', 'random']

/**
 * 「跟随主预设」的哨兵值。
 *
 * `presetLight` / `presetDark` 用 `null` 表示「不分档，沿用 `preset`」——
 * **默认必须是 null**：老设置文件里没有这两个键，若默认成某个具体预设，
 * 升级后所有用户的明暗分档会被静默打开（表现为「切明暗时配色突然变了」）。
 * 默认 null 才能保证 v5 → v6 的行为**一字不变**。
 */
export const PRESET_FOLLOW = null

/** 默认设置。 */
export function defaultSettings () {
  return {
    version: SETTINGS_VERSION,
    enabled: true,
    preset: DEFAULT_PRESET,
    scheme: 'system',
    background: 'sakura',
    backgroundOpacity: 14,
    backgroundBlur: 0,
    backgroundPosition: 'cover',
    contourBorder: true,
    potentialDots: false,
    heroAvatar: true,
    titlebarFollow: true,
    accentGlow: false,
    // v3 新增：强调色色相覆盖（'preset' = 沿用预设自带强调色）+ 动效模式 + 启动动效
    accentHue: ACCENT_HUE_PRESET,
    motion: 'auto',
    splash: true,
    // v4 新增：排版（风格预设的第四个维度）
    fontFamily: 'default',
    fontScale: 1,
    // v5 新增：阅读宽度（正文列宽三档）
    contentWidth: 'auto',
    // v6 新增：明暗分档预设（null = 沿用 preset，行为与 v5 一致）+ 壁纸轮播
    presetLight: PRESET_FOLLOW,
    presetDark: PRESET_FOLLOW,
    backgroundRotate: 'off',
    backgroundRotateOrder: 'sequential',
    // v7 新增：自定义背景（上传的图，存在 $DSH_HOME/zhuang-fangyi/backgrounds/）
    customBackground: null,
    // v8 新增：轮播自定义列表。多个命名列表并存，`rotateActive` 指向生效的那一个
    //（null = 全部内置）。列表成员只能是内置壁纸 id —— 自定义上传图会被删除，
    // 进列表会产生悬空引用（0.7.0 起上传图本就不在轮播池里，边界保持一致）。
    rotateLists: [],
    rotateActive: null,
    // v2 新增：皮肤层（顶栏已移除，字段不再使用）
    rail: true,
    railWidth: RAIL_WIDTH.default,
    avatarBubbles: true
  }
}

/** 夹取数值到范围。 */
function clamp (value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 轮播自定义列表的数量上限（设置文件是整份持久化的 JSON，防膨胀）。 */
export const ROTATE_LISTS_MAX = 20

/**
 * 归一化轮播自定义列表（v8）。
 *
 * 规则（全部**静默丢弃**而不是抛错 —— 设置归一化的惯例是「尽量救、救不了
 * 就丢」，宿主不能因为一份坏设置拒绝启动）：
 *   · 只收数组，最多 `ROTATE_LISTS_MAX` 个；
 *   · 每项 `{id, name, ids}`：id 必须 `r-<小写字母数字>`（客户端生成）；
 *     name 去首尾空白后 1–24 个字；ids 只认内置壁纸 id（排除 `none` 与
 *     `custom` —— 上传图会被删除，进列表会产生悬空引用），去重，最多 58；
 *   · 形状不对的项整个丢弃；id 重复保留第一个。
 */
export function normalizeRotateLists (input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const raw of input) {
    if (out.length >= ROTATE_LISTS_MAX) break
    if (raw === null || typeof raw !== 'object') continue
    const id = typeof raw.id === 'string' ? raw.id : ''
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!/^r-[0-9a-z]+$/.test(id) || seen.has(id)) continue
    if (name.length < 1 || name.length > 24) continue
    const ids = Array.isArray(raw.ids)
      ? [...new Set(raw.ids.filter(v =>
          typeof v === 'string' && v !== BACKGROUND_NONE &&
          v !== CUSTOM_BACKGROUND && v in BACKGROUNDS))]
      : []
    seen.add(id)
    out.push({ id, name, ids })
  }
  return out
}

/**
 * 轮播候选池（v8）。
 *
 *   · 未激活列表 / 指向的列表不存在 → 全部内置（旧行为，58 张）；
 *   · 激活列表 → 它的成员（逐个核对仍存在，防将来 id 退役）；
 *   · 成员为空 → 回落全部内置。空池子会让 `nextWallpaper` 返回 `undefined`
 *     并把 `settings.background` 写坏，宁可退回旧行为；
 *   · 成员只有 1 个 → 原样返回（轮播每 tick 都选中同一张，无害；
 *     UI 会提示用户去加图）。
 */
export function rotatePoolOf (settings) {
  const all = Object.keys(BACKGROUNDS).filter(k => k !== BACKGROUND_NONE)
  if (settings === null || settings === undefined) return all
  if (typeof settings.rotateActive !== 'string') return all
  const list = (Array.isArray(settings.rotateLists) ? settings.rotateLists : [])
    .find(l => l.id === settings.rotateActive)
  if (!list) return all
  const pool = (Array.isArray(list.ids) ? list.ids : []).filter(id => id in BACKGROUNDS)
  return pool.length >= 1 ? pool : all
}

/**
 * 归一化「自定义背景」那条记录。
 *
 * 只认我们自己生成的形状与文件名（`custom-<…>.<ext>`）—— 文件名是**宿主**
 * 生成的，这里再做一次格式校验，是为了挡住手改设置文件塞进来的路径
 * （`../../etc/passwd` 之类）。真正的路径安全在宿主侧的 `path.basename`
 * + 目录白名单，这里是第二道。
 *
 * 尺寸可选但**必须成对**（只有宽或只有高没用）—— 它决定竖图要不要 contain。
 */
function normalizeCustomBackground (input) {
  if (input === null || typeof input !== 'object') return null
  const file = input.file
  if (typeof file !== 'string') return null
  if (!/^custom-[0-9a-z-]+\.(png|jpg|gif|webp)$/.test(file)) return null
  const width = Number(input.size?.width)
  const height = Number(input.size?.height)
  const valid = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
  return {
    file,
    bytes: Number.isFinite(Number(input.bytes)) ? Number(input.bytes) : 0,
    size: valid ? { width, height } : null,
    addedAt: Number.isFinite(Number(input.addedAt)) ? Number(input.addedAt) : 0
  }
}

/** 从任意来源归一化为合法设置；损坏字段逐项回落，不整体丢弃。 */
export function normalizeSettings (input) {
  const base = defaultSettings()
  if (input === null || typeof input !== 'object') return base
  const out = { ...base }

  if (typeof input.enabled === 'boolean') out.enabled = input.enabled
  if (PRESET_IDS.includes(input.preset)) out.preset = input.preset
  if (SCHEMES.includes(input.scheme)) out.scheme = input.scheme

  // v7：自定义背景。先归一化 `customBackground`，再决定 `background` 能否取
  // `'custom'` —— 顺序不能反，否则「选了自定义但那条记录坏了」会落成一个
  // 悬空引用（客户端拿着 `custom` 却找不到文件）。
  out.customBackground = normalizeCustomBackground(input.customBackground)
  if (typeof input.background === 'string' && input.background in BACKGROUNDS) {
    out.background = input.background
  } else if (input.background === CUSTOM_BACKGROUND) {
    // 用户显式选了「自定义」：
    //   · 记录有效 → 就用它；
    //   · 记录没了（文件被删 / 字段损坏）→ 回落 `none`。
    //
    // ⚠️ 这里**必须给 `custom` 一个落点**，不能「不匹配就沿用默认值」——
    // 那会让 `out.background` 停在 `defaultSettings()` 的 `sakura`，
    // 于是「我选的图没了」变成「莫名冒出一张官方壁纸」，比没有壁纸更困惑。
    // 实测踩过（归一化只写了 if/else-if，没写 else）。
    out.background = out.customBackground !== null ? CUSTOM_BACKGROUND : 'none'
  }

  out.backgroundOpacity = clamp(input.backgroundOpacity, 0, BG_OPACITY_MAX, base.backgroundOpacity)
  out.backgroundBlur = clamp(input.backgroundBlur, 0, 16, base.backgroundBlur)
  if (POSITIONS.includes(input.backgroundPosition)) out.backgroundPosition = input.backgroundPosition
  // `backgroundCustom` 已删除：它是个从未实现的死字段 —— 白名单只认固定
  // 16 张图，没有任何代码读它。旧设置文件里若有，会在归一化时被安全丢弃。
  for (const key of [
    'contourBorder', 'potentialDots', 'heroAvatar', 'titlebarFollow', 'accentGlow',
    // v2 皮肤层（`topbar` 已随顶栏移除一并删除）
    'rail', 'avatarBubbles',
    // v3：启动动效开关
    'splash'
  ]) {
    if (typeof input[key] === 'boolean') out[key] = input[key]
  }
  // v3：强调色色相（'preset' 或 0..360，非法回落 'preset'）
  out.accentHue = normalizeAccentHue(input.accentHue)
  // v3：动效模式
  if (MOTION_MODES.includes(input.motion)) out.motion = input.motion
  // v4：排版（非法值一律回落默认，保证不会给出坏字体栈/坏字号）
  out.fontFamily = normalizeFontFamily(input.fontFamily)
  out.fontScale = normalizeFontScale(input.fontScale)
  // v5：阅读宽度（白名单三档，非法回落 auto = 交还外壳）
  if (CONTENT_WIDTH_MODES.includes(input.contentWidth)) out.contentWidth = input.contentWidth
  // v6：明暗分档预设。`null` / 缺失 / 非法值一律回落「跟随主预设」——
  // 注意**不能**回落成某个具体预设，否则升级会静默改变用户的观感。
  out.presetLight = PRESET_IDS.includes(input.presetLight) ? input.presetLight : PRESET_FOLLOW
  out.presetDark = PRESET_IDS.includes(input.presetDark) ? input.presetDark : PRESET_FOLLOW
  // v6：壁纸轮播
  if (ROTATE_MODES.includes(input.backgroundRotate)) out.backgroundRotate = input.backgroundRotate
  if (ROTATE_ORDERS.includes(input.backgroundRotateOrder)) {
    out.backgroundRotateOrder = input.backgroundRotateOrder
  }
  // v8：轮播自定义列表
  out.rotateLists = normalizeRotateLists(input.rotateLists)
  // rotateActive 必须指向现存列表，否则回落 null（= 全部内置）——
  // 与 presetLight/presetDark 同一原则：非法值不能回落成另一个具体选择。
  out.rotateActive = typeof input.rotateActive === 'string' &&
    out.rotateLists.some(l => l.id === input.rotateActive)
    ? input.rotateActive
    : null
  out.railWidth = clamp(input.railWidth, RAIL_WIDTH.min, RAIL_WIDTH.max, base.railWidth)
  out.version = SETTINGS_VERSION
  return out
}

/*
 * 0.12.0 删除了两个导出：`backgroundArtId()` 与 `customBackgroundOf()`。
 *
 * 两者都**零调用**，而且 `customBackgroundOf` 的注释还写着「客户端与宿主
 * 都用它分流」—— 与事实不符：实际分流在客户端 `artSrcOf()` 里**内联**了
 * （它要同时处理内置 / 自定义 / `none` 三种情况，共用一个函数反而更绕）。
 *
 * 保留「导出但没人用」的函数比删掉更糟：它会让下一个读代码的人以为
 * 那是权威入口，改完才发现根本没生效。这类「注释与代码不符」是本仓库
 * 反复出现的问题（见 CHANGELOG 里多条修复）。
 */

/**
 * 某个明暗档位**实际生效**的预设（C13）。
 *
 * 明暗分档是「可选叠加」：没设分档就沿用主预设 `preset`，所以：
 *   · 老设置文件（无这两个键）→ 恒等于 `preset`，行为与 v5 完全一致；
 *   · 只在用户显式选了分档后才分叉。
 *
 * ⚠️ **所有读预设的地方都必须走这个函数**，不要直接读 `settings.preset` ——
 * 漏掉一处就会出现「配色换了但材质 / 代码高亮 / 壁纸推荐没换」这种半生效状态。
 *
 * @param {object} settings 归一化后的设置
 * @param {'light'|'dark'} scheme
 * @returns {string} 预设 id
 */
export function presetForScheme (settings, scheme) {
  if (settings === null || settings === undefined) return DEFAULT_PRESET
  const specific = scheme === 'dark' ? settings.presetDark : settings.presetLight
  if (PRESET_IDS.includes(specific)) return specific
  return PRESET_IDS.includes(settings.preset) ? settings.preset : DEFAULT_PRESET
}

/**
 * 是否启用了明暗分档（两者都没设 = 没启用）。
 *
 * 用途：跟随系统（`scheme: 'system'`）时外壳的明暗由系统决定，此时必须用
 * `overridesForPair` 把两个档位的 token 打包成一个 `{light, dark}` 对 ——
 * 单一预设的 `overridesFor` 表达不了「浅色 A / 深色 B」。
 */
export function hasSchemePresets (settings) {
  if (settings === null || settings === undefined) return false
  return PRESET_IDS.includes(settings.presetLight) || PRESET_IDS.includes(settings.presetDark)
}
