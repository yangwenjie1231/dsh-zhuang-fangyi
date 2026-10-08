#!/usr/bin/env node
/**
 * 由 `src/wallpaperCatalog.js` 与 `src/palette.js` 生成**派生产物**，并校验一致性。
 *
 * 解决的问题：同一份事实在客户端有一份手抄副本（`client.js` 不能 `import src/`）。
 * 加一张壁纸原先要同步改 5 个地方；加一套预设原先要改 3 个地方
 * （`PRESET_SPECS` 权威 + `client.js` 的 `PRESETS` 与 `PRESET_LABELS` 两份副本）。
 * 8 张壁纸 / 4 套预设靠手抄还行，58 张 / 8 套必然漂移 ——
 * 本仓库已经因同类问题栽过多次（`BACKGROUNDS` / `PRESETS` / `FONTS` 都栽过）。
 *
 * 现在：**权威文件是唯一手写的地方**，其余由本脚本生成。
 *
 * ⚠️ 本脚本只管「生成 + 校验」，不校验业务语义（那是 `src/contrast.js`
 * 与 `tools/test-client.mjs` 的职责）。
 *
 * 用法：
 *   node tools/gen-wallpapers.mjs            # 生成 + 校验
 *   node tools/gen-wallpapers.mjs --check    # 只校验（CI 用，不写文件）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const CHECK = process.argv.includes('--check')

const { WALLPAPERS, BACKGROUND_IDS, BACKGROUNDS, WALLPAPER_GROUPS, GROUP_LABELS } =
  await import(new URL('../src/wallpaperCatalog.js', import.meta.url))
const { PRESET_IDS, PRESET_SPECS } = await import(new URL('../src/palette.js', import.meta.url))

let failed = 0
const problems = []
const fail = (msg) => { problems.push(msg); failed++ }

// ── 1. 目录自身的完整性 ────────────────────────────────────────────────────
const ids = new Set()
const files = new Set()
for (const w of WALLPAPERS) {
  for (const k of ['id', 'file', 'source', 'zh', 'en', 'group', 'fit']) {
    if (w[k] === undefined || w[k] === null || w[k] === '') fail(`壁纸 ${w.id || '(无 id)'} 缺字段 ${k}`)
  }
  if (ids.has(w.id)) fail(`id 重复：${w.id}`)
  ids.add(w.id)
  if (files.has(w.file)) fail(`file 重复：${w.file}`)
  files.add(w.file)
  // 命名约定：wallpaper-<id>.webp（prepare-art.py 与测试都依赖）
  if (w.file !== `wallpaper-${w.id}.webp`) {
    fail(`${w.id} 的 file 不符合约定：期望 wallpaper-${w.id}.webp，实际 ${w.file}`)
  }
  if (!WALLPAPER_GROUPS.includes(w.group)) fail(`${w.id} 的 group 非法：${w.group}`)
  if (!['cover', 'contain'].includes(w.fit)) fail(`${w.id} 的 fit 非法：${w.fit}`)
  if (w.id === 'none' || w.id === 'custom') fail(`${w.id} 是保留 id，不能用作壁纸 id`)
}

// 分组标签必须齐全（选择器要按组显示标题）
for (const g of WALLPAPER_GROUPS) {
  if (!GROUP_LABELS[g]?.zh || !GROUP_LABELS[g]?.en) fail(`分组 ${g} 缺中/英标签`)
}

// `BACKGROUNDS` 与 `BACKGROUND_IDS` 必须同源（两者都在别处被消费）
if (BACKGROUND_IDS.length !== WALLPAPERS.length + 1 || BACKGROUND_IDS[0] !== 'none') {
  fail(`BACKGROUND_IDS 形状不对：${BACKGROUND_IDS.length} 项，首项 ${BACKGROUND_IDS[0]}`)
}
for (const id of BACKGROUND_IDS) {
  if (!(id in BACKGROUNDS)) fail(`BACKGROUNDS 缺 ${id}`)
}
for (const id of Object.keys(BACKGROUNDS)) {
  if (!BACKGROUND_IDS.includes(id)) fail(`BACKGROUNDS 多出 ${id}`)
}

console.log('目录：%d 张壁纸，%d 个分组', WALLPAPERS.length, WALLPAPER_GROUPS.length)
const byGroup = {}
for (const w of WALLPAPERS) byGroup[w.group] = (byGroup[w.group] || 0) + 1
console.log('  分组分布: %s', Object.entries(byGroup).map(([g, n]) => `${GROUP_LABELS[g].zh} ${n}`).join(' / '))
console.log('  取向分布: cover %d / contain %d',
  WALLPAPERS.filter((w) => w.fit === 'cover').length,
  WALLPAPERS.filter((w) => w.fit === 'contain').length)

// ── 2. 生成 prepare-art.py 的 WALLPAPERS 表 ───────────────────────────────
function pyStr(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

const pyLines = []
pyLines.push('# ⚠ 本节由 `tools/gen-wallpapers.mjs` 从 `src/wallpaperCatalog.js` 自动生成。')
pyLines.push('#   不要手改 —— 改了下次生成会被覆盖，且会与插件侧不一致。')
pyLines.push('#   要加/改壁纸请改目录文件后重跑：node tools/gen-wallpapers.mjs')
pyLines.push('WALLPAPERS = {')
for (const w of WALLPAPERS) {
  pyLines.push(`    ${pyStr(w.id)}: (${pyStr(w.source)}, ${pyStr(w.zh)}),`)
}
pyLines.push('}')
const pyBlock = pyLines.join('\n')

// ── 3. 生成 client.js 的本地副本 + 标签 ───────────────────────────────────
/** 单引号字面量（client.js 全文件单引号风格；JSON.stringify 的双引号会破坏一致性，
 *  也让「目录 ↔ client 逐条一致」这类文本断言分叉出两种引号形态）。 */
