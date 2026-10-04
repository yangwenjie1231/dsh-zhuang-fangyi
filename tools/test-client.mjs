/**
 * 庄方宜主题 · 浏览器半边无头测试
 *
 * 用法：`node tools/test-client.mjs`
 *
 * 用桩 ctx 跑真实 client.js：不装进 DSH 就能验证主题注册、两条生效路径、
 * 明暗分流、设置边界与卸载还原。桩 DOM 只实现本插件用到的最小面
 * （属性 / 自定义属性 / getElementById），足够抓住真实缺陷。
 *
 * 注意：本文件是 UTF-8。不要用 PowerShell 的 Set-Content 改写它 ——
 * 会按 GBK 重新编码，把中文注释与字符串全毁掉（已经踩过一次，只能重写）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)

/* ------------------------------------------------------------------ *
 * 最小 DOM 桩
 * ------------------------------------------------------------------ */

class El {
  constructor (tag) {
    this.tagName = tag.toUpperCase()
    this.attrs = new Map()
    this.props = new Map()
    this.children = []
    this.textContent = ''
    this.parentNode = null
    this.isConnected = false
    this.dataset = {}
    this.classList = { contains: () => false }
    this._className = ''
  }

  // className 必须同时反映到 `class` 属性上：外壳定位靠
  // `[class*="_frame"]` 这类选择器读的是属性，只设 JS 属性匹配不到。
  get className () { return this._className }
  set className (v) {
    this._className = String(v)
    this.attrs.set('class', String(v))
  }

  // 同理：`el.id = 'x'` 在真实 DOM 里会反映到 id 属性上。
  // 桩不这么做的话，靠 `getAttribute('id')` 找元素会永远找不到 ——
  // 早先 `<style id="zf-style">` 的断言就是这么误报失败的。
  get id () { return this.attrs.get('id') ?? '' }
  set id (v) {
    this.attrs.set('id', String(v))
    if (this.parentNode !== null && this.parentNode._byId !== undefined) {
      this.parentNode._byId.set(String(v), this)
    }
  }

  setAttribute (k, v) {
    this.attrs.set(k, String(v))
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      this.dataset[camel] = String(v)
    }
  }

  getAttribute (k) { return this.attrs.has(k) ? this.attrs.get(k) : null }
  hasAttribute (k) { return this.attrs.has(k) }
  removeAttribute (k) {
    this.attrs.delete(k)
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      delete this.dataset[camel]
    }
  }

  appendChild (child) {
    child.parentNode = this
    child.isConnected = true
    this.children.push(child)
    return child
  }

  append (...children) {
    // 真实 DOM 的 `append` 接受多个节点；只处理第一个会让
    // `frame.append(a, b, c)` 静默丢掉 b 和 c —— 测试里就是这么误报失败的。
    for (const child of children) this.appendChild(child)
  }
  remove () {
    const parent = this.parentNode
    if (parent !== null) {
      parent.children = parent.children.filter(c => c !== this)
      this.parentNode = null
      this.isConnected = false
    }
  }

  /** 极简选择器：支持 `[class*="x"]`、`[data-x]`、`style[data-plugin-css$="..."]`。 */
  querySelector (sel) { return this.querySelectorAll(sel)[0] ?? null }

  querySelectorAll (sel) {
    const out = []
    const walk = node => {
      for (const c of node.children) {
        if (matches(c, sel)) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }

  /** 递归收集全部后代（含自身）。 */
  all () {
    const out = [this]
    for (const c of this.children) out.push(...c.all())
    return out
  }

  /** 该元素及其祖先中是否有匹配的。 */
  closest (sel) {
    let node = this
    while (node !== null) {
      if (matches(node, sel)) return node
      node = node.parentNode
    }
    return null
  }

  getElementsByClassName (cls) {
    return this.all().filter(n => n !== this && String(n.className).split(/\s+/).includes(cls))
  }

  getClientRects () { return this.attrs.has('hidden') ? [] : [{}] }

  get style () {
    const self = this
    return {
      setProperty (k, v) { self.props.set(k, String(v)) },
      getPropertyValue (k) { return self.props.has(k) ? self.props.get(k) : '' },
      removeProperty (k) { self.props.delete(k) }
    }
  }
}

/** 极简选择器匹配。 */
function matches (node, sel) {
  const attr = /^\[([\w-]+)(?:([*$^]?=)"?([^"\]]*)"?)?\]$/.exec(sel)
  if (attr !== null) {
    const [, name, op, value] = attr
    const have = node.getAttribute(name)
    if (have === null) return false
    if (op === undefined) return true
    if (op === '*=') return String(have).includes(value)
    if (op === '$=') return String(have).endsWith(value)
    if (op === '^=') return String(have).startsWith(value)
    return String(have) === value
  }
  if (sel.startsWith('.')) return String(node.className).split(/\s+/).includes(sel.slice(1))
  if (sel.startsWith('style[')) {
    // 去掉 `style` 前缀后剩下的是完整的 `[...]`，不要再多切一层 ——
    // 早先写成 slice(5, -1) 把结尾的 `]` 也切掉了，导致永远匹配不上。
    return node.tagName === 'STYLE' && matches(node, sel.slice('style'.length))
  }
  return node.tagName === sel.toUpperCase()
}

/** MutationObserver 桩：只记录是否被调用与是否断开。 */
class MutationObserverStub {
  constructor (cb) {
    this.cb = cb
    this.observed = null
    this.disconnected = false
    MutationObserverStub.instances.push(this)
  }

  observe (target, options) { this.observed = { target, options } }
  disconnect () { this.disconnected = true }
  takeRecords () { return [] }
  /** 测试用：手动触发一次回调。 */
  fire (records = []) { this.cb(records) }
}
MutationObserverStub.instances = []

function makeDom () {
  const html = new El('html')
  const head = new El('head')
  const body = new El('body')
  html.appendChild(head)
  html.appendChild(body)
  const byId = new Map()
  const document = {
    documentElement: html,
    head,
    body,
    createElement: tag => new El(tag),
    getElementById: id => byId.get(id) ?? null,
    querySelector: sel => html.querySelector(sel),
    querySelectorAll: sel => html.querySelectorAll(sel),
    // 真实 document 也有这个（client.js 的 mountSkin 用它批量打标）
    getElementsByClassName: cls => html.getElementsByClassName(cls),
    _byId: byId
  }
  return { document, html, head, body }
}

/**
 * 真实外壳里 kind === "single" 的插槽（本插件会碰到的那些）。
 *
 * `single` 槽同 priority 只能有一个注册，第二个直接抛错 —— 这是
 * `SlotCore.register` 的真实行为，桩必须复刻，否则测不出这类事故。
 */
const SINGLE_SLOTS = new Set([
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark'
])

/* ------------------------------------------------------------------ *
 * 桩 ctx
 * ------------------------------------------------------------------ */

/**
 * 皮肤结构样式表的桩内容。
 *
 * 真实内容由宿主 `structureStyle()` 生成（客户端通过 `/style.css` 取回并
 * 插成 `<style id="zf-style">`）。这里只要一个非空串即可 —— 断言关心的是
 * 「客户端有没有去取、有没有插进 head」，不是 CSS 内容本身。
 */
