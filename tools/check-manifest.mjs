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
 *
 * ── 这个自检已经抓到过一次真问题 ──────────────────────────────────────
 *
 * 加「原生标题栏条带透明」功能后 CI 失败：
 *   `FAIL 仓库里用到了 titleBarOverlay（对应权限 desktop:titlebar-overlay）
 *    但清单没声明`
 * 那次确实是**声明与事实脱节**（用了能力却没声明），属于双向校验要抓的
 * 典型情形 —— 声明的必须有证据，不声明的必须没证据。
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
  },
  'desktop:titlebar-overlay': {
    files: ['index.js'],
    // 证据 = 我们真的选中了桌面 preload 建的那个探针 span 并改它的底色，
    // 而探针的颜色正是经 IPC 交给 `setTitleBarOverlay({color})` 的。
    patterns: ['body[data-zf-wallpaper] > span[style*="visibility"]'],
    why: '改原生标题栏条带颜色（选中桌面 preload 的探针 span，把底色设为透明 → 壁纸透上去）'
  }
}

/** 我们**不**声明的权限 → 「仓库里必须没有这些证据」。 */
const FORBIDDEN_EVIDENCE = {
  'browser:local-storage': { files: ['client.js'], patterns: ['localStorage'] },
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
for (const f of ['LICENSE', 'README.md', 'CHANGELOG.md', 'PRIVACY.md', 'ASSETS-NOTICE.md']) {
  if (fs.existsSync(path.join(ROOT, f))) pass(`存在 ${f}`)
  else fail(`缺 ${f}`)
}

// ── 4b) 更新日志必须有当前版本的条目 ─────────────────────────────────
// 防「改了版本号忘了写日志」—— 发版时最容易漏的一步，而且漏了没人会发现。
//
// ⚠️ 日期断言必须**锚定当前版本那一行**。第一版写的是
// `/^## \[[^\]]+\] - (\d{4}-\d{2}-\d{2})$/m` —— 它匹配的是**任意**版本标题，
// 所以把 0.4.2 那行的日期删掉照样通过（历史条目里还有带日期的）。用反例
// 实测才发现这条断言是空转的。这类「断言写得比意图弱」的问题，只有拿
// 反例去试才能暴露 —— 通过不等于有效。
{
  const changelog = fs.existsSync(path.join(ROOT, 'CHANGELOG.md'))
    ? read('CHANGELOG.md')
    : ''
  // 转义版本号里的 `.`，否则 `0.4.2` 会匹配到 `0x4y2`
  const esc = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const entry = changelog.match(new RegExp(`^## \\[${esc}\\](.*)$`, 'm'))
  if (entry === null) {
    fail(`CHANGELOG.md 里找不到当前版本的条目：期望一行以「## [${pkg.version}]」开头（改了 version 就要写日志）`)
  } else {
    pass(`CHANGELOG.md 有当前版本条目（## [${pkg.version}]）`)
    const dated = entry[1].match(/^\s+-\s+(\d{4}-\d{2}-\d{2})\s*$/)
    if (dated === null) {
      fail(`CHANGELOG.md 的 [${pkg.version}] 标题缺日期或格式不对（应为「## [${pkg.version}] - YYYY-MM-DD」，实际是「## [${pkg.version}]${entry[1]}」）`)
    } else {
      pass(`CHANGELOG.md 的 [${pkg.version}] 带日期（${dated[1]}）`)
    }
  }
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

// ── 8) files 声明的每一项都真实存在 ──────────────────────────────────
// 打包/安装清单都从 files 派生，所以 files 里写错一个名字会**静默少打包**。
// 这里显式挡住。
for (const f of pkg.files ?? []) {
  if (fs.existsSync(path.join(ROOT, f))) pass(`files 声明存在：${f}`)
  else fail(`package.json 的 files 声明了 ${f}，但仓库里没有 —— 打包会静默漏掉它`)
}

// ── 9) 打包/安装清单必须是**派生**的，不许改回手抄 ────────────────────
//
// 这条锁的是一个真实事故：`tools/package.ps1` 与 `install.ps1` 各自手抄了一份
// 文件清单，注释还写着「两处同步维护」—— 但 0.4.0 给 files 加了 LICENSE、
// 0.4.2 又加了 CHANGELOG.md，两份清单都没跟上，于是**发行 ZIP 里一直没有
// LICENSE**（MIT 要求随分发提供授权文本），直到建 Release 前逐文件比对才发现。
//
// 手抄的清单一定会漂移，所以这里断言它们读的是 `$pkg.files`：
// 谁改回手写，CI 直接失败并看到原因。
const DERIVED_LISTS = {
  'tools/package.ps1': '$pkg.files',
  'install.ps1': '$pkg.files'
}
for (const [file, needle] of Object.entries(DERIVED_LISTS)) {
  if (!fs.existsSync(path.join(ROOT, file))) {
    fail(`缺 ${file}（清单派生断言的目标文件）`)
    continue
  }
  const src = read(file)
  if (src.includes(needle)) {
    pass(`${file} 的发布清单从 ${needle} 派生（不是手抄）`)
  } else {
    fail(`${file} 里找不到 ${needle} —— 发布清单被改回手写了。` +
      '手抄的清单会与 package.json 的 files 漂移（曾经因此让发行包漏掉 LICENSE），' +
      '必须改成从 $pkg.files 派生')
  }
}

// ── 已删除的死代码不得复活（0.12.0）─────────────────────────────────────
//
// 这 7 个导出在 0.12.0 被删掉，理由都是「零调用」或「注释声称有人用但实际没有」。
// 断言它们不再出现，是为了防止某次重构把旧代码复制回来 —— 那种情况下
// 不会有人注意到「这个函数其实没人调」。
//
// ⚠️ 这是**反向**断言（检查「不存在」），所以必须确认它真的会失败：
// 故意加回一个同名函数后跑一次，应看到对应 FAIL。已实测。
const DELETED_EXPORTS = {
  'src/settings.js': ['backgroundArtId', 'customBackgroundOf'],
  'src/fonts.js': ['FONT_LABELS', 'SCALE_LABELS'],
  'src/palette.js': ['lightestOf', 'darkestOf'],
  'src/wallpaperCatalog.js': ['WALLPAPER_BY_ID']
}
for (const [file, names] of Object.entries(DELETED_EXPORTS)) {
  // ⚠️ `read()` 已经用 ROOT 解析过路径，这里**不要再 join 一次** ——
  // 第一版写成 `path.join(ROOT, file)` 传进去，结果拼成了
  // `<ROOT>\<ROOT>\src\settings.js` 直接 ENOENT（断言自己崩了，
  // 而不是报出「死代码复活」）。
  if (!fs.existsSync(path.join(ROOT, file))) {
    fail(`缺 ${file}（死代码回归断言的目标文件）`)
    continue
  }
  const src = read(file)
  const revived = names.filter(n => new RegExp(`export\\s+(?:function|const)\\s+${n}\\b`).test(src))
  if (revived.length === 0) {
    pass(`${file} 的 ${names.length} 个已删导出未复活`)
  } else {
    fail(`${file} 里 ${revived.join(', ')} 又出现了 —— 它们零调用，是 0.12.0 ` +
      '刻意删掉的死代码。若确实要用，请连同调用点一起加回来并更新本断言')
  }
}

console.log()
if (failed === 0) {
  console.log('全部通过。')
} else {
  console.log(`${failed} 项不通过。`)
}
process.exit(failed === 0 ? 0 : 1)
