/**
 * 发行清单（`dshWorkshop`）与 CI 用的自检。
 *
 * ── 为什么单独一个脚本 ────────────────────────────────────────────────
 *
 * `package.json#dshWorkshop` 是给 OMDSH Hub 投稿用的**声明式清单**。官方
 * 校验器会检查「声明的权限/能力与仓库真实行为是否对得上」——
 * 声明了却没做（或做了没声明）都会被质疑。所以这里**从源码事实推导**，
 * 而不是手抄一份（手抄的清单一定会随代码漂移）。
 *
 * 用法：
 *     node tools/check-manifest.mjs           # 只校验
 *     node tools/check-manifest.mjs --print   # 打印推导出的权限清单
 *
 * 退出码 0 = 通过，1 = 有问题（CI 直接失败）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')

/**
 * 权限 → 「仓库里必须出现这些证据」。
 *
 * 每条的 `evidence` 是**真实用到的代码特征**，不是描述性文字。
 * 加权限必须同时在这里登记证据，否则校验会失败 —— 这条设计是为了防止
 * 「为了让清单好看而多写一条权限」。
 */
const PERMISSION_EVIDENCE = {
  'web:index-inject': {
    files: ['index.js'],
    patterns: ["webserver/index-inject"],
    why: '首帧遮罩 + 开机卡片主题色（走载体在文档解析阶段应用注入行）'
  },
  'web:http-route': {
    files: ['index.js'],
    patterns: ['server.register'],
    why: '注册 /api/zhuang-fangyi/* 路由（设置、主题、样式表、素材、诊断）'
  },
  'dom:overlay': {
    files: ['client.js'],
    patterns: ['shell.overlay'],
    why: '观测栏浮层 + 启动动效（叠在应用之上的自绘节点）'
  }
}

/** 我们**不**声明的权限 → 「仓库里必须没有这些证据」。 */
const FORBIDDEN_EVIDENCE = {
  'browser:local-storage': { files: ['client.js'], patterns: ['localStorage'] },
  'desktop:titlebar-overlay': { files: ['index.js', 'client.js'], patterns: ['titleBarOverlay', 'titlebar-area'] },
  'network:npm-registry': { files: ['index.js'], patterns: ['registry.npmjs', 'npmmirror'] },
  'desktop:subprocess': { files: ['index.js'], patterns: ['ctx.subprocess', 'child_process'] }
}

let failed = 0
const fail = msg => { failed += 1; console.log(`  FAIL ${msg}`) }
const pass = msg => console.log(`  OK   ${msg}`)

const pkg = JSON.parse(read('package.json'))
const ws = pkg.dshWorkshop

console.log('发行清单自检\n')

// ── 1) 必备字段 ───────────────────────────────────────────────────────
if (ws === undefined) {
  fail('package.json 缺 dshWorkshop（OMDSH Hub 投稿必需）')
} else {
  pass('dshWorkshop 存在')
  const need = {
    schema: 'omdsh-workshop-package/v1',
    type: 'plugin'
  }
  for (const [k, v] of Object.entries(need)) {
    if (ws[k] === v) pass(`dshWorkshop.${k} = ${v}`)
    else fail(`dshWorkshop.${k} 应为 ${v}，实际 ${JSON.stringify(ws[k])}`)
  }
  // 550c 踩过的坑：install adapter 必须是 profile-bundle
  // （写 harness-profile 会被官方校验器判 "does not match the integration protocol"）
  if (ws.integration?.protocol === 'harness-profile') pass('integration.protocol = harness-profile')
  else fail(`integration.protocol 应为 harness-profile，实际 ${JSON.stringify(ws.integration?.protocol)}`)
  if (ws.install?.adapter === 'profile-bundle') pass('install.adapter = profile-bundle（官方校验器的硬要求）')
  else fail(`install.adapter 应为 profile-bundle（写成 harness-profile 会被判 adapter mismatch），实际 ${JSON.stringify(ws.install?.adapter)}`)
  // artifact 必须真实存在
  const artifact = ws.integration?.artifact
  if (typeof artifact === 'string' && fs.existsSync(path.join(ROOT, artifact))) {
    pass(`integration.artifact 指向的文件存在（${artifact}）`)
  } else {
    fail(`integration.artifact 指向的文件不存在：${JSON.stringify(artifact)}`)
  }
  // capability 必须写**可执行的观察方式**
  const inv = ws.capability?.invocation
  if (typeof inv === 'string' && /querySelector|getAttribute|classList/.test(inv)) {
    pass('capability.invocation 写的是可执行的观察方式（含选择器）')
  } else {
    fail('capability.invocation 必须写可执行的观察方式（要含具体选择器），不能只写「加载成功」')
  }
  // 声明的权限必须都有真实证据
  for (const perm of ws.permissions ?? []) {
    const ev = PERMISSION_EVIDENCE[perm]
    if (ev === undefined) {
      fail(`权限 ${perm} 没有登记证据（加权限必须同时在 check-manifest.mjs 里登记）`)
      continue
    }
    const missing = ev.patterns.filter(pt =>
      !ev.files.some(f => read(f).includes(pt)))
    if (missing.length === 0) pass(`权限 ${perm} 有真实证据（${ev.why}）`)
    else fail(`权限 ${perm} 声明了但仓库里找不到证据：${missing.join(', ')}`)
  }
}

