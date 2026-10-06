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

import { PRESETS, PRESET_IDS, buildTokens, buildRoles, tokenName } from './palette.js'
import { contrast, codeTokens, CODE_TOKEN_MIN_RATIO, SHIKI_TOKEN_KEYS } from './palette.js'

/**
 * 外壳真实存在的 token 名（从 `app.asar` 里 `@deepseek-ai/dsh-client-ui-theme`
 * 的两套调色板导出，外壳共 **120 个 alias**、11 个 specific、19 级中性色阶）。
 *
 * 用途：抓住「前缀写错 → 静默失效」这类 bug —— 拼错的 token 不会报错，
 * 只会变成外壳不认识的变量。
 *
 * ⚠️ 这个集合必须与 `palette.js` 实际发射的 token **同步**：白名单里有而
 * palette 不发射 = 白写；palette 发射而白名单没有 = 结构检查会报
 * 「token 名外壳不认识」。下面 `alias` 段列出本插件注册的全部 alias
 * （当前 118 个；外壳 120 个里有 2 个是模板字符串拼接出的非常规名）。
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
    'tooltip-bg', 'tooltip-key-bg', 'turn-trigger-bg', 'turn-trigger-bg-hover',
    // ── 补齐（旧版白名单里有、但 palette 没发射；或 palette 新增）──────
    'label-error', 'label-quaternary',
    'bg-l1', 'bg-l2', 'bg-layer-4',
    'fill-l1', 'fill-l2', 'fill-tertiary', 'fill-tsp-secondary',
    'separator-primary'
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
  // ── 状态色（旧版完全没注册，外壳引用 261 次）──────────────────────
  // 语义色必须可辨识：成功/警告/错误都要能压在底色上读出来。
  // 3:1 是「非文字图形元素」的门槛；`state-warn-label` 是文字，要 4.5:1。
  ['成功态 / 底色', 'state-success-primary', 'bg-base', 3],
  ['成功态 / 二级面', 'state-success-primary', 'bg-layer-2', 3],
  ['警告态 / 底色', 'state-warn-primary', 'bg-base', 3],
  ['警告文字 / 底色', 'state-warn-label', 'bg-base', 4.5],
  ['错误态 / 底色', 'state-error-primary', 'bg-base', 3],
  ['错误态 / 二级面', 'state-error-primary', 'bg-layer-2', 3],
  ['错误文字 / 底色', 'label-error', 'bg-base', 3],
  ['空闲态 / 底色', 'state-idle-primary', 'bg-base', 3],
  // ── 补齐的 alias ─────────────────────────────────────────────────
  ['四级文字 / 底色', 'label-quaternary', 'bg-base', 3],
  ['深潜标签 / 底色', 'label-deep-diving', 'bg-base', 3],
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

// ── 代码高亮 token（B9）────────────────────────────────────────────────
//
// 外壳给的是一套**与预设无关**的 OpenColor 字面色（关键字粉、函数紫、字符串绿）。
// 我们按预设重算这 9 个 token，规则是「语义优先 + 强调色跟随预设」，并且
// **逐条过对比度门禁**（不够就沿明度校正，校正仍不够就不发这一条）。
//
// 这一组要抓三件事：
//   ① 发出去的每一条都真的够读（门禁契约本身）；
//   ② 键名是外壳真实存在的变量（写错只会静默失效）；
//   ③ 覆盖率不许被门禁砍光、且确实**与外壳默认不同**（否则这功能等于没做）。
// ── diff 行（用户截图：修改的代码被色块覆盖）────────────────────────────
//
// `--dsw-alias-code-diff-added` 是**背景**（壳里全仓只当 background 用），而且壳的
// 默认值是半透明绿。第一版我们给了不透明的状态色 → 实心亮绿带把代码文字压没了。
// 现在合成成不透明浅色调，于是「行上的文字对比度」可以算 —— 这一组就是盯它。
console.log('━━━ diff 行（背景必须让文字读得出来）━━━')
let diffFailed = 0
for (const presetId of PRESET_IDS) {
  for (const scheme of ['light', 'dark']) {
    const tokens = buildTokens(presetId)[scheme]
    const label = (short) => tokens[tokenName(short)]
    const surface = label('markdown-code-block')
    for (const kind of ['added', 'deleted']) {
      const bg = tokens[`--dsw-alias-code-diff-${kind}`]
      const fg = label('label-primary')
      const ratio = contrast(fg, bg)
      if (ratio === null || ratio < 4.5) {
        console.log(`  FAIL ${presetId}/${scheme} diff-${kind}: 文字对比度 ${ratio === null ? 'null' : ratio.toFixed(2)} < 4.5`)
        diffFailed += 1
      }
      // ⚠️ 官方给 diff 行设的文字色是**状态色本身**（绿字/红字），实测 8 组里 7 组
      // 达不到 4.5:1 —— 我们的 CSS 会把文字拉回 `label-primary`（见 index.js），
      // 所以这里按**实际生效的文字色**断言。同时也把「官方那对搭配」记下来，
      // 免得以后有人以为不用管。
      const official = tokens[`--dsw-alias-state-${kind === 'added' ? 'success' : 'error'}-primary`]
      const officialRatio = contrast(official, bg)
      if (officialRatio !== null && officialRatio < 4.5) {
        // 只记录，不算失败：我们覆盖了它
        if (process.env.ZF_VERBOSE === '1') {
          console.log(`  note ${presetId}/${scheme} diff-${kind}: 官方同色系搭配 ${officialRatio.toFixed(2)}（我们已覆盖为前景色）`)
        }
      }
      // 底色必须与代码块底色**看得出区别**（否则 diff 行没有指示作用）
      const delta = contrast(bg, surface)
      if (delta !== null && delta < 1.06) {
        console.log(`  FAIL ${presetId}/${scheme} diff-${kind}: 与代码块底色几乎同色（${delta.toFixed(3)}）`)
        diffFailed += 1
      }
      // 而且必须是**不透明**实色 —— 半透明的话上面那条对比度就没意义了
      if (/^#[0-9a-f]{8}$/i.test(bg) || /rgba\(/i.test(bg)) {
        console.log(`  FAIL ${presetId}/${scheme} diff-${kind}: 底色不是不透明实色（${bg}）`)
        diffFailed += 1
      }
    }
    // 增绿删红不能混
    const added = tokens['--dsw-alias-code-diff-added']
    const deleted = tokens['--dsw-alias-code-diff-deleted']
    if (added === deleted) {
      console.log(`  FAIL ${presetId}/${scheme}: 增/删底色相同，失去区分度`)
      diffFailed += 1
    }
  }
}
if (diffFailed === 0) {
  console.log(`  全部通过（${PRESET_IDS.length * 2} 组配色：文字 ≥ 4.5:1、与代码底色可辨、增删不同色）`)
}
console.log('')

console.log('━━━ 代码高亮 token（跟随预设）━━━')

/** 外壳默认的 token 色（实测记录：`:root` 亮色一组、`body[data-ds-dark-theme]` 暗色一组）。 */
const SHELL_SHIKI = {
  light: {
    comment: '#868e96', constant: '#1c7ed6', function: '#6741d9', keyword: '#d6336c',
    link: '#1971c2', parameter: '#e8590c', punctuation: '#495057',
    string: '#2f9e44', 'string-expression': '#2b8a3e'
  },
  dark: {
    comment: '#adb5bd', constant: '#4dabf7', function: '#b197fc', keyword: '#faa2c1',
    link: '#74c0fc', parameter: '#ffa94d', punctuation: '#ced4da',
    string: '#69db7c', 'string-expression': '#8ce99a'
  }
}

