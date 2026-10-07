#!/usr/bin/env node
/**
 * 由 `src/wallpaperCatalog.js` 生成两份**派生产物**，并校验一致性。
 *
 * 解决的问题：加一张壁纸原先要同步改 5 个地方（`prepare-art.py` 的
 * `WALLPAPERS` 表、`src/settings.js` 的 `BACKGROUNDS`、`client.js` 的本地
 * `BACKGROUNDS` 副本、`BG_LABELS`、zh/en 两张 `DICT`）。9 张靠手抄还行，
 * 59 张必然漂移 —— 本仓库已经因同类问题栽过多次。
 *
 * 现在：目录是唯一手写的地方，其余由本脚本生成。
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
jsLines.push("      none: 'texture',")
for (const w of WALLPAPERS) jsLines.push(`      ${w.id}: '${w.group}',`)
jsLines.push('    }')
const jsBlock = jsLines.join('\n')

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

function splice(file, begin, end, block) {
  const src = readFileSync(file, 'utf8')
  const i = src.indexOf(begin)
  const j = src.indexOf(end)
  if (i < 0 || j < 0) return null
  const next = src.slice(0, i) + begin + '\n' + block + '\n' + src.slice(j)
  return { src, next, changed: next !== src }
}

const targets = [
  [path.join(ROOT, 'tools', 'prepare-art.py'), PY_BEGIN, PY_END, pyBlock],
  [path.join(ROOT, 'client.js'), JS_BEGIN, JS_END, jsBlock],
]

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