// ── 2) 不该声明的权限：仓库里必须没有对应行为 ────────────────────────
const declared = new Set(ws?.permissions ?? [])
for (const [perm, spec] of Object.entries(FORBIDDEN_EVIDENCE)) {
  if (declared.has(perm)) {
    fail(`声明了 ${perm} —— 若确实要用，请从 FORBIDDEN_EVIDENCE 移除并登记证据`)
    continue
  }
  const hit = spec.patterns.find(pt => spec.files.some(f => read(f).includes(pt)))
  if (hit === undefined) {
    pass(`未声明 ${perm}，且仓库里确实没有 ${spec.patterns.join('/')}`)
  } else {
    fail(`仓库里用到了 ${hit}（对应权限 ${perm}）但清单没声明 —— 要么声明，要么去掉用法`)
  }
}

// ── 3) dsh.engines 必须声明（Hub 会问基线）────────────────────────────
const dshEngine = pkg.dsh?.engines?.dsh
if (typeof dshEngine === 'string' && dshEngine !== '') {
  pass(`dsh.engines.dsh = ${dshEngine}`)
} else {
  fail('dsh.engines.dsh 缺失（Hub 会问「在哪个 DSH 版本上实测过」）')
}

// ── 4) 发行工程必备文件 ───────────────────────────────────────────────
for (const f of ['LICENSE', 'README.md', 'PRIVACY.md', 'ASSETS-NOTICE.md']) {
  if (fs.existsSync(path.join(ROOT, f))) pass(`存在 ${f}`)
  else fail(`缺 ${f}`)
}

// ── 5) 零安装期脚本（供应链审查会看这条）─────────────────────────────
const badScripts = ['preinstall', 'install', 'postinstall', 'prepare']
const present = badScripts.filter(s => pkg.scripts?.[s] !== undefined)
if (present.length === 0) pass('无安装期脚本（无需 allowBuilds 授权）')
else fail(`存在安装期脚本：${present.join(', ')}（会触发 pnpm 的 allowBuilds 授权）`)

// ── 6) 零运行时依赖 ───────────────────────────────────────────────────
const deps = Object.keys(pkg.dependencies ?? {})
if (deps.length === 0) pass('零运行时依赖')
else fail(`有运行时依赖：${deps.join(', ')}`)

// ── 7) 构建产物入库且与源码一致（CI 会 git diff --exit-code）─────────
// 我们无构建步骤（client.js 就是源），所以这条退化为「文件存在」
for (const f of ['index.js', 'client.js']) {
  if (fs.existsSync(path.join(ROOT, f))) pass(`存在 ${f}（无构建步骤，即源即产物）`)
  else fail(`缺 ${f}`)
}

console.log()
if (failed === 0) {
  console.log('全部通过。')
} else {
  console.log(`${failed} 项不通过。`)
}
process.exit(failed === 0 ? 0 : 1)
