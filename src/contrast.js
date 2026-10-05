/**
 * 庄方宜主题 · 对比度自检
 *
 * 用法：`node src/contrast.js`（或 `npm run contrast`）
 *
 * 对 4 套预设 × 浅色/深色逐项断言 WCAG 对比度。改配色后必须重跑，
 * 这是「浅色和深色都要能看」的可执行保证，而不是靠肉眼。
 *
 * 阈值：
 *   正文 4.5:1（WCAG AA 普通文本）
 *   大字/图形/边框 3:1（WCAG AA 非文本对比）
 *   焦点环 3:1（可访问性要求焦点指示与背景可区分）
 *   开关滑块 1.5:1（滑块与轨道需可分辨）
 */

import { PRESETS, PRESET_IDS, buildTokens, tokenName } from './palette.js'
import { contrast } from './palette.js'

/**
 * 外壳真实存在的 token 名（从 `dsh-client-ui-theme/lib/client.js` 的
 * `body{}` / `body[data-ds-dark-theme]{}` 两套调色板导出，共 107 个 alias
 * 加 19 级色阶）。用来抓住「前缀写错 → 静默失效」这类 bug：
 * 拼错的 token 不会报错，只会变成外壳不认识的变量。
 */
const SHELL_TOKENS = new Set([
  // 色阶（19）
  ...['00', '50', '60', '75', '100', '150', '200', '300', '400', '500',
    '600', '700', '750', '800', '850', '875', '900', '950', '1000']
    .map((s) => `--dsw-static-neutral-bluish-${s}`),
  // alias（107）
  ...[
    'bg-base', 'bg-document-preview', 'bg-document-selection', 'bg-layer-1', 'bg-layer-2',
    'bg-layer-3', 'bg-mask-1', 'bg-mask-2', 'bg-mask-3', 'bg-mask-drop', 'bg-mask-photo',
    'bg-module-platform', 'bg-multi-select', 'bg-overlay', 'bg-skeleton', 'border-inverted',
    'border-inverted2', 'border-l1', 'border-l2', 'border-l2-darkmode-thin', 'border-l3',
    'border-l4', 'brand-primary', 'brand-primary-invert', 'brand-primary-new-color',
    'brand-text', 'button-contrast-fill', 'button-elevated-fill', 'button-floating-fill',
    'button-floating-hover', 'button-ghost-active-border', 'button-ghost-active-fill',
    'button-ghost-active-hover', 'button-info-fill', 'button-info-hover', 'button-primary-dimmed',
    'button-primary-fill', 'button-primary-hover', 'button-tool-bar-fill',
    'button-tool-bar-fill-invisible', 'button-tool-bar-hover', 'code-diff-added',
    'code-diff-deleted', 'file-diff-added-bg', 'file-diff-added-gutter',
    'file-diff-added-marker', 'file-diff-deleted-bg', 'file-diff-deleted-gutter',
    'file-diff-deleted-marker', 'interactive-bg-active', 'interactive-bg-hover',
    'interactive-bg-hover-accent', 'interactive-bg-hover-danger', 'interactive-bg-hover-solid',
    'label-caption', 'label-deep-diving', 'label-deep-diving-shimmer', 'label-dimmed',
    'label-document-preview', 'label-primary', 'label-primary-bluish', 'label-primary-dimmed',
    'label-primary-foreground', 'label-primary-inverted', 'label-secondary', 'label-shimmer',
    'label-tertiary', 'link', 'markdown-citation', 'markdown-code-block',
    'markdown-code-block-banner', 'markdown-code-segment-selected',
    'markdown-code-segment-unselected', 'markdown-inline-code', 'markdown-placeholder',
    'markdown-tag', 'menu-group-header-fill', 'menu-icon', 'onboarding-accent',
    'onboarding-card-fill', 'onboarding-checkbox-border', 'onboarding-secondary-fill',
    'scrollbar-bg-l1', 'scrollbar-bg-l2', 'scrollbar-hover-l1', 'scrollbar-hover-l2',
    'settings-card-fill', 'settings-card-stroke', 'state-business-primary',
    'state-business-tertiary', 'state-error-primary', 'state-error-secondary',
    'state-idle-primary', 'state-success-primary', 'state-success-secondary',
    'state-success-tertiary', 'state-warn-label', 'state-warn-primary',
    'state-warn-secondary', 'state-warn-tertiary', 'switch-thumb', 'toast-bg', 'toast-label',
    'tooltip-bg', 'tooltip-key-bg', 'turn-trigger-bg', 'turn-trigger-bg-hover'
  ].map((s) => `--dsw-alias-${s}`),
  // specific（外壳里没有 alias 前缀的一族）
  ...[
    'specific-bubble', 'specific-bubble-highlight', 'specific-input-major',
    'specific-login-input', 'specific-menu', 'specific-selector',
    'specific-sidebar-fill', 'specific-sidebar-nav-item-active',
    'specific-sidebar-nav-item-active-accent', 'specific-sidebar-nav-item-hover', 'specific-tip'
  ].map((s) => `--dsw-${s}`),
  // 外壳未定义、由本插件补上的 token（新增而非覆盖）
  '--dsw-alias-focus-ring-color'
])

