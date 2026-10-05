/**
 * 庄方宜主题 · 浏览器半边
 *
 * 手写 ModuleLoader bundle：无构建步骤，除外壳已提供的 `react` 外无依赖。
 *
 * 契约（与同 profile 内已验证的插件一致）：
 *   · 服务以属性形式拿到（`ctx.theme` / `ctx.slots` / `ctx.locale`），
 *     由 `inject` 声明后由框架注入 —— 不是 `ctx.get(name)`（那是动态半边的写法）；
 *   · 样式用 `ctx.effect` 自建 `<style>` 并在返回的清理函数里移除；
 *   · 插槽是 `ctx.slots.inject(slot, () => ctx.slots.register({...}, Component))`。
 *
 * 三件事：
 *   1. 把 4 预设 × 2 明暗 = 8 个主题注册进官方主题注册表，出现在「外观」下拉；
 *   2. 按「明暗模式」选择两条生效路径（见下）；
 *   3. 注册 `settings.section` 设置页与 `sidebar.footer.action` 快捷开关。
 *
 * 两条生效路径（关键设计，来自外壳源码的硬约束）：
 *
 *   · 跟随系统（默认）→ `overrideTokens('dsh-zhuang-fangyi', {token:{light,dark}})`
 *     不改 preference。外壳 presenter 把 `html[data-ds-theme-source]` 设为
 *     scheme，桌面壳的 preload 再转发给 `nativeTheme.themeSource` —— 一旦
 *     preference 变成固定 id，`prefers-color-scheme` 就被锁定，系统换主题不再
 *     触发。所以「跟随系统」必须走 token 层而不是 setTheme。
 *
 *   · 固定浅色/深色 → `setTheme('zhuang-light' | 'zhuang-dark')`
 *     走注册表，preference 为固定 id。注意第三方主题 id 不会被外壳持久化
 *     （`setTheme` 只在 `isThemePreference(id)` 时写盘，而内置偏好只有
 *     light/dark/system），所以本插件自己把设置存到宿主，启动时重设。
 *
 * 每个 token 必须同时给 light 与 dark：外壳 `validateOverrides` 对裸字符串直接
 * 抛错，原文即 "a single value goes illegible when the user switches color scheme"。
 */