const DEFAULT_STYLE = '/* stub skin css */\n.zf-topbar{display:grid}\n.zf-rail{position:absolute}\n'

function makeHarness (settingsPayload, themePayload, stylePayload = DEFAULT_STYLE) {
  const dom = makeDom()
  const effects = []
  const listeners = new Map()

  /** 记录 token 层与主题注册，用于断言。 */
  const layers = new Map()
  const registered = new Map()
  let preference = 'system'

  const theme = {
    // 与外壳一致：system 解析成 light/dark；固定 id 取**注册定义自带**的
    // colorScheme（不是从 id 名字猜）。早先这里写死 light，导致固定深色时
    // 壁纸取错版本 —— 那是桩的缺陷，不是插件的。
    getTheme: () => {
      const resolved = preference === 'system' ? 'light' : preference
      const def = registered.get(resolved)
      return {
        preference,
        active: {
          id: resolved,
          colorScheme: def?.colorScheme ?? (resolved === 'dark' ? 'dark' : 'light'),
          tokens: {}
        }
      }
    },
    setTheme: id => {
      if (!['system', 'light', 'dark'].includes(id) && !registered.has(id)) {
        throw new Error(`theme "${id}" is not registered`)
      }
      preference = id
    },
    register: def => {
      if (registered.has(def.id)) throw new Error(`theme "${def.id}" is already registered`)
      // 外壳真实契约：register 的 tokens 是扁平 Record<string,string>
      // （一个定义只有一个 colorScheme，所以不需要成对给值）。
      // 成对校验只属于 overrideTokens —— 早先这里误用，导致误报。
      if (def.colorScheme !== 'light' && def.colorScheme !== 'dark') {
        throw new TypeError(`theme "${def.id}" needs colorScheme light|dark`)
      }
      for (const [name, value] of Object.entries(def.tokens)) {
        if (typeof value !== 'string') {
          throw new TypeError(`theme "${def.id}" token "${name}" must be a string`)
        }
      }
      registered.set(def.id, def)
      return () => registered.delete(def.id)
    },
    overrideTokens: (source, tokens) => {
      // 外壳的真实校验：裸字符串抛错
      for (const [name, modes] of Object.entries(tokens)) {
        if (typeof modes === 'string') {
          throw new TypeError(`theme override "${name}" from "${source}" is a bare string - pass { light, dark }`)
        }
        if (modes === null || typeof modes !== 'object' ||
            typeof modes.light !== 'string' || typeof modes.dark !== 'string') {
          throw new TypeError(`theme override "${name}" must map to a { light, dark } pair of strings`)
        }
      }
      const layer = { seq: layers.size, tokens }
      layers.set(source, layer)
      return () => {
        if (layers.get(source) === layer) layers.delete(source)
      }
    }
  }

  const slotRegistrations = []
  const slots = {
    inject: (slot, fn) => {
      const dispose = fn()
      const disposer = () => dispose?.()
      // 真实框架在插件卸载时会自动 dispose 注入（inject 把 disposer 挂在
      // 当前 fiber 上），所以这里也登记进 effects，让卸载用例能验证到。
      effects.push({ dispose: disposer, label: `inject:${slot}` })
      return disposer
    },
    register: (meta, component) => {
      // 忠实复刻真实 SlotCore 的冲突校验：`single` 槽同 priority 重复注册
      // **直接抛错**（原文见 dsh-client-ui-slots 的 register）。
      //
      // 桩不校验的话，插件在真实环境里因插槽冲突中断 apply() 也测不出来 ——
      // 实测踩过：官方 `dsh-client-ui-brand` 已占 `sidebar.brand.mark`
      // 的 priority 0，我的注册一抛错，整个 apply() 就断了，后面全没执行。
      const kind = SINGLE_SLOTS.has(meta.name) ? 'single' : 'list'
      const priority = meta.priority ?? 0
      if (kind === 'single') {
        const occupant = slotRegistrations.find(
          r => r.meta.name === meta.name && (r.meta.priority ?? 0) === priority)
        if (occupant !== undefined) {
          throw new Error(
            `single slot "${meta.name}" already has a registration at priority ${priority}` +
            `${occupant.meta.registrant !== undefined ? ` (registered by ${occupant.meta.registrant})` : ''}` +
            ' — register at a different priority to shadow it (lowest renders)')
        }
      } else if (meta.id !== undefined) {
        const occupant = slotRegistrations.find(
          r => r.meta.name === meta.name && r.meta.id === meta.id && (r.meta.priority ?? 0) === priority)
        if (occupant !== undefined) {
          throw new Error(`list slot "${meta.name}" already has an entry with id "${meta.id}" at priority ${priority}`)
        }
      }
      const record = { meta, component }
      slotRegistrations.push(record)
      return () => {
        const at = slotRegistrations.indexOf(record)
        if (at >= 0) slotRegistrations.splice(at, 1)
      }
    }
  }

  const dictionaries = new Map()
  const locale = {
    register: (ns, dict) => {
      dictionaries.set(ns, dict)
      return () => dictionaries.delete(ns)
    },
    bind: ns => key => dictionaries.get(ns)?.zh?.[key] ?? key
  }

  const ctx = {
    theme,
    slots,
    locale,
    effect: (fn, label) => {
      const dispose = fn()
      effects.push({ dispose, label })
      return () => dispose?.()
    },
    on: (name, fn) => {
      const set = listeners.get(name) ?? new Set()
      set.add(fn)
      listeners.set(name, set)
      return () => set.delete(fn)
    }
  }

  /** 桩 fetch：返回宿主两份数据 + 皮肤样式表。 */
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/themes')) {
      return { ok: true, json: async () => themePayload }
    }
    if (url.endsWith('/settings')) {
      if (init?.method === 'POST') {
        const parsed = JSON.parse(init.body)
        settingsPayload = { settings: parsed.settings }
      }
      return { ok: true, json: async () => settingsPayload }
    }
    // 皮肤结构样式表。客户端**必须自己取并插 <style>**：桌面端的
    // `tapIndex` 永远不执行（渲染进程直接从磁盘读 index.html），
    // 所以这是桌面端唯一的 CSS 来源。
    if (url.endsWith('/style.css')) {
      if (stylePayload === null) {
        return { ok: false, status: 500, statusText: 'no style', text: async () => '' }
      }
      return { ok: true, text: async () => stylePayload }
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }
  }

  return {
    ctx, dom, layers, registered, slotRegistrations, dictionaries, calls,
    effects, listeners, fetchImpl, getPreference: () => preference
  }
}

/* ------------------------------------------------------------------ *
 * 加载 client.js
 * ------------------------------------------------------------------ */

/**
 * 读取 client.js 并取出 factory 产出的模块。
 *
 * 模拟外壳的 ModuleLoader：load({id, factory}) 时记下 factory，再用桩
 * require 调用它。document / fetch 通过全局注入 —— client.js 直接使用
 * 这两个全局对象（与真实浏览器环境一致）。
 */
