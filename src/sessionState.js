/**
 * 会话读数：把宿主事件折成一份「权威快照」（C11）。
 *
 * ── 为什么要有这个模块 ──────────────────────────────────────────────
 * 观测台现在的六个读数（轮 / 步 / tok/s / token 总量 / 缓存命中 / 上下文占比）
 * 与状态点，都是**读 DOM 文字**解析出来的（`readStats` / `readSessionState`）。
 * 那套东西对付过三轮「外壳结构变了」的坑（右栏 pane、左栏内层、输入区座位
 * 都是「读错了层」）。DOM 抓取永远是这个命：外壳一升级就可能读不到。
 *
 * 权威做法是直接订阅宿主事件 —— 它们是 `emit` 模式（观察用，不参与决策链），
 * 且有稳定契约：
 *
 *   'turn/start' {turn} · 'turn/end' {turn, reason:{kind}} · 'step/start' {turn,step}
 *   'assistant/message' {turn, step, usage?: TokenUsage} · 'tool/call' / 'tool/result'
 *   'request/context' {provider, model, contextWindow?}
 *
 * ── 隐私边界（本模块的**全部**输入输出都在这里说清）──────────────────
 * 事件里带消息正文、工具参数、流式文本 —— 这些**一律不读**：
 *   · 只从白名单字段里取数字与枚举（见 `foldEvent` 的 switch）；
 *   · `buildPayload` **逐字段写出**，绝不 `...spread` 事件对象；
 *   · 载荷里没有、也不会有任何正文片段。有测试喂「带正文的事件」并断言
 *     序列化结果里没有正文（不是靠自觉，是靠断言）。
 *
 * 本模块是**纯函数**：不碰 DOM、不碰网络、不 import 宿主包，可以直接被 node
 * 与浏览器半边复用（浏览器那半只有格式化，不参与折叠）。
 */

/** 视为计数的字段（其余一律不看）。 */
const MAX_TURNS = 100000

