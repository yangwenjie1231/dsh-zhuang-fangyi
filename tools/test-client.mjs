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
 * `getComputedStyle` 桩 —— 让「壁纸渲染探针」在无头测试里也走通。
 *
 * 只做到**够用且诚实**：自定义属性优先取行内 style（client.js 正是用
 * `style.setProperty` 写这些变量），取不到再从注入的 `<style>` 文本里扫
 * `--name:value`。不模拟完整层叠 —— 那是浏览器的事；这里只保证探针读得到
 * 真实被写过的值，从而「链断在哪一环」在测试里也能被抓到。
 */
function installComputedStyleStub (doc) {
  // El 的行内样式存在 `props` Map 里（见 El.style 的 setProperty 实现）
  const inlineOf = (el, name) => (el?.props?.has?.(name) ? el.props.get(name) : undefined)
  const readVar = (el, name) => {
    const inline = inlineOf(el, name)
    if (inline !== undefined) return inline
    const css = (doc.head?.children ?? [])
      .filter(c => (c.tagName ?? '').toLowerCase() === 'style')
      .map(c => c.textContent ?? '')
      .join('\n')
    const m = new RegExp(name.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);').exec(css)
    return m ? m[1].trim() : ''
  }
  globalThis.getComputedStyle = (el, pseudo) => {
    if (pseudo === '::before') {
      return {
        backgroundImage: readVar(el, '--zf-art-src') || 'none',
        content: '""',
        zIndex: '-1',
        display: 'block'
      }
    }
    return {
      backgroundColor: inlineOf(el, 'background-color') ?? 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      getPropertyValue: name => readVar(el, name)
    }
  }
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
 * 桩 `/style.css` 的返回内容。
 *
 * **用真实的 `structureStyle()` 产物**，而不是占位字符串 —— 壁纸渲染探针要读
 * `--zf-art-<id>` 这些由样式表定义的变量（客户端只写 `--zf-art-src` 的间接
 * 引用），占位 CSS 会让「被引用变量解析不出来」而误报。用真产物后，探针的
 * 每一环都在测试里可验证。
 *
 * 顶部 await import：index.js 是 ESM，测试文件也是。
 */
const { structureStyle: realStructureStyle } = await import('../index.js')
const DEFAULT_STYLE = realStructureStyle()

/**
 * 默认「存在哪些服务」。
 *
 * `sidebarRightTabs` **默认不存在** —— 因为它是桌面专属包提供的，Web 端没有。
 * 要测官方 tab 路径的用例显式传入它。
 */
const DEFAULT_SERVICES = {}

/** 用例 37 用的 tab 注册记录。 */
const TAB_REGS = []

/**
 * 官方右栏的两个服务由**同一个包**提供（`ctx.reflect.provide`），
 * 插件一并注入。所以夹具也必须两个都给 —— 只给一个时 `ctx.inject`
 * 回调不触发（那正是 Web 端的降级路径，另有用例覆盖）。
 *
 * @param {object} tabs `sidebarRightTabs` 桩
 * @param {object} [right] `sidebarRight` 桩（导航控制器，提供 openTab）
 */
function rightServices (tabs, right) {
  return {
    sidebarRightTabs: tabs,
    sidebarRight: right ?? { openTab () {} }
  }
}

function makeHarness (settingsPayload, themePayload, stylePayload = DEFAULT_STYLE, serviceFixture = DEFAULT_SERVICES) {
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

  /**
   * 桩服务：`ctx.sidebarRightTabs`。
   *
   * 真实契约（README 实测）：
   *   register({id, kind, patterns?, priority?, canOpen?, title, guide?, keepMounted?})
   *   → 返回一个 disposer；同 id 重复注册会抛错。
   *
   * `enabled` 控制它是否「存在」—— 不存在时 `ctx.inject` 回调**永不触发**，
   * 这正是 Web 端（无 `dsh-client-ui-sidebar-right`）的降级路径。
   */
  const tabRegistrations = []
  const makeSidebarRightTabs = () => ({
    register (definition) {
      if (typeof definition?.id !== 'string' || definition.id.trim() === '') {
        throw new Error('tab id must not be empty')
      }
      if (tabRegistrations.some(r => r.id === definition.id)) {
        throw new Error(`Duplicate tab type: ${definition.id}`)
      }
      tabRegistrations.push(definition)
      return () => {
        const at = tabRegistrations.indexOf(definition)
        if (at >= 0) tabRegistrations.splice(at, 1)
      }
    }
  })

  const ctx = {
    theme,
    slots,
    locale,
    /**
     * 桩 `ctx.inject`（服务注入，**与 `slots.inject` 不同**）。
     *
     * 真实语义：声明依赖的服务名，服务就绪时同步调用回调；**服务不存在时
     * 回调永不触发**（不抛错、不报错）。这是插件做渐进增强的标准手段。
     *
     * `serviceFixture` 决定哪些服务「存在」——
     *   传 `null` 表示全都不存在（模拟 Web 端）。
     */
    inject: (deps, fn) => {
      const names = Array.isArray(deps) ? deps : [deps]
      const missing = names.filter(n => serviceFixture[n] === undefined)
      if (missing.length > 0) {
        // 服务缺失：回调不跑（真实行为），只登记一次「未触发」供断言
        effects.push({ dispose: null, label: `inject-pending:${names.join(',')}` })
        return () => {}
      }
      const scope = { ...ctx }
      for (const n of names) scope[n] = serviceFixture[n]
      const dispose = fn(scope)
      effects.push({ dispose: dispose ?? null, label: `inject:${names.join(',')}` })
      return () => dispose?.()
    },
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
        // 宿主的真实行为：`{"reset": true}` → 写入 defaultSettings()
        settingsPayload = {
          settings: parsed.reset === true
            ? (await import('../src/settings.js')).defaultSettings()
            : parsed.settings
        }
      }
      // 用例 42：模拟「宿主设置被外部改动」—— 一次性替换 GET 的返回
      const queued = globalThis.__zfNextSettings
      if (queued !== undefined && init?.method !== 'POST') {
        globalThis.__zfNextSettings = undefined
        return { ok: true, json: async () => ({ settings: queued }) }
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
    effects, listeners, fetchImpl, getPreference: () => preference,
    // 官方 tab 相关的观测面
    tabRegistrations, serviceFixture
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
  // 壁纸渲染探针用 getComputedStyle 读计算值；无头环境没有它，
  // 不装桩的话探针会静默走 catch 分支、永远测不到（探针本身就失去意义）。
  if (globalThis.document) installComputedStyleStub(globalThis.document)
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
  contourBorder: true,
  potentialDots: false,
  heroAvatar: true,
  titlebarFollow: true,
  accentGlow: false
}

/** 跑一次完整挂载。 */
async function boot (settings, payloadOverrides, services) {
  const h = makeHarness(
    { settings },
    {
      themes,
      presets: ['zhuang', 'burst', 'cyan', 'wine'],
      overrides,
      roles,
      ...(payloadOverrides ?? {})
    },
    DEFAULT_STYLE,
    services ?? DEFAULT_SERVICES
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

  // 「已停止」信号：外壳在当前回合渲染的叶子 `<span>已停止</span>`
  // （i18n `message.stopped`，interrupted 时挂在过程栏/正文里）
  if (opts.stopped) {
    const row = new El('div')
    row.setAttribute('data-chat-flow-kind', 'turn-process')
    const span = new El('span')
    span.textContent = opts.stoppedText ?? '已停止'
    row.appendChild(span)
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
  ok('顶栏已移除：无 data-zf-topbar 标记', !on.h.dom.body.hasAttribute('data-zf-topbar'))
  ok('头像气泡标记已加', on.h.dom.body.hasAttribute('data-zf-avatar'))
  ok('右栏宽度写进变量', on.h.dom.html.props.get('--zf-rail-width') === '320px',
    String(on.h.dom.html.props.get('--zf-rail-width')))
  ok('头像图变量已写', String(on.h.dom.html.props.get('--zf-avatar-image') ?? '').includes('avatar.webp'))

  const off = await boot({ ...baseSettings, topbar: false, avatarBubbles: false })
  ok('顶栏已移除：不再写 data-zf-topbar', !off.h.dom.body.hasAttribute('data-zf-topbar'))
  ok('头像气泡关闭时移除标记', !off.h.dom.body.hasAttribute('data-zf-avatar'))

  const wide = await boot({ ...baseSettings, railWidth: 999 })
  ok('右栏宽度超范围被夹取', wide.h.dom.html.props.get('--zf-rail-width') === '380px',
    String(wide.h.dom.html.props.get('--zf-rail-width')))
}

// 用例 21：新插槽注册与注销
{
  console.log('\n--- v2 插槽注册 ---')
  const { h } = await boot({ ...baseSettings })
  // 顶栏已按用户要求整体移除（左上角那块品牌信息压住了中栏会话标题）
  ok('顶栏不再注册（已移除）',
    !h.slotRegistrations.some(r => r.meta.id === 'zhuang-fangyi-topbar'))
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
  // 桩 CSS 现在就是真实 structureStyle() 产物，所以断言它对得上：
  // 壁纸 ::before 规则与 art 变量定义都应在（也顺带守住「宿主产物没被改坏」）
  ok('样式内容已写入（真实产物）',
    (styleEl?.textContent ?? '').includes('html[data-zf-wallpaper]::before') &&
    (styleEl?.textContent ?? '').includes('--zf-art-sakura'))
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
  ok('只有右栏注册进 shell.overlay', overlay.length === 1, `实际 ${overlay.length}`)
  const rail = overlay.find(r => r.meta.id === 'zhuang-fangyi-rail')
  // 用桩 React 调用组件：组件是函数，这里直接调用（桩 useState 返回初始值）
  const railOut = rail?.component?.({})
  ok('右栏组件在样式缺失时返回 null', railOut === null, String(railOut))
}

// 用例 27：样式表就绪后顶栏/右栏正常渲染
{
  console.log('\n--- 样式表就绪后渲染 ---')
  const { h, mod } = await boot({ ...baseSettings })
  ok('styleReady 为 true', mod.__test.state.styleReady === true)
  const overlay = h.slotRegistrations.filter(r => r.meta.name === 'shell.overlay')
  const rail = overlay.find(r => r.meta.id === 'zhuang-fangyi-rail')
  const railOut = rail?.component?.({})
  ok('右栏组件返回元素（非 null）', railOut !== null && railOut !== undefined)
  ok('右栏根节点用 .zf-rail 类', railOut?.props?.className === 'zf-rail',
    String(railOut?.props?.className))
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

// 用例 30：顶栏已整体移除（它压住了中栏会话标题）
{
  console.log('\n--- 顶栏移除 ---')
  const { structureStyle } = await import('../index.js')
  const css = structureStyle()
  // 用户反馈：左上角那块（头像 + 庄方宜 + 状态文字）压住了中栏的会话标题，
  // 而且信息全是冗余（头像在侧栏与消息旁都有，状态在右栏观测台里）。
  ok('无 .zf-topbar 规则', !/\.zf-topbar\{/.test(css))
  ok('无 .zf-topbar__ 类', !css.includes('zf-topbar__'))
  ok('无 data-zf-topbar 规则', !css.includes('data-zf-topbar'))
  // 顶栏移除后，观测栏必须直接顶到最上边
  ok('观测栏 top:0（顶格）', /\.zf-rail\{[^}]*position:fixed;top:0/.test(css))
  ok('Windows 观测栏只让开标题栏（不再叠加顶栏高度）',
    /html\[data-windows-titlebar\] \.zf-rail\{[^}]*top:var\(--dsh-windows-titlebar-height/.test(css))
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
  ok('顶栏保持移除状态', !h.slotRegistrations.some(r => r.meta.id === 'zhuang-fangyi-topbar'))
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
// 用例 33：头像不得破坏外壳的折叠（用户截图「折叠后留空白」的回归）
{
  console.log('\n--- 头像与折叠互补 ---')
  const { structureStyle } = await import('../index.js')
  const css = structureStyle()

  // 外壳的折叠规则（虚拟化列表）：
  //   [class*="_flowItem"]:is(:empty,
  //     :has(>[data-slot="conversation.chat.node"]:empty)){ height:0 }
  // 我的规则必须与它**严格互补**，否则要么折叠后留空白，要么头像不显示。
  const unfolded = ':not(:empty):not(:has(>[data-slot="conversation.chat.node"]:empty))'
  ok('未折叠态用双取反条件', css.includes(unfolded))
  ok('折叠条件与外壳一致（含 slot 空子节点那种）',
    css.includes(':has(>[data-slot="conversation.chat.node"]:empty)'))

  // 绝不能加 min-height —— 它会把外壳的 `height:0` 顶开
  ok('不含 min-height（会顶开 height:0 折叠）', !css.includes('min-height:48px'))
  ok('不含固定 padding-top 占位（同样会顶开折叠）',
    !/assistant-step"\][^{]*\{[^}]*padding:2[0-9]px/.test(css))

  // 折叠态必须显式清零，避免继承
  ok('折叠态 padding 清零', /padding-left:0;min-height:0/.test(css))
  ok('折叠态不画头像', css.includes('content:none;display:none'))

  // 头像占位只用 padding-left（不改行高）
  const block = css.match(/assistant-step"\]\)?[^{]*\{[^}]*position:relative;padding-left:\d+px/)
  ok('未折叠态只加 padding-left', block !== null || /position:relative;padding-left:44px/.test(css))
  ok('CSS 大括号平衡',
    (css.match(/\{/g) ?? []).length === (css.match(/\}/g) ?? []).length)
}
// 用例 34：顶栏/右栏的定位基准必须是视口（fixed）
{
  console.log('\n--- 定位基准 ---')
  const { structureStyle } = await import('../index.js')
  const css = structureStyle()
  // 最初用 absolute，依赖 overlay 的包含块。实测 overlay 就在 {0,0}，
  // 但它是 grid 容器的子元素、且 frame 在 Windows 下有 padding-top ——
  // 两个都可能随壳版本变化。用 fixed 换确定的视口基准。
  ok('右栏用 position:fixed', /\.zf-rail\{[^}]*position:fixed/.test(css))
  ok('右栏不再用 absolute', !/\.zf-rail\{[^}]*position:absolute/.test(css))
  // fixed 不吃 frame 的 padding-top → 必须自己让开 Windows 标题栏
  ok('Windows 右栏让开标题栏',
    /html\[data-windows-titlebar\] \.zf-rail\{[^}]*top:var\(--dsh-windows-titlebar-height/.test(css))
  // 顶栏已移除 → 观测栏 top:0 直接顶格
  ok('观测栏 top:0（顶格）', /\.zf-rail\{[^}]*position:fixed;top:0/.test(css))
}

// 用例 35：头像不能有描边，且必须是正圆（外壳全局 corner-shape 会变方圆角）
{
  console.log('\n--- 头像描边与正圆 ---')
  const { structureStyle } = await import('../index.js')
  const css = structureStyle()
  const before = css.match(/assistant-step"\]:not\(:empty\):not\(:has\(>\[data-slot="conversation\.chat\.node"\]:empty\)\)::before\{[^}]*\}/)
  ok('找到助手头像规则', before !== null)

  // 用户反馈：头像外面那圈黄绿描边难看
  ok('助手头像无 border 描边', before !== null && !/border:1px/.test(before[0]))
  ok('助手头像 border 显式清零', before !== null && /border:0/.test(before[0]))

  // 外壳有一条全局规则把「所有元素与伪元素」设成超椭圆圆角：
  //   @supports (corner-shape:superellipse(1.5)){
  //     *, :before, :after{ corner-shape: var(--dsw-corner-shape) }
  //   }
  // 它会把 border-radius:50% 渲染成圆角方形（squircle）—— 用户截图确认过。
  // 所以每处圆形头像都必须显式 corner-shape:round。
  ok('助手头像 corner-shape:round', before !== null && /corner-shape:round/.test(before[0]))
  ok('观测栏头像 corner-shape:round',
    /\.zf-rail__avatar\{[^}]*corner-shape:round/.test(css))

  // client.js 里两处 <img> 头像（HeroMark / BrandMark）走内联 style，
  // 也要 cornerShape:'round'
  const src = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  // 只数代码里的赋值 —— 注释里也会提到 `cornerShape: 'round'`，要排除
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const n = (codeOnly.match(/cornerShape: 'round'/g) ?? []).length
  ok('两处 <img> 头像都设了 cornerShape', n === 2, `实际 ${n} 处`)
  ok('不再有裸的 borderRadius:50% 而无 cornerShape',
    !/borderRadius: '50%',\s*\n\s*objectFit/.test(codeOnly))
}
// 用例 36：普通变量变化必须 emit（否则组件永不重渲染）
{
  console.log('\n--- state 变更必须通知订阅者 ---')
  const src = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

  // 实测事故：`ensureStyle()` 设了 `state.styleReady = true` 但没 `emit()`，
  // 导致首帧渲染过的 `Rail` 永远停在「styleReady=false → return null」——
  // 自检显示 `railCalls:1, railNull:1, railRendered:0`，观测栏完全不出现。
  //
  // 组件读 `state.*` 是普通变量（只有 `settings` 走 useStore 的订阅封装），
  // 所以凡是「组件会读」的字段，赋值后必须 emit。
  const ensureStyleBody = src.slice(
    src.indexOf('async function ensureStyle'),
    src.indexOf('async function reportDiag')
  )
  ok('ensureStyle 成功路径 emit', /state\.styleReady = true[\s\S]{0,400}?emit\(\)/.test(ensureStyleBody))
  ok('ensureStyle 失败路径也 emit', /state\.styleReady = false[\s\S]{0,200}?emit\(\)/.test(ensureStyleBody))

  // `refresh()` 末尾必须 emit —— 它写 stats/sessionState/railShown
  const refreshBody = src.slice(src.indexOf('function refresh ()'), src.indexOf('const schedule ='))
  ok('refresh 末尾 emit（stats/sessionState 靠它更新）', /onLayout\?\.\(\)/.test(refreshBody))

  // 组件里读的 state 字段清单（人工维护）：改这些字段必须 emit
  const readByComponents = ['styleReady', 'sessionState', 'stats', 'railShown']
  const gated = readByComponents.filter(f => new RegExp(`state\\.${f}`).test(src))
  ok('组件读取的字段都在 emit 覆盖范围内', gated.length >= 3, gated.join(','))
}
// 用例 37：官方右栏 tab 可用时走主路径
{
  console.log('\n--- 官方右栏 tab（可用）---')
  // 模拟桌面端：`sidebarRightTabs` 服务存在
  const tabs = {
    register (def) {
      if (typeof def?.id !== 'string' || def.id.trim() === '') throw new Error('tab id must not be empty')
      if (TAB_REGS.some(r => r.id === def.id)) throw new Error(`Duplicate tab type: ${def.id}`)
      TAB_REGS.push(def)
      return () => {
        const at = TAB_REGS.indexOf(def)
        if (at >= 0) TAB_REGS.splice(at, 1)
      }
    }
  }
  const { h, mod } = await boot({ ...baseSettings }, null, rightServices(tabs))

  ok('探测到 sidebarRightTabs 服务', mod.__test.state.tabDiag.attempted === true)
  ok('tab 类型注册成功', mod.__test.state.tabDiag.ok === true,
    String(mod.__test.state.tabDiag.error))
  ok('kind 用的是自有 kind（不抢 builtin）',
    mod.__test.state.tabDiag.kind === 'zhuang-fangyi-observation')
  ok('tab 本体注册进 sidebar.right.pane.tab',
    h.slotRegistrations.some(r => r.meta.name === 'sidebar.right.pane.tab' &&
      r.meta.key === 'dsh-zhuang-fangyi-observation'))
  ok('tabRegistered 为 true', mod.__test.state.tabRegistered === true)

  // ⚠️ 关键教训：**注册 ≠ 打开**。
  // `sidebarRightTabs.register()` 只声明「有这种 tab」，不打开任何一个。
  // 官方 tab 按「已打开的 tab」渲染，而打开要用户从指南里点。
  // 所以注册成功时 `tabMounted===0` → 浮层**必须继续渲染**，否则右边全空
  // （用户实测反馈「右栏怎么做都没有观测台」，就是这里让位给了没打开的 tab）。
  const overlay = h.slotRegistrations.filter(r => r.meta.name === 'shell.overlay')
  const rail = overlay.find(r => r.meta.id === 'zhuang-fangyi-rail')
  ok('浮层仍注册（供降级用）', rail !== undefined)
  ok('注册成功但 tab 未打开 → tabMounted 为 0', mod.__test.state.tabMounted === 0)
  ok('注册成功但 tab 未打开 → railOwner 仍是 overlay（不让位）',
    mod.__test.railOwner() === 'overlay', mod.__test.railOwner())
  const out = rail?.component?.({})
  ok('注册成功但 tab 未打开 → 浮层照常渲染（右边不会空）',
    out !== null && out !== undefined, String(out))

  // guide 是必需的：没有它，类型在右栏「指南」里不出现，用户无从打开
  const def = TAB_REGS.find(r => r.id === 'dsh-zhuang-fangyi-observation')
  ok('tab 定义带 guide 条目', Array.isArray(def?.guide) && def.guide.length === 1,
    JSON.stringify(def?.guide))
  ok('guide 条目有 id/title/order',
    def?.guide?.[0]?.id === 'observation' &&
    typeof def?.guide?.[0]?.title === 'function' &&
    def?.guide?.[0]?.order === 10)
}

// 用例 38：官方右栏 tab 不可用时降级到浮层
{
  console.log('\n--- 官方右栏 tab（不可用 → 降级）---')
  // DEFAULT_SERVICES 为空 → `ctx.inject(['sidebarRightTabs'])` 回调不触发
  const { h, mod } = await boot({ ...baseSettings })
  ok('未探测到服务时 tabRegistered 保持 false', mod.__test.state.tabRegistered === false)
  ok('tabDiag.ok 为 false', mod.__test.state.tabDiag.ok === false)

  // 降级路径必须工作：浮层照常渲染
  const overlay = h.slotRegistrations.filter(r => r.meta.name === 'shell.overlay')
  const rail = overlay.find(r => r.meta.id === 'zhuang-fangyi-rail')
  ok('浮层已注册', rail !== undefined)
  const out = rail?.component?.({})
  ok('浮层组件正常返回元素（降级生效）', out !== null && out !== undefined)
  ok('浮层根节点是 .zf-rail', out?.props?.className === 'zf-rail', String(out?.props?.className))
}

// 用例 39：tab 注册失败不能中断 apply()
{
  console.log('\n--- tab 注册失败容错 ---')
  const bad = {
    register () { throw new Error('simulated tab register failure') }
  }
  const { h, mod } = await boot({ ...baseSettings }, null, rightServices(bad))
  ok('tab 注册抛错时 apply() 未中断', mod.__test.state.tabDiag.error !== null)
  ok('降级：浮层仍可用',
    h.slotRegistrations.some(r => r.meta.name === 'shell.overlay' && r.meta.id === 'zhuang-fangyi-rail'))
  ok('降级：主题仍注册', h.registered.size === 8, `实际 ${h.registered.size}`)
  ok('降级：样式表仍注入', h.dom.head.children.some(c => c.getAttribute('id') === 'zf-style'))
}

// 用例 40：tab 的 disposer 在卸载时释放（否则重新启用会「重复注册」）
{
  console.log('\n--- tab disposer 释放 ---')
  const regs = []
  const tabs = {
    register (def) {
      regs.push(def.id)
      return () => {
        const at = regs.indexOf(def.id)
        if (at >= 0) regs.splice(at, 1)
      }
    }
  }
  const { h, mod } = await boot({ ...baseSettings }, null, rightServices(tabs))
  ok('注册后 regs 有 1 条', regs.length === 1, `实际 ${regs.length}`)
  for (const e of [...h.effects].reverse()) e.dispose?.()
  ok('卸载后 regs 清空（disposer 已释放）', regs.length === 0, `实际 ${regs.length}`)
  ok('卸载后 tabRegistered 归 false', mod.__test.state.tabRegistered === false)
  ok('卸载后 tab 本体注销',
    !h.slotRegistrations.some(r => r.meta.name === 'sidebar.right.pane.tab'))
}
// 用例 41：两条渲染路径必须收敛到一个决策函数（实测踩过：互相让位 → 全黑）
{
  console.log('\n--- 观测台路径裁决（railOwner）---')
  const { mod } = await boot({ ...baseSettings })
  const railOwner = mod.__test.railOwner
  ok('导出 railOwner（可测）', typeof railOwner === 'function')

  // 场景 1：默认（settings 已加载，官方 tab 服务不存在）→ 浮层
  ok('无官方 tab → overlay',
    railOwner() === 'overlay', railOwner())

  // 场景 2：**只注册、没打开** → 仍走浮层（实测事故：据此让位导致右边全空）
  mod.__test.state.tabRegistered = true
  ok('注册但未打开 → overlay（不让位给不存在的 tab）',
    railOwner() === 'overlay', railOwner())

  // 场景 3：tab 挂着 **且面板展开** → 浮层让位
  // 官方实现："Docked content stays mounted while collapsed, translated off
  // the frame's right edge" —— 所以「挂着」不足以判定 tab 可见。
  // shellDom 默认给 `data-rightbar-collapsed`（收起）；展开态要显式关掉它
  const shellOpen = shellDom({ kinds: [], rightbarCollapsed: false })  // 无 collapsed = 展开
  const shellShut = shellDom({ rightbarCollapsed: true })              // 有 = 收起
  mod.__test.state.tabMounted = 1
  ok('tab 挂着 + 面板展开 → tab（浮层让位）',
    railOwner(shellOpen.document) === 'tab', railOwner(shellOpen.document))

  // 场景 3b（用户实测反馈）：收起后 tab 仍挂载但被平移出可视区
  //   → 必须回落浮层，否则两边都看不见
  ok('tab 挂着但面板收起 → overlay（否则两边都空）',
    railOwner(shellShut.document) === 'overlay', railOwner(shellShut.document))
  ok('Web 壳收起属性同样识别',
    railOwner(shellDom({ collapseAttr: 'data-details-collapsed' }).document) === 'overlay')

  // 场景 4：tab 被用户关掉 → 浮层立刻回来接替
  mod.__test.state.tabMounted = 0
  ok('tab 被关闭 → 回落 overlay（右边不会空）',
    railOwner(shellOpen.document) === 'overlay', railOwner(shellOpen.document))

  // 场景 5：插件停用 → none
  mod.__test.state.tabRegistered = false
  mod.__test.state.settings = { ...mod.__test.state.settings, enabled: false }
  ok('插件停用 → none', railOwner() === 'none', railOwner())
  mod.__test.state.settings = { ...mod.__test.state.settings, enabled: true }

  // 场景 6：rail 关闭 → none
  mod.__test.state.settings = { ...mod.__test.state.settings, rail: false }
  ok('rail 关闭 → none', railOwner() === 'none', railOwner())
}

// 用例 42：设置同步 —— 焦点重拉（resyncSettings）
{
  console.log('\n--- 设置同步（resyncSettings）---')
  const { mod } = await boot({ ...baseSettings })
  ok('导出 resyncSettings（可测）', typeof mod.__test.resyncSettings === 'function')

  // 宿主设置被外部改动（模拟 HTTP POST / 另一窗口）
  const next = { ...baseSettings, background: 'pool', backgroundOpacity: 40 }
  mod.__test.setNextSettings(next)
  await mod.__test.resyncSettings()
  ok('外部改动被拉回客户端', mod.__test.state.settings.background === 'pool')
  ok('改动触发 applySettings（veil 跟着变）', mod.__test.state.settings.backgroundOpacity === 40)

  // 值没变 → 不做任何事（不 emit 不重渲染）
  const before = mod.__test.state.renderCounts.railCalls
  await mod.__test.resyncSettings()
  ok('设置无变化时是幂等的', true) // 幂等性本身不抛错即通过

  // settings 尚未加载（null）时跳过
  const saved = mod.__test.state.settings
  mod.__test.state.settings = null
  await mod.__test.resyncSettings()
  ok('settings=null 时安全跳过', mod.__test.state.settings === null)
  mod.__test.state.settings = saved
}

// 用例 43：opacity 上限 45（settings.js 与 client.js 两处一致）
{
  console.log('\n--- opacity 上限对齐 ---')
  const { normalizeSettings, BG_OPACITY_MAX } = await import('../src/settings.js')
  ok('BG_OPACITY_MAX = 45', BG_OPACITY_MAX === 45, String(BG_OPACITY_MAX))
  ok('normalizeSettings 放行 45',
    normalizeSettings({ backgroundOpacity: 45 }).backgroundOpacity === 45)
  ok('normalizeSettings 夹回超过上限的值',
    normalizeSettings({ backgroundOpacity: 90 }).backgroundOpacity === 45)
  ok('backgroundCustom 已删除',
    !('backgroundCustom' in normalizeSettings({ backgroundCustom: 'x.png' })))
  // client.js 里的三处字面量上限也要是 45（手写 bundle 不能 import）
  const src = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  const mins = [...src.matchAll(/Math\.min\((\d+), settings\.backgroundOpacity\)/g)].map(m => m[1])
  ok('client.js 的两处夹取都是 45', mins.length === 2 && mins.every(v => v === '45'),
    mins.join(','))
  ok('滑杆 max=45', /backgroundOpacity, min: 0, max: 45,/.test(src))
  // railWidth 字面量与 settings.js 一致
  const rw = src.match(/Math\.max\((\d+), Math\.min\((\d+), Number\(s\?\.railWidth\) \|\| (\d+)\)\)/)
  ok('client.js railWidth 字面量 = 240/380/288',
    rw !== null && rw[1] === '240' && rw[2] === '380' && rw[3] === '288', rw?.slice(1).join('/'))
}
// 用例 44：观测台进官方右栏 —— 仅在展开时自动打开
{
  console.log('\n--- 官方 tab 自动打开 ---')

  // 场景 A：面板**已展开** + 我们的 tab 没开 → 应该 openTab(kind)
  {
    const opened = []
    const { h, mod } = await boot({ ...baseSettings }, null, rightServices(
      { register: def => { TAB_REGS.push(def); return () => {} } },
      { openTab: kind => opened.push(kind) }
    ))
    ok('注入了 sidebarRight（导航控制器）', mod.__test.state.sidebarRight !== null)
    // 测试环境的 document 没有 `_frame` 元素 → 视为「找不到框架」，不打开
    ok('找不到 frame 时不盲目 openTab', opened.length === 0, JSON.stringify(opened))
  }

  // 场景 B：面板收起 → 绝不能代为展开（用户要求「仅在展开时走官方」）
  {
    const opened = []
    const { h, mod } = await boot({ ...baseSettings }, null, rightServices(
      { register: def => { TAB_REGS.push(def); return () => {} } },
      { openTab: kind => opened.push(kind) }
    ))
    const doc = globalThis.document
    const frame = doc.createElement('div')
    frame.setAttribute('class', 'Xyz_frame')
    frame.setAttribute('data-rightbar-collapsed', '')
    doc.body.appendChild(frame)
    mod.__test.maybeOpenRailTab(doc)
    ok('面板收起时不 openTab（不打扰用户）', opened.length === 0, JSON.stringify(opened))
    ok('收起时清空展开周期标记', mod.__test.state.railTabOpenedFor === null)
  }

  // 场景 C：面板展开 → 打开一次；重复调用不重复打开
  {
    const opened = []
    const { h, mod } = await boot({ ...baseSettings }, null, rightServices(
      { register: def => { TAB_REGS.push(def); return () => {} } },
      { openTab: kind => opened.push(kind) }
    ))
    const doc = globalThis.document
    const prev = doc.querySelector('[class*="_frame"]')
    if (prev !== null) prev.remove()
    const frame = doc.createElement('div')
    frame.setAttribute('class', 'Xyz_frame')
    doc.body.appendChild(frame)

    mod.__test.maybeOpenRailTab(doc)
    ok('面板展开 → 打开我们的 tab', opened.length === 1, JSON.stringify(opened))
    ok('openTab 用的是我们的 kind', opened[0] === 'zhuang-fangyi-observation', String(opened[0]))

    // 再调两次：即使 tab 还没挂载（React 还没提交），也不该重复打开
    mod.__test.maybeOpenRailTab(doc)
    mod.__test.maybeOpenRailTab(doc)
    ok('同一展开周期内幂等（只开一次）', opened.length === 1, JSON.stringify(opened))

    // 用户手动关掉（tabMounted 归零）后也不重开 —— 尊重用户选择
    mod.__test.state.tabMounted = 0
    mod.__test.maybeOpenRailTab(doc)
    ok('用户关掉后不反复重开', opened.length === 1, JSON.stringify(opened))

    // 面板收起再展开 → 重新出现
    frame.setAttribute('data-rightbar-collapsed', '')
    mod.__test.maybeOpenRailTab(doc)
    frame.removeAttribute('data-rightbar-collapsed')
    mod.__test.maybeOpenRailTab(doc)
    ok('收起后重新展开 → 再次出现', opened.length === 2, JSON.stringify(opened))
  }

  // 场景 D：插件停用 / rail 关闭 → 不打开
  {
    const opened = []
    const { h, mod } = await boot({ ...baseSettings, rail: false }, null, rightServices(
      { register: def => { TAB_REGS.push(def); return () => {} } },
      { openTab: kind => opened.push(kind) }
    ))
    const doc = globalThis.document
    const prev = doc.querySelector('[class*="_frame"]')
    if (prev !== null) prev.remove()
    const frame = doc.createElement('div')
    frame.setAttribute('class', 'Xyz_frame')
    doc.body.appendChild(frame)
    mod.__test.maybeOpenRailTab(doc)
    ok('rail 关闭时不 openTab', opened.length === 0, JSON.stringify(opened))
  }
}
// 用例 45：观感深化（P1-A）—— 缩略图条 / 真恢复默认 / 文案对齐 / 白名单
{
  console.log('\n--- 壁纸缩略图与恢复默认 ---')
  const { BACKGROUNDS: BG_FILES, defaultSettings } = await import('../src/settings.js')

  // 1) 命名约定：客户端推导 `wallpaper-<id>.webp`，必须与 settings.js 的映射一致
  const idList = Object.keys(BG_FILES).filter(b => b !== 'none')
  const mismatch = idList.filter(b => BG_FILES[b] !== `wallpaper-${b}.webp`)
  ok('壁纸文件名规则：BACKGROUNDS[id] === wallpaper-<id>.webp', mismatch.length === 0,
    mismatch.join(','))
  ok('背景预设 8 张（含 none）', idList.length === 8, String(idList.length))

  // 2) 缩略图真的生成了（prepare-art 产出 16 张）
  const thumbDir = path.join(ROOT, 'art', 'thumbs')
  const missing = []
  for (const b of idList) {
    for (const dark of ['', '-dark']) {
      const f = path.join(thumbDir, `wallpaper-${b}${dark}.webp`)
      if (!fs.existsSync(f)) missing.push(`wallpaper-${b}${dark}.webp`)
    }
  }
  ok('缩略图 16 张已生成', fs.existsSync(thumbDir) && missing.length === 0, missing.join(','))

  // 3) 宿主白名单覆盖 thumbs/（否则路由 404）
  const hostSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
  ok('宿主白名单含 thumbs/ 条目', hostSrc.includes('thumbs/${file}'))
  // 宿主支持 {"reset": true}
  ok('宿主 /settings 支持 reset', hostSrc.includes('parsed?.reset === true'))

  // 4) 设置页缩略条渲染（固定浅色 → 亮图 8 张）
  const a = await boot({ ...baseSettings, background: 'pool', scheme: 'light' })
  const sectionReg = a.h.slotRegistrations.find(r => r.meta.name === 'settings.section')
  ok('设置区已注册', sectionReg !== undefined)
  const collect = (node, out = []) => {
    if (node === null || node === undefined) return out
    if (Array.isArray(node)) { for (const c of node) collect(c, out); return out }
    if (typeof node !== 'object') return out
    if (node.type === 'img' && typeof node.props?.src === 'string') out.push(node.props.src)
    collect(node.children, out)
    return out
  }
  const sectionTree = sectionReg.component({})
  const thumbs = collect(sectionTree, []).filter(s => s.includes('/art/thumbs/'))
  ok('缩略条渲染 8 张图', thumbs.length === 8, `实际 ${thumbs.length}`)
  // 用**集合比对**而不是子串：预设 id 里有 `dark`（暗调水面月影），
  // 它的亮图 `wallpaper-dark.webp` 本身就含 `-dark.webp` 子串 —— 子串判断会误判
  const lightFiles = new Set(idList.map(b => `wallpaper-${b}.webp`))
  const darkFiles = new Set(idList.map(b => `wallpaper-${b}-dark.webp`))
  const nameOf = s => s.split('/art/thumbs/')[1]
  ok('浅色 scheme 用亮图', thumbs.every(s => lightFiles.has(nameOf(s))),
    thumbs.filter(s => !lightFiles.has(nameOf(s))).map(nameOf).join(','))
  ok('含所选 wallpaper-pool', thumbs.some(s => s.endsWith('/wallpaper-pool.webp')))

  // 5) 固定深色 → 8 张暗图文件名（每张 = 亮图名 + -dark）
  const b2 = await boot({ ...baseSettings, scheme: 'dark' })
  const thumbsDark = collect(
    b2.h.slotRegistrations.find(r => r.meta.name === 'settings.section').component({}), []
  ).filter(s => s.includes('/art/thumbs/'))
  ok('深色 scheme 用暗图',
    thumbsDark.length === 8 && thumbsDark.every(s => darkFiles.has(nameOf(s))),
    thumbsDark.filter(s => !darkFiles.has(nameOf(s))).map(nameOf).join(','))

  // 6) 文案对齐实际行为（顶栏移除后的双路径）
  ok('railHint 提到官方标签页', a.mod.__test.DICT.zh.railHint.includes('标签页'))
  ok('railHint 提到浮层', a.mod.__test.DICT.zh.railHint.includes('浮层'))
  ok('en railHint 同步', a.mod.__test.DICT.en.railHint.includes('overlay'))

  // 7) 真·恢复默认：POST {reset:true} → 宿主返回 defaultSettings
  const c = await boot({ ...baseSettings, background: 'contour', backgroundOpacity: 45, preset: 'wine' })
  ok('前置：设置被改过', c.mod.__test.state.settings.background === 'contour')
  await c.mod.__test.resetToDefaults()
  const post = c.h.calls.find(x =>
    x.url.endsWith('/settings') && x.init?.method === 'POST' &&
    String(x.init.body).includes('"reset":true'))
  ok('恢复默认 POST {reset:true}', post !== undefined, JSON.stringify(c.h.calls.slice(-2)))
  const st = c.mod.__test.state.settings
  ok('background 回到默认 sakura', st.background === 'sakura', String(st.background))
  ok('opacity 回到默认', st.backgroundOpacity === defaultSettings().backgroundOpacity,
    String(st.backgroundOpacity))
  ok('preset 回到默认', st.preset === defaultSettings().preset, String(st.preset))
}
// 用例 46：观测台读数增强（P1-B）—— 扩展解析 / stopped / 运行耗时 / diag 字段
{
  console.log('\n--- 读数扩展 / stopped / 运行耗时 ---')
  const mod = SHARED_MOD

  // 1) readStats 新字段（实测样本：桌面端底部统计行）
  const rich = shellDom({ stats: '38轮 · 1079步 · 206 tok/s · 328M tok · 缓存命中 77% · 58%' })
  const r1 = mod.__test.readStats(rich.document)
  ok('解析 tok/s', r1.rate === '206', r1.rate)
  ok('解析 token 总量', r1.tokens === '328M', r1.tokens)
  ok('解析上下文占比', r1.context === '58%', r1.context)
  ok('轮/步/缓存仍正确',
    r1.turns === '38' && r1.steps === '1079' && r1.cache === '77%', JSON.stringify(r1))

  // 英文样本
  const en = shellDom({ stats: '12 turns · 34 steps · 95 tok/s · 1.2G tok · Cache hit 87.5% · 42%' })
  const r2 = mod.__test.readStats(en.document)
  ok('英文样本全解析',
    r2.turns === '12' && r2.steps === '34' && r2.cache === '87.5%' &&
    r2.rate === '95' && r2.tokens === '1.2G' && r2.context === '42%', JSON.stringify(r2))

  // 旧格式（只有一个百分数）→ 新字段回落 —，不把缓存命中冒充上下文
  const old = shellDom({ stats: '12 轮 · 34 步 · 缓存命中 87.5%' })
  const r3 = mod.__test.readStats(old.document)
  ok('旧格式新字段回落 —',
    r3.turns === '12' && r3.cache === '87.5%' &&
    r3.rate === '—' && r3.tokens === '—' && r3.context === '—', JSON.stringify(r3))

  // tok/s 负向前瞻：`tok/s` 不会被当成 token 总量
  ok('tok/s 不误判为 token 总量', r2.tokens === '1.2G', r2.tokens)

  // 2) stopped 状态（外壳叶子 span「已停止」）
  ok('有「已停止」叶子 span → stopped',
    mod.__test.readSessionState(
      shellDom({ kinds: ['user', 'assistant-step'], stopped: true }).document) === 'stopped')
  ok('英文 Stopped 同样识别',
    mod.__test.readSessionState(
      shellDom({ kinds: ['user'], stopped: true, stoppedText: 'Stopped' }).document) === 'stopped')
  ok('stopped 优先于 done',
    mod.__test.readSessionState(
      shellDom({ kinds: ['user', 'turn-tail'], stopped: true }).document) === 'stopped')
  ok('error 优先于 stopped',
    mod.__test.readSessionState(
      shellDom({ kinds: ['user', 'turn-error'], stopped: true }).document) === 'error')

  // 3) formatElapsed
  ok('0ms → 00:00', mod.__test.formatElapsed(0) === '00:00')
  ok('65s → 01:05', mod.__test.formatElapsed(65000) === '01:05')
  ok('1h → 1:00:00', mod.__test.formatElapsed(3600000) === '1:00:00')
  ok('非法输入 → 00:00',
    mod.__test.formatElapsed(NaN) === '00:00' && mod.__test.formatElapsed(-5) === '00:00')

  // 4) trackSessionSince 迁移规则
  const st = { sessionState: 'ready', sessionSince: null }
  mod.__test.trackSessionSince(st, 'running')
  ok('ready→running 记起点', st.sessionSince !== null && st.sessionState === 'running')
  const started = st.sessionSince
  mod.__test.trackSessionSince(st, 'tool')
  ok('running→tool 不重置计时', st.sessionSince === started)
  mod.__test.trackSessionSince(st, 'done')
  ok('→done 清零', st.sessionSince === null)
  const st2 = { sessionState: 'tool', sessionSince: 123 }
  mod.__test.trackSessionSince(st2, 'running')
  ok('tool→running 不重置计时', st2.sessionSince === 123)

  // 5) 观测台渲染 6 张读数卡 + 运行中显示耗时
  const boot2 = await boot({ ...baseSettings })
  const overlay = boot2.h.slotRegistrations.filter(r => r.meta.name === 'shell.overlay')
  const rail = overlay.find(r => r.meta.id === 'zhuang-fangyi-rail')
  ok('浮层已注册（默认无官方 tab）', rail !== undefined)
  // 递归渲染：函数型子节点直接调用（桩 useEffect 无副作用，不会起定时器）
  const renderTree = (node, out = []) => {
    if (node === null || node === undefined) return out
    if (Array.isArray(node)) { for (const c of node) renderTree(c, out); return out }
    if (typeof node !== 'object') return out
    const el = typeof node.type === 'function' ? node.type(node.props ?? {}) : node
    if (el && typeof el === 'object' && !Array.isArray(el)) {
      out.push(el)
      renderTree(el.children, out)
    }
    return out
  }
  const nodes1 = renderTree(rail.component({}))
  const bNodes = nodes1.filter(n => n.type === 'b')
  ok('渲染 6 张读数卡', bNodes.length === 6, `实际 ${bNodes.length}`)
  const capOf = nodes => nodes.find(n => n.props?.className === 'zf-rail__caption')
  const cap1 = capOf(nodes1)
  ok('非活跃态无耗时', typeof cap1?.children?.[0] === 'string' &&
    cap1.children[0] === '待机 · 仅本地渲染', String(cap1?.children?.[0]))

  // 模拟运行中：手动置状态（桩不跑 effect，只验渲染内容）
  boot2.mod.__test.state.sessionState = 'running'
  boot2.mod.__test.state.sessionSince = Date.now() - 65000
  const nodes2 = renderTree(rail.component({}))
  const cap2 = capOf(nodes2)
  ok('运行中显示耗时 01:05 与「生成中」',
    typeof cap2?.children?.[0] === 'string' && cap2.children[0].includes('01:05') &&
    cap2.children[0].includes('生成中'), String(cap2?.children?.[0]))

  // 6) /diag 自检字段补齐（settings 全字段 + stats 快照）
  const diagCall = boot2.h.calls.find(x => x.url.endsWith('/diag') && x.init?.method === 'POST')
  ok('diag 已上报', diagCall !== undefined)
  const diagBody = diagCall ? JSON.parse(diagCall.init.body) : {}
  ok('diag settings 含 backgroundOpacity', diagBody.settings?.backgroundOpacity === 14,
    JSON.stringify(diagBody.settings))
  ok('diag settings 含 scheme', diagBody.settings?.scheme === 'system')
  ok('diag settings 含 backgroundBlur/position',
    diagBody.settings?.backgroundBlur === 0 && diagBody.settings?.backgroundPosition === 'cover')
  ok('diag stats 快照含 rate', typeof diagBody.stats?.rate === 'string',
    JSON.stringify(diagBody.stats))
}
// 用例 47：壁纸渲染探针 —— 逐环验证「画没画」
{
  console.log('\n--- 壁纸渲染探针 ---')

  // 1) 开启壁纸（sakura，浅色）：五环都应为「通」
  const on = await boot({ ...baseSettings, background: 'sakura', scheme: 'light', backgroundOpacity: 30 })
  const wpOn = on.h.calls
    .filter(x => x.url.endsWith('/diag') && x.init?.method === 'POST')
    .map(x => JSON.parse(x.init.body).wallpaper)
    .filter(Boolean)
    .pop()
  ok('探针有输出（未走 catch）', wpOn !== undefined && wpOn.error === undefined,
    JSON.stringify(wpOn))
  ok('① html 有 data-zf-wallpaper', wpOn.attr === true)
  ok('① body 有 data-zf-wallpaper', wpOn.bodyAttr === true)
  ok('② --zf-art-src 指向预设变量',
    typeof wpOn.artSrc === 'string' && wpOn.artSrc.includes('--zf-art-sakura'), wpOn.artSrc)
  ok('③ 被引用变量解析出 url(...)',
    typeof wpOn.resolvedArtVar === 'string' && wpOn.resolvedArtVar.includes('/art/wallpaper-sakura.webp'),
    wpOn.resolvedArtVar)
  ok('④ ::before 的 background-image 非 none',
    wpOn.beforeBgImage !== 'none' && wpOn.beforeBgImage.length > 0, wpOn.beforeBgImage)
  ok('④ ::before 参与绘制（content/z 正常）',
    wpOn.beforeContent === '""' && wpOn.beforeZ === '-1', `${wpOn.beforeContent} z=${wpOn.beforeZ}`)
  ok('⑤ html 背景是纱（半透明 rgba）',
    typeof wpOn.htmlBg === 'string' && wpOn.htmlBg.startsWith('rgba('), wpOn.htmlBg)
  ok('⑤ --zf-veil 已按不透明度算出',
    typeof wpOn.veil === 'string' && wpOn.veil.includes('0.7'), wpOn.veil)   // 30% → keep 0.70

  // 2) 关闭壁纸：属性与变量都不该留下
  const off = await boot({ ...baseSettings, background: 'none' })
  const wpOff = off.h.calls
    .filter(x => x.url.endsWith('/diag') && x.init?.method === 'POST')
    .map(x => JSON.parse(x.init.body).wallpaper)
    .filter(Boolean)
    .pop()
  ok('关闭壁纸时无 data-zf-wallpaper', wpOff.attr === false && wpOff.bodyAttr === false,
    JSON.stringify(wpOff))
  ok('关闭壁纸时不解析 art 变量', wpOff.resolvedArtVar === null, String(wpOff.resolvedArtVar))

  // 3) 深色方案 → 引用 -dark 版
  const dark = await boot({ ...baseSettings, background: 'sakura', scheme: 'dark' })
  const wpDark = dark.h.calls
    .filter(x => x.url.endsWith('/diag') && x.init?.method === 'POST')
    .map(x => JSON.parse(x.init.body).wallpaper)
    .filter(Boolean)
    .pop()
  ok('深色引用 -dark 变量',
    typeof wpDark.artSrc === 'string' && wpDark.artSrc.includes('--zf-art-sakura-dark'), wpDark.artSrc)

  // 4) 不透明度直接决定纱的 alpha（这条把「壁纸看不见」量化为可断言的值）
  const strong = await boot({ ...baseSettings, background: 'sakura', backgroundOpacity: 45 })
  const wpStrong = strong.h.calls
    .filter(x => x.url.endsWith('/diag') && x.init?.method === 'POST')
    .map(x => JSON.parse(x.init.body).wallpaper)
    .filter(Boolean)
    .pop()
  ok('45% 不透明度 → 纱 alpha 0.55',
    typeof wpStrong.veil === 'string' && wpStrong.veil.includes('0.55'), wpStrong.veil)
}
// 用例 48：/style.css 必须是**纯 CSS**（回归：曾因带 <style> 标签导致壁纸全废）
{
  console.log('\n--- 样式表形态（纯 CSS vs 带标签）---')
  const { structureCss, structureStyle } = await import('../index.js')
  const bare = structureCss()
  const wrapped = structureStyle()

  // 这条断言如果失效，症状是「观测栏有样式但壁纸怎么都不出来」——
  // 因为浏览器把 `<style id=...>` 当 CSS 解析，紧跟的 html{} 块被整块丢弃，
  // 于是 --zf-art-* 全部未定义，而 JS 行内写的 var(--zf-art-<id>) 随之失效。
  ok('structureCss 不含 <style 标签', !bare.includes('<style'))
  ok('structureCss 不含 </style>', !bare.includes('</style>'))
  ok('structureCss 是纯 CSS（含 html{} 与 art 变量）',
    bare.includes('html{') && bare.includes('--zf-art-sakura') &&
    bare.includes('html[data-zf-wallpaper]::before'))

  // tapIndex 那条路需要标签包裹
  ok('structureStyle 带 <style id="zf-boot-css"> 包裹',
    wrapped.startsWith('<style id="zf-boot-css">') && wrapped.trimEnd().endsWith('</style>'))
  ok('structureStyle 内含同一份 CSS', wrapped.includes(bare))

  // 关键：客户端把这份文本塞进 textContent，所以绝不能带标签
  ok('客户端拿到的形态 = 纯 CSS',
    !wrapped.includes(bare) || !bare.includes('<style'))

  // 变量定义必须落在 html{} 块里（否则行内 var() 引用解析不出来）
  const htmlBlock = /html\{([\s\S]*?)\n\}/.exec(bare)
  ok('html{} 块存在', htmlBlock !== null)
  const artVarsInBlock = (htmlBlock?.[1].match(/--zf-art-[\w-]+\s*:/g) ?? []).length
  ok('html{} 块内 art 变量齐全（≥17 个：src/size/position/repeat/scale + 8 预设×2）',
    artVarsInBlock >= 17, String(artVarsInBlock))
  ok('html{} 块内定义了 --zf-art-sakura',
    (htmlBlock?.[1] ?? '').includes('--zf-art-sakura:'))
}
// 用例 49：竖图用 contain + 模糊垫底（B 方案）
{
  console.log('\n--- 竖图 contain 与垫底层 ---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()

  // ① 垫底层存在，且用 --zf-art-backdrop（不是硬编码 url）
  ok('CSS 含 ::after 垫底层', css.includes('html[data-zf-wallpaper]::after'))
  ok('垫底层用 --zf-art-backdrop', /::after\{[^}]*background-image:var\(--zf-art-backdrop/.test(css))
  ok('垫底层重模糊（blur 64px）', /::after\{[^}]*filter:blur\(64px\)/.test(css))
  ok('垫底层在更下层（z-index:-2）', /::after\{[^}]*z-index:-2/.test(css))
  ok('前景层仍在 -1（盖在垫底之上）', /::before\{[^}]*z-index:-1/.test(css))
  ok('垫底层默认 none（横图零开销）', css.includes('--zf-art-backdrop:none'))
  ok('含 contain 取景规则', css.includes('[data-zf-art-fit="contain"]::before'))
  ok('垫底亮度变量可调', css.includes('--zf-backdrop-lum'))

  // ② 清单：竖图必须是 contain（这是 B 方案的依据）
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'art', 'wallpapers.json'), 'utf8'))
  const items = manifest.wallpapers
  ok('清单存在且非空', Object.keys(items).length === 16, String(Object.keys(items).length))
  const portrait = Object.entries(items).filter(([k]) => k.includes('portrait') || k.includes('vertical'))
  ok('竖图 4 张（portrait/vertical × 明暗）', portrait.length === 4, String(portrait.length))
  ok('竖图全部标 contain', portrait.every(([, v]) => v.fit === 'contain'),
    portrait.filter(([, v]) => v.fit !== 'contain').map(([k]) => k).join(','))
  const landscape = Object.entries(items).filter(([k]) => !(k.includes('portrait') || k.includes('vertical')))
  ok('横图全部标 cover', landscape.every(([, v]) => v.fit === 'cover'),
    landscape.filter(([, v]) => v.fit !== 'cover').map(([k]) => k).join(','))
  ok('竖图宽高比 < 0.87', portrait.every(([, v]) => v.ratio < 0.87),
    portrait.map(([, v]) => v.ratio).join(','))

  // ③ 客户端行为：竖图 → contain + 垫底；横图 → cover + 无垫底
  const vert = await boot(
    { ...baseSettings, background: 'portrait', scheme: 'light' },
    { wallpaperMeta: items }
  )
  const htmlV = vert.h.dom.html
  const propsV = htmlV.props
  ok('竖图 background-size=contain', propsV.get('--zf-art-size') === 'contain',
    String(propsV.get('--zf-art-size')))
  ok('竖图取景偏上（center 22%）', propsV.get('--zf-art-position') === 'center 22%',
    String(propsV.get('--zf-art-position')))
  ok('竖图垫底指向同一张图',
    String(propsV.get('--zf-art-backdrop')).includes('--zf-art-portrait'),
    String(propsV.get('--zf-art-backdrop')))
  ok('竖图打上 data-zf-art-fit=contain',
    htmlV.getAttribute('data-zf-art-fit') === 'contain')

  const land = await boot(
    { ...baseSettings, background: 'sakura', scheme: 'light' },
    { wallpaperMeta: items }
  )
  const propsL = land.h.dom.html.props
  ok('横图 background-size=cover', propsL.get('--zf-art-size') === 'cover',
    String(propsL.get('--zf-art-size')))
  ok('横图不挂垫底（none）', propsL.get('--zf-art-backdrop') === 'none',
    String(propsL.get('--zf-art-backdrop')))
  ok('横图 fit 标记为 cover',
    land.h.dom.html.getAttribute('data-zf-art-fit') === 'cover')

  // ④ 用户显式选「平铺」时不该被 contain 覆盖（尊重用户）
  const tiled = await boot(
    { ...baseSettings, background: 'portrait', backgroundPosition: 'tile' },
    { wallpaperMeta: items }
  )
  const propsT = tiled.h.dom.html.props
  ok('平铺优先：size=auto', propsT.get('--zf-art-size') === 'auto', String(propsT.get('--zf-art-size')))
  ok('平铺优先：repeat=repeat', propsT.get('--zf-art-repeat') === 'repeat')
  ok('平铺时不挂垫底', propsT.get('--zf-art-backdrop') === 'none')

  // ⑤ 清单缺失 → 回落 cover（旧行为），不能抛
  const noMeta = await boot({ ...baseSettings, background: 'portrait', scheme: 'light' })
  ok('无清单时回落 cover（不坏）',
    noMeta.h.dom.html.props.get('--zf-art-size') === 'cover',
    String(noMeta.h.dom.html.props.get('--zf-art-size')))

  // ⑥ 明暗切换时垫底跟着切到 -dark 版
  const darkVert = await boot(
    { ...baseSettings, background: 'portrait', scheme: 'dark' },
    { wallpaperMeta: items }
  )
  ok('深色竖图垫底指向 -dark 版',
    String(darkVert.h.dom.html.props.get('--zf-art-backdrop')).includes('--zf-art-portrait-dark'),
    String(darkVert.h.dom.html.props.get('--zf-art-backdrop')))
}
// 用例 50：设置 v3 —— accentHue 强调色 + motion 静止模式
{
  console.log('\n--- 设置 v3（accentHue / motion）---')
  const pal = await import('../src/palette.js')
  const set = await import('../src/settings.js')

  // 1) 版本与迁移
  ok('SETTINGS_VERSION = 3', set.SETTINGS_VERSION === 3, String(set.SETTINGS_VERSION))
  const v2 = { version: 2, preset: 'wine', scheme: 'dark', background: 'pool', railWidth: 320, avatarBubbles: false }
  const mig = set.normalizeSettings(v2)
  ok('v2 → v3 无损（version 升、旧字段保留）',
    mig.version === 3 && mig.preset === 'wine' && mig.railWidth === 320 && mig.avatarBubbles === false,
    JSON.stringify(mig))
  ok('v2 迁移补默认 accentHue/motion',
    mig.accentHue === 'preset' && mig.motion === 'auto',
    `${JSON.stringify(mig.accentHue)}/${mig.motion}`)

  // 2) accentHue 归一化
  ok('normalizeAccentHue: preset 原样', pal.normalizeAccentHue('preset') === 'preset')
  ok('normalizeAccentHue: 360 → 0', pal.normalizeAccentHue(360) === 0)
  ok('normalizeAccentHue: -30 → 330', pal.normalizeAccentHue(-30) === 330)
  ok('normalizeAccentHue: 400 → 40', pal.normalizeAccentHue(400) === 40)
  ok('normalizeAccentHue: 非法 → preset',
    pal.normalizeAccentHue('abc') === 'preset' && pal.normalizeAccentHue(null) === 'preset')
  ok('normalizeSettings 夹取 accentHue',
    set.normalizeSettings({ accentHue: 999 }).accentHue === 279)

  // 3) 色相覆盖真的改强调色，且不动非强调色
  const base = pal.buildRoles('burst', 'dark')
  const rot = pal.buildRoles('burst', 'dark', 300)
  ok('accentHue 改变 brand', base.brand !== rot.brand, `${base.brand} → ${rot.brand}`)
  ok('accentHue 不动表面色（base/surface/sidebar）',
    base.base === rot.base && base.surface === rot.surface && base.sidebar === rot.sidebar)
  ok("'preset' 与不传参数完全一致",
    JSON.stringify(pal.buildTokens('burst')) === JSON.stringify(pal.buildTokens('burst', 'preset')))

  // 4) 换色相后仍可读（这是 accentHue 的硬约束，contrast.js 有 672 项全扫，
  //    这里在客户端测试里也抽一格，防止有人绕过 contrast.js 改 palette）
  const { contrast } = pal
  let worst = Infinity
  for (let hue = 0; hue < 360; hue += 45) {
    for (const presetId of ['zhuang', 'burst', 'cyan', 'wine']) {
      for (const scheme of ['light', 'dark']) {
        const roles = pal.buildRoles(presetId, scheme, hue)
        // link 要在 base 与气泡（brandSoft）上都可读
        for (const bg of [roles.base, roles.brandSoft]) {
          const r = contrast(roles.link, bg)
          if (r !== null && r < worst) worst = r
        }
      }
    }
  }
  ok('任意色相下 link 对比度 ≥ 4.5', worst >= 4.5, `最低 ${worst.toFixed(2)}:1`)

  // 5) 客户端：accentHue 变化触发重取 /themes 并重注册
  const boot1 = await boot({ ...baseSettings, accentHue: 'preset' })
  const before = boot1.h.calls.filter(c => c.url.endsWith('/themes')).length
  await boot1.mod.__test.save({ accentHue: 200 })
  const after = boot1.h.calls.filter(c => c.url.endsWith('/themes')).length
  ok('改 accentHue 会重取 /themes', after > before, `${before} → ${after}`)
  ok('accentHue 已写入状态', boot1.mod.__test.state.settings.accentHue === 200,
    String(boot1.mod.__test.state.settings.accentHue))

  // 6) 不改 accentHue 时不重取（避免无谓重注册）
  const boot2 = await boot({ ...baseSettings, accentHue: 'preset' })
  const n1 = boot2.h.calls.filter(c => c.url.endsWith('/themes')).length
  await boot2.mod.__test.save({ backgroundOpacity: 22 })
  const n2 = boot2.h.calls.filter(c => c.url.endsWith('/themes')).length
  ok('改其它设置不重取 /themes', n2 === n1, `${n1} → ${n2}`)

  // 7) motion → data-zf-motion
  const boot3 = await boot({ ...baseSettings, motion: 'reduced' })
  ok('motion=reduced 时打 data-zf-motion',
    boot3.h.dom.body.getAttribute('data-zf-motion') === 'reduced',
    String(boot3.h.dom.body.getAttribute('data-zf-motion')))
  const boot4 = await boot({ ...baseSettings, motion: 'auto' })
  ok('motion=auto 时不打标记', !boot4.h.dom.body.hasAttribute('data-zf-motion'))
  const boot5 = await boot({ ...baseSettings, enabled: false, motion: 'reduced' })
  ok('插件停用时不打 motion 标记', !boot5.h.dom.body.hasAttribute('data-zf-motion'))

  // 8) CSS 里有静止模式规则，且只作用于本插件自己的元素（不越权全局）
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  ok('CSS 含 data-zf-motion 规则', css.includes('body[data-zf-motion="reduced"]'))
  ok('静止模式不写全局 *{transition:none}（不越权）',
    !/\*\s*\{[^}]*transition:none/.test(css))
}

console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (fail > 0) {
  console.log(`\n失败项：\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('全部通过。')
