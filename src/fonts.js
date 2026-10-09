/**
 * 排版体系（风格预设的第四个维度）。
 *
 * ── 为什么值得做 ──────────────────────────────────────────────────────
 *
 * 外壳有 **184 个 `--dsw-font-*` token**，覆盖 32 个排版角色
 * （`base-16` / `s-14` / `markdown-h1..h4` / `markdown-code` / `markdown-table` …），
 * 而我们此前**一个都没用过** —— 这是剩下最大的一块未利用风格维度。
 *
 * 关键结构（源码实测）：
 *
 *   --dsw-font-family: "Segoe UI", ...          ← 总开关，131 处直接引用
 *   --dsw-font-base-16: 16px/24px var(--dsw-font-family)   ← 复合 token（249 处引用）
 *   --dsw-font-mono: "SF Mono", ...             ← 代码/终端专用，**独立**
 *
 * 所以覆盖 `--dsw-font-family` 就能换掉绝大部分界面字体，且：
 *   · **不动任何字号**（复合 token 里的字号是独立声明的）→ 布局不受影响
 *   · **不碰代码字体**（它走 `--dsw-font-mono`）→ 代码对齐不会乱
 *
 * ── ⚠️ 必须同时覆盖 `:root` 和 `body`（实测确认，不是推理）──────────
 *
 * 用 Edge headless 实测（真实 CSS 引擎）四种覆盖位置：
 *
 *   变体                      body 文字   复合 token（标题）  代码块
 *   不覆盖（基线）              Segoe UI    Segoe UI          SF Mono
 *   A: :root 覆盖              Georgia     Georgia           SF Mono
 *   B: body 覆盖               Georgia     **Segoe UI** ✗    SF Mono
 *   C: :root + body 都覆盖      Georgia     Georgia           SF Mono
 *
 * 只在 `body` 覆盖**不够**：复合 token（`--dsw-font-base-16` 等）在 **`:root`**
 * 求值，而 `:root` 不是 `body` 的后代，读不到 body 上的值 —— 与 shiki 那个
 * bug 同一类作用域问题。所以两个位置都要写。
 *
 * ── 字体栈一律以「通用族」结尾 ────────────────────────────────────────
 *
 * 不下载任何字体（零体积、零网络），只写系统字体栈。每档都以通用族
 * （`serif` / `sans-serif` / `monospace`）收尾，保证即使前面所有具体字体
 * 都不存在，也一定能落到一个合理字体上，不会退化成浏览器默认衬线。
 */

/**
 * 字体档位。
 *
 * `default` = 不覆盖（沿用外壳自带的 `Segoe UI` 系栈）。
 */
export const FONT_FAMILIES = ['default', 'sans', 'serif', 'rounded', 'mono']

/**
 * 各档的字体栈。
 *
 * 中文回退放在英文之后、通用族之前 —— 中英混排时英文用前者、中文用后者，
 * 这是中文界面的常规做法（否则中文会被英文衬线的回退字体接管，很难看）。
 */
export const FONT_STACKS = {
  sans: '"Segoe UI", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, sans-serif',
  serif: 'Georgia, "Songti SC", "SimSun", "Noto Serif CJK SC", serif',
  rounded: '"Segoe UI Variable Display", "Quicksand", "Yuanti SC", "PingFang SC", system-ui, sans-serif',
  mono: '"Cascadia Mono", "JetBrains Mono", Consolas, "Sarasa Mono SC", "Microsoft YaHei", monospace'
}

/** 字号缩放档位。**幅度必须小** —— 见 `FONT_SCALES` 的注释。 */
export const FONT_SCALES = [0.95, 1, 1.05]

/**
 * 把字号缩放转成 CSS 变量声明。
 *
 * ⚠️ **只动 `--dsh-content-font-size`，且幅度限死 ±5%**。
 *
 * 外壳用这个变量算正文字号，同时用 `--dsh-content-font-delta` 让一批
 * 行高/内边距跟着走（`calc(24px + var(--dsh-content-font-delta))`）。所以：
 *   · 缩放会**连带影响布局尺寸**（这是设计意图，不是 bug）
 *   · 但幅度过大就会撑破固定高度的容器（如折叠行的 24px）
 *
 * ±5% 是保守上限：16px → 15.2px / 16.8px，行高 24px → 约 23.9/25.2px，
 * 不足以撑破任何按 24px 设计的行。**不要放宽这个范围**。
 *
 * @param {number} scale
 * @returns {number} 归一化后的缩放值
 */
