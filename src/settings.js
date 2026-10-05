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

/** 明暗模式。`system` 走 overrideTokens（不改 preference，保住跟随系统）。 */
export const SCHEMES = ['system', 'light', 'dark']

/** 背景预设 id → art 目录下的文件名（由 tools/prepare-art.py 产出）。 */
export const BACKGROUNDS = {
  none: null,
  sakura: 'wallpaper-sakura.webp',
  promo: 'wallpaper-promo.webp',
  pool: 'wallpaper-pool.webp',
  ultrawide: 'wallpaper-ultrawide.webp',
  dark: 'wallpaper-dark.webp',
  portrait: 'wallpaper-portrait.webp',
  vertical: 'wallpaper-vertical.webp',
  contour: 'wallpaper-contour.webp'
}

/** 背景定位方式。 */
export const POSITIONS = ['cover', 'right', 'tile']

/**
 * 背景不透明度上限。
 *
 * 原 30% 是在「alpha 连乘」bug 未修时的保守值 —— 那时纱层叠了好几层，
 * 30% 之外的都看不清正文。连乘修掉后（body/frame/content 全透明、
 * 纱只上一次），30% 就成了无谓的天花板：实测 45% 在亮色下正文依然清晰。
 */
export const BG_OPACITY_MAX = 45

/**
 * 设置结构版本。
 *
 *   v1 → v2：加入观测栏 / 头像气泡重绘（顶栏后来移除）
 *   v2 → v3：加入强调色色相覆盖（`accentHue`）与静止模式（`motion`）
 */
export const SETTINGS_VERSION = 3

/** 静止模式取值。`auto` = 跟随系统 `prefers-reduced-motion`。 */
export const MOTION_MODES = ['auto', 'reduced']

/** 右侧观测栏宽度范围（px）。 */
export const RAIL_WIDTH = { min: 240, max: 380, default: 288 }

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
    // v3 新增：强调色色相覆盖（'preset' = 沿用预设自带强调色）+ 静止模式
    accentHue: ACCENT_HUE_PRESET,
    motion: 'auto',
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

/** 从任意来源归一化为合法设置；损坏字段逐项回落，不整体丢弃。 */
export function normalizeSettings (input) {
  const base = defaultSettings()
  if (input === null || typeof input !== 'object') return base
  const out = { ...base }

  if (typeof input.enabled === 'boolean') out.enabled = input.enabled
  if (PRESET_IDS.includes(input.preset)) out.preset = input.preset
  if (SCHEMES.includes(input.scheme)) out.scheme = input.scheme
  if (typeof input.background === 'string' && input.background in BACKGROUNDS) {
    out.background = input.background
  }
  out.backgroundOpacity = clamp(input.backgroundOpacity, 0, BG_OPACITY_MAX, base.backgroundOpacity)
  out.backgroundBlur = clamp(input.backgroundBlur, 0, 16, base.backgroundBlur)
  if (POSITIONS.includes(input.backgroundPosition)) out.backgroundPosition = input.backgroundPosition
  // `backgroundCustom` 已删除：它是个从未实现的死字段 —— 白名单只认固定
  // 16 张图，没有任何代码读它。旧设置文件里若有，会在归一化时被安全丢弃。
  for (const key of [
    'contourBorder', 'potentialDots', 'heroAvatar', 'titlebarFollow', 'accentGlow',
    // v2 皮肤层（`topbar` 已随顶栏移除一并删除）
    'rail', 'avatarBubbles'
  ]) {
    if (typeof input[key] === 'boolean') out[key] = input[key]
  }
  // v3：强调色色相（'preset' 或 0..360，非法回落 'preset'）
  out.accentHue = normalizeAccentHue(input.accentHue)
  // v3：静止模式
  if (MOTION_MODES.includes(input.motion)) out.motion = input.motion
  out.railWidth = clamp(input.railWidth, RAIL_WIDTH.min, RAIL_WIDTH.max, base.railWidth)
  out.version = SETTINGS_VERSION
  return out
}

/**
 * 是否可以用当前设置生效。
 * 背景选 `none` 或自定义但文件缺失时，只降级背景、不影响配色。
 */
export function backgroundArtId (settings) {
  if (settings.background === 'none') return null
  return settings.background
}
