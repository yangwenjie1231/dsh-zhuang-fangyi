# 发行清单（Release checklist）

面向分发渠道的准备清单。**未完成项一律标 ⏳ 并写明缺什么** —— 不假装就绪。

## 渠道与状态

| 渠道 | 命令 / 方式 | 状态 |
|---|---|---|
| **GitHub 直装** | `dsh plugin --profile desktop add github:yangwenjie1231/dsh-zhuang-fangyi` | ✅ **已可用**（仓库已公开、CI 全绿、clone 后素材齐全） |
| **GitHub Release** | <https://github.com/yangwenjie1231/dsh-zhuang-fangyi/releases> | ✅ **v0.4.2 已发布**（附 ZIP + `.sha256`，标 latest） |
| **awesome-dsh-plugin** | PR 往列表仓加 `data/plugins/<owner>__dsh-zhuang-fangyi.yml` | ✅ 投稿文件已备（`submission/`），⏳ 需仓库满 1 天 |
| **dsh-market 社区索引** | PR 往 `zhu1090093659/dsh-community-plugins` 的 `community.json` 追加一条 | ⏳ 未投稿 |
| **OMDSH Hub** | `package.json#dshWorkshop` + 钉 40 位 commit 的投稿 Issue | ✅ `dshWorkshop` 已就位并通过自检，⏳ 未投稿 |
| **npm** | `npm publish` | ⏳ 需账号与授权（`publishConfig.access: public` 已就位） |
| **本地 ZIP** | `.\tools\package.ps1` | ✅ 已可用（含 SHA256SUMS + 构建标记） |

## 已完成

- ✅ `dsh.bundle.patch` + `dsh.client` 都在（市场明确拒绝「只声明 dsh.client」的包）
- ✅ 零运行时依赖（`dependencies: {}`）
- ✅ 无安装期脚本（`preinstall`/`install`/`postinstall`/`prepare` 都没有）→ 不需要 `allowBuilds` 授权
- ✅ `LICENSE` 文件（MIT，含素材权利说明指向 `ASSETS-NOTICE.md`）
- ✅ `dshWorkshop` 清单（`omdsh-workshop-package/v1`，权限逐条有真实证据）
- ✅ `dsh.engines.dsh = >=0.2.0-rc.2`（只声明实测过的版本，不猜）
- ✅ `files` 白名单（含 `LICENSE`）
- ✅ CI（语法 + 对比度 + 无头测试 + 清单自检）
- ✅ `tools/check-manifest.mjs` 自检（38 项，防「声明与事实脱节」）
- ✅ `CHANGELOG.md`（0.2.0 起逐版记录；自检会校验「当前版本有带日期的条目」，
      防止改了 `version` 忘记写日志）
- ✅ **发布清单从 `package.json#files` 派生**（`tools/package.ps1` 与 `install.ps1`）
      —— 自检会断言这两处**没有**改回手写
- ✅ `submission/` 投稿文件

> **踩过的坑（发布清单手抄）**：`tools/package.ps1` 与 `install.ps1` 各自手抄了
> 一份文件清单，注释还写着「两处同步维护」。0.4.0 给 `files` 加了 `LICENSE`、
> 0.4.2 加了 `CHANGELOG.md`，两份清单都没跟上 —— 于是**发行 ZIP 与装出来的
> profile 目录一直没有 `LICENSE`**（MIT 要求随分发提供授权文本），直到建
> Release 前逐文件比对才发现。两处已改为派生，并加了闸门（`check-manifest.mjs`
> 第 9 组）与产物级断言（打包后逐项确认 `files` 的每一项都真的进了包）。
> 教训：**同一份信息抄两遍，就一定会漂移**。

## ⏳ 待办（需要用户操作或授权）

### 1. ~~推 GitHub~~ ✅ 已完成

仓库已公开：**https://github.com/yangwenjie1231/dsh-zhuang-fangyi**

- ✅ topics 已加（含索引站硬要求的 `dsh-plugin`）
- ✅ `package.json` 的三个地址占位已替换为真实地址
- ✅ CI 全绿
- ✅ 真实安装验证：clone 到临时目录后素材齐全，且副本内独立跑通全部测试

> **踩过的坑**：推送 `.github/workflows/` 下的文件需要 token 具备 `workflow`
> scope —— GitHub 会直接拒绝：
> `refusing to allow an OAuth App to create or update workflow ... without workflow scope`。
> 解决：`gh auth refresh -h github.com -s workflow`（需浏览器输入一次性代码）。
> 当时为不阻塞进度先把 CI 放到 `docs/ci/`，拿到 scope 后移回标准位置。

### 2. 截图（`screenshots.json`）

**当前故意不提供** —— 我尝试用 Edge headless 自动截图，失败（DSH 有认证：
`dsh web authentication required`）。**宁可没有，也不要声明不存在的文件**（市场会显示坏图）。

需要**你手动截图**后放进 `docs/screenshots/`，再建 `screenshots.json`。建议 6 张：

| 文件名 | 内容 |
|---|---|
| `01-light-preset.png` | 浅色 · 本体黄绿（明亮轻盈） |
| `02-dark-preset.png` | 深色 · 大招墨青金（厚重深沉） |
| `03-settings.png` | 设置 → 庄方宜（风格预设 / 强调色色相 / 排版 / 动效三态） |
| `04-observation-rail.png` | 观测台六卡读数 + 运行耗时 |
| `05-splash.png` | 启动动效（干员立绘入场） |
| `06-boot-card.png` | 官方开机卡片套主题色 |

格式（1–8 张，相对路径，不能含 `..`）：

```json
{
  "screenshots": [
    { "file": "docs/screenshots/01-light-preset.png", "caption": "浅色 · 本体黄绿" }
  ]
}
```

### 3. OMDSH Hub 投稿

推完仓库后，用**完整 40 位 commit** 生成清单并开 Issue。注意（550c 踩过的坑）：

- `install.adapter` 必须是 **`profile-bundle`**（写 `harness-profile` 会被判
  `adapter does not match the integration protocol`）—— 我们已写对，有自检
- 投稿必须钉在**公开远端已有的完整 commit** 上（不能是本地未推的）

### 4. npm 发布（可选，但市场「按包名安装」需要）

需要 npm 账号 + 2FA 处理。发布前确认 `yangwenjie1231` 已替换、README 里的
**仓库相对链接**换成绝对 URL（npmjs 不提供仓库文件，相对链接会 404）。

## 自检命令

```powershell
node tools/check-manifest.mjs    # 发行清单与仓库事实一致性（38 项）
node src/contrast.js             # 392 对比度 + 672 色相扫描
node tools/test-client.mjs       # 1091 无头测试（无 Edge 的环境 1026 项）
.\tools\package.ps1              # 打 ZIP（含 SHA256SUMS + 构建标记）
```