const sq = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const jsLines = []
jsLines.push('    // ⚠ 以下三块由 `tools/gen-wallpapers.mjs` 从 `src/wallpaperCatalog.js` 自动生成。')
jsLines.push('    //   客户端不能 import src/，所以必须是副本；生成器保证两侧一致。')
jsLines.push('    const BACKGROUNDS = [')
jsLines.push('      ' + BACKGROUND_IDS.map((id) => `'${id}'`).join(', '))
jsLines.push('    ]')
jsLines.push('')
jsLines.push('    /** 壁纸 id → 中英标签（选择器与 aria-label 用）。 */')
jsLines.push('    const BG_LABELS = {')
jsLines.push(`      none: { zh: ${sq('无')}, en: ${sq('None')} },`)
for (const w of WALLPAPERS) {
  jsLines.push(`      ${w.id}: { zh: ${sq(w.zh)}, en: ${sq(w.en)} },`)
}
jsLines.push('    }')
jsLines.push('')
jsLines.push('    /** 壁纸分组（选择器按组显示标题）。 */')
jsLines.push('    const BG_GROUPS = [')
for (const g of WALLPAPER_GROUPS) {
  jsLines.push(`      { id: '${g}', zh: ${sq(GROUP_LABELS[g].zh)}, en: ${sq(GROUP_LABELS[g].en)} },`)
}
jsLines.push('    ]')
jsLines.push('')
jsLines.push('    /** 壁纸 id → 分组 id。 */')
jsLines.push('    const BG_GROUP_OF = {')
// ⚠️ **`none` 刻意不在这里**（0.9.0）：它不是某张壁纸，而是「关掉壁纸」。
// 原先被归进 `texture` 组，于是排在「纹理与极简」段末尾 —— 要滚过 58 张图
// 才能找到「不设背景」，语义上它也和等高线纹理不是一类。
// 现在两处（设置页与观测栏）都把它作为**独立的第一格**渲染，不进组。
//
// 这一条是生成器与手改冲突的现场：0.9.0 手工删掉过 `none`，生成器第一版
// 又把它加了回来（把已提交的改进覆盖了）。所以规则记在这里 —— 生成器是
// 唯一写块的人，块内的每个决定都必须落在生成器里，不能只在产物里手改。
for (const w of WALLPAPERS) jsLines.push(`      ${w.id}: '${w.group}',`)
jsLines.push('    }')
const jsBlock = jsLines.join('\n')