function loadClientBundle () {
  const source = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  let captured = null
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: v => ({ current: v }),
    useCallback: fn => fn,
    useMemo: fn => fn()
  }
  const win = {
    __ModuleLoader__: {
      load: arg => { captured = arg }
    },
    innerWidth: 1600,
    addEventListener: () => {},
    removeEventListener: () => {}
  }
  // client.js 直接使用 document / MutationObserver / rAF 等浏览器全局，
  // 所以通过 new Function 的参数注入（与真实浏览器环境一致）。
  const run = new Function(
    'window', 'console', 'document', 'MutationObserver',
    'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
    source
  )
  run(
    win, console, globalThis.document, MutationObserverStub,
    fn => { fn(); return 0 }, () => {}, () => 0, () => {}
  )
  if (captured === null) throw new Error('client.js 未调用 __ModuleLoader__.load')
  const requireStub = name => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  }
  return { module: captured.factory(requireStub), id: captured.id, win }
}

/* ------------------------------------------------------------------ *
 * 断言
 * ------------------------------------------------------------------ */

let pass = 0
let fail = 0
const failures = []

function ok (label, condition, detail) {
  if (condition) {
    pass += 1
    console.log(`  OK   ${label}`)
  } else {
    fail += 1
    failures.push(label)
    console.log(`  FAIL ${label}${detail === undefined ? '' : `  -> ${detail}`}`)
  }
}

/* ------------------------------------------------------------------ *
 * 测试数据
 * ------------------------------------------------------------------ */

const themes = [
  { id: 'zhuang-light', colorScheme: 'light', label: 'zhuang light', tokens: { '--dsw-alias-bg-base': '#FAFAF5', '--dsw-alias-label-primary': '#1A1D16' } },
  { id: 'zhuang-dark', colorScheme: 'dark', label: 'zhuang dark', tokens: { '--dsw-alias-bg-base': '#171815', '--dsw-alias-label-primary': '#E9EBE3' } },
  { id: 'burst-light', colorScheme: 'light', label: 'burst light', tokens: { '--dsw-alias-bg-base': '#F7FAF8', '--dsw-alias-label-primary': '#16201C' } },
  { id: 'burst-dark', colorScheme: 'dark', label: 'burst dark', tokens: { '--dsw-alias-bg-base': '#141917', '--dsw-alias-label-primary': '#E4EDE8' } },
  { id: 'cyan-light', colorScheme: 'light', label: 'cyan light', tokens: { '--dsw-alias-bg-base': '#F6FAFA', '--dsw-alias-label-primary': '#141F20' } },
  { id: 'cyan-dark', colorScheme: 'dark', label: 'cyan dark', tokens: { '--dsw-alias-bg-base': '#141819', '--dsw-alias-label-primary': '#E3EDEE' } },
  { id: 'wine-light', colorScheme: 'light', label: 'wine light', tokens: { '--dsw-alias-bg-base': '#FBF8F7', '--dsw-alias-label-primary': '#201A1A' } },
  { id: 'wine-dark', colorScheme: 'dark', label: 'wine dark', tokens: { '--dsw-alias-bg-base': '#181516', '--dsw-alias-label-primary': '#EDE4E4' } }
]

const overrides = {
  zhuang: { '--dsw-alias-bg-base': { light: '#FAFAF5', dark: '#171815' } },
  burst: { '--dsw-alias-bg-base': { light: '#F7FAF8', dark: '#141917' } },
  cyan: { '--dsw-alias-bg-base': { light: '#F6FAFA', dark: '#141819' } },
  wine: { '--dsw-alias-bg-base': { light: '#FBF8F7', dark: '#181516' } }
}

/** 角色表：壁纸的纱色由它算，测试需要真值。 */
const roles = {
  zhuang: { light: { base: '#FAFAF5', sidebar: '#F5F6EF' }, dark: { base: '#171815', sidebar: '#1A1C18' } },
  burst: { light: { base: '#F7FAF8', sidebar: '#F1F6F3' }, dark: { base: '#141917', sidebar: '#161C1A' } },
  cyan: { light: { base: '#F6FAFA', sidebar: '#F0F6F6' }, dark: { base: '#141819', sidebar: '#161B1C' } },
  wine: { light: { base: '#FBF8F7', sidebar: '#F7F1F0' }, dark: { base: '#181516', sidebar: '#1B1718' } }
}

const baseSettings = {
  version: 1,
  enabled: true,
  preset: 'zhuang',
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
  accentGlow: false
}

/** 跑一次完整挂载。 */
async function boot (settings, payloadOverrides) {
  const h = makeHarness(
    { settings },
    {
      themes,
      presets: ['zhuang', 'burst', 'cyan', 'wine'],
      overrides,
      roles,
      ...(payloadOverrides ?? {})
    }
  )
  globalThis.document = h.dom.document
  globalThis.fetch = h.fetchImpl
  const { module } = loadClientBundle()
  module.apply(h.ctx)
  await new Promise(r => setTimeout(r, 30))
  return { h, mod: module }
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

console.log('庄方宜主题 · 浏览器半边无头测试\n')

// 用例 1：跟随系统 -> 走 token 层，不改 preference
{
  console.log('--- 跟随系统（默认）---')
  const { h } = await boot({ ...baseSettings, scheme: 'system' })
  ok('注册了 8 个主题', h.registered.size === 8, `实际 ${h.registered.size}`)
  ok('挂了 token 层且 source 正确', h.layers.has('dsh-zhuang-fangyi'))
  ok('未改动 preference（保持 system，保住跟随系统）', h.getPreference() === 'system', h.getPreference())
  ok('设置页已注册', h.slotRegistrations.some(r => r.meta.id === 'zhuang-fangyi'))
  ok('侧栏开关已注册', h.slotRegistrations.some(r => r.meta.id === 'zhuang-fangyi-toggle'))
  ok('空白页头像已注册', h.slotRegistrations.some(r => r.meta.name === 'conversation.hero.brand.mark'))
  ok('文案字典已注册', h.dictionaries.has('settings.zhuangFangyi'))
  ok('壁纸属性已开启', h.dom.html.hasAttribute('data-zf-wallpaper') && h.dom.body.hasAttribute('data-zf-wallpaper'))
  ok('等高线边框已开启', h.dom.body.hasAttribute('data-zf-contour'))
  ok('微光默认关闭', !h.dom.body.hasAttribute('data-zf-glow'))
  ok('纱带 alpha（14% 壁纸 -> 0.860）',
    /rgba\(250, 250, 245, 0\.860\)/.test(h.dom.html.props.get('--zf-veil') ?? ''),
    h.dom.html.props.get('--zf-veil'))
  ok('侧栏纱同样带 alpha',
    /rgba\(245, 246, 239, 0\.860\)/.test(h.dom.html.props.get('--zf-veil-sidebar') ?? ''),
    h.dom.html.props.get('--zf-veil-sidebar'))
  ok('壁纸图指向当前预设', h.dom.html.props.get('--zf-art-src') === 'var(--zf-art-sakura)', h.dom.html.props.get('--zf-art-src'))
}

// 用例 2：固定深色 -> 走 setTheme
{
  console.log('\n--- 固定深色 ---')
  const { h } = await boot({ ...baseSettings, scheme: 'dark' })
  ok('preference 切到注册主题', h.getPreference() === 'zhuang-dark', h.getPreference())
  ok('未额外挂 token 层（由主题接管）', !h.layers.has('dsh-zhuang-fangyi'))
  ok('壁纸切到暗色版', h.dom.html.props.get('--zf-art-src') === 'var(--zf-art-sakura-dark)', h.dom.html.props.get('--zf-art-src'))
  ok('纱用暗色角色', /rgba\(23, 24, 21, 0\.860\)/.test(h.dom.html.props.get('--zf-veil') ?? ''), h.dom.html.props.get('--zf-veil'))
}

// 用例 3：固定浅色 + 另一预设
{
  console.log('\n--- 固定浅色 + 大招预设 ---')
  const { h } = await boot({ ...baseSettings, preset: 'burst', scheme: 'light' })
  ok('preference 切到 burst-light', h.getPreference() === 'burst-light', h.getPreference())
}

// 用例 4：关闭主题 -> 不留属性、不留层
{
  console.log('\n--- 关闭主题 ---')
  const { h } = await boot({ ...baseSettings, enabled: false })
  ok('无 token 层', !h.layers.has('dsh-zhuang-fangyi'))
  ok('壁纸属性已清', !h.dom.html.hasAttribute('data-zf-wallpaper') && !h.dom.body.hasAttribute('data-zf-wallpaper'))
  ok('装饰属性已清', !h.dom.body.hasAttribute('data-zf-contour') && !h.dom.body.hasAttribute('data-zf-glow'))
  ok('preference 未被动过', h.getPreference() === 'system')
}

// 用例 5：背景 none
{
  console.log('\n--- 背景 none ---')
  const { h } = await boot({ ...baseSettings, background: 'none' })
  ok('未开启壁纸属性', !h.dom.html.hasAttribute('data-zf-wallpaper'))
  ok('token 层仍在（配色不受影响）', h.layers.has('dsh-zhuang-fangyi'))
}

// 用例 6：平铺 + 模糊
{
  console.log('\n--- 平铺 + 模糊 ---')
  const { h } = await boot({ ...baseSettings, backgroundPosition: 'tile', backgroundBlur: 8, backgroundOpacity: 20 })
  ok('size=auto', h.dom.html.props.get('--zf-art-size') === 'auto')
  ok('position=0 0', h.dom.html.props.get('--zf-art-position') === '0 0')
  ok('repeat=repeat', h.dom.html.props.get('--zf-art-repeat') === 'repeat')
  ok('blur=8px', h.dom.html.props.get('--zf-blur') === '8px')
  ok('keep=80% -> 纱 alpha 0.800', /0\.800\)/.test(h.dom.html.props.get('--zf-veil') ?? ''), h.dom.html.props.get('--zf-veil'))
}

