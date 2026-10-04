/**
 * 庄方宜主题 · 设置模型（Host / Client 共用，唯一默认值来源）
 *
 * 持久化位置：`$DSH_HOME/zhuang-fangyi/settings.json`
 */

import { DEFAULT_PRESET, PRESET_IDS } from './palette.js'

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

/** 设置结构版本。v2 加入顶栏 / 右侧观测栏 / 头像气泡重绘。 */
export const SETTINGS_VERSION = 2

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
    backgroundCustom: null,
    contourBorder: true,
    potentialDots: false,
    heroAvatar: true,
    titlebarFollow: true,
    accentGlow: false,
    // v2 新增：皮肤层
    topbar: true,
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
  out.backgroundOpacity = clamp(input.backgroundOpacity, 0, 30, base.backgroundOpacity)
  out.backgroundBlur = clamp(input.backgroundBlur, 0, 16, base.backgroundBlur)
  if (POSITIONS.includes(input.backgroundPosition)) out.backgroundPosition = input.backgroundPosition
  if (typeof input.backgroundCustom === 'string' && input.backgroundCustom.length > 0) {
    out.backgroundCustom = input.backgroundCustom
  }
  for (const key of [
    'contourBorder', 'potentialDots', 'heroAvatar', 'titlebarFollow', 'accentGlow',
    // v2 皮肤层
    'topbar', 'rail', 'avatarBubbles'
  ]) {
    if (typeof input[key] === 'boolean') out[key] = input[key]
  }
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