// ── 3b. 生成 client.js 的预设副本（PRESETS / PRESET_LABELS）────────────────
//
// 为什么也要生成：`client.js` 不能 `import src/`，所以它一直有两份手抄副本 ——
// `PRESETS`（id 列表）与 `PRESET_LABELS`（中英显示名）。加一套预设时漏改
// 任何一份都是静默故障：漏 `PRESETS` → 主题不注册；漏 `PRESET_LABELS`
// → 下拉里显示原始 id（`amber`）而不是「琥珀」。
//
// 权威是 `src/palette.js` 的 `PRESET_SPECS`（`label` 字段即中文名）。
// 英文名 `PRESET_SPECS` 里没有 —— 那是纯界面文案，留在生成器里维护
// （与 `wallpaperCatalog` 把 zh/en 都放权威文件不同：预设的英文名只有
// 界面用，不参与任何计算，放权威文件会污染配色数据）。
const PRESET_EN = {
  zhuang: 'Signature yellow-green',
  burst: 'Ultimate ink-gold',
  cyan: 'Cyan',
  wine: 'Wine red',
  olive: 'Olive',
  sand: 'Warm sand',
  frost: 'Frost',
  amber: 'Amber'
}

const presetLines = []
// ⚠️ 块内容里**不要**再写一遍 `>>> generated` 标记 —— `splice()` 会写
// `begin + '\n' + block + '\n' + 原文件后半`，标记由它负责。第一版在这里
// 又写了一遍，产物里就出现了两行重复标记（看着像生成器失控）。
presetLines.push('    // ⚠ 由 `tools/gen-wallpapers.mjs` 从 `src/palette.js` 的 PRESET_SPECS 生成。')
presetLines.push('    //   客户端不能 import src/，所以这是副本；`--check` 保证两侧一致。')
presetLines.push('    //   加一套预设只需改 `PRESET_SPECS`，这里会自动跟上。')
presetLines.push('    const PRESETS = [')
presetLines.push('      ' + PRESET_IDS.map((id) => `'${id}'`).join(', '))
presetLines.push('    ]')
presetLines.push('')
presetLines.push('    /** 预设 id → 中英显示名（下拉与 aria-label 用）。 */')
presetLines.push('    const PRESET_LABELS = {')
for (const id of PRESET_IDS) {
  const zh = PRESET_SPECS[id]?.label
  if (typeof zh !== 'string' || zh.length === 0) {
    fail(`预设 ${id} 缺 label（PRESET_SPECS 里必须有中文名）`)
    continue
  }
  const en = PRESET_EN[id]
  if (typeof en !== 'string' || en.length === 0) {
    fail(`预设 ${id} 在生成器的 PRESET_EN 里缺英文名（补一行即可）`)
    continue
  }
  presetLines.push(`      ${id}: { zh: ${sq(zh)}, en: ${sq(en)} },`)
}
presetLines.push('    }')
const presetBlock = presetLines.join('\n')