/** 数值兜底：非有限数一律 0（脏数据不该把读数变成 NaN 显示）。 */
function num (value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 空折叠状态。`usage` 里的四个单位都是 token 数。 */
export function emptyFold () {
  return {
    rev: 0,
    turns: 0,
    steps: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    tokensTotal: 0,
    cacheHit: null,
    lastTurnStart: null,
    lastTurnEnd: null,
    lastReason: null,
    openTools: 0,
    contextWindow: null,
    provider: null,
    model: null
  }
}

/**
 * 折一个事件（就地修改并返回同一个对象 —— 调用方持有它，避免每事件分配）。
 *
 * **白名单**：只认下面这几种事件类型；其余（含所有带正文的）直接返回，
 * 连字段都不读。
 */
export function foldEvent (fold, event) {
  if (fold === null || typeof fold !== 'object') return fold
  if (event === null || typeof event !== 'object') return fold
  const type = event.type
  const data = event.data
  if (typeof type !== 'string' || data === null || typeof data !== 'object') return fold

  // 日志位置：取最大值（重放/分叉时可能乱序到达）
  if (typeof event.seq === 'number' && Number.isFinite(event.seq)) {
    fold.rev = Math.max(fold.rev, event.seq)
  }

  switch (type) {
    case 'turn/start': {
      const turn = num(data.turn)
      if (turn > 0 && turn < MAX_TURNS) fold.turns = Math.max(fold.turns, turn)
      if (typeof event.time === 'number' && Number.isFinite(event.time)) fold.lastTurnStart = event.time
      return fold
    }
    case 'turn/end': {
      const kind = data.reason !== null && typeof data.reason === 'object' ? data.reason.kind : null
      fold.lastReason = typeof kind === 'string' ? kind : null
      if (typeof event.time === 'number' && Number.isFinite(event.time)) fold.lastTurnEnd = event.time
      return fold
    }
    case 'step/start': {
      fold.steps += 1
      return fold
    }
    case 'assistant/message': {
      addUsage(fold, data.usage)
      return fold
    }
    case 'tool/call': {
      fold.openTools += 1
      return fold
    }
    case 'tool/result': {
      fold.openTools = Math.max(0, fold.openTools - 1)
      return fold
    }
    case 'request/context': {
      const window = num(data.contextWindow)
      fold.contextWindow = window > 0 ? window : null
      if (typeof data.provider === 'string') fold.provider = data.provider
      if (typeof data.model === 'string') fold.model = data.model
      return fold
    }
    default:
      return fold
  }
}

/**
 * 累加一次模型用量。**只读 TokenUsage 的五个数字**。
 *
 * 缓存命中率 = `cacheRead / (input + cacheRead)`：
 * provider 报的 `inputTokens` 通常不含缓存读，两者相加才是真实的提示规模。
 * 两头都是 0（provider 没报）→ `null`（客户端那一格回退 DOM 读数）。
 */
function addUsage (fold, usage) {
  if (usage === null || typeof usage !== 'object') return
  const input = num(usage.inputTokens)
  const output = num(usage.outputTokens)
  const cacheRead = num(usage.cacheReadTokens)
  const cacheWrite = num(usage.cacheWriteTokens)
  const total = num(usage.totalTokens) || (input + output + cacheRead + cacheWrite)
  fold.usage.input += input
  fold.usage.output += output
  fold.usage.cacheRead += cacheRead
  fold.usage.cacheWrite += cacheWrite
  fold.usage.total += total
  fold.tokensTotal += total
  const prompt = fold.usage.input + fold.usage.cacheRead
  fold.cacheHit = prompt > 0 ? fold.usage.cacheRead / prompt : null
}

/** 折一整段日志（连接时的一次性回填）。 */
export function foldEvents (events, fold = emptyFold()) {
  if (Array.isArray(events) !== true) return fold
  for (const event of events) foldEvent(fold, event)
  return fold
}

/**
 * 会话状态 —— 与客户端 DOM 判定的那套枚举**同名同义**，这样两条路径可以互换：
 *   `idle`（没轮次）/ `ready`（有轮次但没结束标记）/ `running` / `tool` /
 *   `stopped`（中断、取消、被策略挡住）/ `done`（正常结束）/ `error`（报错、超长）
 */
export function deriveState (fold, running) {
  if (fold === null || typeof fold !== 'object') return 'idle'
  if (fold.openTools > 0) return 'tool'
  if (running === true) return 'running'
  if (fold.turns === 0) return 'idle'
  switch (fold.lastReason) {
    case 'error':
    case 'max-tokens':
      return 'error'
    case 'aborted':
    case 'interrupted':
    case 'blocked':
      return 'stopped'
    case 'completed':
    case 'forked':
      return 'done'
    default:
      // 有轮次但还没写 turn/end：回合开着（等同 DOM 那套的 ready）
      return fold.lastTurnEnd !== null ? 'done' : 'ready'
  }
}

/**
 * 组装载荷 —— **逐字段写出**，这是隐私白名单的实现。
 *
 * 只包含：数字读数、状态枚举、模型名、日志位置、是否运行中。
 * 任何正文 / 参数 / 文件名都不在字段表里（想加字段必须先想清楚它是不是内容）。
 *
 * ── `source` 必须反映**这份数字是不是真的来自宿主** ──────────────────
 *
 * 早先这里写死 `source: 'host'`，于是「会话不在宿主」时也报 `host` ——
 * 而那份载荷的每个数字都是 `emptyFold()` 的**占位 0**，不是宿主的真实读数。
 *
 * SSE 那条路没事：会话不在宿主时宿主发 `hello(live:false)` + `unavailable`，
 * 客户端会把载荷置空。但 `?once=1` 是**轮询退路**（载体不吃流式时改用它），
 * 那条路没有 `unavailable` 帧 —— 轮询的客户端只会看到 `source:'host'` 与
 * 一串 0，于是把「0 轮 / 0 步」当成权威读数显示，而不是回退 DOM。
 *
 * 所以：`live !== true` → `source: 'none'`，明确表示「这份数字不是宿主的」。
 * 客户端据此回退（`formatStats` 的字段级回退本来就是按 null 走的）。
 */
export function buildPayload ({ fold, state, contextUsed = null, rate = null, sessionId = null, live = true }) {
  const f = fold ?? emptyFold()
  return {
    v: 1,
    session: typeof sessionId === 'string' ? sessionId : null,
    live: live === true,
    rev: num(f.rev),
    state: typeof state === 'string' ? state : 'idle',
    turns: num(f.turns),
    steps: num(f.steps),
    usage: {
      input: num(f.usage?.input),
      output: num(f.usage?.output),
      cacheRead: num(f.usage?.cacheRead),
      cacheWrite: num(f.usage?.cacheWrite),
      total: num(f.usage?.total)
    },
    tokensTotal: num(f.tokensTotal),
    cacheHit: typeof f.cacheHit === 'number' && Number.isFinite(f.cacheHit) ? f.cacheHit : null,
    rate: typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 ? rate : null,
    context: { used: typeof contextUsed === 'number' && Number.isFinite(contextUsed) ? contextUsed : null },
    model: typeof f.model === 'string' ? f.model : null,
    turnStartedAt: typeof f.lastTurnStart === 'number' ? f.lastTurnStart : null,
    // 只有**会话确实在宿主**时这份数字才是权威的（见上方注释）
    source: live === true ? 'host' : 'none'
  }
}

/**
 * 上下文占比 = 当前表面 token ÷ 模型上下文窗口。
 * 任一缺失 → `null`（客户端那一格回退 DOM）。
 */
export function contextUsedOf (surfaceTokens, contextWindow) {
  const used = num(surfaceTokens)
  const window = num(contextWindow)
  if (used <= 0 || window <= 0) return null
  return Math.min(1, used / window)
}

/**
 * tok/s：**我们自己**按滑窗算的输出速率（外壳那个数字是它自己算的，我们复现不了
 * 它的口径）。窗口内没有新增输出 → `null`（不假装有读数）。
 *
 * @param {Array<{time:number,tokens:number}>} samples 只保留窗口内的时间点
 * @param {number} windowMs 滑窗长度
 */
export function rateOf (samples, windowMs = 10000) {
  if (Array.isArray(samples) !== true || samples.length === 0) return null
  const now = samples[samples.length - 1].time
  const first = samples.find(s => now - s.time <= windowMs)
  if (first === undefined) return null
  const span = now - first.time
  if (span <= 0) return null
  const gained = samples[samples.length - 1].tokens - first.tokens
  if (gained <= 0) return null
  return Math.round(gained / (span / 1000))
}
