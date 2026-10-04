# 庄方宜主题 · 部署到 DSH profile
#
# 用法：
#   pwsh -File tools/deploy.ps1              # 部署到默认 profile（desktop）
#   pwsh -File tools/deploy.ps1 -Profile web
#   pwsh -File tools/deploy.ps1 -DryRun      # 只看会做什么
#
# 为什么需要脚本而不是一句 Copy-Item：
#
#   `Copy-Item -Recurse 源目录 已存在的目标目录` **不会合并**，而是在目标下
#   再建一层同名目录（`art\` → `art\art\`）。旧的同名文件留在原地不动，
#   于是「部署成功」但页面跑的还是旧代码 —— 实测踩过这个坑：头像改了却
#   没生效，因为真正被读的 `art\avatar.webp` 还是 16:39 的旧文件。
#
#   所以这里显式做三件事：先删旧目录再整体复制、复制后逐文件校验大小、
#   最后打印清单让人能一眼看出是否真的更新了。

[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$Src = Split-Path -Parent $PSScriptRoot          # dsh-zhuang-fangyi\
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$Dst = Join-Path $DshHome "profiles\$Profile\node_modules\dsh-zhuang-fangyi"

# 顶层文件与目录（与 package.json 的 files 字段一致）
$Files = @('index.js', 'client.js', 'package.json', 'cordis.patch.yml', 'README.md')
$Dirs = @('src', 'tools', 'docs', 'art')

Write-Host "源:   $Src"
Write-Host "目标: $Dst"
Write-Host ''

if (-not (Test-Path $Dst)) {
  throw "目标不存在：$Dst`n请先确认插件已安装到该 profile。"
}

if ($DryRun) {
  Write-Host '[DryRun] 将执行：'
  foreach ($d in $Dirs) { Write-Host "  删除并重建 $d\" }
  foreach ($f in $Files) { Write-Host "  覆盖 $f" }
  exit 0
}

# ── 1. 目录：先删后建，避免嵌套与残留 ─────────────────────────────────────
foreach ($d in $Dirs) {
  $from = Join-Path $Src $d
  if (-not (Test-Path $from)) { Write-Host "  跳过 $d\（源不存在）"; continue }
  $to = Join-Path $Dst $d
  if (Test-Path $to) { Remove-Item $to -Recurse -Force }
  Copy-Item $from $to -Recurse -Force
  $n = (Get-ChildItem $to -Recurse -File).Count
  Write-Host ("  {0,-8} {1,3} 个文件" -f "$d\", $n)
}

# ── 2. 顶层文件 ──────────────────────────────────────────────────────────
foreach ($f in $Files) {
  $from = Join-Path $Src $f
  if (-not (Test-Path $from)) { Write-Host "  跳过 $f（源不存在）"; continue }
  Copy-Item $from (Join-Path $Dst $f) -Force
  Write-Host ("  {0,-22} {1,8} B" -f $f, (Get-Item (Join-Path $Dst $f)).Length)
}

# ── 2b. 打构建标记 ───────────────────────────────────────────────────────
# 宿主进程缓存 ESM 模块：disable → enable 只重跑 apply()，**不会**重新 import
# src/*.js。所以在 index.js 里写一个时间戳标记，之后用
#   GET /api/zhuang-fangyi/themes  ->  {"build":"..."}
# 就能确认运行中的进程跑的是哪一版；标记不匹配说明需要重启宿主。
$indexPath = Join-Path $Dst 'index.js'
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$indexText = [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8)
if ($indexText.Contains("'__ZF_BUILD__'")) {
  $indexText = $indexText.Replace("'__ZF_BUILD__'", "'$stamp'")
  [System.IO.File]::WriteAllText($indexPath, $indexText, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "  构建标记                 $stamp"
} else {
  Write-Host "  警告：index.js 里没有 __ZF_BUILD__ 占位符，跳过打标" -ForegroundColor Yellow
}

# ── 3. 校验：源与目标逐文件比对大小 ──────────────────────────────────────
# index.js 例外：部署时写了构建标记（时间戳替换占位符），长度必然不同，
# 所以跳过它，只校验其余文件。
Write-Host "`n校验（源 vs 目标）："
$bad = 0
foreach ($rel in @($Files | Where-Object { $_ -ne 'index.js' }) + @($Dirs | ForEach-Object { Get-ChildItem (Join-Path $Src $_) -Recurse -File })) {
  $relPath = if ($rel -is [string]) { $rel } else { $rel.FullName.Substring($Src.Length + 1) }
  $a = Join-Path $Src $relPath
  $b = Join-Path $Dst $relPath
  if (-not (Test-Path $a)) { continue }
  if (-not (Test-Path $b)) {
    Write-Host "  缺失 $relPath" -ForegroundColor Red
    $bad++
    continue
  }
  if ((Get-Item $a).Length -ne (Get-Item $b).Length) {
    Write-Host ("  大小不符 {0}（源 {1} / 目标 {2}）" -f $relPath, (Get-Item $a).Length, (Get-Item $b).Length) -ForegroundColor Red
    $bad++
  }
}

# 残留的嵌套目录是上一次错误复制的痕迹，必须清掉
foreach ($d in $Dirs) {
  $nested = Join-Path (Join-Path $Dst $d) $d
  if (Test-Path $nested) {
    Write-Host "  清除嵌套目录 $d\$d\" -ForegroundColor Yellow
    Remove-Item $nested -Recurse -Force
  }
}

if ($bad -gt 0) {
  Write-Host "`n校验失败：$bad 个文件不一致" -ForegroundColor Red
  exit 1
}

Write-Host "`n部署完成，全部一致。" -ForegroundColor Green
Write-Host "重载插件：plugin_manager set_plugin target=include:zhuang-fangyi enabled=false → true"