/** 断言项：[说明, 前景 token 短名, 背景 token 短名, 阈值] */
const CHECKS = [
  ['正文 / 底色', 'label-primary', 'bg-base', 4.5],
  ['正文 / 一级面', 'label-primary', 'bg-layer-1', 4.5],
  ['正文 / 二级面', 'label-primary', 'bg-layer-2', 4.5],
  ['正文 / 三级面', 'label-primary', 'bg-layer-3', 4.5],
  ['正文 / 浮层', 'label-primary', 'bg-overlay', 4.5],
  ['正文 / 侧栏', 'label-primary', 'specific-sidebar-fill', 4.5],
  ['正文 / 设置卡片', 'label-primary', 'settings-card-fill', 4.5],
  ['正文 / 菜单', 'label-primary', 'specific-menu', 4.5],
  ['次要文字 / 底色', 'label-secondary', 'bg-base', 4.5],
  ['次要文字 / 二级面', 'label-secondary', 'bg-layer-2', 4.5],
  ['次要文字 / 侧栏', 'label-secondary', 'specific-sidebar-fill', 4.5],
  ['次要文字 / 设置卡片', 'label-secondary', 'settings-card-fill', 4.5],
  ['三级文字 / 底色', 'label-tertiary', 'bg-base', 4.5],
  ['三级文字 / 二级面', 'label-tertiary', 'bg-layer-2', 4.5],
  ['三级文字 / 侧栏', 'label-tertiary', 'specific-sidebar-fill', 4.5],
  ['说明文字 / 底色', 'label-caption', 'bg-base', 4.5],
  ['品牌色 / 底色', 'brand-primary', 'bg-base', 3],
  ['品牌色 / 二级面', 'brand-primary', 'bg-layer-2', 3],
  ['品牌色 / 侧栏', 'brand-primary', 'specific-sidebar-fill', 3],
  ['链接 / 底色', 'link', 'bg-base', 4.5],
  ['链接 / 气泡', 'link', 'specific-bubble', 4.5],
  ['链接 / 代码块', 'link', 'markdown-code-block', 4.5],
  ['链接 / 二级面', 'link', 'bg-layer-2', 4.5],
  ['正文 / 气泡', 'label-primary', 'specific-bubble', 4.5],
  ['正文 / 高亮气泡', 'label-primary', 'specific-bubble-highlight', 4.5],
  ['正文 / 内联代码', 'label-primary', 'markdown-inline-code', 4.5],
  ['正文 / 侧栏选中', 'label-primary', 'specific-sidebar-nav-item-active', 4.5],
  ['正文 / 输入框', 'label-primary', 'specific-input-major', 4.5],
  ['正文 / Toast', 'toast-label', 'toast-bg', 4.5],
  ['按钮文字 / 按钮底', 'label-primary-foreground', 'button-primary-fill', 4.5],
  ['次级按钮文字 / 浮起面', 'label-primary', 'button-elevated-fill', 4.5],
  ['焦点环 / 底色', 'focus-ring-color', 'bg-base', 3],
  ['焦点环 / 二级面', 'focus-ring-color', 'bg-layer-2', 3],
  ['焦点环 / 三级面', 'focus-ring-color', 'bg-layer-3', 3],
  ['焦点环 / 设置卡片', 'focus-ring-color', 'settings-card-fill', 3],
  ['开关滑块 / 轨道', 'switch-thumb', 'button-primary-fill', 1.5],
  ['代码块文字 / 代码块底', 'label-primary', 'markdown-code-block', 4.5],
  ['文档预览文字 / 预览底', 'label-document-preview', 'bg-document-preview', 4.5],
  ['菜单图标 / 菜单底', 'menu-icon', 'specific-menu', 3]
]