// 用例 7：明暗切换时壁纸与纱一起切
{
  console.log('\n--- 明暗切换 ---')
  const { h } = await boot({ ...baseSettings })
  h.dom.body.setAttribute('data-ds-dark-theme', '')
  for (const fn of h.listeners.get('theme/change') ?? []) fn()
  ok('壁纸切到暗色图', h.dom.html.props.get('--zf-art-src') === 'var(--zf-art-sakura-dark)', h.dom.html.props.get('--zf-art-src'))
  ok('纱同步切到暗色角色', /rgba\(23, 24, 21, 0\.860\)/.test(h.dom.html.props.get('--zf-veil') ?? ''), h.dom.html.props.get('--zf-veil'))
  h.dom.body.removeAttribute('data-ds-dark-theme')
  for (const fn of h.listeners.get('theme/change') ?? []) fn()
  ok('切回亮色图', h.dom.html.props.get('--zf-art-src') === 'var(--zf-art-sakura)', h.dom.html.props.get('--zf-art-src'))
  ok('纱切回亮色角色', /rgba\(250, 250, 245, 0\.860\)/.test(h.dom.html.props.get('--zf-veil') ?? ''), h.dom.html.props.get('--zf-veil'))
}

// 用例 8：头像开关真的生效（曾是不可用的假开关）
{
  console.log('\n--- 头像开关 ---')
  const on = await boot({ ...baseSettings, heroAvatar: true })
  ok('开启时注册头像', on.h.slotRegistrations.some(r => r.meta.name === 'conversation.hero.brand.mark'))
  const off = await boot({ ...baseSettings, heroAvatar: false })
  ok('关闭时不注册头像（外壳默认标记回来）',
    !off.h.slotRegistrations.some(r => r.meta.name === 'conversation.hero.brand.mark'))
  const disabled = await boot({ ...baseSettings, enabled: false, heroAvatar: true })
  ok('主题关闭时不注册头像',
    !disabled.h.slotRegistrations.some(r => r.meta.name === 'conversation.hero.brand.mark'))
}

// 用例 9：标题栏开关
{
  console.log('\n--- 标题栏跟随开关 ---')
  const on = await boot({ ...baseSettings, titlebarFollow: true })
  ok('开启时不加不透明标记', !on.h.dom.body.hasAttribute('data-zf-opaque-titlebar'))
  const off = await boot({ ...baseSettings, titlebarFollow: false })
  ok('关闭时加不透明标记', off.h.dom.body.hasAttribute('data-zf-opaque-titlebar'))
}

// 用例 10：id 冲突时不崩，且退回 token 层
{
  console.log('\n--- 注册 id 冲突 ---')
  const h = makeHarness(
    { settings: { ...baseSettings, scheme: 'dark' } },
    { themes, presets: ['zhuang'], overrides, roles }
  )
  h.ctx.theme.register({ id: 'zhuang-dark', colorScheme: 'dark', tokens: {} })
  globalThis.document = h.dom.document
  globalThis.fetch = h.fetchImpl
  const { module } = loadClientBundle()
  module.apply(h.ctx)
  await new Promise(r => setTimeout(r, 30))
  ok('冲突的 7 个主题仍注册成功', h.registered.size === 8, `实际 ${h.registered.size}`)
  ok('冲突的那一个未被覆盖', h.registered.get('zhuang-dark')?.label === undefined)
  ok('退回 token 层保证配色生效', h.layers.has('dsh-zhuang-fangyi'))
}

// 用例 11：卸载还原
{
  console.log('\n--- 卸载还原 ---')
  const { h } = await boot({ ...baseSettings, scheme: 'dark' })
  ok('卸载前 preference 指向本插件', h.getPreference() === 'zhuang-dark')
  for (const e of [...h.effects].reverse()) e.dispose?.()
  ok('卸载后 preference 落回 system', h.getPreference() === 'system', h.getPreference())
  ok('卸载后主题全部注销', h.registered.size === 0, `剩余 ${h.registered.size}`)
  ok('卸载后无 token 层', !h.layers.has('dsh-zhuang-fangyi'))
  ok('卸载后壁纸属性清空', !h.dom.html.hasAttribute('data-zf-wallpaper'))
  ok('卸载后头像注销', !h.slotRegistrations.some(r => r.meta.name === 'conversation.hero.brand.mark'))
}

