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
    // >>> generated: presets (do not edit) >>>
    // ⚠ 由 `tools/gen-wallpapers.mjs` 从 `src/palette.js` 的 PRESET_SPECS 生成。
    //   客户端不能 import src/，所以这是副本；`--check` 保证两侧一致。
    //   加一套预设只需改 `PRESET_SPECS`，这里会自动跟上。
    const PRESETS = [
      'zhuang', 'burst', 'cyan', 'wine', 'olive', 'sand', 'frost', 'amber'
    ]

    /** 预设 id → 中英显示名（下拉与 aria-label 用）。 */
    const PRESET_LABELS = {
      zhuang: { zh: '本体黄绿', en: 'Signature yellow-green' },
      burst: { zh: '大招墨青金', en: 'Ultimate ink-gold' },
      cyan: { zh: '青', en: 'Cyan' },
      wine: { zh: '酒红', en: 'Wine red' },
      olive: { zh: '橄榄绿', en: 'Olive' },
      sand: { zh: '米白暖', en: 'Warm sand' },
      frost: { zh: '冰白青', en: 'Frost' },
      amber: { zh: '香槟金', en: 'Amber' },
    }
    // <<< generated: presets <<<
    /**
     * C13：明暗分档下拉里「跟随主预设」的哨兵值。
     *
     * 必须与 `src/settings.js` 的 `PRESET_FOLLOW`（`null`）**语义一致** ——
     * 客户端不能 import src/，所以这里是它的本地副本；两侧都有断言盯着
     * （设置层断言默认值是 null，客户端断言这个常量是 null）。
     * `null` 不能直接当 `<option value>`，所以用这个字符串做界面值。
     */
    const FOLLOW = '__follow__'
    /**
     * 轮播列表下拉的两个哨兵值（v8）。
     *
     * 与 `FOLLOW` 同一个理由：`null` 不能当 `<option value>`，所以用字符串。
     * `settings.rotateActive` 本身仍是 `null | '<列表 id>'`（`null` = 全部内置），
     * 哨兵只活在界面层。
     */
    const ALL_LISTS = '__all__'
    const NEW_LIST = '__new__'
    /**
     * 轮播列表数量上限的**客户端副本**。
     *
     * 权威值在 `src/settings.js` 的 `ROTATE_LISTS_MAX`（归一化时强制），
     * 这里只用于提前禁用「新建」；两侧一致性有断言盯着。
     */
    const ROTATE_LISTS_MAX = 20
    const SCHEMES = ['system', 'light', 'dark']
    // `BACKGROUNDS` / `BG_LABELS` / `BG_GROUPS` / `BG_GROUP_OF` 在下方
    // 「generated: wallpapers」块里（0.8.0 起由 `src/wallpaperCatalog.js` 生成，
    // 不再手写 —— 59 张 × 3 处手抄必然漂移，这里只留指针防重复声明）。
    const POSITIONS = ['cover', 'right', 'tile']

    /**
     * 「自定义背景」的哨兵值 —— 必须与 `src/settings.js` 的 `CUSTOM_BACKGROUND`
     * 一致（客户端不能 import src/，所以是本地副本；有断言盯着两侧相等）。
     *
     * `'custom'` **不在** `BACKGROUNDS` 里：那张表是内置素材的静态清单，会被
     * 壁纸缩略图条与轮播池遍历。自定义图是运行时增删的，单独处理。
     */
    const CUSTOM_BACKGROUND = 'custom'

    /**
     * 竖图阈值：宽高比 < 0.87 → `contain`。
     *
     * ⚠️ 与两处必须一致：`tools/prepare-art.py`（内置图清单的判据）与
     * `src/imageInfo.js` 的 `PORTRAIT_RATIO`。三处不一致会出现「内置竖图
     * contain、自定义竖图被裁」这种莫名其妙的不一致，所以有断言盯着。
     */
    const PORTRAIT_RATIO = 0.87

    /** 尺寸 → cover / contain（与 `src/imageInfo.js` 的 `fitOfSize` 同规则）。 */
    function fitOfSize (size) {
      if (size === null || size === undefined) return 'cover'
      const { width, height } = size
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'cover'
      return width / height < PORTRAIT_RATIO ? 'contain' : 'cover'
    }

    /** 文案。zh 为准，en 覆盖同一 key 集。 */
    const DICT = {
      zh: {
        nav: '庄方宜',
        groupTheme: '主题',
        // ── 设置面板标题 + 卡片标题（0.9.3）─────────────────────────────
        // 对齐桌宠插件的设置面板：标题 + 一句副标题，然后按卡片分组。
        panelTitle: '庄方宜主题',
        panelSubtitle: '皮肤观感、壁纸与排版。改动即时生效并保存到本机。',
        cardBasic: '总开关',
        cardPreset: '配色预设',
        cardPresetLead: '预设是**整套风格**（配色 + 材质 + 代码高亮），不只是颜色。',
        cardScheme: '明暗',
        cardType: '排版',
        cardWallpaper: '壁纸',
        cardAdjust: '壁纸调节',
        cardRotate: '轮播',
        cardAccent: '强调色',
        cardDecor: '装饰',
        cardMotion: '动效',
        cardSkin: '皮肤',
        cardRest: '其它',
        // ── 五个页签（0.9.0）──────────────────────────────────────────
        // 原先的 7 组说明（groupXxxHint）已被页说明取代。
        tabLook: '外观',
        tabLookHint: '总开关、配色预设、明暗与排版',
        tabBackground: '背景',
        tabBackgroundHint: '壁纸、纱的厚薄与轮播',
        tabDetails: '细节',
        tabDetailsHint: '强调色与几处装饰性开关',
        tabMotion: '动效',
        tabMotionHint: '「跟随系统」会尊重系统的「减少动态效果」',
        tabSkin: '皮肤',
        tabSkinHint: '观测栏与头像气泡重绘',
        tabReset: '恢复本页',
        // 观测栏仍在用 groupWallpaper —— 它不再是页签标签，只是右栏那一组的名字
        groupWallpaper: '背景',
        // 壁纸选择器（0.9.0：收起一行 + 点击展开网格）
        bgChange: '更换图片',
        bgSearch: '搜索壁纸',
        bgGroupMine: '我的图片',
        bgEmpty: '没有匹配的壁纸',
        enabled: '启用主题',
        enabledHint: '关闭后界面立即回到 DSH 默认配色',
        preset: '配色预设',
        scheme: '明暗模式',
        schemeSystem: '跟随系统',
        schemeLight: '固定浅色',
        schemeDark: '固定深色',
        schemeHint: '「跟随系统」下切换系统主题，配色与背景会一起跟随',
        background: '背景图',
        wallpaperRecommend: '带标记的是当前预设的推荐壁纸（不会自动切换）',
        presetRecommend: '（本预设推荐）',
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
        fontFamily: '字体',
        font_default: '默认',
        font_sans: '无衬线',
        font_serif: '衬线',
        font_rounded: '圆体',
        font_mono: '等宽',
        fontScale_0_95: '紧凑',
        fontScale_1: '标准',
        fontScale_1_05: '宽松',
        fontFamilyHint: '整套界面的字族（不影响代码块与终端 —— 它们用等宽字体，改了会错位）',
        contentWidth: '阅读宽度',
        contentWidthHint: '正文一行的最大宽度。「标准」= 交还外壳（列宽的 64%，上限 920px）',
        contentWidth_auto: '标准',
        contentWidth_compact: '紧凑',
        contentWidth_wide: '宽松',
        // C14 一键推荐组合
        applyCombo: '一键推荐组合',
        applyComboHint: '按当前预设一次配好壁纸 / 不透明度 / 字体 / 阅读宽度（不改明暗偏好与动效）',
        applyComboDone: '已套用推荐组合',
        applyComboUnavailable: '宿主未提供组合数据（插件版本不匹配？）',
        // C12 导入 / 导出
        exportSettings: '导出设置',
        importSettings: '导入设置',
        exportHint: '下载当前设置为 JSON 文件，可分享或在另一台机器导入',
        importHint: '从 JSON 文件导入设置（整体替换当前设置）',
        importDone: '设置已导入',
        importBadJson: '文件不是合法的 JSON',
        importNotObject: '文件内容不是设置对象',
        importTooBig: '文件过大（上限 64 KB）',
        importNewer: '来自更新版本的设置，未知字段会被忽略',
        importAllDefault: '文件里没有可识别的设置项，已按默认值导入',
        // C13 明暗分档预设
        schemePresets: '明暗分别指定预设',
        presetLight: '浅色预设',
        presetDark: '深色预设',
        presetFollow: '跟随主预设',
        schemePresetsHint: '留「跟随主预设」时与上面那个预设一致；设了之后切明暗会连配色与材质一起换',
        // C15 壁纸轮播
        rotate: '壁纸轮播',
        rotateHint: '按间隔自动换壁纸（只在插件开着、页面可见时走；不写入设置文件）',
        rotateOff: '关闭',
        rotate60s: '1 分钟',
        rotate5m: '5 分钟',
        rotate30m: '30 分钟',
        rotateOrder: '轮播顺序',
        rotateSequential: '顺序',
        rotateRandom: '随机',
        // v8：轮播自定义列表
        rotateList: '轮播列表',
        rotateListAll: '全部内置',
        rotateListNew: '新建列表',
        rotateListDefaultName: '列表',
        rotateListEdit: '编辑',
        rotateListDone: '完成',
        rotateListDelete: '删除列表',
        rotateListDeleteArm: '确认删除？',
        rotateListName: '列表名称',
        rotateListEditingHint: '正在编辑：点上方缩略图添加 / 移除（「无」与自定义图不参与轮播）',
        rotateListEmptyHint: '空列表按「全部内置」轮播；至少加 2 张才有轮换效果',
        rotateListSaveName: '保存名称',
        fontScale: '字号',
        fontScaleHint: '正文与行高的整体缩放（±5%，幅度小是刻意的：再大就会撑破固定高度的行）',
        accentHue: '强调色色相',
        accentHueHint: '拖动改变强调色（按钮/链接/选中态）的色相；「预设」= 用配色自带的',
        accentHuePreset: '预设',
        splash: '启动动效',
        splashHint: '页面加载时播放一次干员立绘入场（不拦截点击）',
        motion: '动效',
        motionHint: '控制界面过渡动画。「开启」会无视系统的「减少动态效果」设置强制播放',
        motionOn: '开启',
        motionAuto: '跟随系统',
        motionReduced: '关闭',
        accentGlowHint: '聚焦控件时显示一层主题色柔光',
        heroAvatar: '空白页头像',
        titlebarFollow: '标题栏跟随',
        titlebarFollowHint: '桌面版：让 Windows 原生标题栏按钮区跟随主题色',
        reset: '恢复默认',
        resetConfirm: '确认恢复默认？',
        resave: '重新保存',
        // v7 自定义背景
        bgCustom: '自定义',
        bgUpload: '上传图片',
        bgUploading: '上传中…',
        bgCustomRemove: '删除这张自定义背景',
        bgUploaded: '图片已上传，点缩略图即可选用',
        bgTooLarge: '图片太大（上限 24 MB）',
        bgBadFormat: '不支持的格式（只接受 PNG / JPEG / GIF / WebP）',
        bgUnreadable: '读不出图片尺寸，文件可能已损坏',
        bgUploadFailed: '上传失败',
        bgRemoved: '已删除',
        retry: '重试',
        loading: '正在读取设置…',
        loadFailed: '无法连接插件后端，暂用默认设置',
        saveFailed: '保存失败，设置可能未落盘',
        sidebarToggle: '庄方宜主题',
        // v2 皮肤层
        brandName: '庄方宜',
        rail: '观测栏',
        railTitle: '庄方宜 · 观测台',
        localOnly: '仅本地渲染',
        stats: '会话读数',
        turns: '轮次',
        steps: '步数',
        rate: '速率',
        tokenTotal: 'token 总量',
        cache: '缓存命中',
        contextPct: '上下文',
        railHint: '右栏展开时作为官方标签页显示，收起时为右侧浮层；原生面板展开时让位；窄于 1180px 隐藏',
        railWidth: '观测栏宽度',
        avatarBubbles: '头像与气泡重绘',
        avatarBubblesHint: '助手消息旁显示头像，并重绘用户气泡与输入框'
      },
      en: {
        nav: 'Zhuang Fangyi',
        groupTheme: 'Theme',
        // ── panel title + card titles (0.9.3) ──────────────────────────
        panelTitle: 'Zhuang Fangyi theme',
        panelSubtitle: 'Look, wallpaper and typography. Changes apply instantly and save locally.',
        cardBasic: 'Master switch',
        cardPreset: 'Palette preset',
        cardPresetLead: 'A preset is a whole style (palette, surfaces, code tokens), not just colours.',
        cardScheme: 'Light / dark',
        cardType: 'Typography',
        cardWallpaper: 'Wallpaper',
        cardAdjust: 'Wallpaper tuning',
        cardRotate: 'Rotation',
        cardAccent: 'Accent',
        cardDecor: 'Decorations',
        cardMotion: 'Motion',
        cardSkin: 'Skin',
        cardRest: 'More',
        // ── five tabs (0.9.0) ──────────────────────────────────────────
        tabLook: 'Look',
        tabLookHint: 'Master switch, palette preset, light/dark and typography',
        tabBackground: 'Background',
        tabBackgroundHint: 'Wallpaper, veil thickness and rotation',
        tabDetails: 'Details',
        tabDetailsHint: 'Accent colour and a few decorative switches',
        tabMotion: 'Motion',
        tabMotionHint: '"Follow system" respects the OS "reduce motion" setting',
        tabSkin: 'Skin',
        tabSkinHint: 'Observation rail and avatar / bubble repaint',
        tabReset: 'Restore this page',
        // Still used by the observation rail — no longer a settings tab label
        groupWallpaper: 'Background',
        bgChange: 'Change image',
        bgSearch: 'Search wallpapers',
        bgGroupMine: 'My images',
        bgEmpty: 'No matching wallpaper',
        enabled: 'Enable theme',
        enabledHint: 'Turning this off restores the default DSH palette immediately',
        preset: 'Palette preset',
        scheme: 'Color scheme',
        schemeSystem: 'Follow system',
        schemeLight: 'Always light',
        schemeDark: 'Always dark',
        schemeHint: 'On "Follow system", switching the OS theme moves colors and wallpaper together',
        background: 'Background image',
        wallpaperRecommend: "The marked one is this preset's suggested wallpaper (never auto-applied)",
        presetRecommend: '(suggested)',
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
        fontFamily: 'Font',
        font_default: 'Default',
        font_sans: 'Sans',
        font_serif: 'Serif',
        font_rounded: 'Rounded',
        font_mono: 'Mono',
        fontScale_0_95: 'Compact',
        fontScale_1: 'Normal',
        fontScale_1_05: 'Roomy',
        fontFamilyHint: 'Typeface for the whole UI (code blocks and terminals keep their monospace font)',
        contentWidth: 'Reading width',
        contentWidthHint: 'Max width of one line of text. "Normal" hands control back to the shell (64% of the column, capped at 920px)',
        contentWidth_auto: 'Normal',
        contentWidth_compact: 'Compact',
        contentWidth_wide: 'Wide',
        // C14 one-click recommended combo
        applyCombo: 'Recommended combo',
        applyComboHint: 'Set wallpaper / opacity / typeface / reading width for this preset at once (leaves light-dark preference and motion alone)',
        applyComboDone: 'Recommended combo applied',
        applyComboUnavailable: 'The host did not provide combo data (plugin version mismatch?)',
        // C12 import / export
        exportSettings: 'Export settings',
        importSettings: 'Import settings',
        exportHint: 'Download the current settings as JSON — share it or import it on another machine',
        importHint: 'Import settings from a JSON file (replaces the current settings)',
        importDone: 'Settings imported',
        importBadJson: 'The file is not valid JSON',
        importNotObject: 'The file does not contain a settings object',
        importTooBig: 'File too large (64 KB limit)',
        importNewer: 'These settings come from a newer version; unknown fields will be ignored',
        importAllDefault: 'No recognisable settings found — imported as defaults',
        // C13 per-scheme presets
        schemePresets: 'Preset per light/dark',
        presetLight: 'Light preset',
        presetDark: 'Dark preset',
        presetFollow: 'Follow main preset',
        schemePresetsHint: 'While set to "Follow main preset" this matches the preset above; once set, switching light/dark swaps colours and materials together',
        // C15 wallpaper rotation
        rotate: 'Wallpaper rotation',
        rotateHint: 'Change the wallpaper on an interval (only while the plugin is on and the page is visible; never written to the settings file)',
        rotateOff: 'Off',
        rotate60s: '1 minute',
        rotate5m: '5 minutes',
        rotate30m: '30 minutes',
        rotateOrder: 'Rotation order',
        rotateSequential: 'In order',
        rotateRandom: 'Random',
        rotateList: 'Rotate list',
        rotateListAll: 'All built-in',
        rotateListNew: 'New list',
        rotateListDefaultName: 'List',
        rotateListEdit: 'Edit',
        rotateListDone: 'Done',
        rotateListDelete: 'Delete list',
        rotateListDeleteArm: 'Confirm delete?',
        rotateListName: 'List name',
        rotateListEditingHint: 'Editing: click thumbnails above to add or remove ("none" and custom uploads never rotate)',
        rotateListEmptyHint: 'An empty list falls back to all built-in; add at least 2 for actual rotation',
        rotateListSaveName: 'Save name',
        fontScale: 'Text size',
        fontScaleHint: 'Overall scale of body text and line height (±5% — deliberately small, larger breaks fixed-height rows)',
        accentHue: 'Accent hue',
        accentHueHint: 'Rotate the accent hue (buttons / links / selection); "Preset" keeps the palette\'s own',
        accentHuePreset: 'Preset',
        splash: 'Startup animation',
        splashHint: 'Play the operator artwork entrance once on page load (click-through)',
        motion: 'Motion',
        motionHint: '"On" forces transitions even when the system asks to reduce motion',
        motionOn: 'On',
        motionAuto: 'Follow system',
        motionReduced: 'Off',
        accentGlowHint: 'Show a soft accent glow on focused controls',
        heroAvatar: 'Empty-state avatar',
        titlebarFollow: 'Follow in title bar',
        titlebarFollowHint: 'Desktop: let the native Windows caption follow the theme',
        reset: 'Restore defaults',
        resetConfirm: 'Confirm restore?',
        resave: 'Save again',
        // v7 custom background
        bgCustom: 'Custom',
        bgUpload: 'Upload image',
        bgUploading: 'Uploading…',
        bgCustomRemove: 'Remove this custom background',
        bgUploaded: 'Uploaded — click the thumbnail to use it',
        bgTooLarge: 'Image too large (24 MB limit)',
        bgBadFormat: 'Unsupported format (PNG / JPEG / GIF / WebP only)',
        bgUnreadable: 'Could not read the image size — the file may be corrupt',
        bgUploadFailed: 'Upload failed',
        bgRemoved: 'Removed',
        retry: 'Retry',
        loading: 'Loading settings…',
        loadFailed: 'Cannot reach the plugin host; using defaults',
        saveFailed: 'Save failed; settings may not be persisted',
        sidebarToggle: 'Zhuang Fangyi theme',
        // v2 skin layer
        brandName: 'Zhuang Fangyi',
        rail: 'Observation rail',
        railTitle: 'Zhuang Fangyi · Observation',
        localOnly: 'local render only',
        stats: 'Session readout',
        turns: 'Turns',
        steps: 'Steps',
        rate: 'Rate',
        tokenTotal: 'Tokens',
        cache: 'Cache hit',
        contextPct: 'Context',
        railHint: 'Official tab when the right panel is open, side overlay when collapsed; yields to native panels; hidden below 1180px',
        railWidth: 'Rail width',
        avatarBubbles: 'Avatar and bubble restyle',
        avatarBubblesHint: 'Show an avatar beside assistant messages and restyle user bubbles and the composer'
      }
    }

    // >>> generated: wallpapers (do not edit) >>>
    // ⚠ 以下三块由 `tools/gen-wallpapers.mjs` 从 `src/wallpaperCatalog.js` 自动生成。
    //   客户端不能 import src/，所以必须是副本；生成器保证两侧一致。
    const BACKGROUNDS = [
      'none', 'sakura', 'promo', 'pool', 'ultrawide', 'dark', 'portrait', 'vertical', 'contour', 'off01', 'off02', 'off03', 'off04', 'off05', 'off06', 'off07', 'off08', 'off09', 'sce01', 'sce02', 'sce03', 'sce04', 'sce05', 'sce06', 'sce07', 'sce08', 'sce09', 'sce10', 'sce11', 'sce12', 'sce13', 'sce14', 'sce15', 'sce16', 'sce17', 'sce18', 'sce19', 'sce20', 'sce21', 'cha01', 'cha02', 'cha03', 'cha04', 'cha05', 'cha06', 'cha07', 'cha08', 'cha09', 'cha10', 'cha11', 'cha12', 'cha13', 'cha14', 'cha15', 'cha16', 'cha17', 'cha18', 'cha19', 'cha20'
    ]

    /** 壁纸 id → 中英标签（选择器与 aria-label 用）。 */
    const BG_LABELS = {
      none: { zh: '无', en: 'None' },
      sakura: { zh: '樱花树下', en: 'Under the cherry tree' },
      promo: { zh: '宣传 CG · 双人', en: 'Promo CG · two leads' },
      pool: { zh: '樱花池', en: 'Cherry-blossom pool' },
      ultrawide: { zh: '超宽横幅 · 樱花', en: 'Ultrawide blossoms' },
      dark: { zh: '暗调水面月影', en: 'Moonlit water' },
      portrait: { zh: '干员立绘卡', en: 'Operator card' },
      vertical: { zh: '竖版立绘循环', en: 'Vertical loop' },
      contour: { zh: '等高线纹理', en: 'Contour lines' },
      off01: { zh: '田野淡彩', en: 'Pastel fields' },
      off02: { zh: '荷塘古树', en: 'Lotus pond & ancient tree' },
      off03: { zh: '仙鹤云海', en: 'Cranes over cloud sea' },
      off04: { zh: '水墨长枪', en: 'Ink-wash spear' },
      off05: { zh: '溪谷气泡', en: 'Valley bubbles' },
      off06: { zh: '白蝶环绕', en: 'White butterflies' },
      off07: { zh: '白底立绘 · 全身', en: 'Full figure on white' },
      off08: { zh: '蓝天梨树', en: 'Pear tree, blue sky' },
      off09: { zh: '几何纹样 · 小兽', en: 'Geometry & critter' },
      sce01: { zh: '霓虹星空', en: 'Neon starfield' },
      sce02: { zh: '樱花回眸', en: 'Blossom glance' },
      sce03: { zh: '花枝云海', en: 'Blossoms & cloud sea' },
      sce04: { zh: '莲花池', en: 'Lotus pond' },
      sce05: { zh: '白花逆光', en: 'Backlit blossoms' },
      sce06: { zh: '卧姿立绘', en: 'Reclining figure' },
      sce07: { zh: '水墨淡彩', en: 'Muted ink wash' },
      sce08: { zh: '绘本光斑', en: 'Storybook bokeh' },
      sce09: { zh: '樱花远景', en: 'Blossom vista' },
      sce10: { zh: '荷塘绿调', en: 'Lotus greens' },
      sce11: { zh: '林间逆光', en: 'Forest backlight' },
      sce12: { zh: '红墙竹林', en: 'Red wall & bamboo' },
      sce13: { zh: '实机 · 室内', en: 'In-game interior' },
      sce14: { zh: '月洞门庭院', en: 'Moon-gate courtyard' },
      sce15: { zh: '拔刀动作', en: 'Blade draw' },
      sce16: { zh: '黄绿涂鸦', en: 'Yellow-green graffiti' },
      sce17: { zh: '暖木长廊', en: 'Warm wooden hall' },
      sce18: { zh: '湖畔灰绿', en: 'Lakeside grey-green' },
      sce19: { zh: '白花枝头', en: 'White blossoms' },
      sce20: { zh: '宽幅雪景', en: 'Ultrawide snow' },
      sce21: { zh: '朦胧厚涂', en: 'Soft impasto' },
      cha01: { zh: '雾中执器', en: 'Mist & instrument' },
      cha02: { zh: '夜樱双人', en: 'Night blossoms, two' },
      cha03: { zh: '双人立绘', en: 'Two figures' },
      cha04: { zh: '樱花林半身', en: 'Blossom grove' },
      cha05: { zh: '绿调全身', en: 'Full figure, green' },
      cha06: { zh: '深底礼服', en: 'Gown on dark' },
      cha07: { zh: '暗青飘带', en: 'Dark teal ribbons' },
      cha08: { zh: '夜色长裙', en: 'Night gown' },
      cha09: { zh: '夜巷侠客', en: 'Night alley' },
      cha10: { zh: '白底单体', en: 'Solo on white' },
      cha11: { zh: '光效飘带', en: 'Light trails' },
      cha12: { zh: '蓝天白云', en: 'Blue sky' },
      cha13: { zh: '侧颜特写', en: 'Profile portrait' },
      cha14: { zh: '暖光坐姿', en: 'Warm light, seated' },
      cha15: { zh: '便服半身', en: 'Casual half-length' },
      cha16: { zh: '黄昏逆光', en: 'Dusk backlight' },
      cha17: { zh: '黑裙暖光', en: 'Black gown, warm light' },
      cha18: { zh: '白花散落', en: 'Scattered petals' },
      cha19: { zh: '樱花覆水', en: 'Blossoms on water' },
      cha20: { zh: '暗蓝全身', en: 'Full figure on dark blue' },
    }

    /** 壁纸分组（选择器按组显示标题）。 */
    const BG_GROUPS = [
      { id: 'official', zh: '官方物料', en: 'Official' },
      { id: 'scene', zh: '场景与横图', en: 'Scenery' },
      { id: 'char', zh: '角色竖图', en: 'Character' },
      { id: 'texture', zh: '纹理与极简', en: 'Texture' },
    ]

    /** 壁纸 id → 分组 id。 */
    const BG_GROUP_OF = {
      sakura: 'scene',
      promo: 'scene',
      pool: 'scene',
      ultrawide: 'scene',
      dark: 'scene',
      portrait: 'char',
      vertical: 'char',
      contour: 'texture',
      off01: 'official',
      off02: 'official',
      off03: 'official',
      off04: 'official',
      off05: 'official',
      off06: 'official',
      off07: 'official',
      off08: 'official',
      off09: 'official',
      sce01: 'scene',
      sce02: 'scene',
      sce03: 'scene',
      sce04: 'scene',
      sce05: 'scene',
      sce06: 'scene',
      sce07: 'scene',
      sce08: 'scene',
      sce09: 'scene',
      sce10: 'scene',
      sce11: 'scene',
      sce12: 'scene',
      sce13: 'scene',
      sce14: 'scene',
      sce15: 'scene',
      sce16: 'scene',
      sce17: 'scene',
      sce18: 'scene',
      sce19: 'scene',
      sce20: 'scene',
      sce21: 'scene',
      cha01: 'char',
      cha02: 'char',
      cha03: 'char',
      cha04: 'char',
      cha05: 'char',
      cha06: 'char',
      cha07: 'char',
      cha08: 'char',
      cha09: 'char',
      cha10: 'char',
      cha11: 'char',
      cha12: 'char',
      cha13: 'char',
      cha14: 'char',
      cha15: 'char',
      cha16: 'char',
      cha17: 'char',
      cha18: 'char',
      cha19: 'char',
      cha20: 'char',
    }
    // <<< generated: wallpapers <<<
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

    /**
     * 当前背景对应的 `--zf-art-src` 值。
     *
     * ── 为什么要分两路 ──────────────────────────────────────────────────
     *
     * 内置壁纸写成 `var(--zf-art-<id>)`：变量表由宿主在 `structureCss()` 里
     * **静态生成**（遍历 `BACKGROUNDS`），所以客户端只需要写变量名。
     *
     * 自定义图**没有固定 URL**（文件名是上传时才生成的），走不了那张静态表 ——
     * 只能由客户端直接写 `url(...)`。
     *
     * ⚠️ **不拼 `-dark`**（0.8.0 起，产品决定：壁纸不再分明暗两版）。
     * 原先内置图在深色下拼 `--zf-art-<id>-dark`、自定义图不拼 —— 两套行为
     * 纯属历史包袱：`prepare-art.py` 的压暗收益本来就小（壁纸默认 14% 不透明，
     * 正文可读性靠纱层 + 观测栏的 backdrop-filter 兜），却让每张图多产出
     * 一个文件、两个 CSS 变量、一张缩略图。现在统一「一张图、明暗共用」，
     * 与自定义图行为一致。`scheme` 参数保留（调用方还有别处用）。
     *
     * @param {object} settings
     * @param {'light'|'dark'} scheme
     * @returns {string} `var(--zf-art-…)` / `url("…")` / `'none'`
     */
    function artSrcOf (settings, scheme) {
      if (settings?.background === 'none') return 'none'
      if (settings?.background === CUSTOM_BACKGROUND) {
        const custom = settings.customBackground
        if (custom === null || custom === undefined || typeof custom.file !== 'string') return 'none'
        return `url("${ROUTE}/backgrounds/${encodeURIComponent(custom.file)}")`
      }
      return `var(--zf-art-${settings.background})`
    }

    /**
     * 当前背景的「该 cover 还是 contain」。
     *
     * 内置图查宿主下发的 `wallpapers.json`（生成器按宽高比算好）；
     * 自定义图没有清单条目，用**上传时存下的尺寸**按同一阈值判
     * （`fitOfSize` 的 0.87 与 `prepare-art.py` 一致，有断言盯着这两个数相等）。
     */
    function artFitOf (settings, meta) {
      if (settings?.background === CUSTOM_BACKGROUND) {
        return fitOfSize(settings.customBackground?.size) === 'contain' ? 'contain' : 'cover'
      }
      const file = `wallpaper-${settings.background}.webp`
      return meta?.[file]?.fit === 'contain' ? 'contain' : 'cover'
    }

    /**
     * C13：某个明暗档位**实际生效**的预设。
     *
     * 与 `src/settings.js` 的 `presetForScheme` 是同一套规则 —— 客户端是自包含
     * bundle（不能 import src/），所以这里是一份**本地副本**。为了不让它漂移，
     * 无头测试里有一条断言：拿同一组输入分别跑宿主版与客户端版，结果必须相等。
     *
     * 未分档（`presetLight` / `presetDark` 均为 null）时恒等于 `preset`，
     * 所以 v5 老设置的行为一字不变。
     */
    function presetForScheme (settings, scheme) {
      if (settings === null || settings === undefined) return 'zhuang'
      const specific = scheme === 'dark' ? settings.presetDark : settings.presetLight
      if (PRESETS.includes(specific)) return specific
      return PRESETS.includes(settings.preset) ? settings.preset : 'zhuang'
    }

    /** C13：是否启用了明暗分档（与 `src/settings.js` 的 `hasSchemePresets` 同规则）。 */
    function hasSchemePresets (settings) {
      if (settings === null || settings === undefined) return false
      return PRESETS.includes(settings.presetLight) || PRESETS.includes(settings.presetDark)
    }

    /**
     * C13：把「浅色预设的 light 值 + 深色预设的 dark 值」拼成一份 token 对。
     *
     * 为什么需要拼：`state.overrides[preset]` 是**单预设**的 `{token:{light,dark}}`，
     * 而外壳的 `overrideTokens` 只接受这一种形态 —— 它没有「按明暗选不同来源」的
     * 概念。所以要表达「浅色用青、深色用墨青金」，只能在**值**这一层拼：
     * 每个 token 取浅色预设的 light 与深色预设的 dark。
     *
     * 不分档（两个预设相同）时直接返回原表，不复制 —— 保持既有路径零变化。
     *
     * @param {object} settings
     * @param {object} table `state.overrides`（宿主下发的预设 token 表）
     * @returns {object|undefined}
     */
    function composeSchemeOverrides (settings, table) {
      const lightPreset = presetForScheme(settings, 'light')
      const darkPreset = presetForScheme(settings, 'dark')
      if (lightPreset === darkPreset) return table?.[lightPreset]
      const lightOv = table?.[lightPreset]
      const darkOv = table?.[darkPreset]
      if (lightOv === undefined || darkOv === undefined) return table?.[lightPreset]
      const out = {}
      for (const name of Object.keys(lightOv)) {
        const l = lightOv[name]
        const d = darkOv[name]
        // 某个 token 只在一边有 → 跳过（宁可少一个 token，也不要写出半截值
        // 让外壳的成对校验抛错）
        if (l === undefined || d === undefined) continue
        out[name] = { light: l.light, dark: d.dark }
      }
      return out
    }

    /**
     * 把设置写进 CSS 自定义属性与装饰属性。
     *
     * @param {object} settings 当前设置
     * @param {object} roles 预设角色表（算纱色）
     * @param {object} theme ctx.theme
     * @param {object} [meta] 壁纸清单（`{ "wallpaper-x.webp": {fit} }`）——
     *   竖图判据。**必须由调用方传入**：本函数在模块作用域，看不到 `apply()`
     *   里的 `state`（实测踩过：直接用 `state.wallpaperMeta` 会 ReferenceError）。
     */
    /* ------------------------------------------------------------------ *
     * 换壁纸的交叉淡入（B6）
     *
     * `background-image` 不能过渡，所以只能「钉住旧图、淡出新图之上」：
     *   ① 换图**之前**把 `html::before` 的**计算绘制快照**抄到临时元素上
     *      （图 / size / position / repeat / filter / transform）—— 它此刻与
     *      旧图逐像素一致，所以不存在「跳一下」；
     *   ② 写新的 `--zf-art-src`（当前层立刻变新图，压在临时层之上）；
     *   ③ 下一帧给临时层打 `data-zf-art-out` → 240ms 淡出 → **移除元素**。
     *
     * 为什么抄**计算值**而不是重算：换图常常同时换 fit（cover ⇄ contain，
     * 竖图/横图切换），重算容易与刚才那一帧不一致；抄计算值等于「所见即所抄」。
     *
     * 任何一步做不到（老引擎、测试桩没有伪元素计算值 / 没有 createElement）
     * → 返回 null，调用方直接切图，**退化成今天的行为**，不报错。
     */
    function readArtPaint (root) {
      if (typeof getComputedStyle !== 'function') return null
      let cs = null
      try { cs = getComputedStyle(root, '::before') } catch { return null }
      if (cs === null || cs === undefined) return null
      const image = String(cs.backgroundImage ?? '')
      if (image === '' || image === 'none') return null
      return {
        image,
        // 桩环境（无头测试）只给 backgroundImage，其余字段缺失 —— 一律回落空串，
        // 不要写 `undefined` 进去
        size: String(cs.backgroundSize ?? ''),
        position: String(cs.backgroundPosition ?? ''),
        repeat: String(cs.backgroundRepeat ?? ''),
        filter: String(cs.filter ?? ''),
        transform: String(cs.transform ?? '')
      }
    }

    /**
     * 动效是否允许交叉淡入。
     *   `reduced`（静止模式）→ 不做；`on` → 一定做；
     *   `auto`/未设置 → 跟随系统 `prefers-reduced-motion`。
     */
    function artFadeAllowed (settings) {
      const mode = settings?.motion
      if (mode === 'reduced') return false
      if (mode === 'on') return true
      try {
        return typeof matchMedia === 'function'
          ? matchMedia('(prefers-reduced-motion: reduce)').matches !== true
          : true
      } catch { return true }
    }

    /**
     * 换图前调用：把旧图钉到临时层，返回「写完新图之后调用」的触发器。
     * 不需要 / 做不到 → `null`（调用方什么都不用做）。
     */
    function armArtFade (root, doc) {
      const paint = readArtPaint(root)
      if (paint === null || doc === null || typeof doc.createElement !== 'function') return null
      let el = null
      try { el = doc.createElement('div') } catch { return null }
      if (el === null || el.style === undefined) return null
      el.className = 'zf-art-fade'
      el.setAttribute('aria-hidden', 'true')
      // 用 `style.setProperty`（而不是 `style.backgroundImage = …`）：
      // 与代码库其它地方一致，也让无头测试的样式桩读得到（它有 props Map）。
      el.style.setProperty('background-image', paint.image)
      el.style.setProperty('background-size', paint.size)
      el.style.setProperty('background-position', paint.position)
      el.style.setProperty('background-repeat', paint.repeat)
      el.style.setProperty('filter', paint.filter)
      el.style.setProperty('transform', paint.transform)
      // 挂在 `<html>` 上：与 `::before`/`::after` 同处**根层叠上下文**，
      // 负 z-index 才落在 body 内容之下（挂 body 里可能被 body 的层叠上下文
      // 困住）。层序由 CSS 里**显式的 z-index 链**决定：
      // 模糊垫底 -3 → 当前图 -2（`::before`）→ 本层 -1（上一张，淡出用）。
      if (typeof root.append === 'function') root.append(el)
      else if (typeof root.appendChild === 'function') root.appendChild(el)
      else return null

      return function fire () {
        artStats.fades += 1
        const raf = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : fn => setTimeout(fn, 16)
        raf(() => {
          el.setAttribute('data-zf-art-out', '')
          let done = false
          const finish = () => {
            if (done) return
            done = true
            try { el.remove() } catch { /* 已不在文档里 */ }
          }
          if (typeof el.addEventListener === 'function') {
            el.addEventListener('transitionend', finish, { once: true })
          }
          // 兜底：过渡被打断（元素被隐藏 / 标签页后台 / 引擎不派发事件）也要收尾，
          // 否则会留一层「永远淡不完」的旧图在壁纸上。
          setTimeout(finish, 420)
        })
      }
    }

    /* ------------------------------------------------------------------ *
     * 阅读宽度（B7）
     *
     * 外壳把 `--dsh-chat-content-width` 声明在 `[data-conversation-content]`
     * **自己**身上，而且它自己还会往容器写行内 `--dsh-chat-user-width`
     * （源码实测）。所以：
     *   · 写 `html` / `body` 一律无效（元素自己的声明赢过继承值）；
     *   · 只能在那**一个元素**上写行内 + `!important`，才能压过外壳那条声明。
     *
     * `auto` → 把属性移除，交还外壳（列宽 64%、上限 920px，也把外壳自己的
     * 宽度手柄还回去）。
     *
     * 关于 `!important`：实测**行内不带 important 也已经能压过外壳那条样式表
     * 声明**（行内 > 作者样式表）。这里仍然加上，是防外壳哪天把
     * `--dsh-chat-content-width` 也改成行内写（它现在只往该元素写
     * `--dsh-chat-user-width`）。
     *
     * ⚠️ 这两个字面量必须与 `src/settings.js` 的 `CONTENT_WIDTH_PX` 一致 ——
     * client.js 是手写 bundle（不能 import），有测试断言两处相同。
     */
    const CONTENT_WIDTHS = { compact: '760px', wide: '1080px' }
    /** 三档白名单（与 `src/settings.js` 的 `CONTENT_WIDTH_MODES` 一致，有测试断言）。 */
    const CONTENT_WIDTH_MODES = ['auto', 'compact', 'wide']

    function applyContentWidth (doc, mode) {
      const el = doc?.querySelector?.('[data-conversation-content]')
      if (el === null || el === undefined || el.style === undefined) return
      const value = CONTENT_WIDTHS[mode]
      if (typeof value === 'string') {
        // 值相同就不重复写（本函数在 refresh 里会被频繁调用）
        if (el.style.getPropertyValue('--dsh-chat-content-width') === value) return
        el.style.setProperty('--dsh-chat-content-width', value, 'important')
      } else {
        if (el.style.getPropertyValue('--dsh-chat-content-width') === '') return
        el.style.removeProperty('--dsh-chat-content-width')
      }
    }

    /* ------------------------------------------------------------------ *
     * 代码高亮的 token 色（B9）
     *
     * 外壳给的是**写死的 OpenColor 字面色**（关键字粉、函数紫、字符串绿），
     * 与四套预设无关 —— 切预设时代码块是唯一「不跟随」的大面积区域。
     * 宿主按预设算好一组 token 色（已过对比度门禁），随 `/themes` 一起下发，
     * 这里写成**行内自定义属性**。
     *
     * ⚠️ 必须写在 **body** 上，不能写 html：外壳的暗色那一组声明在
     *   `body[data-ds-dark-theme]{--shiki-token-…}` 上（亮色在 `:root`）——
     * 自定义属性按**最近祖先**解析，挂 html 的话暗色下会被 body 那条压回去。
     * 行内样式优先级高于普通样式表规则，所以 body 行内能同时压过两条。
     *
     * 宿主没给（门禁把它砍了 / 老版本宿主）→ 移除该变量，**保留外壳默认色**。
     */
    const SHIKI_TOKEN_KEYS = [
      'comment', 'constant', 'function', 'keyword', 'link',
      'parameter', 'punctuation', 'string', 'string-expression'
    ]

    function applyCodeTokens (target, table) {
      if (target === null || target === undefined) return
      const t = target.style
      if (t === undefined) return
      for (const key of SHIKI_TOKEN_KEYS) {
        const name = `--shiki-token-${key}`
        const value = table?.[key]
        if (typeof value === 'string' && value !== '') t.setProperty(name, value)
        else t.removeProperty(name)
      }
    }

    /**
     * 交叉淡入的计数（诊断用）。
     *
     * ⚠️ 必须是**模块级**的：`armArtFade` 与它的 `fire()` 都在模块作用域，
     * 读不到 `apply()` 里的 `state` —— 写成 `state.artFades += 1` 会直接
     * `ReferenceError: state is not defined`（实测踩过，而且这是仓库里第三次
     * 踩同一个坑：模块作用域的函数碰 apply 内的状态）。
     * `/diag` 从它取值，用来区分「压根没建层」与「建了看不见」。
     */
    const artStats = { fades: 0 }

    /**
     * 壁纸的 `background-position`（B8：逐图取景）。
     *
     * 优先级（**顺序本身就是设计**，别随手调）：
     *   1. 用户选了「平铺」→ `0 0`：平铺不裁切，位置没有意义；
     *   2. 清单里有逐图 `focus` **且**用户没显式选位置（仍是默认的 `cover`）→ 用 focus；
     *      ——「靠右」是用户的明确表达，必须尊重，不能被 focus 顶掉；
     *   3. 竖图（contain 完整显示）→ `center 22%`：纵向留边时偏上，保住头部；
     *   4. 其余 → `right center` / `center`。
     *
     * `focus` 只在**画面被裁切**时才有可见效果（窗口宽高比 ≠ 图片宽高比）。
     */
    function artPosition ({ tiled, pos, fit, focus }) {
      if (tiled === true) return '0 0'
      if (pos === 'cover' && typeof focus === 'string' && focus.trim() !== '') return focus.trim()
      if (fit === 'contain') return 'center 22%'
      return pos === 'right' ? 'right center' : 'center'
    }

    /* ------------------------------------------------------------------ *
     * 会话读数：优先用宿主的权威推送（C11），DOM 抓取降级为兜底
     *
     * ── 为什么要换 ──────────────────────────────────────────────────────
     * 观测台的六个读数与状态点原本全靠解析 DOM 文字。那套东西已经因为
     * 「外壳结构变了」栽过三次（右栏 pane / 左栏内层 / 输入区座位），
     * 每次都是同一个病：**读的不是权威来源**。
     *
     * ── 两条路的边界（**字段级回退**）──────────────────────────────────
     *   · 流新鲜（10s 内有帧）→ 六项读数与状态用宿主的；任一字段宿主给不出
     *     （`cacheHit` / `rate` / `context.used` 可以是 `null`）→ 那一格用 DOM 的；
     *   · 流不可用（没连上 / 会话不在宿主 / 断了且退避中 / 环境没有 EventSource）
     *     → 整条回退 DOM，行为与换之前**完全一样**。
     *
     * ── 环境差异 ────────────────────────────────────────────────────────
     * 桌面壳的渲染进程直接从磁盘读 index.html（`dsh-app://`），`/style.css`
     * 那条路已经证明同源 HTTP 可用；若某个载体不吃流式响应，`onerror` 会立刻
     * 把它记进 `reason`，客户端回退 DOM、并按 3s/10s/30s 退避重试 ——
     * 退路是宿主的 `?once=1` 单次快照（改一行就能改成轮询）。
     *
     * ⚠️ 状态放在**模块级** `streamState`：`refresh()` 在 apply 内，而这些函数
     * 在模块作用域 —— 反过来读 `state` 会直接 ReferenceError（仓库里踩过三次）。
     */
    const STREAM_FRESH_MS = 10000
    const STREAM_RETRY_MS = [3000, 10000, 30000]
    const streamState = {
      es: null,
      sessionId: '',
      payload: null,
      at: 0,
      retry: 0,
      timer: null,
      reason: 'idle',
      source: 'dom'
    }

    /** 当前会话 id（壳把 id 写在会话容器上：`data-conversation-session`）。 */
    function sessionIdOf (doc) {
      const el = doc?.querySelector?.('[data-conversation-session]')
      const id = el?.getAttribute?.('data-conversation-session')
      return typeof id === 'string' ? id : ''
    }

    /**
     * token 总量的显示：`1104M` / `9.6M` / `328K`。
     *
     * ⚠️ **最大单位就是 M**，不升到 G/T —— 外壳自己那条统计条就是这么显示的
     * （实测它的 DOM 文案是 `1104M tok`、`328M tok`）。两边显示同一个量级时，
     * 单位一致才好对照；`1.1G` 与 `1104M` 摆在一起会让人以为数字不一样。
     */
    function formatTokens (n) {
      if (typeof n !== 'number' || Number.isFinite(n) !== true || n <= 0) return '—'
      const units = [[1e6, 'M'], [1e3, 'K']]
      for (const [size, suffix] of units) {
        if (n >= size) {
          const v = n / size
          return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${suffix}`
        }
      }
      return String(Math.round(n))
    }

    /**
     * 把宿主载荷格式化成与 `readStats()` **同形**的六项字符串。
     * 宿主给不出的那一格用 DOM 的值（`dom` 由调用方传进来，就是今天的解析结果）。
     */
    function formatStats (payload, dom) {
      const t = payload ?? {}
      const used = t.context?.used
      return {
        turns: typeof t.turns === 'number' && t.turns > 0 ? String(t.turns) : dom.turns,
        steps: typeof t.steps === 'number' && t.steps > 0 ? String(t.steps) : dom.steps,
        rate: typeof t.rate === 'number' && t.rate > 0 ? String(Math.round(t.rate)) : dom.rate,
        tokens: typeof t.tokensTotal === 'number' && t.tokensTotal > 0
          ? formatTokens(t.tokensTotal)
          : dom.tokens,
        cache: typeof t.cacheHit === 'number' && Number.isFinite(t.cacheHit)
          ? `${Math.round(t.cacheHit * 100)}%`
          : dom.cache,
        context: typeof used === 'number' && Number.isFinite(used)
          ? `${Math.round(used * 100)}%`
          : dom.context
      }
    }

    /**
     * 新鲜才算数：10s 没帧就当作不可用（回退 DOM），而不是显示陈旧数字。
     *
     * 另外必须挡住 `live:false` 的载荷 —— 那是「会话不在宿主」时宿主给的
     * **占位全 0**，不是真实读数。SSE 路径靠 `unavailable` 帧把载荷置空，
     * 但 `?once=1` 轮询退路没有那一帧（宿主已把 `source` 标成 `none`，
     * 这里再按 `live` 兜一道，两条路都不会把 0 当成权威读数）。
     */
    function streamPayload () {
      const p = streamState.payload
      if (p === null) return null
      if (p.live === false) return null
      return Date.now() - streamState.at < STREAM_FRESH_MS ? p : null
    }

    function closeSessionStream (reason) {
      if (streamState.timer !== null) { clearTimeout(streamState.timer); streamState.timer = null }
      if (streamState.es !== null) {
        try { streamState.es.close() } catch { /* 已关 */ }
        streamState.es = null
      }
      streamState.sessionId = ''
      streamState.payload = null
      streamState.at = 0
      streamState.source = 'dom'
      if (typeof reason === 'string') streamState.reason = reason
    }

    function openSessionStream (id) {
      let es = null
      try {
        es = new EventSource(`${ROUTE}/stream?session=${encodeURIComponent(id)}`)
      } catch {
        streamState.reason = 'open-failed'
        return
      }
      streamState.es = es
      streamState.sessionId = id
      streamState.reason = 'connecting'
      const onState = event => {
        try {
          streamState.payload = JSON.parse(event.data)
          streamState.at = Date.now()
          streamState.source = 'sse'
          streamState.reason = 'ok'
          streamState.retry = 0
        } catch { streamState.reason = 'bad-frame' }
      }
      const onHello = event => {
        try {
          const info = JSON.parse(event.data)
          if (info?.live === false) streamState.reason = 'not-live'
        } catch { /* 头帧只做诊断，坏了不影响 */ }
      }
      const onUnavailable = () => { streamState.reason = 'not-live'; streamState.payload = null }
      if (typeof es.addEventListener === 'function') {
        es.addEventListener('state', onState)
        es.addEventListener('hello', onHello)
        es.addEventListener('unavailable', onUnavailable)
      }
      es.onerror = () => {
        // 断开（含服务端关闭、载体不吃流式）：回退 DOM + 退避重连
        const delay = STREAM_RETRY_MS[Math.min(streamState.retry, STREAM_RETRY_MS.length - 1)]
        streamState.retry += 1
        streamState.reason = streamState.reason === 'ok' ? 'closed' : streamState.reason
        closeSessionStream(streamState.reason)
        if (streamState.retry > STREAM_RETRY_MS.length) {
          // 连续失败到上限就停手（别再骚扰宿主），下次会话切换再试
          streamState.reason = 'gave-up'
          return
        }
        streamState.timer = setTimeout(() => {
          streamState.timer = null
          openSessionStream(id)
        }, delay)
      }
    }

    /** 每次 refresh 调一次：会话 id 变了就换连接；环境不支持则什么都不做。 */
    function syncSessionStream (doc) {
      if (typeof EventSource !== 'function') {
        streamState.reason = 'no-eventsource'
        return
      }
      const id = sessionIdOf(doc)
      if (id === '') {
        if (streamState.es !== null) closeSessionStream('no-session')
        else streamState.reason = 'no-session'
        return
      }
      if (streamState.es !== null && streamState.sessionId === id) return
      closeSessionStream('switch')
      streamState.retry = 0
      openSessionStream(id)
    }

    /** `/diag` 用：只报状态，不带任何内容。 */
    function streamDiag () {
      return {
        source: streamState.source,
        reason: streamState.reason,
        sessionId: streamState.sessionId,
        hasPayload: streamState.payload !== null,
        ageMs: streamState.at === 0 ? null : Date.now() - streamState.at,
        retry: streamState.retry,
        hasEventSource: typeof EventSource === 'function'
      }
    }

    function applyStyleVars (settings, roles, theme, meta) {
      const root = document.documentElement
      const body = document.body
      if (root === null || body === null) return

      if (settings.enabled !== true) {
        root.removeAttribute('data-zf-wallpaper')
        body.removeAttribute('data-zf-wallpaper')
        body.removeAttribute('data-zf-glow')
        body.removeAttribute('data-zf-contour')
        body.removeAttribute('data-zf-motion')
        body.removeAttribute('data-zf-depth')
        body.removeAttribute('data-zf-theme')
        root.removeAttribute('data-zf-font')
        root.removeAttribute('data-zf-font-scale')
        // 代码高亮 token 色也撤掉 → 回到外壳那套默认色
        applyCodeTokens(body, null)
        // 阅读宽度也交还外壳（列宽回到它自己的 64%）
        applyContentWidth(document, undefined)
        return
      }

      // 主题启用标记：**与各个装饰开关无关**（glow / contour / 壁纸都可能关掉，
      // 但主题本身还开着）。选中色、输入光标这类「一直在身上」的细节挂它 ——
      // 挂在某个装饰属性上会变成「关了微光，选中色也跟着回默认」。
      body.setAttribute('data-zf-theme', '')

      // B9：代码高亮 token 色（随预设 + 明暗；与壁纸无关，所以放在壁纸分支之外）
      applyCodeTokens(body, roles?.[presetForScheme(settings, currentScheme(theme))]?.[currentScheme(theme)]?.shiki)
      // B7：阅读宽度（同样与壁纸无关；那个元素可能还没渲染出来 —— refresh 里还会再试）
      applyContentWidth(document, settings.contentWidth)

      const hasWallpaper = settings.background !== 'none'

      // ── B6：换图前的准备（必须在写 `--zf-art-src` **之前**）────────────
      // 新值先算出来只为**比较**：只有真的换了图才做交叉淡入 —— 拖动
      // 不透明度/模糊/位置滑杆会反复重跑本函数，那时绝不该闪一下。
      //
      // 自定义图走 `url(...)`（`artSrcOf` 内部分流），且**一张图两套明暗共用**
      // → 切明暗时 URL 不变 → 自然不会触发淡入。这是期望行为（没换图就不该闪）。
      const nextArtSrc = hasWallpaper ? artSrcOf(settings, currentScheme(theme)) : 'none'
      const curArtSrc = root.style.getPropertyValue('--zf-art-src').trim()
      const fireArtFade = nextArtSrc !== curArtSrc && artFadeAllowed(settings)
        ? armArtFade(root, document)
        : null

      if (hasWallpaper) {
        // ⚠️ 上限**必须**与 `src/settings.js` 的 `BG_OPACITY_MAX` 一致。
        // client.js 是手写 bundle（走 DSH 的模块加载器），**不能 import** 那个
        // 常量，所以这里只能是字面量 —— 有测试断言两处相等，改一处漏一处会被抓。
        const alpha = Math.max(0, Math.min(90, settings.backgroundOpacity)) / 100
        const blur = Math.max(0, Math.min(16, settings.backgroundBlur))
        const pos = POSITIONS.includes(settings.backgroundPosition) ? settings.backgroundPosition : 'cover'

        // 纱的不透明度 = 1 - 壁纸强度。0% 壁纸 → 完全不透明（等同关闭）。
        const keep = 1 - alpha
        const scheme = currentScheme(theme)
        const preset = roles?.[presetForScheme(settings, scheme)]?.[scheme]
        if (preset !== undefined) {
          root.style.setProperty('--zf-veil', toRgba(preset.base, keep))
          root.style.setProperty('--zf-veil-sidebar', toRgba(preset.sidebar, keep))
        }

        // ── 竖图用 contain + 模糊垫底（见 index.js 的 `::after` 层）────────
        //
        // 内置图查宿主下发的 `wallpapers.json`（生成器按宽高比算好），
        // 自定义图用它自己的尺寸（`artFitOf` 内部已分流）。客户端**不猜**：
        // 1080×1920 这类竖图在横屏用 cover 只剩中间 40%，必须 contain 完整显示，
        // 两侧由同图重模糊的垫底层补上。
        const artSrc = artSrcOf(settings, scheme)
        const fit = artFitOf(settings, meta)
        const isCustom = settings.background === CUSTOM_BACKGROUND
        const artFile = isCustom
          ? null
          : `wallpaper-${settings.background}${scheme === 'dark' ? '-dark' : ''}.webp`
        // 用户显式选了「平铺」就尊重他（平铺本身不裁切，不需要垫底）
        const tiled = pos === 'tile'
        const effectiveFit = tiled ? 'auto' : fit

        root.style.setProperty('--zf-art-src', artSrc)
        root.style.setProperty('--zf-blur', `${blur}px`)
        // 模糊会把四边糊出去，轻微放大补上；不模糊时不放大，避免无谓重采样
        root.style.setProperty('--zf-art-scale', blur > 0 ? '1.04' : '1')
        root.style.setProperty('--zf-art-size', effectiveFit)
        // B8：清单里的逐图 `focus` 优先（用户显式选「靠右」时不覆盖它）。
        // 自定义图没有 focus（不做裁剪调整），传 undefined 即走居中。
        root.style.setProperty('--zf-art-position',
          artPosition({ tiled, pos, fit, focus: artFile === null ? undefined : meta?.[artFile]?.focus }))
        root.style.setProperty('--zf-art-repeat', tiled ? 'repeat' : 'no-repeat')
        // 垫底层：只有 contain 时才需要（横图铺满，没有空隙）。
        // 用**同一个 artSrc** 而不是重建 `var(--zf-art-<id>)` —— 自定义图
        // 没有那个变量（垫底会变成空 → 竖图两侧留黑）。
        root.style.setProperty('--zf-art-backdrop',
          !tiled && fit === 'contain' ? artSrc : 'none')
        // 垫底亮度：深色主题下压得更暗，避免两侧比前景还亮
        root.style.setProperty('--zf-backdrop-lum', scheme === 'dark' ? '0.5' : '0.72')
        root.setAttribute('data-zf-art-fit', !tiled && fit === 'contain' ? 'contain' : 'cover')
        root.setAttribute('data-zf-wallpaper', '')
        body.setAttribute('data-zf-wallpaper', '')
      } else {
        // 关掉壁纸：写 `none` 而不是移除属性 —— 旧图由临时层淡出，
        // 而「下一次再打开」因为值变了，才会正确地触发一次交叉淡入。
        root.style.setProperty('--zf-art-src', 'none')
        root.removeAttribute('data-zf-wallpaper')
        root.removeAttribute('data-zf-art-fit')
        body.removeAttribute('data-zf-wallpaper')
      }

      // 新图已经写在当前层上 → 让临时层淡出（B6）
      if (fireArtFade !== null) fireArtFade()

      // 动效模式：三态。
      //   on      → 打 "on"：CSS 里显式覆盖 prefers-reduced-motion，强制播放
      //   reduced → 打 "reduced"：关掉本插件的过渡
      //   auto    → 不打标记，交给 CSS 的 @media (prefers-reduced-motion)
      if (settings.motion === 'on') body.setAttribute('data-zf-motion', 'on')
      else if (settings.motion === 'reduced') body.setAttribute('data-zf-motion', 'reduced')
      else body.removeAttribute('data-zf-motion')

      // 排版：按设置写 `data-zf-font` / `data-zf-font-scale`
      // `default` / `1` 档**不打标记** —— 那两档就是外壳原样，不打可以少一次
      // DOM 写入，也让「恢复默认」真的回到零覆盖。
      const fontAttrs = fontAttrsFor(settings.fontFamily, settings.fontScale)
      if (fontAttrs.font === null) root.removeAttribute('data-zf-font')
      else root.setAttribute('data-zf-font', fontAttrs.font)
      if (fontAttrs.scale === null) root.removeAttribute('data-zf-font-scale')
      else root.setAttribute('data-zf-font-scale', fontAttrs.scale)

      // 材质深度：按预设写 `data-zf-depth`（CSS 侧覆盖 --dsw-elevation-*）
      // `soft` 档**不打标记** —— 那是官方默认值，不打省一次属性写入
      const depth = presetDepth(presetForScheme(settings, currentScheme(theme)))
      if (depth === 'soft') body.removeAttribute('data-zf-depth')
      else body.setAttribute('data-zf-depth', depth)

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
    /**
     * 明暗切换时把壁纸（前景 + 垫底）与纱切到对应版本。
     *
     * @param {object} [meta] 壁纸清单 —— 同 `applyStyleVars`，必须由调用方传入。
     */
    function syncSchemeWallpaper (settings, roles, theme, meta) {
      if (settings?.enabled !== true) return
      const scheme = currentScheme(theme)
      // B9：明暗切换时代码高亮也要跟着切（与壁纸无关）
      applyCodeTokens(document.body, roles?.[presetForScheme(settings, scheme)]?.[scheme]?.shiki)
      if (settings.background !== 'none') {
        const fit = artFitOf(settings, meta)
        const tiled = settings.backgroundPosition === 'tile'
        const root = document.documentElement
        // B6：明暗切换也是**换图**（内置壁纸的暗版是另一张实拍图），同样交叉淡入。
        // 自定义图只有一张、URL 与明暗无关 → 比较结果相同 → 不会白闪一下。
        const nextArtSrc = artSrcOf(settings, scheme)
        const fireArtFade = nextArtSrc !== root.style.getPropertyValue('--zf-art-src').trim() &&
          artFadeAllowed(settings)
          ? armArtFade(root, document)
          : null
        root.style.setProperty('--zf-art-src', nextArtSrc)
        // 明暗切换时前景与垫底一起切（内置暗版是另一张图，不能沿用亮版 url）。
        // 用同一个 nextArtSrc：自定义图没有 `--zf-art-<id>` 变量可引用。
        document.documentElement.style.setProperty('--zf-art-backdrop',
          !tiled && fit === 'contain' ? nextArtSrc : 'none')
        document.documentElement.style.setProperty('--zf-backdrop-lum',
          scheme === 'dark' ? '0.5' : '0.72')
        document.documentElement.setAttribute('data-zf-art-fit',
          !tiled && fit === 'contain' ? 'contain' : 'cover')
        if (fireArtFade !== null) fireArtFade()
      }
      const preset = roles?.[presetForScheme(settings, scheme)]?.[scheme]
      if (preset !== undefined && settings.background !== 'none') {
        // 同上：字面量必须与 BG_OPACITY_MAX 一致（有测试断言）
        const keep = 1 - Math.max(0, Math.min(90, settings.backgroundOpacity)) / 100
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
     * 回合」这类坑）：tool > running > error > stopped > done > ready > idle。
     *
     * `stopped` 的信号：用户按过「停止生成」后，外壳会在**当前回合**里渲染
     * 一个叶子 `<span>已停止</span>`（i18n `message.stopped`，interrupted 时
     * 挂在 AssistantMarkdown/过程栏里）。注意这是**叶子节点**且**按文本精确
     * 匹配**（中英两版），并用 `visible()` 过滤隐藏副本。
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
      const stopped = turn.some(row => [...row.querySelectorAll('span')].some(el =>
        el.children.length === 0 && visible(el) &&
        (el.textContent === '已停止' || el.textContent === 'Stopped')))
      if (stopped) return 'stopped'
      if (turn.some(row => row.dataset.chatFlowKind === 'turn-tail')) return 'done'
      return 'ready'
    }

    /**
     * 从统计行解析轮次 / 步数 / 缓存命中 / tok/s / token 总量 / 上下文占比。
     *
     * 只读外壳已渲染的文字（`[data-composer-stats]`），**不遍历消息正文** ——
     * 本插件是皮肤，不该读取会话内容。
     *
     * 实测样本（桌面端底部统计行）：
     *   `38轮 · 1079步 · 206 tok/s · 328M tok · 缓存命中 77% · 58%`
     *   `12 轮 · 34 步 · 缓存命中 87.5%`（旧格式，字段少）
     *
     * 上下文占比取**最后一个**百分数（缓存命中是第一个被锚定的）——
     * 只有出现 ≥2 个百分数才认定，宁缺勿错。
     */
    function readStats (doc) {
      const text = doc.querySelector('[data-composer-stats]')?.textContent ?? ''
      const counts = text.match(/(\d+)\s*(?:轮|turns?)\s*(?:[·&]\s*)?(\d+)\s*(?:步|steps?)/i)
      const cache = text.match(/(?:缓存命中|Cache hit)\s*(\d+(?:\.\d+)?)%/i)
      const rate = text.match(/(\d+(?:\.\d+)?)\s*tok\s*\/\s*s/i)
      const total = text.match(/([\d.]+)\s*([KMGT]?)\s*tok(?!\s*\/)/i)
      const percents = [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map(m => m[1])
      const context = percents.length >= 2 ? percents[percents.length - 1] : null
      return {
        turns: counts?.[1] ?? '—',
        steps: counts?.[2] ?? '—',
        cache: cache ? `${cache[1]}%` : '—',
        rate: rate ? rate[1] : '—',
        tokens: total ? `${total[1]}${total[2]}` : '—',
        context: context !== null ? `${context}%` : '—'
      }
    }

    /** 活跃状态集合：`sessionSince` 计时只在这两种状态下走。 */
    const ACTIVE_STATES = ['running', 'tool']

    /**
     * 格式化运行耗时：`mm:ss`（≥1 小时为 `h:mm:ss`）。
     * 输入毫秒；非法输入回落 `00:00`。
     */
    function formatElapsed (ms) {
      if (!Number.isFinite(ms) || ms < 0) return '00:00'
      const total = Math.floor(ms / 1000)
      const h = Math.floor(total / 3600)
      const m = Math.floor((total % 3600) / 60)
      const s = total % 60
      const mm = String(m).padStart(2, '0')
      const ss = String(s).padStart(2, '0')
      return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
    }

    /**
     * 会话状态迁移 —— 维护 `state.sessionSince`（运行起始时刻）。
     *
     * 规则（对标 Mornye 的「运行耗时」）：
     *   · 非活跃 → 活跃（ready/done/error/idle → running/tool）：记当前时刻；
     *   · 活跃 → 非活跃（停/完成/出错）：清零；
     *   · running ↔ tool 之间：**不重置** —— 同一次运行里的工具调用只是
     *     状态细节，不该把计时打断。
     * 说明：计时在内存里，刷新页面后重新开始（Mornye 从原生过程栏读，
     * 我们刻意不碰 DOM 时间，换稳定性和零依赖）。
     */
    function trackSessionSince (state, next) {
      const was = ACTIVE_STATES.includes(state.sessionState)
      const now = ACTIVE_STATES.includes(next)
      if (!was && now) state.sessionSince = Date.now()
      else if (was && !now) state.sessionSince = null
      state.sessionState = next
    }

    /**
     * 排版档位。
     *
     * 与 `src/fonts.js` 的 `FONT_FAMILIES` / `FONT_SCALES` **必须一致** ——
     * 客户端拿不到宿主的 ESM 模块（只通过 `/themes` 拿数据），只能各持一份。
     * 有测试断言两者相同，改一处漏一处会被抓出来。
     *
     * 显示名不在这里：走 `DICT` 的 `font_*` / `fontScale_*` 键（跟宿主 locale 走）。
     */
    const FONT_FAMILIES = ['default', 'sans', 'serif', 'rounded', 'mono']
    const FONT_SCALES = [0.95, 1, 1.05]

    /**
     * 当前生效的明暗**是否深色**。
     *
     * ── 为什么从 DOM 读，而不是「算好存进 state」──────────────────────
     *
     * 第一版想的是「在 `applyStyleVars` 里算好存进 `state.scheme`，组件读它」。
     * 那**不可行**：`applyStyleVars` 位于模块作用域，`state` 定义在 `apply()`
     * 内 —— 直接写会得到 `state is not defined`（同一类错误在这个文件里
     * 已经踩过两次：`syncSchemeWallpaper` 的 `state`、`presetDepth`）。
     *
     * 正确的判据其实**已经在 DOM 上**：外壳 presenter 把当前配色方案投成
     * `body[data-ds-dark-theme]`，而 `currentScheme(theme)` 的**第一个判据
     * 就是它**（源码实测）。在组件里读同一个属性，结果与实际渲染的壁纸
     * 必然一致，还免去拿 theme 服务与处理 `system` 档的麻烦。
     *
     * @param {object} settings
     * @returns {boolean}
     */
    function isDarkActive (settings) {
      try {
        if (document.body?.hasAttribute?.('data-ds-dark-theme') === true) return true
      } catch { /* 无 DOM：走兜底 */ }
      return settings?.scheme === 'dark'
    }

    /**
     * 从设置算出要写的两个排版属性。
     *
     * ⚠️ 必须是**模块作用域**：`applyStyleVars`（也在模块作用域）要用它。
     * 放进 `apply()` 会得到 `is not defined` —— 这个坑踩过两次了
     * （`syncSchemeWallpaper` 的 `state`、`presetDepth`）。
     *
     * 逻辑与 `src/fonts.js` 的 `fontAttrs()` 一致，但这里**重写一份**而不是
     * 从宿主 import —— 客户端半边拿不到宿主的 ESM 模块（它只通过 `/themes`
     * 拿数据）。所以两处要一起改，测试会断言它们一致。
     *
     * @param {string} family 设置里的字体档位
     * @param {number} scale 设置里的字号档位
     * @returns {{font: string|null, scale: string|null}}
     */
    function fontAttrsFor (family, scale) {
      const fam = FONT_FAMILIES.includes(family) ? family : 'default'
      // 夹到最近的一档（与宿主同规则）
      let best = FONT_SCALES[0]
      const n = typeof scale === 'number' ? scale : Number(scale)
      if (Number.isFinite(n)) {
        for (const s of FONT_SCALES) {
          if (Math.abs(s - n) < Math.abs(best - n)) best = s
        }
      } else {
        best = 1
      }
      return {
        font: fam === 'default' ? null : fam,
        scale: best === 1 ? null : String(best)
      }
    }

    /**
     * 某个壁纸是不是**当前预设的推荐壁纸**。
     *
     * 抽成纯函数有两个理由：
     *   1. **可测** —— 组件树在测试桩里只能渲染出顶层两级，取不到缩略图按钮，
     *      所以判定逻辑留在组件里就永远测不到（而它正是「绝不自动改壁纸」
     *      这条核心约束的载体）；
     *   2. **去重** —— 同一表达式原本在设置页与观测栏各写了一遍（共 3 处），
     *      改一处漏一处是迟早的事。
     *
     * @param {object} presetStyles 宿主下发的 `presetStyles`
     * @param {string} preset 当前预设 id
     * @param {string} file 壁纸 id（`BACKGROUNDS` 里的一项）
     */
    function isRecommendedArt (presetStyles, preset, file) {
      if (file === 'none') return false
      const recommended = presetStyles?.[preset]?.background
      if (typeof recommended !== 'string' || recommended === '') return false
      return file === recommended
    }

    /**
     * 预设 → 材质深度档位（`flat` / `soft` / `deep`）。
     *
     * ⚠️ 必须是**模块作用域**：`applyStyleVars`（也在模块作用域）要用它。
     * 放进 `apply()` 里会得到 `presetDepth is not defined` —— 与之前
     * `syncSchemeWallpaper` 踩过的 `state is not defined` 是同一类错误。
     *
     * 映射依据是每套预设的风格描述，**不是**配色数据 —— 所以放在这里而不是
     * `palette.js`（配色模块不该承担样式职责）：
     *
     *   zhuang 明亮轻盈 → flat  阴影最轻、描边最淡（接近纸面）
     *   burst  厚重深沉 → deep  阴影最重、描边最实（接近实体面板）
     *   cyan   清爽中性 → soft  官方默认
     *   wine   浓郁暖调 → soft  官方默认
     *
     * 未知预设回落 `soft`（= 不打标记，用官方默认值），保证不坏。
     */
    function presetDepth (presetId) {
      if (presetId === 'zhuang') return 'flat'
      if (presetId === 'burst') return 'deep'
      return 'soft'
    }


    /**
     * 是否运行在「有原生 Windows 标题栏」的载体上。
     *
     * 这个 `data-*` 由桌面壳的 preload 注入，只有 Windows 桌面端才有。
     * 用途有两处，必须用**同一个判据**（否则会出现「诊断说没有、界面却显示」
     * 这种自相矛盾的状态）：
     *   ① `/diag` 的 `hasWindowsTitlebar`；
     *   ② 设置页是否渲染「标题栏跟随」那一行 —— 它只对 Windows 桌面生效，
     *      在 macOS / 网页端是一个**没有任何作用的开关**（实测确认）。
     */
    function hasWindowsTitlebar (doc) {
      const root = doc?.documentElement ?? document?.documentElement
      return root?.hasAttribute?.('data-windows-titlebar') === true
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

        // 会话状态（右栏状态点与读数）—— 有权威推送就用它，否则回退 DOM。
        syncSessionStream(doc)
        const live = streamPayload()
        const domStats = readStats(doc)
        if (live !== null) {
          // 运行计时用**宿主的回合开始时刻**：刷新页面也不再从零开始，
          // 而且 running ↔ tool 之间不会被打断（turnStartedAt 是同一个回合）
          if (typeof live.turnStartedAt === 'number' && ACTIVE_STATES.includes(live.state)) {
            state.sessionSince = live.turnStartedAt
            state.sessionState = live.state
          } else {
            trackSessionSince(state, live.state)
          }
          state.stats = formatStats(live, domStats)
          state.statsSource = 'sse'
        } else {
          trackSessionSince(state, readSessionState(doc))
          state.stats = domStats
          state.statsSource = 'dom'
        }
        // B7：切会话时正文容器会重建，行内覆盖要跟着补上（幂等，值没变就不写）
        applyContentWidth(doc, state.settings?.contentWidth)
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

      /**
       * 壁纸标签读取器（0.8.0）。
       *
       * 59 张壁纸的中英名**不再进 DICT**（那是 3 处手抄漂移的根源），改由
       * `src/wallpaperCatalog.js` 生成、直接存在 `BG_LABELS` 里。这里只需要
       * 知道「当前该读 zh 还是 en」—— 用一个两边译文必然不同的探针键问
       * `t()`：返回 zh 译文就是中文界面。
       *
       * 为什么不走 `locale.bind()` 拿语言码：宿主的 locale API 只提供「按键取词」，
       * 不保证暴露当前语言标识；探测键在两种实现下都成立，是更薄的依赖。
       */
      const bgLang = () => (t('bgNone') === '无' ? 'zh' : 'en')
      const bgLabel = b => {
        const hit = BG_LABELS[b]
        if (!hit) return b
        return hit[bgLang()] ?? hit.zh ?? b
      }

      /** 运行时状态。 */
      const state = {
        settings: null,
        /**
         * 设置默认值（**宿主下发**，0.9.0 起）。
         *
         * 每个页签右侧的「恢复本页」要拿它做差集：客户端知道某个键属于
         * 哪一页，默认值却只在宿主那边，所以必须由宿主随 `GET /settings`
         * 一起下发。
         *
         * **`null` 是受支持的降级态**：宿主没升级（或测试桩没跟上）时它就是
         * null，此时「恢复本页」按钮整个不渲染，其余功能完全不受影响 ——
         * 不能因为一个装饰性按钮缺席就让设置页残废。
         */
        defaults: null,
        themes: [],
        overrides: {},
        themeRoles: {},
        /** 壁纸清单（宿主下发）：`{ "wallpaper-x.webp": { fit, width, height } }`。 */
        wallpaperMeta: {},
        /**
         * 每套预设的风格摘要（宿主下发）：
         * `{ [presetId]: { label, style, background, borderAlpha } }`。
         * `background` 是**推荐**壁纸 —— 只用来在选择器上打标记，
         * 绝不写回 `settings.background`（用户要求：手动选）。
         */
        presetStyles: {},
        // C14：一键推荐组合（宿主下发，客户端不重复定义这套映射）
        presetCombos: {},
        /**
         * 行内提示（中性色，几秒后自动消失）。
         *
         * ── 为什么必须与 `lastError` 分开 ──────────────────────────────
         *
         * 原先只有 `lastError` 一个字段，C12 的导入把 `importDone`（**成功**）、
         * `importNewer` / `importAllDefault`（**提示**）也写进了它 —— 而渲染处
         * 写死 `${t('saveFailed')}（…）` + 错误红，于是「导入成功」会显示成
         * **红色的「保存失败（设置已导入）」**。实测确认。
         *
         * 现在：`notice` 走中性色并自动消失，`lastError` 只放真正的错误。
         */
        notice: null,
        /** 上面那条提示的消失定时器（重入时先清掉旧的）。 */
        noticeTimer: null,
        /**
         * 「恢复默认」是否处于待确认状态。
         *
         * 一键抹掉全部设置，不该点一下就执行。放在 `state` 而不是组件内
         * `useState` —— 保存会触发全量重渲染，局部 state 会被重置
         * （与 notice 同一个原因）。
         */
        confirmReset: false,
        /** 待确认状态的自动复原定时器。 */
        confirmResetTimer: null,
        /** 自定义背景清单（宿主下发：`[{file, bytes, size, addedAt}]`）。 */
        customBackgrounds: [],
        /** 自定义背景的上传上限（宿主下发，避免客户端写死一个可能与宿主不一致的数）。 */
        customBgLimits: null,
        /** 是否正在上传（禁用上传格，防重复提交）。 */
        uploading: false,
        /**
         * 壁纸选择器是否处于展开态（0.9.0）。
         *
         * 放共享 `state` 而不是组件内 `useState`，原因与 `notice` /
         * `confirmReset` 完全一样：`save()` 会触发全量重渲染，局部 state
         * 会被重置，用户刚展开的网格会自己合上。
         *
         * **刻意不落盘**：浏览器本地存储（`browser:local-storage`）是发行
         * 清单里明确禁止的权限，`tools/check-manifest.mjs` 里有一条反向
         * 断言在盯着仓库里**连注释都不许出现那个词**。代价是重开设置页
         * 回到收起态 —— 明确接受。
         */
        pickerOpen: false,
        /** 壁纸搜索词（空 = 不过滤）。同样只在会话内存活。 */
        pickerQuery: '',
        /**
         * 当前页签（0.9.0）。
         *
         * 放共享 `state` 而不是组件内 `useState`：设置面板关闭时 `Section`
         * 会卸载，`useState` 随之归零，用户每开一次设置都回到第一页。放这里
         * 则**同一会话内记住上次停留的页**（面板重开还在原地）。
         *
         * 另一个好处是**可测**：测试桩里 `useState` 返回 undefined，用它存
         * 页签的话，除了第一页以外的任何一页都没法验证。
         *
         * 仍然**不落盘**：浏览器本地存储是发行清单里明确禁止的权限
         * （`tools/check-manifest.mjs` 里有反向断言），写进 settings.json
         * 又会把用户的设置文件弄脏。同一会话内记住已经够用。
         */
        activeTab: 'look',
        /**
         * C13：`applySettings` 重入闸门。
         *
         * `applySettings` 在固定明暗下会调 `theme.setTheme(id)`，外壳的
         * `setTheme` 会 emit `theme/change` → 我们又调 `applySettings` → 递归。
         * 用这个标记挡住嵌套调用。
         */
        applying: false,
        /** C15：壁纸轮播定时器（null = 未启动）。 */
        rotateTimer: null,
        /** C15：设置变化时重排轮播（由 `syncRotation` 赋值）。 */
        rotationSync: null,
        /** 本次页面会话是否已经播过启动动效（避免每次 emit 都闪一次）。 */
        splashPlayed: false,
        /** 是否已让宿主首帧遮罩退役（幂等，见 Splash 的交接说明）。 */
        firstFrameEnded: false,
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
        /** 运行起始时刻（ms）。活跃状态下为 Date.now()，非活跃为 null。 */
        sessionSince: null,
        stats: { turns: '—', steps: '—', cache: '—', rate: '—', tokens: '—', context: '—' },
        /** 读数的来源（C11）：`sse` = 宿主权威推送，`dom` = 兜底解析。 */
        statsSource: 'dom',
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

      /**
       * 显示一条**中性色**行内提示，几秒后自动消失。
       *
       * 与 `state.lastError` 严格分工：提示走这里（不报错），错误走 `lastError`。
       * 两处（C14 套用组合、C12 导入结果）共用这一个机制 —— 原先各写一套
       * timer，而且 C12 那套还写错了字段（成功写进 lastError）。
       *
       * @param {string} text 文案（已是本地化后的字符串）
       * @param {number} [ms] 停留时长
       */
      function setNotice (text, ms = 2600) {
        state.notice = text
        // 重入时先清掉上一个 timer，否则旧 timer 会提前清掉新提示
        if (state.noticeTimer !== null) clearTimeout(state.noticeTimer)
        state.noticeTimer = setTimeout(() => {
          state.notice = null
          state.noticeTimer = null
          emit()
        }, ms)
        emit()
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
          body.removeAttribute('data-zf-theme')
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
       * C13：当前设置对应的 token 覆盖表。
       *
       * 不分档 → 就是单预设那套（与改动前完全一致）；
       * 分档 → 拼出「浅色取 A.light、深色取 B.dark」的对。
       *
       * 这是 `state.overrides` 的**唯一**消费入口，避免某处漏掉分档逻辑。
       */
      function overridesForSettings (s) {
        if (!hasSchemePresets(s)) return state.overrides[s.preset]
        return composeSchemeOverrides(s, state.overrides)
      }

      /**
       * 应用设置。先 teardown 再挂载，全程同步，不产生中间绘制帧。
       */
      function applySettings () {
        const s = state.settings
        if (s === null) return
        // C13 重入闸门：固定明暗下会 `theme.setTheme(id)`，外壳的 setTheme 会
        // 再 emit `theme/change`。闸门必须在**调用之前**就置位，否则递归挡不住
        // （早先把置位写在了事件回调里 —— 那样只是「回调里再进不来」，
        // 但 applySettings 本身还是被重入了）。
        if (state.applying) return
        state.applying = true
        try {
          applySettingsInner(s)
        } finally {
          state.applying = false
        }
      }

      /** `applySettings` 的实际内容（闸门在外层，见上）。 */
      function applySettingsInner (s) {
        teardown()
        // C15：每次应用设置都重排轮播 —— 间隔/顺序/开关/壁纸任一变化都要生效。
        // 放在 teardown 之后、其它挂载之前，且 `syncRotation` 自身幂等。
        state.rotationSync?.()
        if (s.enabled !== true) {
          applyStyleVars(s, state.themeRoles, theme, state.wallpaperMeta)
          syncHeroMark()
          emit()
          return
        }

        const overrides = overridesForSettings(s)
        if (overrides === undefined) return

        let tookOver = false
        if (s.scheme === 'system') {
          // token 层：不改 preference，保住 prefers-color-scheme 跟随。
          //
          // C13：走 token 层时**必须**用「浅色预设的 light + 深色预设的 dark」
          // 拼出来的对（`overridesForSettings`），因为外壳的明暗由系统决定，
          // 我们无法用单一预设的两套值表达「浅色 A / 深色 B」。
          state.layerDispose = theme.overrideTokens(LAYER, overrides)
          tookOver = true
        } else {
          const id = `${presetForScheme(s, s.scheme)}-${s.scheme}`
          if (state.registered.has(id)) {
            theme.setTheme(id)
            tookOver = true
          } else {
            // 注册失败（id 冲突等）时退回 token 层，保证配色仍然生效
            state.layerDispose = theme.overrideTokens(LAYER, overrides)
            tookOver = true
          }
        }

        applyStyleVars(s, state.themeRoles, theme, state.wallpaperMeta)
        syncSchemeWallpaper(s, state.themeRoles, theme, state.wallpaperMeta)
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
            hasWindowsTitlebar: hasWindowsTitlebar(),
            hasRailEl: document.querySelector('.zf-rail') !== null,
            // ── 渲染诊断：直接回答「组件跑了几次、为什么返回 null」──
            // 每次 `Rail()` 被调用都计数并记录返回类型，避免再靠推理猜时序。
            render: { ...state.renderCounts },
            // 换壁纸交叉淡入触发次数（诊断「看不出淡入」：0 = 压根没建层）
            artFades: artStats.fades,
            // 观测台读数走的是哪条路（C11）：`sse` = 宿主权威推送，`dom` = 兜底
            statsSource: state.statsSource,
            stream: streamDiag(),
            // 官方右栏 tab 的注册结果（主路径是否走通）
            officialTab: {
              ...state.tabDiag,
              registered: state.tabRegistered,
              // 「真的挂着内容」才代表 tab 可见 —— 注册成功但 tabMounted=0
              // 就是「类型声明好了但用户没打开」的状态
              mounted: state.tabMounted,
              // 原生面板是否展开：收起时 tab 仍挂载但被移出可视区，
              // 这个字段能立刻区分「tab 在显示」与「tab 挂着但看不见」
              panelOpen: nativeRightbarOpen(document),
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
            /**
             * 壁纸渲染探针 —— 逐环报告「画没画」。
             *
             * 为什么需要：`artSrc` 只能证明变量被写了，证明不了**画出来**。
             * 这条链有 5 环，任一环断掉都表现为「背景没反应」：
             *   ① 属性 `html[data-zf-wallpaper]` 在不在
             *   ② `--zf-art-src` 有没有值（间接引用 `var(--zf-art-<id>)`）
             *   ③ 被引用的 `--zf-art-<id>` 有没有解析成 url(...)
             *   ④ `::before` 的 `background-image` 最终算出来是什么
             *   ⑤ 上层（frame / 中栏）是否已透明 —— 不透明就会盖住壁纸
             * 有了这五条，「背景不行」就能一次定位到具体哪环，不用来回猜。
             */
            wallpaper: (() => {
              try {
                const html = document.documentElement
                const cs = getComputedStyle(html)
                const before = getComputedStyle(html, '::before')
                const frame = document.querySelector('[data-zf-frame], [class*="_frame"]')
                const center = document.querySelector('[data-zf-center], [class*="_centerCol"]')
                const bg = el => {
                  if (el === null) return null
                  const s = getComputedStyle(el)
                  return `${s.backgroundColor} / img:${s.backgroundImage.slice(0, 40)}`
                }
                return {
                  attr: html.hasAttribute('data-zf-wallpaper'),
                  bodyAttr: document.body?.hasAttribute?.('data-zf-wallpaper') ?? null,
                  // 竖图 contain 链路：fit 标记、前景 size、垫底 url
                  fit: html.getAttribute('data-zf-art-fit'),
          // ── 临时诊断：观测栏正上方那块（Windows 标题栏带右侧）到底有什么 ──
          // 用户截图显示那块没透壁纸（亮度 27 vs 左侧 70）。与其继续考古
          // 外壳 CSS，直接问运行中的页面：那个坐标上最顶层的元素是谁。
          stripProbe: (() => {
            try {
              const rail = document.querySelector('.zf-rail') ??
                document.querySelector('[class*="_rightbarCol"]')
              if (rail === null) return { err: 'no-rail' }
              const r = rail.getBoundingClientRect()
              const cx = Math.round(r.left + r.width / 2)
              const cy = Math.round(Math.max(2, (parseFloat(
                getComputedStyle(document.documentElement)
                  .getPropertyValue('--dsh-windows-titlebar-height')) || 40) / 2))
              const stack = document.elementsFromPoint(cx, cy)
              const describe = el => {
                const cs = getComputedStyle(el)
                return {
                  tag: el.tagName.toLowerCase(),
                  cls: String(el.className ?? '').slice(0, 60),
                  bg: cs.backgroundColor,
                  z: cs.zIndex,
                  pos: cs.position
                }
              }
              return {
                at: { x: cx, y: cy },
                railRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) },
                stack: stack.slice(0, 6).map(describe)
              }
            } catch (e) { return { err: String(e?.message ?? e) } }
          })(),
                  size: cs.getPropertyValue('--zf-art-size').trim(),
                  position: cs.getPropertyValue('--zf-art-position').trim(),
                  backdrop: cs.getPropertyValue('--zf-art-backdrop').trim().slice(0, 60),
                  veil: cs.getPropertyValue('--zf-veil').trim(),
                  artSrc: cs.getPropertyValue('--zf-art-src').trim().slice(0, 90),
                  // ③ 被引用变量的解析结果（写成 url(...) 才算通）
                  resolvedArtVar: (() => {
                    const id = state.settings?.background
                    if (!id || id === 'none') return null
                    return cs.getPropertyValue(`--zf-art-${id}`).trim().slice(0, 90)
                  })(),
                  // ④ 真正绘制层
                  beforeBgImage: before.backgroundImage.slice(0, 90),
                  beforeContent: before.content,
                  beforeZ: before.zIndex,
                  beforeDisplay: before.display,
                  htmlBg: cs.backgroundColor,
                  // ⑤ 上层是否透明
                  frameBg: bg(frame),
                  centerBg: bg(center)
                }
              } catch (error) {
                return { error: String(error?.message ?? error) }
              }
            })(),
            railShown: state.railShown,
            // 观测台解析出的读数（排障用：统计行格式变了先看这里）
            stats: { ...state.stats },
            settings: state.settings === null
              ? null
              : {
                  enabled: state.settings.enabled,
                  preset: state.settings.preset,
                  scheme: state.settings.scheme,
                  background: state.settings.background,
                  backgroundOpacity: state.settings.backgroundOpacity,
                  backgroundBlur: state.settings.backgroundBlur,
                  backgroundPosition: state.settings.backgroundPosition,
                  rail: state.settings.rail,
                  railWidth: state.settings.railWidth,
                  avatarBubbles: state.settings.avatarBubbles,
                  accentHue: state.settings.accentHue,
                  motion: state.settings.motion,
                  splash: state.settings.splash !== false
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
          // 「恢复本页」要拿默认值做差集。缺失就留 null（见 state.defaults 的
          // 注释）—— 那是受支持的降级态，不是错误，所以不写 lastError。
          state.defaults = settingsPayload.defaults ?? null
          state.themes = themePayload.themes ?? []
          state.overrides = themePayload.overrides ?? {}
          state.themeRoles = themePayload.roles ?? {}
          state.presetStyles = themePayload.presetStyles ?? {}
          state.presetCombos = themePayload.presetCombos ?? {}
          state.customBackgrounds = themePayload.customBackgrounds ?? []
          state.customBgLimits = themePayload.customBackgroundLimits ?? null
          // 壁纸清单：竖图用 contain 的依据（宿主从 art/wallpapers.json 读）
          state.wallpaperMeta = themePayload.wallpaperMeta ?? {}
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
        const prevAccent = state.settings?.accentHue
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
        // 强调色色相改了 → 主题 token 表整体变了，必须重新拉取并重注册。
        //
        // 为什么不能只改 CSS 变量：主题的 token 是**宿主算好下发**的
        // （客户端不 import palette.js），而且已注册的主题在 `state.registered`
        // 里有缓存（`registerThemes` 见到已注册 id 会跳过）。所以要先注销、
        // 重取 `/themes`、再注册，否则改动不生效（表现为「选了色相没反应」）。
        if (next.accentHue !== prevAccent) await reloadThemes()
        emit()
      }

      /* ---------------- 自定义背景（v7） ---------------- */

      /**
       * 上传一张本地图片作为背景。
       *
       * 客户端**不做格式/尺寸校验** —— 那两件事只有宿主能做对：
       *   · 格式要看**字节魔数**（不看 `content-type`，也不看扩展名），
       *     客户端拿到的 `File.type` 是浏览器根据扩展名猜的，不可信；
       *   · 尺寸要解析图片头，而这需要完整字节。
       * 所以这里只挡一个「明显太大」的早退（省一次 24 MB 的上传），
       * 真正的边界在宿主 `saveBackground()`。
       *
       * 上传成功后**不自动切换**壁纸（与「推荐壁纸只提示、不自动切换」同一
       * 原则）：刷新列表 + 提示，由用户在缩略图条里点选。
       */
      async function uploadBackground (file) {
        if (file === null || file === undefined) return
        const limit = state.customBgLimits?.maxBytes ?? 0
        if (limit > 0 && typeof file.size === 'number' && file.size > limit) {
          state.lastError = t('bgTooLarge')
          emit()
          return
        }
        state.uploading = true
        emit()
        try {
          const res = await fetch(`${ROUTE}/backgrounds`, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: file
          })
          const payload = await res.json().catch(() => null)
          if (res.ok !== true) {
            // 宿主的错误码 → 可读文案
            const code = payload?.error
            state.lastError = code === 'too-large'
              ? t('bgTooLarge')
              : code === 'unsupported-format'
                ? t('bgBadFormat')
                : code === 'unreadable-image'
                  ? t('bgUnreadable')
                  : `${t('bgUploadFailed')}（${code ?? res.status}）`
            state.customBackgrounds = payload?.backgrounds ?? state.customBackgrounds
          } else {
            state.lastError = null
            state.customBackgrounds = payload?.backgrounds ?? state.customBackgrounds
            setNotice(t('bgUploaded'))
          }
        } catch (error) {
          state.lastError = String(error?.message ?? error)
          console.warn('[zhuang-fangyi] 背景上传失败：', state.lastError)
        } finally {
          state.uploading = false
          emit()
        }
      }

      /** 删除一张自定义背景。若正是当前壁纸，宿主会把 `background` 置回 `none`。 */
      async function removeBackground (file) {
        try {
          const payload = await api(`/backgrounds/${encodeURIComponent(file)}`, { method: 'DELETE' })
          state.customBackgrounds = payload?.backgrounds ?? state.customBackgrounds
          // 宿主已把设置改掉（清掉死引用），这里**必须跟着更新本地设置**，
          // 否则界面还指着那个已被删的文件（缩略图上仍是选中态、背景 404）。
          if (payload?.settings !== undefined) {
            state.settings = payload.settings
            applySettings()
          }
          state.lastError = null
          setNotice(t('bgRemoved'))
        } catch (error) {
          state.lastError = String(error?.message ?? error)
          console.warn('[zhuang-fangyi] 背景删除失败：', state.lastError)
        }
        emit()
      }

      /* ---------------- C12：设置导入 / 导出 ---------------- */

      /** 导入文件大小上限，与宿主 `readBody` 的 64 KB 保持一致。 */
      const IMPORT_MAX_BYTES = 64 * 1024

      /**
       * 导出当前设置为 JSON 文件。
       *
       * 带 `_meta` 便于用户辨认文件来源，也便于导入时判断版本 —— 导入侧
       * **忽略 `_meta`**（它不是设置字段，`normalizeSettings` 的白名单会丢弃）。
       */
      function exportSettings () {
        const payload = {
          _meta: {
            plugin: 'dsh-zhuang-fangyi',
            version: state.settings?.version ?? null,
            exportedAt: new Date().toISOString()
          },
          settings: state.settings
        }
        const text = `${JSON.stringify(payload, null, 2)}\n`
        try {
          const blob = new Blob([text], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'dsh-zhuang-fangyi-settings.json'
          document.body.appendChild(a)
          a.click()
          a.remove()
          // 必须回收：不 revoke 的话这个 Blob 会一直占着内存（大对象尤甚）
          setTimeout(() => { try { URL.revokeObjectURL(url) } catch { /* 已回收 */ } }, 0)
        } catch (error) {
          state.lastError = String(error?.message ?? error)
          console.warn('[zhuang-fangyi] 导出失败：', state.lastError)
        }
        emit()
      }

      /**
       * 导入设置文件。
       *
       * 安全边界有两层，**都复用既有设施**：
       *   ① 客户端先挡大小（`file.size`），宿主 `readBody` 还有一道 64 KB；
       *   ② 真正的内容校验交给宿主 `normalizeSettings`（白名单 + 夹取）——
       *      未知键被丢弃、越界值被夹回、非法值回落默认。所以「导入恶意 JSON」
       *      在结构上就不可能写进坏值。
       *
       * 因此这里**不需要**自己再写一遍字段校验（写两遍必然漂移）。
       */
      async function importSettings (file) {
        if (file === null || file === undefined) return
        if (typeof file.size === 'number' && file.size > IMPORT_MAX_BYTES) {
          state.lastError = t('importTooBig')
          emit()
          return
        }
        let text
        try {
          text = await file.text()
        } catch (error) {
          state.lastError = String(error?.message ?? error)
          emit()
          return
        }
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          state.lastError = t('importBadJson')
          emit()
          return
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          state.lastError = t('importNotObject')
          emit()
          return
        }
        // 两种形态都收：`{_meta, settings}`（我们导出的）与裸设置对象（手写的）
        const incoming = parsed.settings ?? parsed
        if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
          state.lastError = t('importNotObject')
          emit()
          return
        }
        // 版本比当前新 → 提示但仍导入（前向兼容：未知键由白名单丢弃）
        const incomingVersion = typeof parsed._meta?.version === 'number'
          ? parsed._meta.version
          : (typeof incoming.version === 'number' ? incoming.version : null)
        const newer = incomingVersion !== null && incomingVersion > (state.settings?.version ?? 0)
        const prevAccent = state.settings?.accentHue
        try {
          const payload = await api('/settings', {
            method: 'POST',
            body: JSON.stringify({ settings: incoming })
          })
          if (payload?.settings !== undefined) state.settings = payload.settings
          // 成功 → **中性提示**（不是错误）。`lastError` 必须清掉，否则上一轮的
          // 失败信息会挂在这一轮的成功结果旁边。
          state.lastError = null
          if (newer) {
            // 来自更新版本：提示但已导入（未知键由宿主白名单丢弃）
            setNotice(t('importNewer'), 4000)
          } else if (payload?.settings !== undefined &&
                     incoming.preset === undefined && incoming.background === undefined) {
            // 一个可识别的键都没有 → 宿主返回默认值，明确告知而不是静默
            setNotice(t('importAllDefault'), 4000)
          } else {
            setNotice(t('importDone'))
          }
        } catch (error) {
          state.lastError = String(error?.message ?? error)
          console.warn('[zhuang-fangyi] 导入失败：', state.lastError)
          emit()
          return
        }
        // 强调色可能变了 → 主题 token 表整体变，必须重取重注册（与 save 同一个坑）
        if (state.settings?.accentHue !== prevAccent) await reloadThemes()
        applySettings()
        emit()
      }

      /**
       * 重新从宿主拉取主题定义与 token 表，并**重注册**。
       *
       * 只在 token 表会变的设置项（目前是 `accentHue`）变化时调用 ——
       * 全量重注册会让外壳重新应用主题，能省则省。
       */
      async function reloadThemes () {
        try {
          const payload = await api('/themes')
          unregisterThemes()
          state.themes = payload.themes ?? []
          state.overrides = payload.overrides ?? {}
          state.themeRoles = payload.roles ?? {}
          state.presetStyles = payload.presetStyles ?? {}
          state.presetCombos = payload.presetCombos ?? {}
          state.customBackgrounds = payload.customBackgrounds ?? []
          state.customBgLimits = payload.customBackgroundLimits ?? null
          state.wallpaperMeta = payload.wallpaperMeta ?? {}
          registerThemes()
          applySettings()
        } catch (error) {
          state.lastError = String(error?.message ?? error)
          console.warn('[zhuang-fangyi] 重取主题失败：', state.lastError)
        }
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
      //
      // C13：**明暗切换也是「换预设」**（分档启用时）—— 所以这里不能只
      // `syncSchemeWallpaper`，必须走完整的 `applySettings()`：
      // 配色 token 层、材质深度、代码高亮、壁纸推荐标记全都要跟着换。
      // 只调 wallpaper 会出现「壁纸变了但配色没变」的半生效状态。
      //
      // 重入保护：`applySettings` 里可能调 `theme.setTheme()`，而外壳的
      // setTheme 会再 emit 一次 `theme/change` → 无限递归。用 `applying`
      // 闸门挡住（只跳过**嵌套**调用，正常的一次切换照常生效）。
      ctx.effect(() => ctx.on('theme/change', () => {
        // `applySettings` 自带重入闸门（见其定义），这里不需要再包一层 ——
        // 直接调即可，嵌套的那次会被闸门挡掉。
        if (hasSchemePresets(state.settings)) applySettings()
        else syncSchemeWallpaper(state.settings, state.themeRoles, theme, state.wallpaperMeta)
      }), 'zhuang-fangyi: theme sync')

      /* ---------------- C15：壁纸轮播 / 随机 ---------------- */

      /**
       * 轮播间隔档位 → 毫秒（与 `src/settings.js` 的 `ROTATE_MS` 同值）。
       *
       * 客户端不能 import src/，所以这里是本地副本；两侧都有断言盯着。
       */
      const ROTATE_MS = { '60s': 60000, '5m': 300000, '30m': 1800000 }

      /** 可轮播的壁纸（排除 `none`）—— 未启用自定义列表时的全量池。 */
      const ROTATE_POOL = BACKGROUNDS.filter(b => b !== 'none')

      /**
       * 当前设置下的轮播池（v8）。
       *
       * `rotateActive` 指向某个自定义列表 → 用它的成员（逐个核对仍在内置
       * 清单里）；否则全量池。与 `src/settings.js` 的 `rotatePoolOf` 同规则 ——
       * 客户端不能 import src/，这里是本地副本（测试核对两侧一致）。
       */
      function rotatePoolOf (s) {
        if (s === null || s === undefined || typeof s.rotateActive !== 'string') return ROTATE_POOL
        const list = (Array.isArray(s.rotateLists) ? s.rotateLists : [])
          .find(l => l.id === s.rotateActive)
        if (!list) return ROTATE_POOL
        const pool = (Array.isArray(list.ids) ? list.ids : [])
          .filter(id => BACKGROUNDS.includes(id) && id !== 'none')
        return pool.length >= 1 ? pool : ROTATE_POOL
      }

      /**
       * 挑下一张。
       *
       * `sequential` 按当前在池中的位置 +1；`random` 随机但**排除当前那张**——
       * 否则有 1/8 概率原地不动，看起来像「轮播坏了」。
       * `pool` 缺省用全量池；v8 起轮播走 `rotatePoolOf(settings)` 传列表池进来。
       */
      function nextWallpaper (current, order, pool = ROTATE_POOL) {
        const idx = pool.indexOf(current)
        if (order === 'random') {
          const candidates = pool.filter(b => b !== current)
          if (candidates.length === 0) return current
          return candidates[Math.floor(Math.random() * candidates.length)]
        }
        // 当前不在池里（比如是 `none`、自定义图、或不属于当前列表）→ 从第一张开始
        if (idx < 0) return pool[0]
        return pool[(idx + 1) % pool.length]
      }

      /**
       * 停掉轮播定时器（幂等）。
       *
       * 三处都要调：设置变化、页面不可见、插件卸载 —— 漏掉任何一处都会留下
       * 一个仍在写 DOM 的定时器。
       */
      function stopRotation () {
        if (state.rotateTimer !== null) {
          clearInterval(state.rotateTimer)
          state.rotateTimer = null
        }
      }

      /**
       * 按当前设置（重）启动轮播。
       *
       * 设计要点：
       *   · **不写盘** —— 轮换只是会话内的展示状态。写盘会有两个坏结果：
       *     每次重启都换一张（用户以为设置被改了），以及导出文件里混进一个
       *     随机值。所以只改内存里的 `state.settings.background` 并重新应用。
       *   · **复用 `applySettings`** —— 它内部走 `syncSchemeWallpaper`，
       *     交叉淡入（B6）与暗版分流（B9）都在那里。直接写 `--zf-art-src`
       *     会绕过这两个（都是修过的坑）。
       *   · 页面不可见时**跳过一轮**（不换图）——省电，也避免切回来时
       *     一次性闪好几张。
       */
      function syncRotation () {
        stopRotation()
        const s = state.settings
        if (s === null || s.enabled !== true) return
        if (s.background === 'none') return
        const ms = ROTATE_MS[s.backgroundRotate]
        if (ms === undefined) return
        state.rotateTimer = setInterval(() => {
          const cur = state.settings
          if (cur === null || cur.enabled !== true) return
          if (typeof document.hidden === 'boolean' && document.hidden) return
          // 每轮都重新取池子：列表在设置里被改掉后，下一个 tick 就该用新池
          const next = nextWallpaper(cur.background, cur.backgroundRotateOrder, rotatePoolOf(cur))
          if (next === cur.background) return
          state.settings = { ...cur, background: next }
          applySettings()
        }, ms)
      }

      // 设置一变就重排轮播（间隔/顺序/开关/壁纸都可能变）
      state.rotationSync = syncRotation

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
       * 设置页的**页签定义**（顺序即渲染顺序，一次只渲染一页）。
       *
       * ── 为什么从「7 个组」改成「5 个页签」（0.9.0）──────────────────────
       *
       * 7 组 24 行平铺在一页里约 1900px，而面板内容列只有约 720px ——
       * 要滚 2.5 屏。这不是分组分得不好，是**没有分层**。
       *
       * 改成顶部页签后每页 5–8 行，实测最坏的一页（外观，8 行 6 条说明）
       * 约 596px，全部一屏内。分组常量本身没白做：它从「排版装饰」升级成
       * 「页面骨架 + 行数预算」，0.6.0 立的「加了设置项忘了归组会失败」
       * 那条规矩原样保留，只是键从组换成了页。
       *
       * 字段：
       *   id     页签 id（也是测试里的键）
       *   label  DICT 键
       *   hint   页说明 DICT 键（页签栏下方那一行）
       *   max    页内行数上限 —— **超过就是这一页塞不下了一屏**，
       *         该拆页，不是该调 max
       *   keys   这一页负责的设置键。客户端不能 import src/，所以键的
       *         归属关系在这里是**第二份映射** —— 用测试双向钉死
       *         （见 tools/test-client.mjs「每个设置键都归属某一页」）。
       */
      const SETTINGS_TABS = [
        {
          id: 'look',
          label: 'tabLook',
          hint: 'tabLookHint',
          max: 8,
          keys: [
            'enabled', 'preset', 'scheme', 'presetLight', 'presetDark',
            'fontFamily', 'fontScale', 'contentWidth'
          ],
          cards: [
            { title: 'cardBasic', from: 0, to: 1 },
            { title: 'cardPreset', lead: 'cardPresetLead', from: 1, to: 3 },
            { title: 'cardScheme', from: 3, to: 5 },
            { title: 'cardType', from: 5, to: 8 }
          ]
        },
        {
          id: 'background',
          label: 'tabBackground',
          hint: 'tabBackgroundHint',
          // 0.9.0：轮播自定义列表加了 3 行（列表选择 / 改名 / 提示）。
          // 上限从 6 提到 9 —— 这条断言的意义是「别让某页塞不下一屏」，
          // 不是「永远 6 行」；改动时同步说明原因即可。
          max: 9,
          keys: [
            'background', 'backgroundOpacity', 'backgroundBlur', 'backgroundPosition',
            'backgroundRotate', 'backgroundRotateOrder', 'customBackground',
            'rotateLists', 'rotateActive'
          ],
          cards: [
            { title: 'cardWallpaper', from: 0, to: 1 },
            { title: 'cardAdjust', from: 1, to: 4 },
            { title: 'cardRotate', from: 4, to: 9 }
          ]
        },
        {
          id: 'details',
          label: 'tabDetails',
          hint: 'tabDetailsHint',
          max: 5,
          keys: ['accentHue', 'contourBorder', 'accentGlow', 'heroAvatar', 'titlebarFollow'],
          cards: [
            { title: 'cardAccent', from: 0, to: 1 },
            { title: 'cardDecor', from: 1, to: 5 }
          ]
        },
        {
          id: 'motion',
          label: 'tabMotion',
          hint: 'tabMotionHint',
          max: 2,
          keys: ['motion', 'splash'],
          cards: [{ title: 'cardMotion', from: 0, to: 2 }]
        },
        {
          id: 'skin',
          label: 'tabSkin',
          hint: 'tabSkinHint',
          max: 3,
          keys: ['rail', 'railWidth', 'avatarBubbles'],
          cards: [{ title: 'cardSkin', from: 0, to: 3 }]
        }
      ]

      /**
       * 有设置项**没有** UI 行的键，测试里必须显式列出并说明原因。
       *
       * 「每个设置键都归属某一页」这条断言要双向全等，光有 UI 的键不够 ——
       * 一个键如果哪页都不属于，它就永远不会出现在界面上，那才是真的漂移。
       * 把这两个例外写在这里（而不是偷偷放宽断言），例外本身也就被钉住了。
       *
       *   version       格式号，不是用户可调项
       *   potentialDots v2 遗留字段，早已没有 UI 与效果
       */
      const UNASSIGNED_KEYS = ['version', 'potentialDots']

      /**
       * 算出「把某页恢复成默认值」需要写入的补丁。
       *
       * ── 纯函数，且刻意返回 `null` 表示「无事可做」──────────────────────
       *
       * 抽成纯函数是为了可测：它是「哪一页拥有哪些键」与「哪些键真的被改过」
       * 这两件事的唯一交点，而这两件事在渲染代码里是分开的。
       *
       * 返回 `null` 而不是空对象，是为了让「本页已经是默认值」与「本页要改 3 个键」
       * 在调用点上可区分 —— 前者禁用按钮，后者照常写。
       *
       * ⚠️ 只比对**本页的键**：`background` 回退时可能正指向 `custom`，
       *   `customBackground` 记录与磁盘文件都保留（只是这一页不再引用它），
       *   重新选中即可 —— 不能顺手把用户的图删了。
       *
       * @param {string} tabId 页签 id
       * @param {object} settings 当前设置
       * @param {object|null} defaults 宿主下发的默认值（null = 未下发）
       * @returns {object|null} 补丁；无需改动时返回 null
       */
      function tabDefaultsPatch (tabId, settings, defaults) {
        if (defaults === null || defaults === undefined) return null
        const tab = SETTINGS_TABS.find(x => x.id === tabId)
        if (tab === undefined || settings === null || settings === undefined) return null
        const patch = {}
        for (const key of tab.keys) {
          if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue
          if (JSON.stringify(settings[key]) === JSON.stringify(defaults[key])) continue
          patch[key] = defaults[key]
        }
        return Object.keys(patch).length === 0 ? null : patch
      }

      /**
       * 把一页的平铺行按 `cards` 分组进卡片（0.9.3）。
       *
       * ── 为什么分组表是数据、不是 JSX ──────────────────────────────────
       *
       * 页签函数（`TabXxx`）返回**扁平的 `h(Row, …)` 数组**，测试按
       * `h(Row, ` 计数来守「每页一屏内」。如果把 Card 组件直接写进那些函数，
       * 行数统计就与渲染结构耦合了 —— 加一层卡片要同时改统计逻辑。
       * 分组表（`SETTINGS_TABS[].cards`）只引用**行下标**，两边互不干扰。
       *
       * ── 下标越界怎么办 ────────────────────────────────────────────────
       *
       * `from`/`to` 越界时**不静默丢行** —— 丢行意味着某个设置项在界面上
       * 凭空消失，用户再也找不到。这里把越界部分**原样追加**到最后一组，
       * 保证「渲染出来的行数 === 页签函数返回的行数」。测试另有一条
       * 「卡片分组覆盖所有行」盯着分组表本身。
       *
       * @param {object} tab `SETTINGS_TABS` 的一项
       * @param {Array} rows 该页的行（`h(Row, …)`）
       * @returns {Array} 卡片节点
       */
      function renderCards (tab, rows) {
        const cards = Array.isArray(tab.cards) ? tab.cards : []
        if (cards.length === 0) return rows
        const out = []
        const covered = new Set()
        for (const c of cards) {
          const slice = rows.slice(c.from, c.to)
          for (let i = c.from; i < c.to && i < rows.length; i++) covered.add(i)
          if (slice.length === 0) continue
          out.push(h(Card, {
            key: c.title,
            title: t(c.title),
            lead: c.lead === undefined ? undefined : t(c.lead)
          }, slice))
        }
        // 没被任何卡片覆盖到的行（分组表漏配或越界）→ 追加进最后一张卡，
        // 绝不丢弃。
        const leftover = rows.filter((_, i) => !covered.has(i))
        if (leftover.length > 0) {
          if (out.length > 0) {
            const last = out[out.length - 1]
            out[out.length - 1] = h(Card, {
              key: last.props.title,
              title: last.props.title,
              lead: last.props.lead
            }, [...(last.props.children ?? []), ...leftover])
          } else {
            out.push(h(Card, { key: 'cardRest', title: t('cardRest') }, leftover))
          }
        }
        return out
      }

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
      /**
       * 页签栏：吸顶在内容列顶部。
       *
       * 背景必须给 —— 内容列本身是 `overflow-y:auto` 的滚动容器，吸顶元素
       * 不铺底色的话，下面的行会从页签**之间**透出来。
       * `--dsw-alias-bg-layer-2` 正是外壳设置面板 `.panel` 的底色
       * （`SettingsRoot.module.css`），所以这里的颜色与面板天然一致，
       * 换主题也不用另外维护一份。
       */
      const tabBarStyle = {
        position: 'sticky', top: 0, zIndex: 1,
        display: 'flex', alignItems: 'center', gap: 12,
        paddingBottom: 8,
        background: 'var(--dsw-alias-bg-layer-2)'
      }
      /** 页说明：页签栏正下方那一行，随当前页切换。 */
      const tabHintStyle = {
        fontSize: 12, lineHeight: '18px', marginTop: 6, marginBottom: 2,
        color: 'var(--dsw-alias-label-tertiary)'
      }
      /** 壁纸展开面板的 DOM id（「更换图片」按钮的 `aria-controls` 指向它）。 */
      const ART_PANEL_ID = 'zf-art-picker'
      /** 壁纸预览缩略（收起态）。全尺寸图在 96×60 下不糊，所以不是 thumbs。 */
      const artPreviewStyle = {
        width: 96, height: 60, flex: '0 0 auto', boxSizing: 'border-box',
        borderRadius: 7, overflow: 'hidden', position: 'relative',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }
      /** 壁纸网格的展开面板 —— 背景页里唯一的滚动容器。 */
      const artPanelStyle = {
        display: 'flex', flexDirection: 'column', gap: 8,
        margin: '8px 0', padding: 10, boxSizing: 'border-box',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-1)'
      }
      const artGroupTitleStyle = {
        fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)'
      }
      /**
       * 自适应列数：容器窄时自动降列，不必写死 4 列。
       *
       * `gridAutoRows:'max-content'` 是**预防性**的：现在这个网格没有限高
       * （靠外层 `artPanelStyle` 撑开、由面板滚动），所以行不会被压。但
       * 观测栏那个同类网格正是因为只有 `max-height` 而**行被压成 13px、
       * 格子互相重叠 35px**（用户截图里的「细横条」）。一旦哪天给这里加
       * 限高，没有这一行就会立刻踩同一个坑 —— 提前钉住。
       */
      const artGridStyle = {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 8,
        gridAutoRows: 'max-content'
      }
      /** 网格里的一格。比例与观测栏一致（8/5），`object-fit:cover` 裁齐。 */
      const artTileStyle = {
        position: 'relative', padding: 0, width: '100%', boxSizing: 'border-box',
        aspectRatio: '8 / 5', borderRadius: 7, overflow: 'hidden', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)'
      }
      const artSearchStyle = {
        fontSize: 12, height: 30, padding: '0 10px', width: '100%', boxSizing: 'border-box',
        borderRadius: 8, color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l2)'
      }
      const labelStyle = { fontSize: 13, color: 'var(--dsw-alias-label-primary)', minWidth: 0 }
      const hintStyle = {
        fontSize: 12, marginTop: 2, color: 'var(--dsw-alias-label-tertiary)',
        minWidth: 0, overflowWrap: 'anywhere'
      }
      /** 控件组里的一格（标签在上、控件在下）—— 用于并排多个下拉时各自带名。 */
      const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }
      const fieldLabelStyle = { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }

      /**
       * 按钮样式（0.9.3：改为**类名**，尺寸与配色落在宿主 CSS 里）。
       *
       * 保留函数与签名（测试与调用点都依赖 `buttonStyle(primary, variant)`），
       * 但返回值从行内样式对象换成 `className` —— 行内样式表达不了 `:hover`
       * / `:disabled`，而这两个态在设置页里很常见（「恢复本页」禁用态、
       * 「删除列表」两段式确认）。四档：
       *
       *   `primary`          主要动作（保存/应用）
       *   `variant:'quiet'`  弱化为文字按钮（危险动作的**未确认**态）
       *   `variant:'danger'` 危险（确认删除 / 恢复默认的**已确认**态）
       *   （无参）            中性次要动作
       */
      function buttonStyle (primary, variant) {
        const cls = variant === 'quiet'
          ? 'zf-set-btn zf-set-btn--quiet'
          : variant === 'danger'
            ? 'zf-set-btn zf-set-btn--danger'
            : primary === true
              ? 'zf-set-btn zf-set-btn--primary'
              : 'zf-set-btn'
        return { className: cls }
      }

      /** 底部动作区：危险在左、主要在最右，中间留白把它们分开。 */
      const footerStyle = {
        display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap',
        alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 14, borderTop: '1px solid var(--dsw-alias-border-l2)'
      }

      /**
       * 一行设置（0.9.3 改版：对齐桌宠插件的行结构）。
       *
       * 结构固定为「左列：标题 14px + 说明 12px / 右列：定宽 208px 控件列」。
       *
       * ⚠️ 说明文字（`hint`）**必须落在左列**，不许再挂到控件下面。
       * 改版前说明的三种位置并存 —— 开关的在控件下方通栏、下拉的挤在标签与
       * 控件之间、独立 note 又满行一段 —— 同一屏里说明文字跳三个位置，
       * 「这一行在说什么」得靠找。桌宠插件为此专门写过一条注释，是同一个教训。
       *
       * 控件列**定宽**（`flex:0 0 208px`）是「右边缘对齐」的前提：用 auto 时
       * 每个控件右边缘取决于自身宽度，一列扫下去是锯齿状。
       *
       * 样式全在宿主 `structureCss()` 的 `.zf-set-row*` 里（类名而非行内样式）：
       * 行内样式表达不了 `:hover` / `:focus-visible`，也没法让同一屏的
       * 下拉与输入框共用一套尺度。
       */
      function Row ({ label, hint, children }) {
        return h('div', { className: 'zf-set-row' },
          h('div', { className: 'zf-set-row__main' },
            h('div', { className: 'zf-set-row__label' }, label),
            hint !== undefined && hint !== null && hint !== ''
              ? h('div', { className: 'zf-set-row__desc' }, hint)
              : null
          ),
          h('div', { className: 'zf-set-row__control' }, children)
        )
      }

      /**
       * 一张可折叠卡片（0.9.3，对齐桌宠插件的 `Card`）。
       *
       * 一个概念一张卡：原先 27 行平铺，行与行之间只有一条发丝线，扫下来
       * 分不清哪几行属于同一件事。卡片给出边界，且**整张可折叠**。
       *
       * 折叠用原生 `<details>`：`open` 是声明式属性（不读 DOM）—— 外壳的
       * React 桩没有真实 DOM，读 `open` 会让测试与真机行为分叉（桌宠踩过）。
       * 非受控：用户手动展开后不该被下一次重渲染合上。
       */
      function Card ({ title, lead, open, children }) {
        const body = (Array.isArray(children) ? children : [children])
          .filter(c => c !== null && c !== undefined)
        return h('details', { className: 'zf-set-card', open: open === true },
          h('summary', { className: 'zf-set-card__sum' }, title),
          h('div', { className: 'zf-set-card__body' },
            lead !== undefined && lead !== null
              ? h('p', { className: 'zf-set-card__lead' }, lead)
              : null,
            ...body
          )
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

      /**
       * 分段选择器 / 页签栏。
       *
       * 设置页与观测栏**共用这一个**（原先观测栏自己手写了一份：同样的配色、
       * 边框、选中态，只是尺寸小一点 —— 两份实现必然漂移，正是「同一设置两处
       * 风格不一致」的来源）。
       *
       * ── `role: 'tablist'` 是唯一的新增能力（0.9.0）──────────────────────
       *
       * 传了 `role` 才切到页签语义（`role="tab"` / `aria-selected` /
       * `aria-controls` / roving tabindex / 方向键）；**不传时行为与 0.8.0
       * 一模一样**，观测栏那两处调用不受影响。
       *
       * 为什么不给页签另写一个组件：段选器与页签的视觉形态本来就是同一个东西，
       * 两份实现必然漂移 —— 这正是本文件开头那条「观测栏自己手写了一份」的教训。
       *
       * @param {boolean} [compact] 观测栏用：更小的字号与内边距
       * @param {boolean} [grow]    等宽铺满容器（观测栏的窄栏里更好看）
       * @param {string}  [role]    `'tablist'` = 页签语义（0.9.0）
       * @param {string}  [idPrefix] 页签模式下 id 的前缀。约定：
       *        按钮 `id = <prefix>-tab-<value>`、`aria-controls = <prefix>-panel-<value>`。
       *        用**一套约定**而不是让调用方分别传两个函数，是为了避免两者
       *        拼错 —— 拼错的表现只是 `aria-controls` 指到一个不存在的元素，
       *        界面上完全看不出来。
       */
      function Segmented ({
        value, options, onChange, compact, grow, role, idPrefix
      }) {
        const pad = compact ? '4px 6px' : '5px 10px'
        const isTabs = role === 'tablist'
        // 页签用 roving tabindex：整条栏在 Tab 序列里只占一格，方向键在页签间移动。
        // 这是 WAI-ARIA 的标准做法 —— 否则 5 个页签会把 Tab 键卡住 5 次。
        const onKeyDown = event => {
          if (!isTabs) return
          const index = options.findIndex(o => o.value === value)
          if (index < 0) return
          let next = index
          if (event.key === 'ArrowRight') next = (index + 1) % options.length
          else if (event.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = options.length - 1
          else return
          event.preventDefault()
          onChange(options[next].value)
        }
        return h('div', {
          role: isTabs ? 'tablist' : undefined,
          onKeyDown: isTabs ? onKeyDown : undefined,
          className: isTabs ? 'zf-set-tabs' : undefined,
          style: isTabs
            ? undefined
            : {
                display: grow === true ? 'flex' : 'inline-flex',
                border: '1px solid var(--dsw-alias-border-l2)',
                borderRadius: compact ? 7 : 8,
                overflow: 'hidden',
                width: grow === true ? '100%' : undefined
              }
        }, options.map(opt => {
          const selected = value === opt.value
          // 页签模式走 `.zf-set-tab`（pill 形 34px，选中态用外壳的
          // `interactive-bg-active`）—— 与桌宠插件的页签完全一致。
          // 段选模式保持原来的「连体按钮」外观：观测栏那两处在用，
          // 行为与 0.8.0 一模一样（有断言守着）。
          if (isTabs) {
            return h('button', {
              key: opt.value,
              type: 'button',
              role: 'tab',
              id: idPrefix !== undefined ? `${idPrefix}-tab-${opt.value}` : undefined,
              'aria-selected': selected ? 'true' : 'false',
              'aria-controls': idPrefix !== undefined ? `${idPrefix}-panel-${opt.value}` : undefined,
              tabIndex: selected ? 0 : -1,
              onClick: () => onChange(opt.value),
              className: 'zf-set-tab'
            }, opt.label)
          }
          return h('button', {
            key: opt.value,
            type: 'button',
            onClick: () => onChange(opt.value),
            style: {
              border: 'none', cursor: 'pointer', fontSize: compact ? 11 : 12, padding: pad,
              flex: grow === true ? '1 1 0' : undefined,
              minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              background: selected ? 'var(--dsw-alias-brand-primary)' : 'transparent',
              color: selected ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-label-secondary)'
            }
          }, opt.label)
        }))
      }

      function Select ({ value, options, onChange }) {
        // 尺寸/边框/底色全部交给宿主 CSS 的 `.zf-set-row__control select`
        // —— 与文本输入框共用一套规则，避免「同一屏两套高度」。
        return h('select', {
          value,
          onChange: event => onChange(event.target.value)
        }, options.map(opt => h('option', { key: opt.value, value: opt.value }, opt.label)))
      }

      /**
       * 滑杆。
       *
       * ── 为什么不能只用受控 `value` + `onChange`（用户反馈「拖动时抖动」）──
       *
       * 原先写的是 `value` + `onChange`，而 `onChange` 走 `save()` → `POST` →
       * `emit()` 全量重渲染。问题在于 **`save()` 是异步的**（要等 fetch 往返），
       * 于是「手指已经拖到下一格、但回写的还是上一格」——受控值被拖回原位，
       * 下一帧又被拖过去，视觉上就是抖动。
       *
       * 修法：**拖动期间只更新本地 state**（`onInput` 即时反映，不等网络），
       * 松手/失焦时才提交（`onChange`/`onPointerUp`/`onKeyUp`）。
       * 这样受控值始终跟着手指走，且不会每个像素都打一次网络。
       */
      function Slider ({ value, min, max, step, suffix, onChange }) {
        const [local, setLocal] = useState(value)
        // 外部值变化（如「恢复默认」）时要跟上；拖动中不会被外部覆盖，
        // 因为此时 local 已是最新且外部 value 会跟着它走。
        useEffect(() => { setLocal(value) }, [value])
        const shown = typeof local === 'number' ? local : value
        const commit = v => { if (v !== value) onChange(v) }
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%' } },
          h('input', {
            type: 'range', min, max, step,
            value: shown,
            // 拖动中：只改本地，不发网络
            onInput: event => setLocal(Number(event.target.value)),
            // 松手 / 键盘调整 / 失焦：提交
            onChange: event => commit(Number(event.target.value)),
            onPointerUp: event => commit(Number(event.target.value)),
            onBlur: event => commit(Number(event.target.value))
          }),
          // 数值走 `.zf-set-row__value`：等宽 + 定宽右对齐，
          // 数字变化时滑杆不会左右抖（原先内联了同一套，现在只有一处定义）。
          h('span', { className: 'zf-set-row__value' }, `${shown}${suffix}`)
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

      /**
       * 五个页签的**行**，各自一个组件。
       *
       * ── 为什么不写在 `Section` 的 return 里 ──────────────────────────────
       *
       * 写成 `return h('div', …, rowA, rowB, rowC)` 时，为了「一次只渲染一页」
       * 就得把五页的行都塞进数组里，行缩进整体深两级，几百行 diff 全是空白。
       * 拆成组件后**每行的缩进与 0.8.0 完全一致**，diff 里只看得出真实的改动。
       *
       * 另一个好处是**每页的行数变得可测**：测试按 `function TabXxx (ctx)`
       * 切块数 `h(Row, `，与 `SETTINGS_TABS[].max` 对照 —— 「这一页塞不下
       * 一屏」会直接失败，而不是等用户发现要滚。
       *
       * 所有依赖都走**一个 `ctx` 参数**，而不是各写各的闭包 —— 页签之间
       * 需要的输入完全相同，逐个签名只会各自漂移。
       *
       * @param {object} ctx `{ settings, set, presetOptions, applyCombo, … }`
       * @returns {Array} 若干个 `h(Row, …)`
       */

      /** 「外观」页：原「总览」「明暗」「排版」三组合并（8 行）。 */
      /**
       * 轮播自定义列表的状态 API（0.12.0 从 `TabBackground` 抽出）。
       *
       * 抽出理由：它占 `TabBackground` 的 82 行且**与渲染无关** ——
       * 原函数 399 行里 238 行是状态与构建逻辑，只有 151 行是渲染。
       * 放在这里（第一个页签之前）而不是页签之间：测试按
       * `function TabXxx (ctx)` 切块数 `h(Row, `，插在页签之间会被
       * 算进前一个页签的块里。
       *
       * `state` / `emit` / `t` 走闭包（它们是 `apply()` 作用域的），
       * 只有随每次渲染变化的 `settings` / `set` 作为参数传入。
       */
      function makeRotateListApi ({ settings, set }) {
        /* ── v8：轮播自定义列表 ────────────────────────────────────────────
         *
         * 列表编辑是**面板局部 UI 状态**，放共享 `state` 而不是组件内 `useState`：
         * 保存会触发全量重渲染，`useState` 会归零（与 `confirmReset` /
         * `activeTab` 同一个原因 —— 见上方那段注释）。
         *
         * 编辑态复用上方那片壁纸缩略图：点一下加入/移出列表，**不改当前壁纸**。
         * 这样不必再做一套独立的选图界面，用户面对的始终是同一个网格。
         */
        const rotateListsOf = () => (Array.isArray(settings.rotateLists) ? settings.rotateLists : [])
        const rotateEditingOf = () =>
          (typeof state.rotateEditing === 'string' ? state.rotateEditing : null)

        const setRotateEditing = id => {
          state.rotateEditing = id
          state.rotateDraftName = id === null
            ? ''
            : (rotateListsOf().find(l => l.id === id)?.name ?? '')
          emit()
        }
        const setRotateDraftName = v => { state.rotateDraftName = v; emit() }

        /** 两段式删除确认：3s 后自动复原（与「恢复默认」同一套交互）。 */
        const setRotateDeleteArm = next => {
          state.rotateDeleteArm = next
          if (state.rotateDeleteTimer !== null) clearTimeout(state.rotateDeleteTimer)
          state.rotateDeleteTimer = null
          if (next) {
            state.rotateDeleteTimer = setTimeout(() => {
              state.rotateDeleteArm = false
              state.rotateDeleteTimer = null
              emit()
            }, 3000)
          }
          emit()
        }

        /** 新建列表：自动命名并立刻进入编辑态（空列表按全部内置轮播，不会坏）。 */
        const createRotateList = () => {
          const lists = rotateListsOf()
          if (lists.length >= ROTATE_LISTS_MAX) return
          const id = 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
          const name = `${t('rotateListDefaultName')} ${lists.length + 1}`
          set({ rotateLists: [...lists, { id, name, ids: [] }], rotateActive: id })
          setRotateEditing(id)
        }

        /** 删除当前激活列表（两段式确认通过后才会走到这里）。 */
        const deleteRotateList = () => {
          const id = settings.rotateActive
          if (typeof id !== 'string') return
          setRotateDeleteArm(false)
          setRotateEditing(null)
          set({ rotateLists: rotateListsOf().filter(l => l.id !== id), rotateActive: null })
        }

        /** 重命名当前激活列表（空名不提交 —— 归一化层也会丢，但别让用户白点）。 */
        const renameRotateList = () => {
          const id = settings.rotateActive
          const name = String(state.rotateDraftName ?? '').trim().slice(0, 24)
          if (typeof id !== 'string' || name.length === 0) return
          set({ rotateLists: rotateListsOf().map(l => (l.id === id ? { ...l, name } : l)) })
        }

        /** 编辑态点缩略图：加入 / 移出列表（**不动** `settings.background`）。 */
        const toggleRotateMember = (listId, wallpaperId) => {
          set({
            rotateLists: rotateListsOf().map(l => (l.id === listId
              ? {
                  ...l,
                  ids: l.ids.includes(wallpaperId)
                    ? l.ids.filter(x => x !== wallpaperId)
                    : [...l.ids, wallpaperId]
                }
              : l))
          })
        }

        const editingList = rotateEditingOf()
        /** 编辑态下某张内置图是否已是列表成员。 */
        const isMember = id =>
          editingList !== null && (rotateListsOf().find(l => l.id === editingList)?.ids ?? []).includes(id)
        return {
          rotateListsOf, rotateEditingOf, setRotateEditing, setRotateDraftName,
          setRotateDeleteArm, createRotateList, deleteRotateList, renameRotateList,
          toggleRotateMember, editingList, isMember
        }
      }

      /**
       * 壁纸选择器的格子与分组构建（0.12.0 从 `TabBackground` 抽出）。
       *
       * 抽出理由同上：156 行、**0 处 `h(Row, `** —— 它是「怎么画格子」，
       * 不是「这一页有哪些设置行」。抽出后 `TabBackground` 只剩 9 行设置
       * 与它们的分组，职责单一。
       *
       * `rotate` 是上面那个工厂的返回值（编辑态点格子要切换成员，而不是换壁纸）。
       */
      function makeArtPicker ({ settings, set, customList, uploading, needle, matches, recommendedOf, rotate }) {
        const { isMember, editingList, toggleRotateMember } = rotate
        /** 当前壁纸：收起态那一格预览。 */
        const current = (() => {
          if (settings.background === CUSTOM_BACKGROUND) {
            const file = settings.customBackground?.file
            return {
              label: t('bgCustom'),
              src: typeof file === 'string'
                ? `${ROUTE}/backgrounds/${encodeURIComponent(file)}` : null
            }
          }
          if (settings.background === 'none') return { label: t('bgNone'), src: null }
          return {
            label: bgLabel(settings.background),
            src: `${ROUTE}/art/wallpaper-${settings.background}.webp`
          }
        })()

        /** 网格里的一格内置壁纸。编辑轮播列表时它变成「成员开关」。 */
        const tile = id => {
          const member = isMember(id)
          const pressed = editingList === null && settings.background === id
          const recommended = recommendedOf(id)
          const label = bgLabel(id)
          // 编辑态：点击只切换成员，不换壁纸；边框显示成员身份（与「当前壁纸」区分开，
          // 否则用户会以为自己在切壁纸）。
          const onClick = editingList !== null
            ? () => toggleRotateMember(editingList, id)
            : () => set({ background: id })
          const border = editingList !== null
            ? (member ? '2px solid var(--dsw-alias-brand-primary)' : artTileStyle.border)
            : (pressed ? '2px solid var(--dsw-alias-brand-primary)' : artTileStyle.border)
          return h('button', {
            key: id, type: 'button',
            className: recommended && editingList === null ? 'zf-art-recommended' : undefined,
            'data-zf-recommended': recommended && editingList === null ? 'true' : undefined,
            'data-zf-member': editingList !== null ? (member ? 'true' : 'false') : undefined,
            title: editingList !== null
              ? `${member ? '−' : '+'} ${label}`
              : (recommended ? `${label}${t('presetRecommend')}` : label),
            'aria-label': editingList !== null
              ? `${member ? '−' : '+'} ${label}`
              : (recommended ? `${label}${t('presetRecommend')}` : label),
            'aria-pressed': pressed ? 'true' : 'false',
            onClick,
            style: {
              ...artTileStyle,
              border,
              opacity: editingList !== null && !member ? 0.55 : 1
            }
          }, h('img', {
            src: `${ROUTE}/art/thumbs/wallpaper-${id}.webp`,
            alt: label,
            loading: 'lazy',
            style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
          }))
        }

        /** 一个分组标题 + 一片格子。空组不渲染（免得出现只有标题的空行）。 */
        const group = (key, title, tiles) => tiles.length === 0
          ? null
          : h('div', { key, style: { width: '100%' } },
              h('div', { style: artGroupTitleStyle }, title),
              h('div', { style: artGridStyle }, ...tiles))

        const bgGroups = BG_GROUPS.map(g => group(
          g.id,
          bgLang() === 'zh' ? g.zh : g.en,
          BACKGROUNDS.filter(b => BG_GROUP_OF[b] === g.id && matches(bgLabel(b))).map(tile)
        ))
        const mineTiles = customList
          .filter(entry => matches(t('bgCustom')))
          .map(entry => {
            const pressed = settings.background === CUSTOM_BACKGROUND &&
              settings.customBackground?.file === entry.file
            return h('div', { key: entry.file, style: { position: 'relative' } },
              h('button', {
                type: 'button',
                title: t('bgCustom'),
                'aria-label': t('bgCustom'),
                'aria-pressed': pressed ? 'true' : 'false',
                onClick: () => set({ background: CUSTOM_BACKGROUND, customBackground: entry }),
                style: {
                  ...artTileStyle,
                  border: pressed
                    ? '2px solid var(--dsw-alias-brand-primary)'
                    : artTileStyle.border
                }
              }, h('img', {
                src: `${ROUTE}/backgrounds/${encodeURIComponent(entry.file)}`,
                alt: t('bgCustom'),
                loading: 'lazy',
                style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
              })),
              // 删除角标：压在格子右上角（原先缩略图只有 64×40，角标会盖住画面）
              h('button', {
                type: 'button',
                title: t('bgCustomRemove'),
                'aria-label': t('bgCustomRemove'),
                onClick: event => {
                  event.stopPropagation()
                  void ctx.removeBackground(entry.file)
                },
                style: {
                  position: 'absolute', top: 2, right: 2, width: 18, height: 18,
                  lineHeight: '16px', padding: 0, fontSize: 12, cursor: 'pointer',
                  borderRadius: 9, border: 'none',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: 'var(--dsw-alias-label-secondary)'
                }
              }, '×'))
          })
        // 上传格恒在（哪怕「我的图片」是空的），否则没上传过时用户找不到入口
        const uploadTile = h('label', {
          key: '__upload__',
          title: uploading ? t('bgUploading') : t('bgUpload'),
          style: {
            ...artTileStyle,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: uploading ? 'progress' : 'pointer',
            border: '1px dashed var(--dsw-alias-border-l3)',
            fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', textAlign: 'center'
          }
        },
        uploading ? t('bgUploading') : `＋ ${t('bgUpload')}`,
        h('input', {
          type: 'file',
          accept: 'image/png,image/jpeg,image/gif,image/webp',
          disabled: uploading,
          style: { display: 'none' },
          onChange: event => {
            const file = event.target.files?.[0] ?? null
            void ctx.uploadBackground(file)
            // 清空 input：否则连续传同一个文件不会再触发 change
            event.target.value = ''
          }
        }))
        // 「无」独立成格排在最前 —— 它是「关掉壁纸」而不是某张图，
        // 不该混在「纹理与极简」组里当一张（0.8.0 就是这么放的，是语义错误）。
        // 它也**不参与搜索过滤**：搜索壁纸时找不到「关闭壁纸」毫无意义。
        const noneTile = h('button', {
          key: 'none', type: 'button',
          title: t('bgNone'), 'aria-label': t('bgNone'),
          'aria-pressed': settings.background === 'none' ? 'true' : 'false',
          onClick: () => set({ background: 'none' }),
          style: {
            ...artTileStyle,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: 'var(--dsw-alias-label-tertiary)',
            border: settings.background === 'none'
              ? '2px solid var(--dsw-alias-brand-primary)'
              : artTileStyle.border
          }
        }, t('bgNone'))

        const visible = bgGroups.filter(x => x !== null)
        const noMatch = needle !== '' && visible.length === 0 && mineTiles.length === 0
        return { current, tile, group, bgGroups, mineTiles, uploadTile, noneTile, visible, noMatch }
      }

      function TabLook (ctx) {
        const { settings, set, presetOptions, applyCombo } = ctx
        return [
          h(Row, { label: t('enabled'), hint: t('enabledHint') },
            h(Toggle, { value: settings.enabled, onChange: v => set({ enabled: v }) })),
          h(Row, { label: t('preset') },
            h(Select, {
              value: settings.preset,
              // 文案带上风格名（「本体黄绿 · 明亮轻盈」）——
              // 预设是**整套风格**而不只是配色，光看色名体现不出来。
              // style 缺失时不留下孤立的 ' · '（宿主未升级/字段缺失时也要好看）。
              options: PRESETS.map(p => {
                const style = state.presetStyles?.[p]?.style
                return {
                  value: p,
                  label: style ? `${PRESET_LABELS[p].zh} · ${style}` : PRESET_LABELS[p].zh
                }
              }),
              onChange: v => set({ preset: v })
            })),
          // C14：一键推荐组合。放在预设行**紧下面** —— 它是「这套预设该怎么配」
          // 的动作，离预设越近越好找。
          //
          // 不自动触发（与「推荐壁纸只提示、不自动切换」同一原则）：套用会改动
          // 壁纸与排版，必须是用户显式点击。
          h(Row, { label: t('applyCombo'), hint: t('applyComboHint') },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' } },
              h('button', {
                type: 'button',
                onClick: () => applyCombo(settings.preset),
                className: buttonStyle(false).className
              }, t('applyCombo')))),
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
          // C13：明暗分档预设。默认两格都是「跟随主预设」——
          // 不选就不分叉，老用户升级后行为完全不变。
          //
          // 两格各自带标签：并排两个下拉若都不标，看不出哪个管浅色。
          // （原先就是这个问题：`presetLight` / `presetDark` 两个 DICT 键
          // 定义了却从未渲染 —— 有断言盯着这一点。）
          h(Row, { label: t('schemePresets'), hint: t('schemePresetsHint') },
            h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' } },
              h('div', { style: fieldStyle },
                h('span', { style: fieldLabelStyle }, t('presetLight')),
                h(Select, {
                  value: settings.presetLight ?? FOLLOW,
                  options: presetOptions(),
                  onChange: v => set({ presetLight: v === FOLLOW ? null : v })
                })),
              h('div', { style: fieldStyle },
                h('span', { style: fieldLabelStyle }, t('presetDark')),
                h(Select, {
                  value: settings.presetDark ?? FOLLOW,
                  options: presetOptions(),
                  onChange: v => set({ presetDark: v === FOLLOW ? null : v })
                })))),
          h(Row, { label: t('fontFamily'), hint: t('fontFamilyHint') },
            h(Select, {
              value: settings.fontFamily ?? 'default',
              // 显示名走 t()（与其它设置项一致，由宿主 locale 决定语言）；
              // DICT 里没有该键时 t() 会原样返回键名，所以档位名直接写进 DICT
              options: FONT_FAMILIES.map(f => ({ value: f, label: t(`font_${f}`) })),
              onChange: v => set({ fontFamily: v })
            })),
          h(Row, { label: t('fontScale'), hint: t('fontScaleHint') },
            h(Segmented, {
              value: String(settings.fontScale ?? 1),
              options: FONT_SCALES.map(sc => ({
                value: String(sc),
                label: t(`fontScale_${String(sc).replace('.', '_')}`)
              })),
              onChange: v => set({ fontScale: Number(v) })
            })),
          h(Row, { label: t('contentWidth'), hint: t('contentWidthHint') },
            h(Segmented, {
              value: String(settings.contentWidth ?? 'auto'),
              options: CONTENT_WIDTH_MODES.map(m => ({ value: m, label: t(`contentWidth_${m}`) })),
              onChange: v => set({ contentWidth: v })
            }))
        ]
      }

      /** 「背景」页：壁纸与其调节（9 行 + 选择器展开区）。 */
      function TabBackground (ctx) {
        const { settings, set, customList, uploading } = ctx
        const pickerOpen = state.pickerOpen === true
        const needle = (state.pickerQuery ?? '').trim().toLowerCase()
        const matches = label => needle === '' || label.toLowerCase().includes(needle)
        const recommendedOf = id =>
          isRecommendedArt(state.presetStyles, presetForScheme(settings, currentScheme(theme)), id)

        // 状态与构建逻辑抽到两个工厂（0.12.0）：本函数从 399 行降到约 160 行，
        // 只负责「这一页有哪些设置行」。工厂定义在第一个页签之前 ——
        // 插在页签之间会被行数统计算进前一个页签。
        //
        // ⚠️ 从工厂返回值里**解构出用到的每一项**。第一版只拿了 `rotate` 对象，
        // 但下面的轮播列表行直接调 `rotateListsOf()` —— 于是运行时报
        // `ReferenceError`（`node --check` 查不出未定义标识符）。
        const rotate = makeRotateListApi({ settings, set })
        const {
          rotateListsOf, rotateEditingOf, setRotateEditing, setRotateDraftName,
          setRotateDeleteArm, createRotateList, deleteRotateList, renameRotateList
        } = rotate
        const { current, tile, group, bgGroups, mineTiles, uploadTile, noneTile, visible, noMatch } =
          makeArtPicker({ settings, set, customList, uploading, needle, matches, recommendedOf, rotate })

        return [
          h(Row, { label: t('background') },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' } },
              h('div', { style: artPreviewStyle },
                current.src === null
                  ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, current.label)
                  : h('img', {
                      src: current.src,
                      alt: current.label,
                      style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
                    })),
              h('span', {
                style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', minWidth: 0 }
              }, current.label),
              h('button', {
                type: 'button',
                'aria-expanded': pickerOpen ? 'true' : 'false',
                'aria-controls': ART_PANEL_ID,
                onClick: () => {
                  state.pickerOpen = !pickerOpen
                  emit()
                },
                className: buttonStyle(false).className
              }, t('bgChange')))),
          pickerOpen && h('div', { id: ART_PANEL_ID, style: artPanelStyle },
            // 图例放在展开区里：收起时那一行说明只是白占高度
            h('div', { style: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' } },
              t('wallpaperRecommend')),
            h('input', {
              type: 'search',
              value: state.pickerQuery ?? '',
              placeholder: t('bgSearch'),
              'aria-label': t('bgSearch'),
              onChange: event => {
                state.pickerQuery = event.target.value
                emit()
              },
              style: artSearchStyle
            }),
            noneTile,
            ...visible,
            group('mine', t('bgGroupMine'), [...mineTiles, uploadTile]),
            noMatch && h('div', {
              style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
            }, t('bgEmpty'))),
          h(Row, { label: t('opacity') },
            h(Slider, {
              // 上限同样与 BG_OPACITY_MAX 对齐（有测试断言）
              value: settings.backgroundOpacity, min: 0, max: 90, step: 1, suffix: '%',
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
          // C15：轮播。选「关闭」以外的档位才显示顺序选择 —— 关闭时它无意义。
          h(Row, { label: t('rotate'), hint: t('rotateHint') },
            h(Segmented, {
              value: settings.backgroundRotate ?? 'off',
              options: [
                { value: 'off', label: t('rotateOff') },
                { value: '60s', label: t('rotate60s') },
                { value: '5m', label: t('rotate5m') },
                { value: '30m', label: t('rotate30m') }
              ],
              onChange: v => set({ backgroundRotate: v })
            })),
          settings.backgroundRotate !== 'off' && h(Row, { label: t('rotateOrder') },
            h(Segmented, {
              value: settings.backgroundRotateOrder ?? 'sequential',
              options: [
                { value: 'sequential', label: t('rotateSequential') },
                { value: 'random', label: t('rotateRandom') }
              ],
              onChange: v => set({ backgroundRotateOrder: v })
            })),
          // ── v8：轮播自定义列表 ────────────────────────────────────────────
          //
          // 下拉选「全部内置」或某个列表；选「新建列表」当场建一个并进入编辑。
          // 编辑态下**上方的壁纸缩略图变成成员开关**（点一下加入/移出，不改当前壁纸），
          // 这样不用再做一套独立的选图界面。
          settings.backgroundRotate !== 'off' && h(Row, { label: t('rotateList') },
            h('div', {
              style: {
                display: 'flex', gap: 6, alignItems: 'center',
                flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 300
              }
            },
            h(Select, {
              value: typeof settings.rotateActive === 'string' ? settings.rotateActive : ALL_LISTS,
              options: [
                { value: ALL_LISTS, label: `${t('rotateListAll')}（${ROTATE_POOL.length}）` },
                ...rotateListsOf().map(l => ({ value: l.id, label: `${l.name}（${l.ids.length}）` })),
                { value: NEW_LIST, label: `＋ ${t('rotateListNew')}` }
              ],
              onChange: v => {
                if (v === NEW_LIST) { createRotateList(); return }
                if (v === ALL_LISTS) { setRotateEditing(null); set({ rotateActive: null }); return }
                setRotateEditing(null)
                set({ rotateActive: v })
              }
            }),
            typeof settings.rotateActive === 'string' && h('button', {
              type: 'button',
              onClick: () => {
                if (rotateEditingOf() === settings.rotateActive) { renameRotateList(); setRotateEditing(null) } else { setRotateEditing(settings.rotateActive) }
              },
              className: buttonStyle(false, 'quiet').className
            }, rotateEditingOf() === settings.rotateActive ? t('rotateListDone') : t('rotateListEdit')),
            typeof settings.rotateActive === 'string' && h('button', {
              type: 'button',
              onClick: () => { if (state.rotateDeleteArm === true) { deleteRotateList() } else { setRotateDeleteArm(true) } },
              className: buttonStyle(false, 'danger').className
            }, state.rotateDeleteArm === true ? t('rotateListDeleteArm') : t('rotateListDelete')))),
          // 编辑态：改名输入 + 操作提示（放两行，避免挤在一个 Row 里）
          rotateEditingOf() !== null && h(Row, { label: t('rotateListName') },
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' } },
              h('input', {
                type: 'text',
                value: state.rotateDraftName ?? '',
                maxLength: 24,
                onChange: e => setRotateDraftName(e.target.value),
                onKeyDown: e => { if (e.key === 'Enter') { renameRotateList(); setRotateEditing(null) } },
                style: {
                  width: 150, padding: '3px 7px', fontSize: 12, boxSizing: 'border-box',
                  borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  color: 'var(--dsw-alias-label-primary)'
                }
              }),
              h('button', {
                type: 'button',
                onClick: () => { renameRotateList(); setRotateEditing(null) },
                className: buttonStyle(false).className
              }, t('rotateListSaveName')))),
          settings.backgroundRotate !== 'off' && h(Row, { label: '' },
            h('div', {
              style: {
                fontSize: 11, lineHeight: '15px', maxWidth: 300, textAlign: 'right',
                color: 'var(--dsw-alias-label-tertiary)'
              }
            }, rotateEditingOf() !== null ? t('rotateListEditingHint') : t('rotateListEmptyHint')))
        ].filter(Boolean)
      }

      /** 「细节」页：强调色与装饰开关（5 行）。 */
      function TabDetails (ctx) {
        const { settings, set } = ctx
        return [
          h(Row, { label: t('accentHue'), hint: t('accentHueHint') },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' } },
              h('button', {
                type: 'button',
                'aria-pressed': settings.accentHue === 'preset' ? 'true' : 'false',
                onClick: () => set({ accentHue: 'preset' }),
                className: buttonStyle(settings.accentHue === 'preset').className
              }, t('accentHuePreset')),
              h(Slider, {
                value: typeof settings.accentHue === 'number' ? settings.accentHue : 0,
                min: 0,
                max: 359,
                step: 1,
                suffix: '°',
                onChange: v => set({ accentHue: v })
              }))),
          h(Row, { label: t('contourBorder') },
            h(Toggle, { value: settings.contourBorder, onChange: v => set({ contourBorder: v }) })),
          h(Row, { label: t('accentGlow'), hint: t('accentGlowHint') },
            h(Toggle, { value: settings.accentGlow, onChange: v => set({ accentGlow: v }) })),
          h(Row, { label: t('heroAvatar') },
            h(Toggle, { value: settings.heroAvatar, onChange: v => set({ heroAvatar: v }) })),
          // A3：只在有原生 Windows 标题栏的载体上显示 —— 它在别处是空开关。
          // **只隐藏 UI，不动设置值**：用户切到别的平台再切回来时值还在。
          hasWindowsTitlebar(document) && h(Row, { label: t('titlebarFollow'), hint: t('titlebarFollowHint') },
            h(Toggle, { value: settings.titlebarFollow, onChange: v => set({ titlebarFollow: v }) }))
        ].filter(Boolean)
      }

      /** 「动效」页（2 行）。`motion` 含**无障碍**语义（尊重系统「减少动态效果」）。 */
      function TabMotion (ctx) {
        const { settings, set } = ctx
        return [
          h(Row, { label: t('motion'), hint: t('motionHint') },
            h(Segmented, {
              value: settings.motion,
              options: [
                { value: 'on', label: t('motionOn') },
                { value: 'auto', label: t('motionAuto') },
                { value: 'reduced', label: t('motionReduced') }
              ],
              onChange: v => set({ motion: v })
            })),
          h(Row, { label: t('splash'), hint: t('splashHint') },
            h(Toggle, { value: settings.splash !== false, onChange: v => set({ splash: v }) }))
        ]
      }

      /** 「皮肤」页：观测栏与头像气泡（3 行）。 */
      function TabSkin (ctx) {
        const { settings, set } = ctx
        return [
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
            h(Toggle, { value: settings.avatarBubbles, onChange: v => set({ avatarBubbles: v }) }))
        ]
      }

      /** 页签 id → 该页的行组件。测试按 `TabXxx` 切块数行（见上）。 */
      const TAB_BODIES = {
        look: TabLook,
        background: TabBackground,
        details: TabDetails,
        motion: TabMotion,
        skin: TabSkin
      }

      function Section () {
        const s = useStore()
        const settings = s.settings
        // C14：套用组合后给一行轻提示（几秒后自己消失）。用 state 而不是
        // 局部 useState —— 保存会触发全量重渲染，局部 state 会被重置。
        const notice = s.notice
        const confirmReset = s.confirmReset === true
        // 自定义背景清单与上传态（上传中要禁用上传格）
        const customList = s.customBackgrounds ?? []
        const uploading = s.uploading === true

        if (settings === null) {
          return h('div', { style: { padding: '8px 0', fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } },
            h('div', null, s.lastError === null ? t('loading') : `${t('loadFailed')}（${s.lastError}）`),
            h('button', {
              type: 'button',
              onClick: () => { void load() },
              className: buttonStyle(false).className, style: { marginTop: 10 }
            }, t('retry'))
          )
        }

        const set = patch => { void save(patch) }

        /**
         * 切换「恢复默认」的待确认状态。
         *
         * 待确认时**启动一个 3s 定时器自动复原** —— 否则用户误点一次后，
         * 那个按钮会一直显示「确认恢复默认？」，下次想点别的反而更危险。
         */
        const setConfirmReset = next => {
          state.confirmReset = next
          if (state.confirmResetTimer !== null) clearTimeout(state.confirmResetTimer)
          state.confirmResetTimer = null
          if (next) {
            state.confirmResetTimer = setTimeout(() => {
              state.confirmReset = false
              state.confirmResetTimer = null
              emit()
            }, 3000)
          }
          emit()
        }

        /** C13：分档下拉的选项 = 「跟随主预设」+ 四个预设（带风格名）。 */        const presetOptions = () => [
          { value: FOLLOW, label: t('presetFollow') },
          ...PRESETS.map(p => {
            const style = state.presetStyles?.[p]?.style
            return {
              value: p,
              label: style ? `${PRESET_LABELS[p].zh} · ${style}` : PRESET_LABELS[p].zh
            }
          })
        ]

        /**
         * C14：套用当前预设的推荐组合。
         *
         * 组合数据由宿主下发（`presetCombos`）—— 客户端**不重复定义**这套映射，
         * 否则就是又一份会漂移的手抄副本。
         */
        const applyCombo = preset => {
          const combo = state.presetCombos?.[preset]
          if (combo === undefined || combo === null) {
            setNotice(t('applyComboUnavailable'))
            return
          }
          // 只取「观感组合」四项：不碰 enabled / scheme / rail / motion
          set({
            preset: combo.preset,
            background: combo.background,
            backgroundOpacity: combo.backgroundOpacity,
            fontFamily: combo.fontFamily,
            contentWidth: combo.contentWidth
          })
          setNotice(t('applyComboDone'))
        }

// ── 0.9.0：顶部页签，一次只渲染当前页 ────────────────────────────────
        //
        // 7 组 24 行平铺在一页里约 1900px，而面板内容列只有约 720px（800 面板
        // − 188 导航 − 48 内边距），要滚 2.5 屏。这不是分组分得不好，是
        // **没有分层** —— 0.6.0 把语义理顺了，但没解决「一屏放不下」。
        //
        // 页签状态放共享 `state.activeTab`（不是组件内 `useState`）：面板关闭时
        // `Section` 卸载，`useState` 会归零，用户每开一次设置都被弹回第一页。
        // 放 `state` 则同一会话内记住上次停留的页，而且可测（测试桩的
        // `useState` 返回 undefined）。
        //
        // 仍然不落盘：浏览器本地存储是发行清单里明确禁止的权限，写进
        // settings.json 又会把用户的设置文件弄脏。
        const ctx = {
          settings,
          set,
          presetOptions,
          applyCombo,
          customList,
          uploading,
          uploadBackground,
          removeBackground
        }
        const activeTab = SETTINGS_TABS.find(x => x.id === s.activeTab) ?? SETTINGS_TABS[0]
        const activeBody = TAB_BODIES[activeTab.id] ?? TabLook
        // 「恢复本页」：本页已经全是默认值时**禁用** —— 一个按了没反应的死
        // 按钮比没有这个按钮更糟（用户分不清是坏了还是本来就那样）。
        const tabPatch = tabDefaultsPatch(activeTab.id, settings, s.defaults)

        return h('div', { className: 'zf-set' },
          // 标题 + 副标题（对齐桌宠插件的 `__title` / `__intro`）。
          h('h2', { className: 'zf-set__title' }, t('panelTitle')),
          h('p', { className: 'zf-set__intro' }, t('panelSubtitle')),
          // 页签栏：pill 形 34px，样式在 `.zf-set-tabs` / `.zf-set-tab`。
          // 吸顶（`tabBarStyle`）保留 —— `background` 页展开壁纸网格后是
          // 唯一会滚的地方，页签要始终可见。
          h('div', { style: tabBarStyle },
            h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
              h(Segmented, {
                value: activeTab.id,
                role: 'tablist',
                grow: true,
                idPrefix: 'zf',
                options: SETTINGS_TABS.map(x => ({ value: x.id, label: t(x.label) })),
                onChange: v => {
                  state.activeTab = v
                  emit()
                }
              })),
            // 「恢复本页」跟在页签栏右边 —— 任何一页都够得着，不必滚到页脚。
            // `state.defaults === null`（宿主未升级）时整个按钮不渲染。
            s.defaults !== null && h('button', {
              type: 'button',
              title: t('tabReset'),
              'aria-label': t('tabReset'),
              disabled: tabPatch === null,
              onClick: () => { if (tabPatch !== null) set(tabPatch) },
              className: 'zf-set-btn zf-set-btn--quiet'
            }, t('tabReset'))),
          h('div', { style: tabHintStyle }, t(activeTab.hint)),
          h('div', {
            key: activeTab.id,
            className: 'zf-set-panel',
            role: 'tabpanel',
            id: `zf-panel-${activeTab.id}`,
            'aria-labelledby': `zf-tab-${activeTab.id}`,
            tabIndex: -1
          }, ...renderCards(activeTab, activeBody(ctx))),
          // 底部动作区分**危险 / 中性 / 主要**三档 —— 原先四个按钮同级同色，
          // 主次不分，而「恢复默认」这种一键抹掉全部设置的动作与「重试」并排、
          // 样式相同，很容易误点。
          h('div', { className: 'zf-set-foot' },
            // 危险动作：弱化为文字按钮，且需要**二次确认**
            h('button', {
              type: 'button',
              onClick: () => {
                if (confirmReset) { void resetToDefaults(); setConfirmReset(false); return }
                setConfirmReset(true)
              },
              className: confirmReset ? buttonStyle(false, 'danger').className : buttonStyle(false, 'quiet').className
            }, confirmReset ? t('resetConfirm') : t('reset')),
            // 中性：导入导出
            h('div', { className: 'zf-set-btns' },
              h('button', {
                type: 'button',
                title: t('exportHint'),
                onClick: () => exportSettings(),
                className: buttonStyle(false).className
              }, t('exportSettings')),
              // 用 `<label>` 包一个隐藏的 file input ——
              // 直接点 `<input type=file>` 在不同浏览器里样式差异大。
              h('label', {
                title: t('importHint'),
                className: buttonStyle(false).className, style: { display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }
              },
              t('importSettings'),
              h('input', {
                type: 'file',
                accept: 'application/json,.json',
                style: { display: 'none' },
                onChange: event => {
                  const file = event.target.files?.[0] ?? null
                  void importSettings(file)
                  // 清空 input：否则连续导入同一个文件不会再触发 change
                  event.target.value = ''
                }
              }))),
            // 主要：重新保存（失败态下才叫「重试」）
            h('button', {
              type: 'button',
              onClick: () => { void save({}) },
              className: buttonStyle(true).className
            }, s.lastError === null ? t('resave') : t('retry'))
          ),
          // 提示与错误**分开渲染**：提示是中性色（成功/信息），错误才用红。
          // 合成一处会让「导入成功」显示成红色的「保存失败（设置已导入）」。
          notice !== null && h('div', {
            style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
          }, notice),
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

      /**
       * 预设色块的颜色（观测栏「主题」那一组用）。
       *
       * ── 为什么是函数而不是一张常量表（0.12.1 修）──────────────────────
       *
       * 原先这里是一张**手抄常量**：
       *
       *   const SWATCH = { zhuang:'#F2E957', burst:'#C4D579', cyan:'#75DCD9', wine:'#D86766' }
       *
       * 它有两个各自独立、又同时命中的毛病：
       *
       *   ① **只有 4 项**。0.11.0 把预设从 4 套扩到 8 套，这张表没跟上 ——
       *      `SWATCH[p]` 对 olive/sand/frost/amber 是 `undefined`，
       *      `background:undefined` 不画任何东西。用户截图里后 4 行**没有色块**，
       *      就是这个（实测：截图后 4 行左侧零个饱和像素）。
       *      手抄表的漂移不是偶然 —— 它和 `PRESET_LABELS` 一样是「客户端副本」，
       *      但 `PRESET_LABELS` 由生成器维护，这张表是纯手工的。
       *
       *   ② **手抄的是深色档的颜色**（`#F2E957` 等 = 官方本色），浅色模式下
       *      压在浅色行底上对比只有 **1.08:1**（zhuang）—— 基本看不见。
       *      而明暗两档的强调色本来就不同：浅色档为了当链接被压深过
       *      （`accentLight`），深色档才用官方本色。
       *
       * 现在改为从**宿主下发的角色表**（`state.themeRoles`）里取，按当前明暗
       * 档位选：既自动覆盖全部预设（扩预设不用再改这里），又天然是当前档位
       * 该有的颜色。取色失败（宿主未升级/角色缺失）时返回 `null`，
       * 调用方少画一个色块 —— 宁可没有装饰，也不要一个错色。
       *
       * @param {string} presetId
       * @returns {string|null}
       */
      function presetChip (presetId) {
        const scheme = currentScheme(theme)
        const role = state.themeRoles?.[presetId]?.[scheme]
        const brand = role?.brand
        return typeof brand === 'string' && brand !== '' ? brand : null
      }

      /** 会话状态显示文案。 */
      const SESSION_TEXT = {
        idle: '待机', ready: '就绪', running: '生成中',
        tool: '调用工具', error: '出错', stopped: '已停止', done: '已完成'
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

        // ── 运行耗时走字（对标 Mornye 状态区）─────────────────────────────
        // 只在活跃状态挂 1s 定时器；非活跃/暂停时不烧 CPU。
        // 计时源是内存里的 `sessionSince`（trackSessionSince 维护），
        // 刻意不读 DOM 时间戳 —— 稳定、零依赖、不碰会话内容。
        const [, setTick] = useState(0)
        const active = state.sessionState === 'running' || state.sessionState === 'tool'
        useEffect(() => {
          if (!active || state.sessionSince === null) return undefined
          const id = setInterval(() => setTick(v => v + 1), 1000)
          return () => clearInterval(id)
        }, [active])
        const elapsed = state.sessionSince === null
          ? null
          : formatElapsed(Date.now() - state.sessionSince)
        const caption = elapsed === null
          ? `${stateText} · ${t('localOnly')}`
          : `${stateText} · ${elapsed} · ${t('localOnly')}`

        return h('div', { className: 'zf-rail__body' },
          h('div', { className: 'zf-rail__head' },
            h('img', { className: 'zf-rail__avatar', src: `${ROUTE}/art/avatar.webp`, alt: '' }),
            h('div', { style: { minWidth: 0 } },
              h('div', { className: 'zf-rail__title' }, t('railTitle')),
              h('div', { className: 'zf-rail__caption' }, caption))),
          h('div', { className: 'zf-rail__group' },
            h('div', { className: 'zf-rail__label' }, t('stats')),
            h('div', { className: 'zf-rail__stats' },
              h('div', { className: 'zf-rail__stat' }, h('b', null, st.turns), h('span', null, t('turns'))),
              h('div', { className: 'zf-rail__stat' }, h('b', null, st.steps), h('span', null, t('steps'))),
              h('div', { className: 'zf-rail__stat' }, h('b', null, st.rate), h('span', null, t('rate'))),
              h('div', { className: 'zf-rail__stat' }, h('b', null, st.tokens), h('span', null, t('tokenTotal'))),
              h('div', { className: 'zf-rail__stat' }, h('b', null, st.cache), h('span', null, t('cache'))),
              h('div', { className: 'zf-rail__stat' }, h('b', null, st.context), h('span', null, t('contextPct'))))),
          h('div', { className: 'zf-rail__group' },
            h('div', { className: 'zf-rail__label' }, t('groupTheme')),
            h('div', { className: 'zf-rail__swatches' },
              ...PRESETS.map(p => {
                const chip = presetChip(p)
                const name = PRESET_LABELS[p]?.[bgLang()] ?? PRESET_LABELS[p]?.['zh'] ?? p
                return h('button', {
                  key: p,
                  type: 'button',
                  className: 'zf-rail__swatch',
                  title: name,
                  'aria-pressed': settings.preset === p ? 'true' : 'false',
                  onClick: () => set({ preset: p })
                },
                h('span', { className: 'zf-rail__swatch-main' },
                  // 色块只在**取到真实颜色**时渲染：取不到就少一个装饰，
                  // 而不是画一个错色（错色会让人以为那套预设就是这个颜色）
                  chip === null ? null : h('span', { className: 'zf-rail__chip', style: { background: chip } }),
                  h('span', { className: 'zf-rail__swatch-text' }, name)),
                settings.preset === p ? h('span', { className: 'zf-rail__swatch-tick' }, '✓') : null)
              }))),
          h('div', { className: 'zf-rail__group' },
            h('div', { className: 'zf-rail__label' }, t('contentWidth')),
            // 复用设置页的 Segmented（compact + grow 适配窄栏），不再手写一份
            h(Segmented, {
              value: String(settings.contentWidth ?? 'auto'),
              options: CONTENT_WIDTH_MODES.map(m => ({ value: m, label: t(`contentWidth_${m}`) })),
              onChange: v => set({ contentWidth: v }),
              compact: true,
              grow: true
            })),
          h('div', { className: 'zf-rail__group' },
            h('div', { className: 'zf-rail__label' }, t('groupWallpaper')),
            h('div', { className: 'zf-rail__row' },
              // ⚠️ 键名是 `opacity` 不是 `bgOpacity` —— 写错时 `t()` 会原样
              // 返回键名，界面上直接显示 "bgOpacity"（用户截图里就是这样）。
              h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t('opacity')),
              h('span', { className: 'zf-rail__value' }, `${settings.backgroundOpacity}%`)),
            // ── 壁纸选择：**缩略图网格**（取代原先的全宽文字列表）──────
            //
            // 原先每张壁纸占一整行、只显示名字 —— 8 张就是 8 行，把观测栏撑得
            // 又长又空，而且**看不出壁纸长什么样**（用户截图反馈「有点丑」）。
            // 设置页早就用了缩略图网格（64×40，直接可见），这里保持一致：
            // 3 列网格一屏放得下，同时修掉「显示原始 id」那个 bug。
            //
            // 0.9.0：「无」从**末尾移到首位**（与设置页一致），且网格加了
            // 高度上限（见 index.js 的 `.zf-rail__artgrid`）—— 58 张排下来
            // 约 20 行，没有上限会把右栏撑成一根长滚动条。
            h('div', { className: 'zf-rail__artgrid' },
              // 「无」（清空壁纸）：与其它项同尺寸保持网格整齐，但它是
              // 「关掉壁纸」而不是某张图，所以排在最前而不是末尾。
              h('button', {
                key: 'none',
                type: 'button',
                className: 'zf-rail__art zf-rail__art--none',
                'aria-pressed': settings.background === 'none' ? 'true' : 'false',
                'aria-label': t('bgNone'),
                title: t('bgNone'),
                onClick: () => set({ background: 'none' })
              }, h('span', null, t('bgNone'))),
              ...BACKGROUNDS.filter(b => b !== 'none').map(b => {
                const pressed = settings.background === b
                const file = `wallpaper-${b}.webp`
                // C13：同设置页 —— 用当前明暗档位实际生效的预设
                const recommended = isRecommendedArt(state.presetStyles, presetForScheme(settings, currentScheme(theme)), b)
                const label = bgLabel(b)
                return h('button', {
                  key: b,
                  type: 'button',
                  className: recommended ? 'zf-rail__art zf-art-recommended' : 'zf-rail__art',
                  'data-zf-recommended': recommended ? 'true' : undefined,
                  title: recommended ? `${label}${t('presetRecommend')}` : label,
                  'aria-label': recommended ? `${label}${t('presetRecommend')}` : label,
                  'aria-pressed': pressed ? 'true' : 'false',
                  onClick: () => set({ background: pressed ? 'none' : b })
                },
                h('img', { src: `${ROUTE}/art/thumbs/${file}`, alt: '', loading: 'lazy' }))
              }))))
      }

      /**
       * 官方 boot 屏是否已经退场。
       *
       * 抽成**纯函数**是为了可测：真实逻辑依赖 React 的 state/effect 时序，
       * 而测试桩的 `useState`/`useEffect` 都是空实现 —— 直接把判定留在组件里，
       * 这条最关键的时机逻辑就永远测不到（而它恰恰是出过 bug 的地方）。
       *
       * 判定依据（源码实测）：`BootHandoff` 首帧渲染 `[data-dsh-boot]`，
       * 其 `useLayoutEffect` 置位后换成应用，所以该元素消失 = boot 退场。
       *
       * @param {Document} doc
       * @returns {boolean}
       */
      function bootScreenGone (doc) {
        if (doc === null || doc === undefined) return true
        try {
          return doc.querySelector('[data-dsh-boot]') === null
        } catch {
          return true   // 查询失败按「已退场」处理：宁可播，也不要永远不播
        }
      }

      /**
       * 启动动效（干员立绘入场）。
       *
       * ── 行为 ───────────────────────────────────────────────────────────
       *
       * 页面加载后播放一次：淡入 + 轻微放大 → 停留 → 淡出（CSS `@keyframes`
       * 一次跑完），动画结束后**组件自行卸载**（不留空壳节点）。
       *
       * ── 为什么用 `state.splashPlayed` 而不是每次渲染都播 ─────────────
       *
       * 组件会因为任何 `emit()`（改设置、切配色…）重渲染。若每次都播，
       * 用户每动一下滑杆就闪一次立绘。所以用一次性标记：本次页面会话里
       * 只播一次。标记在 `state` 上（内存态），刷新页面才会重置。
       *
       * ── 不拦截点击 ────────────────────────────────────────────────────
       *
       * 容器 `pointer-events:none` —— 动效是过场，不该挡住用户操作
       * （与 `shell.overlay` 的「点击穿透」设计一致）。
       */
      function Splash () {
        const s = useStore()
        const settings = s.settings
        // 动画时长与 CSS 的 `--zf-splash-duration` 保持一致（默认 2400ms）
        const DURATION = 2400

        // ── 触发时机：等**官方 boot 屏消失**那一刻（C 方案）───────────────
        //
        // 官方 boot 屏（wordmark + spinner）由 `BootHandoff` 托着：它首帧渲染
        // boot DOM，`useLayoutEffect` 里置位后换成应用（源码实测）：
        //
        //   const [ready, setReady] = useState(false)
        //   useLayoutEffect(() => setReady(true), [])
        //   if (ready) return props.app()
        //   return <div data-dsh-boot="" ... />
        //
        // 所以「boot 屏消失」= `#root` 里的 `[data-dsh-boot]` 元素没了。
        // 在这里接上，观感就是「开机 → 立绘 → 应用」连贯一气，
        // 而不是「应用已经好了，再冒出一张图」（用户反馈的正是后者）。
        //
        // 兜底：若 boot 元素始终存在（未来壳改版），最多等 BOOT_WAIT 就播，
        // 不能让动效因为等不到信号而永不出现。
        const BOOT_WAIT = 1500
        const [armed, setArmed] = useState(false)
        useEffect(() => {
          if (state.splashPlayed) return undefined
          let done = false
          const fire = () => {
            if (done) return
            done = true
            setArmed(true)
          }
          const bootGone = () => bootScreenGone(document)
          if (bootGone()) { fire() } else {
            // 轮询比 MutationObserver 更稳：boot 元素可能被整体替换而非移除
            const iv = setInterval(() => { if (bootGone()) { clearInterval(iv); fire() } }, 40)
            const to = setTimeout(() => { clearInterval(iv); fire() }, BOOT_WAIT)
            return () => { clearInterval(iv); clearTimeout(to) }
          }
          return undefined
        }, [])

        const [gone, setGone] = useState(false)
        useEffect(() => {
          if (!armed) return undefined
          const timer = setTimeout(() => setGone(true), DURATION + 150)
          return () => clearTimeout(timer)
        }, [armed])

        // 标记只在**真正开播**时置位。
        //
        // 最初写在首次渲染处，结果踩了竞态：首帧 `styleReady` 还是 false
        // （样式表还没 fetch 回来）→ 组件 return null，但标记已被消耗 →
        // 样式就绪后重渲染时判定「已播过」→ **永远不播**（用户反馈「启动
        // 压根没播」就是它）。现在只在 armed 且真的要渲染时才置位。
        if (!armed || gone) return null
        if (!state.styleReady) return null
        if (settings === null || settings.enabled !== true) return null
        // 显式关掉时不播；`reduced` 由 CSS 把动画干掉（也会立刻透明），
        // 所以这里统一让组件在 DURATION 后卸载即可。
        if (settings.splash === false) return null
        state.splashPlayed = true

        // ── 与宿主半边首帧的交接（同一帧，无缝）─────────────────────────
        //
        // 宿主通过 `webserver/index-inject` 在**页面解析阶段**插了一块纯色
        // 遮罩（`#zf-first-frame`），它盖住了官方开机卡片 —— 所以屏幕从第一帧
        // 起就是我们的底色。等这里的立绘真正要渲染时，调 `end()` 让那块首帧
        // 淡出，立绘同时在下面淡入，接缝不可见。
        //
        // 这一步是**幂等**的，且首帧脚本自己也有自保撤离（卡片消失/12s 超时），
        // 所以这里即使失败也只是少一次淡出，不会留下遮挡。
        if (state.firstFrameEnded !== true) {
          state.firstFrameEnded = true
          try {
            globalThis.__zfFirstFrame?.end?.()
          } catch { /* 注入脚本不在（Web 端或已撤离）：忽略 */ }
        }

        const narrow = typeof window !== 'undefined' && window.innerWidth <= 900
        const file = narrow ? 'splash-sm.webp' : 'splash.webp'
        return h('div', { className: 'zf-splash', 'aria-hidden': 'true' },
          h('img', {
            className: 'zf-splash__art',
            src: `${ROUTE}/art/${file}`,
            alt: '',
            decoding: 'async'
          }))
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
      function railOwner (doc = document) {
        const s = state.settings
        if (s === null || s.enabled !== true || s.rail === false) return 'none'
        if (!state.styleReady) return 'none'
        // ── 两个条件缺一不可：tab 挂着内容 **且** 原生面板确实展开 ──────────
        //
        // 只判 `tabMounted` 会踩这个坑（用户实测反馈「第一次展开再收起后，
        // 观测台不再显示」）：官方实现里
        //
        //   "Docked content stays mounted while collapsed, translated off the
        //    frame's right edge"（收起时 docked 内容仍挂载，只是平移出右边缘）
        //
        // 所以收起后 `tabMounted` 依然是 1 —— 只看它会误判「tab 正在显示」，
        // 于是浮层让位，而 tab 已被移出可视区 → **两边都看不见**。
        // 加上 `nativeRightbarOpen` 后：收起 → 浮层接手；展开 → tab 接管。
        if (state.tabMounted > 0 && nativeRightbarOpen(doc)) return 'tab'
        return 'overlay'
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
      // 启动动效：叠在最上层（CSS z-index:40），点击穿透，播完自卸
      safeInject('shell.overlay', {
        id: 'zhuang-fangyi-splash', order: 10, locale: NS
      }, Splash)

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
        // 换图交叉淡入的临时层也要摘掉：正常情况下它淡完会自己移除，
        // 但停用时可能正淡到一半 —— 留着就是一层永远淡不完的旧图。
        try {
          document.querySelector('.zf-art-fade')?.remove()
        } catch { /* 已移除 */ }
        // C11：关掉读数推送，别给宿主留一条悬挂连接
        closeSessionStream('dispose')
        // C15：停掉壁纸轮播 —— 不停的话停用插件后它仍会每 N 分钟写一次 DOM
        // （对着已经拆掉的界面重渲染）。
        stopRotation()
        // 行内提示的消失定时器 —— 不清的话停用插件后它仍会触发一次
        // `emit()`，对着已卸载的组件重渲染。
        if (state.noticeTimer !== null) {
          clearTimeout(state.noticeTimer)
          state.noticeTimer = null
        }
        state.notice = null
        // 「恢复默认」的待确认定时器同理
        if (state.confirmResetTimer !== null) {
          clearTimeout(state.confirmResetTimer)
          state.confirmResetTimer = null
        }
        state.confirmReset = false
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
        DICT, PRESETS, SCHEMES, BACKGROUNDS, BG_GROUPS, BG_GROUP_OF, POSITIONS, NS,
        // 设置页的渲染原语（0.9.3）：Segmented 的「段选 vs 页签」两种模式
        // 差别在**行为**（ARIA 角色）而不只是外观，扫源码文本的断言在重构时
        // 会假失败 —— 导出它，让测试对着渲染结果写。
        Segmented, Card, Row,
        // 供无头测试直接验证定位/打标逻辑
        makeModuleClass, makeMarker, readSessionState, readStats, nativeRightbarOpen,
        // 观测台路径裁决与设置同步（用例 41/42），以及官方 tab 的自动打开（用例 44）
        railOwner, resyncSettings, maybeOpenRailTab, resetToDefaults, reloadThemes, save,
        formatElapsed, trackSessionSince, bootScreenGone, presetDepth, isRecommendedArt,
        fontAttrsFor, FONT_FAMILIES, FONT_SCALES, isDarkActive,
        // 换壁纸的交叉淡入（用例 72）：拆开导出，好把时序单测起来
        readArtPaint, armArtFade, artFadeAllowed,
        // 代码高亮的 token 色（用例 73）
        SHIKI_TOKEN_KEYS, applyCodeTokens,
        // 阅读宽度（用例 74）
        CONTENT_WIDTHS, CONTENT_WIDTH_MODES, applyContentWidth,
        // 逐图取景（用例 75）
        artPosition,
        // 交叉淡入计数（诊断）
        artStats,
        // 会话读数推送（C11，用例 77）
        formatTokens, formatStats, streamPayload, sessionIdOf, streamDiag,
        streamState, STREAM_FRESH_MS, syncSessionStream, closeSessionStream,
        // C12 导入 / 导出（用例 79）
        exportSettings, importSettings, IMPORT_MAX_BYTES,
        // C13 明暗分档预设（用例 80）
        presetForScheme, hasSchemePresets, composeSchemeOverrides, overridesForSettings, FOLLOW,
        // C14 一键推荐组合（用例 81）
        // （组合数据由宿主下发，客户端只负责套用；纯函数在 src/palette.js）
        // C15 壁纸轮播（用例 82）
        nextWallpaper, syncRotation, stopRotation, ROTATE_MS, ROTATE_POOL, rotatePoolOf,
        // 设置页结构（用例 83）：分组常量 + 平台判据
        SETTINGS_TABS, UNASSIGNED_KEYS, TAB_BODIES, ART_PANEL_ID, tabDefaultsPatch,
        hasWindowsTitlebar,
        // 自定义背景（用例 84）
        artSrcOf, artFitOf, fitOfSize, CUSTOM_BACKGROUND, PORTRAIT_RATIO,
        uploadBackground, removeBackground,
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
