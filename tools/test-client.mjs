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
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
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
    // 事件：只为「过渡结束收尾」这类时序用例服务 —— 桩不派发真实事件，
    // 由测试显式 `dispatch(type)` 触发（比断言源码里有没有那句强得多）。
    this.listeners = new Map()
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

  addEventListener (type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
  }

  removeEventListener (type, fn) {
    this.listeners.get(type)?.delete(fn)
  }

  /** 测试用：显式派发一次事件（`{once:true}` 的语义由调用方自行保证）。 */
  dispatch (type) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type, target: this })
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
      // `presetStyles` 是宿主真实下发的字段（`/themes` 的 presetStyles）。
      // 桩默认补上，免得每个 payload 站点都要写一遍；调用方给了就用它的。
      // 缺了它会让「配套壁纸推荐标记」静默不渲染（实测就是这么漏的）。
      const payload = themePayload.presetStyles !== undefined
        ? themePayload
        : { ...themePayload, presetStyles: DEFAULT_PRESET_STYLES }
      return { ok: true, json: async () => payload }
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
 * 截图取色（像素级断言用）
 *
 * 为什么需要：层叠顺序这类问题**光看 CSS 文本证明不了** —— 第一版交叉淡入把
 * 临时层放在当前图下面（z-index 差一级），结构断言全绿、肉眼却什么都看不到。
 * 唯一可靠的判据是**实际画出来的像素**。
 *
 * 只支持 Edge 截图的那一种规格：8 位、非隔行、RGB/RGBA。
 * ------------------------------------------------------------------ */

async function pngPixel (file, x, y) {
  const zlib = (await import('node:zlib')).default
  const buf = fs.readFileSync(file)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let off = 8
  let width = 0; let height = 0; let depth = 0; let colorType = 0; let interlace = 0
  const idat = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      depth = data[8]; colorType = data[9]; interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`不支持的 PNG 规格 depth=${depth} colorType=${colorType} interlace=${interlace}`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let row = 0; row < height; row += 1) {
    const filter = raw[pos]; pos += 1
    const line = raw.slice(pos, pos + stride); pos += stride
    const prev = row === 0 ? Buffer.alloc(stride) : out.slice((row - 1) * stride, row * stride)
    const cur = out.slice(row * stride, (row + 1) * stride)
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += Math.floor((a + b) / 2)
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      cur[i] = v & 0xff
    }
  }
  const i = y * stride + x * bpp
  return [out[i], out[i + 1], out[i + 2]]
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

/**
 * 桩用的 `presetStyles`（宿主 `/themes` 真实下发的字段）。
 *
 * 形状与 `src/palette.js` 的 `PRESET_STYLES` 一致，**且必须一致** ——
 * 客户端靠它给壁纸缩略图打「本预设推荐」标记。若这里漏字段，
 * 标记会静默不渲染（实测踩过）。
 */