// ── 4. 校验源素材存在（能连源库时）────────────────────────────────────────
const LIB = process.env.ZF_LIB || path.join(path.dirname(ROOT), '庄方宜素材')
const canCheckLib = existsSync(LIB)
if (canCheckLib) {
  let miss = 0
  for (const w of WALLPAPERS) {
    if (!existsSync(path.join(LIB, w.source.replace(/\//g, path.sep)))) {
      fail(`源素材不存在：${w.source}（${w.id}）`)
      miss++
    }
  }
  console.log('源素材检查：%d 张，缺失 %d', WALLPAPERS.length, miss)
} else {
  console.log('源素材检查：跳过（找不到 %s）', LIB)
}

// ── 5. 校验/写入 art/wallpapers.json 的 fit 与目录一致 ─────────────────────
const manPath = path.join(ROOT, 'art', 'wallpapers.json')
if (existsSync(manPath)) {
  const man = JSON.parse(readFileSync(manPath, 'utf8'))
  for (const w of WALLPAPERS) {
    const e = man.wallpapers?.[w.file]
    if (!e) { fail(`art/wallpapers.json 缺 ${w.file}`); continue }
    if (e.fit !== w.fit) {
      fail(`fit 不一致：${w.id} 目录写 ${w.fit}，art/wallpapers.json 写 ${e.fit}`)
    }
  }
  for (const f of Object.keys(man.wallpapers || {})) {
    if (!files.has(f)) fail(`art/wallpapers.json 多出未登记的文件：${f}`)
  }
  console.log('art/wallpapers.json：%d 条，已与目录核对', Object.keys(man.wallpapers || {}).length)
}

// ── 6. 落地 ───────────────────────────────────────────────────────────────
const PY_BEGIN = '# >>> generated: wallpapers (do not edit) >>>'
const PY_END = '# <<< generated: wallpapers <<<'
const JS_BEGIN = '    // >>> generated: wallpapers (do not edit) >>>'
const JS_END = '    // <<< generated: wallpapers <<<'
const PRESET_BEGIN = '    // >>> generated: presets (do not edit) >>>'
const PRESET_END = '    // <<< generated: presets <<<'

function splice(file, begin, end, block) {
  const src = readFileSync(file, 'utf8')
  const i = src.indexOf(begin)
  const j = src.indexOf(end)
  if (i < 0 || j < 0) return null
  const next = src.slice(0, i) + begin + '\n' + block + '\n' + src.slice(j)
  // ⚠️ 只比较**标记内部**那段，不能比整个文件。
  // 第一版写成 `next !== src`，于是任何标记之外的改动（UI、DICT、注释）
  // 都会让 `--check` 报「与目录不一致」—— 假警报会训练人忽略这个检查，
  // 比不检查更糟。标记之外的内容本就不由生成器负责。
  const currentBlock = src.slice(i + begin.length, j)
  const changed = currentBlock !== '\n' + block + '\n'
  return { src, next, changed }
}

const targets = [
  [path.join(ROOT, 'tools', 'prepare-art.py'), PY_BEGIN, PY_END, pyBlock],
  [path.join(ROOT, 'client.js'), JS_BEGIN, JS_END, jsBlock],
  [path.join(ROOT, 'client.js'), PRESET_BEGIN, PRESET_END, presetBlock]
]

// ⚠️ 同一个文件可以有多个块（`client.js` 就有两个）。`splice` 每次都重读文件，
// 所以按顺序处理即可 —— **不要**改成缓存 `src`，否则第二个块会基于第一个块
// 的旧内容计算，两次改动会互相覆盖。
for (const [file, begin, end, block] of targets) {
  if (!existsSync(file)) { fail(`找不到 ${path.relative(ROOT, file)}`); continue }
  const r = splice(file, begin, end, block)
  if (!r) {
    fail(`${path.relative(ROOT, file)} 里找不到生成标记：\n    ${begin}\n    ${end}\n  （首次接入需手工放一次标记）`)
    continue
  }
  if (CHECK) {
    if (r.changed) fail(`${path.relative(ROOT, file)} 与目录不一致（需重跑生成器）`)
    else console.log('✓ %s 已是最新', path.relative(ROOT, file))
  } else {
    if (r.changed) { writeFileSync(file, r.next); console.log('✎ 更新 %s', path.relative(ROOT, file)) }
    else console.log('✓ %s 无需改动', path.relative(ROOT, file))
  }
}

console.log('')
if (failed) {
  console.log('=== 失败 %d 项 ===', failed)
  for (const p of problems) console.log('  ✗ %s', p)
  process.exit(1)
}
console.log('全部校验通过。')
