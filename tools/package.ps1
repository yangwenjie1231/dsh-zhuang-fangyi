# 庄方宜主题 · 打发行包
#
# 用法：
#   .\tools\package.ps1              # 先跑全部测试，再打包到 dist/
#   .\tools\package.ps1 -SkipTests   # 跳过测试（不推荐）
#
# 产物：
#   dist/dsh-zhuang-fangyi-<version>.zip           按**明确文件清单**打包
#   dist/dsh-zhuang-fangyi-<version>.zip.sha256    ZIP 本体的校验
#   ZIP 内 SHA256SUMS.txt                          包内逐文件校验
#
# 设计（对标 Mornye 的发行做法）：
#   · 明确清单 —— 不递归收集，绝不把 .git / dist / 工作草稿带进包；
#   · 包内构建标记 —— 把 '__ZF_BUILD__' 打成时间戳，装完 /diag 即可对版；
#   · 无 BOM 的 UTF-8 文本原样拷贝（package.json 会被 Node 读，BOM 会炸）。

[CmdletBinding()]
param(
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'

$Src = Split-Path -Parent $PSScriptRoot
Set-Location $Src

# ── 版本与清单 ────────────────────────────────────────────────────────────
$pkg = Get-Content (Join-Path $Src 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Ver = $pkg.version
if ([string]::IsNullOrWhiteSpace($Ver)) { throw 'package.json 缺少 version' }

# 发布清单**从 package.json 的 files 字段推导**，再加包装层自带的东西。
#
# ⚠️ 这里原来是手抄的清单，注释写着「与 files 字段保持同源」—— 但手抄的从来不会
# 同源：0.4.0 给 package.json 加了 `LICENSE`，这份清单没跟着加，于是 0.4.x 的
# ZIP **一直缺 LICENSE**（MIT 授权的包不带授权文本）。直到建 Release 前逐文件
# 比对才发现。现在改成推导，并加了「files 里每一项都必须真的进包」的校验。
$pkgFiles = @($pkg.files)
$Dirs = @($pkgFiles | Where-Object { Test-Path (Join-Path $Src $_) -PathType Container })
$RootFiles = @($pkgFiles | Where-Object { Test-Path (Join-Path $Src $_) -PathType Leaf })
# 包装层自带（不进 package.json 的 files —— 它们是给 ZIP 解压后用的）
$RootFiles += @('package.json', 'install.ps1', 'uninstall.ps1')
$DocFiles = @('docs/双壳适配说明.md')

# ── 0. 测试（跳过打包前的测试 = 发布事故，所以默认强制）───────────────────
if (-not $SkipTests) {
  Write-Host '测试：语法 + 对比度 + 无头测试…'
  $node = if (Get-Command node -ErrorAction SilentlyContinue) { 'node' } else { throw '找不到 node' }
  & $node --check index.js
  & $node --check client.js
  & $node src/contrast.js
  if ($LASTEXITCODE -ne 0) { throw '对比度断言失败，打包中止' }
  & $node tools/test-client.mjs
  if ($LASTEXITCODE -ne 0) { throw '无头测试失败，打包中止' }
}

# ── 1. 暂存（只拷清单内文件）──────────────────────────────────────────────
$Stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$StageName = "zf-pkg-$Stamp"
$Stage = Join-Path ([System.IO.Path]::GetTempPath()) $StageName
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage | Out-Null

foreach ($f in $RootFiles) {
  $from = Join-Path $Src $f
  if (-not (Test-Path $from)) { throw "清单文件缺失：$f（源里没有，清单或文件必须同步）" }
  Copy-Item $from (Join-Path $Stage $f) -Force
}
foreach ($d in $Dirs) {
  $from = Join-Path $Src $d
  if (-not (Test-Path $from)) { throw "清单目录缺失：$d" }
  Copy-Item $from (Join-Path $Stage $d) -Recurse -Force
}
foreach ($f in $DocFiles) {
  $from = Join-Path $Src $f
  if (-not (Test-Path $from)) { throw "清单文档缺失：$f" }
  $to = Join-Path $Stage $f
  New-Item -ItemType Directory -Path (Split-Path $to) -Force | Out-Null
  Copy-Item $from $to -Force
}

# ── 1a. 产物级校验：package.json 的 files 每一项都必须真的落到暂存目录 ────
#
# 查的是**产物**，不是源码里的清单文本 —— 文本写对了但复制逻辑漏了，文本断言
# 照样通过。这一条才是「声明 = 事实」的落点。
$missingInStage = @()
foreach ($f in $pkgFiles) {
  if (-not (Test-Path (Join-Path $Stage $f))) { $missingInStage += $f }
}
if ($missingInStage.Count -gt 0) {
  throw "package.json 的 files 声明了但没进包：$($missingInStage -join ', ')"
}
Write-Host "  files 声明 $($pkgFiles.Count) 项，全部已进包"

# ── 1b. 剔除空目录（工作区可能有预留占位，如 art/icons/；发行包只收内容）
$empty = Get-ChildItem $Stage -Recurse -Directory | Where-Object {
  @(Get-ChildItem $_.FullName -Recurse -File).Count -eq 0
} | Sort-Object FullName -Descending
foreach ($e in $empty) {
  Remove-Item $e.FullName -Force -Recurse
  Write-Host "  跳过空目录              $($e.FullName.Substring($Stage.Length + 1))"
}

# ── 2. 包内打构建标记（装完 /diag 就能对版）──────────────────────────────
$indexPath = Join-Path $Stage 'index.js'
$indexText = [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8)
if ($indexText.Contains("'__ZF_BUILD__'")) {
  $indexText = $indexText.Replace("'__ZF_BUILD__'", "'$Stamp'")
  [System.IO.File]::WriteAllText($indexPath, $indexText, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "  构建标记（包内）      $Stamp"
} else {
  Write-Warning 'index.js 里没有 __ZF_BUILD__ 占位符（已打过标？）'
}

# ── 3. 包内 SHA256SUMS.txt（逐文件）───────────────────────────────────────
$sb = New-Object System.Text.StringBuilder
Get-ChildItem $Stage -Recurse -File | Sort-Object FullName | ForEach-Object {
  $rel = $_.FullName.Substring($Stage.Length + 1).Replace('\', '/')
  $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  [void]$sb.AppendLine("$hash  $rel")
}
$sumsPath = Join-Path $Stage 'SHA256SUMS.txt'
[System.IO.File]::WriteAllText($sumsPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))

# ── 4. ZIP + ZIP 校验 ─────────────────────────────────────────────────────
$Dist = Join-Path $Src 'dist'
New-Item -ItemType Directory -Path $Dist -Force | Out-Null
$zipPath = Join-Path $Dist "dsh-zhuang-fangyi-$Ver.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
# 显式清单：把暂存目录**内容**（不带外层目录）压进去，解压即得 install.ps1
$stageItems = Get-ChildItem $Stage
Compress-Archive -Path ($stageItems.FullName) -DestinationPath $zipPath -CompressionLevel Optimal

$zipHash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText("$zipPath.sha256", "$zipHash  $(Split-Path $zipPath -Leaf)`n",
  (New-Object System.Text.UTF8Encoding($false)))

Remove-Item $Stage -Recurse -Force

$fileCount = (Get-ChildItem $Dist -File).Count
Write-Host ''
Write-Host "打完：$zipPath" -ForegroundColor Green
Write-Host "  SHA256: $zipHash"
Write-Host "  同目录 .zip.sha256；包内含 SHA256SUMS.txt"
Write-Host "  dist/ 目录共 $fileCount 个文件（不进 git）"