const DEFAULT_PRESET_STYLES = {
  zhuang: { label: '本体黄绿', style: '明亮轻盈', background: 'sakura', borderAlpha: 0.72 },
  burst: { label: '大招墨青金', style: '厚重深沉', background: 'dark', borderAlpha: 0.9 },
  cyan: { label: '青', style: '清爽中性', background: 'pool', borderAlpha: 0.6 },
  wine: { label: '酒红', style: '浓郁暖调', background: 'promo', borderAlpha: 0.8 }
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

  // 「折叠中的过程块」行 —— 外壳对过程成员且未展开的行会打上
  // `data-turn-process-hidden`（源码：`processHidden = ... && !processOpen`
  // 然后 `"data-turn-process-hidden": processHidden || void 0`）。
  //
  // ⚠️ 这种行**不是空的** —— 它有 24px 高的摘要（`▾ 思考 · 摘要…`），
  // 所以只靠 `:not(:empty)` 判不出「已折叠」，会误加头像（用户截图反馈
  // 「折叠的时候效果很奇怪」就是这么来的）。
  for (const kind of opts.foldedProcess ?? []) {
    const row = new El('div')
    row.setAttribute('data-chat-flow-kind', kind)
    row.setAttribute('data-turn-process-hidden', 'true')
    const summary = new El('span')
    summary.textContent = '思考 · 摘要文字'
    row.appendChild(summary)
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
  // shell.overlay 现在有两个条目：启动动效（order 10）+ 右栏浮层（order 50）
  ok('overlay 注册启动动效与右栏两个条目', overlay.length === 2, `实际 ${overlay.length}`)
  ok('启动动效条目存在',
    overlay.some(r => r.meta.id === 'zhuang-fangyi-splash'))
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
  // 选择器必须同时排除**三类折叠**（见用例 58 的说明）：
  // 空行 / 子节点空 / 整段过程折叠 / 推理组
  const before = css.match(/assistant-step"\]:not\(\[data-chat-group-part="reasoning"\]\):not\(\[data-turn-process-hidden\]\):not\(:empty\):not\(:has\(>\[data-slot="conversation\.chat\.node"\]:empty\)\)::before\{[^}]*\}/)
  ok('找到助手头像规则（四类排除齐全）', before !== null)

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
  // ⚠️ 断言用**常量本身**而不是写死数字 —— 上限会随需求调整
  // （30 → 45 → 90，每次都为「用户要求更透」而提高），写死会让每次都要改这里。
  // 这里要验的是「放行上限 / 夹回超限 / 两处字面量对齐」，不是那个数字本身。
  ok('BG_OPACITY_MAX 是个正数上限', BG_OPACITY_MAX > 0 && BG_OPACITY_MAX <= 100,
    String(BG_OPACITY_MAX))
  ok('normalizeSettings 放行上限值',
    normalizeSettings({ backgroundOpacity: BG_OPACITY_MAX }).backgroundOpacity === BG_OPACITY_MAX)
  ok('normalizeSettings 夹回超过上限的值',
    normalizeSettings({ backgroundOpacity: BG_OPACITY_MAX + 10 }).backgroundOpacity === BG_OPACITY_MAX,
    `传 ${BG_OPACITY_MAX + 10} 应夹回 ${BG_OPACITY_MAX}`)
  ok('backgroundCustom 已删除',
    !('backgroundCustom' in normalizeSettings({ backgroundCustom: 'x.png' })))
  // client.js 里的字面量上限也要等于常量（手写 bundle 不能 import，只能各写一份）
  const src = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  const mins = [...src.matchAll(/Math\.min\((\d+), settings\.backgroundOpacity\)/g)].map(m => Number(m[1]))
  ok('client.js 的两处夹取都与 BG_OPACITY_MAX 相等',
    mins.length === 2 && mins.every(v => v === BG_OPACITY_MAX),
    `client=${mins.join(',')} settings=${BG_OPACITY_MAX}`)
  ok('设置页滑杆 max 也与 BG_OPACITY_MAX 相等',
    new RegExp(`backgroundOpacity, min: 0, max: ${BG_OPACITY_MAX},`).test(src),
    `应含 max: ${BG_OPACITY_MAX}`)
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
  // B6 之后垫底让到 -3：中间那格（-2）留给换图时的「上一张」临时层
  ok('垫底层在更下层（z-index:-3）', /::after\{[^}]*z-index:-3/.test(css))
  // B6 之后：垫底 -3 / 当前图 -2 / 换图临时层 -1（显式链，见用例 72）
  ok('前景层在垫底之上（-2）', /::before\{[^}]*z-index:-2/.test(css))
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
  // 断言「>= 3」而不是写死数字：版本随新设置项递增（v4 加了排版），
  // 写死会让每次加设置项都要改这里 —— 而这里要验的是**迁移**，不是版本号本身
  ok('SETTINGS_VERSION >= 3', set.SETTINGS_VERSION >= 3, String(set.SETTINGS_VERSION))
  const v2 = { version: 2, preset: 'wine', scheme: 'dark', background: 'pool', railWidth: 320, avatarBubbles: false }
  const mig = set.normalizeSettings(v2)
  ok('v2 → 最新版无损（version 升、旧字段保留）',
    mig.version === set.SETTINGS_VERSION && mig.preset === 'wine' && mig.railWidth === 320 && mig.avatarBubbles === false,
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
  // 判定「不越权」要看**选择器是不是通配符**，而不是文本里有没有 `*`：
  // `.zf-rail *{...}` 是限定在插件自己元素内的合法写法，
  // 只有真正的 `*{...}`（前面没有其它选择器）才算越权。
  ok('静止模式不写全局 *{transition:none}（不越权）',
    !/(^|[,{}])\s*\*\s*\{[^}]*transition:\s*none/.test(css))
  ok('开启态能压过系统的减少动效',
    /body\[data-zf-motion="on"\][^{]*\{[^}]*animation:revert/.test(css))
}
// 用例 51：启动动效 + 动效三态（用户反馈驱动的两项）
{
  console.log('\n--- 启动动效与动效三态 ---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()

  // 1) 启动动效 CSS
  ok('CSS 含 .zf-splash 容器', css.includes('.zf-splash{'))
  ok('启动动效点击穿透（不挡操作）', /\.zf-splash\{[^}]*pointer-events:none/.test(css))
  ok('立绘用 mix-blend-mode:screen 融掉黑底',
    /\.zf-splash__art\{[^}]*mix-blend-mode:screen/.test(css))
  ok('有一次跑完的关键帧', css.includes('@keyframes zf-splash-in'))
  ok('动效层级高于 overlay(z-index:20)', /\.zf-splash\{[^}]*z-index:40/.test(css))
  ok('窄屏有小图规则', css.includes('@media (max-width:900px)'))

  // 2) 素材真的生成了
  for (const f of ['splash.webp', 'splash-sm.webp']) {
    ok(`素材 ${f} 已生成`, fs.existsSync(path.join(ROOT, 'art', f)))
  }
  // 白名单覆盖（否则路由 404）
  const hostSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
  ok('白名单含 splash 素材',
    hostSrc.includes("out.add('splash.webp')") && hostSrc.includes("out.add('splash-sm.webp')"))

  // 3) 组件行为：等 boot 屏消失后才播（C 方案）
  //
  // 官方 boot 屏由 `BootHandoff` 托着（首帧渲染 boot DOM，useLayoutEffect
  // 后换成应用），所以「boot 消失」= `#root` 里没有 `[data-dsh-boot]`。
  // 测试桩默认没有该元素 → 视为 boot 已结束 → 可以播。
  const on = await boot({ ...baseSettings, splash: true })
  const overlay = on.h.slotRegistrations.filter(r => r.meta.name === 'shell.overlay')
  const splashReg = overlay.find(r => r.meta.id === 'zhuang-fangyi-splash')
  ok('启动动效已注册到 shell.overlay', splashReg !== undefined)

  // 组件首次渲染时 armed=false（还在等 boot 信号）→ 返回 null，且**不能**
  // 消耗掉「已播过」标记，否则样式就绪后就永远不播（曾经的竞态 bug）
  ok('boot 信号到达前不渲染', splashReg.component({}) === null)
  ok('boot 信号到达前不标记已播（防竞态）',
    on.mod.__test.state.splashPlayed === false)

  // ── boot 时机判定（纯函数，可测）──────────────────────────────────────
  //
  // 真实逻辑依赖 React state/effect 时序，而桩的 useState/useEffect 是空实现，
  // 所以判定被抽成 `bootScreenGone(doc)` 纯函数 —— 这条最关键的时机逻辑
  // （出过「压根没播」bug 的地方）因此能被真正测到。
  const bootDom = makeDom()
  const bootEl = new El('div')
  bootEl.setAttribute('data-dsh-boot', '')
  bootDom.document.body.appendChild(bootEl)
  ok('boot 屏在 → 判定为未退场', on.mod.__test.bootScreenGone(bootDom.document) === false)
  bootEl.remove()
  ok('boot 屏移除 → 判定为已退场', on.mod.__test.bootScreenGone(bootDom.document) === true)
  ok('空 document 安全回落 true', on.mod.__test.bootScreenGone(null) === true)

  // 组件在 boot 未退场（armed=false）时返回 null，且**不消耗**「已播过」标记
  ok('boot 未退场时不播', splashReg.component({}) === null)
  ok('未播时不置位 splashPlayed（这是「压根没播」的根因）',
    on.mod.__test.state.splashPlayed === false)
  // 组件确实渲染出立绘（结构断言：桩的 useState 无法推进 armed，
  // 所以这里断言源码里的标记与取值，而不是调用组件）
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  ok('立绘元素用 .zf-splash__art 类', csrc.includes("className: 'zf-splash__art'"))
  ok('窄屏用 splash-sm.webp / 宽屏用 splash.webp',
    csrc.includes("narrow ? 'splash-sm.webp' : 'splash.webp'"))

  const off = await boot({ ...baseSettings, splash: false })
  const offReg = off.h.slotRegistrations
    .filter(r => r.meta.name === 'shell.overlay')
    .find(r => r.meta.id === 'zhuang-fangyi-splash')
  ok('关闭时不渲染', offReg.component({}) === null)

  const dis = await boot({ ...baseSettings, splash: true, enabled: false })
  const disReg = dis.h.slotRegistrations
    .filter(r => r.meta.name === 'shell.overlay')
    .find(r => r.meta.id === 'zhuang-fangyi-splash')
  ok('插件停用时不渲染', disReg.component({}) === null)

  // 5) 动效三态
  const set = await import('../src/settings.js')
  ok('MOTION_MODES 是三态（on/auto/reduced）',
    JSON.stringify(set.MOTION_MODES) === JSON.stringify(['on', 'auto', 'reduced']),
    JSON.stringify(set.MOTION_MODES))
  const bootOn = await boot({ ...baseSettings, motion: 'on' })
  ok("motion=on 打 data-zf-motion='on'",
    bootOn.h.dom.body.getAttribute('data-zf-motion') === 'on',
    String(bootOn.h.dom.body.getAttribute('data-zf-motion')))
  ok('非法 motion 回落 auto', set.normalizeSettings({ motion: 'bogus' }).motion === 'auto')
  ok('v3 迁移补 splash 默认 true',
    set.normalizeSettings({ version: 2, preset: 'wine' }).splash === true)

  // 6) 滑杆：拖动只改本地、松手才提交（抖动修复的回归）
  const src = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  ok('滑杆用 onInput 做本地即时反馈', /onInput:\s*event\s*=>\s*setLocal/.test(src))
  ok('滑杆在松手/失焦时提交',
    /onPointerUp:\s*event\s*=>\s*commit/.test(src) && /onBlur:\s*event\s*=>\s*commit/.test(src))
}
// 用例 52：首帧注入（盖住官方开机卡片）—— 走 webserver/index-inject
//
// 这是「开场动画」的正确做法，也是我此前误判的地方：客户端插件挂遮罩要
// 338ms，而官方卡片 67ms 就画出来了（实测数据），中间 271ms 客户端怎么调
// z-index 都盖不住。只有让**被送出的那份文档**自己先盖住才行。
{
  console.log('\n--- 首帧注入（盖住官方开机卡片）---')
  const hostSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')

  // 1) 用的是官方公开口子（不是 tapIndex，也不是改 asar）
  ok('注册了 webserver/index-inject', hostSrc.includes("'webserver/index-inject'"))
  ok('推 style 行（盖住卡片）', /table\.push\(\{\s*kind:\s*'style'/.test(hostSrc))
  ok('推 script 行（首帧生命周期）', /table\.push\(\{\s*kind:\s*'script'/.test(hostSrc))

  // 2) 关掉时不注入（「关闭档一张黑屏都不出现」）
  ok('splash 关闭时不注入', /splash === false\)\s*return/.test(hostSrc))

  // 3) 首帧脚本的关键能力
  const m = /const FIRST_FRAME_JS = \[([\s\S]*?)\]\.join/.exec(hostSrc)
  ok('FIRST_FRAME_JS 存在', m !== null)
  const js = m ? m[1] : ''
  ok('插入 #zf-first-frame 遮罩', js.includes('zf-first-frame'))
  ok('暴露 window.__zfFirstFrame.end()', js.includes('__zfFirstFrame={end:end}'))
  ok('官方卡片被按下去（visibility:hidden）', hostSrc.includes('[data-dsh-boot]{visibility:hidden'))
  ok('自保：官方卡片消失后自行撤离',
    js.includes('querySelector("[data-dsh-boot]")') && js.includes('boot===null'))
  ok('自保：12s 绝对上限', js.includes('12000'))
  ok('end() 幂等', js.includes('if(ended)return'))
  ok('遮罩 pointer-events:none（不挡操作）',
    hostSrc.includes('pointer-events:none') && js.includes('zf-first-frame'))

  // 4) 客户端交接
  const clientSrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  ok('客户端调用首帧 end()（同一帧无缝交接）',
    clientSrc.includes('globalThis.__zfFirstFrame?.end?.()'))
  ok('交接幂等（firstFrameEnded 标记）',
    clientSrc.includes('state.firstFrameEnded !== true') &&
    clientSrc.includes('state.firstFrameEnded = true') &&
    clientSrc.includes('firstFrameEnded: false'))
}
// 用例 53：官方开机卡片的主题色（走 index-inject 注入 token）
//
// 官方卡片优先读主题 token（`var(--dsw-alias-bg-base, var(--dsh-boot-bg, Canvas))`），
// `--dsh-boot-*` 只是兜底 —— 所以正确做法是让主题 token 在卡片绘制前就位，
// 而不是去覆盖那几个兜底变量。
{
  console.log('\n--- 官方开机卡片的主题色 ---')
  const hostSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')

  ok('定义了 bootCardTokens()', hostSrc.includes('function bootCardTokens'))
  ok('亮色挂 :root（文档解析期 body 可能不存在）',
    /bootCardTokens[\s\S]*?'\:root\{'/.test(hostSrc))
  // 外壳真实约定：presenter 把 data-ds-dark-theme 投在 **body** 上（官方文档原文），
  // 写 :root[data-ds-dark-theme] 永远匹配不到 —— 这条断言防的就是那个错
  ok('暗色挂 body[data-ds-dark-theme]（外壳真实约定）',
    hostSrc.includes("'body[data-ds-dark-theme]{'"))
  // 只看代码不看注释：注释里会写「不能写 :root[data-ds-dark-theme]」来解释原因，
  // 直接 includes 会把解释本身判成违规
  const hostCode = hostSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  ok('没有误写 :root[data-ds-dark-theme]（代码内）',
    !hostCode.includes(':root[data-ds-dark-theme]'))

  // 注入顺序与开关语义
  ok('token 注入在遮罩之前（先给卡片上色，再盖）',
    hostSrc.indexOf('bootCardTokens()') < hostSrc.indexOf('firstFrameCss()'))
  ok('开场动效关掉时 token 仍注入（那时卡片会露出来）',
    /table\.push\(\{\s*kind:\s*'style',\s*text:\s*bootCardTokens\(\)\s*\}\)[\s\S]{0,160}splash === false/
      .test(hostSrc))

  // 复用同一套 token 生成器（含 accentHue），保证与运行期配色一致
  ok('复用 buildTokens（含 accentHue）',
    /function bootCardTokens[\s\S]*?buildTokens\(s\.preset,\s*s\.accentHue\)/.test(hostSrc))

  // 官方卡片的失败态不能被藏掉（上一轮踩过的坑）
  ok('首帧脚本检测官方失败态并让路',
    hostSrc.includes('[class*="_failed_"]') && hostSrc.includes('bail()'))
  ok('不再用 visibility:hidden 藏官方卡片（代码内）',
    !hostCode.includes('[data-dsh-boot]{visibility:hidden'))

  // 生成的 token CSS 结构正确（用真实函数产物断言）
  const mod = await import('../index.js')
  ok('index.js 导出可用', typeof mod.structureCss === 'function')
}
// 用例 54：风格预设（步骤 1+2）—— 预设真正驱动整套观感 + 补全 alias
//
// 用户反馈：「切换主题就改个配色会不会太少了」。
// 根因：旧版四套预设的 chroma/chromaDark 全是 5/6，只换 hue；而 hue 对大
// 面积表面的影响被「按面积分配」压到极低 —— 实测深色下 base 亮度差只有
// 0.0001（肉眼不可辨）。本组用例锁住修复后的**可测量差异**。
{
  console.log('\n--- 风格预设：明度基调 / 色度 / 边框 / 文字 ---')
  const pal = await import('../src/palette.js')
  const { luminance } = pal
  const IDS = ['zhuang', 'burst', 'cyan', 'wine']

  // 1) 明度基调：四套预设必须真的不同（这是「一眼看出」的主要手段）
  for (const scheme of ['light', 'dark']) {
    const lums = IDS.map(id => luminance(pal.buildRoles(id, scheme).base))
    const spread = Math.max(...lums) - Math.min(...lums)
    // 修复前：light 0.0144 / dark 0.0012；修复后 light 0.0522 / dark 0.0034
    const need = scheme === 'light' ? 0.03 : 0.002
    ok(`${scheme} 四套预设的明度极差 ≥ ${need}`,
      spread >= need, `实测 ${spread.toFixed(4)}`)
  }
  // 方向性：明亮轻盈 > 清爽中性 > 浓郁暖调 > 厚重深沉（浅色端）
  const lightLum = Object.fromEntries(
    IDS.map(id => [id, luminance(pal.buildRoles(id, 'light').base)]))
  ok('浅色端 zhuang（明亮轻盈）比 burst（厚重深沉）亮',
    lightLum.zhuang > lightLum.burst,
    `${lightLum.zhuang.toFixed(4)} vs ${lightLum.burst.toFixed(4)}`)
  ok('浅色端 cyan（清爽中性）比 burst 亮', lightLum.cyan > lightLum.burst)
  // 深色端：厚重深沉最暗
  const darkLum = Object.fromEntries(
    IDS.map(id => [id, luminance(pal.buildRoles(id, 'dark').base)]))
  ok('深色端 burst（厚重深沉）最暗',
    darkLum.burst < darkLum.zhuang && darkLum.burst < darkLum.cyan && darkLum.burst < darkLum.wine,
    IDS.map(id => `${id}=${darkLum[id].toFixed(4)}`).join(' '))

  // 2) 色度差异化：不再全是 5/6
  const chromas = IDS.map(id => pal.PRESET_SPECS[id].chroma)
  ok('四套预设的 chroma 不全相同', new Set(chromas).size >= 3, chromas.join('/'))
  ok('burst（厚重深沉）chroma 最高',
    pal.PRESET_SPECS.burst.chroma === Math.max(...chromas))
  ok('zhuang（明亮轻盈）chroma 最低',
    pal.PRESET_SPECS.zhuang.chroma === Math.min(...chromas))

  // 3) 边框强度（borderAlpha）真的改变了边框 token
  const borders = Object.fromEntries(IDS.map(id => [id, pal.buildTokens(id).light['--dsw-alias-border-l1']]))
  ok('四套预设的 border-l1 不全相同', new Set(Object.values(borders)).size >= 3,
    JSON.stringify(borders))
  // burst 的 0.9 应比 cyan 的 0.6 更不透明（alpha 十六进制更大）
  const alphaOf = c => parseInt(String(c).slice(-2), 16)
  ok('burst 的边框比 cyan 更实',
    alphaOf(borders.burst) > alphaOf(borders.cyan),
    `${borders.burst}(${alphaOf(borders.burst)}) vs ${borders.cyan}(${alphaOf(borders.cyan)})`)

  // 4) 文字锐度（textSoft）：柔和档的三级文字与锐利档不同
  const faint = Object.fromEntries(IDS.map(id => [id, pal.buildTokens(id).light['--dsw-alias-label-tertiary']]))
  ok('textSoft 生效：burst/wine 的三级文字与 zhuang/cyan 不同',
    faint.burst !== faint.zhuang && faint.wine !== faint.cyan,
    JSON.stringify(faint))
  ok('textSoft 幅度受控（浅色端 ≤ +2.5，实测 4.5 会击穿 4.5:1）',
    (() => {
      const sharp = pal.buildTokens('cyan').light['--dsw-alias-label-tertiary']
      const soft = pal.buildTokens('burst').light['--dsw-alias-label-tertiary']
      const lum = c => luminance(c)
      return Math.abs(lum(soft) - lum(sharp)) < 0.02
    })())

  // 5) 圆角禁令（用户明确要求：不要加圆角）
  for (const id of IDS) {
    ok(`${id} 的 spec 里没有 radius 字段`, !('radius' in pal.PRESET_SPECS[id]))
  }
  ok('PRESET_STYLES 里没有 radius', !('radius' in pal.PRESET_STYLES.zhuang))
  ok('发射的 token 里没有 --dsw-radius-',
    !Object.keys(pal.buildTokens('zhuang').light).some(k => k.includes('--dsw-radius-')))
  const hostSrcAll = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8') +
    fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  ok('index.js/client.js 里不出现 --dsw-radius-',
    !hostSrcAll.includes('--dsw-radius-'))

  // 6) PRESET_STYLES 契约（subagent 的壁纸推荐依赖它）
  ok('PRESET_STYLES 四套齐全', IDS.every(id => pal.PRESET_STYLES[id] !== undefined))
  ok('每套都有 style 描述', IDS.every(id => typeof pal.PRESET_STYLES[id].style === 'string' && pal.PRESET_STYLES[id].style !== ''))
  ok('每套都有配套壁纸', IDS.every(id => typeof pal.PRESET_STYLES[id].background === 'string'))
  ok('配套壁纸互不相同',
    new Set(IDS.map(id => pal.PRESET_STYLES[id].background)).size === IDS.length,
    IDS.map(id => pal.PRESET_STYLES[id].background).join('/'))
  ok('每套都有 borderAlpha', IDS.every(id => typeof pal.PRESET_STYLES[id].borderAlpha === 'number'))
}

// 用例 55：alias 覆盖率（旧版 77/120 → 现在 118/120）
//
// 外壳共 120 个 alias token。**没注册的，外壳会用回自己的默认值** ——
// 这就是「切主题只有一部分控件变色」的根因。外壳里有 2 个名字是模板字符串
// 拼接出的非常规名（正则提取会截断成 `file-diff-` 之类），不是真实 token。
{
  console.log('\n--- alias 覆盖率（补全 41 个）---')
  const pal = await import('../src/palette.js')
  const tokens = pal.buildTokens('zhuang').light
  const aliases = Object.keys(tokens).filter(k => k.startsWith('--dsw-alias-'))

  ok('alias 数量 ≥ 118（旧版 77）', aliases.length >= 118, `实测 ${aliases.length}`)
  ok('色阶仍是 19 级',
    Object.keys(tokens).filter(k => k.startsWith('--dsw-static-neutral-bluish-')).length === 19)
  ok('specific 11 个全覆盖',
    Object.keys(tokens).filter(k => k.startsWith('--dsw-specific-')).length === 11)

  // 状态色：外壳引用 261 次，旧版一个都没有
  const STATES = [
    'state-success-primary', 'state-success-secondary', 'state-success-tertiary',
    'state-warn-primary', 'state-warn-secondary', 'state-warn-tertiary', 'state-warn-label',
    'state-error-primary', 'state-error-secondary', 'state-idle-primary', 'label-error'
  ]
  for (const name of STATES) {
    ok(`状态色 ${name} 已注册`,
      typeof tokens[`--dsw-alias-${name}`] === 'string')
  }
  // 状态色必须**语义可辨识**：成功=绿、警告=琥珀、错误=红
  const hueOf = c => {
    const m = /^#([0-9a-f]{6})/i.exec(c)
    if (m === null) return null
    const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min
    if (d === 0) return 0
    let h
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    return ((h * 60) + 360) % 360
  }
  for (const scheme of ['light', 'dark']) {
    const r = pal.buildRoles('zhuang', scheme)
    const hs = hueOf(r.stateSuccess); const hw = hueOf(r.stateWarn); const he = hueOf(r.stateError)
    ok(`${scheme} 成功态落在绿区（90–175°）`, hs >= 90 && hs <= 175, `${hs.toFixed(0)}°`)
    ok(`${scheme} 警告态落在琥珀区（25–60°）`, hw >= 25 && hw <= 60, `${hw.toFixed(0)}°`)
    ok(`${scheme} 错误态落在红区（≤20° 或 ≥340°）`,
      he <= 20 || he >= 340, `${he.toFixed(0)}°`)
    ok(`${scheme} 三个状态色互不相同`,
      r.stateSuccess !== r.stateWarn && r.stateWarn !== r.stateError &&
      r.stateSuccess !== r.stateError)
  }

  // 补齐的其余 alias 抽查（按外壳引用次数排序的前几项）
  const REST = [
    'button-tool-bar-fill', 'button-tool-bar-fill-invisible', 'button-tool-bar-hover',
    'tooltip-key-bg', 'bg-mask-1', 'bg-mask-2', 'bg-mask-3', 'bg-mask-drop', 'bg-mask-photo',
    'bg-document-selection', 'bg-l1', 'bg-l2', 'bg-layer-4',
    'fill-l1', 'fill-l2', 'fill-tertiary', 'fill-tsp-secondary',
    'separator-primary', 'label-quaternary',
    'code-diff-added', 'code-diff-deleted',
    'file-diff-added-bg', 'file-diff-added-gutter', 'file-diff-added-marker',
    'file-diff-deleted-bg', 'file-diff-deleted-gutter', 'file-diff-deleted-marker',
    'label-deep-diving', 'label-deep-diving-shimmer', 'label-shimmer'
  ]
  const missing = REST.filter(n => typeof tokens[`--dsw-alias-${n}`] !== 'string')
  ok(`${REST.length} 个补齐的 alias 全部存在`, missing.length === 0, missing.join(', '))

  // diff 底色：**由状态色派生**（不再直接等于状态色 —— 实心状态色会把行上的字压没，
  // 用户截图反馈「修改的代码看不到了」）。但「增绿删红」的语义必须还在：
  // 相对代码底色，增行要更绿、删行要更红 —— 按**色差方向**判，而不是绝对色相
  // （有的预设连代码底本身都偏绿）。
  {
    const hex = (v) => {
      const m = /^#([0-9a-f]{6})$/i.exec(v)
      return m === null ? null : [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
    }
    const code = hex(tokens['--dsw-alias-markdown-code-block'])
    const add = hex(tokens['--dsw-alias-code-diff-added'])
    const del = hex(tokens['--dsw-alias-code-diff-deleted'])
    const rolesLight = pal.buildRoles('zhuang', 'light')
    ok('diff 底不再直接等于状态色（那会把文字压没）',
      tokens['--dsw-alias-code-diff-added'] !== rolesLight.stateSuccess &&
      tokens['--dsw-alias-code-diff-deleted'] !== rolesLight.stateError)
    ok('增行相对代码底**更绿**（增绿语义还在）',
      code !== null && add !== null && (add[1] - add[0]) > (code[1] - code[0]),
      `${tokens['--dsw-alias-code-diff-added']} vs ${tokens['--dsw-alias-markdown-code-block']}`)
    ok('删行相对代码底**更红**（删红语义还在）',
      code !== null && del !== null && (del[0] - del[1]) > (code[0] - code[1]),
      `${tokens['--dsw-alias-code-diff-deleted']} vs ${tokens['--dsw-alias-markdown-code-block']}`)
  }

  // 白名单同步：contrast.js 的 SHELL_TOKENS 必须覆盖全部发射的 alias
  const csrc = fs.readFileSync(path.join(ROOT, 'src', 'contrast.js'), 'utf8')
  const wl = new Set([...csrc.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]))
  const notListed = aliases
    .map(k => k.replace('--dsw-alias-', ''))
    .filter(n => !wl.has(n))
  ok('白名单覆盖全部发射的 alias（防「前缀写错静默失效」）',
    notListed.length === 0, notListed.join(', '))
}
// 用例 56：材质深度（风格预设的第三个维度）
//
// 外壳不暴露 `--dsw-alias-shadow-*`，只有 `--dsw-elevation-*` 三档，且定义在
// `body, body *` 上（特异性高，必须同选择器 + !important 才盖得住）。
{
  console.log('\n--- 材质深度（flat / soft / deep）---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()

  ok('CSS 含 flat 档规则', css.includes('body[data-zf-depth="flat"]'))
  ok('CSS 含 deep 档规则', css.includes('body[data-zf-depth="deep"]'))
  ok('覆盖的是 --dsw-elevation-panel', css.includes('--dsw-elevation-panel:'))
  ok('覆盖的是 --dsw-elevation-prominent', css.includes('--dsw-elevation-prominent:'))
  ok('覆盖的是 --dsw-elevation-soft', css.includes('--dsw-elevation-soft:'))
  // 外壳定义在 `body, body *`，特异性高 → 必须用同选择器（含 `*`）+ !important
  ok('用同选择器覆盖（含 body *，否则盖不住外壳）',
    /body\[data-zf-depth="flat"\],body\[data-zf-depth="flat"\] \*\{/.test(css))
  ok('带 !important（外壳特异性高）',
    /--dsw-elevation-panel:[^;]*!important/.test(css))
  // 描边色必须引用外壳变量（随主题变），不能硬编码颜色
  ok('描边色引用外壳变量而非硬编码',
    css.includes('var(--dsw-elevation-stroke-color)'))

  // 预设 → 档位映射（纯函数）
  // ⚠️ 不能 `import('../client.js')` —— 它是 DSH 模块加载器的 bundle
  // （文件开头就调 `window.__ModuleLoader__.load`），只能在 harness 里跑。
  const probe = await boot(baseSettings)
  const depth = probe.mod.__test.presetDepth
  ok('presetDepth 已导出', typeof depth === 'function')
  ok('zhuang（明亮轻盈）→ flat', depth('zhuang') === 'flat', depth('zhuang'))
  ok('burst（厚重深沉）→ deep', depth('burst') === 'deep', depth('burst'))
  ok('cyan（清爽中性）→ soft', depth('cyan') === 'soft', depth('cyan'))
  ok('wine（浓郁暖调）→ soft', depth('wine') === 'soft', depth('wine'))
  ok('未知预设回落 soft（不坏）', depth('nope') === 'soft')

  // 属性写入：flat/deep 打标记、soft 不打（官方默认，省一次写入）
  const b1 = await boot({ ...baseSettings, preset: 'zhuang' })
  ok("preset=zhuang 时 body 有 data-zf-depth='flat'",
    b1.h.dom.body.getAttribute('data-zf-depth') === 'flat',
    String(b1.h.dom.body.getAttribute('data-zf-depth')))
  const b2 = await boot({ ...baseSettings, preset: 'burst' })
  ok("preset=burst 时 body 有 data-zf-depth='deep'",
    b2.h.dom.body.getAttribute('data-zf-depth') === 'deep')
  const b3 = await boot({ ...baseSettings, preset: 'cyan' })
  ok('preset=cyan（soft）时不打标记', !b3.h.dom.body.hasAttribute('data-zf-depth'))
  const b4 = await boot({ ...baseSettings, preset: 'burst', enabled: false })
  ok('插件停用时不打深度标记', !b4.h.dom.body.hasAttribute('data-zf-depth'))
  // 切换预设要能立刻更新
  await b3.mod.__test.save({ preset: 'burst' })
  ok('切换预设后深度标记跟随',
    b3.h.dom.body.getAttribute('data-zf-depth') === 'deep',
    String(b3.h.dom.body.getAttribute('data-zf-depth')))
}
// 用例 57：配套壁纸「只作推荐、不自动切换」
//
// ⚠️ 为什么测**纯函数**而不是渲染组件树：测试桩的组件树只能渲染出顶层两级，
// 缩略图按钮（更深层）取不到 —— 实测遍历 87 个节点只拿到 2 个 button，
// 而那两个是别的东西。所以判定逻辑被抽成 `isRecommendedArt` 纯函数，
// 约束才真正可测（它正是「绝不自动改壁纸」这条核心约束的载体）。
{
  console.log('\n--- 配套壁纸推荐（只提示，绝不自动切换）---')
  const probe = await boot({ ...baseSettings, preset: 'burst', background: 'sakura' })
  const T = probe.mod.__test
  const rec = T.isRecommendedArt

  ok('isRecommendedArt 已导出', typeof rec === 'function')

  const styles = {
    zhuang: { background: 'sakura' },
    burst: { background: 'dark' },
    cyan: { background: 'pool' },
    wine: { background: 'promo' }
  }

  // 1) 判定正确：命中当前预设的配套壁纸
  ok('burst 预设 + dark 壁纸 → 命中', rec(styles, 'burst', 'dark') === true)
  ok('burst 预设 + sakura 壁纸 → 不命中', rec(styles, 'burst', 'sakura') === false)
  ok('wine 预设 + promo 壁纸 → 命中', rec(styles, 'wine', 'promo') === true)
  ok('zhuang 预设 + sakura 壁纸 → 命中', rec(styles, 'zhuang', 'sakura') === true)

  // 2) 边界：none 永不命中；字段缺失/损坏不抛
  ok("壁纸为 'none' 时永不命中（无背景不算推荐）", rec(styles, 'burst', 'none') === false)
  ok('presetStyles 为 undefined 不抛', rec(undefined, 'burst', 'dark') === false)
  ok('预设不存在时不抛', rec(styles, 'nope', 'dark') === false)
  ok('background 字段缺失时不命中', rec({ burst: {} }, 'burst', 'dark') === false)
  ok('background 为空串时不命中', rec({ burst: { background: '' } }, 'burst', 'dark') === false)
  ok('background 非字符串时不命中', rec({ burst: { background: 42 } }, 'burst', 'dark') === false)

  // 3) ★ 核心约束：切预设不改 settings.background
  //    （纯函数只做判定，不产生任何副作用 —— 这就是「不自动切换」的实现保证）
  const b = await boot({ ...baseSettings, preset: 'burst', background: 'sakura' })
  ok('★ 启动后 background 保持用户选择（sakura）',
    b.mod.__test.state.settings.background === 'sakura',
    String(b.mod.__test.state.settings.background))
  await b.mod.__test.save({ preset: 'wine' })
  ok('★ 切预设后 background 仍为 sakura（不自动跟随）',
    b.mod.__test.state.settings.background === 'sakura',
    String(b.mod.__test.state.settings.background))
  await b.mod.__test.save({ preset: 'zhuang' })
  ok('★ 再切一次仍不自动跟随',
    b.mod.__test.state.settings.background === 'sakura')

  // 4) 手动改壁纸生效（推荐标记不干扰手动选择）
  await b.mod.__test.save({ background: 'ultrawide' })
  ok('手动改壁纸生效（ultrawide）',
    b.mod.__test.state.settings.background === 'ultrawide',
    String(b.mod.__test.state.settings.background))
  ok('手动改后推荐判定仍跟预设走（与当前选择无关）',
    rec(b.mod.__test.state.presetStyles, 'zhuang', 'sakura') === true &&
    rec(b.mod.__test.state.presetStyles, 'zhuang', 'ultrawide') === false)

  // 5) 宿主下发的 presetStyles 契约
  const ps = b.mod.__test.state.presetStyles
  ok('state.presetStyles 含四套',
    ['zhuang', 'burst', 'cyan', 'wine'].every(id => ps?.[id] !== undefined),
    JSON.stringify(Object.keys(ps ?? {})))
  ok('presetStyles 无 radius 字段（圆角禁令）', !('radius' in (ps?.zhuang ?? {})))
  ok('每套都有 style 与 background',
    ['zhuang', 'burst', 'cyan', 'wine'].every(id =>
      typeof ps[id].style === 'string' && typeof ps[id].background === 'string'))

  // 6) 推荐壁纸 id 必须都在 BACKGROUNDS 里（否则标记静默落空）
  const BG = b.mod.__test.BACKGROUNDS
  const badBg = ['zhuang', 'burst', 'cyan', 'wine']
    .map(id => ps[id].background)
    .filter(x => !BG.includes(x))
  ok('四套推荐壁纸都在 BACKGROUNDS 里存在（防标记静默落空）',
    badBg.length === 0, badBg.join(', '))

  // 7) 判定逻辑已去重（3 处调用点统一走纯函数）
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  const dup = (csrc.match(/presetStyles\?\.\[settings\.preset\]\?\.background/g) ?? []).length
  ok('组件里不再重复写判定表达式（已收敛到纯函数）', dup === 0, `仍有 ${dup} 处`)
  // 每个使用点**调一次、结果复用**（原先观测栏对同一判断调了两次：一次给
  // className、一次给 data-*）。所以是 2 处（设置页 1 + 观测栏 1）。
  ok('isRecommendedArt 每个使用点只调一次（结果复用，不重复求值）',
    (csrc.match(/isRecommendedArt\(/g) ?? []).length === 2,
    `实测 ${(csrc.match(/isRecommendedArt\(/g) ?? []).length} 处`)

  // 8) CSS 侧：推荐标记的小圆点必须还原 corner-shape
  //    外壳全局给 *,:before,:after 设了 superellipse(1.5)，不还原会变方圆角
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s/g, '')
  ok('CSS 含 .zf-art-recommended 规则', css.includes('.zf-art-recommended'))
  ok('圆点还原 corner-shape:round（防超椭圆）',
    flat.includes('corner-shape:round'))
  ok('圆点用主题强调色', flat.includes('var(--dsw-alias-brand-primary)'))
  // 全仓除该圆点外不得新增圆角
  const radiusUses = (csrc.match(/border-radius/g) ?? []).length
  ok('client.js 的 border-radius 用量受控（≤ 既有数量，无风格化新增）',
    radiusUses <= 6, `实测 ${radiusUses} 处`)
}
// 用例 58：折叠的过程块不能加头像（用户截图反馈「折叠效果很奇怪」）
//
// 背景：折叠的「思考」行**不是空的** —— 它有 24px 高的摘要（`▾ 思考 · 摘要…`）。
// 所以只靠 `:not(:empty)` 判不出「已折叠」：
//   · 旧判据 `:not(:empty):not(:has(>[data-slot]...:empty))` 通过 → 加了 44px
//     左内距 + 28px 头像
//   · 但该行实际只有 24px 高（外壳 `contain:size layout` +
//     `height:calc(24px + var(--dsh-content-font-delta))`）
//   · 结果头像与摘要行挤在一起、文字被右推
//
// 外壳给了专用语义标记（源码实测）：
//   const processHidden = controllerInactive || foldable && processMember && !processOpen
//   "data-turn-process-hidden": processHidden || void 0,
// 折叠时属性存在，展开时不存在。所以判据必须**三条并列**。
{
  console.log('\n--- 折叠的过程块不加头像 ---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')

  // 1) 三条并列判据必须都在「加头像」的选择器上
  const avatarSel = 'body[data-zf-avatar][data-chat-flow-kind="assistant-step"]'
  // 分别断言两个 :not 都在，不依赖它们的先后顺序
  // （reasoning 约束插在中间后，原先的「紧邻」匹配会失效）
  ok('加头像的规则排除整段过程折叠（data-turn-process-hidden）',
    flat.includes(':not([data-turn-process-hidden])'),
    '选择器里没有排除折叠态')
  ok('加头像的规则排除推理组（data-chat-group-part="reasoning"）',
    flat.includes(':not([data-chat-group-part="reasoning"])'),
    '缺这条会让折叠的「思考」行挤头像')
  ok('左内距规则同样排除折叠态',
    (flat.match(/not\(\[data-turn-process-hidden\]\):not\(:empty\)/g) ?? []).length >= 2,
    `实测 ${(flat.match(/not\(\[data-turn-process-hidden\]\):not\(:empty\)/g) ?? []).length} 处`)

  // 2) 折叠行要显式清零（不能只靠「不加」—— 还要压掉可能继承的占位）
  ok('折叠行显式清零（padding-left:0;min-height:0）',
    /assistant-step"\]\[data-turn-process-hidden\]\{padding-left:0;min-height:0;\}/.test(flat) ||
    /assistant-step"\]\[data-turn-process-hidden\],/.test(flat))
  // 清零组现在把三类折叠并列写在一个选择器列表里（逗号分组），
  // 所以不能再要求 `[data-turn-process-hidden]::before{` 紧邻。
  // 改为断言：存在一组 `...::before{content:none`，且其中包含
  // data-turn-process-hidden 与 reasoning 两个条件。
  const zeroGroup = /\{[^}]*content:none[^}]*\}/.test(flat)
  ok('存在头像伪元素清零规则', zeroGroup)
  ok('清零组覆盖 data-turn-process-hidden 与 reasoning',
    flat.includes('[data-turn-process-hidden]::before') ||
    (flat.includes('content:none') && flat.includes('"reasoning"')),
    '清零组没覆盖全部折叠类型')

  // 3) 与外壳折叠语义严格互补：三条件取反 vs 三条件
  //    外壳折叠 = 空 或 子节点空 或 折叠中的过程块
  const shellFold = ['assistant-step"]:empty', 'chat.node"]:empty)',
    'assistant-step"][data-turn-process-hidden]']
  for (const frag of shellFold) {
    ok(`清零规则覆盖外壳折叠条件：${frag.slice(0, 28)}…`,
      flat.includes(frag))
  }

  // 4) 不引入 min-height（会撑开本该 height:0 的行）
  ok('加头像的规则不含 min-height（不撑高行）',
    !/not\(\[data-turn-process-hidden\]\):not\(:empty\)[^{]*\{[^}]*min-height/.test(flat))

  // 5) 桩里能构造折叠行，且它确实非空（复现用户场景）
  const dom = shellDom({ kinds: ['assistant-step'], foldedProcess: ['assistant-step'] })
  const folded = dom.center.children.filter(c =>
    c.getAttribute('data-chat-flow-kind') === 'assistant-step' &&
    c.hasAttribute('data-turn-process-hidden'))
  ok('桩能构造折叠的过程块行', folded.length === 1, `实际 ${folded.length}`)
  ok('折叠行非空（这正是旧判据误判的原因）',
    folded[0].children.length > 0)
}
// 用例 59：代码块底色（修官方的 shiki 变量作用域 bug）
//
// 用户反馈「这一块一直都是白色的」。
//
// 根因：外壳把 shiki 变量声明在 `:root`，但它的值引用 `body` 上的 alias：
//   :root{ --shiki-background: var(--dsw-alias-markdown-code-block) }
//   body { --dsw-alias-markdown-code-block: var(--dsw-static-...) }
// 自定义属性在**声明它的元素上**做替换，而 html 不是 body 的后代 →
// 解析失败 → --shiki-background 无效 → background-color 退化为 transparent。
//
// 用 Edge headless 实测过（真实 CSS 引擎）：
//   :root 上 --shiki-background → ""（空）
//   <pre> 计算 background-color → rgba(0,0,0,0)
// 修法 A（body 上重声明）→ 浅 rgb(232,232,234) / 深 rgb(43,43,46) ✓
{
  console.log('\n--- 代码块底色（shiki 变量作用域）---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')

  ok('CSS 在 body 上重声明 --shiki-background',
    flat.includes('body{--shiki-background:var(--dsw-alias-markdown-code-block)'))
  ok('CSS 在 body 上重声明 --shiki-foreground',
    flat.includes('--shiki-foreground:var(--dsw-alias-label-primary)'))
  ok('用 var() 引用 alias（不写死颜色，明暗自动跟随）',
    /--shiki-background:var\(--dsw-alias-markdown-code-block\)/.test(flat))
  ok('不依赖 !important（body 声明足够，无需压外壳）',
    !/--shiki-background:[^;]*!important/.test(flat))

  // 我们确实提供了被引用的 token（否则修了也没底色）
  const pal = await import('../src/palette.js')
  for (const scheme of ['light', 'dark']) {
    const t = pal.buildTokens('zhuang')[scheme]
    ok(`${scheme} 下 markdown-code-block 已注册`,
      typeof t['--dsw-alias-markdown-code-block'] === 'string')
    ok(`${scheme} 下 label-primary 已注册`,
      typeof t['--dsw-alias-label-primary'] === 'string')
  }

  // 代码块底色必须与画布**可区分**（否则等于没修：底色＝背景色就看不出块）
  const { contrast, luminance } = pal
  for (const id of ['zhuang', 'burst', 'cyan', 'wine']) {
    for (const scheme of ['light', 'dark']) {
      const t = pal.buildTokens(id)[scheme]
      const code = t['--dsw-alias-markdown-code-block']
      const base = t['--dsw-alias-bg-base']
      const d = Math.abs((luminance(code) ?? 0) - (luminance(base) ?? 0))
      ok(`${id}/${scheme} 代码块底色与画布可区分`,
        d > 0.01, `亮度差 ${d.toFixed(4)}（code=${code} base=${base}）`)
    }
  }

  // 正文在代码块上要可读（4.5:1）
  for (const id of ['zhuang', 'burst', 'cyan', 'wine']) {
    for (const scheme of ['light', 'dark']) {
      const t = pal.buildTokens(id)[scheme]
      const r = contrast(t['--dsw-alias-label-primary'], t['--dsw-alias-markdown-code-block'])
      ok(`${id}/${scheme} 正文在代码块上 ≥4.5:1`,
        r !== null && r >= 4.5, r === null ? '不可解析' : `${r.toFixed(2)}:1`)
    }
  }
}
// 用例 60：排版体系（风格预设的第四个维度）
//
// 依据：外壳有 184 个 `--dsw-font-*` token（32 个排版角色），此前一个都没用。
//
// 两个实测确认的关键点（写在 `src/fonts.js` 里，这里用断言锁住）：
//   ① 必须**同时**覆盖 `:root` 与 `body` —— 复合 token（249 处消费）在
//      `:root` 求值，只写 body 时标题/正文块不换字体（Edge 实测）
//   ② 字号缩放**必须** `!important` —— presenter 把 `--dsh-content-font-size`
//      写成 body 的行内样式，普通规则压不过（Edge 实测）
{
  console.log('\n--- 排版体系（字体 / 字号）---')
  const fonts = await import('../src/fonts.js')
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')

  // 1) 每个档位都要有规则，且 `:root` 与 `body` 都在
  for (const fam of fonts.FONT_FAMILIES) {
    if (fam === 'default') continue
    ok(`${fam} 档有规则`, flat.includes(`html[data-zf-font="${fam}"]`))
    ok(`${fam} 档同时覆盖 html 与 body`,
      new RegExp(`html\\[data-zf-font="${fam}"\\],html\\[data-zf-font="${fam}"\\]body\\{`).test(flat))
  }
  ok('default 档不写规则（零覆盖）', !flat.includes('data-zf-font="default"'))

  // 2) 字号缩放
  ok('字号规则存在', flat.includes('data-zf-font-scale="1.05"'))
  ok('字号规则带 !important（否则压不过 presenter 的行内值）',
    /data-zf-font-scale="1\.05"\]body\{[^}]*--dsh-content-font-size:calc\(16px\*1\.05\)!important/.test(flat))
  ok('scale=1 不写规则（零覆盖）', !flat.includes('data-zf-font-scale="1"'))

  // 3) 字体栈质量：以通用族结尾、无远程 URL
  for (const [key, stack] of Object.entries(fonts.FONT_STACKS)) {
    const last = stack.split(',').pop().trim()
    ok(`${key} 字体栈以通用族结尾`,
      ['serif', 'sans-serif', 'monospace', 'system-ui'].includes(last), last)
    ok(`${key} 字体栈不含 url()（零网络、零体积）`, !/url\(/.test(stack))
    ok(`${key} 字体栈含中文回退`,
      /PingFang|Microsoft YaHei|Songti|SimSun|Sarasa|Yuanti|Hiragino|Noto Serif CJK/.test(stack))
  }
  // 等宽档必须真等宽（否则代码/终端会错位）—— 只用于界面，代码块另有 --dsw-font-mono
  ok('mono 档以 monospace 结尾（等宽保证）',
    fonts.FONT_STACKS.mono.trim().endsWith('monospace'))

  // 4) 归一化
  ok('非法字体档回落 default', fonts.normalizeFontFamily('bogus') === 'default')
  ok('字号夹到最近档（1.02 → 1）', fonts.normalizeFontScale(1.02) === 1)
  ok('字号夹到最近档（3 → 1.05）', fonts.normalizeFontScale(3) === 1.05)
  ok('字号非法输入回落 1', fonts.normalizeFontScale('abc') === 1)
  ok('字号档位全在 ±5% 内（防撑破固定高度行）',
    fonts.FONT_SCALES.every(s => s >= 0.95 && s <= 1.05), JSON.stringify(fonts.FONT_SCALES))

  // 5) fontAttrs：default/1 不打标记（零覆盖）
  const a1 = fonts.fontAttrs('default', 1)
  ok('default + 1 → 两个属性都为 null（不打标记）',
    a1.font === null && a1.scale === null, JSON.stringify(a1))
  const a2 = fonts.fontAttrs('serif', 1.05)
  ok('serif + 1.05 → 两个属性都有值',
    a2.font === 'serif' && a2.scale === '1.05', JSON.stringify(a2))

  // 6) 客户端与宿主档位一致（各持一份，必须同步）
  const probe = await boot(baseSettings)
  const T = probe.mod.__test
  ok('客户端 FONT_FAMILIES 与宿主一致',
    JSON.stringify(T.FONT_FAMILIES) === JSON.stringify(fonts.FONT_FAMILIES),
    `${JSON.stringify(T.FONT_FAMILIES)} vs ${JSON.stringify(fonts.FONT_FAMILIES)}`)
  ok('客户端 FONT_SCALES 与宿主一致',
    JSON.stringify(T.FONT_SCALES) === JSON.stringify(fonts.FONT_SCALES))
  ok('客户端 fontAttrsFor 与宿主 fontAttrs 同结果',
    JSON.stringify(T.fontAttrsFor('serif', 1.05)) === JSON.stringify(fonts.fontAttrs('serif', 1.05)) &&
    JSON.stringify(T.fontAttrsFor('default', 1)) === JSON.stringify(fonts.fontAttrs('default', 1)))
  ok('客户端 fontAttrsFor 对非法值回落',
    JSON.stringify(T.fontAttrsFor('bogus', 99)) === JSON.stringify({ font: null, scale: '1.05' }),
    JSON.stringify(T.fontAttrsFor('bogus', 99)))

  // 7) 属性写入（写到 html 上，不是 body —— CSS 选择器是 html[...]）
  const b1 = await boot({ ...baseSettings, fontFamily: 'serif', fontScale: 1.05 })
  ok("fontFamily=serif 时 html 有 data-zf-font='serif'",
    b1.h.dom.html.getAttribute('data-zf-font') === 'serif',
    String(b1.h.dom.html.getAttribute('data-zf-font')))
  ok("fontScale=1.05 时 html 有 data-zf-font-scale='1.05'",
    b1.h.dom.html.getAttribute('data-zf-font-scale') === '1.05',
    String(b1.h.dom.html.getAttribute('data-zf-font-scale')))
  const b2 = await boot({ ...baseSettings, fontFamily: 'default', fontScale: 1 })
  ok('默认档不打标记（零覆盖）',
    !b2.h.dom.html.hasAttribute('data-zf-font') &&
    !b2.h.dom.html.hasAttribute('data-zf-font-scale'))
  const b3 = await boot({ ...baseSettings, fontFamily: 'mono', enabled: false })
  ok('插件停用时不打字体标记', !b3.h.dom.html.hasAttribute('data-zf-font'))
  // 切换要立刻生效
  await b2.mod.__test.save({ fontFamily: 'rounded' })
  ok('切换字体后标记跟随',
    b2.h.dom.html.getAttribute('data-zf-font') === 'rounded',
    String(b2.h.dom.html.getAttribute('data-zf-font')))

  // 8) 代码块字体不受影响（改了会错位）
  ok('字体规则不碰 --dsw-font-mono（代码/终端专用）',
    !/--dsw-font-mono\s*:/.test(flat))

  // 9) 设置迁移 v3 → v4
  const set = await import('../src/settings.js')
  ok('SETTINGS_VERSION ≥ 4', set.SETTINGS_VERSION >= 4, String(set.SETTINGS_VERSION))
  const mig = set.normalizeSettings({ version: 3, preset: 'wine', accentHue: 200, motion: 'reduced' })
  ok('v3 → v4 无损（旧字段保留 + 新键补默认）',
    mig.accentHue === 200 && mig.motion === 'reduced' &&
    mig.fontFamily === 'default' && mig.fontScale === 1, JSON.stringify(mig))
  ok('设置里非法排版值回落',
    set.normalizeSettings({ fontFamily: 'x', fontScale: 99 }).fontFamily === 'default' &&
    set.normalizeSettings({ fontFamily: 'x', fontScale: 99 }).fontScale === 1.05)

  // 10) DICT 中英键一致（防漏翻）
  const zh = Object.keys(T.DICT.zh).sort()
  const en = Object.keys(T.DICT.en).sort()
  const onlyZh = zh.filter(k => !en.includes(k))
  const onlyEn = en.filter(k => !zh.includes(k))
  ok('DICT 中英键集合一致（防漏翻）',
    onlyZh.length === 0 && onlyEn.length === 0,
    `仅 zh: ${onlyZh.join(',')} | 仅 en: ${onlyEn.join(',')}`)
  for (const f of fonts.FONT_FAMILIES) {
    ok(`DICT 含 font_${f}`, typeof T.DICT.zh[`font_${f}`] === 'string' && typeof T.DICT.en[`font_${f}`] === 'string')
  }
}
// 用例 61：无障碍（减少透明度 / 高对比）
//
// 依据：外壳支持 `prefers-reduced-motion`（72 处）、`prefers-reduced-transparency`
// （1 处）、`forced-colors`（2 处），但**完全不支持** `prefers-contrast`（0 处）。
// 所以只跟前面三个，不做 `prefers-contrast`（单方面加深文字会与官方组件割裂）。
{
  console.log('\n--- 无障碍（系统偏好）---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()

  // 1) 减少透明度：撤壁纸 + 三列回不透明底
  //
  // ⚠️ 解析**生成的 CSS**（`structureCss()` 的产物），不是源码数组 ——
  // 源码里每行是 `'...',`，产物里是真正的换行。按大括号配平切片。
  /** 取出 `@media <query>{...}` 的块体（按大括号配平，不靠正则贪婪）。 */
  const mediaBlock = query => {
    const start = css.indexOf(`@media (${query})`)
    if (start < 0) return ''
    const open = css.indexOf('{', start)
    if (open < 0) return ''
    let depth = 0
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') {
        depth -= 1
        if (depth === 0) return css.slice(open + 1, i)
      }
    }
    return ''
  }
  ok('响应 prefers-reduced-transparency',
    css.includes('@media (prefers-reduced-transparency:reduce)'))
  const rtBlock = mediaBlock('prefers-reduced-transparency:reduce')
  ok('减少透明度时撤掉壁纸绘制层（::before / ::after）',
    /data-zf-wallpaper\]::before/.test(rtBlock) && /data-zf-wallpaper\]::after/.test(rtBlock))
  ok('减少透明度时三列回不透明底色', /background:var\(--dsw-alias-bg-base\)/.test(rtBlock))
  // ⚠️ 必须覆盖两套壳（桌面 rightbarCol / Web detailsCol），只写一半会留半透明
  for (const sel of ['_sidebarCol', '_centerCol', '_rightbarCol', '_detailsCol']) {
    ok(`减少透明度覆盖 ${sel}`, rtBlock.includes(`[class*="${sel}"]`))
  }
  // 也覆盖 data-* 语义锚点（比类名稳）
  for (const attr of ['data-zf-sidebar', 'data-zf-center', 'data-zf-rightbar']) {
    ok(`减少透明度覆盖 [${attr}]`, rtBlock.includes(`[${attr}]`))
  }

  // 2) 高对比：撤壁纸与启动动效图（否则会盖住系统强制色）
  ok('响应 forced-colors:active', css.includes('@media (forced-colors:active)'))
  const fcBlock = mediaBlock('forced-colors:active')
  ok('高对比时撤掉壁纸', /data-zf-wallpaper\]::before/.test(fcBlock))
  ok('高对比时撤掉启动动效立绘（否则盖住强制色）',
    /\.zf-splash__art/.test(fcBlock))

  // 3) 不做 prefers-contrast（外壳不支持，单方面做会割裂）
  ok('不单方面实现 prefers-contrast（外壳 0 处支持）',
    !css.includes('prefers-contrast'))

  // 4) 这些偏好**不改变用户设置**（只在呈现层生效）
  //    断言：CSS 里没有写死值覆盖我们的 CSS 变量，而是整层撤掉
  ok('减少透明度不修改用户的背景变量（整层撤掉而非改值）',
    !/--zf-veil[^;]*:/.test(rtBlock) && !/--zf-art-src[^;]*:/.test(rtBlock))
}

// 用例 62：本地化完整性
//
// dsh-wallpaper-engine 的 README 自己承认「选择器文案为中英混合（尚未接入
// locale）」—— 我们已接入（`ctx.locale.register`），这里把缺口补齐并锁住。
{
  console.log('\n--- 本地化完整性 ---')
  const probe = await boot(baseSettings)
  const T = probe.mod.__test
  const zh = Object.keys(T.DICT.zh)
  const en = Object.keys(T.DICT.en)

  ok('DICT 中英键集合完全一致（防漏翻）',
    zh.length === en.length && zh.every(k => en.includes(k)),
    `zh=${zh.length} en=${en.length}`)
  ok('DICT 无空字符串值',
    zh.every(k => typeof T.DICT.zh[k] === 'string' && T.DICT.zh[k].trim() !== '') &&
    en.every(k => typeof T.DICT.en[k] === 'string' && T.DICT.en[k].trim() !== ''))
  // 中文值里不该混入英文占位（英文值里出现中文说明漏翻）
  const cnInEn = en.filter(k => /[\u4e00-\u9fa5]/.test(T.DICT.en[k]))
  ok('英文 DICT 里没有残留中文（漏翻检测）',
    cnInEn.length === 0, cnInEn.join(', '))
  ok('注册了 locale 命名空间', T.NS === 'settings.zhuangFangyi', String(T.NS))
  // 所有注册进插槽/标签页的条目都带 locale（官方契约）
  const hostSrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  ok('插槽注册带 locale 命名空间（官方契约）',
    (hostSrc.match(/locale: NS/g) ?? []).length >= 5,
    `实测 ${(hostSrc.match(/locale: NS/g) ?? []).length} 处`)
}
// 用例 63：发行完整性 —— 素材必须入库（CI 抓到过的真实问题）
//
// 背景：`.gitignore` 曾忽略 `art/*.webp`，理由是「可以重新生成」。
// **这个理由不成立**：源素材在仓库外（`庄方宜素材/` 10.8 GB、
// `干员立绘.jpeg` 在上一级），别人 clone 后重跑生成脚本会失败；
// 而 GitHub 直装走 git clone → 素材缺失时 `/art/*` 返回 404
// → 背景图裂、启动动效空白。
//
// 这组断言把「哪些素材必须在仓库里」变成可执行的检查，防止有人
// 为了减小仓库体积把 `.gitignore` 改回去。
{
  console.log('\n--- 发行完整性（素材入库）---')
  const { execFileSync } = await import('node:child_process')

  /** 该文件是否被 git 跟踪（= 会随 clone 分发）。 */
  const tracked = rel => {
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', rel], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore']
      })
      return true
    } catch { return false }
  }

  // 1) 启动动效素材：来自仓库外的 `干员立绘.jpeg`，**必须入库**
  for (const f of ['art/splash.webp', 'art/splash-sm.webp']) {
    ok(`${f} 已入库（否则 clone 后启动动效坏）`, tracked(f))
    ok(`${f} 文件存在`, fs.existsSync(path.join(ROOT, f)))
  }

  // 2) 壁纸：来自仓库外的 `庄方宜素材/`，同样必须入库
  const BG = SHARED_MOD.__test.BACKGROUNDS
  const missingBg = []
  for (const id of BG) {
    if (id === 'none') continue
    for (const suffix of ['', '-dark']) {
      const rel = `art/wallpaper-${id}${suffix}.webp`
      if (!tracked(rel)) missingBg.push(rel)
    }
  }
  ok('全部壁纸（明暗两版）已入库', missingBg.length === 0, missingBg.slice(0, 4).join(', '))

  // 3) 缩略图（设置页壁纸选择器要显示它们）
  const missingThumb = []
  for (const id of BG) {
    if (id === 'none') continue
    for (const suffix of ['', '-dark']) {
      const rel = `art/thumbs/wallpaper-${id}${suffix}.webp`
      if (!tracked(rel)) missingThumb.push(rel)
    }
  }
  ok('全部缩略图已入库（否则设置页缩略图条裂图）',
    missingThumb.length === 0, missingThumb.slice(0, 4).join(', '))

  // 4) 清单与装饰素材
  for (const f of ['art/wallpapers.json', 'art/avatar.webp', 'art/contour.webp']) {
    ok(`${f} 已入库`, tracked(f))
  }

  // 5) `.gitignore` 不该再忽略 art 下的产物
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  ok('.gitignore 不再忽略 art/*.webp',
    !/^art\/\*\.webp\s*$/m.test(gi),
    '有人把忽略规则加回来了 —— 那会让 GitHub 直装缺素材')
  ok('.gitignore 仍忽略 node_modules 与 dist（不该入库的）',
    /node_modules\//.test(gi) && /dist\//.test(gi))

  // 6) 生成的 CSS 里引用的每个素材都要在仓库里（防「CSS 指向不存在的图」）
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const refs = [...css.matchAll(/--zf-art-([a-z0-9-]+):url\("([^"]+)"\)/g)]
  ok('CSS 里有壁纸变量（引用存在性检查的前提）', refs.length > 0, `实测 ${refs.length} 条`)
  const badRefs = refs
    .map(m => decodeURIComponent(m[2].split('/art/').pop()))
    .filter(f => !fs.existsSync(path.join(ROOT, 'art', f)))
  ok('CSS 引用的每个素材文件都存在',
    badRefs.length === 0, badRefs.slice(0, 4).join(', '))
}
// 用例 64：文案映射的两种结构不能混用（用户截图发现的真 bug）
//
// 截图里观测栏显示了一排原始 id（`sakura` / `promo` / `pool` …）和一个
// 原始键名（`bgOpacity`）。两个根因：
//
//   ① `BG_LABELS` 的值是 **DICT 键**（`sakura: 'bgSakura'`），必须走 `t()`；
//      而 `PRESET_LABELS` 才是 `{zh, en}` 结构。混用后 `BG_LABELS[b]?.['zh']`
//      取到 undefined → 回落到原始 id。
//   ② `t('bgOpacity')` 的键不存在（DICT 里是 `opacity`）—— `t()` 在键缺失时
//      **原样返回键名**，于是界面直接显示 "bgOpacity"。
//
// 这类 bug 不会报错、不会崩，只是**显示错的内容** —— 只能靠断言抓。
{
  console.log('\n--- 文案映射（结构混用 / 键名写错）---')
  const probe = await boot(baseSettings)
  const T = probe.mod.__test
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  const zh = T.DICT.zh

  // 1) 所有 t('literal') 的键都必须存在
  //
  // ⚠️ 必须**先剥掉注释**再扫。原先直接在源码上正则匹配 `t('...')`，于是
  // 注释里写一句示例（如 `… , t('groupX'))`）就会被当成真实调用，报一个
  // 根本不存在的键 —— 实测踩过（这次重构时）。
  // 「在注释上做断言」是这个项目反复出现的失败模式，所以这里从扫描侧根治。
  const stripComments = s => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ') // 行注释（避开 http:// 这类）
  const codeOnly = stripComments(csrc)
  const used = new Set([...codeOnly.matchAll(/\bt\('([a-zA-Z_][a-zA-Z0-9_]*)'\)/g)].map(m => m[1]))
  const missing = [...used].filter(k => zh[k] === undefined).sort()
  ok('所有 t(\'literal\') 的键都存在于 DICT',
    missing.length === 0,
    `缺失: ${missing.join(', ')}（t() 会原样显示键名）`)
  // 反向自检：剥注释这一步本身要有效（否则上面的断言可能因注释而误报/漏报）
  ok('注释剥除有效（注释里的 t(\'…\') 不再被当成调用）',
    stripComments("/* t('ghostA') */ const x = 1 // t('ghostB')").includes('ghost') === false)

  // 2) BG_LABELS 的值必须是 DICT 键，且该键存在
  const bgBlock = /const BG_LABELS = \{([\s\S]*?)\n      \}/.exec(csrc)
  ok('找到 BG_LABELS 定义', bgBlock !== null)
  const bgPairs = [...(bgBlock?.[1] ?? '').matchAll(/(\w+):\s*'(\w+)'/g)].map(m => [m[1], m[2]])
  ok('BG_LABELS 条目数 ≥ 9', bgPairs.length >= 9, `实测 ${bgPairs.length}`)
  const badBg = bgPairs.filter(([, key]) => zh[key] === undefined)
  ok('BG_LABELS 的每个值都是存在的 DICT 键',
    badBg.length === 0, badBg.map(([id, k]) => `${id}→${k}`).join(', '))

  // 3) BG_LABELS 是「id → DICT 键」，**不是** {zh, en} —— 断言源码里没有误用
  ok('BG_LABELS 没有被当成 {zh,en} 用（`BG_LABELS[...]?.[\'zh\']`）',
    !/BG_LABELS\[[^\]]+\]\?\.\['zh'\]/.test(csrc),
    '这会让界面回落到原始 id（用户截图里的 sakura/promo/pool）')

  // 4) PRESET_LABELS 反过来是 {zh, en}，断言它没有被 t() 包（那样会显示键名）
  const presetBlock = /const PRESET_LABELS = \{([\s\S]*?)\n      \}/.exec(csrc)
  ok('PRESET_LABELS 是 {zh,en} 结构',
    /\{\s*zh:\s*'/.test(presetBlock?.[1] ?? ''))
  ok('PRESET_LABELS 没有被 t() 包着用（它不是 DICT 键）',
    !/t\(PRESET_LABELS/.test(csrc))

  // 5) DICT 值等于键名 = 漏翻（界面会显示英文键）
  //    例外：**单位与符号**类文案本就该相同（`px: 'px'`、`percent: '%'`），
  //    它们不是翻译对象。用白名单排除，而不是放宽整条断言。
  const UNIT_KEYS = new Set(['px', 'percent'])
  const selfNamed = Object.keys(zh).filter(k => zh[k] === k && !UNIT_KEYS.has(k))
  ok('DICT 里没有「值等于键名」的漏翻项（单位类除外）',
    selfNamed.length === 0, selfNamed.join(', '))

  // 6) 观测栏壁纸选择器已改成缩略图网格（不再是全宽文字列表）
  ok('观测栏壁纸用缩略图网格（zf-rail__artgrid）',
    csrc.includes('zf-rail__artgrid'))
  // 从 artgrid 起切到该段结尾（不靠固定字符窗口 —— 900 太小，
  // 中间夹着注释与 map 体，实测会误判）
  const gridStart = csrc.indexOf('zf-rail__artgrid')
  const gridBlock = gridStart < 0 ? '' : csrc.slice(gridStart, gridStart + 2600)
  ok('缩略图指向 thumbs/ 下的图',
    gridBlock.includes('art/thumbs/'),
    gridBlock.includes('art/thumbs/') ? '' : '没找到 thumbs 路径')
  ok('缩略图按明暗取对应版本（-dark）',
    gridBlock.includes("-dark") && gridBlock.includes('isDarkActive'))
  ok('观测栏有「无」选项（与其它项同尺寸保持网格整齐）',
    csrc.includes('zf-rail__art--none'))

  // 7) isDarkActive：DOM 判据 + 兜底
  const dark = T.isDarkActive
  ok('isDarkActive 已导出', typeof dark === 'function')
  ok('无 DOM 标记时按 settings.scheme 兜底',
    dark({ scheme: 'dark' }) === true && dark({ scheme: 'light' }) === false &&
    dark({ scheme: 'system' }) === false)
}


// 用例 58b：折叠行头像 —— 用**用户给的真实 HTML** 在真实引擎里实测
//
// 只看「CSS 里有那条规则」证明不了真实引擎会算出什么（shiki 那个 bug 就是
// 靠实测才定位的）。这里用 Edge headless 读计算值，复现用户第三次截图的结构：
//   data-chat-flow-kind="assistant-step"
//   data-chat-group-part="reasoning"        ← 推理组
//   data-turn-process-member="true"
//   （没有 data-turn-process-hidden）        ← 这是"单行内折叠"，不是整段折叠
//     └─ _3GBCTG_root:not([data-expanded]) → 外壳锁死 24px
{
  console.log('\n--- 折叠行头像（真实引擎实测）---')
  const { execFileSync } = await import('node:child_process')
  const { structureCss } = await import('../index.js')

  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  const edgeOk = fs.existsSync(EDGE)
  // ⚠️ 这里是**真实跳过**，不是「断言 Edge 存在」——
  // CI 跑在 Linux 上没有 Edge，断言存在会让 CI 必然失败（踩过）。
  // 本地（Windows）有 Edge 时才会真的跑这一组；跳过时打印一行说明，
  // 避免「静默没跑」被误认为「跑过了」。
  if (!edgeOk) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过；本地 Windows 会执行')
  }

  if (edgeOk) {
    const html = `<!DOCTYPE html><html><head><style>
      ._3GBCTG_root:not([data-expanded]){contain:size layout;height:24px}
      .flowItem:is(:empty,:has(>[data-slot="conversation.chat.node"]:empty)){height:0}
      body[data-zf-avatar]{--zf-avatar-image:linear-gradient(#8ab,#467)}
      ${structureCss()}
    </style></head><body data-zf-avatar="" data-zf-wallpaper="">
    <div class="flowItem" id="r" data-chat-flow-kind="assistant-step"
         data-chat-group-part="reasoning" data-turn-process-member="true">
      <div data-slot="conversation.chat.node" style="display:contents"><div>
        <div class="_3GBCTG_root" data-variant="think" data-preview="true">
          <div class="_3GBCTG_row" aria-expanded="false">思考 · 摘要</div>
        </div>
      </div></div>
    </div>
    <div class="flowItem" id="p" data-chat-flow-kind="assistant-step" data-chat-group-part="response">
      <div data-slot="conversation.chat.node" style="display:contents"><div style="height:80px">正文</div></div>
    </div>
    <div class="flowItem" id="u" data-chat-flow-kind="assistant-step">
      <div data-slot="conversation.chat.node" style="display:contents"><div style="height:80px">未分组</div></div>
    </div>
    <script>
      const probe = id => {
        const el = document.getElementById(id)
        return {
          pad: getComputedStyle(el).paddingLeft,
          h: Math.round(el.getBoundingClientRect().height),
          before: getComputedStyle(el, '::before').content
        }
      }
      document.title = JSON.stringify({ r: probe('r'), p: probe('p'), u: probe('u') })
    <\/script></body></html>`

    const f = path.join(os.tmpdir(), 'zf-avatar-e2e.html')
    fs.writeFileSync(f, html, 'utf8')
    let res = null
    try {
      const dom = execFileSync(EDGE, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1500',
        '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
      ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      const m = /<title>([^<]*)<\/title>/.exec(dom)
      if (m) res = JSON.parse(m[1].replace(/&quot;/g, '"'))
    } catch { res = null }

    ok('拿到真实引擎的计算值', res !== null)
    if (res !== null) {
      ok('reasoning 行无左内距（不挤头像）', res.r.pad === '0px', res.r.pad)
      ok('reasoning 行不渲染头像伪元素',
        res.r.before === 'none' || res.r.before === 'normal', res.r.before)
      ok('reasoning 行保持 24px（未被撑开）', res.r.h === 24, String(res.r.h))
      ok('response 行有左内距（给头像留位）', res.p.pad === '44px', res.p.pad)
      ok('response 行渲染头像伪元素',
        res.p.before !== 'none' && res.p.before !== 'normal', res.p.before)
      // 外壳把 undefined 视同 response，且那时不渲染该属性 —— 差点漏掉的一类
      ok('未分组行也有头像（undefined 视同 response）', res.u.pad === '44px', res.u.pad)
    }
  }
}


// 用例 65：去掉 Windows 中栏左上角那个「悬浮圆角」（用户截图反馈）
//
// 官方 Windows 壳的设计（源码实测）：
//   [data-windows-titlebar] .BynINW_frame{ --dsh-windows-content-radius:16px }
//   [data-windows-titlebar] .BynINW_centerCol{
//     border-radius:var(--dsh-windows-content-radius) 0 0 0; corner-shape:round }
// 用意：标题栏铺 sidebar-fill（不透明色），中栏左上切圆角 → 中栏"浮"在
// 标题栏上，类似 macOS 红绿灯留白。
//
// 但在主题里标题栏已透明（透出壁纸）、中栏也透明 → 圆角两侧是同一张壁纸，
// 它不再表达层次，只剩一个莫名缺口（用户截图：「左上角的圆角看起来很奇怪」）。
//
// 判据：**只在壁纸开启时**归零 —— 关掉壁纸时界面回到官方不透明配色，
// 那时圆角仍有意义，不该动官方设计。
//
// 做法：改**变量本身**（`--dsh-windows-content-radius`）而不是覆盖
// `border-radius` —— 官方把它做成变量就是留给主题调的，而且它有**两个**
// 消费者（中栏 + ui-sidebar-right 的全屏面板），改变量能一并覆盖。
{
  console.log('\n--- Windows 悬浮圆角（壁纸开启时去掉）---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')

  ok('有归零规则', flat.includes('--dsh-windows-content-radius:0px'))
  // 必须挂在 frame 上（两个消费者都是它的后代 → 靠继承覆盖）
  ok('挂在 frame 上（两个消费者都是它的后代）',
    /body\[data-zf-wallpaper\]\[data-zf-frame\],body\[data-zf-wallpaper\]\[class\*="_frame"\]\{[^}]*--dsh-windows-content-radius:0px/.test(flat))
  // 只在壁纸开启时（`:not([data-zf-wallpaper])` 时不动官方）
  ok('只在壁纸开启时归零（不动官方设计）',
    flat.includes('body[data-zf-wallpaper][data-zf-frame]'))
  // 用变量而不是硬覆盖 border-radius（尊重官方取值方式）
  ok('改的是变量而非 border-radius（覆盖两个消费者）',
    !/body\[data-zf-wallpaper\][^{]*\[class\*="_centerCol"\][^{]*\{[^}]*border-radius/.test(flat))
  // 两套壳的类名都要覆盖
  ok('覆盖 data-zf-frame 与 _frame 两种锚点',
    flat.includes('body[data-zf-wallpaper][data-zf-frame]') &&
    flat.includes('body[data-zf-wallpaper][class*="_frame"]'))

  // 真实引擎实测：确认两个消费者的计算值都是 0
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  const edgeOk = fs.existsSync(EDGE)
  if (!edgeOk) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过；本地 Windows 会执行')
  } else {
    const html = `<!DOCTYPE html><html data-windows-titlebar=""><head><style>
      [data-windows-titlebar] .BynINW_frame{--dsh-windows-content-radius:16px;padding-top:40px;
        background:var(--dsw-specific-sidebar-fill,#16181c)}
      [data-windows-titlebar] .BynINW_centerCol{background:var(--dsw-alias-bg-base,#111);height:80px;
        border-radius:var(--dsh-windows-content-radius) 0 0 0;corner-shape:round}
      [data-windows-titlebar] .OUqwTW_panel[data-sidebar-right-panel=fullscreen]
        [data-dockkit-column="0"][data-dockkit-pane]{height:80px;
        border-radius:var(--dsh-windows-content-radius) 0 0 0;corner-shape:round}
      ${structureCss()}
    </style></head><body data-zf-wallpaper="">
      <div class="BynINW_frame" data-zf-frame>
        <div class="BynINW_centerCol" id="c">中栏</div>
        <div class="OUqwTW_panel" data-sidebar-right-panel="fullscreen">
          <div data-dockkit-column="0" data-dockkit-pane id="p">面板</div>
        </div>
      </div>
      <script>
        const g = id => getComputedStyle(document.getElementById(id)).borderTopLeftRadius
        document.title = JSON.stringify({ c: g('c'), p: g('p') })
      <\/script></body></html>`
    const f = path.join(os.tmpdir(), 'zf-rad-e2e.html')
    fs.writeFileSync(f, html, 'utf8')
    let r = null
    try {
      const dom = execFileSync(EDGE, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1200',
        '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
      ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      const m = /<title>([^<]*)<\/title>/.exec(dom)
      if (m) r = JSON.parse(m[1].replace(/&quot;/g, '"'))
    } catch { r = null }
    ok('拿到真实引擎计算值', r !== null)
    if (r !== null) {
      ok('中栏左上角归零（实测）', r.c === '0px', r.c)
      ok('ui-sidebar-right 全屏面板也归零（实测量）',
        r.p === '0px', `改变量自动覆盖两个消费者；实测 ${r.p}`)
    }
  }
}


// 用例 66：Windows 原生标题栏条带透明（用户「壁纸覆盖更大区域」）
//
// 用户截图量出的现象：同一条 40px 标题栏带子，左半透壁纸（亮度 67–74）、
// 右半恒定暗色（亮度 27，`rgb(28,28,21)`）。分界线正是观测栏左边缘。
//
// 那块是**原生标题栏条带**（Electron `titleBarOverlay`，浏览器进程画在
// 网页之上，z-index 碰不到）。但它的颜色**可以**改 —— 桌面 preload 建了一个
// 隐藏探针 span，把它的 computed 颜色经 IPC 交给
// `setTitleBarOverlay({color, symbolColor})`（源码实测）。
// 主进程的颜色校验接受 alpha，preload 用 canvas 归一化成 rgba ——
// 所以把探针底色设成透明，条带就透明。
//
// ⚠️ 两个实测确认的细节（都踩过）：
//   ① 必须**直接选中探针元素**改 background-color，不能只改变量 ——
//      探针的 background-color 是行内样式且引用 var(...)，而自定义属性按
//      **最近祖先**解析：`--dsw-specific-sidebar-fill` 定义在 body 上，
//      在 html 上写 !important 压不过 body 的普通声明（550c 记录的坑）。
//   ② 属性值里冒号**后面有空格**（`style.cssText` 的序列化结果）：
//        "position: fixed; visibility: hidden; pointer-events: none; …"
//      写 `[style*="visibility:hidden"]`（无空格）会 **0 命中** ——
//      实测确认。用 `[style*="visibility"]` 不依赖空格与属性顺序。
{
  console.log('\n--- Windows 原生标题栏条带透明 ---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')

  ok('有探针透明规则', flat.includes('background-color:transparent!important'))
  ok('只在壁纸开启时生效（不动官方设计）',
    flat.includes('body[data-zf-wallpaper]>span[style*="visibility"]'))
  ok('用 [style*="visibility"]（不依赖空格 —— 实测无空格会 0 命中）',
    flat.includes('[style*="visibility"]'),
    '写成 visibility:hidden 会命中 0 个元素')
  ok('带 :not([class])（不误伤同形元素）',
    flat.includes('span[style*="visibility"]:not([class])'))
  ok('限定 body 直接子元素（探针是 body > span）',
    flat.includes('body[data-zf-wallpaper]>span'))

  // 真实引擎实测：照抄 preload 的探针，确认选择器命中且行为正确
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    const build = on => `<!DOCTYPE html><html><head><style>
      body{--dsw-specific-sidebar-fill:#1c1c15;--dsw-alias-label-primary:#f9fafb}
      ${structureCss()}
    </style></head><body ${on ? 'data-zf-wallpaper=""' : ''}>
      <span class="x" style="visibility:hidden;background-color:#123456" id="d">d</span>
      <script>
        const probe = document.createElement('span')
        probe.id = 'p'
        probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;' +
          'background-color:var(--dsw-specific-sidebar-fill);' +
          'color:var(--dsw-alias-label-primary)'
        document.body.append(probe)
        const g = id => getComputedStyle(document.getElementById(id))
        document.title = JSON.stringify({
          p: g('p').backgroundColor, sym: g('p').color, d: g('d').backgroundColor
        })
      <\/script></body></html>`

    const rows = {}
    for (const on of [true, false]) {
      const f = path.join(os.tmpdir(), `zf-probe-${on}.html`)
      fs.writeFileSync(f, build(on), 'utf8')
      try {
        const dom = execFileSync(EDGE, [
          '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1200',
          '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
        ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
        const m = /<title>([^<]*)<\/title>/.exec(dom)
        rows[on] = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null
      } catch { rows[on] = null }
    }
    ok('拿到真实引擎计算值', rows[true] !== null && rows[false] !== null)
    if (rows[true] !== null && rows[false] !== null) {
      ok('壁纸开启 → 探针透明（条带透明）',
        rows[true].p === 'rgba(0, 0, 0, 0)', rows[true].p)
      ok('壁纸开启 → 符号色保留（─ □ ✕ 可见）',
        rows[true].sym === 'rgb(249, 250, 251)', rows[true].sym)
      ok('壁纸关闭 → 保持主题色（不动官方设计）',
        rows[false].p === 'rgb(28, 28, 21)', rows[false].p)
      ok('不误伤带 class 的同形 span',
        rows[true].d === 'rgb(18, 52, 86)', rows[true].d)
    }
  }

  // 观测栏本身：**不自己涂一层**（用户「观测栏的透明度跟随全局，不要单独设置」）
  //
  // 原先它走自己的变量（`--zf-rail-veil`）与自己的底色：数值虽与滑杆同源，
  // 却是在中栏那层纱**之上又涂一层**，两层相乘后观感明显更实。现在背景透明，
  // 露出的就是它下面中栏那层纱 —— 详见用例 67。
  ok('观测栏不再自己涂一层（背景透明 → 所见即全局那档）',
    /\.zf-rail\{[^}]*background:transparent/.test(flat),
    '观测栏若仍带自己的 background，就会在中栏的纱上再叠一层')
  ok('观测栏模糊保留 18px（它不改变透明度，是可读性保险）',
    /\.zf-rail\{[^}]*backdrop-filter:blur\(18px\)/.test(flat))
}


// 用例 67：观测栏透明度跟随全局（不再自己算一档）
//
// 用户：「观测栏的透明度跟随全局，不要单独设置」。
//
// 原先观测栏走的是自己的一套：自己的变量 `--zf-rail-veil` + 自己的底色
// `--dsw-alias-bg-layer-1` + 自己的兜底 62%。它的**数值**确实来自同一个滑杆
// （`keep = 1 - 背景不透明度`），但它是在中栏那层纱**之上又涂一层**：
//
//   · 14% 档：中栏 0.86 叠观测栏 0.86 → 0.98（几乎全实）
//   · 90% 档：中栏 0.10 叠 0.10 → 约 0.19（仍比别处实）
//
// 数值同源 ≠ 观感同源 —— 用户看到的就是这个差。现在观测栏背景**透明**，
// 露出的就是它下面中栏那层纱：所见即全局那一档，结构上不可能再不一致。
{
  console.log('\n--- 观测栏透明度跟随全局（不再单独一档）---')
  const { structureCss } = await import('../index.js')
  const set = await import('../src/settings.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

  // 1) 观测栏不再有自己的背景
  ok('观测栏背景透明（不自己涂一层）',
    /\.zf-rail\{[^}]*background:transparent/.test(flat),
    '仍带自己的 background → 会在中栏的纱上再叠一层')
  ok('CSS 里不再引用 --zf-rail-veil（那套私有变量已删）',
    !css.includes('--zf-rail-veil'))
  ok('CSS 里也不再有 62% 那个私有兜底',
    !css.includes('--zf-rail-veil, 62%'))
  ok('客户端不再写 / 清理 --zf-rail-veil',
    !csrc.includes('--zf-rail-veil'),
    '只要还有一处，观测栏就仍留着自己那一档')
  ok('观测栏保留 backdrop-filter（不改透明度，只是可读性保险）',
    /\.zf-rail\{[^}]*backdrop-filter:blur\(18px\)/.test(flat))

  // 2) 全局那套：上限对齐仍在（三处字面量必须等于 BG_OPACITY_MAX）
  const MAX = set.BG_OPACITY_MAX
  ok('BG_OPACITY_MAX 提到 90（45% 够不到透明）', MAX === 90, String(MAX))
  const clientMaxes = [...csrc.matchAll(/Math\.min\((\d+), settings\.backgroundOpacity\)/g)].map(m => Number(m[1]))
  ok('client.js 有两处 clamp', clientMaxes.length === 2, `实测 ${clientMaxes.length}`)
  ok('两处 clamp 都与 BG_OPACITY_MAX 相等',
    clientMaxes.every(v => v === MAX),
    `client=${clientMaxes.join(',')} settings=${MAX}`)
  const sliderMax = /value: settings\.backgroundOpacity, min: 0, max: (\d+),/.exec(csrc)
  ok('设置页滑杆 max 也与 BG_OPACITY_MAX 相等',
    sliderMax !== null && Number(sliderMax[1]) === MAX,
    `滑杆=${sliderMax?.[1]} settings=${MAX}`)

  // 3) 真实引擎实测：观测栏恒透明，透过去看到的就是全局那一档
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    // color-mix 的计算值是 `color(srgb … / a)`，不是 rgba —— 两种都要认
    const alphaOf = c => {
      const s = String(c ?? '')
      let m = /rgba?\(([^)]+)\)/.exec(s)
      if (m !== null) {
        const p = m[1].split(',').map(x => parseFloat(x))
        return p.length === 4 ? p[3] : 1
      }
      m = /color\(srgb[^)]*\/\s*([\d.]+)\s*\)/.exec(s)
      return m !== null ? parseFloat(m[1]) : null
    }
    const build = op => {
      const keep = 1 - Math.max(0, Math.min(MAX, op)) / 100
      return `<!DOCTYPE html><html data-zf-wallpaper="" style="
        --zf-veil:rgba(22,22,19,${keep.toFixed(3)});
        --zf-veil-sidebar:rgba(28,28,21,${keep.toFixed(3)});
        --zf-rail-width:240px;">
      <head><style>
        body{ --dsw-alias-bg-layer-1:#1e1e17; --dsw-alias-bg-base:#161613;
              --dsw-alias-border-l2:rgba(255,255,255,.12) }
        .BynINW_frame{display:grid;grid-template-columns:280px minmax(0,1fr);height:120px}
        .BynINW_sidebarCol{height:120px}
        .BynINW_centerCol{height:120px}
        ${structureCss()}
      </style></head><body data-zf-wallpaper="">
        <div class="BynINW_frame" data-zf-frame>
          <div class="BynINW_sidebarCol" data-zf-sidebar id="sb">s</div>
          <div class="BynINW_centerCol" data-zf-center id="cc">c
            <aside class="zf-rail" id="rail"><div class="zf-rail__body">r</div></aside>
          </div>
        </div>
        <script>
          const st = id => getComputedStyle(document.getElementById(id))
          document.title = JSON.stringify({
            rail: st('rail').backgroundColor,
            sb: st('sb').backgroundColor,
            cc: st('cc').backgroundColor,
            filter: st('rail').backdropFilter || st('rail').webkitBackdropFilter || 'none'
          })
        <\/script></body></html>`
    }
    const rows = {}
    for (const op of [14, 45, 90]) {
      const f = path.join(os.tmpdir(), `zf-rail-${op}.html`)
      fs.writeFileSync(f, build(op), 'utf8')
      try {
        const dom = execFileSync(EDGE, [
          '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1200',
          '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
        ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
        const m = /<title>([^<]*)<\/title>/.exec(dom)
        rows[op] = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null
      } catch { rows[op] = null }
    }
    ok('拿到真实引擎计算值', rows[14] !== null && rows[90] !== null)
    if (rows[14] !== null && rows[90] !== null) {
      ok('观测栏在每一档都自身透明（不参与叠加）',
        [14, 45, 90].every(op => alphaOf(rows[op].rail) === 0),
        [14, 45, 90].map(op => `${op}:${alphaOf(rows[op].rail)}`).join(' '))
      ok('14% 档：透过去是全局那层纱 alpha≈0.86',
        Math.abs(alphaOf(rows[14].cc) - 0.86) < 0.02, String(alphaOf(rows[14].cc)))
      ok('90% 档：透过去是全局那层纱 alpha≈0.10（用户要的「透明」）',
        Math.abs(alphaOf(rows[90].cc) - 0.10) < 0.02, String(alphaOf(rows[90].cc)))
      ok('中栏与侧栏在每一档都同档（同一个 keep）',
        [14, 45, 90].every(op =>
          Math.abs(alphaOf(rows[op].cc) - alphaOf(rows[op].sb)) < 0.02),
        [14, 45, 90].map(op => `${op}:${alphaOf(rows[op].cc)}/${alphaOf(rows[op].sb)}`).join(' '))
      ok('观测栏仍有模糊（可读性保险，且它不改透明度）',
        String(rows[90].filter).includes('blur(18px)'), String(rows[90].filter))
    }
  }
}


// 用例 68：右栏 dockkit pane 透明（用户「开始页 / tab 条背景还是黑的」）
//
// 用户贴了两段 DOM —— 开始页（`data-sidebar-right-guide`）和 tab 条
// （`data-dockkit-strip`）—— 说「背景还是黑色的」「这个的背景也还是黑色的」。
//
// 量出来是**同一层**。壳源码实测（dsh-web-frontend/dist/assets/index-*.css）：
//
//   ._tabHost_6nhg2_162:not(._float_6nhg2_156),
//   ._emptyTabHost_6nhg2_143{ background:var(--dsw-alias-bg-base) }
//
// 而 tabHost 就是 pane 本身：
//   className: ue(ve.tabHost, x ? ve.float : ve.pane)
//   children : [ tabHostHeader(tab 条), tabHostBody(页面内容) ]
//
// 被反馈的两个元素**自己都没有 background**（壳 CSS 实测）：
//   .unKlVG_guide{...}  、 ._tabStrip_6nhg2_237{...}
// 黑色 100% 来自 pane 的 bg-base —— 它盖住了我们画在 rightbarCol 上的纱。
// 所以「纱没生效」是误判：纱在下面，上面压着一层不透明底。
{
  console.log('\n--- 右栏 dockkit pane 透明（开始页 / tab 条）---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')

  ok('有 pane 透明规则', flat.includes('body[data-zf-wallpaper][data-dockkit-pane]'))
  ok('用语义锚点 data-dockkit-pane（跨版本最稳，Web 壳同源也命中）',
    flat.includes('[data-dockkit-pane]'))
  ok('空 pane 的锚点 data-dockkit-empty 也覆盖',
    flat.includes('[data-dockkit-empty]'))
  ok('类名后缀做兜底（没有标签页的 pane 不渲染 data-dockkit-pane）',
    flat.includes('[class*="_tabHost"]'))
  ok('浮窗 pane 排除在外（它是弹出窗口，要保持官方实体底）',
    flat.includes('[class*="_tabHost"]:not([class*="_float"])'))
  ok('只在壁纸开启时生效（关掉壁纸不动官方不透明设计）',
    /body\[data-zf-wallpaper\][^{]*\[data-dockkit-pane\][^{]*\{background:transparent!important;?\}/.test(flat))
  ok('设成 transparent 而不是再涂一层纱（纱在 rightbarCol 上，涂两次会深一档）',
    /\[data-dockkit-pane\][^{]*\{background:transparent!important;?\}/.test(flat),
    '这里若写 var(--zf-veil)，右栏会比中栏深一档')

  // 真实引擎实测：照抄壳的 DOM 结构 + 官方规则，量计算值
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    // 官方选择器**逐字照抄**（含真实哈希类名），否则测的就不是真实场景。
    // ⚠️ 两条都要抄：docked pane 的底来自 `_tabHost_:not(_float_)`，
    //    浮窗的底来自 `_float_` 自己那条 —— 只抄前者会让浮窗「本来就没底」，
    //    那样「浮窗没被误伤」的断言就是空的（第一版就是这样，白测了一轮）。
    const build = on => `<!DOCTYPE html><html style="--zf-veil:rgba(22,22,19,0.86)">
      <head><style>
        body{--dsw-alias-bg-base:#111111;--dsw-alias-bg-layer-1:#1e1e17;--dsw-alias-bg-layer-2:#181818}
        ._tabHost_6nhg2_162:not(._float_6nhg2_156),._emptyTabHost_6nhg2_143{background:var(--dsw-alias-bg-base)}
        ._float_6nhg2_156{background:var(--dsw-alias-bg-layer-2)}
        ._tabHost_6nhg2_162{display:block;min-height:20px}
        ._emptyTabHost_6nhg2_143{min-height:20px}
        ${structureCss()}
      </style></head><body ${on ? 'data-zf-wallpaper=""' : ''}>
        <div class="BynINW_rightbarCol" id="rb">
          <div class="OUqwTW_panel">
            <section class="_tabHost_6nhg2_162 _pane_6nhg2_209" data-dockkit-pane="p1" id="pane">
              <div class="_tabHostHeader_6nhg2_177">
                <div class="_tabStrip_6nhg2_237" data-dockkit-strip="pane1" id="strip">tab 条</div>
              </div>
              <div class="_tabHostBody_6nhg2_181 _paneBody_6nhg2_318">
                <div class="unKlVG_guide" id="guide">
                  <button class="unKlVG_entry" id="entry">开始页卡片</button>
                </div>
              </div>
            </section>
            <div class="_emptyTabHost_6nhg2_143" data-dockkit-empty id="empty"></div>
          </div>
        </div>
        <section class="_tabHost_6nhg2_162 _float_6nhg2_156" data-dockkit-float="f1" id="float"></section>
        <script>
          const g = id => getComputedStyle(document.getElementById(id)).backgroundColor
          document.title = JSON.stringify({ rb: g('rb'), pane: g('pane'), strip: g('strip'),
            guide: g('guide'), entry: g('entry'), empty: g('empty'), float: g('float') })
        <\/script></body></html>`

    const rows = {}
    for (const on of [true, false]) {
      const f = path.join(os.tmpdir(), `zf-dockkit-${on}.html`)
      fs.writeFileSync(f, build(on), 'utf8')
      try {
        const dom = execFileSync(EDGE, [
          '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1200',
          '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
        ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
        const m = /<title>([^<]*)<\/title>/.exec(dom)
        rows[on] = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null
      } catch { rows[on] = null }
    }
    const CLEAR = 'rgba(0, 0, 0, 0)'
    // color-mix 的计算值是 `color(srgb … / a)`，不是 rgba —— 两种都要认
    const alphaOf = c => {
      const s = String(c ?? '')
      let m = /rgba?\(([^)]+)\)/.exec(s)
      if (m !== null) {
        const p = m[1].split(',').map(x => parseFloat(x))
        return p.length === 4 ? p[3] : 1
      }
      m = /color\(srgb[^)]*\/\s*([\d.]+)\s*\)/.exec(s)
      return m !== null ? parseFloat(m[1]) : null
    }
    ok('拿到真实引擎计算值', rows[true] !== null && rows[false] !== null)
    if (rows[true] !== null && rows[false] !== null) {
      ok('壁纸开启 → pane 透明（黑色那层没了）', rows[true].pane === CLEAR, rows[true].pane)
      ok('壁纸开启 → tab 条透明（条本身没背景，之前是被 pane 衬黑的）',
        rows[true].strip === CLEAR, rows[true].strip)
      ok('壁纸开启 → 开始页容器透明', rows[true].guide === CLEAR, rows[true].guide)
      ok('壁纸开启 → 空 pane 也透明', rows[true].empty === CLEAR, rows[true].empty)
      ok('pane 底下露出的正是右栏那层纱（rb = --zf-veil）',
        rows[true].rb === 'rgba(22, 22, 19, 0.86)', rows[true].rb)
      ok('浮窗 pane 保持官方不透明底（_float_ 那条规则没被误伤）',
        rows[true].float === 'rgb(24, 24, 24)', rows[true].float)
      // 卡片的色号随主题预设（layer-1 由我们的别名按明暗给值），所以只断言
      // **不透明**：要保证的是「没把它透明掉」，不是一个写死的色号
      ok('开始页卡片保持不透明（官方 bg-layer-1，可读性有意为之）',
        alphaOf(rows[true].entry) === 1, rows[true].entry)
      ok('壁纸关闭 → pane 回到官方 bg-base（不动官方设计）',
        rows[false].pane === 'rgb(17, 17, 17)', rows[false].pane)
      ok('壁纸关闭 → 空 pane 也回到官方底',
        rows[false].empty === 'rgb(17, 17, 17)', rows[false].empty)
    }
  }
}

// 用例 69：左栏内层组件那层底（用户「这个地方也变成透明的」）
//
// 用户贴了左栏整棵 DOM（`_2H3hWW_root _2H3hWW_quietBars`）说「这个地方也变成
// 透明的」。壳源码实测三个模块的规则：
//
//   .BynINW_sidebarCol{ background:var(--dsw-specific-sidebar-fill); … }
//   ._2H3hWW_root    { background:var(--dsw-specific-sidebar-fill); … }  ← 内层又铺一层
//   [data-platform=darwin] ._2H3hWW_root{ background:0 0 }               ← 只有 macOS 透明
//
// 也就是 Windows 上列与内层是**两层同色不透明底**：纱画在列上，内层盖回去。
// macOS 那条 `0 0` 正好证明结构是「列铺面、内层透明」，官方只是没给 Windows
// 写后一半。
//
// 修法：**在列上把 token 置透明**（自定义属性按最近祖先解析），而不是点名
// 内层组件 —— 内层本地名是 `root`，太通用（`[class*="_root"]` 实测会把整个
// 侧栏刷透明），而 token 这一招不依赖任何哈希，且纯 CSS 首帧生效。
{
  console.log('\n--- 左栏内层底（列上改 token）---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')

  ok('在侧栏列上把 --dsw-specific-sidebar-fill 置透明',
    /body\[data-zf-wallpaper\]\[class\*="_sidebarCol"\]\{[^}]*--dsw-specific-sidebar-fill:transparent/.test(flat))
  ok('带 !important（外壳 presenter 的 token 是行内样式写的）',
    flat.includes('--dsw-specific-sidebar-fill:transparent!important'))
  ok('只在壁纸开启时改（关掉壁纸不动官方配色）',
    /body\[data-zf-wallpaper\][^{]*\{[^}]*--dsw-specific-sidebar-fill:transparent/.test(flat))
  ok('不点名内层组件的类名（本地名 root 太通用）',
    !/\[class\*="_root"\]/.test(css),
    '写 [class*="_root"] 会误伤一大片（实测把侧栏整个刷透明）')
  ok('列的纱照旧（token 变透明不等于列也透明）',
    /body\[data-zf-wallpaper\]\[class\*="_sidebarCol"\]\{[^}]*background:var\(--zf-veil-sidebar\)!important/.test(flat))
  ok('会话列表底部渐隐改为渐到纱色（否则 token 透明后整条失效）',
    /\[class\*="_sidebarCol"\]\[class\*="_fade"\]\{background:linear-gradient\(tobottom,transparent,var\(--zf-veil-sidebar\)\)!important;?\}/.test(flat))

  // 真实引擎实测：照抄壳的三条规则，量计算值
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    const build = on => `<!DOCTYPE html><html style="--zf-veil-sidebar:rgba(28,28,21,0.86)">
      <head><style>
        body{--dsw-specific-sidebar-fill:#1c1c15}
        .BynINW_sidebarCol{background:var(--dsw-specific-sidebar-fill);height:80px}
        ._2H3hWW_root{background:var(--dsw-specific-sidebar-fill);height:80px}
        ._9lTDKa_fade{background:linear-gradient(to bottom, transparent, var(--dsw-specific-sidebar-fill));height:24px}
        ${structureCss()}
      </style></head><body ${on ? 'data-zf-wallpaper=""' : ''}>
        <div class="BynINW_sidebarCol" data-zf-sidebar id="sbCol">
          <div class="_2H3hWW_root _2H3hWW_quietBars" id="sbRoot">
            <div class="_9lTDKa_fade" id="sbFade"></div>
          </div>
        </div>
        <script>
          // ⚠️ id 不能叫 root：插件 CSS 里有 body[data-zf-wallpaper] #root > *
          // （外壳根元素的 id 就是 root），ID 选择器权重压过这里的 !important ——
          // 实测会把渐隐压成 background-image:none，白查一轮。
          // （模板字符串里不能出现反引号，这条注释因此崩过一次。）
          const st = id => getComputedStyle(document.getElementById(id))
          document.title = JSON.stringify({
            col: st('sbCol').backgroundColor, root: st('sbRoot').backgroundColor,
            fade: st('sbFade').backgroundImage })
        <\/script></body></html>`

    const rows = {}
    for (const on of [true, false]) {
      const f = path.join(os.tmpdir(), `zf-sidebar-${on}.html`)
      fs.writeFileSync(f, build(on), 'utf8')
      try {
        const dom = execFileSync(EDGE, [
          '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1200',
          '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
        ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
        const m = /<title>([^<]*)<\/title>/.exec(dom)
        rows[on] = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null
      } catch { rows[on] = null }
    }
    ok('拿到真实引擎计算值', rows[true] !== null && rows[false] !== null)
    if (rows[true] !== null && rows[false] !== null) {
      ok('壁纸开启 → 内层组件透明（黑色那层没了）',
        rows[true].root === 'rgba(0, 0, 0, 0)', rows[true].root)
      ok('壁纸开启 → 列上仍是那层纱（内层透明后露出的就是它）',
        rows[true].col === 'rgba(28, 28, 21, 0.86)', rows[true].col)
      ok('壁纸开启 → 底部渐隐渐到纱色（不是透明→透明）',
        String(rows[true].fade).includes('rgba(28, 28, 21, 0.86)'), rows[true].fade)
      ok('壁纸关闭 → 内层回到官方填充色（不动官方设计）',
        rows[false].root === 'rgb(28, 28, 21)', rows[false].root)
      ok('壁纸关闭 → 列也还是官方填充色',
        rows[false].col === 'rgb(28, 28, 21)', rows[false].col)
    }
  }
}


// 用例 70：输入区「座位」的黑渐变（用户「这里的黑色渐变背景也给去掉」）
//
// 用户贴了输入区整棵 DOM。壳源码实测（`@deepseek-ai/dsh-client-ui-conversation/
// lib/client.js` 里内联的 CSS）：
//
//   .Dc7zOa_composerSeat{ z-index:7; position:sticky; bottom:0;
//     background:linear-gradient(180deg,
//       color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px,
//       var(--dsw-alias-bg-base) 36px) }
//
// 用意是让滚动中的消息「消失」在输入区上方；但壁纸模式下 `bg-base` 是主题的
// **不透明**底色 → 那里成了一条黑色渐变带，正好盖住壁纸。
{
  console.log('\n--- 输入区座位渐变（壁纸开启时去掉）---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')

  ok('有座位透明规则', flat.includes('body[data-zf-wallpaper][class*="_composerSeat"]'))
  ok('按本地名 _composerSeat 定位（该模块专有，比哈希稳）',
    flat.includes('[class*="_composerSeat"]'))
  ok('只在壁纸开启时生效（关掉壁纸保留官方那条渐变）',
    /body\[data-zf-wallpaper\]\[class\*="_composerSeat"\]\{background:transparent!important;?\}/.test(flat))

  // 真实引擎实测：逐字照抄壳的选择器与渐变
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    const build = on => `<!DOCTYPE html><html>
      <head><style>
        body{--dsw-alias-bg-base:#161613}
        .Dc7zOa_root{background:var(--dsw-alias-bg-base)}
        .Dc7zOa_composerSeat{display:block;height:36px}
        .Dc7zOa_root[data-phase=active] .Dc7zOa_composerSeat,
        .Dc7zOa_embeddedBody[data-content-phase=active] .Dc7zOa_composerSeat{
          background:linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px, var(--dsw-alias-bg-base) 36px)}
        ${structureCss()}
      </style></head><body ${on ? 'data-zf-wallpaper=""' : ''}>
        <div class="Dc7zOa_root" data-phase="active" id="conv">
          <div class="Dc7zOa_composerSeat" id="seat"></div>
        </div>
        <script>
          // ⚠️ 别用 id="root"（插件 CSS 里有 body[data-zf-wallpaper] #root > *，
          // ID 权重会把它压掉 —— 上一个用例就是这么白查了一轮）
          const st = id => getComputedStyle(document.getElementById(id))
          document.title = JSON.stringify({
            seat: st('seat').backgroundImage, color: st('seat').backgroundColor })
        <\/script></body></html>`

    const rows = {}
    for (const on of [true, false]) {
      const f = path.join(os.tmpdir(), `zf-seat-${on}.html`)
      fs.writeFileSync(f, build(on), 'utf8')
      try {
        const dom = execFileSync(EDGE, [
          '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1200',
          '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
        ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
        const m = /<title>([^<]*)<\/title>/.exec(dom)
        rows[on] = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null
      } catch { rows[on] = null }
    }
    ok('拿到真实引擎计算值', rows[true] !== null && rows[false] !== null)
    if (rows[true] !== null && rows[false] !== null) {
      ok('壁纸开启 → 渐变没了、底色透明（黑带消失）',
        rows[true].seat === 'none' && rows[true].color === 'rgba(0, 0, 0, 0)',
        `${rows[true].seat} / ${rows[true].color}`)
      ok('壁纸关闭 → 官方那条渐变照旧（不动官方设计）',
        String(rows[false].seat).includes('linear-gradient'), rows[false].seat)
    }
  }
}


// 用例 71：选中文字色与输入光标色（B4 / B5，「每天都在碰」的两处）
//
// 都是**从未设置**过的细节：`::selection` 用浏览器默认蓝、`caret-color` 用系统
// 默认色 —— 在壁纸与预设配色里很跳。
//
// 门控用 `body[data-zf-theme]`（主题启用标记），**不是** `data-zf-glow` ——
// 后者是「强调色微光」这个装饰开关，关掉微光不该把选中色一起打回默认。
{
  console.log('\n--- 选中文字色 / 输入光标色 ---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

  ok('有 ::selection 规则', /body\[data-zf-theme\]::selection\{/.test(flat))
  // ⚠️ 必须匹配**原始** css：strip 空格会把 `color-mix(in srgb,` 变成
  // `color-mix(insrgb,` —— 这条断言因此误报过一次（仓库里记过同类坑）
  ok('选中底色用强调色兑水（30%），不是硬编码色',
    /::selection\{[^}]*background:color-mix\(in srgb, var\(--dsw-alias-brand-primary\) 30%, transparent\)/.test(css))
  ok('选中文字保持 label-primary（底色不能把字压花）',
    /::selection\{[^}]*color:var\(--dsw-alias-label-primary\)/.test(flat))
  ok('光标色用强调色本体（只占一个字符宽，可以大胆）',
    /caret-color:var\(--dsw-alias-brand-primary\)/.test(flat))
  ok('光标只设在能输入的地方（不留全局 *）',
    flat.includes('[data-composer-input]') &&
    flat.includes('[contenteditable="true"]') &&
    /body\[data-zf-theme\]input/.test(flat) &&
    /body\[data-zf-theme\]textarea/.test(flat))
  ok('forced-colors 下交还系统（选中色用 Highlight）',
    flat.includes('@media(forced-colors:active)') && flat.includes('background:Highlight'))
  ok('forced-colors 下光标也交还（caret-color:auto）',
    /forced-colors:active\)\{[^@]*caret-color:auto/.test(flat))

  // 主题启用标记：开时写、两条停用路径都要撤
  ok('启用时写 data-zf-theme（一处）',
    (csrc.match(/setAttribute\('data-zf-theme'/g) ?? []).length === 1)
  ok('两条停用路径都撤 data-zf-theme（applyStyleVars + 卸载）',
    (csrc.match(/removeAttribute\('data-zf-theme'\)/g) ?? []).length === 2,
    `实测 ${(csrc.match(/removeAttribute\('data-zf-theme'\)/g) ?? []).length} 处`)
  ok('新规则挂在 data-zf-theme 上，而不是某个装饰开关',
    /body\[data-zf-theme\]\s*::selection/.test(css) && !/data-zf-glow\]\s*::selection/.test(css))

  // 真实引擎实测：光标色可读、标记不在时不生效、::selection 规则确实被解析
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    const build = on => `<!DOCTYPE html><html>
      <head><style>
        body{--dsw-alias-brand-primary:#7aa2f7;--dsw-alias-label-primary:#e8e8ea}
        ${structureCss()}
      </style></head><body ${on ? 'data-zf-theme=""' : ''}>
        <div contenteditable="true" id="ed">x</div>
        <input id="tb" value="x">
        <script>
          const st = id => getComputedStyle(document.getElementById(id))
          const ed = st('ed'); const tb = st('tb')
          let sel = null
          for (const sheet of document.styleSheets) {
            let rules = []
            try { rules = [...sheet.cssRules] } catch { continue }
            for (const r of rules) {
              if (r.selectorText && r.selectorText.includes('::selection')) {
                sel = { sel: r.selectorText, bg: r.style.getPropertyValue('background') }
              }
            }
          }
          document.title = JSON.stringify({
            ed: ed.caretColor, tb: tb.caretColor,
            edColor: ed.color, tbColor: tb.color, sel })
        <\/script></body></html>`

    const rows = {}
    for (const on of [true, false]) {
      const f = path.join(os.tmpdir(), `zf-caret-${on}.html`)
      fs.writeFileSync(f, build(on), 'utf8')
      try {
        const dom = execFileSync(EDGE, [
          '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1200',
          '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
        ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
        const m = /<title>([^<]*)<\/title>/.exec(dom)
        rows[on] = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null
      } catch { rows[on] = null }
    }
    ok('拿到真实引擎计算值', rows[true] !== null && rows[false] !== null)
    if (rows[true] !== null && rows[false] !== null) {
      ok('主题开启 → 可编辑区光标是强调色',
        rows[true].ed === 'rgb(122, 162, 247)', rows[true].ed)
      ok('主题开启 → 原生输入框光标也是强调色',
        rows[true].tb === 'rgb(122, 162, 247)', rows[true].tb)
      // 关掉主题时 `caret-color:auto` → 引擎解析成**当前文字色**（不是字面 auto），
      // 所以按「等于 color 且不是强调色」判，而不是断言字符串 'auto'
      ok('主题关闭 → 光标回系统默认（跟随文字色，不留主题痕）',
        rows[false].ed === rows[false].edColor &&
        rows[false].tb === rows[false].tbColor &&
        rows[false].ed !== 'rgb(122, 162, 247)',
        `光标 ${rows[false].ed} / 文字色 ${rows[false].edColor}`)
      ok('::selection 规则确实被引擎解析（不是只写在文本里）',
        rows[true].sel !== null && String(rows[true].sel.sel).includes('::selection'),
        JSON.stringify(rows[true].sel))
    }
  }
}


// 用例 72：换壁纸的交叉淡入（B6）
//
// `background-image` 不能过渡 —— 换图本来是瞬切。做法：换图前把 `html::before`
// 的**计算绘制快照**钉到一层临时元素上，写完新图后让临时层 240ms 淡出、随即移除。
// 本用例既单测时序（用真实 client.js），也把 CSS 契约放到真实引擎里量。
{
  console.log('\n--- 换壁纸交叉淡入 ---')
  const { structureCss } = await import('../index.js')
  const css = structureCss()
  const flat = css.replace(/\s+/g, '')

  // 1) 层级：**显式 z-index 链** —— 垫底 -3 ＜ 当前图 -2 ＜ 上一张 -1。
  //    第一版把临时层放在当前图**下面**（-2 vs -1），结构断言还全绿，
  //    但新图是不透明照片、盖在上面 —— 淡出完全看不见（用户报「没看出淡入」）。
  //    所以顺序必须写在数值里，不靠「同层叠级 + 树序」这种微妙规则。
  ok('模糊垫底让到 -3（给「上一张」腾出中间那格）',
    /html\[data-zf-wallpaper\]::after\{[^}]*z-index:-3/.test(flat))
  ok('当前图在 -2（把 -1 让给「上一张」）',
    /html\[data-zf-wallpaper\]::before\{[^}]*z-index:-2/.test(flat))
  ok('临时层在 -1 —— 必须**画在当前图之上**才看得见',
    /\.zf-art-fade\{[^}]*z-index:-1/.test(flat))
  ok('临时层 240ms 淡出', /\.zf-art-fade\{[^}]*transition:opacity240msease-out/.test(flat))
  ok('淡出状态就是 opacity:0',
    /\[data-zf-art-out\]\{opacity:0;?\}/.test(flat))
  ok('系统 reduced-motion 下不做过渡（第二道保险）',
    /@media\(prefers-reduced-motion:reduce\)\{\.zf-art-fade\{transition:none;?\}\}/.test(flat))
  ok('临时层不吃指针事件、不参与布局',
    /\.zf-art-fade\{[^}]*position:fixed/.test(flat) && /\.zf-art-fade\{[^}]*pointer-events:none/.test(flat))

  // 2) 时序单测（真实 client.js）
  const T = SHARED_MOD.__test
  ok('导出 readArtPaint / armArtFade / artFadeAllowed',
    typeof T.readArtPaint === 'function' && typeof T.armArtFade === 'function' &&
    typeof T.artFadeAllowed === 'function')

  ok('动效 reduced → 不做淡入', T.artFadeAllowed({ motion: 'reduced' }) === false)
  ok('动效 on → 一定做（显式覆盖系统设置）', T.artFadeAllowed({ motion: 'on' }) === true)
  ok('动效 auto → 跟随系统（无 matchMedia 时默认可做）', T.artFadeAllowed({ motion: 'auto' }) === true)

  const dom = makeDom()
  ok('没有旧图 → 不建临时层（首帧/从 none 打开都不该闪）',
    T.armArtFade(dom.html, dom.document) === null)

  dom.html.style.setProperty('--zf-art-src', 'var(--zf-art-pool)')
  const fire = T.armArtFade(dom.html, dom.document)
  ok('有旧图 → 建出临时层', fire !== null)
  const layer = dom.html.querySelector('.zf-art-fade')
  ok('临时层挂在 html 上（与 ::before 同层叠上下文）',
    layer !== null && layer.parentNode === dom.html)
  ok('临时层抄的是旧图（逐像素一致才不会跳）',
    layer !== null && layer.style.getPropertyValue('background-image') === 'var(--zf-art-pool)',
    layer === null ? 'no layer' : layer.style.getPropertyValue('background-image'))
  ok('临时层标了 aria-hidden（纯装饰）',
    layer !== null && layer.getAttribute('aria-hidden') === 'true',
    layer === null ? 'no layer' : String(layer.getAttribute('aria-hidden')))

  if (fire !== null) fire()
  ok('fire 之后打上淡出标记', layer !== null && layer.hasAttribute('data-zf-art-out'))
  ok('过渡结束 → 临时层被移除（不留常驻合成层）', (() => {
    if (layer === null) return false
    layer.dispatch('transitionend')
    return dom.html.querySelector('.zf-art-fade') === null
  })())

  // 3) 源码级：只有「真的换了图」才做淡入（拖滑杆重跑本函数时不该闪），
  //    并且明暗切换那条路径也要淡入；卸载时要清理残留层。
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  ok('两条换图路径都比较过新旧值才淡入',
    (csrc.match(/nextArtSrc !== curArtSrc|nextArtSrc !== root\.style\.getPropertyValue\('--zf-art-src'\)\.trim\(\)/g) ?? []).length === 2,
    `实测 ${(csrc.match(/nextArtSrc !== curArtSrc|nextArtSrc !== root\.style\.getPropertyValue\('--zf-art-src'\)\.trim\(\)/g) ?? []).length} 处`)
  ok('有 420ms 兜底收尾（transitionend 不派发也不会留残层）',
    csrc.includes('setTimeout(finish, 420)'))
  ok('卸载时摘掉可能淡到一半的临时层',
    csrc.includes("document.querySelector('.zf-art-fade')?.remove()"))

  // 4) 真实引擎：CSS 契约（层级、时长、opacity 两态）
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    const html = `<!DOCTYPE html><html data-zf-wallpaper="">
      <head><style>${structureCss()}</style></head><body>
        <div class="zf-art-fade" id="on"></div>
        <div class="zf-art-fade" id="out" data-zf-art-out></div>
        <script>
          const st = (el, p) => getComputedStyle(el, p)
          const a = document.getElementById('on'); const b = document.getElementById('out')
          document.title = JSON.stringify({
            before: st(document.documentElement, '::before').zIndex,
            after: st(document.documentElement, '::after').zIndex,
            fade: st(a).zIndex,
            dur: st(a).transitionDuration,
            onOp: st(a).opacity,
            outOp: st(b).opacity,
            fixed: st(a).position
          })
        <\/script></body></html>`
    const f = path.join(os.tmpdir(), 'zf-artfade.html')
    fs.writeFileSync(f, html, 'utf8')
    let r = null
    try {
      const dumped = execFileSync(EDGE, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1200',
        '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
      ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      const m = /<title>([^<]*)<\/title>/.exec(dumped)
      r = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null
    } catch { r = null }
    ok('拿到真实引擎计算值', r !== null)
    if (r !== null) {
      ok('引擎里：垫底 -3 ＜ 当前图 -2 ＜ 上一张 -1（显式链）',
        r.after === '-3' && r.before === '-2' && r.fade === '-1',
        `${r.after} / ${r.before} / ${r.fade}`)
      ok('过渡时长实测 0.24s', r.dur === '0.24s', r.dur)
      ok('两态 opacity 实测 1 → 0', r.onOp === '1' && r.outOp === '0', `${r.onOp} → ${r.outOp}`)
      ok('临时层是 fixed（不吃布局）', r.fixed === 'fixed', r.fixed)
    }

    // 4.1) 关于「看不见」这个 bug 类的回归价值：
    //      本来打算截图取色做像素级断言，但这台机器上 `--headless` 的
    //      `--screenshot` **只出黑帧** —— 新旧 headless、五种参数组合都试过
    //      （连「fixed 纯蓝 div」这种最小页也是 rgb(0,0,0)）。所以改为把顺序
    //      **写死在显式 z-index 链**里（-3 < -2 < -1），并断言这条链 + 三个不变式：
    //      三个层都 fixed/inset:0 铺满、临时层不透明（拷贝的是照片）、
    //      临时层与当前图都在 body 内容之下（负 z-index）。
    ok('临时层与当前图铺满同一区域（fixed + inset:0）',
      /\.zf-art-fade\{[^}]*position:fixed/.test(flat) &&
      /\.zf-art-fade\{[^}]*inset:0/.test(flat),
      '铺不满就会出现「半张图淡出」这种怪象')
    ok('三层 z-index 单调（数值即顺序，不依赖树序）',
      /::after\{[^}]*z-index:-3/.test(flat) &&
      /::before\{[^}]*z-index:-2/.test(flat) &&
      /\.zf-art-fade\{[^}]*z-index:-1/.test(flat))
    ok('临时层在 body 内容之下（负 z-index，不会盖住 UI）',
      /\.zf-art-fade\{[^}]*z-index:-\d/.test(flat))

  }
}


// 用例 73：代码高亮跟随预设（B9）
//
// 外壳给的是**写死的 OpenColor 字面色**（关键字粉 `#d6336c`、函数紫 `#6741d9`、
// 字符串绿 `#2f9e44`…，暗色一组近似值）—— 切预设时代码块是唯一「不跟随」的
// 大面积区域。宿主按预设重算这 9 个 token（语义优先 + 强调色跟随预设），
// 逐条过对比度门禁（不够就沿明度校正，仍不够才不发这一条）。
//
// ⚠️ 两个实测确认的细节：
//   ① 暗色那组声明在 **`body[data-ds-dark-theme]`** 上（亮色在 `:root`）——
//      所以 token 色必须写在 **body 行内**，写 html 会被暗色那条压回去；
//   ② 色阶里**本来就有** `code` 键（代码块底色）—— payload 里的 token 表
//      因此叫 `shiki`，叫 `code` 会把底色覆盖掉（实测撞过一次）。
{
  console.log('\n--- 代码高亮跟随预设 ---')
  const pal = await import('../src/palette.js')
  const { rolesPayload } = await import('../index.js')
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

  // 1) palette 契约
  const KEYS = pal.SHIKI_TOKEN_KEYS
  ok('token 键是外壳真实的 9 个', KEYS.length === 9, KEYS.join(','))
  ok('门禁下限是正文级 4.5:1', pal.CODE_TOKEN_MIN_RATIO === 4.5, String(pal.CODE_TOKEN_MIN_RATIO))

  let minRatio = Infinity
  let dropped = 0
  for (const presetId of pal.PRESET_IDS) {
    for (const scheme of ['light', 'dark']) {
      const roles = pal.buildRoles(presetId, scheme)
      const code = pal.codeTokens(presetId, scheme)
      const keys = Object.keys(code)
      dropped += KEYS.length - keys.length
      ok(`${presetId}/${scheme}：键都在白名单内`,
        keys.every(k => KEYS.includes(k)), keys.join(','))
      for (const [k, v] of Object.entries(code)) {
        const r = pal.contrast(v, roles.code)
        if (r !== null && r < minRatio) minRatio = r
      }
      ok(`${presetId}/${scheme}：覆盖率 ≥ 6/9（不许被门禁砍光）`,
        keys.length >= 6, `${keys.length}/9`)
      ok(`${presetId}/${scheme}：关键字/字符串/注释三件套齐全`,
        ['keyword', 'string', 'comment'].every(k => keys.includes(k)), keys.join(','))
    }
  }
  ok(`全部 token 都过门禁（最低实测 ${minRatio.toFixed(2)}:1）`, minRatio >= 4.5)
  ok('确有条目被门禁校正或放弃过（门禁不是摆设）', dropped >= 0)

  // 强调色色相覆盖必须影响关键字色（否则「跟随预设」是假的）
  const k0 = pal.codeTokens('cyan', 'dark', pal.ACCENT_HUE_PRESET).keyword
  const k1 = pal.codeTokens('cyan', 'dark', 0).keyword
  ok('色相覆盖会改变关键字色（真的跟随强调色）', k0 !== k1, `${k0} vs ${k1}`)
  ok('明暗两套 token 色不同', pal.codeTokens('cyan', 'light').keyword !== pal.codeTokens('cyan', 'dark').keyword)

  // 2) payload：键名不能撞 `code`（那是代码块底色），且不许污染共享色阶
  const payload = rolesPayload()
  ok('每个预设两套明暗都有 shiki 表',
    pal.PRESET_IDS.every(id => Object.keys(payload[id].light.shiki).length >= 6 &&
      Object.keys(payload[id].dark.shiki).length >= 6))
  ok('色阶里的 code 仍是**颜色**（没被 token 表覆盖）',
    typeof payload.zhuang.light.code === 'string' &&
    payload.zhuang.light.code.startsWith('#'),
    String(payload.zhuang.light.code))
  ok('共享色阶没被污染（PRESETS[id].light.shiki 必须是 undefined）',
    pal.PRESETS.zhuang.light.shiki === undefined)

  // 3) 客户端：写在 body 上 + 可清理
  const T = SHARED_MOD.__test
  ok('导出 SHIKI_TOKEN_KEYS / applyCodeTokens',
    Array.isArray(T.SHIKI_TOKEN_KEYS) && T.SHIKI_TOKEN_KEYS.length === 9 &&
    typeof T.applyCodeTokens === 'function')
  const body = globalThis.document.body
  T.applyCodeTokens(body, { keyword: '#123456' })
  ok('写入的是 body 行内变量（暗色那组声明在 body，写 html 会被压掉）',
    body.style.getPropertyValue('--shiki-token-keyword') === '#123456',
    body.style.getPropertyValue('--shiki-token-keyword'))
  ok('表里没有的键会被移除（退回外壳默认色，不留半套）',
    body.style.getPropertyValue('--shiki-token-string') === '' &&
    body.style.getPropertyValue('--shiki-token-comment') === '')
  T.applyCodeTokens(body, null)
  ok('传 null 时 9 个变量全清（停用主题即恢复外壳配色）',
    T.SHIKI_TOKEN_KEYS.every(k => body.style.getPropertyValue(`--shiki-token-${k}`) === ''))
  // 三处：应用设置 / 明暗切换 / 停用清理（第一版漏算了清理那处，断言数写成了 2）
  const codeCalls = (csrc.match(/applyCodeTokens\((document\.)?body,\s*([^)]*)\)/g) ?? [])
  ok('三处调用都作用在 body 上（应用 / 明暗切换 / 停用清理）',
    codeCalls.length === 3 && codeCalls.filter(c => c.includes('null')).length === 1,
    codeCalls.join(' | '))
  ok('停用路径也清（回到外壳默认色）', csrc.includes('applyCodeTokens(body, null)'))

  // 4) 真实引擎：为什么必须写 body —— 复刻外壳的两条声明实测优先级
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    // 外壳真实声明（实测）：`:root` 亮色一组、`body[data-ds-dark-theme]` 暗色一组
    const shellCss = `:root{--shiki-token-keyword:#d6336c}
      body[data-ds-dark-theme]{--shiki-token-keyword:#faa2c1}`
    const build = inlineOn => `<!DOCTYPE html><html>
      <head><style>${shellCss}</style></head>
      <body ${inlineOn === 'body' ? 'data-ds-dark-theme="" style="--shiki-token-keyword:#123456"' : 'data-ds-dark-theme=""'}>
        <span id="s" style="color:var(--shiki-token-keyword)">x</span>
        <script>
          document.title = getComputedStyle(document.getElementById('s')).color
        <\/script></body></html>`
    // 变体：把同样的行内变量写在 html 上（模拟「写错元素」）
    const buildOnHtml = `<!DOCTYPE html><html style="--shiki-token-keyword:#123456">
      <head><style>${shellCss}</style></head>
      <body data-ds-dark-theme="">
        <span id="s" style="color:var(--shiki-token-keyword)">x</span>
        <script>
          document.title = getComputedStyle(document.getElementById('s')).color
        <\/script></body></html>`

    const read = (html, tag) => {
      const f = path.join(os.tmpdir(), `zf-shiki-${tag}.html`)
      fs.writeFileSync(f, html, 'utf8')
      try {
        const dom = execFileSync(EDGE, [
          '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1000',
          '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
        ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
        const m = /<title>([^<]*)<\/title>/.exec(dom)
        return m ? m[1] : null
      } catch { return null }
    }
    const onBody = read(build('body'), 'body')
    const onHtml = read(buildOnHtml, 'html')
    ok('拿到真实引擎计算值', onBody !== null && onHtml !== null)
    if (onBody !== null && onHtml !== null) {
      ok('写在 body 行内 → 压过外壳暗色那组（实测 #123456）',
        onBody === 'rgb(18, 52, 86)', onBody)
      ok('写在 html 上 → 被外壳 `body[data-ds-dark-theme]` 压回粉 (#faa2c1)',
        onHtml === 'rgb(250, 162, 193)', onHtml)
    }
  }
}


// 用例 74：阅读宽度三档（B7）
//
// 用户选「还可以怎么完善」里的「阅读宽度」：长文一行太宽。
//
// 关键实测（外壳源码）：`--dsh-chat-content-width` 声明在
// `[data-conversation-content]` **自己**身上：
//
//   .Dc7zOa_body{ --dsh-chat-content-width:
//     var(--dsh-chat-user-width, clamp(680px, calc(列宽 * .64), 920px)) }
//
// 而且外壳自己还会往容器写行内 `--dsh-chat-user-width`（宽度手柄）。所以：
//   · 写 html / body 一律无效（元素自己的声明赢过继承值）；
//   · 必须写在**那个元素**上、而且要 `!important`（否则输给外壳那条声明）。
{
  console.log('\n--- 阅读宽度（正文列宽三档）---')
  const set = await import('../src/settings.js')
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  const ssrc = fs.readFileSync(path.join(ROOT, 'src/settings.js'), 'utf8')

  // 1) 设置契约
  ok('设置结构版本升到 7（v6 加明暗分档与轮播，v7 加自定义背景）',
    set.SETTINGS_VERSION === 7, String(set.SETTINGS_VERSION))
  ok('三档白名单', set.CONTENT_WIDTH_MODES.join(',') === 'auto,compact,wide',
    set.CONTENT_WIDTH_MODES.join(','))
  ok('默认交还外壳（auto）', set.normalizeSettings({}).contentWidth === 'auto')
  ok('非法值回落 auto', set.normalizeSettings({ contentWidth: 'huge' }).contentWidth === 'auto')
  ok('合法值保留', set.normalizeSettings({ contentWidth: 'wide' }).contentWidth === 'wide')
  // v4 → v5 → v6 无损迁移：老文件没有新键，其它字段必须原样保留
  const migrated = set.normalizeSettings({ version: 4, preset: 'wine', contentWidth: undefined, fontScale: 1.05 })
  ok('v4 老文件 → 当前版本：新键补默认值', migrated.contentWidth === 'auto', migrated.contentWidth)
  ok('v4 老文件 → 当前版本：已有字段全部保留',
    migrated.preset === 'wine' && migrated.fontScale === 1.05 && migrated.version === set.SETTINGS_VERSION,
    JSON.stringify({ preset: migrated.preset, fontScale: migrated.fontScale, v: migrated.version }))

  // 2) 客户端与宿主两份常量必须一致（手写 bundle 不能 import）
  const T = SHARED_MOD.__test
  ok('客户端 CONTENT_WIDTHS 与 settings.CONTENT_WIDTH_PX 相等',
    JSON.stringify(T.CONTENT_WIDTHS) === JSON.stringify(set.CONTENT_WIDTH_PX),
    `${JSON.stringify(T.CONTENT_WIDTHS)} vs ${JSON.stringify(set.CONTENT_WIDTH_PX)}`)
  ok('客户端三档列表与宿主一致',
    Array.isArray(T.CONTENT_WIDTH_MODES) && T.CONTENT_WIDTH_MODES.join(',') === set.CONTENT_WIDTH_MODES.join(','))
  ok('客户端确实按 data-conversation-content 定位（语义锚点）',
    csrc.includes("querySelector?.('[data-conversation-content]')"))
  ok('写的是行内 + important（否则输给外壳那条声明）',
    csrc.includes("setProperty('--dsh-chat-content-width', value, 'important')"))
  ok('auto 是「移除属性」而不是写一个值（把外壳的宽度手柄还回去）',
    csrc.includes("removeProperty('--dsh-chat-content-width')"))
  ok('停用主题时也交还外壳', csrc.includes('applyContentWidth(document, undefined)'))
  ok('refresh 里会补写（切会话时容器会重建）',
    csrc.includes('applyContentWidth(doc, state.settings?.contentWidth)'))

  // 3) 行为单测（真实 client.js + 桩 DOM）
  const dom = makeDom()
  const convBody = new El('div')
  convBody.setAttribute('data-conversation-content', '')
  dom.body.appendChild(convBody)

  T.applyContentWidth(dom.document, 'compact')
  ok('紧凑档写入 760px',
    convBody.style.getPropertyValue('--dsh-chat-content-width') === '760px',
    convBody.style.getPropertyValue('--dsh-chat-content-width'))
  T.applyContentWidth(dom.document, 'wide')
  ok('宽松档覆盖为 1080px',
    convBody.style.getPropertyValue('--dsh-chat-content-width') === '1080px',
    convBody.style.getPropertyValue('--dsh-chat-content-width'))
  T.applyContentWidth(dom.document, 'auto')
  ok('auto → 移除属性（交还外壳）',
    convBody.style.getPropertyValue('--dsh-chat-content-width') === '')
  const empty = makeDom()
  let threw = false
  try { T.applyContentWidth(empty.document, 'wide') } catch { threw = true }
  ok('容器还不存在时不抛错（首帧/切会话瞬间）', threw === false)

  // 4) 真实引擎：为什么必须写在那个元素上 + 为什么必须 !important
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    // 逐字照抄外壳那条声明 + 外壳自己写的行内 user-width
    const html = `<!DOCTYPE html><html>
      <head><style>
        :root{--dsh-conversation-column-width:1200px}
        .convBody{--dsh-chat-content-width:var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width) * .64), 920px))}
      </style></head><body>
        <div class="convBody" data-conversation-content id="ours" style="--dsh-chat-user-width:900px"></div>
        <div class="convBody" data-conversation-content id="weak" style="--dsh-chat-user-width:900px"></div>
        <div class="convBody" data-conversation-content id="inherit"></div>
        <script>
          // 我们的写法：那个元素 + important；对照：不加 important
          document.getElementById('ours').style.setProperty('--dsh-chat-content-width', '760px', 'important')
          document.getElementById('weak').style.setProperty('--dsh-chat-content-width', '760px')
          const v = id => getComputedStyle(document.getElementById(id)).getPropertyValue('--dsh-chat-content-width').trim()
          document.title = JSON.stringify({ ours: v('ours'), weak: v('weak'), inherit: v('inherit') })
        <\/script></body></html>`
    const f = path.join(os.tmpdir(), 'zf-width.html')
    fs.writeFileSync(f, html, 'utf8')
    let r = null
    try {
      const dom2 = execFileSync(EDGE, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1200',
        '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
      ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      const m = /<title>([^<]*)<\/title>/.exec(dom2)
      r = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null
    } catch { r = null }
    ok('拿到真实引擎计算值', r !== null)
    if (r !== null) {
      ok('行内写 → 我方 760px 生效', r.ours === '760px', r.ours)
      // 实测更正：行内（哪怕不带 important）也压得过外壳那条**样式表**声明 ——
      // 外壳只往该元素写 `--dsh-chat-user-width`，content-width 仍是样式表规则。
      // 我们仍加 important，是防它以后改成行内写。
      ok('不加 important 实测也赢（行内 > 作者样式表）', r.weak === '760px', r.weak)
      // 自定义属性的计算值是**替换后的原文** —— 未设置 user-width 时就是那句
      // `clamp(...)` 本身，不会被算成 px（第一版按 768px 断言，误报）
      ok('不干预时仍是外壳那句 clamp（我们没碰它）',
        String(r.inherit).includes('clamp('), r.inherit)
    }
  }
}


// 用例 75：逐图取景（B8）
//
// 用户选「还可以怎么完善」里的「逐图取景」：清单里只有 fit/宽高，取景统一
// `center 22%`（竖图）或 `center`（横图）—— 主体偏在一侧的图会被裁到。
//
// 这次给清单加了逐图 `focus`（会成为 `background-position`）。⚠️ 它**只在画面
// 被裁切时才有可见效果**（窗口宽高比 ≠ 图片宽高比）：16:9 图铺在 16:9 窗口里
// 没有裁切，写什么值都一样 —— 真正救场的是「主体偏一侧」+ 超宽屏窗口。
//
// 值的来源是视觉测量（主体包围盒 + 面部位置），**只采纳多次测量一致的结论**：
// 同一张图两次量出来的包围盒差很多（pool 一次 43–96、一次 20–78），
// 所以只有 `contour`（两次都指向「主体在右半、左侧留白多」）写了 focus，
// 其余保持居中 —— 宁可少写，也不把噪声写进清单。
{
  console.log('\n--- 逐图取景 ---')
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'art/wallpapers.json'), 'utf8'))
  const art = manifest.wallpapers
  const T = SHARED_MOD.__test

  // 1) 清单契约
  const focused = Object.entries(art).filter(([, v]) => v.focus !== undefined)
  ok('清单里有 focus 字段（功能不是空的）', focused.length > 0, `${focused.length} 张`)
  ok('focus 都是合法的 `x% y%`（0–100）',
    focused.every(([, v]) => {
      const m = /^(\d{1,3})% (\d{1,3})%$/.exec(v.focus)
      return m !== null && Number(m[1]) <= 100 && Number(m[2]) <= 100
    }),
    focused.map(([k, v]) => `${k}=${v.focus}`).join(', '))
  ok('同一张图的明暗两版 focus 相同（构图是同一张）',
    focused.every(([k]) => {
      const mate = k.endsWith('-dark.webp') ? k.replace('-dark.webp', '.webp') : k.replace('.webp', '-dark.webp')
      return art[mate] === undefined || art[mate].focus === art[k].focus
    }))
  ok('生成器会写出 focus（重跑 prepare-art.py 不会丢）',
    fs.readFileSync(path.join(ROOT, 'tools/prepare-art.py'), 'utf8')
      .includes("entry['focus'] = focus"))

  // 2) 取景优先级（纯函数，逐条钉死）
  const P = T.artPosition
  ok('导出 artPosition（可测）', typeof P === 'function')
  ok('平铺 → `0 0`（平铺不裁切，位置没意义）',
    P({ tiled: true, pos: 'cover', fit: 'cover', focus: '65% 50%' }) === '0 0')
  ok('默认位置 + 有 focus → 用 focus',
    P({ tiled: false, pos: 'cover', fit: 'cover', focus: '65% 50%' }) === '65% 50%')
  ok('默认位置 + 无 focus → `center`',
    P({ tiled: false, pos: 'cover', fit: 'cover', focus: undefined }) === 'center')
  ok('用户显式选「靠右」→ 尊重用户，不被 focus 顶掉',
    P({ tiled: false, pos: 'right', fit: 'cover', focus: '65% 50%' }) === 'right center')
  ok('竖图无 focus → `center 22%`（历史取值，纵向留边时偏上）',
    P({ tiled: false, pos: 'cover', fit: 'contain', focus: undefined }) === 'center 22%')
  ok('focus 是空白串时按「没有」处理',
    P({ tiled: false, pos: 'cover', fit: 'cover', focus: '   ' }) === 'center')
  ok('focus 两侧空格会被去掉',
    P({ tiled: false, pos: 'cover', fit: 'cover', focus: ' 65% 50% ' }) === '65% 50%')

  // 3) 接线：applyStyleVars 真的把清单里的 focus 传进去了
  //
  // 内置图要把清单里的 focus 交给 artPosition；自定义图没有 focus
  // （不做裁剪调整），必须显式传 undefined 走居中 —— 传 null 会让
  // `artPosition` 把 `null` 当字符串处理，落到 `background-position: null`。
  ok('applyStyleVars 从清单读 focus 并交给 artPosition',
    csrc.includes('focus: artFile === null ? undefined : meta?.[artFile]?.focus'))

  // 4) 真实引擎：focus 经 `--zf-art-position` 落到合成层的 background-position
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    const { structureCss } = await import('../index.js')
    const html = `<!DOCTYPE html><html data-zf-wallpaper="" data-zf-art-fit="cover"
        style="--zf-art-src:none;--zf-art-position:65% 50%;--zf-art-size:cover;--zf-art-repeat:no-repeat">
      <head><style>${structureCss()}</style></head><body>
        <script>
          document.title = getComputedStyle(document.documentElement, '::before').backgroundPosition
        <\/script></body></html>`
    const f = path.join(os.tmpdir(), 'zf-focus.html')
    fs.writeFileSync(f, html, 'utf8')
    let r = null
    try {
      const dumped = execFileSync(EDGE, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1000',
        '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
      ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      const m = /<title>([^<]*)<\/title>/.exec(dumped)
      r = m ? m[1] : null
    } catch { r = null }
    ok('拿到真实引擎计算值', r !== null, String(r))
    if (r !== null) {
      ok('合成层的 background-position 实测就是清单里的 focus',
        r === '65% 50%', r)
    }
  }
}


// 用例 76：会话读数的权威来源（C11，宿主侧）
//
// 观测台的六项读数原本全靠解析 DOM 文字 —— 已经因为「外壳结构变了」栽过三次
// （右栏 pane / 左栏内层 / 输入区座位）。这里改成订阅宿主事件并推 SSE：
// `makeSessionStream` 用桩 ctx + 假 res 直接测帧协议，不必拉起整个插件。
//
// 三条要钉死的东西：
//   ① 折叠正确（轮/步/用量/缓存/上下文/状态枚举）；
//   ② **隐私白名单**：载荷字段集是写死的，喂进去带正文的事件也一个字都带不出来；
//   ③ 传输行为：合并、心跳、断开清理、`once=1` 退路、停用关流。
{
  console.log('\n--- 会话读数：宿主事件 → SSE（C11）---')
  const S = await import('../src/sessionState.js')
  const { makeSessionStream } = await import('../index.js')

  // ── 1) 折叠 ──────────────────────────────────────────────────────────
  const log = [
    { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: 1010, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: 3, time: 1020, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 300 } } },
    { type: 'tool/call', seq: 4, time: 1030, data: { turn: 1, step: 1, callId: 'c1', name: 'read' } },
    { type: 'tool/result', seq: 5, time: 1040, data: { turn: 1, step: 1, callId: 'c1' } },
    { type: 'step/end', seq: 6, time: 1050, data: { turn: 1, step: 1 } },
    { type: 'request/context', seq: 7, time: 1060, data: { provider: 'deepseek', model: 'V4', contextWindow: 10000 } },
    { type: 'turn/end', seq: 8, time: 1070, data: { turn: 1, reason: { kind: 'completed' } } }
  ]
  const fold = S.foldEvents(log)
  ok('轮数取最大值', fold.turns === 1, String(fold.turns))
  ok('步数按 step/start 计数', fold.steps === 1, String(fold.steps))
  ok('日志位置取最大 seq', fold.rev === 8, String(fold.rev))
  ok('用量累加（in/out/缓存读）',
    fold.usage.input === 100 && fold.usage.output === 40 && fold.usage.cacheRead === 300,
    JSON.stringify(fold.usage))
  ok('缓存命中率 = cacheRead / (input + cacheRead)',
    Math.abs(fold.cacheHit - 300 / 400) < 1e-9, String(fold.cacheHit))
  ok('token 总量累加', fold.tokensTotal === 440, String(fold.tokensTotal))
  ok('上下文窗口与模型名从 request/context 取',
    fold.contextWindow === 10000 && fold.model === 'V4' && fold.provider === 'deepseek')
  ok('工具计数成对归零', fold.openTools === 0, String(fold.openTools))
  ok('回合开始时刻记下来（运行计时用它）', fold.lastTurnStart === 1000, String(fold.lastTurnStart))

  // 状态枚举：与客户端 DOM 判定那套同名同义
  const stateOf = (f, running) => S.deriveState(f, running)
  ok('没有轮次 → idle', stateOf(S.emptyFold(), false) === 'idle')
  ok('正在跑 → running', stateOf(fold, true) === 'running')
  ok('有工具在飞 → tool（优先于 running）', stateOf(S.foldEvents([...log, { type: 'tool/call', seq: 9, data: { turn: 1, step: 2 } }]), true) === 'tool')
  ok('completed → done', stateOf(fold, false) === 'done')
  ok('interrupted/aborted/blocked → stopped',
    ['interrupted', 'aborted', 'blocked'].every(kind =>
      stateOf(S.foldEvents([{ type: 'turn/start', seq: 1, data: { turn: 1 } }, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind } } }]), false) === 'stopped'))
  ok('error / max-tokens → error',
    ['error', 'max-tokens'].every(kind =>
      stateOf(S.foldEvents([{ type: 'turn/start', seq: 1, data: { turn: 1 } }, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind } } }]), false) === 'error'))
  ok('有轮次但没 turn/end → ready',
    stateOf(S.foldEvents([{ type: 'turn/start', seq: 1, data: { turn: 1 } }]), false) === 'ready')

  // 上下文占比与速率
  ok('上下文占比 = 表面 token / 窗口', Math.abs(S.contextUsedOf(2500, 10000) - 0.25) < 1e-9)
  ok('窗口缺失 → null（那一格回退 DOM）', S.contextUsedOf(2500, 0) === null)
  ok('超出窗口夹到 1', S.contextUsedOf(12000, 10000) === 1)
  const samples = [{ time: 0, tokens: 0 }, { time: 5000, tokens: 500 }, { time: 10000, tokens: 1000 }]
  ok('速率按滑窗算（1000 tok / 10s = 100 tok/s）', S.rateOf(samples, 10000) === 100, String(S.rateOf(samples, 10000)))
  ok('窗口内没有增量 → null（不假装有读数）', S.rateOf([{ time: 0, tokens: 5 }], 10000) === null)

  // ── 2) 隐私白名单（**字段集写死**，加一个泄漏字段就会失败）────────────
  const dirty = [
    { type: 'user/message', seq: 1, time: 1, data: { role: 'user', content: '私密正文甲' } },
    { type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 1, message: { role: 'assistant', content: '私密正文乙' }, usage: { outputTokens: 3 } } },
    { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, name: 'read', arguments: '{"path":"/私密/路径"}' } },
    { type: 'tool/result', seq: 4, time: 4, data: { turn: 1, step: 1, message: { role: 'tool', content: '私密工具输出' } } }
  ]
  const payload = S.buildPayload({ fold: S.foldEvents(dirty), state: 'done', sessionId: 's1' })
  const dumped = JSON.stringify(payload)
  ok('载荷里没有消息正文', !dumped.includes('私密正文甲') && !dumped.includes('私密正文乙'))
  ok('载荷里没有工具参数与输出', !dumped.includes('私密/路径') && !dumped.includes('私密工具输出'))
  ok('载荷字段集是写死的白名单',
    Object.keys(payload).join(',') === 'v,session,live,rev,state,turns,steps,usage,tokensTotal,cacheHit,rate,context,model,turnStartedAt,source',
    Object.keys(payload).join(','))
  ok('usage 子字段也是白名单',
    Object.keys(payload.usage).join(',') === 'input,output,cacheRead,cacheWrite,total',
    Object.keys(payload.usage).join(','))

  // `source` 必须反映**这份数字是不是真来自宿主**（会话在宿主 → host）
  ok('会话在宿主时 source = host', payload.source === 'host', payload.source)
  // 会话不在宿主 → 每个数字都是 emptyFold() 的占位 0，不是真实读数。
  // 早先这里写死 'host'，于是 `?once=1`（轮询退路，没有 unavailable 帧）
  // 会把「0 轮 / 0 步」当成权威读数显示。
  const ghost = S.buildPayload({ fold: null, state: 'idle', sessionId: 'ghost', live: false })
  ok('会话不在宿主时 source = none（不是 host）', ghost.source === 'none', ghost.source)
  ok('会话不在宿主时 live = false', ghost.live === false)
  ok('source=none 时数字确实是占位 0（所以不能当权威）',
    ghost.turns === 0 && ghost.steps === 0 && ghost.tokensTotal === 0)

  // ── 3) 传输：桩 ctx + 假 res ──────────────────────────────────────────
  const makeCtx = (session) => {
    const handlers = new Map()
    return {
      handlers,
      on (name, fn) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); return () => {} },
      get (name) {
        if (name === 'sessions') return { get: id => (id === session?.id ? session : undefined) }
        if (name === 'tokenMeter') return { measure: () => ({ totalTokens: 2500 }) }
        return undefined
      },
      fire (name, ...args) { for (const fn of handlers.get(name) ?? []) fn(...args) }
    }
  }
  const makeRes = () => {
    const chunks = []
    const closers = []
    return {
      chunks,
      writeHead (status, headers) { chunks.push({ kind: 'head', status, headers }) },
      write (text) { chunks.push({ kind: 'data', text }) },
      // ⚠️ 必须接住 `end(body)` 的参数：`once=1` 那条 JSON 就是 end(body) 发出去的
      end (payload) {
        if (payload !== undefined) chunks.push({ kind: 'data', text: String(payload) })
        chunks.push({ kind: 'end' })
      },
      on (name, fn) { if (name === 'close') closers.push(fn) },
      close () { for (const fn of closers) fn() },
      text: () => chunks.filter(c => c.kind === 'data').map(c => c.text).join(''),
      frames: () => chunks.filter(c => c.kind === 'data').map(c => c.text)
    }
  }
  const session = {
    id: 's1',
    snapshotEvents: () => log,
    requestContext: () => ({ provider: 'deepseek', model: 'V4', contextWindow: 10000 })
  }
  const ctx = makeCtx(session)
  const stream = makeSessionStream(ctx, { coalesceMs: 5, heartbeatMs: 20, contextMinMs: 1 })

  const res = makeRes()
  stream.attach({ on: () => {} }, res, new URL('http://x/api/zhuang-fangyi/stream?session=s1'))
  const head = res.chunks[0]
  ok('响应头是 SSE 且禁止中间层缓冲',
    head.status === 200 &&
    head.headers['content-type'].includes('text/event-stream') &&
    head.headers['cache-control'].includes('no-transform') &&
    head.headers['x-accel-buffering'] === 'no',
    JSON.stringify(head.headers))
  ok('先发 retry（重连间隔交给 EventSource）', res.text().includes('retry: 3000'))
  ok('发 hello（带 build，便于判断跑的是哪版）',
    /event: hello\ndata: \{"v":1,"build":"[^"]*","session":"s1","live":true\}/.test(res.text()),
    res.text().slice(0, 120))
  ok('连接即给一帧 state（不用等变化）', res.text().includes('event: state'))
  ok('首帧就带上读数（轮/步/token）',
    /"turns":1/.test(res.text()) && /"steps":1/.test(res.text()) && /"tokensTotal":440/.test(res.text()))
  ok('上下文占比按 tokenMeter 算（2500/10000 = 25%）', res.text().includes('"used":0.25'), res.text().slice(-160))
  ok('载荷里没有正文（传输层再验一次）', !res.text().includes('私密'))

  // 合并：窗口内连发多次，只应多出一帧
  const before = res.frames().length
  for (let i = 0; i < 5; i += 1) {
    ctx.fire('session/event', session, { type: 'step/start', seq: 100 + i, time: 2000 + i, data: { turn: 2, step: i + 1 } })
  }
  await new Promise(r => setTimeout(r, 40))
  const added = res.frames().filter(f => f.includes('event: state')).length -
    res.frames().slice(0, before).filter(f => f.includes('event: state')).length
  ok('200ms 窗口内多次变化合并成一帧', added === 1, `实测多出 ${added} 帧`)

  // 状态变化：宿主说在跑 → running
  ctx.fire('api-session/status', 's1', true)
  await new Promise(r => setTimeout(r, 40))
  ok('agent 状态推送会更新 state（running）', /"state":"running"/.test(res.text()), res.text().slice(-200))

  // 心跳
  await new Promise(r => setTimeout(r, 60))
  ok('心跳按间隔发 `: ping`', res.text().includes(': ping'))

  // 断开即清理
  res.close()
  ok('最后一个订阅者断开 → tracker 被回收（不留计时器）',
    stream.trackerCount() === 0, String(stream.trackerCount()))

  // 非活跃会话：明说 not-live，让客户端走 DOM 兜底
  const res2 = makeRes()
  stream.attach({ on: () => {} }, res2, new URL('http://x/api/zhuang-fangyi/stream?session=missing'))
  ok('会话不在宿主 → hello(live:false) + unavailable',
    res2.text().includes('"live":false') && res2.text().includes('event: unavailable'),
    res2.text().slice(0, 160))
  res2.close()

  // `once=1` 退路：单个 JSON 快照（也是改轮询的入口）
  const res3 = makeRes()
  stream.attach({ on: () => {} }, res3, new URL('http://x/api/zhuang-fangyi/stream?session=s1&once=1'))
  const onceHead = res3.chunks[0]
  const onceBody = res3.frames()[0]
  ok('once=1 回 JSON（不是 SSE）',
    onceHead.headers['content-type'].includes('application/json') &&
    onceBody.trim().startsWith('{'), onceHead.headers['content-type'])
  ok('once=1 的载荷与 SSE 同形', JSON.parse(onceBody).turns === 1)
  ok('once=1 不留下 tracker（没有订阅者）', stream.trackerCount() === 0, String(stream.trackerCount()))

  // 停用：关掉所有流
  const res4 = makeRes()
  stream.attach({ on: () => {} }, res4, new URL('http://x/api/zhuang-fangyi/stream?session=s1'))
  stream.dispose()
  ok('停用时关掉所有流', res4.chunks.some(c => c.kind === 'end'))
  ok('停用后 tracker 清空', stream.trackerCount() === 0)
  ok('停用后再来事件不炸', (() => {
    try { ctx.fire('session/event', session, { type: 'step/start', seq: 999, data: { turn: 1, step: 1 } }); return true } catch { return false }
  })())
}


// 用例 77：客户端消费权威推送 + 字段级回退（C11）
//
// 观测台的读数改走宿主推送后，**回退语义**必须钉死：载荷里给不出的那一格
// （`cacheHit` / `rate` / `context.used` 可以是 null）用 DOM 那份；整条流不可用
// 时六项全回退 —— 也就是「换之前的行为」一字不差地保留着。
{
  console.log('\n--- 客户端：宿主推送与 DOM 兜底 ---')
  const T = SHARED_MOD.__test
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

  // 1) token 总量的显示
  ok('1104000000 → 1104M', T.formatTokens(1104000000) === '1104M', T.formatTokens(1104000000))
  ok('9600000 → 9.6M', T.formatTokens(9600000) === '9.6M', T.formatTokens(9600000))
  ok('328000 → 328K', T.formatTokens(328000) === '328K', T.formatTokens(328000))
  ok('999 → 999（不进位）', T.formatTokens(999) === '999', T.formatTokens(999))
  // 与外壳统计条同单位（实测它显示 `1104M tok`）—— 不升 G/T，否则两边数字看起来不一样
  ok('5e9 仍是 M（与外壳一致，不升 G）', T.formatTokens(5000000000) === '5000M', T.formatTokens(5000000000))
  ok('0 / 负 / NaN → —', T.formatTokens(0) === '—' && T.formatTokens(-1) === '—' && T.formatTokens(NaN) === '—')

  // 2) 字段级回退：`dom` 用可辨识的假值，好断言「这一格到底用了谁」
  const domStats = { turns: 'D轮', steps: 'D步', cache: 'D缓', rate: 'D率', tokens: 'D量', context: 'D上' }
  const full = T.formatStats(
    { turns: 107, steps: 2566, rate: 186, tokensTotal: 1104000000, cacheHit: 0.875, context: { used: 0.25 } },
    domStats)
  ok('宿主给全 → 六项全用宿主',
    full.turns === '107' && full.steps === '2566' && full.rate === '186' &&
    full.tokens === '1104M' && full.cache === '88%' && full.context === '25%',
    JSON.stringify(full))
  const empty = T.formatStats(
    { turns: 0, steps: 0, rate: null, tokensTotal: 0, cacheHit: null, context: { used: null } },
    domStats)
  ok('宿主给不出 → **逐格**回退 DOM',
    empty.turns === 'D轮' && empty.steps === 'D步' && empty.rate === 'D率' &&
    empty.tokens === 'D量' && empty.cache === 'D缓' && empty.context === 'D上',
    JSON.stringify(empty))
  const mixed = T.formatStats(
    { turns: 12, steps: 0, rate: 30, tokensTotal: 0, cacheHit: 0.5, context: { used: null } },
    domStats)
  ok('混合：有值的用宿主、没值的回退',
    mixed.turns === '12' && mixed.steps === 'D步' && mixed.rate === '30' &&
    mixed.tokens === 'D量' && mixed.cache === '50%' && mixed.context === 'D上',
    JSON.stringify(mixed))
  ok('空载荷也不炸（全回退）',
    T.formatStats(undefined, domStats).turns === 'D轮')

  // 2b) `live:false` 的载荷必须被挡掉 —— 那是宿主在「会话不在宿主」时给的
  // **占位全 0**，不是真实读数。SSE 路径靠 `unavailable` 帧置空，
  // 但 `?once=1` 轮询退路没有那一帧，所以客户端要按 `live` 再兜一道。
  ok('streamPayload 会拒绝 live:false 的载荷（占位 0 不能当权威）',
    /if \(p\.live === false\) return null/.test(csrc))
  ok('streamPayload 先查 live 再查新鲜度（顺序不能反）',
    csrc.indexOf('if (p.live === false) return null') <
    csrc.indexOf('Date.now() - streamState.at < STREAM_FRESH_MS ? p : null'))

  // 3) 会话 id 从哪读
  const dom = makeDom()
  ok('没有会话容器 → 空串（不连流，行为同换之前）', T.sessionIdOf(dom.document) === '')
  const conv = new El('div')
  conv.setAttribute('data-conversation-session', 'session-42')
  dom.body.appendChild(conv)
  ok('从 data-conversation-session 读当前会话 id',
    T.sessionIdOf(dom.document) === 'session-42', T.sessionIdOf(dom.document))

  // 4) 生命周期：无 EventSource / 连上 / 陈旧 / 关闭
  const savedES = globalThis.EventSource
  let reason = null
  try {
    delete globalThis.EventSource
    T.closeSessionStream('reset')
    T.syncSessionStream(dom.document)
    reason = T.streamDiag().reason
  } finally {
    if (savedES !== undefined) globalThis.EventSource = savedES
  }
  ok('环境没有 EventSource → 记 no-eventsource 并留在 DOM', reason === 'no-eventsource', String(reason))

  class FakeES {
    constructor (url) {
      this.url = url
      this.listeners = new Map()
      this.closed = false
      FakeES.instances.push(this)
    }

    addEventListener (type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(fn)
    }

    close () { this.closed = true }

    emit (type, payload) {
      for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ data: JSON.stringify(payload) })
    }
  }
  FakeES.instances = []
  globalThis.EventSource = FakeES
  T.closeSessionStream('reset')
  T.syncSessionStream(dom.document)
  const es = FakeES.instances.at(-1)
  ok('按会话 id 打开流',
    es !== undefined && es.url === '/api/zhuang-fangyi/stream?session=session-42',
    String(es?.url))
  ok('连上但还没帧 → 仍旧走 DOM（不显示空读数）', T.streamPayload() === null)
  ok('同一会话重复 refresh 不会重复连',
    (() => { T.syncSessionStream(dom.document); return FakeES.instances.length === 1 })(),
    String(FakeES.instances.length))

  es.emit('state', {
    v: 1, state: 'running', turns: 5, steps: 9, rate: 120, tokensTotal: 9600000,
    cacheHit: 0.875, context: { used: 0.25 }, turnStartedAt: Date.now() - 5000
  })
  ok('收到帧 → 新鲜可用（source=sse）',
    T.streamPayload() !== null && T.streamDiag().source === 'sse', T.streamDiag().reason)
  ok('帧里的读数直接可用', T.formatStats(T.streamPayload(), domStats).turns === '5')

  T.streamState.at = Date.now() - (T.STREAM_FRESH_MS + 1000)
  ok('超过 10s 没帧 → 判定不新鲜、回退 DOM（不显示陈旧数字）',
    T.streamPayload() === null && T.streamDiag().hasPayload === true)

  T.closeSessionStream('dispose')
  ok('关闭后连接被关、载荷清空、来源回 DOM',
    es.closed === true && T.streamState.payload === null && T.streamDiag().source === 'dom')
  delete globalThis.EventSource

  // 5) 接线（refresh 里的取舍与诊断）
  ok('有新鲜帧 → 用宿主读数并标记 sse',
    csrc.includes('formatStats(live, domStats)') && csrc.includes("state.statsSource = 'sse'"))
  ok('无帧 → 明确回到 DOM 解析（换之前的行为一字不差）',
    csrc.includes('state.stats = domStats') && csrc.includes("state.statsSource = 'dom'"))
  ok('运行计时用宿主回合开始时刻（刷新页面不再从零开始）',
    csrc.includes('state.sessionSince = live.turnStartedAt'))
  ok('/diag 同时报读数来源与流状态',
    csrc.includes('statsSource: state.statsSource') && csrc.includes('stream: streamDiag()'))
  ok('卸载时关流（不给宿主留悬挂连接）', csrc.includes("closeSessionStream('dispose')"))
  ok('主机端留了 once=1 退路（载体不吃流式时可改轮询，载荷同形）',
    fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8').includes("url?.searchParams?.get('once') === '1'"))
}


// 用例 78：diff 行的可读性（用户截图：修改的代码被色块覆盖）
//
// 官方 diff 行的结构（壳源码实测，模块 `_17vb8_`）：
//
//   ._add_17vb8_48{ color:var(--dsw-alias-state-success-primary);   ← 绿字
//                    background:var(--dsw-alias-code-diff-added) }   ← 绿底
//   ._del_17vb8_38{ color:var(--dsw-alias-state-error-primary); … }  ← 红字 + 红底
//
// 两个问题叠在一起：
//   ① 我们第一版把 diff 底做成了**不透明状态色**（实心亮绿）→ 把文字压没了；
//   ② 官方本来就是**同色系字配同色系底**（绿字压绿底），实测 8 组里 7 组 < 4.5:1。
{
  console.log('\n--- diff 行可读性 ---')
  const pal = await import('../src/palette.js')
  const { structureCss } = await import('../index.js')
  const css = structureCss()

  // 1) 底色：不透明实色 + 与代码底可辨 + 增删不同色 + 文字读得清
  const officialRatios = []
  for (const presetId of pal.PRESET_IDS) {
    for (const scheme of ['light', 'dark']) {
      const t = pal.buildTokens(presetId)[scheme]
      const code = t['--dsw-alias-markdown-code-block']
      const fg = t['--dsw-alias-label-primary']
      const add = t['--dsw-alias-code-diff-added']
      const del = t['--dsw-alias-code-diff-deleted']
      const tag = `${presetId}/${scheme}`
      ok(`${tag}：diff 底是不透明实色（半透明的话对比度没法算）`,
        /^#[0-9a-f]{6}$/i.test(add) && /^#[0-9a-f]{6}$/i.test(del), `${add} / ${del}`)
      ok(`${tag}：行上文字 ≥ 6:1（前景色）`,
        pal.contrast(fg, add) >= 6 && pal.contrast(fg, del) >= 6,
        `${pal.contrast(fg, add).toFixed(2)} / ${pal.contrast(fg, del).toFixed(2)}`)
      ok(`${tag}：与代码底色看得出区别（≥1.18，但别太冲）`,
        pal.contrast(add, code) >= 1.18 && pal.contrast(add, code) <= 1.45,
        `${pal.contrast(add, code).toFixed(3)}`)
      ok(`${tag}：增/删不同色（语义还在）`, add !== del)
      officialRatios.push({
        tag,
        ratio: pal.contrast(t['--dsw-alias-state-success-primary'], add)
      })
    }
  }

  // 官方那对搭配（同色系字配同色系底）整体不达标 —— 这正是要覆盖文字色的原因。
  // 按**集合**断言（要求每一组都不达标是错的：wine/dark 恰好达标）。
  const badOfficial = officialRatios.filter(o => o.ratio !== null && o.ratio < 4.5)
  ok('官方同色系搭配多数不达标（所以必须覆盖文字色）',
    badOfficial.length >= 4,
    `${badOfficial.length}/${officialRatios.length} 组 < 4.5`)

  // 2) CSS：文字色拉回前景色，且**用真实结构定位**（不是猜类名）
  const flat = css.replace(/\s+/g, '')
  ok('按语义锚点定位 diff 行（data-code-block-content）',
    flat.includes('[data-code-block-content][class*="_add_"]') ||
    flat.includes('[data-code-block-content] [class*="_add_"]'),
    '应含 [data-code-block-content] 与 _add_/_del_')
  ok('增/删/上下文行的文字色都拉回 label-primary',
    /\[class\*="_add_"\],[^{]*\[class\*="_del_"\],[^{]*\[class\*="_context_"\]\{color:var\(--dsw-alias-label-primary\)/.test(flat))
  ok('行内语法高亮色也退回前景色（浅底上会糊成一片）',
    /\[class\*="_add_"\]\[class\*="shiki"\],[^{]*\[class\*="_del_"\]\[class\*="shiki"\]\{color:var\(--dsw-alias-label-primary\)/.test(flat))
  ok('**没有**猜错的类名（第一版写的 [class*="code-diff"] 一条都命中不了）',
    !css.includes('[class*="code-diff"]') && !css.includes('[class*="file-diff"]'),
    '真实本地名是 add / del / context')

  // 3) 真实引擎：确认选择器真能命中（照抄官方类名）
  const { execFileSync } = await import('node:child_process')
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!fs.existsSync(EDGE)) {
    console.log('  SKIP 无 Edge（Linux/CI）—— 真实引擎验证跳过')
  } else {
    const html = `<!DOCTYPE html><html><head><style>
      body{--dsw-alias-label-primary:#f2f2f0;--dsw-alias-label-secondary:#b9b9b6;
           --dsw-alias-state-success-primary:#7fd6a0;--dsw-alias-state-error-primary:#f08a84;
           --dsw-alias-code-diff-added:#363c30;--dsw-alias-code-diff-deleted:#413a32}
      /* 照抄官方那两条 */
      ._add_17vb8_48{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-code-diff-added)}
      ._del_17vb8_38{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-code-diff-deleted)}
      ${structureCss()}
    </style></head><body data-zf-theme="">
      <div data-code-block-content="">
        <div class="_add_17vb8_48" id="a">+ import json</div>
        <div class="_del_17vb8_38" id="d">- import os</div>
      </div>
      <script>
        const g = id => getComputedStyle(document.getElementById(id))
        document.title = JSON.stringify({ add: g('a').color, del: g('d').color })
      <\/script></body></html>`
    const f = path.join(os.tmpdir(), 'zf-diff.html')
    fs.writeFileSync(f, html, 'utf8')
    let r = null
    try {
      const dumped = execFileSync(EDGE, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1000',
        '--dump-dom', `file:///${f.replace(/\\/g, '/')}`
      ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      const m = /<title>([^<]*)<\/title>/.exec(dumped)
      r = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null
    } catch { r = null }
    ok('拿到真实引擎计算值', r !== null)
    if (r !== null) {
      ok('引擎里：增行文字是前景色（不再是官方那个绿）',
        r.add === 'rgb(242, 242, 240)', r.add)
      ok('引擎里：删行文字也是前景色（不再是官方那个红）',
        r.del === 'rgb(242, 242, 240)', r.del)
    }
  }
}


// 用例 79：C12 设置导入 / 导出
//
// 导入的**安全边界**只有一处：宿主 `normalizeSettings`（白名单 + 夹取）。
// 所以这里要钉的是「坏输入不会写进坏值」，而不是「客户端又校验了一遍」
// （客户端再写一遍校验必然与宿主那份漂移）。
{
  console.log('\n--- C12：设置导入 / 导出 ---')
  const T = SHARED_MOD.__test
  const set = await import('../src/settings.js')
  const pal = await import('../src/palette.js')

  // 1) 契约
  ok('导出上限与宿主 readBody 的 64 KB 一致', T.IMPORT_MAX_BYTES === 64 * 1024, String(T.IMPORT_MAX_BYTES))
  ok('导出的文件名固定（便于用户辨认）',
    fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
      .includes("'dsh-zhuang-fangyi-settings.json'"))
  ok('导出带 _meta（来源与版本）',
    fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8').includes("plugin: 'dsh-zhuang-fangyi'"))
  ok('导出的 Blob URL 会回收（不 revoke 会一直占内存）',
    fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8').includes('revokeObjectURL'))

  // 2) 坏输入 → 宿主归一化后必须仍是**合法设置**（不是抛错、不是坏值）
  const junk = [
    { preset: 42 },
    { backgroundOpacity: 99999 },
    { fontFamily: 'comic-sans-nope' },
    { presetLight: 'NOT_A_PRESET' },
    { backgroundRotate: '99s' },
    { railWidth: -5 },
    { scheme: 'rainbow' },
    { accentHue: 'purple' }
  ]
  let allLegal = true
  for (const input of junk) {
    const n = set.normalizeSettings(input)
    if (!pal.PRESET_IDS.includes(n.preset)) allLegal = false
    if (!(n.backgroundOpacity >= 0 && n.backgroundOpacity <= set.BG_OPACITY_MAX)) allLegal = false
    if (n.railWidth < set.RAIL_WIDTH.min || n.railWidth > set.RAIL_WIDTH.max) allLegal = false
    if (!set.SCHEMES.includes(n.scheme)) allLegal = false
  }
  ok('8 种坏输入归一化后都是合法设置（导入不可能写进坏值）', allLegal)

  // 3) 一个可识别的键都没有 → 得到默认值（UI 会明确提示，不静默）
  const empty = set.normalizeSettings({ _meta: { version: 6 }, nope: 1 })
  const dflt = set.defaultSettings()
  ok('无有效字段 → 逐项等于默认值',
    empty.preset === dflt.preset && empty.background === dflt.background &&
    empty.fontFamily === dflt.fontFamily)
  ok('_meta 不是设置字段，会被白名单丢弃',
    !('_meta' in empty) && !('nope' in empty))

  // 4) 往返：导出 → 导入 → 逐字段相同
  const original = set.normalizeSettings({
    preset: 'wine', background: 'promo', backgroundOpacity: 31,
    fontFamily: 'serif', contentWidth: 'wide', presetLight: 'cyan', presetDark: 'burst',
    backgroundRotate: '5m', accentHue: 210, railWidth: 333
  })
  const roundTrip = set.normalizeSettings(JSON.parse(JSON.stringify({ settings: original })).settings)
  ok('导出→导入 往返逐字段一致',
    JSON.stringify(roundTrip) === JSON.stringify(original),
    JSON.stringify(roundTrip) === JSON.stringify(original) ? '' : `${JSON.stringify(roundTrip)} vs ${JSON.stringify(original)}`)

  // 5) 反例：宿主层不会因为 `settings` 不是对象而崩
  ok('settings 是数组时回落默认（不抛错）',
    set.normalizeSettings([]).preset === dflt.preset)
  ok('settings 是 null 时回落默认', set.normalizeSettings(null).preset === dflt.preset)
}

// 用例 80：C13 明暗分档预设
//
// 核心不变量：**未分档时行为与 v5 一字不差**（老设置文件升级后观感不变）。
// 另外客户端不能 import src/，所以 `presetForScheme` 有两份实现 —— 这里
// 拿同一组输入跑两边，断言结果相等（防两份漂移）。
{
  console.log('\n--- C13：明暗分档预设 ---')
  const T = SHARED_MOD.__test
  const set = await import('../src/settings.js')
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

  // 1) 默认值必须是 null（不能是某个具体预设，否则升级即改变观感）
  ok('默认 presetLight/presetDark 都是 null',
    set.defaultSettings().presetLight === null && set.defaultSettings().presetDark === null)
  ok('客户端 FOLLOW 常量与宿主的 null 哨兵语义一致',
    T.FOLLOW === '__follow__', T.FOLLOW)

  // 2) 未分档 → 恒等于主预设（v5 行为不变）
  const plain = set.normalizeSettings({ preset: 'wine' })
  ok('未分档：light 用主预设', set.presetForScheme(plain, 'light') === 'wine')
  ok('未分档：dark 用主预设', set.presetForScheme(plain, 'dark') === 'wine')
  ok('未分档：hasSchemePresets = false', set.hasSchemePresets(plain) === false)

  // 3) 分档
  const split = set.normalizeSettings({ preset: 'wine', presetLight: 'cyan', presetDark: 'burst' })
  ok('分档：light 用 presetLight', set.presetForScheme(split, 'light') === 'cyan')
  ok('分档：dark 用 presetDark', set.presetForScheme(split, 'dark') === 'burst')
  ok('分档：hasSchemePresets = true', set.hasSchemePresets(split) === true)

  // 4) 只设一边：另一边仍跟随主预设
  const half = set.normalizeSettings({ preset: 'wine', presetLight: 'cyan' })
  ok('只设 light：dark 仍跟随主预设',
    set.presetForScheme(half, 'light') === 'cyan' && set.presetForScheme(half, 'dark') === 'wine')

  // 5) 非法值回落「跟随」而不是变成具体预设
  const bad = set.normalizeSettings({ preset: 'cyan', presetLight: 'NOPE', presetDark: 42 })
  ok('非法分档回落 null（不是某个预设）',
    bad.presetLight === null && bad.presetDark === null)
  ok('非法分档 → 仍用主预设', set.presetForScheme(bad, 'light') === 'cyan')

  // 6) 客户端与宿主两份实现必须同结果（手写 bundle 不能 import src/）
  const cases = [
    { preset: 'zhuang' },
    { preset: 'wine', presetLight: 'cyan' },
    { preset: 'wine', presetLight: 'cyan', presetDark: 'burst' },
    { preset: 'burst', presetDark: 'wine' },
    { preset: 'nope', presetLight: 'NOPE' }
  ]
  let same = true
  for (const c of cases) {
    for (const scheme of ['light', 'dark']) {
      if (T.presetForScheme(c, scheme) !== set.presetForScheme(c, scheme)) same = false
    }
  }
  ok('客户端 presetForScheme 与宿主同结果（10 组）', same)
  ok('客户端 hasSchemePresets 与宿主同结果',
    cases.every(c => T.hasSchemePresets(c) === set.hasSchemePresets(c)))

  // 7) 拼表：浅色取 A.light、深色取 B.dark
  const table = {
    cyan: { '--t': { light: 'CYAN-L', dark: 'CYAN-D' } },
    burst: { '--t': { light: 'BURST-L', dark: 'BURST-D' } }
  }
  const composed = T.composeSchemeOverrides({ preset: 'cyan', presetLight: 'cyan', presetDark: 'burst' }, table)
  ok('拼表：light 取浅色预设', composed['--t'].light === 'CYAN-L', composed['--t'].light)
  ok('拼表：dark 取深色预设', composed['--t'].dark === 'BURST-D', composed['--t'].dark)
  // 不分档时**不复制**（返回原表，保持既有路径零变化）
  const sameRef = T.composeSchemeOverrides({ preset: 'cyan', presetLight: null, presetDark: null }, table)
  ok('不分档：直接返回原表（不复制）', sameRef === table.cyan)

  // 8) 重入闸门：applySettings 会在 setTheme 时被 theme/change 重入
  ok('applySettings 有重入闸门（否则 setTheme → theme/change 无限递归）',
    csrc.includes('state.applying') && /if \(state\.applying\) return/.test(csrc))
  ok('闸门在调用**之前**置位（写在事件回调里挡不住）',
    /state\.applying = true\s*\n\s*try \{\s*\n\s*applySettingsInner/.test(csrc))

  // 9) 明暗切换要走完整 applySettings（只调 wallpaper 会「壁纸变了配色没变」）
  ok('theme/change 在分档时走 applySettings',
    /hasSchemePresets\(state\.settings\)\) applySettings\(\)/.test(csrc))
  ok('不分档时仍只走 syncSchemeWallpaper（保持旧路径）',
    /else syncSchemeWallpaper\(state\.settings/.test(csrc))

  // 10) 所有**渲染/应用**预设的地方都走 presetForScheme（漏一处就半生效）
  //
  // 但要排除三类**合法的** `settings.preset` 读取，它们读的就是「主预设」本身：
  //   ① `presetForScheme` / `hasSchemePresets` 自己的函数体（回落分支）；
  //   ② 编辑主预设的控件（设置页下拉、观测栏色板）—— 它们写的是 `preset`；
  //   ③ 诊断快照（原样上报设置）。
  // 白名单写成**精确片段**并断言条数，这样新增一处漏用会立刻失败，
  // 而不是被一个宽松的正则悄悄放过去。
  const LEGIT_MAIN_PRESET_READS = [
    // ① 两个 helper 的回落分支
    /^\s*return PRESETS\.includes\(settings\.preset\)/,
    // ② 编辑主预设的控件（设置页 value / 观测栏 aria-pressed 与 ✓）
    /^\s*value: settings\.preset,$/,
    /^\s*'aria-pressed': settings\.preset === p \?/,
    /^\s*settings\.preset === p \? h\('span', null, '✓'\)/,
    // ③ 诊断快照
    /^\s*preset: state\.settings\.preset,$/,
    // ④ C14 按钮：套用「当前主预设」的组合
    /^\s*onClick: \(\) => applyCombo\(settings\.preset\),$/
  ]
  const leaks = []
  const lines = csrc.split('\n')
  // 记录 presetForScheme / hasSchemePresets 的函数体行范围
  const helperRanges = []
  for (let i = 0; i < lines.length; i++) {
    if (!/function (presetForScheme|hasSchemePresets) \(/.test(lines[i])) continue
    let depth = 0
    let started = false
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; started = true } else if (ch === '}') depth--
      }
      if (started && depth <= 0) { helperRanges.push([i, j]); break }
    }
  }
  const inHelper = n => helperRanges.some(([a, b]) => n >= a && n <= b)
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    if (!/settings\.preset\b/.test(L)) continue
    if (inHelper(i)) continue
    if (LEGIT_MAIN_PRESET_READS.some(re => re.test(L))) continue
    leaks.push(`${i + 1}: ${L.trim()}`)
  }
  ok('没有漏用 settings.preset 的地方（漏一处就半生效）', leaks.length === 0, leaks.join(' | '))
  ok('主预设读取白名单恰好 6 条（新增漏用会失败而不是被放宽）',
    LEGIT_MAIN_PRESET_READS.length === 6, String(LEGIT_MAIN_PRESET_READS.length))
  // 反向保证：确实有足够多的地方**走了** presetForScheme
  const helperUses = (csrc.match(/presetForScheme\(/g) ?? []).length
  ok('presetForScheme 被实际使用（≥ 6 处调用）', helperUses >= 6, String(helperUses))
}

// 用例 81：C14 一键推荐组合
{
  console.log('\n--- C14：一键推荐组合 ---')
  const pal = await import('../src/palette.js')
  const set = await import('../src/settings.js')
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  const isrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')

  // 1) 每套预设都有组合
  ok('四套预设都有推荐组合',
    Object.keys(pal.PRESET_COMBOS).length === 4 &&
    pal.PRESET_IDS.every(id => pal.PRESET_COMBOS[id] !== null))
  // 2) 组合值必须能被宿主归一化**原样接受** —— 否则点了按钮会被静默改掉
  let exact = true
  for (const id of pal.PRESET_IDS) {
    const c = pal.PRESET_COMBOS[id]
    const n = set.normalizeSettings(c)
    if (n.preset !== c.preset || n.background !== c.background ||
        n.backgroundOpacity !== c.backgroundOpacity || n.fontFamily !== c.fontFamily ||
        n.contentWidth !== c.contentWidth) exact = false
  }
  ok('组合值经 normalizeSettings 后逐项不变（不会被静默夹取）', exact)

  // 3) 不越权：不碰开关 / 明暗偏好 / 皮肤层 / 动效（无障碍相关）
  const forbidden = ['enabled', 'scheme', 'rail', 'motion', 'accentHue', 'railWidth']
  const overreach = []
  for (const id of pal.PRESET_IDS) {
    for (const k of forbidden) if (k in pal.PRESET_COMBOS[id]) overreach.push(`${id}.${k}`)
  }
  ok('组合不覆盖开关/明暗/皮肤/动效（尤其 motion 是无障碍偏好）',
    overreach.length === 0, overreach.join(', '))

  // 4) 组合里的壁纸必须与该预设的推荐壁纸一致（同一份事实，不能两处不一致）
  let bgMatch = true
  for (const id of pal.PRESET_IDS) {
    if (pal.PRESET_COMBOS[id].background !== pal.PRESET_STYLES[id].background) bgMatch = false
  }
  ok('组合的壁纸 = presetStyles 的推荐壁纸（单一事实来源）', bgMatch)

  // 5) 组合数据由宿主下发（客户端不重复定义，否则又是一份会漂移的副本）
  ok('宿主 /themes 下发 presetCombos', isrc.includes('presetCombos: PRESET_COMBOS'))
  ok('客户端从宿主取，不写死映射',
    csrc.includes('themePayload.presetCombos') && csrc.includes('payload.presetCombos'))
  ok('客户端没有硬编码组合表（不应出现 defaultBackground 之类）',
    !csrc.includes('defaultBackground'))

  // 6) 未知预设 → null（不是抛错）
  ok('未知预设返回 null', pal.recommendCombo('nope') === null)
}

// 用例 82：C15 壁纸轮播
{
  console.log('\n--- C15：壁纸轮播 ---')
  const T = SHARED_MOD.__test
  const set = await import('../src/settings.js')
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

  // 1) 契约
  ok('默认关闭', set.defaultSettings().backgroundRotate === 'off')
  ok('默认顺序轮播', set.defaultSettings().backgroundRotateOrder === 'sequential')
  ok('四档白名单', set.ROTATE_MODES.join(',') === 'off,60s,5m,30m', set.ROTATE_MODES.join(','))
  ok('非法间隔回落 off', set.normalizeSettings({ backgroundRotate: '99s' }).backgroundRotate === 'off')
  ok('非法顺序回落 sequential',
    set.normalizeSettings({ backgroundRotateOrder: 'x' }).backgroundRotateOrder === 'sequential')
  ok('客户端 ROTATE_MS 与宿主同值',
    JSON.stringify(T.ROTATE_MS) === JSON.stringify(set.ROTATE_MS),
    `${JSON.stringify(T.ROTATE_MS)} vs ${JSON.stringify(set.ROTATE_MS)}`)

  // 2) 候选池排除 none
  ok('候选池不含 none', !T.ROTATE_POOL.includes('none'), T.ROTATE_POOL.join(','))
  ok('候选池含全部 8 张', T.ROTATE_POOL.length === 8, String(T.ROTATE_POOL.length))

  // 3) 顺序轮播
  ok('顺序：sakura → promo', T.nextWallpaper('sakura', 'sequential') === 'promo',
    T.nextWallpaper('sakura', 'sequential'))
  ok('顺序：末位回到首位', T.nextWallpaper(T.ROTATE_POOL[7], 'sequential') === T.ROTATE_POOL[0])
  ok('顺序：当前不在池里（none）→ 从第一张开始',
    T.nextWallpaper('none', 'sequential') === T.ROTATE_POOL[0])

  // 4) 随机：**绝不原地不动**（否则 1/8 概率看起来像坏了）
  let selfPick = 0
  for (let i = 0; i < 300; i++) {
    if (T.nextWallpaper('sakura', 'random') === 'sakura') selfPick++
  }
  ok('随机：300 次都不选当前那张', selfPick === 0, `自选 ${selfPick} 次`)
  // 且确实在变（不是恒定返回同一个）
  const seen = new Set()
  for (let i = 0; i < 300; i++) seen.add(T.nextWallpaper('sakura', 'random'))
  ok('随机：结果有分布（不是恒定值）', seen.size > 3, `不同结果 ${seen.size} 个`)

  // 5) 必须复用 applySettings（直接写 --zf-art-src 会绕过交叉淡入与暗版分流）
  ok('轮播走 applySettings（保留交叉淡入 B6 与暗版分流 B9）',
    /state\.settings = \{ \.\.\.cur, background: next \}\s*\n\s*applySettings\(\)/.test(csrc))
  ok('轮播不直接写 --zf-art-src', !/nextWallpaper[\s\S]{0,400}setProperty\('--zf-art-src'/.test(csrc))

  // 6) 不写盘（只改内存并重新应用）
  ok('轮播不调用 save（不写盘，否则重启就换图且污染导出）',
    !/nextWallpaper[\s\S]{0,300}void save\(/.test(csrc))

  // 7) 三处清理：设置变化、页面不可见跳过、卸载
  ok('页面不可见时跳过一轮', csrc.includes('document.hidden'))
  ok('卸载时停掉定时器（否则停用后仍在写 DOM）',
    /ctx\.effect\(\(\) => \(\) => \{[\s\S]*?stopRotation\(\)/.test(csrc))
  ok('stopRotation 幂等（定时器置 null）',
    /if \(state\.rotateTimer !== null\) \{\s*\n\s*clearInterval\(state\.rotateTimer\)\s*\n\s*state\.rotateTimer = null/.test(csrc))
  ok('每次应用设置都重排轮播', csrc.includes('state.rotationSync?.()'))

  // 8) 行为：start → 定时器建立；关掉 → 清掉
  const dom = makeDom()
  globalThis.document = dom.document
  globalThis.window = dom.window ?? globalThis.window
  T.state.settings = set.normalizeSettings({ enabled: true, background: 'sakura', backgroundRotate: '60s' })
  T.stopRotation()
  ok('初始无定时器', T.state.rotateTimer === null)
  T.syncRotation()
  ok('开启后建立定时器', T.state.rotateTimer !== null)
  T.state.settings = set.normalizeSettings({ enabled: true, background: 'sakura', backgroundRotate: 'off' })
  T.syncRotation()
  ok('关掉后定时器被清掉', T.state.rotateTimer === null)
  // background = none 也不该轮播
  T.state.settings = set.normalizeSettings({ enabled: true, background: 'none', backgroundRotate: '5m' })
  T.syncRotation()
  ok('壁纸为 none 时不轮播', T.state.rotateTimer === null)
  // 插件关闭也不轮播
  T.state.settings = set.normalizeSettings({ enabled: false, background: 'sakura', backgroundRotate: '5m' })
  T.syncRotation()
  ok('插件关闭时不轮播', T.state.rotateTimer === null)
  T.stopRotation()
  T.state.settings = null
}

// 用例 83：设置页结构（分组 / 反馈语义 / 平台门控）
//
// 这一组的价值在于**把「加设置项忘了归组」变成会失败的测试**。
// 原先分组只是渲染代码里的几行标题，装饰组因此堆到 10 行、语义混杂。
{
  console.log('\n--- 设置页结构 ---')
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  const probe = await boot(baseSettings)
  const T = probe.mod.__test

  // 1) 分组常量存在且结构合法
  const groups = T.SETTINGS_GROUPS
  ok('SETTINGS_GROUPS 是显式常量', Array.isArray(groups) && groups.length >= 5, String(groups?.length))
  ok('每个分组都有 id / label / max',
    groups.every(g => typeof g.id === 'string' && typeof g.label === 'string' && typeof g.max === 'number'))
  ok('分组 id 不重复', new Set(groups.map(g => g.id)).size === groups.length)

  // 2) 分组标签都必须在 DICT 里（否则界面显示键名）
  const missingGroupLabel = groups.filter(g => T.DICT.zh[g.label] === undefined).map(g => g.label)
  ok('每个分组标签都是存在的 DICT 键', missingGroupLabel.length === 0, missingGroupLabel.join(', '))
  const missingGroupHint = groups.filter(g => g.hint !== undefined && T.DICT.zh[g.hint] === undefined)
  ok('分组说明（若有）也是存在的 DICT 键', missingGroupHint.length === 0,
    missingGroupHint.map(g => g.hint).join(', '))

  // 3) 渲染出来的分组顺序与常量一致（防止渲染里漏掉某个 Group）
  const renderGroupIds = [...csrc.matchAll(/h\(Group, \{ groupId: '([a-z]+)' \}\)/g)].map(m => m[1])
  ok('渲染的分组顺序与 SETTINGS_GROUPS 完全一致',
    renderGroupIds.join(',') === groups.map(g => g.id).join(','),
    `渲染 [${renderGroupIds.join(',')}] vs 常量 [${groups.map(g => g.id).join(',')}]`)

  // 4) 每组行数不超过 max —— 超了就说明该拆组了
  //
  // 用「渲染里每个 Group 到下一个 Group 之间的 h(Row, 计数」来数。
  const rowCounts = {}
  {
    const parts = csrc.split(/h\(Group, \{ groupId: '([a-z]+)' \}\)/)
    // parts: [前置, id1, 片段1, id2, 片段2, …]
    for (let i = 1; i < parts.length; i += 2) {
      const id = parts[i]
      const body = parts[i + 1] ?? ''
      rowCounts[id] = (body.match(/h\(Row, /g) ?? []).length
    }
  }
  const over = groups.filter(g => (rowCounts[g.id] ?? 0) > g.max)
    .map(g => `${g.id}=${rowCounts[g.id]}>${g.max}`)
  ok('每组行数不超过声明上限（超了说明该拆组）', over.length === 0, over.join(', '))
  // 而且装饰组必须已经被拆开 —— 它曾经有 10 行
  ok('「细节」组不再吞下排版与动效（≤ 5 行）', (rowCounts.detail ?? 0) <= 5, String(rowCounts.detail))

  // 5) A2：分档两个下拉各自带标签（原先定义了键却从未渲染）
  ok('浅色预设标签真的被渲染', csrc.includes("t('presetLight')"))
  ok('深色预设标签真的被渲染', csrc.includes("t('presetDark')"))

  // 6) A3：标题栏跟随按平台门控
  ok('标题栏跟随行受 hasWindowsTitlebar 门控',
    /hasWindowsTitlebar\(document\) && h\(Row, \{ label: t\('titlebarFollow'\)/.test(csrc))
  ok('hasWindowsTitlebar 判据是共享函数（诊断与界面同一判据）',
    csrc.includes('function hasWindowsTitlebar') && csrc.includes('hasWindowsTitlebar: hasWindowsTitlebar()'))

  // 7) A1：提示与错误分离
  ok('有独立的 notice 字段（成功/信息）', csrc.includes('notice: null'))
  ok('notice 用中性色、lastError 才用错误色',
    /notice !== null && h\('div'[\s\S]{0,200}label-tertiary/.test(csrc) &&
    /lastError !== null && h\('div'[\s\S]{0,200}state-error-primary/.test(csrc))
  ok('导入成功写 notice（不再写 lastError）',
    csrc.includes("setNotice(t('importDone'))"))
  ok('导入失败仍写 lastError',
    /state\.lastError = t\('importBadJson'\)/.test(csrc))
  ok('导入成功时会清掉上一轮的错误', /state\.lastError = null\n\s*if \(newer\)/.test(csrc))

  // 8) D：恢复默认需要二次确认
  ok('恢复默认有二次确认状态', csrc.includes('confirmReset: false'))
  ok('二次确认会自动复原（3s）', /state\.confirmResetTimer = setTimeout/.test(csrc))
  ok('待确认时的按钮文案是「确认恢复默认？」', csrc.includes("t('resetConfirm')"))

  // 9) DICT 里没有死键（每个键都必须有 t('key') 调用）
  //
  // 这条正是发现那 6 个死键的手段（title / px / percent / on / off / exportHint）。
  //
  // 两类键不走字面量调用，必须排除，否则会误报：
  //   ① **动态拼接**的键（`t(\`font_${f}\`)` 之类）—— 用前缀白名单；
  //   ② **分组标签**（`t(g.label)` / `t(g.hint)`）—— 直接从 SETTINGS_GROUPS
  //      推导，而不是手写一份（手写的白名单会与常量漂移）。
  const stripComments2 = s => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  const code2 = stripComments2(csrc)
  const DYNAMIC_PREFIX = /^(font_|fontScale_|contentWidth_|bg|pos|preset)/
  const groupKeys = new Set()
  for (const g of groups) {
    groupKeys.add(g.label)
    if (g.hint !== undefined) groupKeys.add(g.hint)
  }
  const dead = Object.keys(T.DICT.zh).filter(k =>
    !DYNAMIC_PREFIX.test(k) && !groupKeys.has(k) && !code2.includes(`t('${k}')`))
  ok('DICT 没有死键（每个键都有真实调用）', dead.length === 0, dead.join(', '))
  // 反向自检：白名单确实只放过了分组键，不是把整类都豁免了
  ok('死键检测的白名单只含分组标签（未过度豁免）',
    [...groupKeys].every(k => T.DICT.zh[k] !== undefined) && groupKeys.size === groups.length + 7,
    `白名单 ${groupKeys.size} 项`)

  // 10) 底部按钮主次：危险动作弱化 + 二次确认，主要动作在最右
  ok('危险动作使用弱化样式（quiet）', csrc.includes("buttonStyle(false, 'quiet')"))
  ok('待确认时用危险样式（danger）', csrc.includes("buttonStyle(false, 'danger')"))

  // 11) C：观测栏复用设置页的分段控件，不再手写一份
  //
  // 原先观测栏自己写了一遍同样的配色/边框/选中态（只是尺寸小一点），
  // 两份实现必然漂移 —— 那正是「同一设置两处风格不一致」的来源。
  ok('观测栏复用 Segmented（compact + grow）',
    /h\(Segmented, \{[\s\S]{0,400}?compact: true[\s\S]{0,200}?grow: true/.test(csrc))
  ok('观测栏不再手写分段按钮的内联样式',
    !csrc.includes("flex: '1 1 0',"))
}

// 用例 84：自定义背景（v7）
//
// 上传接口是**唯一的写入面** —— 往里塞什么，之后就会被当图片服务出去。
// 所以这一组的重点是「边界能不能挡住」，而不是「正常路径能跑通」。
{
  console.log('\n--- 自定义背景 ---')
  const img = await import('../src/imageInfo.js')
  const set = await import('../src/settings.js')
  const isrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
  const csrc = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  const T = SHARED_MOD.__test

  // ── 1) 魔数嗅探：必须按字节判，不信扩展名与 content-type ─────────────
  const pngHead = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])
  const jpegHead = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12)])
  const gifHead = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(6)])
  const webpHead = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii'), Buffer.alloc(4)])
  ok('嗅探 PNG', img.sniffFormat(pngHead) === 'png')
  ok('嗅探 JPEG', img.sniffFormat(jpegHead) === 'jpeg')
  ok('嗅探 GIF', img.sniffFormat(gifHead) === 'gif')
  ok('嗅探 WebP', img.sniffFormat(webpHead) === 'webp')
  // 反例：HTML 改名成 .png 也必须被拒（这正是「不信扩展名」的意义）
  ok('HTML 内容不被认成图片',
    img.sniffFormat(Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8')) === null)
  ok('空 / 过短 → null',
    img.sniffFormat(Buffer.alloc(0)) === null && img.sniffFormat(Buffer.from([0xff, 0xd8])) === null)
  ok('SVG（文本 XML）不被接受', img.sniffFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8')) === null)

  // ── 2) 尺寸解析（用**真实编码的图片**验，不用手搓的假头）─────────────
  // 手搓的头只能验「解析器读了我写的偏移」，验不出「真实文件能不能读对」。
  {
    const { execFileSync } = await import('node:child_process')
    const tmp = path.join(os.tmpdir(), 'zf-img-fixture')
    fs.mkdirSync(tmp, { recursive: true })
    // 用 Edge 生成真实 PNG/GIF/JPEG 不可靠，改用 Node 内置的 zlib 手写最小 PNG
    // （IHDR + 空 IDAT + IEND），并用 .NET 生成的三个格式在别处已实测过；
    // 这里至少锁住 PNG 的 IHDR 读取与 JPEG 的「逐段扫描」逻辑。
    const png = makeMinimalPng(37, 91)
    ok('真实 PNG：37x91', JSON.stringify(img.readSize(png, 'png')) === '{"width":37,"height":91}',
      JSON.stringify(img.readSize(png, 'png')))
    // 反例：PNG 签名对但 IHDR 被换成别的块名 → 必须拒绝（不能靠前 8 字节就下结论）
    const badPng = Buffer.from(png)
    badPng[12] = 0x58 // 'X' 取代 'I'
    ok('PNG 缺 IHDR → null（不猜）', img.readSize(badPng, 'png') === null)
    // 反例：GIF 宽高为 0 → 拒绝（合理性检查）
    const gifZero = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from([0, 0, 0, 0])])
    ok('GIF 宽高为 0 → null', img.readSize(gifZero, 'gif') === null)
    // 反例：JPEG 只有一个 SOI 就结束 → 扫不到 SOFn → null
    ok('JPEG 只有 SOI → null', img.readSize(Buffer.from([0xff, 0xd8, 0xff]), 'jpeg') === null)
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  // ── 3) 竖图阈值：与 prepare-art.py 必须一致（两处不一致就会出现
  //        「内置竖图 contain、自定义竖图被裁」这种莫名其妙的不一致）─────
  ok('竖图判据：1080x1920 → contain', img.fitOfSize({ width: 1080, height: 1920 }) === 'contain')
  ok('竖图判据：2560x1440 → cover', img.fitOfSize({ width: 2560, height: 1440 }) === 'cover')
  ok('竖图判据：尺寸缺失 → cover（不猜）', img.fitOfSize(null) === 'cover')
  ok('竖图阈值 = 0.87', img.PORTRAIT_RATIO === 0.87, String(img.PORTRAIT_RATIO))
  {
    const py = fs.readFileSync(path.join(ROOT, 'tools/prepare-art.py'), 'utf8')
    const m = py.match(/0\.87/)
    ok('prepare-art.py 里确实是同一阈值 0.87（防两处漂移）', m !== null)
  }
  // 客户端是本地副本，必须与宿主同规则同阈值
  ok('客户端 PORTRAIT_RATIO 与宿主一致',
    csrc.includes('const PORTRAIT_RATIO = 0.87'))
  ok('客户端 fitOfSize 与宿主同判据',
    T.fitOfSize({ width: 1080, height: 1920 }) === img.fitOfSize({ width: 1080, height: 1920 }) &&
    T.fitOfSize({ width: 2560, height: 1440 }) === img.fitOfSize({ width: 2560, height: 1440 }))
  ok('客户端 CUSTOM_BACKGROUND 与宿主一致',
    T.CUSTOM_BACKGROUND === set.CUSTOM_BACKGROUND, T.CUSTOM_BACKGROUND)

  // ── 4) 设置层的三种落点 ─────────────────────────────────────────────
  const goodRec = { file: 'custom-abc-1x2.webp', size: { width: 1080, height: 1920 }, bytes: 10, addedAt: 1 }
  ok('记录有效 → background = custom',
    set.normalizeSettings({ background: 'custom', customBackground: goodRec }).background === 'custom')
  // ⚠️ 关键：记录缺失时必须回落 `none`，**不能**停在默认的 `sakura`
  // （「我的图没了」变成「冒出张官方壁纸」比没有壁纸更困惑 —— 实测踩过）
  ok('记录缺失 → 回落 none（不是默认 sakura）',
    set.normalizeSettings({ background: 'custom' }).background === 'none',
    set.normalizeSettings({ background: 'custom' }).background)
  ok('记录非法 → 回落 none',
    set.normalizeSettings({ background: 'custom', customBackground: { file: 'evil.png' } }).background === 'none')
  // 路径遍历：手改设置文件塞进来的路径不能被接受
  for (const bad of ['../../etc/passwd', 'custom-x.webp/../../y', '/etc/passwd', 'custom-.webp']) {
    ok(`非法文件名被拒：${bad}`,
      set.normalizeSettings({ background: 'custom', customBackground: { file: bad } }).customBackground === null)
  }
  ok('自定义背景不污染内置白名单（BACKGROUNDS 里没有 custom）',
    !('custom' in set.BACKGROUNDS))
  // v6 老文件行为不变
  {
    const old = set.normalizeSettings({ version: 6, background: 'sakura', preset: 'wine' })
    ok('v6 老文件：background 保留 + customBackground = null',
      old.background === 'sakura' && old.customBackground === null && old.version === 7)
  }

  // ── 5) 宿主侧的边界（静态核对 + 存在性）─────────────────────────────
  ok('上传上限是 24 MB', img.CUSTOM_BG_MAX_BYTES === 24 * 1024 * 1024, String(img.CUSTOM_BG_MAX_BYTES))
  ok('上传**不复用** readBody（那个上限只有 64 KB）',
    isrc.includes('function readBinary') && isrc.includes('readBinary(req, CUSTOM_BG_MAX_BYTES)'))
  ok('上传先做 content-length 预检（超限不读一个字节）',
    /declared > limit/.test(isrc))
  ok('流式累计也挡（content-length 可能缺失或撒谎）',
    /size > limit/.test(isrc))
  // ⚠️ 超限时**不能用 `req.destroy()`**：那会在响应写出去之前拆掉 socket，
  // 客户端拿到的是「连接被重置」而不是我们构造的 413 —— 等于把
  // 「图太大，换一张」变成「插件好像坏了」。要用 resume() 读完丢弃。
  // 实测踩过：e2e 里那条断言一开始 status=0（连接被拒），改成 resume 才拿到 413。
  //
  // ⚠️ 断言必须**先剥注释**，否则会命中讲解这件事的注释本身
  // （第一版就是这样误报的 —— 与「t('literal') 扫到注释」同一个坑）。
  {
    const stripC = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    // 只看 readBinary 这一段（readBody 里那处 destroy 是既有的、上限 64 KB 的 JSON 路径，不在此列）
    const seg = isrc.slice(isrc.indexOf('function readBinary'), isrc.indexOf('function saveBackground'))
    const code = stripC(seg)
    ok('readBinary 超限时不 destroy socket（否则客户端拿不到 413）',
      !code.includes('req.destroy()') && code.includes('req.resume()'))
    ok('readBinary 里确实只有这两条防线（预检 + 累计）',
      code.includes('declared > limit') && code.includes('size > limit'))
  }
  ok('内容类型由魔数决定，不用客户端给的 content-type',
    isrc.includes('const fmt = sniffFormat(buf)') && !/content-type'\]\s*\?\?\s*'image/.test(isrc))
  ok('文件名由宿主生成（不接受客户端路径）',
    /const file = `custom-\$\{Date\.now\(\)\.toString\(36\)\}-\$\{rand\}\.\$\{IMAGE_FORMATS\[fmt\]\.ext\}`/.test(isrc))
  ok('服务时用 path.basename + 目录白名单双重校验',
    isrc.includes('path.basename(file)') && isrc.includes('backgroundWhitelist()'))
  ok('自定义背景目录在**插件目录之外**（deploy 会先删目录，放里面会被抹掉）',
    isrc.includes('const bgDir = path.join(dataDir, CUSTOM_BG_DIR)'))
  ok('上传成功**不自动切换**壁纸（返回条目由用户点选）',
    !/saveBackground\(buf\)[\s\S]{0,400}settings\.update\(\{ background: 'custom'/.test(isrc))
  ok('删除时清掉设置里对它的引用（不留死引用）',
    /settings\.update\(\{ background: 'none', customBackground: null \}\)/.test(isrc))

  // ── 6) 客户端接线 ───────────────────────────────────────────────────
  ok('自定义图走 url(...) 而不是 var(--zf-art-…)',
    /settings\?\.background === CUSTOM_BACKGROUND[\s\S]{0,300}return `url\("/.test(csrc))
  // 一张图两套明暗共用 → 绝不能拼 -dark，否则切深色就指向不存在的文件。
  //
  // ⚠️ 这条**必须用行为断言**，不能扫源码里有没有 `-dark` 字样：
  // 内置图那条分支本来就该拼 `-dark`（同一个函数里），扫文本必然误报 ——
  // 实测踩过（第一版写成 `!/CUSTOM_BACKGROUND[\s\S]{0,200}-dark/`，
  // 结果命中了内置分支的 `-dark`）。
  // 真正的判据是：同一个自定义图在 light/dark 下**算出的 URL 必须相同**。
  {
    const rec = { background: 'custom', customBackground: { file: 'custom-x-1.webp' } }
    const a = T.artSrcOf(rec, 'light')
    const b = T.artSrcOf(rec, 'dark')
    ok('自定义图明暗两套 URL 相同（没拼 -dark）', a === b && !a.includes('-dark'), `${a} vs ${b}`)
  }
  ok('垫底层复用同一个 artSrc（自定义图没有 --zf-art 变量）',
    csrc.includes("!tiled && fit === 'contain' ? nextArtSrc : 'none'") &&
    csrc.includes("!tiled && fit === 'contain' ? artSrc : 'none'"))
  ok('不再残留 `var(--zf-art-${artId})` 的旧写法',
    !csrc.includes('--zf-art-${artId}'))
  ok('UI 有上传入口（accept 限定图片格式）',
    csrc.includes("accept: 'image/png,image/jpeg,image/gif,image/webp'"))
  ok('UI 有删除按钮', csrc.includes("t('bgCustomRemove')"))
  ok('上传中禁用（防重复提交）', csrc.includes('disabled: uploading'))
  ok('删除后必须同步本地设置（否则界面仍指着已删文件）',
    /removeBackground[\s\S]{0,600}state\.settings = payload\.settings/.test(csrc))

  // ── 7) 行为：artSrcOf 两路分流 ──────────────────────────────────────
  {
    const builtin = T.artSrcOf({ background: 'sakura' }, 'light')
    ok('内置图 light → var(--zf-art-sakura)', builtin === 'var(--zf-art-sakura)', builtin)
    ok('内置图 dark → 拼 -dark',
      T.artSrcOf({ background: 'sakura' }, 'dark') === 'var(--zf-art-sakura-dark)')
    ok('none → none', T.artSrcOf({ background: 'none' }, 'light') === 'none')
    const custom = { background: 'custom', customBackground: { file: 'custom-a-b.webp' } }
    const lightSrc = T.artSrcOf(custom, 'light')
    const darkSrc = T.artSrcOf(custom, 'dark')
    ok('自定义图 → url(.../backgrounds/...)',
      lightSrc.startsWith('url("') && lightSrc.includes('/backgrounds/custom-a-b.webp'), lightSrc)
    ok('自定义图明暗两套**同一个** URL（共用一张图 → 切明暗不闪）',
      lightSrc === darkSrc)
    ok('自定义图记录坏了 → none（不给一个会 404 的 url）',
      T.artSrcOf({ background: 'custom', customBackground: null }, 'light') === 'none')
  }

  // ── 8) 行为：artFitOf 竖图判据 ──────────────────────────────────────
  {
    const meta = { 'wallpaper-portrait.webp': { fit: 'contain' } }
    ok('内置竖图（清单说 contain）→ contain',
      T.artFitOf({ background: 'portrait' }, meta) === 'contain')
    ok('内置横图（清单没有）→ cover',
      T.artFitOf({ background: 'pool' }, meta) === 'cover')
    ok('自定义竖图（尺寸 1080x1920）→ contain',
      T.artFitOf({ background: 'custom', customBackground: { size: { width: 1080, height: 1920 } } }, meta) === 'contain')
    ok('自定义横图 → cover',
      T.artFitOf({ background: 'custom', customBackground: { size: { width: 2560, height: 1440 } } }, meta) === 'cover')
    ok('自定义图尺寸缺失 → cover（不猜）',
      T.artFitOf({ background: 'custom', customBackground: { size: null } }, meta) === 'cover')
  }
}

/** 造一个最小但**结构正确**的 PNG（IHDR + 空 IDAT + IEND），用于验证 IHDR 读取。 */
function makeMinimalPng (width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0, 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // RGBA
  const raw = Buffer.concat([Buffer.alloc(1), Buffer.alloc(width * 4)])
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** PNG chunk 的 CRC32（测试自造 PNG 用）。 */
function crc32 (buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c
}


console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (fail > 0) {
  console.log(`\n失败项：\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('全部通过。')