let codeFailed = 0
let codeChecked = 0
for (const presetId of PRESET_IDS) {
  for (const scheme of ['light', 'dark']) {
    const roles = buildRoles(presetId, scheme)
    const code = codeTokens(presetId, scheme)
    const keys = Object.keys(code)

    // ① 门禁
    for (const [key, value] of Object.entries(code)) {
      codeChecked += 1
      const ratio = contrast(value, roles.code)
      if (ratio === null || ratio < CODE_TOKEN_MIN_RATIO) {
        console.log(`  FAIL ${presetId}/${scheme} ${key}: ${ratio === null ? 'null' : ratio.toFixed(2)} < ${CODE_TOKEN_MIN_RATIO}`)
        codeFailed += 1
      }
    }
    // ② 键名
    const unknown = keys.filter((k) => !SHIKI_TOKEN_KEYS.includes(k))
    if (unknown.length > 0) {
      console.log(`  FAIL ${presetId}/${scheme}: 未知 token 键 ${unknown.join(', ')}`)
      codeFailed += 1
    }
    // ③ 覆盖率下限 + 关键三类必须齐
    if (keys.length < 6) {
      console.log(`  FAIL ${presetId}/${scheme}: 只发出 ${keys.length}/${SHIKI_TOKEN_KEYS.length} 条（门禁砍太狠）`)
      codeFailed += 1
    }
    for (const must of ['keyword', 'string', 'comment']) {
      if (!keys.includes(must)) {
        console.log(`  FAIL ${presetId}/${scheme}: 缺 ${must}（该 token 会退回外壳默认色）`)
        codeFailed += 1
      }
    }
    // ④ 确实与外壳默认不同（至少 6/9 条不同，避免「算了个寂寞」）
    const differs = keys.filter((k) => code[k].toLowerCase() !== (SHELL_SHIKI[scheme][k] ?? '').toLowerCase())
    if (differs.length < 6) {
      console.log(`  FAIL ${presetId}/${scheme}: 只有 ${differs.length}/${keys.length} 条与外壳默认不同`)
      codeFailed += 1
    }
  }
}
if (codeFailed === 0) {
  console.log(`  全部通过（${codeChecked} 条 token 均 ≥ ${CODE_TOKEN_MIN_RATIO}:1，且与外壳默认色不同）`)
}
console.log('')

console.log(`合计 ${total} 项对比度检查 + ${codeChecked} 项代码 token 检查 + ${PRESET_IDS.length} 组结构检查 + diff 行检查，不达标 ${failed + structural + codeFailed + diffFailed} 项`)
if (failed + structural + codeFailed + diffFailed > 0) {
  console.log(`\n失败项：\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('全部通过。')
