/**
 * 壁纸目录 —— **内置壁纸的单一事实来源**。
 *
 * 为什么不把这些信息散在各处：
 *
 *   · 加一张壁纸原先要**同步改 5 个地方**：`prepare-art.py` 的 `WALLPAPERS`
 *     表、`src/settings.js` 的 `BACKGROUNDS`、`client.js` 的本地 `BACKGROUNDS`
 *     副本、`client.js` 的 `BG_LABELS`、以及 zh/en 两张 `DICT` 各一条。
 *     9 张时靠手抄还行，59 张时**必然漂移** —— 本仓库已经因为同类问题
 *     栽过多次（`BACKGROUNDS` / `PRESETS` / `FONTS` 都是双份 + 交叉断言）。
 *
 *   · 这里定义一次，`tools/gen-wallpapers.mjs` 由它生成
 *     `prepare-art.py` 的表和 `client.js` 的副本；`--check` 模式供 CI 校验。
 *
 * 字段：
 *   id      稳定标识，进设置与 `--zf-art-<id>` 变量名，**一旦发布不得改名**
 *           （改名等于让所有老用户的 `settings.background` 失效）
 *   file    `art/` 下的文件名（约定 `wallpaper-<id>.webp`，生成器会核对）
 *   source  源素材相对路径（相对 `庄方宜素材\`），供 prepare-art.py 取图
 *   zh/en   设置页缩略图的显示名（`title` / `aria-label`）
 *   group   选择器分组：`official` 官方物料 / `scene` 场景与横图 / `char` 角色竖图
 *           / `texture` 纹理与极简
 *   fit     `cover` 铺满裁切 / `contain` 完整显示（两侧同图模糊垫底）
 *           竖图（宽高比 < 0.87）必须 contain；生成器会与 `art/wallpapers.json` 核对
 *   note    可选。选材时的存疑点，方便日后回溯（不影响运行）
 */

/** 分组顺序即选择器里的显示顺序。 */
export const WALLPAPER_GROUPS = ['official', 'scene', 'char', 'texture']

/** 分组的中英标签（选择器分组标题用）。 */
export const GROUP_LABELS = {
  official: { zh: '官方物料', en: 'Official' },
  scene: { zh: '场景与横图', en: 'Scenery' },
  char: { zh: '角色竖图', en: 'Character' },
  texture: { zh: '纹理与极简', en: 'Texture' }
}

/** `settings.background` 的「不选壁纸」取值。它不是壁纸，不进 `WALLPAPERS`。 */
export const BACKGROUND_NONE = 'none'

/**
 * 条目工厂：把必填字段收敛成一行，清单本身保持可扫读。
 * `file` 由 id 推导（约定 `wallpaper-<id>.webp`，生成器核对两侧一致）。
 */
const W = (id, source, zh, en, group, fit, note) =>
  ({ id, file: `wallpaper-${id}.webp`, source, zh, en, group, fit, crop: null, note })

/**
 * 壁纸清单。顺序即选择器里的显示顺序（组内）。
 *
 * 0.4.x 起就存在的 8 张 id 不得改动（老用户的 `settings.background` 指着它们）；
 * 0.8.0 新增的 50 张按「来源目录 + 序号」编号（offNN / sceNN / chaNN）。
 * `note` 记录选材时的存疑点 —— 其中 off02 / cha08 / sce16 是素材库自动描述
 * 与选图 agent 结论冲突、未及逐张复核的（0.8.0 决定先收，日后可换）。
 */