/** 取 token 全名。 */
function tok (table, short) {
  return table[tokenName(short)]
}

let total = 0
let failed = 0
const failures = []

console.log('庄方宜主题 · 对比度自检\n')

for (const presetId of PRESET_IDS) {
  const preset = PRESETS[presetId]
  const tokens = buildTokens(presetId)
  console.log(`━━━ ${presetId}（${preset.label}）━━━`)
  for (const scheme of ['light', 'dark']) {
    const table = tokens[scheme]
    const bad = []
    for (const [label, fg, bg, need] of CHECKS) {
      total += 1
      const fgv = tok(table, fg)
      const bgv = tok(table, bg)
      if (fgv === undefined || bgv === undefined) {
        bad.push({ label, ratio: null, need, fg: fgv, bg: bgv, why: 'token 缺失' })
        failed += 1
        continue
      }
      const ratio = contrast(fgv, bgv)
      if (ratio === null) {
        bad.push({ label, ratio: null, need, fg: fgv, bg: bgv, why: '颜色不可解析' })
        failed += 1
        continue
      }
      if (ratio < need) {
        bad.push({ label, ratio, need, fg: fgv, bg: bgv })
        failed += 1
      }
    }
    const tag = scheme === 'dark' ? '深色' : '浅色'
    if (bad.length === 0) {
      console.log(`  ${tag}：全部通过（${CHECKS.length} 项）`)
    } else {
      console.log(`  ${tag}：不达标 ${bad.length} 项`)
      for (const b of bad) {
        const r = b.ratio === null ? (b.why ?? '不可解析') : `${b.ratio.toFixed(2)}:1`
        console.log(`     FAIL ${b.label.padEnd(22)} ${String(r).padStart(9)} < ${b.need}  (${b.fg ?? '—'} / ${b.bg ?? '—'})`)
        failures.push(`${presetId}/${scheme} ${b.label}`)
      }
    }
  }
  console.log('')
}

// ── 强调色色相扫描（accentHue 覆盖）──────────────────────────────────────
//
// `accentHue` 让用户把强调色转到任意色相。旋转只改色相、保留原色的饱和度与
// 明度，所以「浅色强调色压得够深」这条可读性约束理论上依然成立 —— 但这是
// **理论**。这里按 30° 步长扫 12 个色相 × 4 预设 × 2 明暗，把与强调色相关的
// 断言（品牌/链接/焦点环）全部重跑一遍，用数据确认「随便转都还能读」。
//
// 为什么必须做：色相一换，同一个明度的**相对亮度**会变（人眼对绿最敏感、
// 对蓝最迟钝）。黄绿预设转到蓝色相时，明度相同但亮度更低 —— 这正是容易
// 跌破阈值的地方。
console.log('━━━ 强调色色相扫描（accentHue 0..359，每 30° 一格）━━━')
const ACCENT_CHECKS = CHECKS.filter(([, fg]) =>
  ['brand-primary', 'link', 'onboarding-accent'].includes(fg))
let hueTotal = 0
let hueFailed = 0
const hueFailures = []