// 用例 12：布局健壮性（回归：控件被挤出可视区）
{
  console.log('\n--- 布局健壮性 ---')
  const source = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  ok('行容器用 grid 且左列可收缩', /gridTemplateColumns:\s*'minmax\(0,\s*1fr\)\s+auto'/.test(source))
  ok('提示文字允许换行（长中文不撑破）', /overflowWrap:\s*'anywhere'/.test(source))
  ok('控件列允许换行', /flexWrap:\s*'wrap'/.test(source))
  ok('根容器有宽度约束', /maxWidth:\s*720/.test(source))
}

// 用例 13：契约健全性
{
  console.log('\n--- 契约健全性 ---')
  const source = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  ok('bundle id 与包名一致', source.includes("id: 'dsh-zhuang-fangyi'"))
  ok('导出 apply / inject / name',
    /exports\.apply = apply/.test(source) && /exports\.inject = inject/.test(source) && /exports\.name = 'zhuang-fangyi'/.test(source))
  ok('inject 声明为服务名（非包名）', /const inject = \['theme', 'slots', 'locale'\]/.test(source))
  ok('不含 JSX', !/<[A-Z][A-Za-z]*\s*\/?>/.test(source.replace(/<style|<head|<body|<\/style|<\/head|<\/body/g, '')))
  // 只看代码，不看注释：注释里提到 ctx.get 是解释为什么不用它
  const codeOnly = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  ok('无 ctx.get 误用（bundle 用属性访问）', !/ctx\.get\(/.test(codeOnly))
}

/* ------------------------------------------------------------------ *
 * v2：皮肤层（顶栏 / 右侧观测栏 / 头像气泡 / 外壳打标）
 * ------------------------------------------------------------------ */

/**
 * 共享的 module 句柄。
 *
 * `__test` 是在 `apply()` 里赋值的（它需要 apply 内的闭包），所以纯函数用例
 * 也必须先跑一次完整挂载才能拿到 —— 这里只挂一次并复用，避免每个用例都
 * 重复 boot（那样会建立 20 多个 MutationObserver，既慢又难断言）。
 */
const SHARED_MOD = (await (async () => {
  const h = makeHarness(
    { settings: { ...baseSettings } },
    { themes, presets: ['zhuang', 'burst', 'cyan', 'wine'], overrides, roles }
  )
  globalThis.document = h.dom.document
  globalThis.fetch = h.fetchImpl
  const { module } = loadClientBundle()
  module.apply(h.ctx)
  await new Promise(r => setTimeout(r, 30))
  return module
})())

/** 造一个带外壳 DOM 的 document，供打标用例使用。 */
function shellDom (opts = {}) {
  const { document, html, head, body } = makeDom()
  const root = new El('div')
  root.setAttribute('id', 'root')
  body.appendChild(root)

  // AppFrame 的 CSS Module 样式标签：哈希前缀可切换，验证「不猜哈希」
  const prefix = opts.prefix ?? 'BynINW'
  const rightbarPart = opts.rightbarPart ?? 'rightbarCol'
  const style = new El('style')
  style.setAttribute('data-plugin-css', '@deepseek-ai/dsh-client-ui-layout/AppFrame.module.css')
  style.textContent =
    `.${prefix}_frame{background:var(--dsw-alias-bg-base)}` +
    `.${prefix}_sidebarCol{background:var(--dsw-specific-sidebar-fill)}` +
    `.${prefix}_centerCol{display:flex}` +
    `.${prefix}_${rightbarPart}{min-width:0}` +
    `.${prefix}_handle{cursor:col-resize}`
  head.appendChild(style)

  // 外壳三列
  const frame = new El('div')
  frame.className = `${prefix}_frame`
  const sidebar = new El('div')
  sidebar.className = `${prefix}_sidebarCol`
  const center = new El('div')
  center.className = `${prefix}_centerCol`
  const rightbar = new El('div')
  rightbar.className = `${prefix}_${rightbarPart}`
  if (opts.rightbarCollapsed !== false) {
    frame.setAttribute(opts.collapseAttr ?? 'data-rightbar-collapsed', '')
  }
  frame.appendChild(sidebar)
  frame.appendChild(center)
  frame.appendChild(rightbar)
  root.appendChild(frame)

  // 统计行（右栏读数来源）
  if (opts.stats !== undefined) {
    const stats = new El('div')
    stats.setAttribute('data-composer-stats', '')
    stats.textContent = opts.stats
    center.appendChild(stats)
  }

  // 聊天行（会话状态来源）
  for (const kind of opts.kinds ?? []) {
    const row = new El('div')
    row.setAttribute('data-chat-flow-kind', kind)
    center.appendChild(row)
  }

  return { document, html, head, body, frame, sidebar, center, rightbar, style }
}

// 用例 14：外壳打标 —— 两套壳都要能定位
{
  console.log('\n--- 外壳打标（双壳适配）---')
  const mod = SHARED_MOD

  // 桌面壳：BynINW + rightbarCol
  const desktop = shellDom({ prefix: 'BynINW', rightbarPart: 'rightbarCol' })
  const m1 = mod.__test.makeModuleClass(desktop.document)
  ok('反查桌面壳 frame 类名', m1('AppFrame', 'frame') === 'BynINW_frame', String(m1('AppFrame', 'frame')))
  ok('反查桌面壳 rightbarCol', m1('AppFrame', 'rightbarCol') === 'BynINW_rightbarCol')
  ok('反查桌面壳 sidebarCol', m1('AppFrame', 'sidebarCol') === 'BynINW_sidebarCol')

  // Web 壳：pI_x6G + detailsCol（右栏换名）
  const web = shellDom({ prefix: 'pI_x6G', rightbarPart: 'detailsCol' })
  const m2 = mod.__test.makeModuleClass(web.document)
  ok('反查 Web 壳 frame 类名', m2('AppFrame', 'frame') === 'pI_x6G_frame', String(m2('AppFrame', 'frame')))
  ok('反查 Web 壳 detailsCol', m2('AppFrame', 'detailsCol') === 'pI_x6G_detailsCol')
  ok('同一函数换 document 不串缓存', m1('AppFrame', 'frame') === 'BynINW_frame' && m2('AppFrame', 'frame') === 'pI_x6G_frame')

  // 样式标签缺失 -> 返回 null 且不抛
  const bare = makeDom()
  const m3 = mod.__test.makeModuleClass(bare.document)
  ok('缺样式标签时返回 null 且不抛', m3('AppFrame', 'frame') === null)
}

// 用例 15：转义类名（CSS 标识符里的 \3f 形式）
{
  console.log('\n--- 转义类名解析 ---')
  const mod = SHARED_MOD
  const { document, head } = makeDom()
  const style = new El('style')
  style.setAttribute('data-plugin-css', '@deepseek-ai/dsh-client-ui-conversation/QueueDock.module.css')
  // CSS 里以数字开头的类名会写成 `\37 yHdaG_row` 这种转义
  style.textContent = '.\\37 yHdaG_row{display:flex}'
  head.appendChild(style)
  const mc = mod.__test.makeModuleClass(document)
  const got = mc('QueueDock', 'row')
  ok('反转义数字开头的类名', got === '7yHdaG_row', String(got))
}

// 用例 16：打标幂等 + 可完全还原
{
  console.log('\n--- 打标幂等与还原 ---')
  const mod = SHARED_MOD
  const { marker } = { marker: mod.__test.makeMarker() }
  const el = new El('div')
  ok('首次打标生效', marker.mark(el, 'data-zf-frame') === true)
  ok('重复打标被跳过（幂等）', marker.mark(el, 'data-zf-frame') === false)
  ok('属性已存在', el.hasAttribute('data-zf-frame'))
  ok('计数为 1', marker.count() === 1, String(marker.count()))

  marker.mark(el, 'data-zf-sidebar')
  marker.reset()
  ok('reset 后属性清空', !el.hasAttribute('data-zf-frame') && !el.hasAttribute('data-zf-sidebar'))
  ok('reset 后计数归零', marker.count() === 0)

  // 断开节点被 prune 清理
  const gone = new El('div')
  marker.mark(gone, 'data-zf-frame')
  gone.isConnected = false
  ok('prune 清理断开节点', marker.prune() === 1 && !gone.hasAttribute('data-zf-frame'))
  ok('prune 后计数归零', marker.count() === 0)
}

// 用例 17：会话状态判定
{
  console.log('\n--- 会话状态判定 ---')
  const mod = SHARED_MOD
  const idle = makeDom()
  ok('无聊天行 -> idle', mod.__test.readSessionState(idle.document) === 'idle')

  const withTail = shellDom({ kinds: ['user', 'assistant-step', 'turn-tail'] })
  ok('有 turn-tail -> done', mod.__test.readSessionState(withTail.document) === 'done')

  const withErr = shellDom({ kinds: ['user', 'assistant-step', 'turn-error'] })
  ok('有 turn-error -> error', mod.__test.readSessionState(withErr.document) === 'error')

  const plain = shellDom({ kinds: ['user', 'assistant-step'] })
  ok('有行但无结束标记 -> ready', mod.__test.readSessionState(plain.document) === 'ready')
}

// 用例 18：统计行解析
{
  console.log('\n--- 统计行解析 ---')
  const mod = SHARED_MOD
  const hit = shellDom({ stats: '12 轮 · 34 步 · 缓存命中 87.5%' })
  const r = mod.__test.readStats(hit.document)
  ok('解析轮次', r.turns === '12', r.turns)
  ok('解析步数', r.steps === '34', r.steps)
  ok('解析缓存命中', r.cache === '87.5%', r.cache)

  const miss = mod.__test.readStats(makeDom().document)
  ok('无统计行时回落占位符', miss.turns === '—' && miss.steps === '—' && miss.cache === '—')
}

// 用例 19：原生右栏让位
{
  console.log('\n--- 原生右栏让位 ---')
  const mod = SHARED_MOD
  const collapsed = shellDom({ rightbarCollapsed: true })
  ok('折叠时判定为未展开', mod.__test.nativeRightbarOpen(collapsed.document) === false)

  const open = shellDom({ rightbarCollapsed: false })
  ok('未折叠时判定为已展开', mod.__test.nativeRightbarOpen(open.document) === true)

  const webOpen = shellDom({ prefix: 'pI_x6G', rightbarPart: 'detailsCol', rightbarCollapsed: false, collapseAttr: 'data-details-collapsed' })
  ok('Web 壳 details-collapsed 同样识别', mod.__test.nativeRightbarOpen(webOpen.document) === true)
}

// 用例 20：v2 设置项生效
{
  console.log('\n--- v2 设置项 ---')
  const on = await boot({ ...baseSettings, topbar: true, rail: true, railWidth: 320, avatarBubbles: true })
  ok('顶栏开关默认开（不加 off 标记）', !on.h.dom.body.hasAttribute('data-zf-topbar'))
  ok('头像气泡标记已加', on.h.dom.body.hasAttribute('data-zf-avatar'))
  ok('右栏宽度写进变量', on.h.dom.html.props.get('--zf-rail-width') === '320px',
    String(on.h.dom.html.props.get('--zf-rail-width')))
  ok('头像图变量已写', String(on.h.dom.html.props.get('--zf-avatar-image') ?? '').includes('avatar.webp'))

  const off = await boot({ ...baseSettings, topbar: false, avatarBubbles: false })
  ok('顶栏关闭时加 off 标记', off.h.dom.body.getAttribute('data-zf-topbar') === 'off')
  ok('头像气泡关闭时移除标记', !off.h.dom.body.hasAttribute('data-zf-avatar'))

  const wide = await boot({ ...baseSettings, railWidth: 999 })
  ok('右栏宽度超范围被夹取', wide.h.dom.html.props.get('--zf-rail-width') === '380px',
    String(wide.h.dom.html.props.get('--zf-rail-width')))
}

// 用例 21：新插槽注册与注销
{
  console.log('\n--- v2 插槽注册 ---')
  const { h } = await boot({ ...baseSettings })
  ok('顶栏注册进 shell.overlay',
    h.slotRegistrations.some(r => r.meta.name === 'shell.overlay' && r.meta.id === 'zhuang-fangyi-topbar'))
  ok('右栏注册进 shell.overlay',
    h.slotRegistrations.some(r => r.meta.name === 'shell.overlay' && r.meta.id === 'zhuang-fangyi-rail'))
  ok('侧栏品牌位已注册', h.slotRegistrations.some(r => r.meta.name === 'sidebar.brand.mark'))
  ok('侧栏品牌名已注册', h.slotRegistrations.some(r => r.meta.name === 'sidebar.brand.name'))

  for (const e of [...h.effects].reverse()) e.dispose?.()
  ok('卸载后 shell.overlay 全部注销', !h.slotRegistrations.some(r => r.meta.name === 'shell.overlay'))
  ok('卸载后品牌位注销', !h.slotRegistrations.some(r => r.meta.name === 'sidebar.brand.mark'))
  ok('卸载后右栏宽度变量清空', !h.dom.html.props.has('--zf-rail-width'))
}

// 用例 22：观察器生命周期
{
  console.log('\n--- 观察器生命周期 ---')
  MutationObserverStub.instances = []
  const { h } = await boot({ ...baseSettings })
  ok('建立了 MutationObserver', MutationObserverStub.instances.length >= 1,
    `实际 ${MutationObserverStub.instances.length}`)
  const inst = MutationObserverStub.instances[0]
  ok('收窄了 attributeFilter（否则流式输出每帧触发）',
    Array.isArray(inst.observed?.options?.attributeFilter) &&
    inst.observed.options.attributeFilter.includes('data-ds-dark-theme'))
  ok('未断开时 connected', inst.disconnected === false)
  for (const e of [...h.effects].reverse()) e.dispose?.()
  ok('卸载后断开观察器', inst.disconnected === true)
}

// 用例 23：皮肤样式表由客户端注入（桌面端 tapIndex 不执行）
{
  console.log('\n--- 皮肤样式表注入 ---')
  const { h } = await boot({ ...baseSettings })
  const styleEl = h.dom.head.children.find(c => c.getAttribute('id') === 'zf-style')
  ok('客户端取了 /style.css', h.calls.some(c => c.url.endsWith('/style.css')))
  ok('插入了 <style id="zf-style">', styleEl !== undefined)
  ok('样式内容已写入', (styleEl?.textContent ?? '').includes('.zf-topbar'))
  ok('带 data-plugin 标记', styleEl?.getAttribute('data-plugin') === 'dsh-zhuang-fangyi')
  ok('插在 head 里', h.dom.head.children.includes(styleEl))

  for (const e of [...h.effects].reverse()) e.dispose?.()
  ok('卸载后样式表移除',
    h.dom.head.children.find(c => c.getAttribute('id') === 'zf-style') === undefined)
}

// 用例 24：样式表取不到时不能阻断启动
{
  console.log('\n--- 样式表失败降级 ---')
  const h = makeHarness(
    { settings: { ...baseSettings } },
    { themes, presets: ['zhuang', 'burst', 'cyan', 'wine'], overrides, roles },
    null  // /style.css 返回 500
  )
  globalThis.document = h.dom.document
  globalThis.fetch = h.fetchImpl
  const { module } = loadClientBundle()
  module.apply(h.ctx)
  await new Promise(r => setTimeout(r, 40))
  // 样式拿不到只影响外观；配色必须仍然生效（token 层独立于样式表）
  ok('样式表失败不阻断启动：配色仍生效', h.layers.has('dsh-zhuang-fangyi'))
  ok('样式表失败不阻断启动：主题仍注册', h.registered.size === 8, `实际 ${h.registered.size}`)
  ok('样式表失败不阻断启动：壁纸属性仍设置', h.dom.body.hasAttribute('data-zf-wallpaper'))
  ok('样式表失败不阻断启动：设置页仍注册',
    h.slotRegistrations.some(r => r.meta.id === 'zhuang-fangyi'))
}

// 用例 25：样式表只插一次（重复 load 不重复插）
{
  console.log('\n--- 样式表幂等 ---')
  const { h, mod } = await boot({ ...baseSettings })
  const before = h.dom.head.children.filter(c => c.getAttribute('id') === 'zf-style').length
  // 再取一次：ensureStyle 有 state.styleEl 短路，不应重复插
  await mod.__test.ensureStyle?.()
  const after = h.dom.head.children.filter(c => c.getAttribute('id') === 'zf-style').length
  ok('只插一个 <style id="zf-style">', before === 1 && after === 1, `before=${before} after=${after}`)
}
// 用例 26：样式表缺失时顶栏/右栏不渲染（防裸渲染）
{
  console.log('\n--- 样式表缺失时门控 ---')
  const h = makeHarness(
    { settings: { ...baseSettings } },
    { themes, presets: ['zhuang', 'burst', 'cyan', 'wine'], overrides, roles },
    null  // /style.css 500
  )
  globalThis.document = h.dom.document
  globalThis.fetch = h.fetchImpl
  const { module } = loadClientBundle()
  module.apply(h.ctx)
  await new Promise(r => setTimeout(r, 40))
  ok('styleReady 为 false', module.__test.state.styleReady === false)
  // 关键：顶栏与右栏组件必须返回 null，否则 <img> 会按原始尺寸裸渲染
  const overlay = h.slotRegistrations.filter(r => r.meta.name === 'shell.overlay')
  ok('顶栏与右栏仍注册（插槽层不隐藏）', overlay.length === 2, `实际 ${overlay.length}`)
  const topbar = overlay.find(r => r.meta.id === 'zhuang-fangyi-topbar')
  const rail = overlay.find(r => r.meta.id === 'zhuang-fangyi-rail')
  // 用桩 React 调用组件：createElement 返回 {type, props, children}，
  // 但组件是函数，这里直接调用它（桩 useState 返回初始值）
  const topbarOut = topbar?.component?.({})
  const railOut = rail?.component?.({})
  ok('顶栏组件在样式缺失时返回 null', topbarOut === null, String(topbarOut))
  ok('右栏组件在样式缺失时返回 null', railOut === null, String(railOut))
}

// 用例 27：样式表就绪后顶栏/右栏正常渲染
{
  console.log('\n--- 样式表就绪后渲染 ---')
  const { h, mod } = await boot({ ...baseSettings })
  ok('styleReady 为 true', mod.__test.state.styleReady === true)
  const overlay = h.slotRegistrations.filter(r => r.meta.name === 'shell.overlay')
  const topbar = overlay.find(r => r.meta.id === 'zhuang-fangyi-topbar')
  const topbarOut = topbar?.component?.({})
  ok('顶栏组件返回元素（非 null）', topbarOut !== null && topbarOut !== undefined)
  ok('顶栏根节点用 .zf-topbar 类', topbarOut?.props?.className === 'zf-topbar',
    String(topbarOut?.props?.className))
}
// 用例 28：中栏内容层打标（壁纸被 ConversationRoot 挡住的回归）
{
  console.log('\n--- 中栏内容层打标 ---')
  const mod = SHARED_MOD
  // 造一个带 ConversationRoot 的外壳 DOM
  const { document, head, body } = makeDom()
  const root = new El('div')
  root.setAttribute('id', 'root')
  body.appendChild(root)

  const style = new El('style')
  style.setAttribute('data-plugin-css', '@deepseek-ai/dsh-client-ui-layout/AppFrame.module.css')
  style.textContent =
    '.BynINW_frame{background:var(--dsw-alias-bg-base)}' +
    '.BynINW_sidebarCol{background:var(--dsw-specific-sidebar-fill)}' +
    '.BynINW_centerCol{display:flex}' +
    '.BynINW_rightbarCol{min-width:0}'
  head.appendChild(style)

  const style2 = new El('style')
  style2.setAttribute('data-plugin-css', '@deepseek-ai/dsh-client-ui-conversation/ConversationRoot.module.css')
  // 真实规则就是这条：内容根自己铺了不透明 bg-base，会挡住壁纸
  style2.textContent = '.Dc7zOa_root{background:var(--dsw-alias-bg-base);display:flex}' +
    '.Dc7zOa_scrollBody{overflow:auto}'
  head.appendChild(style2)

  const frame = new El('div'); frame.className = 'BynINW_frame'
  const sidebar = new El('div'); sidebar.className = 'BynINW_sidebarCol'
  const center = new El('div'); center.className = 'BynINW_centerCol'
  const rightbar = new El('div'); rightbar.className = 'BynINW_rightbarCol'
  frame.setAttribute('data-rightbar-collapsed', '')
  const convRoot = new El('div'); convRoot.className = 'Dc7zOa_root'
  const convScroll = new El('div'); convScroll.className = 'Dc7zOa_scrollBody'
  convRoot.appendChild(convScroll)
  center.appendChild(convRoot)
  frame.append(sidebar, center, rightbar)
  root.appendChild(frame)

  const mc = mod.__test.makeModuleClass(document)
  ok('反查到 ConversationRoot 根类名', mc('ConversationRoot', 'root') === 'Dc7zOa_root',
    String(mc('ConversationRoot', 'root')))

  // 打标：模拟 mountSkin 里那段逻辑
  const marker = mod.__test.makeMarker()
  for (const [m, part] of [
    ['ConversationRoot', 'root'], ['ChatView', 'root'], ['HeroShell', 'root'],
    ['ConversationRoot', 'scrollBody'], ['ChatView', 'scroll']
  ]) {
    const cls = mc(m, part)
    if (cls === null) continue
    for (const el of document.getElementsByClassName(cls)) {
      marker.mark(el, part === 'scrollBody' || part === 'scroll' ? 'data-zf-scroll' : 'data-zf-content')
    }
  }
  ok('ConversationRoot 根打了 data-zf-content', convRoot.hasAttribute('data-zf-content'))
  ok('滚动容器打了 data-zf-scroll', convScroll.hasAttribute('data-zf-scroll'))
  ok('缺失的模块被跳过（ChatView 不在）', !center.hasAttribute('data-zf-content'))

  marker.reset()
  ok('reset 后全部还原',
    !convRoot.hasAttribute('data-zf-content') && !convScroll.hasAttribute('data-zf-scroll'))
}

// 用例 29：CSS 含中栏内容透明规则（壁纸可见性的关键）
{
  console.log('\n--- 中栏透明规则 ---')
  const { structureStyle } = await import('../index.js')
  const css = structureStyle()
  ok('含 [data-zf-content] 透明规则', css.includes('[data-zf-content]'))
  ok('含 [data-zf-scroll] 透明规则', css.includes('[data-zf-scroll]'))
  // 反向断言：模糊兜底必须**不存在**。
  // `data-phase` 是通用属性（对话根 / 输入编辑器 / 重连指示器都在用），
  // 配 `[class*="_root"]` 会误伤一大片元素 —— 实测把侧栏整个刷透明了。
  // 只认客户端打的精确锚点。
  ok('不含 [class*="_root"][data-phase] 模糊兜底（会误伤侧栏）',
    !css.includes('[class*="_root"][data-phase]'))
  ok('不含 [class*="ConversationRoot"] 类名兜底',
    !css.includes('[class*="ConversationRoot"]'))
  ok('中栏内容用 transparent !important',
    /\[data-zf-content\][^{]*\{[^}]*background:transparent\s*!important/.test(css) ||
    css.includes('background:transparent !important'))
}

// 用例 30：顶栏定位与「不放按钮」（用户反馈驱动的回归）
{
  console.log('\n--- 顶栏定位 ---')
  const { structureStyle } = await import('../index.js')
  const css = structureStyle()
  // 顶栏不放按钮：观测栏开关与插件开关都移到设置页了
  // （原先挤在标题栏右侧，与系统的窗口按钮抢位置）
  ok('顶栏不含按钮容器', !css.includes('zf-topbar__actions'))
  ok('顶栏不含按钮样式', !css.includes('zf-topbar__btn'))
  ok('顶栏靠左对齐（flex 而非两列 grid）',
    /\.zf-topbar\{[^}]*display:flex/.test(css))
  ok('顶栏整条可拖动窗口', css.includes('-webkit-app-region:drag'))
  ok('顶栏内容不吃拖拽', css.includes('.zf-topbar__lead{ -webkit-app-region:no-drag; }'))
  // 坐标系：`overlayLayer` 的 `inset:0` 解析的是 padding box，**已经**在
  // Windows 标题栏之下。元素再让一次就会整体下移 40px —— 实测就是这个 bug。
  ok('顶栏锚在 overlay 的 top:0（不再让开标题栏）',
    /\.zf-topbar\{[^}]*top:0/.test(css))
  ok('右栏紧接顶栏下方', /\.zf-rail\{[^}]*top:var\(--zf-topbar-height\)/.test(css))
}
// 用例 31：品牌位冲突不能中断 apply()（实测事故的回归）
{
  console.log('\n--- 品牌位冲突（single 槽）---')
  // 复刻真实环境：官方 dsh-client-ui-brand 已占 sidebar.brand.mark 的 priority 0
  const h = makeHarness(
    { settings: { ...baseSettings } },
    { themes, presets: ['zhuang', 'burst', 'cyan', 'wine'], overrides, roles }
  )
  h.slotRegistrations.push({
    meta: { name: 'sidebar.brand.mark', priority: 0, registrant: 'mf' },
    component: () => null
  })
  h.slotRegistrations.push({
    meta: { name: 'sidebar.brand.name', priority: 0, registrant: 'mf' },
    component: () => null
  })
  globalThis.document = h.dom.document
  globalThis.fetch = h.fetchImpl
  const { module } = loadClientBundle()

  // 关键：apply() 不能抛错
  let threw = null
  try {
    module.apply(h.ctx)
  } catch (error) {
    threw = error
  }
  await new Promise(r => setTimeout(r, 40))
  ok('apply() 未因插槽冲突中断', threw === null, String(threw?.message ?? threw))

  // 用更低 priority 遮蔽官方（single 槽：priority 最低者渲染）
  const mine = h.slotRegistrations.filter(r => r.meta.name === 'sidebar.brand.mark')
  ok('品牌位有两条注册（官方 + 本插件）', mine.length === 2, `实际 ${mine.length}`)
  const shadows = mine.filter(r => (r.meta.priority ?? 0) < 0)
  ok('本插件用更低 priority 遮蔽官方', shadows.length === 1, `实际 ${shadows.length}`)

  // 冲突只影响品牌位，其余功能必须全部照常
  ok('样式表仍注入', h.dom.head.children.some(c => c.getAttribute('id') === 'zf-style'))
  ok('顶栏仍注册', h.slotRegistrations.some(r => r.meta.id === 'zhuang-fangyi-topbar'))
  ok('右栏仍注册', h.slotRegistrations.some(r => r.meta.id === 'zhuang-fangyi-rail'))
  ok('设置页仍注册', h.slotRegistrations.some(r => r.meta.id === 'zhuang-fangyi'))
  ok('侧栏开关仍注册', h.slotRegistrations.some(r => r.meta.id === 'zhuang-fangyi-toggle'))
  ok('主题仍注册 8 个', h.registered.size === 8, `实际 ${h.registered.size}`)
  ok('配色仍生效（token 层）', h.layers.has('dsh-zhuang-fangyi'))
  ok('壁纸属性仍设置', h.dom.body.hasAttribute('data-zf-wallpaper'))
  ok('打标运行时仍建立', module.__test.state.skin !== null)
  ok('styleReady 为 true', module.__test.state.styleReady === true)
}

// 用例 32：safeInject 对任意插槽失败都免疫
{
  console.log('\n--- safeInject 容错 ---')
  const h = makeHarness(
    { settings: { ...baseSettings } },
    { themes, presets: ['zhuang', 'burst', 'cyan', 'wine'], overrides, roles }
  )
  // 让所有 register 都抛错，验证 apply() 依然能跑完
  h.ctx.slots.register = () => { throw new Error('simulated slot failure') }
  globalThis.document = h.dom.document
  globalThis.fetch = h.fetchImpl
  const { module } = loadClientBundle()
  let threw = null
  try {
    module.apply(h.ctx)
  } catch (error) {
    threw = error
  }
  await new Promise(r => setTimeout(r, 40))
  ok('全部插槽注册失败时 apply() 仍不中断', threw === null, String(threw?.message ?? threw))
  ok('样式表仍注入（不依赖插槽）',
    h.dom.head.children.some(c => c.getAttribute('id') === 'zf-style'))
  ok('主题仍注册（不依赖插槽）', h.registered.size === 8, `实际 ${h.registered.size}`)
}
console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (fail > 0) {
  console.log(`\n失败项：\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('全部通过。')