export const WALLPAPERS = [
  // ── 原有 8 张（0.4.x 起，id 不得改动）───────────────────────────────────
  W('sakura', '02-场景原画/樱花树下_4096x1716.webp', '樱花树下', 'Under the cherry tree', 'scene', 'cover'),
  W('promo', '08-视频抽帧/1_抽帧_宣传CG_绿发双角色.webp', '宣传 CG · 双人', 'Promo CG · two leads', 'scene', 'cover'),
  W('pool', '08-视频抽帧/9_抽帧_宣传CG_樱花池.webp', '樱花池', 'Cherry-blossom pool', 'scene', 'cover'),
  W('ultrawide', '08-视频抽帧/5_抽帧_超宽横幅_樱花(3840x1116).webp', '超宽横幅 · 樱花', 'Ultrawide blossoms', 'scene', 'cover'),
  W('dark', '09-散图与二创/D684AC645F51D3D08668CE19EEB8AC63.png', '暗调水面月影', 'Moonlit water', 'scene', 'cover'),
  W('portrait', '01-立绘海报/干员立绘卡_E1_1080x1920.webp', '干员立绘卡', 'Operator card', 'char', 'contain'),
  W('vertical', '08-视频抽帧/2_抽帧_竖版立绘循环 CHIZANG.webp', '竖版立绘循环', 'Vertical loop', 'char', 'contain'),
  W('contour', '08-视频抽帧/14_抽帧_暗调CG_等高线纹理.webp', '等高线纹理', 'Contour lines', 'texture', 'cover'),

  // ── 0.8.0 新增 · 官方物料（04-官方通用 / 06-商店与平台图）───────────────
  W('off01', '04-官方通用/游戏插画-2-我很喜欢.jpg', '田野淡彩', 'Pastel fields', 'official', 'cover',
    '与 官图_04 同画的无 logo 版（像素比对 MAD 0.12），二选一留这张'),
  W('off02', '04-官方通用/官图/官图_24_荷塘古树.jpeg', '荷塘古树', 'Lotus pond & ancient tree', 'official', 'cover',
    '⚠ 素材库自动描述称「带淡字」，选图 agent 称无字 —— 未复核，若实机可见文字请换'),
  W('off03', '04-官方通用/官图/官图_17_仙鹤云海.jpeg', '仙鹤云海', 'Cranes over cloud sea', 'official', 'cover',
    '与 游戏插画_1 同画，这张是干净版'),
  W('off04', '04-官方通用/官图/官图_05_水墨长枪.jpeg', '水墨长枪', 'Ink-wash spear', 'official', 'cover'),
  W('off05', '04-官方通用/官图/官图_01_溪谷气泡.png', '溪谷气泡', 'Valley bubbles', 'official', 'cover',
    '08-视频抽帧/3_抽帧 是它的 AI 动态重绘版（带豆包AI水印），两者不可互替'),
  W('off06', '06-商店与平台图/appstore/bb646c60e3075289cbf5632d54380646201266157.jpg', '白蝶环绕', 'White butterflies', 'official', 'contain',
    'App Store 商店宣传原画（我方曾误判为「界面截图」整类排除，实为纯出血原画）'),
  W('off07', '04-官方通用/官图/官图_02_白底全身立绘.jpeg', '白底立绘 · 全身', 'Full figure on white', 'official', 'contain'),
  W('off08', '04-官方通用/官图/官图_16_蓝天梨树.jpeg', '蓝天梨树', 'Pear tree, blue sky', 'official', 'contain'),
  W('off09', '04-官方通用/官图/官图_08_几何纹样.jpeg', '几何纹样 · 小兽', 'Geometry & critter', 'official', 'cover'),

  // ── 0.8.0 新增 · 场景与横图（02 / 08 / 09 / 16-横版·全景·方形）──────────
  W('sce01', '16-二创收集/横幅全景/NR8AVjViQ2dBeE1EQTVOekF3TnpReTYuZ2lhdHJYQXkwIQUAcXVuZ3o!.jpeg', '霓虹星空', 'Neon starfield', 'scene', 'cover', '天然暗调'),
  W('sce02', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReU83UWZhcS5NTURFIQUAcXVuZ3o!.png', '樱花回眸', 'Blossom glance', 'scene', 'cover'),
  W('sce03', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWxqczVhaXBNQ2lvIQUAcXVuZ3o!.png', '花枝云海', 'Blossoms & cloud sea', 'scene', 'cover',
    '与 官图_03_梨花树下 同画（MAD 0.12），留这张（四角做过放大复核）'),
  W('sce04', '08-视频抽帧/15_抽帧_莲花池场景.webp', '莲花池', 'Lotus pond', 'scene', 'cover'),
  W('sce05', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReVBMUWZhdmQ4TVRFIQUAcXVuZ3o!.png', '白花逆光', 'Backlit blossoms', 'scene', 'cover'),
  W('sce06', '02-场景原画/横版_卧姿立绘_2048x1152.webp', '卧姿立绘', 'Reclining figure', 'scene', 'cover'),
  W('sce07', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReUliVWZhajMuMGpZIQUAcXVuZ3o!.jpeg', '水墨淡彩', 'Muted ink wash', 'scene', 'cover'),
  W('sce08', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReTZVMGxhc2VkeVNnIQUAcXVuZ3o!.png', '绘本光斑', 'Storybook bokeh', 'scene', 'cover'),
  W('sce09', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWRiTWZhcUJ6N3lBIQUAcXVuZ3o!.png', '樱花远景', 'Blossom vista', 'scene', 'cover'),
  W('sce10', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWNiTWZhaVZZNGlBIQUAcXVuZ3o!.jpeg', '荷塘绿调', 'Lotus greens', 'scene', 'cover'),
  W('sce11', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWJMUWZhaFZNa3pNIQUAcXVuZ3o!.jpeg', '林间逆光', 'Forest backlight', 'scene', 'cover'),
  W('sce12', '09-散图与二创/52AC523AA50527A6D2712D373F45B658.jpg', '红墙竹林', 'Red wall & bamboo', 'scene', 'cover'),
  W('sce13', '08-视频抽帧/7_抽帧_3D模型实机_室内(331s).webp', '实机 · 室内', 'In-game interior', 'scene', 'cover'),
  W('sce14', '16-二创收集/方形构图/NR8AVjViQ2dBeE1EQTVOekF3TnpReTBmMG5hZ1NaUnk0IQUAcXVuZ3o!.jpeg', '月洞门庭院', 'Moon-gate courtyard', 'scene', 'cover'),
  W('sce15', '16-二创收集/方形构图/NR8AVjViQ2dBeE1EQTVOekF3TnpReXkycDlhdXhBU0JJIQUAcXVuZ3o!.png', '拔刀动作', 'Blade draw', 'scene', 'cover'),
  W('sce16', '02-场景原画/黄绿涂鸦横图_2048x1152.webp', '黄绿涂鸦', 'Yellow-green graffiti', 'scene', 'cover',
    '⚠ 选图 agent 标注「左侧有疑点」，未复核'),
  W('sce17', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReW43UWZhdlNya1RJIQUAcXVuZ3o!.jpeg', '暖木长廊', 'Warm wooden hall', 'scene', 'cover'),
  W('sce18', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWNwVmJhZ3NHRlRnIQUAcXVuZ3o!.png', '湖畔灰绿', 'Lakeside grey-green', 'scene', 'cover'),
  W('sce19', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWY3UWZhcU1jUXpNIQUAcXVuZ3o!.jpeg', '白花枝头', 'White blossoms', 'scene', 'cover'),
  W('sce20', '08-视频抽帧/6_抽帧_宽幅_雪景.webp', '宽幅雪景', 'Ultrawide snow', 'scene', 'cover'),
  W('sce21', '16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReUQ3UWZhaWIuZlMwIQUAcXVuZ3o!.jpeg', '朦胧厚涂', 'Soft impasto', 'scene', 'cover', '用户点名保留（过曝朦胧）'),

  // ── 0.8.0 新增 · 角色竖图（16-竖版·条长 / 09-散图）─────────────────────
  W('cha01', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReUhMVWZhc2s5NERZIQUAcXVuZ3o!.jpeg', '雾中执器', 'Mist & instrument', 'char', 'contain'),
  W('cha02', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReUtEZzZhcHBhTkJZIQUAcXVuZ3o!.png', '夜樱双人', 'Night blossoms, two', 'char', 'contain', '天然暗调'),
  W('cha03', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReVlyUWZhbW8xa3lvIQUAcXVuZ3o!.jpeg', '双人立绘', 'Two figures', 'char', 'contain'),
  W('cha04', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReXdMTWZhcHFWSkNnIQUAcXVuZ3o!.jpeg', '樱花林半身', 'Blossom grove', 'char', 'contain'),
  W('cha05', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReXdiTWZhaWNESENnIQUAcXVuZ3o!.jpeg', '绿调全身', 'Full figure, green', 'char', 'contain'),
  W('cha06', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReXpXcDlhcElvU2hJIQUAcXVuZ3o!.png', '深底礼服', 'Gown on dark', 'char', 'contain', '天然暗调'),
  W('cha07', '16-二创收集/条漫长图/NR8AVjViQ2dBeE1EQTVOekF3TnpReXkzOHlhdlkydlJrIQUAcXVuZ3o!.jpeg', '暗青飘带', 'Dark teal ribbons', 'char', 'contain', '天然暗调；条漫长图走 contain 居中'),
  W('cha08', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReSpoLlphbSowY3dZIQUAcXVuZ3o!.jpeg', '夜色长裙', 'Night gown', 'char', 'contain',
    '⚠ 素材库自动描述称「背景 NOIR 字样」，选图 agent 称无字 —— 未复核，若实机可见文字请换'),
  W('cha09', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReSpCLlphdkY4Z2dZIQUAcXVuZ3o!.jpeg', '夜巷侠客', 'Night alley', 'char', 'contain', '天然暗调'),
  W('cha10', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReUZiUWZhdlJlV1MwIQUAcXVuZ3o!.jpeg', '白底单体', 'Solo on white', 'char', 'contain'),
  W('cha11', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReVZZQXRhdnlSTlRRIQUAcXVuZ3o!.jpeg', '光效飘带', 'Light trails', 'char', 'contain'),
  W('cha12', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReW0wRTFhdjNXSndZIQUAcXVuZ3o!.jpeg', '蓝天白云', 'Blue sky', 'char', 'contain'),
  W('cha13', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReW1SbW9hdFdwc1I4IQUAcXVuZ3o!.jpeg', '侧颜特写', 'Profile portrait', 'char', 'contain'),
  W('cha14', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWRCbW9hczZXb3lBIQUAcXVuZ3o!.jpeg', '暖光坐姿', 'Warm light, seated', 'char', 'contain'),
  W('cha15', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReW03UWZhczM1aGkwIQUAcXVuZ3o!.jpeg', '便服半身', 'Casual half-length', 'char', 'contain'),
  W('cha16', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReW5yTWZhdkh2dXg4IQUAcXVuZ3o!.png', '黄昏逆光', 'Dusk backlight', 'char', 'contain', '天然暗调'),
  W('cha17', '16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReXpDY2hhdDlxYlM0IQUAcXVuZ3o!.jpeg', '黑裙暖光', 'Black gown, warm light', 'char', 'contain'),
  W('cha18', '09-散图与二创/DB418AB53D401EF64E45CE09C76367A8.jpg', '白花散落', 'Scattered petals', 'char', 'contain', '天然暗调'),
  W('cha19', '09-散图与二创/853f7ed9809bbbc2e38a4b772b8c3d8c170193073.jpg', '樱花覆水', 'Blossoms on water', 'char', 'contain'),
  W('cha20', '09-散图与二创/076392915FA932997DF87E98A723484A.jpg', '暗蓝全身', 'Full figure on dark blue', 'char', 'contain', '天然暗调')
]

/** 所有合法 id（含 `none`），顺序即选择器顺序。 */
export const BACKGROUND_IDS = [BACKGROUND_NONE, ...WALLPAPERS.map((w) => w.id)]

/** id → 文件名，保持旧 `BACKGROUNDS` 的形状（`none: null`）。 */
export const BACKGROUNDS = {
  [BACKGROUND_NONE]: null,
  ...Object.fromEntries(WALLPAPERS.map((w) => [w.id, w.file]))
}

/** id → 壁纸定义。 */
export const WALLPAPER_BY_ID = Object.fromEntries(WALLPAPERS.map((w) => [w.id, w]))