for (const presetId of PRESET_IDS) {
  for (const scheme of ['light', 'dark']) {
    const bad = []
    for (let hue = 0; hue < 360; hue += 30) {
      const table = buildTokens(presetId, hue)[scheme]
      for (const [label, fg, bg, need] of ACCENT_CHECKS) {
        hueTotal += 1
        const fgv = tok(table, fg)
        const bgv = tok(table, bg)
        const ratio = (fgv === undefined || bgv === undefined) ? null : contrast(fgv, bgv)
        if (ratio === null || ratio < need) {
          hueFailed += 1
          bad.push({ hue, label, ratio, need, fg: fgv, bg: bgv })
        }
      }
    }
    if (bad.length === 0) {
      console.log(`  ${presetId}/${scheme}：12 个色相全部通过`)
    } else {
      // 只列前几条，避免刷屏；但计数是完整的
      console.log(`  ${presetId}/${scheme}：不达标 ${bad.length} 项`)
      for (const b of bad.slice(0, 4)) {
        const r = b.ratio === null ? '不可解析' : `${b.ratio.toFixed(2)}:1`
        console.log(`     FAIL hue=${b.hue} ${b.label.padEnd(18)} ${String(r).padStart(9)} < ${b.need}  (${b.fg ?? '—'} / ${b.bg ?? '—'})`)
      }
      if (bad.length > 4) console.log(`     …另有 ${bad.length - 4} 项`)
      hueFailures.push(`${presetId}/${scheme}`)
    }
  }
}
if (hueFailures.length === 0) {
  console.log(`  合计 ${hueTotal} 项（${PRESET_IDS.length} 预设 × 2 明暗 × 12 色相 × ${ACCENT_CHECKS.length} 断言）全部通过`)
} else {
  console.log(`  合计 ${hueTotal} 项，不达标 ${hueFailed} 项`)
  failed += hueFailed
}
console.log('')

// 额外健全性检查：每个 token 必须同时有两套值，且色阶单调
console.log('━━━ 结构健全性 ━━━')
let structural = 0

for (const presetId of PRESET_IDS) {
  const tokens = buildTokens(presetId)
  const lightKeys = Object.keys(tokens.light)
  const darkKeys = Object.keys(tokens.dark)
  if (lightKeys.length !== darkKeys.length) {
    console.log(`  FAIL ${presetId}: light/dark token 数不一致`)
    structural += 1
  }
  const missing = lightKeys.filter((k) => tokens.dark[k] === undefined)
  if (missing.length > 0) {
    console.log(`  FAIL ${presetId}: dark 缺 ${missing.length} 个 token（${missing.slice(0, 3).join(', ')}…）`)
    structural += 1
  }
  // token 名必须真实存在：拼错前缀不会报错，只会静默失效
  const unknown = lightKeys.filter((k) => !SHELL_TOKENS.has(k))
  if (unknown.length > 0) {
    console.log(`  FAIL ${presetId}: ${unknown.length} 个 token 名外壳不认识（${unknown.slice(0, 3).join(', ')}…）`)
    structural += 1
  }
  // 值必须是可解析的颜色
  const unparsable = lightKeys.filter((k) => contrast(tokens.light[k], tokens.light[k]) === null)
  if (unparsable.length > 0) {
    console.log(`  FAIL ${presetId}: ${unparsable.length} 个色值不可解析（${unparsable.slice(0, 3).join(', ')}…）`)
    structural += 1
  }
  // 色阶单调性：亮度必须从 00 到 1000 单调递减
  const ramp = []
  for (let i = 0; i < 19; i += 1) {
    const name = `--dsw-static-neutral-bluish-${['00', '50', '60', '75', '100', '150', '200', '300', '400', '500', '600', '700', '750', '800', '850', '875', '900', '950', '1000'][i]}`
    ramp.push(tokens.light[name])
  }
  const lums = ramp.map((c) => {
    const p = c.replace('#', '')
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(p.slice(i, i + 2), 16) / 255)
    const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  })
  for (let i = 1; i < lums.length; i += 1) {
    if (lums[i] > lums[i - 1] + 1e-9) {
      console.log(`  FAIL ${presetId}: 色阶在第 ${i} 级不单调（${ramp[i - 1]} → ${ramp[i]}）`)
      structural += 1
      break
    }
  }
}
if (structural === 0) console.log('  全部通过（token 成对、色阶单调）')
console.log('')

console.log(`合计 ${total} 项对比度检查 + ${PRESET_IDS.length} 组结构检查，不达标 ${failed + structural} 项`)
if (failed + structural > 0) {
  console.log(`\n失败项：\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('全部通过。')