window.__ModuleLoader__.load({
  id: 'dsh-zhuang-fangyi',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect } = React

    const NS = 'settings.zhuangFangyi'
    const LAYER = 'dsh-zhuang-fangyi'
    const ROUTE = '/api/zhuang-fangyi'
    const PRESETS = ['zhuang', 'burst', 'cyan', 'wine']
    const SCHEMES = ['system', 'light', 'dark']
    const BACKGROUNDS = [
      'none', 'sakura', 'promo', 'pool', 'ultrawide', 'dark',
      'portrait', 'vertical', 'contour'
    ]
    const POSITIONS = ['cover', 'right', 'tile']

    /** 文案。zh 为准，en 覆盖同一 key 集。 */
    const DICT = {
      zh: {
        nav: '庄方宜',
        title: '庄方宜主题',
        subtitle: '官方素材取色 · 浅色与深色各自适配',
        groupTheme: '主题',
        groupWallpaper: '背景',
        groupDecor: '装饰',
        enabled: '启用主题',
        enabledHint: '关闭后界面立即回到 DSH 默认配色',
        preset: '配色预设',
        scheme: '明暗模式',
        schemeSystem: '跟随系统',
        schemeLight: '固定浅色',
        schemeDark: '固定深色',
        schemeHint: '「跟随系统」下切换系统主题，配色与背景会一起跟随',
        background: '背景图',
        bgNone: '无',
        bgSakura: '樱花树下',
        bgPromo: '宣传 CG',
        bgPool: '樱花池',
        bgUltrawide: '超宽横幅',
        bgDark: '暗调水面',
        bgPortrait: '干员立绘卡',
        bgVertical: '竖版立绘',
        bgContour: '等高线纹理',
        opacity: '背景不透明度',
        blur: '背景模糊',
        position: '背景位置',
        posCover: '铺满',
        posRight: '靠右',
        posTile: '平铺',
        contourBorder: '等高线细边框',
        accentGlow: '强调色微光',
        accentGlowHint: '聚焦控件时显示一层主题色柔光',
        heroAvatar: '空白页头像',
        titlebarFollow: '标题栏跟随',
        titlebarFollowHint: '桌面版：让 Windows 原生标题栏按钮区跟随主题色',
        reset: '恢复默认',
        retry: '重试',
        loading: '正在读取设置…',
        loadFailed: '无法连接插件后端，暂用默认设置',
        saveFailed: '保存失败，设置可能未落盘',
        sidebarToggle: '庄方宜主题',
        px: 'px',
        percent: '%',
        // v2 皮肤层
        brandName: '庄方宜',
        rail: '观测栏',
        railTitle: '庄方宜 · 观测台',
        localOnly: '仅本地渲染',
        stats: '会话读数',
        turns: '轮次',
        steps: '步数',
        cache: '缓存命中',
        on: '已开启',
        off: '已关闭',
        groupSkin: '皮肤',
        railHint: '右栏展开时作为官方标签页显示，收起时为右侧浮层；原生面板展开时让位；窄于 1180px 隐藏',
        railWidth: '观测栏宽度',
        avatarBubbles: '头像与气泡重绘',
        avatarBubblesHint: '助手消息旁显示头像，并重绘用户气泡与输入框'
      },
      en: {
        nav: 'Zhuang Fangyi',
        title: 'Zhuang Fangyi Theme',
        subtitle: 'Colors sampled from official art · light and dark tuned separately',
        groupTheme: 'Theme',
        groupWallpaper: 'Background',
        groupDecor: 'Decorations',
        enabled: 'Enable theme',
        enabledHint: 'Turning this off restores the default DSH palette immediately',
        preset: 'Palette preset',
        scheme: 'Color scheme',
        schemeSystem: 'Follow system',
        schemeLight: 'Always light',
        schemeDark: 'Always dark',
        schemeHint: 'On "Follow system", switching the OS theme moves colors and wallpaper together',
        background: 'Background image',
        bgNone: 'None',
        bgSakura: 'Under the cherry tree',
        bgPromo: 'Promo key art',
        bgPool: 'Blossom pool',
        bgUltrawide: 'Ultrawide banner',
        bgDark: 'Dark water',
        bgPortrait: 'Operator card',
        bgVertical: 'Portrait art',
        bgContour: 'Contour lines',
        opacity: 'Background opacity',
        blur: 'Background blur',
        position: 'Background position',
        posCover: 'Fill',
        posRight: 'Right',
        posTile: 'Tile',
        contourBorder: 'Contour hairline border',
        accentGlow: 'Accent glow',
        accentGlowHint: 'Show a soft accent glow on focused controls',
        heroAvatar: 'Empty-state avatar',
        titlebarFollow: 'Follow in title bar',
        titlebarFollowHint: 'Desktop: let the native Windows caption follow the theme',
        reset: 'Restore defaults',
        retry: 'Retry',
        loading: 'Loading settings…',
        loadFailed: 'Cannot reach the plugin host; using defaults',
        saveFailed: 'Save failed; settings may not be persisted',
        sidebarToggle: 'Zhuang Fangyi theme',
        px: 'px',
        percent: '%',
        // v2 skin layer
        brandName: 'Zhuang Fangyi',
        rail: 'Observation rail',
        railTitle: 'Zhuang Fangyi · Observation',
        localOnly: 'local render only',
        stats: 'Session readout',
        turns: 'Turns',
        steps: 'Steps',
        cache: 'Cache hit',
        on: 'On',
        off: 'Off',
        groupSkin: 'Skin',
        railHint: 'Official tab when the right panel is open, side overlay when collapsed; yields to native panels; hidden below 1180px',
        railWidth: 'Rail width',
        avatarBubbles: 'Avatar and bubble restyle',
        avatarBubblesHint: 'Show an avatar beside assistant messages and restyle user bubbles and the composer'
      }
    }

    const PRESET_LABELS = {
      zhuang: { zh: '本体黄绿', en: 'Signature yellow-green' },
      burst: { zh: '大招墨青金', en: 'Ultimate ink-gold' },
      cyan: { zh: '青', en: 'Cyan' },
      wine: { zh: '酒红', en: 'Wine red' }
    }
    const BG_LABELS = {
      none: 'bgNone', sakura: 'bgSakura', promo: 'bgPromo', pool: 'bgPool',
      ultrawide: 'bgUltrawide', dark: 'bgDark', portrait: 'bgPortrait',
      vertical: 'bgVertical', contour: 'bgContour'
    }
    const POS_LABELS = { cover: 'posCover', right: 'posRight', tile: 'posTile' }

    const inject = ['theme', 'slots', 'locale']

    /* ------------------------------------------------------------------ *
     * 样式
     * ------------------------------------------------------------------ */

    /**
     * 把设置写进 CSS 自定义属性与装饰属性。
     *
     * CSS 结构由宿主 `structureStyle()` 提供（唯一来源），这里只改属性值。
     *
     * 关于「纱」：外壳 presenter 把全部 token 写成 body 的**行内样式**，所以
     * 改 token 值让外壳透出壁纸的做法会被它覆盖（实测无效）。这里改成给外壳
     * 那几层背景单独算一个半透明色 —— `--zf-veil*` 是外壳不认识的新变量，
     * presenter 不会碰，壁纸才能真的透出来。
     */
    /**
     * 当前生效的明暗方案。
     *
     * 两个来源都要看，且**以 DOM 属性优先**：
     *
     *   · `body[data-ds-dark-theme]` 是外壳 presenter 实际渲染出的方案 —— 最终事实。
     *     跟随系统时 OS 换主题，presenter 增删这个属性并 emit `theme/change`；
     *     此时 theme 快照的 colorScheme 仍是 light（内置主题的 colorScheme 不随
     *     OS 变），只看快照就会切错图。
     *   · theme 快照用于**启动阶段**：presenter 在插件跑起来之后才写属性，
     *     启动瞬间 DOM 还没有该属性，只看 DOM 会把固定深色误判成浅色。
     *
     * @param {object} theme - theme 服务
     * @returns {'light'|'dark'}
     */
    function currentScheme (theme) {
      const body = document.body
      if (body !== null && body.hasAttribute('data-ds-dark-theme')) return 'dark'
      try {
        const scheme = theme?.getTheme?.()?.active?.colorScheme
        if (scheme === 'light' || scheme === 'dark') return scheme
      } catch { /* 服务不可用 */ }
      return 'light'
    }

    function applyStyleVars (settings, roles, theme) {
      const root = document.documentElement
      const body = document.body
      if (root === null || body === null) return

      if (settings.enabled !== true) {
        root.removeAttribute('data-zf-wallpaper')
        body.removeAttribute('data-zf-wallpaper')
        body.removeAttribute('data-zf-glow')
        body.removeAttribute('data-zf-contour')
        return
      }

      const hasWallpaper = settings.background !== 'none'
      if (hasWallpaper) {
        // 上限 45 与 settings.js 的 BG_OPACITY_MAX 一致（client 是手写 bundle 不能 import）
          const alpha = Math.max(0, Math.min(45, settings.backgroundOpacity)) / 100
        const blur = Math.max(0, Math.min(16, settings.backgroundBlur))
        const pos = POSITIONS.includes(settings.backgroundPosition) ? settings.backgroundPosition : 'cover'

        // 纱的不透明度 = 1 - 壁纸强度。0% 壁纸 → 完全不透明（等同关闭）。
        const keep = 1 - alpha
        const scheme = currentScheme(theme)
        const preset = roles?.[settings.preset]?.[scheme]
        if (preset !== undefined) {
          root.style.setProperty('--zf-veil', toRgba(preset.base, keep))
          root.style.setProperty('--zf-veil-sidebar', toRgba(preset.sidebar, keep))
        }

        root.style.setProperty('--zf-art-src', `var(--zf-art-${settings.background}${scheme === 'dark' ? '-dark' : ''})`)
        root.style.setProperty('--zf-blur', `${blur}px`)
        // 模糊会把四边糊出去，轻微放大补上；不模糊时不放大，避免无谓重采样
        root.style.setProperty('--zf-art-scale', blur > 0 ? '1.04' : '1')
        root.style.setProperty('--zf-art-size', pos === 'tile' ? 'auto' : 'cover')
        root.style.setProperty('--zf-art-position',
          pos === 'tile' ? '0 0' : pos === 'right' ? 'right center' : 'center')
        root.style.setProperty('--zf-art-repeat', pos === 'tile' ? 'repeat' : 'no-repeat')
        root.setAttribute('data-zf-wallpaper', '')
        body.setAttribute('data-zf-wallpaper', '')
      } else {
        root.removeAttribute('data-zf-wallpaper')
        body.removeAttribute('data-zf-wallpaper')
      }

      // 装饰
      if (settings.accentGlow) body.setAttribute('data-zf-glow', '')
      else body.removeAttribute('data-zf-glow')
      if (settings.contourBorder) body.setAttribute('data-zf-contour', '')
      else body.removeAttribute('data-zf-contour')
      // Windows 标题栏拖拽区：关掉「标题栏跟随」时保持实色，避免文字压在图上
      if (settings.titlebarFollow === false) body.setAttribute('data-zf-opaque-titlebar', '')
      else body.removeAttribute('data-zf-opaque-titlebar')
    }

    /** `#RRGGBB` → `rgba(r, g, b, a)`。纱需要真 alpha，8 位 hex 也行但可读性差。 */
    function toRgba (hex, alpha) {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim())
      if (m === null) return `rgba(255,255,255,${alpha.toFixed(3)})`
      const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16))
      return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
    }

    /**
     * 明暗分流：壁纸与纱都要按 body 的暗色属性切到对应版本。
     * 由 `theme/change` 触发（外壳切换明暗时会 emit）。
     */
    function syncSchemeWallpaper (settings, roles, theme) {
      if (settings?.enabled !== true) return
      const scheme = currentScheme(theme)
      if (settings.background !== 'none') {
        document.documentElement.style.setProperty(
          '--zf-art-src', `var(--zf-art-${settings.background}${scheme === 'dark' ? '-dark' : ''})`)
      }
      const preset = roles?.[settings.preset]?.[scheme]
      if (preset !== undefined && settings.background !== 'none') {
        const keep = 1 - Math.max(0, Math.min(45, settings.backgroundOpacity)) / 100
        document.documentElement.style.setProperty('--zf-veil', toRgba(preset.base, keep))
        document.documentElement.style.setProperty('--zf-veil-sidebar', toRgba(preset.sidebar, keep))
      }
    }

    /* ------------------------------------------------------------------ *
     * 外壳元素定位与打标
     *
     * 要改外壳布局（右栏让位、气泡重绘、顶栏）就得稳定地找到外壳元素。
     * 实测本机存在**两套壳**，类名哈希完全不同：
     *
     *   桌面端（本机实际运行）  0.2.0-rc.2   `BynINW_frame` / `_rightbarCol`
     *   Web 端                  0.1.0-rc.7   `pI_x6G_frame` / `_detailsCol`
     *
     * 三种定位手段，按可靠性排序：
     *
     *   1. **语义 `data-*` 锚点**（最稳）—— 桌面壳暴露 456 个，如
     *      `[data-rightbar-col]`、`[data-chat-flow-kind]`、`[data-composer-card]`。
     *      这些是外壳给 React 组件打的，跨版本稳定。
     *   2. **`data-plugin-css` 反查哈希**（次稳）—— 外壳为每个 CSS Module 插入
     *      `style[data-plugin-css="<包名>/模块名.module.css"]`，其 textContent 里就是
     *      该模块**当前生效**的真实类名，正则提取即可，无需猜哈希。
     *      这一招学自 Mornye-Observation-Skin。
     *   3. **`[class*="_后缀"]` 兜底** —— 样式表里用这一条保证**首帧**
     *      （JS 还没跑）就有正确样式。
     *
     * 找到后打上本插件自己的 `data-zf-*`，CSS 优先认这些属性 —— 外壳换版本时
     * 只要定位能自愈，样式表一个字都不用改。
     * ------------------------------------------------------------------ */

    /** 外壳 CSS Module 名（两套壳同名，只是哈希前缀不同）。 */
    const FRAME_MODULE = 'AppFrame'

    /**
     * 反查 CSS Module 的真实类名。
     *
     * 外壳的类名形如 `Hash_part`，`Hash` 由 CSS 内容决定、跨版本会变；
     * 而 `<style data-plugin-css=".../AppFrame.module.css">` 的文本里就是
     * 该模块的全部规则，所以能读出**当前生效**的哈希。
     *
     * 两个坑：
     *   · 类名可能以转义数字开头（如 `_7yHdaG_row`），CSS 里写作 `\37 yHdaG`，
     *     所以要先反转义再匹配；
     *   · 插件可能先于外壳渲染，此时标签还不存在 → 返回 null，下次再试。
     */
    function makeModuleClass (doc) {
      const cache = new Map()
      return function moduleClass (name, part) {
        const key = `${name}/${part}`
        if (cache.has(key)) return cache.get(key)
        let tag = null
        try {
          tag = doc.querySelector(`style[data-plugin-css$="/${name}.module.css"]`)
        } catch { /* name 含特殊字符 */ }
        if (tag === null || tag === undefined) return null
        const text = String(tag.textContent ?? '')
          .replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, ch) =>
            hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : ch)
        const match = text.match(new RegExp(`\\.([\\w-]+_${part})(?=[\\s{.:\\[>,#])`))
        if (match === null) return null
        cache.set(key, match[1])
        return match[1]
      }
    }

    /**
     * 打标器：写 `data-zf-*` 到外壳元素，并保证可完全还原。
     *
     * 打标是**幂等**的；`tagged` 记录「谁被打了什么」，元素被 React 卸载时
     * 清掉记录与残留属性（否则会泄漏，且重挂载后属性会串）。
     */
    function makeMarker () {
      const tagged = new Map()
      return {
        /** 幂等打标（无值属性）。 */
        mark (node, attr) {
          if (node === null || node === undefined) return false
          if (node.hasAttribute(attr)) return false
          node.setAttribute(attr, '')
          if (!tagged.has(node)) tagged.set(node, new Set())
          tagged.get(node).add(attr)
          return true
        },
        /** 打带值属性（值不同才写）。 */
        set (node, attr, value) {
          if (node === null || node === undefined) return false
          const next = String(value)
          if (node.getAttribute(attr) === next) return false
          node.setAttribute(attr, next)
          if (!tagged.has(node)) tagged.set(node, new Set())
          tagged.get(node).add(attr)
          return true
        },
        /** 清理已断开的节点，返回清理数。 */
        prune () {
          let removed = 0
          for (const [node, attrs] of [...tagged]) {
            if (node.isConnected) continue
            for (const attr of attrs) {
              try {
                node.removeAttribute(attr)
              } catch { /* 已不可操作 */ }
            }
            tagged.delete(node)
            removed += 1
          }
          return removed
        },
        /** 全部还原（卸载时）。 */
        reset () {
          for (const [node, attrs] of tagged) {
            for (const attr of attrs) {
              try {
                node.removeAttribute(attr)
              } catch { /* 已不可操作 */ }
            }
          }
          tagged.clear()
        },
        count: () => tagged.size
      }
    }

    /**
     * 从聊天区推导会话状态。
     *
     * 判定顺序照抄 Mornye 已验证的优先级（它处理了「历史错误不该覆盖当前
     * 回合」这类坑）：tool > running > error > done > ready > idle。
     */
    function readSessionState (doc) {
      const rows = [...doc.querySelectorAll('[data-chat-flow-kind]')]
      if (rows.length === 0) return 'idle'
      const visible = node => Boolean(node && node.getClientRects().length > 0)
      const kinds = rows.map(r => r.dataset.chatFlowKind)
      const lastUser = kinds.lastIndexOf('user')
      const turn = lastUser >= 0 ? rows.slice(lastUser) : rows
      const tool = turn.some(row => row.dataset.chatFlowKind === 'tool-call' &&
        [...row.querySelectorAll('[data-state="running"]')].some(visible))
      if (tool) return 'tool'
      const streaming = turn.some(row => [...row.querySelectorAll('[data-streaming="true"]')].some(visible))
      const stop = [...doc.querySelectorAll('button[aria-label="停止生成"],button[aria-label="Stop generating"]')]
        .some(visible)
      if (streaming || stop) return 'running'
      if (turn.some(row => ['turn-error', 'turn-max-tokens'].includes(row.dataset.chatFlowKind))) return 'error'
      if (turn.some(row => row.dataset.chatFlowKind === 'turn-tail')) return 'done'
      return 'ready'
    }

    /**
     * 从统计行解析轮次 / 步数 / 缓存命中。
     *
     * 只读外壳已渲染的文字（`[data-composer-stats]`），**不遍历消息正文** ——
     * 本插件是皮肤，不该读取会话内容。
     */
    function readStats (doc) {
      const text = doc.querySelector('[data-composer-stats]')?.textContent ?? ''
      const counts = text.match(/(\d+)\s*(?:轮|turns?)\s*(?:[·&]\s*)?(\d+)\s*(?:步|steps?)/i)
      const cache = text.match(/(?:缓存命中|Cache hit)\s*(\d+(?:\.\d+)?)%/i)
      return {
        turns: counts?.[1] ?? '—',
        steps: counts?.[2] ?? '—',
        cache: cache ? `${cache[1]}%` : '—'
      }
    }

    /**
     * 原生右栏是否展开。
     *
     * 桌面壳用 `data-rightbar-collapsed`，Web 壳用 `data-details-collapsed`；
     * 有该属性 = 已折叠，所以「展开」= 两个都没有。
     */
    function nativeRightbarOpen (doc) {
      const frame = doc.querySelector('[class*="_frame"]')
      if (frame === null || frame === undefined) return false
      return !frame.hasAttribute('data-rightbar-collapsed') &&
        !frame.hasAttribute('data-details-collapsed')
    }

    /**
     * 皮肤运行时：给外壳元素打标，并维持右栏的显隐。
     *
     * 为什么需要 `MutationObserver`：外壳是 React 渲染的，侧栏折叠、切换会话、
     * 右栏开合都会重挂载子树 —— 打标会随元素一起消失。所以要在变更后重新打标。
     *
     * 变更过滤用 `attributeFilter` 收窄到真正相关的属性：不收窄的话，流式输出
     * 时每一帧都会触发（聊天区 DOM 高频变化），白白烧 CPU。
     *
     * @param {object} runtime - { state, onLayout } —— `state` 由 apply() 提供
     *   （本函数定义在 apply() 之外，拿不到它的闭包，所以显式传入；
     *   踩过两次「定义在外面却引用 apply 内的 state」的坑）
     * @returns {{ refresh: () => void, dispose: () => void }}
     */
    function mountSkin (runtime) {
      const { state } = runtime
      const doc = document
      const moduleClass = makeModuleClass(doc)
      const marker = makeMarker()
      let frame = 0
      let disposed = false

      /** 找外壳元素：类名反查优先，`[class*="_后缀"]` 兜底。 */
      function locate (part) {
        const cls = moduleClass(FRAME_MODULE, part)
        if (cls !== null) {
          const hit = doc.getElementsByClassName(cls)[0]
          if (hit !== undefined) return hit
        }
        // 兜底：语义后缀匹配（两套壳都命中；右栏两套壳名字不同）
        const suffix = part === 'rightbarCol' ? '_rightbarCol' : `_${part}`
        const alt = part === 'rightbarCol' ? '_detailsCol' : null
        return doc.querySelector(`[class*="${suffix}"]`) ??
          (alt === null ? null : doc.querySelector(`[class*="${alt}"]`))
      }

      function refresh () {
        frame = 0
        if (disposed) return
        marker.prune()

        const frameEl = locate('frame')
        const sidebar = locate('sidebarCol')
        const center = locate('centerCol')
        const rightbar = locate('rightbarCol')

        marker.mark(frameEl, 'data-zf-frame')
        marker.mark(sidebar, 'data-zf-sidebar')
        marker.mark(center, 'data-zf-center')
        marker.mark(rightbar, 'data-zf-rightbar')

        // 中栏**内容**根元素也要打标（壁纸被它挡住，实测确认）。
        //
        // 中栏里是 `ConversationRoot`，它的根元素自己铺了不透明背景：
        //   `.Dc7zOa_root{background:var(--dsw-alias-bg-base);...}`
        // 只让「三列」带纱是不够的 —— 内容层也得透明，否则壁纸全被盖住
        // （实测中栏 153 个采样点唯一色数 = 1，纯色）。
        //
        // 它没有语义 `data-*` 锚点（只有 `data-phase`），所以走 CSS Module
        // 反查哈希。多个模块都试：桌面端是 `ConversationRoot`，其它壳可能是
        // `ChatView` / `HeroShell`，命中即打标（`mark` 幂等）。
        for (const [mod, part] of [
          ['ConversationRoot', 'root'],
          ['ChatView', 'root'],
          ['HeroShell', 'root'],
          ['ConversationRoot', 'scrollBody'],
          ['ChatView', 'scroll']
        ]) {
          const cls = moduleClass(mod, part)
          if (cls === null) continue
          for (const el of doc.getElementsByClassName(cls)) {
            marker.mark(el, part === 'scrollBody' || part === 'scroll' ? 'data-zf-scroll' : 'data-zf-content')
          }
        }

        // 顶栏 / 右栏开关与宽度（写 body，CSS 用属性选择器）
        //
        // 注意 `s` 可能还是 null：mountSkin 在 apply() 里**同步**建立，而设置要等
        // `load()` 的 fetch 回来才有。所以下面每处都要容忍 null —— 首次 refresh
        // 会写一组「未启用」的保守值，等 load() 完成后再 refresh 一次修正。
        const s = state.settings
        const on = s?.enabled === true
        const body = doc.body
        // 顶栏已移除，不再写 data-zf-topbar（保留 settings.topbar 字段仅为兼容旧设置文件）

        // 右栏只在「插件启用 + 用户开启 + 原生右栏未展开 + 视口够宽」时显示
        const wantRail = on && s.rail !== false &&
          !nativeRightbarOpen(doc) &&
          (typeof window !== 'undefined' ? window.innerWidth : 1600) >= 1180
        state.railShown = wantRail
        if (body !== null) body.setAttribute('data-zf-rail', wantRail ? 'on' : 'off')
        // 与 `settings.js` 的 RAIL_WIDTH 保持一致（client.js 是手写 bundle、
        // 不能 import，所以这里用字面量并在测试里断言两边相等）。
        const width = Math.max(240, Math.min(380, Number(s?.railWidth) || 288))
        doc.documentElement.style.setProperty('--zf-rail-width', `${width}px`)

        // 头像与气泡
        if (body !== null) {
          if (on && s.avatarBubbles !== false) body.setAttribute('data-zf-avatar', '')
          else body.removeAttribute('data-zf-avatar')
        }
        doc.documentElement.style.setProperty(
          '--zf-avatar-image', `url("${ROUTE}/art/avatar.webp")`)

        // 会话状态（右栏状态点与读数）
        state.sessionState = readSessionState(doc)
        state.stats = readStats(doc)
        if (body !== null) body.setAttribute('data-zf-session-state', state.sessionState)

        runtime.onLayout?.()
      }

      const schedule = () => {
        if (disposed || frame !== 0) return
        frame = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(refresh)
          : setTimeout(refresh, 16)
      }

      // 只在真正相关的属性变化时重跑：不收窄的话流式输出每帧都会触发
      const observer = new MutationObserver(records => {
        if (records.some(r => !r.target.closest?.('.zf-rail'))) schedule()
      })
      observer.observe(doc.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          'data-rightbar-collapsed', 'data-details-collapsed',
          'data-sidebar-collapsed', 'data-ds-dark-theme',
          'data-chat-flow-kind', 'data-streaming', 'data-state', 'hidden'
        ]
      })

      const onResize = () => schedule()
      if (typeof window !== 'undefined') window.addEventListener('resize', onResize)

      refresh()

      return {
        refresh,
        dispose () {
          disposed = true
          observer.disconnect()
          if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
          else clearTimeout(frame)
          marker.reset()
          const body = doc.body
          if (body !== null) {
            for (const attr of ['data-zf-rail', 'data-zf-avatar', 'data-zf-session-state']) {
              body.removeAttribute(attr)
            }
          }
          doc.documentElement.style.removeProperty('--zf-rail-width')
          doc.documentElement.style.removeProperty('--zf-avatar-image')
        }
      }
    }

    /* ------------------------------------------------------------------ *
     * 插件主体
     * ------------------------------------------------------------------ */

    function apply (ctx) {
      const theme = ctx.theme
      const slots = ctx.slots
      const locale = ctx.locale

      // 窗口重新获得焦点时重拉设置（见 `resyncSettings` 的说明）。
      // `focusin` 比 `focus` 更稳：后者在某些 Electron 场景不冒泡。
      if (typeof window !== 'undefined') {
        window.addEventListener('focusin', resyncSettings)
        window.addEventListener('online', resyncSettings)
        ctx.effect(() => () => {
          window.removeEventListener('focusin', resyncSettings)
          window.removeEventListener('online', resyncSettings)
        }, 'zhuang-fangyi: resync listeners')
      }

      // 外壳明暗切换（「外观」里切、或跟随系统时 OS 切换）→ 重渲染。
      // 设置页的壁纸缩略图按当前明暗选文件名，不通知的话切完会停留在旧图上。
      try {
        const offTheme = ctx.on?.('theme/change', emit)
        ctx.effect(() => () => offTheme?.(), 'zhuang-fangyi: theme change')
      } catch { /* 没有事件服务的宿主：缩略图晚一次交互才刷新，无害 */ }

      /** 文案读取器。 */
      const t = key => {
        try {
          const hit = locale?.bind?.(NS)?.(key)
          if (typeof hit === 'string' && hit !== key) return hit
        } catch { /* 未注册时回落 */ }
        return DICT.zh[key] ?? key
      }

      /** 运行时状态。 */
      const state = {
        settings: null,
        themes: [],
        overrides: {},
        themeRoles: {},
        layerDispose: null,
        registered: new Map(),
        heroDispose: null,
        brandMarkDispose: null,
        brandNameDispose: null,
        listeners: new Set(),
        lastError: null,
        // 外壳打标运行时（由 mountSkin 建立）
        locator: null,
        marker: null,
        skin: null,
        observer: null,
        /** 皮肤样式表 `<style id="zf-style">`（由 ensureStyle 插入）。 */
        styleEl: null,
        /**
         * 样式表是否已就绪。
         *
         * **顶栏与右栏只在它为 true 时才渲染** —— 这是防呆：这两个组件是
         * 纯类名驱动的（`.zf-rail`），一旦 CSS 缺失就会裸渲染，
         * 里面的 `<img>` 会按**原始尺寸 512×512** 铺在界面上，看起来像
         * 「一张巨大的脸盖住了整个 UI」。
         *
         * 实测踩过：桌面端 `tapIndex` 不执行 → CSS 完全缺失 → 就是这个症状。
         * 宁可不显示皮肤，也不能糊在界面上。
         */
        styleReady: false,
        frame: 0,
        railShown: false,
        sessionState: 'idle',
        stats: { turns: '—', steps: '—', cache: '—' },
        /**
         * 渲染计数（诊断用）。
         *
         * 记「组件被调用几次」与「每次为什么返回 null」，这样自检能直接回答
         * 「为什么观测栏没出现」，不必靠推理 React 时序（踩过这个坑）。
         */
        renderCounts: {
          railCalls: 0, railNull: 0, railRendered: 0, lastNullReason: null,
          tabCalls: 0, tabNull: 0, tabRendered: 0, lastTabNullReason: null
        },
        /** 官方右栏 tab 是否注册成功（**注册 ≠ 打开**，仅供自检）。 */
        tabRegistered: false,
        /**
         * 我们那个官方 tab **当前挂着几个内容实例**。
         *
         * 这是「tab 真的可见」的唯一可信信号 —— `tabRegistered` 只说明类型
         * 声明成功，tab 可能根本没被用户打开（实测踩过：据此让位导致右边全空）。
         * 由 `RailTab` 的 effect 按 `rendered` 增减。
         */
        tabMounted: 0,
        /** 官方右栏导航控制器（`ctx.sidebarRight`），无该服务的平台为 null。 */
        sidebarRight: null,
        /**
         * 「这一个右栏展开周期内是否已尝试打开过我们的 tab」。
         * 面板收起时清空 → 下次展开重新出现；明确非 null 时不再打扰
         * （尊重用户手动关闭）。
         */
        railTabOpenedFor: null,
        /** tab 的两个 disposer（阶段一 / 阶段二各一个，卸载时都要释放）。 */
        tabTypeDispose: null,
        tabBodyDispose: null,
        /** tab 相关的诊断信息（自检里看）。 */
        tabDiag: { attempted: false, ok: false, error: null, kind: null, opened: false, openError: null }
      }

      const emit = () => {
        for (const fn of [...state.listeners]) {
          try {
            fn()
          } catch (error) {
            console.warn('[zhuang-fangyi] 订阅回调异常', error)
          }
        }
      }

      async function api (path, init) {
        const res = await fetch(`${ROUTE}${path}`, {
          headers: { 'content-type': 'application/json' },
          ...init
        })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      }

      /* ---------------- 主题注册 ---------------- */

      /** 注册 8 个主题；id 冲突时跳过该条并继续，不影响其它预设。 */
      function registerThemes () {
        for (const def of state.themes) {
          if (state.registered.has(def.id)) continue
          try {
            const dispose = theme.register({
              id: def.id,
              colorScheme: def.colorScheme,
              tokens: def.tokens
            })
            state.registered.set(def.id, dispose)
          } catch (error) {
            console.warn(`[zhuang-fangyi] 主题 ${def.id} 注册失败：${error?.message ?? error}`)
          }
        }
      }

      function unregisterThemes () {
        for (const dispose of state.registered.values()) {
          try {
            dispose()
          } catch { /* 已卸载 */ }
        }
        state.registered.clear()
      }

      /* ---------------- 生效路径 ---------------- */

      /** 撤掉当前生效方式（token 层 + 装饰属性）。 */
      function teardown () {
        if (state.layerDispose !== null) {
          try {
            state.layerDispose()
          } catch { /* 已失效 */ }
          state.layerDispose = null
        }
        const body = document.body
        const root = document.documentElement
        if (body !== null) {
          body.removeAttribute('data-zf-wallpaper')
          body.removeAttribute('data-zf-glow')
          body.removeAttribute('data-zf-contour')
        }
        root?.removeAttribute('data-zf-wallpaper')
        // 若当前 preference 指向本插件的固定主题，落回 system。
        // 内置 light/dark 的 tokens 是空对象，层一撤就恢复默认取值。
        try {
          const snapshot = theme.getTheme?.()
          const pref = snapshot?.preference
          if (typeof pref === 'string' && PRESETS.some(p => pref === `${p}-light` || pref === `${p}-dark`)) {
            theme.setTheme('system')
          }
        } catch { /* 服务已卸载 */ }
      }

      /**
       * 应用设置。先 teardown 再挂载，全程同步，不产生中间绘制帧。
       */
      function applySettings () {
        const s = state.settings
        if (s === null) return
        teardown()
        if (s.enabled !== true) {
          applyStyleVars(s, state.themeRoles, theme)
          syncHeroMark()
          emit()
          return
        }

        const overrides = state.overrides[s.preset]
        if (overrides === undefined) return

        let tookOver = false
        if (s.scheme === 'system') {
          // token 层：不改 preference，保住 prefers-color-scheme 跟随
          state.layerDispose = theme.overrideTokens(LAYER, overrides)
          tookOver = true
        } else {
          const id = `${s.preset}-${s.scheme}`
          if (state.registered.has(id)) {
            theme.setTheme(id)
            tookOver = true
          } else {
            // 注册失败（id 冲突等）时退回 token 层，保证配色仍然生效
            state.layerDispose = theme.overrideTokens(LAYER, overrides)
            tookOver = true
          }
        }

        applyStyleVars(s, state.themeRoles, theme)
        syncSchemeWallpaper(s, state.themeRoles, theme)
        syncHeroMark()
        // 打标运行时：设置变了要立刻重算（顶栏/右栏开关、宽度、头像）
        state.skin?.refresh()
        // 挂载成功后才撤掉首帧 token 标签（同一同步块内，不跳色）
        if (tookOver) dropBootTokens()
        emit()
      }

      /* ---------------- 宿主数据 ---------------- */

      /**
       * 把皮肤结构样式表插进页面（`<style id="zf-style">`）。
       *
       * ── 为什么必须由客户端自己插 ────────────────────────────────────────
       *
       * 宿主有两条注入路径，`bootStyle()` 的 `tapIndex` **只在 Web 端有效**：
       * 桌面端的渲染进程不经过 Host 的 HTTP 服务 —— `app.asar` 的 `dsh-app://`
       * 协议处理器直接从磁盘读 `dsh-web-frontend/dist/index.html`，只额外注入
       * 一个 `__DSH_BOOT_READY__` 脚本。
       *
       * 所以靠 `tapIndex` 注入的 CSS 在桌面端**一个字都不会出现**：壁纸、
       * 顶栏、右栏、气泡全部失效。这正是最初「只改了配色」的真正原因 ——
       * token 是由本文件 `overrideTokens` 独立生效的，所以只有配色变了。
       *
       * 走 `fetch` 拿宿主同一份 `structureStyle()` 产物，保证两处永不
       * 分叉（客户端不重复实现 CSS）。
       */
      async function ensureStyle () {
        if (state.styleEl !== null) return
        try {
          const res = await fetch(`${ROUTE}/style.css`, { cache: 'no-store' })
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
          const css = await res.text()
          if (typeof css !== 'string' || css.length === 0) throw new Error('空的样式表')
          const el = document.createElement('style')
          el.id = 'zf-style'
          el.setAttribute('data-plugin', 'dsh-zhuang-fangyi')
          el.textContent = css
          document.head.appendChild(el)
          state.styleEl = el
          state.styleReady = true
          // **必须 emit**（实测踩过，代价是观测栏完全不出现）：
          // `styleReady` 是普通变量，React 组件读它但**不订阅**它。
          // 不通知的话，首帧就已渲染过的组件（`Rail`）永远停在
          // 「styleReady=false → return null」那一版 ——
          // 自检实测 `railCalls:1, railNull:1, railRendered:0`。
          emit()
        } catch (error) {
          // 拿不到样式表只影响外观，配色仍由 token 层生效 —— 不阻断启动。
          // `styleReady` 保持 false，右栏据此**不渲染**（否则会裸渲染）。
          console.warn('[zhuang-fangyi] 皮肤样式表加载失败：', error?.message ?? error)
          state.styleReady = false
          emit()
        }
      }

      /**
       * 向宿主上报一次自检结果（`GET /api/zhuang-fangyi/diag` 可读）。
       *
       * 为什么需要：浏览器半边是否加载、插槽是否注册、样式表是否注入，
       * 在宿主侧完全看不到。加上 `dsh-client-modules` 会按包名缓存
       * 「是不是客户端包」的判定且**永不过期**（插件集合变化必须重启），
       * 这个上报能立刻区分「代码有问题」与「浏览器半边压根没加载」。
       *
       * 上报失败不影响任何功能，静默忽略。
       */
      async function reportDiag () {
        try {
          // 元素的**实测几何**与计算样式 —— 这是最能定位「位置不对」的数据。
          // 光看 CSS 会漏掉「包含块被挤走」「被 grid 自动放置」这类问题，
          // 而 getBoundingClientRect 直接给出最终落在屏幕上的位置。
          const rectOf = sel => {
            const el = document.querySelector(sel)
            if (el === null) return null
            const r = el.getBoundingClientRect()
            return {
              x: Math.round(r.x), y: Math.round(r.y),
              w: Math.round(r.width), h: Math.round(r.height)
            }
          }
          const cssOf = (sel, prop) => {
            const el = document.querySelector(sel)
            if (el === null) return null
            try { return getComputedStyle(el).getPropertyValue(prop).trim() } catch { return null }
          }
          const body = {
            styleReady: state.styleReady,
            styleElInDom: state.styleEl !== null && state.styleEl.isConnected === true,
            hasShellOverlay: document.querySelector('[data-shell-overlay]') !== null,
            hasWindowsTitlebar: document.documentElement.hasAttribute('data-windows-titlebar'),
            hasRailEl: document.querySelector('.zf-rail') !== null,
            // ── 渲染诊断：直接回答「组件跑了几次、为什么返回 null」──
            // 每次 `Rail()` 被调用都计数并记录返回类型，避免再靠推理猜时序。
            render: { ...state.renderCounts },
            // 官方右栏 tab 的注册结果（主路径是否走通）
            officialTab: {
              ...state.tabDiag,
              registered: state.tabRegistered,
              // 「真的挂着内容」才代表 tab 可见 —— 注册成功但 tabMounted=0
              // 就是「类型声明好了但用户没打开」的状态
              mounted: state.tabMounted,
              owner: railOwner()
            },
            // 订阅者数量：`useStore` 在 useEffect 里注册，为 0 说明
            // 组件从未真正挂载（返回 null 的组件 React 仍会跑 effect，
            // 所以 0 就意味着渲染根本没走到 effect）
            listenerCount: state.listeners.size,
            // 插槽里到底有没有我的条目（注册失败会在这里显形）
            overlayEntries: (() => {
              try {
                const layer = document.querySelector('[data-shell-overlay]')
                if (layer === null) return null
                return [...layer.children].map(c => c.className || c.tagName).slice(0, 12)
              } catch { return null }
            })(),
            // ── 几何：直接回答「在屏幕的哪个位置」 ──
            geom: {
              viewport: { w: window.innerWidth, h: window.innerHeight },
              rail: rectOf('.zf-rail'),
              railPosition: cssOf('.zf-rail', 'position'),
              railTop: cssOf('.zf-rail', 'top'),
              titlebarHeight: cssOf('html', '--dsh-windows-titlebar-height'),
              railWidthVar: cssOf('html', '--zf-rail-width'),
              overlay: rectOf('[data-shell-overlay]'),
              overlayPosition: cssOf('[data-shell-overlay]', 'position'),
              frame: rectOf('[data-zf-frame], [class*="_frame"]'),
              sidebarCol: rectOf('[data-zf-sidebar], [class*="_sidebarCol"]'),
              centerCol: rectOf('[data-zf-center], [class*="_centerCol"]')
            },
            // 打标结果：能证明定位逻辑是否命中了外壳元素
            marked: {
              frame: document.querySelectorAll('[data-zf-frame]').length,
              sidebar: document.querySelectorAll('[data-zf-sidebar]').length,
              center: document.querySelectorAll('[data-zf-center]').length,
              rightbar: document.querySelectorAll('[data-zf-rightbar]').length,
              content: document.querySelectorAll('[data-zf-content]').length
            },
            // 壁纸是否真的画上了（计算样式的实际值）
            artSrc: (() => {
              try {
                return getComputedStyle(document.documentElement)
                  .getPropertyValue('--zf-art-src').trim().slice(0, 120)
              } catch { return null }
            })(),
            railShown: state.railShown,
            settings: state.settings === null
              ? null
              : {
                  enabled: state.settings.enabled,
                  preset: state.settings.preset,
                  background: state.settings.background,
                  rail: state.settings.rail,
                  avatarBubbles: state.settings.avatarBubbles
                }
          }
          await fetch(`${ROUTE}/diag`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          })
        } catch { /* 自检失败不影响功能 */ }
      }

      async function load () {
        try {
          // 样式表与数据并行取：两者互不依赖，串行会白等一个往返
          const [, settingsPayload, themePayload] = await Promise.all([
            ensureStyle(),
            api('/settings'),
            api('/themes')
          ])
          state.settings = settingsPayload.settings
          state.themes = themePayload.themes ?? []
          state.overrides = themePayload.overrides ?? {}
          state.themeRoles = themePayload.roles ?? {}
          state.lastError = null
          registerThemes()
          applySettings()
        } catch (error) {
          state.lastError = String(error?.message ?? error)
          console.warn('[zhuang-fangyi] 读取宿主数据失败：', state.lastError)
          emit()
        }
        // 挂载与打标跑完后再上报，这样 marked 计数才有意义。
        //
        // 但要**等两帧**：`emit()` 只是把重渲染排进 React 的调度队列，此刻
        // DOM 还没更新。立刻上报会把「上一帧」的状态当成当前状态 ——
        // 实测被这个误导过：报告说 `railRendered:0`、`hasRailEl:false`，
        // 其实观测栏马上就渲染出来了，只是我读得太早。
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        await reportDiag()
      }

      /**
       * 重新从宿主拉取设置（**不重建主题注册**，只刷新状态）。
       *
       * ── 为什么需要它（实测发现的设计缺陷）──────────────────────────────
       *
       * 客户端原先只在启动时 `load()` 一次。之后：
       *   · 通过**设置页**改 → 客户端自己改 `state.settings` 再 `applySettings()` → 正常；
       *   · 通过**其它途径**改宿主设置（HTTP 直接 POST、手改 settings.json、
       *     将来桌宠插件写入）→ **客户端永远不知道**。
       *
       * 实测证明：HTTP 把 `background` 改成 `sakura/25%` 返回 200，但客户端
       * 自检里 `background` 仍是 `none`、`artSrc` 为空 —— 界面上毫无变化。
       *
       * 修法：窗口**重新获得焦点**时拉一次。这覆盖了「另一个窗口改了设置」
       * 这个主要场景，成本极低（一个事件监听 + 一次 GET），且不需要双向通道。
       *
       * 刻意**不重建主题注册**（`registerThemes`）—— 主题定义没变，重建会
       * 触发一次无意义的卸载/重挂，可能闪一下配色。
       */
      async function resyncSettings () {
        if (state.settings === null) return // 首次 load 还没完成，它会自己走完
        try {
          const payload = await api('/settings')
          const incoming = payload?.settings
          if (incoming === undefined || incoming === null) return
          // 值没变就不做任何事（避免无谓的 emit 与重渲染）
          if (JSON.stringify(incoming) === JSON.stringify(state.settings)) return
          state.settings = incoming
          applySettings()
          emit()
        } catch { /* 同步失败不打断任何功能，下次焦点再试 */ }
      }

      /**
       * 恢复默认设置。
       *
       * 设置页的「恢复默认」原先只是 `load()`（把宿主的当前值**重新读一遍**）——
       * 按钮写着「恢复默认」，实际什么也没恢复（实测发现的假按钮）。
       * 现在 POST `{"reset": true}`，由宿主显式写入 `defaultSettings()`，
       * 返回生效后的设置并立即应用。
       */
      async function resetToDefaults () {
        try {
          const payload = await api('/settings', {
            method: 'POST',
            body: JSON.stringify({ reset: true })
          })
          if (payload?.settings !== undefined) state.settings = payload.settings
          state.lastError = null
          applySettings()
        } catch (error) {
          state.lastError = String(error?.message ?? error)
          console.warn('[zhuang-fangyi] 恢复默认失败：', state.lastError)
        }
        emit()
      }

      async function save (patch) {
        const next = { ...(state.settings ?? {}), ...patch }
        state.settings = next
        applySettings()
        try {
          const payload = await api('/settings', {
            method: 'POST',
            body: JSON.stringify({ settings: next })
          })
          if (payload?.settings !== undefined) state.settings = payload.settings
          state.lastError = null
        } catch (error) {
          state.lastError = String(error?.message ?? error)
          console.warn('[zhuang-fangyi] 保存失败：', state.lastError)
        }
        emit()
      }

      /* ---------------- 样式接管 ---------------- */

      /**
       * 移除宿主的首帧 token 标签。
       *
       * 只在浏览器半边确实挂上了 token 层或切到了注册主题之后调用 —— 两者值
       * 完全相同，且这一步与挂载在同一同步块内，不产生中间绘制帧。
       */
      function dropBootTokens () {
        const tag = document.getElementById('zf-boot-tokens')
        if (tag !== null) tag.remove()
      }

      /* ---------------- 文案字典 ---------------- */

      ctx.effect(() => locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'zhuang-fangyi: dictionaries')

      /* ---------------- 跟随外壳明暗切换 ---------------- */

      // 壁纸明暗两版由 CSS 分流；这里只在外壳切换后把变量指向对应的暗色图，
      // 保证不支持 :has() 的引擎也能跟随。
      ctx.effect(() => ctx.on('theme/change', () => {
        syncSchemeWallpaper(state.settings, state.themeRoles, theme)
      }), 'zhuang-fangyi: theme sync')

      /* ---------------- 空白页头像 ---------------- */

      /**
       * 空白会话的品牌标记。
       *
       * 这是 `single` 插槽（外壳取 `entriesOfSlot()[0]`），所以注册即替换外壳
       * 的默认 logo。开关关闭时**不注册**，外壳的默认标记自然回来 —— 不做
       * 「注册了再隐藏」，那样会留下一个空占位。
       */
      function HeroMark ({ size }) {
        const edge = typeof size === 'number' && size > 0 ? size : 48
        return h('img', {
          src: `${ROUTE}/art/avatar.webp`,
          alt: '',
          width: edge,
          height: edge,
          decoding: 'async',
          style: {
            // 图已是圆形透明底（tools/prepare-art.py 的 circular_mask），
            // 所以不需要 objectPosition 微调，也不需要额外裁切。
            // cornerShape: 'round' 必须写 —— 外壳全局 `*{corner-shape:superellipse(1.5)}`
            // 会把 borderRadius:50% 渲染成圆角方形。
            width: edge, height: edge, borderRadius: '50%', cornerShape: 'round',
            objectFit: 'cover', display: 'block'
          }
        })
      }

      /**
       * 侧栏品牌位（`sidebar.brand.mark`，桌面壳会渲染）。
       *
       * 外壳传 `{size}`，与 `conversation.hero.brand.mark` 同构。Web 壳只声明
       * 不渲染，所以注册了也不会有副作用 —— 不需要按平台分支。
       */
      function BrandMark ({ size }) {
        const edge = typeof size === 'number' && size > 0 ? size : 24
        return h('img', {
          src: `${ROUTE}/art/avatar.webp`,
          alt: '',
          width: edge,
          height: edge,
          decoding: 'async',
          style: {
            // cornerShape 必须写：外壳有一条全局规则
            //   *, :before, :after{ corner-shape: var(--dsw-corner-shape) }
            // 值为 superellipse(1.5)，会把 borderRadius:50% 渲染成
            // 「圆角方形」而不是正圆（用户截图里那个方圆角就是它）。
            width: edge, height: edge, borderRadius: '50%', cornerShape: 'round',
            objectFit: 'cover', display: 'block'
          }
        })
      }

      /** 侧栏品牌名（`sidebar.brand.name`）：把外壳的版本号换成角色名。 */
      function BrandName () {
        return h('span', {
          style: {
            fontSize: 12, fontWeight: 600, letterSpacing: '.02em',
            color: 'var(--dsw-alias-label-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }
        }, t('brandName'))
      }

      /** 按设置挂载 / 卸载头像注册。 */
      function syncHeroMark () {
        const want = state.settings?.enabled === true && state.settings.heroAvatar === true
        if (want && state.heroDispose === null) {
          try {
            state.heroDispose = ctx.slots.inject('conversation.hero.brand.mark',
              () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, HeroMark))
          } catch (error) {
            console.warn('[zhuang-fangyi] 头像注册失败：', error?.message ?? error)
            state.heroDispose = null
          }
        } else if (!want && state.heroDispose !== null) {
          try {
            state.heroDispose()
          } catch { /* 已卸载 */ }
          state.heroDispose = null
        }
      }

      /* ---------------- 设置页 ---------------- */

      /**
       * 一行设置项。
       *
       * 用显式 grid 而不是 flex：`minmax(0, 1fr) auto` 保证左侧文字列可以
       * 收缩换行，右侧控件列永远留在容器内。用 flex 时（`flex:1 1 auto` +
       * `flex:0 0 auto`）在「容器宽度由内容撑开」的父级里不会收缩，控件会被
       * 挤到可视区之外 —— 实测就是标签渲染了、控件不见了。
       */
      const rowStyle = {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        columnGap: 16,
        padding: '10px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        boxSizing: 'border-box',
        width: '100%'
      }
      const groupStyle = {
        margin: '18px 0 0', fontSize: 12, fontWeight: 600, letterSpacing: '.04em',
        color: 'var(--dsw-alias-label-tertiary)'
      }
      const labelStyle = { fontSize: 13, color: 'var(--dsw-alias-label-primary)', minWidth: 0 }
      const hintStyle = {
        fontSize: 12, marginTop: 2, color: 'var(--dsw-alias-label-tertiary)',
        minWidth: 0, overflowWrap: 'anywhere'
      }

      function buttonStyle (primary) {
        return {
          fontSize: 12, cursor: 'pointer', borderRadius: 8, padding: '6px 14px',
          border: primary ? 'none' : '1px solid var(--dsw-alias-border-l2)',
          background: primary ? 'var(--dsw-alias-brand-primary)' : 'transparent',
          color: primary ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-label-primary)'
        }
      }

      function Row ({ label, hint, children }) {
        return h('div', { style: rowStyle },
          h('div', { style: { minWidth: 0 } },
            h('div', { style: labelStyle }, label),
            hint !== undefined && h('div', { style: hintStyle }, hint)
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } }, children)
        )
      }

      function Toggle ({ value, onChange }) {
        return h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': value === true ? 'true' : 'false',
          onClick: () => onChange(value !== true),
          style: {
            width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
            padding: 0, position: 'relative',
            background: value === true ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-3)',
            transition: 'background 120ms ease'
          }
        }, h('span', {
          style: {
            position: 'absolute', top: 3, left: value === true ? 21 : 3, width: 16, height: 16,
            borderRadius: '50%', background: 'var(--dsw-alias-switch-thumb)',
            transition: 'left 120ms ease'
          }
        }))
      }

      function Segmented ({ value, options, onChange }) {
        return h('div', {
          style: {
            display: 'inline-flex', border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 8, overflow: 'hidden'
          }
        }, options.map(opt => h('button', {
          key: opt.value,
          type: 'button',
          onClick: () => onChange(opt.value),
          style: {
            border: 'none', cursor: 'pointer', fontSize: 12, padding: '5px 10px',
            background: value === opt.value ? 'var(--dsw-alias-brand-primary)' : 'transparent',
            color: value === opt.value ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-label-secondary)'
          }
        }, opt.label)))
      }

      function Select ({ value, options, onChange }) {
        return h('select', {
          value,
          onChange: event => onChange(event.target.value),
          style: {
            fontSize: 12, padding: '5px 8px', borderRadius: 8, minWidth: 150,
            color: 'var(--dsw-alias-label-primary)',
            background: 'var(--dsw-alias-bg-layer-1)',
            border: '1px solid var(--dsw-alias-border-l2)'
          }
        }, options.map(opt => h('option', { key: opt.value, value: opt.value }, opt.label)))
      }

      function Slider ({ value, min, max, step, suffix, onChange }) {
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('input', {
            type: 'range', min, max, step, value,
            onChange: event => onChange(Number(event.target.value)),
            style: { width: 130, accentColor: 'var(--dsw-alias-brand-primary)' }
          }),
          h('span', {
            style: { fontSize: 12, width: 44, textAlign: 'right', color: 'var(--dsw-alias-label-secondary)' }
          }, `${value}${suffix}`)
        )
      }

      function useStore () {
        const [, bump] = useState(0)
        useEffect(() => {
          const fn = () => bump(n => n + 1)
          state.listeners.add(fn)
          return () => state.listeners.delete(fn)
        }, [])
        return state
      }

      function Section () {
        const s = useStore()
        const settings = s.settings

        if (settings === null) {
          return h('div', { style: { padding: '8px 0', fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } },
            h('div', null, s.lastError === null ? t('loading') : `${t('loadFailed')}（${s.lastError}）`),
            h('button', {
              type: 'button',
              onClick: () => { void load() },
              style: { ...buttonStyle(false), marginTop: 10 }
            }, t('retry'))
          )
        }

        const set = patch => { void save(patch) }

        return h('div', { style: { padding: '4px 0 20px', maxWidth: 720 } },
          h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, t('subtitle')),

          h('div', { style: groupStyle }, t('groupTheme')),
          h(Row, { label: t('enabled'), hint: t('enabledHint') },
            h(Toggle, { value: settings.enabled, onChange: v => set({ enabled: v }) })),
          h(Row, { label: t('preset') },
            h(Select, {
              value: settings.preset,
              options: PRESETS.map(p => ({ value: p, label: PRESET_LABELS[p].zh })),
              onChange: v => set({ preset: v })
            })),
          h(Row, { label: t('scheme'), hint: t('schemeHint') },
            h(Segmented, {
              value: settings.scheme,
              options: [
                { value: 'system', label: t('schemeSystem') },
                { value: 'light', label: t('schemeLight') },
                { value: 'dark', label: t('schemeDark') }
              ],
              onChange: v => set({ scheme: v })
            })),

          h('div', { style: groupStyle }, t('groupWallpaper')),
          h(Row, { label: t('background') },
            // 缩略图条（对标 Mornye 的所见即所得）：8 张 +「无」，点即选。
            // 文件名不另存映射 —— 壁纸命名是规则的 `wallpaper-<id>.webp`
            // （测试锁这个约定），明暗版加 `-dark`。
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: 300 } },
              ...BACKGROUNDS.map(b => {
                const pressed = settings.background === b
                const dark = settings.scheme === 'dark' ||
                  (settings.scheme === 'system' &&
                    document.body?.getAttribute?.('data-ds-dark-theme') != null)
                const file = b === 'none' ? null : `wallpaper-${b}${dark ? '-dark' : ''}.webp`
                return h('button', {
                  key: b, type: 'button',
                  title: t(BG_LABELS[b]),
                  'aria-pressed': pressed ? 'true' : 'false',
                  onClick: () => set({ background: b }),
                  style: {
                    padding: 0, width: 64, height: 40, borderRadius: 7, overflow: 'hidden',
                    cursor: 'pointer', boxSizing: 'border-box',
                    border: pressed
                      ? '2px solid var(--dsw-alias-brand-primary)'
                      : '1px solid var(--dsw-alias-border-l2)',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }
                },
                file === null
                  ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, t('bgNone'))
                  : h('img', {
                      src: `${ROUTE}/art/thumbs/${file}`,
                      alt: t(BG_LABELS[b]),
                      loading: 'lazy',
                      style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
                    }))
              }))),
          h(Row, { label: t('opacity') },
            h(Slider, {
              value: settings.backgroundOpacity, min: 0, max: 45, step: 1, suffix: '%',
              onChange: v => set({ backgroundOpacity: v })
            })),
          h(Row, { label: t('blur') },
            h(Slider, {
              value: settings.backgroundBlur, min: 0, max: 16, step: 1, suffix: 'px',
              onChange: v => set({ backgroundBlur: v })
            })),
          h(Row, { label: t('position') },
            h(Segmented, {
              value: settings.backgroundPosition,
              options: POSITIONS.map(p => ({ value: p, label: t(POS_LABELS[p]) })),
              onChange: v => set({ backgroundPosition: v })
            })),

          h('div', { style: groupStyle }, t('groupDecor')),
          h(Row, { label: t('contourBorder') },
            h(Toggle, { value: settings.contourBorder, onChange: v => set({ contourBorder: v }) })),
          h(Row, { label: t('accentGlow'), hint: t('accentGlowHint') },
            h(Toggle, { value: settings.accentGlow, onChange: v => set({ accentGlow: v }) })),
          h(Row, { label: t('heroAvatar') },
            h(Toggle, { value: settings.heroAvatar, onChange: v => set({ heroAvatar: v }) })),
          h(Row, { label: t('titlebarFollow'), hint: t('titlebarFollowHint') },
            h(Toggle, { value: settings.titlebarFollow, onChange: v => set({ titlebarFollow: v }) })),

          h('div', { style: groupStyle }, t('groupSkin')),
          h(Row, { label: t('rail'), hint: t('railHint') },
            h(Toggle, { value: settings.rail, onChange: v => set({ rail: v }) })),
          h(Row, { label: t('railWidth') },
            h(Slider, {
              value: settings.railWidth,
              min: 240,
              max: 380,
              step: 4,
              suffix: 'px',
              onChange: v => set({ railWidth: v })
            })),
          h(Row, { label: t('avatarBubbles'), hint: t('avatarBubblesHint') },
            h(Toggle, { value: settings.avatarBubbles, onChange: v => set({ avatarBubbles: v }) })),

          h('div', { style: { display: 'flex', gap: 8, marginTop: 18 } },
            h('button', {
              type: 'button',
              onClick: () => { void resetToDefaults() },
              style: buttonStyle(false)
            }, t('reset')),
            h('button', {
              type: 'button',
              onClick: () => { void save({}) },
              style: buttonStyle(true)
            }, t('retry'))
          ),
          s.lastError !== null && h('div', {
            style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }
          }, `${t('saveFailed')}（${s.lastError}）`)
        )
      }

      /* ---------------- 侧栏快捷开关 ---------------- */

      function SidebarAction () {
        const s = useStore()
        const on = s.settings?.enabled === true
        return h('button', {
          type: 'button',
          title: t('sidebarToggle'),
          'aria-pressed': on ? 'true' : 'false',
          onClick: () => { void save({ enabled: !on }) },
          style: {
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            border: 'none', background: 'transparent', cursor: 'pointer',
            padding: '6px 8px', borderRadius: 8, fontSize: 13,
            color: 'var(--dsw-alias-label-secondary)'
          }
        },
        h('span', {
          style: {
            width: 14, height: 14, borderRadius: 4, flex: '0 0 auto',
            background: on ? 'var(--dsw-alias-brand-primary)' : 'transparent',
            border: '1.5px solid var(--dsw-alias-border-l3)'
          }
        }),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          t('sidebarToggle')))
      }

      /* ---------------- 顶栏与右侧观测栏 ---------------- */

      /** 预设色板（右栏色块用）。取自官方素材量化值。 */
      const SWATCH = {
        zhuang: '#F2E957',
        burst: '#C4D579',
        cyan: '#75DCD9',
        wine: '#D86766'
      }

      /** 会话状态显示文案。 */
      const SESSION_TEXT = {
        idle: '待机', ready: '就绪', running: '生成中',
        tool: '调用工具', error: '出错', done: '已完成'
      }

      /**
       * 顶栏 —— **已按用户要求整体移除**。
       *
       * 原先这里渲染 `.zf-topbar`：庄方宜头像 + 品牌名 + 「预设 · 会话状态」。
       * 用户反馈要去掉左上角这一整块，理由充分：
       *
       *   · Windows 标题栏那一条本来就窄（40px），左边被系统窗口图标和
       *     「应用 / 编辑」菜单占着，再挤一块品牌信息很局促；
       *   · 里面的信息全是冗余 —— 头像在侧栏品牌位与助手消息旁都有，
       *     配色预设与配色选择在右栏观测台里有，会话状态也在观测台里。
       *
       * 所以不再注册 `zhuang-fangyi-topbar`，右栏观测台直接顶到最上边。
       * 设置项 `topbar` 保留（旧设置文件里有），但不再产生任何视觉。
       */

      /**
       * 观测台的**内容**（与容器无关，两处复用）。
       *
       * 抽出来是因为要同时服务于两个容器：
       *   · 官方右栏标签页（`sidebar.right.pane.tab`）—— 主路径；
       *   · `shell.overlay` 浮层 —— 兜底（无官方右栏服务的平台）。
       *
       * 这样内容只写一遍，容器差异由调用方负责。
       */
      function RailContent () {
        const s = useStore()
        const settings = s.settings
        if (settings === null || settings.enabled !== true) return null
        const st = state.stats
        const set = patch => { void save(patch) }
        const stateText = SESSION_TEXT[state.sessionState] ?? SESSION_TEXT.idle

        return h('div', { className: 'zf-rail__body' },
          h('div', { className: 'zf-rail__head' },
            h('img', { className: 'zf-rail__avatar', src: `${ROUTE}/art/avatar.webp`, alt: '' }),
            h('div', { style: { minWidth: 0 } },
              h('div', { className: 'zf-rail__title' }, t('railTitle')),
              h('div', { className: 'zf-rail__caption' }, `${stateText} · ${t('localOnly')}`))),
          h('div', { className: 'zf-rail__group' },
            h('div', { className: 'zf-rail__label' }, t('stats')),
            h('div', { className: 'zf-rail__stats' },
              h('div', { className: 'zf-rail__stat' }, h('b', null, st.turns), h('span', null, t('turns'))),
              h('div', { className: 'zf-rail__stat' }, h('b', null, st.steps), h('span', null, t('steps'))),
              h('div', { className: 'zf-rail__stat' }, h('b', null, st.cache), h('span', null, t('cache'))))),
          h('div', { className: 'zf-rail__group' },
            h('div', { className: 'zf-rail__label' }, t('groupTheme')),
            h('div', { className: 'zf-rail__swatches' },
              ...PRESETS.map(p => h('button', {
                key: p,
                type: 'button',
                className: 'zf-rail__swatch',
                'aria-pressed': settings.preset === p ? 'true' : 'false',
                onClick: () => set({ preset: p })
              },
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 } },
                h('span', { className: 'zf-rail__chip', style: { background: SWATCH[p] } }),
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  PRESET_LABELS[p]?.['zh'] ?? p)),
              settings.preset === p ? h('span', null, '✓') : null)))),
          h('div', { className: 'zf-rail__group' },
            h('div', { className: 'zf-rail__label' }, t('groupWallpaper')),
            h('div', { className: 'zf-rail__row' },
              h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t('bgOpacity')),
              h('span', { className: 'zf-rail__value' }, `${settings.backgroundOpacity}%`)),
            h('div', { className: 'zf-rail__swatches' },
              ...BACKGROUNDS.filter(b => b !== 'none').map(b => h('button', {
                key: b,
                type: 'button',
                className: 'zf-rail__swatch',
                'aria-pressed': settings.background === b ? 'true' : 'false',
                onClick: () => set({ background: settings.background === b ? 'none' : b })
              },
              h('span', null, BG_LABELS[b]?.['zh'] ?? b),
              settings.background === b ? h('span', null, '✓') : null)))))
      }

      /**
       * 官方右栏标签页的**面板主体**。
       *
       * 注册进 `sidebar.right.pane.tab`（keyed 槽，key = tab 定义的 id）。
       * 它是**官方容器**里的一个真实标签页 —— 不占额外位置、不冲突、
       * 随原生右栏一起开合与拖拽调宽。
       */
      function RailTab () {
        const s = useStore()
        const settings = s.settings
        // 「我此刻是否真的在渲染内容」—— 注意**不能**用 `railOwner()` 门控自己：
        // 那是给浮层判断要不要让位用的，tab 自己就是被让位的那一方，
        // 用它会导致鸡生蛋问题（把 tabMounted 算进 railOwner 后，
        // RailTab 永远返回 null → tabMounted 永远 0 → 死锁）。
        const rendered = state.styleReady === true &&
          settings !== null && settings.enabled === true && settings.rail !== false

        // ── 关键：用**挂载事实**告诉浮层「我接管了」───────────────────────
        //
        // 为什么要 `rendered` 作为依赖：返回 null 的组件**依然是挂载的**，
        // 它的 effect 照样会跑。若只在 mount 时计数，那么「tab 开着但内容
        // 因设置无效而返回 null」也会让浮层让位 → 两边都空（实测事故）。
        // 依赖 `rendered` 后，只有**真的渲染出内容**才计数。
        useEffect(() => {
          if (!rendered) return undefined
          state.tabMounted += 1
          emit() // 让浮层立刻重新裁决（它该让位了）
          return () => {
            state.tabMounted -= 1
            emit() // tab 被关闭/切走 → 浮层立刻回来接替
          }
        }, [rendered])

        if (!rendered) {
          state.renderCounts.tabNull += 1
          state.renderCounts.lastTabNullReason = 'not-rendered'
          return null
        }
        state.renderCounts.tabRendered += 1
        // 官方 tab 已经提供了容器（背景/边框/滚动），所以这里只要内容。
        // 用 `zf-rail__body` 而不是 `.zf-rail`（后者带 fixed 定位与面板背景）。
        return h(RailContent)
      }

      /**
       * 把观测台作为官方 tab 打开（**仅在右栏已经展开时**）。
       *
       * ── 为什么要主动打开（实测踩过）──────────────────────────────────
       *
       * `sidebarRightTabs.register()` 只声明「有这种 tab」，**不会打开任何一个**。
       * 官方右栏按「已打开的 tab」渲染，而打开要么用户从「指南」里点、要么显式
       * `openTab()`。官方已有 3 个类型带 guide 条目（files / browser / terminal），
       * 加上我们是 4 个 —— 按官方规则「多个条目 → 展开时显示指南」，
       * **永远不会自动显示我们的页**。所以必须主动打开一次。
       *
       * ── 「仅在展开侧栏的时候走官方」（用户明确要求）────────────────────
       *
       * 只在面板**已经展开**时才打开，绝不代为展开：
       *   · `openTab` 的真实语义含「面板会展开，因为用户看不见的内容不该被打开」，
       *     若在收起状态下调用，会把用户的面板顶开 —— 那是打扰。
       *   · 收起时由浮层（`.zf-rail`）负责显示，两条路径互补。
       *
       * ── 幂等与「尊重用户关闭」─────────────────────────────────────────
       *
       * `railTabOpenedFor` 记住「这一个展开周期内我已经开过了」：
       *   · 同一展开周期内重复调用不会重复开（官方对普通页 tab 也会去重，
       *     但少调一次就少一次重排）；
       *   · 用户手动关掉我们的 tab 后**不会被反复重开**（尊重用户选择）；
       *   · 面板收起时清空标记 → 下次展开会再次出现（这是期望行为）。
       *
       * @param {Document} doc
       */
      function maybeOpenRailTab (doc) {
        const right = state.sidebarRight
        if (right === null || right === undefined) return // 无官方右栏服务（Web 端）
        if (state.tabRegistered !== true) return // 类型没注册成功，openTab 会抛
        if (state.settings?.enabled !== true || state.settings.rail === false) return

        const frame = doc.querySelector('[class*="_frame"]')
        if (frame === null || frame === undefined) return
        const collapsed = frame.hasAttribute('data-rightbar-collapsed') ||
          frame.hasAttribute('data-details-collapsed')

        if (collapsed) {
          // 面板收起了 → 清空标记，下次展开重新出现
          state.railTabOpenedFor = null
          return
        }
        // 已经开着（我们的 tab 在渲染）→ 无事可做
        if (state.tabMounted > 0) return
        // 这个展开周期已经尝试过（例如用户刚把它关掉）→ 不再打扰
        if (state.railTabOpenedFor === 'expanded') return

        state.railTabOpenedFor = 'expanded'
        try {
          right.openTab(TAB_KIND)
          state.tabDiag.opened = true
        } catch (error) {
          // openTab 抛错是「接线错误」（kind 没注册等），不该拖垮打标
          state.tabDiag.openError = error?.message ?? String(error)
          console.warn('[zhuang-fangyi] openTab 失败：', state.tabDiag.openError)
        }
      }

      /**
       * 观测台该由哪条路径渲染（**只给浮层用**）。
       *
       * ── 这里踩过两次坑，都是「让位给了不存在的东西」──────────────────
       *
       * 坑 1：两条路径各自判断 → 浮层以为 tab 在干活、tab 其实没注册 → 全黑。
       *      修法：收敛成一个函数。
       *
       * 坑 2（更隐蔽）：把**「注册成功」当成了「已打开」**。
       *      `sidebarRightTabs.register()` 只是声明「有这种 tab」，**并不打开
       *      任何一个 tab**。官方 tab 是根据「已打开的 tab」渲染的，而打开要
       *      用户从指南里点、或显式 `openTab()`。所以注册成功时 `tabCalls:0` ——
       *      浮层让位给一个从未打开的 tab，结果**右边什么都没有**（用户实测
       *      反馈「右栏怎么做都没有观测台」）。
       *
       *      修法：判定依据改成**挂载事实** `state.tabMounted`（由 `RailTab` 的
       *      effect 维护）。tab 真的在渲染才让位；否则浮层顶上。
       *
       * @returns {'tab'|'overlay'|'none'}
       */
      function railOwner () {
        const s = state.settings
        if (s === null || s.enabled !== true || s.rail === false) return 'none'
        if (!state.styleReady) return 'none'
        // 只有 tab **真的挂着内容**才算接管 —— 注册 ≠ 打开
        return state.tabMounted > 0 ? 'tab' : 'overlay'
      }

      /**
       * 右侧观测栏（**兜底路径**）。
       *
       * 仅在官方右栏 tab 不可用时使用 —— 见 `registerRailTab()` 的说明。
       * 它是 `shell.overlay` 上的浮层，原生右栏展开时自动让位。
       */
      function Rail () {
        const s = useStore()
        // 渲染诊断：自检里直接看这几个数就知道卡在哪一步
        const rc = state.renderCounts
        rc.railCalls += 1
        const owner = railOwner()
        if (owner !== 'overlay') {
          rc.railNull += 1; rc.lastNullReason = owner === 'tab' ? 'official-tab-active' : 'rail-off'
          return null
        }
        const settings = s.settings
        if (settings === null) {
          rc.railNull += 1; rc.lastNullReason = 'settings=null'
          return null
        }
        rc.railRendered += 1
        return h('aside', { className: 'zf-rail', 'aria-label': t('rail') }, h(RailContent))
      }

      /* ---------------- 插槽注册 ---------------- */

      /**
       * 安全注册：任何注册失败都只警告，**绝不中断 `apply()`**。
       *
       * 为什么必须这样（实测踩过，代价很大）：
       * 官方插件 `dsh-client-ui-brand` 已经在 `sidebar.brand.mark`（single 槽）
       * 注册了 priority 0，而 `SlotCore.register` 对同 priority 的重复注册
       * **直接抛错**。我原先在 `apply()` 里裸调 `ctx.slots.register`，
       * 一抛错整个 `apply()` 就中断 —— 后面的打标、样式表注入、右栏显隐
       * 全部没执行，于是页面看起来「皮肤完全没生效」。
       *
       * 一个可选装饰位的冲突，不该让整个插件瘫痪。
       *
       * @param {string} slot - 插槽名
       * @param {object} meta - register 的 meta（name 会自动补上）
       * @param {Function} component
       * @returns {Function|null} disposer；注册失败返回 null
       */
      function safeInject (slot, meta, component) {
        try {
          return ctx.slots.inject(slot, () => ctx.slots.register(
            { name: slot, ...meta }, component))
        } catch (error) {
          console.warn(`[zhuang-fangyi] 插槽 ${slot} 注册失败（已跳过，不影响其它功能）：`,
            error?.message ?? error)
          return null
        }
      }

      safeInject('settings.section', {
        id: 'zhuang-fangyi', order: 120, label: () => t('nav'), locale: NS
      }, Section)

      safeInject('sidebar.footer.action', {
        id: 'zhuang-fangyi-toggle', order: 60, locale: NS
      }, SidebarAction)

      /* ---------------- 官方右栏标签页（主路径） ---------------- */

      /** 本插件在官方 tab 系统里的身份。等于 tab 本体的注册 key。 */
      const TAB_ID = 'dsh-zhuang-fangyi-observation'
      /** tab 的 kind（决定用哪个渲染器）。第三方用自己的 kind，别抢 builtin。 */
      const TAB_KIND = 'zhuang-fangyi-observation'

      /**
       * 把观测台注册成**官方右栏的一个标签页**。
       *
       * ── 为什么值得走官方（而不是继续用浮层）────────────────────────────
       *
       * `sidebar.right.pane.tab` 是官方右栏（`rightbarCol` 轨道）的标签页
       * 系统。注册进去的收益：
       *   · **不占额外位置** —— 它是轨道里的一个 tab，不是叠在上面的浮层；
       *   · **不与原生右栏冲突** —— 同一个容器，不需要「展开时让位」那套逻辑；
       *   · **随原生一起开合、可拖拽调宽** —— 全部免费获得。
       *
       * ── 两阶段注册（官方契约，README 明确要求）─────────────────────────
       *
       *   1. `ctx.sidebarRightTabs.register({id, kind, priority, title, …})`
       *      —— 声明「有这样一种 tab」，返回一个 disposer；
       *   2. `ctx.slots.register({name:'sidebar.right.pane.tab', key: id}, Body)`
       *      —— 注册该 tab 的**本体**，key 必须等于第一步的 `id`。
       *
       * `priority: 'extension'` 表示**占一个独立席位**，不接管任何 builtin
       * kind（`builtin` 会抢别人的 kind，第三方不该用）。
       *
       * ── 失败必须降级 ──────────────────────────────────────────────────
       *
       * `sidebarRightTabs` 由 `dsh-client-ui-sidebar-right` 提供，那是**桌面
       * 专属包**（Web 端没有）。所以整段走 `safeInject`，任何一步失败都只是
       * `tabRegistered` 保持 false —— 浮层兜底继续工作。
       *
       * @returns {boolean} 是否成功注册
       */
      function registerRailTab () {
        state.tabDiag.attempted = true
        let ok = false
        try {
          // `sidebarRightTabs` 是**服务**（不是插槽），所以用 `ctx.inject` 等待它。
          // 服务不存在时回调永不触发 —— 这正是我们要的降级信号：
          // Web 端没有 `dsh-client-ui-sidebar-right`，回调不跑，浮层兜底接手。
          //
          // 同时注入 `sidebarRight`（导航控制器）：`openTab` 在它上面，是
          // 「把观测台打开到官方右栏」的唯一入口。两个服务由同一个包提供
          // （`ctx.reflect.provide`），一起注入能保证拿到 tabs 就能打开 tab。
          ctx.inject(['sidebarRightTabs', 'sidebarRight'], scope => {
            try {
              const tabs = scope.sidebarRightTabs
              if (tabs === undefined || tabs === null) {
                state.tabDiag.error = 'sidebarRightTabs 为 undefined'
                return
              }
              state.sidebarRight = scope.sidebarRight ?? null
              // 阶段一：声明 tab 类型
              //
              // ── `guide` 是**必需的**，不是可选项（实测踩过：没有它右栏里
              //    根本找不到我们的 tab）─────────────────────────────────────
              //
              // 官方 README 原文：
              //   「`guide` lists entry boxes for the guide page; picking one
              //     opens the contributing type as a page.」
              //   「Default pages depend on the number of registered guide
              //     entries, not the number of tab types or open tabs.
              //     Exactly one entry opens its page directly; zero or multiple
              //     entries open the guide.」
              //
              // 也就是说：**只有注册了 `guide` 条目，类型才会出现在右栏的
              // 「指南」页里，用户才有入口打开它。** 没有 `guide` 的定义等于
              // 隐形 —— 注册成功但永远打不开。
              const disposeType = tabs.register({
                id: TAB_ID,
                kind: TAB_KIND,
                priority: 'extension',
                title: () => t('railTitle'),
                guide: [{
                  id: 'observation',
                  order: 10,
                  title: () => t('railTitle'),
                  description: () => t('localOnly')
                }]
              })
              state.tabDiag.kind = TAB_KIND

              // 阶段二：注册本体（key 必须等于上面的 id）
              const disposeBody = safeInject('sidebar.right.pane.tab', {
                key: TAB_ID, locale: NS
              }, RailTab)

              if (disposeBody === null) {
                state.tabDiag.error = 'tab 本体注册失败'
                try { disposeType?.() } catch { /* 已释放 */ }
                return
              }

              state.tabTypeDispose = disposeType
              state.tabBodyDispose = disposeBody
              state.tabRegistered = true
              state.tabDiag.ok = true
              state.renderCounts.lastNullReason = 'official-tab-active'
              emit()
            } catch (error) {
              state.tabDiag.error = error?.message ?? String(error)
              console.warn('[zhuang-fangyi] 官方 tab 注册失败，改用浮层兜底：', state.tabDiag.error)
              emit()
            }
          })
          ok = state.tabRegistered
        } catch (error) {
          state.tabDiag.error = error?.message ?? String(error)
          console.warn('[zhuang-fangyi] 无法注入 sidebarRightTabs：', state.tabDiag.error)
        }
        return ok
      }

      // 右侧观测栏的**兜底**浮层。
      //
      // 只在官方 tab 不可用时渲染（`Rail` 内部会检查 `tabRegistered`）。
      // 进 `shell.overlay` —— 外壳原生浮动层（`position:absolute; inset:0;
      // z-index:20`，子元素自动恢复 pointer-events）。`shell.overlay` 是 list
      // 槽，按 `id` 区分，不会与官方或其它插件冲突。
      safeInject('shell.overlay', {
        id: 'zhuang-fangyi-rail', order: 50, locale: NS
      }, Rail)

      // 尝试走官方 tab（成功则浮层自动隐让）
      registerRailTab()

      // 侧栏品牌位。
      //
      // `sidebar.brand.mark` / `sidebar.brand.name` 都是 **single 槽**，官方
      // `dsh-client-ui-brand` 已占 priority 0。single 槽同 priority 重复注册
      // 会抛错，所以这里必须用**更低的 priority** 去遮蔽它：
      // `entriesOfSlot` 按 priority 升序取第一个非让位者，**最低者渲染**。
      // 用 -1 覆盖官方 logo，且不与它冲突。
      //
      // 另外注意：桌面壳只在 `wide`（侧栏展开）时渲染 brand.mark，
      // 折叠态在 Windows 下由 `!windowsTitlebar` 门控掉了，所以折叠后
      // 本来就不会有头像 —— 这是外壳行为，不是本插件的 bug。
      state.brandMarkDispose = safeInject('sidebar.brand.mark', {
        priority: -1
      }, BrandMark)

      state.brandNameDispose = safeInject('sidebar.brand.name', {
        priority: -1
      }, BrandName)

      /* ---------------- 皮肤运行时 ---------------- */

      // 打标 + 右栏显隐。`onLayout` 在每轮打标后触发，让右栏读数跟着更新，
      // 顺便裁决「要不要把观测台打开进官方右栏」。
      //
      // 为什么走 `onLayout` 而不是在 `refresh()` 里直接调：`mountSkin` 定义在
      // **模块作用域**，看不到 `apply()` 内部的函数（`maybeOpenRailTab` 在里面）。
      // `onLayout` 是已有的回调通道，正好用来把内部逻辑挂到打标之后。
      state.skin = mountSkin({
        state,
        onLayout: () => {
          maybeOpenRailTab(document)
          emit()
        }
      })

      /* ---------------- 卸载 ---------------- */

      ctx.effect(() => () => {
        teardown()
        unregisterThemes()
        state.skin?.dispose()
        state.skin = null
        // 移除自己插的样式表；宿主那条 `tapIndex` 路径（Web 端）由框架回收
        if (state.styleEl !== null) {
          try {
            state.styleEl.remove()
          } catch { /* 已移除 */ }
          state.styleEl = null
        }
        for (const key of [
          'heroDispose', 'brandMarkDispose', 'brandNameDispose',
          // 官方 tab 的两个 disposer 也必须释放，否则重新启用插件时
          // `sidebarRightTabs.register` 会因「同 id 重复注册」而抛错
          'tabBodyDispose', 'tabTypeDispose'
        ]) {
          if (state[key] !== null && state[key] !== undefined) {
            try {
              state[key]()
            } catch { /* 已卸载 */ }
            state[key] = null
          }
        }
        state.tabRegistered = false
        // `tabDiag` 是**诊断快照**，卸载时也要复位，否则自检会同时报出
        // `ok:true` 与 `registered:false` 这种自相矛盾的结果（实测遇到过：
        // HMR 重载后旧实例的 ok 残留，让我误判成「注册成功又失效」）。
        state.tabDiag.ok = false
        state.tabDiag.error = null
        state.listeners.clear()
      }, 'zhuang-fangyi: teardown')

      void load()

      exports.__test = {
        DICT, PRESETS, SCHEMES, BACKGROUNDS, POSITIONS,
        // 供无头测试直接验证定位/打标逻辑
        makeModuleClass, makeMarker, readSessionState, readStats, nativeRightbarOpen,
        // 观测台路径裁决与设置同步（用例 41/42），以及官方 tab 的自动打开（用例 44）
        railOwner, resyncSettings, maybeOpenRailTab, resetToDefaults,
        // 让测试能模拟「宿主设置被外部改动」：stub fetch 下一次 /settings 的返回
        setNextSettings (next) {
          globalThis.__zfNextSettings = next
        },
        // 运行时状态：用于断言 styleReady 等门控（样式表失败时顶栏/右栏不渲染）
        state
      }
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'zhuang-fangyi'
    return module.exports
  }
})