export function normalizeFontScale (scale) {
  const n = typeof scale === 'number' ? scale : Number(scale)
  if (!Number.isFinite(n)) return 1
  // 夹到最近的一档（而不是自由取值）：档位制能让 UI 更简单，也防手滑传怪值
  let best = FONT_SCALES[0]
  for (const s of FONT_SCALES) {
    if (Math.abs(s - n) < Math.abs(best - n)) best = s
  }
  return best
}

/**
 * 归一化字体档位（非法值回落 `default`）。
 */
export function normalizeFontFamily (value) {
  return FONT_FAMILIES.includes(value) ? value : 'default'
}

/**
 * 属性驱动的排版 CSS（静态，进 `structureCss()`）。
 *
 * ── 为什么用「属性驱动」而不是「按设置生成 CSS」──────────────────────
 *
 * 两点原因：
 *
 * 1. **`--dsh-content-font-size` 会被外壳 presenter 覆盖**。官方文档原文：
 *    presenter 把「the theme's alias tokens and `--dsh-content-font-size`
 *    as **inline variables on body**」。行内样式优先级高于任何普通样式表
 *    规则 —— 所以字号缩放**必须**用 `!important` 才能压过它。
 *    （CSS 优先级：`!important` 的作者样式 > 普通行内样式。）
 *    而 `!important` 只能写在样式表里，写不进「按设置动态生成」的形态。
 *
 * 2. **与既有模式一致**：`data-zf-depth`（材质深度）、`data-zf-motion`
 *    （动效三态）都是「属性驱动 + 静态 CSS」。统一之后客户端只写属性，
 *    样式表只管呈现，两边职责清楚。
 *
 * 字体族本身**不需要** `!important`（外壳不写 `--dsw-font-family` 的行内值），
 * 但放在同一张表里更简单，且能防未来壳改版。
 *
 * 返回的 CSS 不含 `<style>` 标签（与 `structureCss()` 的约定一致）。
 */
export function fontCss () {
  const out = []
  for (const [key, stack] of Object.entries(FONT_STACKS)) {
    // `:root` 与 `body` 都写：实测只写 `body` 时，复合 token
    // （`--dsw-font-base-16` 等 249 处消费）**不会**跟着换 —— 它们在
    // `:root` 求值，而 `:root` 不是 `body` 的后代。见文件头注释的实测表。
    out.push(`html[data-zf-font="${key}"],html[data-zf-font="${key}"] body{`)
    out.push(`  --dsw-font-family:${stack};`)
    out.push('}')
  }
  for (const scale of FONT_SCALES) {
    if (scale === 1) continue
    // 基准 16px 来自外壳（`--dsh-content-font-delta: calc(var(--dsh-content-font-size, 16px) - 16px)`）
    // `!important` 是必需的：presenter 会把 `--dsh-content-font-size` 写成
    // body 的行内样式，普通样式表规则压不过它。
    out.push(`html[data-zf-font-scale="${scale}"] body{`)
    out.push(`  --dsh-content-font-size:calc(16px * ${scale}) !important;`)
    out.push('}')
  }
  return out.join('\n')
}

/**
 * 客户端要写的两个属性（从设置算出）。
 *
 * `default` / `1` 档**返回 null** 表示「不打标记」—— 那两档就是外壳原样，
 * 不打属性可以少一次 DOM 写入，也让「恢复默认」真的回到零覆盖。
 *
 * @param {string} family
 * @param {number} scale
 * @returns {{font: string|null, scale: string|null}}
 */
export function fontAttrs (family, scale) {
  const fam = normalizeFontFamily(family)
  const sc = normalizeFontScale(scale)
  return {
    font: fam === 'default' ? null : fam,
    scale: sc === 1 ? null : String(sc)
  }
}

/*
 * 0.12.0 删除了两个导出：`FONT_LABELS` 与 `SCALE_LABELS`。
 *
 * 它们零调用 —— 档位显示名走的是**客户端 DICT**（`t('font_sans')` /
 * `t('fontScale_0_95')`），因为那两处要跟随宿主 locale，而这里的
 * `{zh, en}` 字面量不走 `locale.bind()`，拿不到外壳当前语言。
 *
 * 留着它们的害处是「两套显示名」的错觉：改这里不会有任何效果。
 */
