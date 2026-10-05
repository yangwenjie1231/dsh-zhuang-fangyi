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

# 与 package.json 的 files 字段保持同源的发布清单（+ 文档 + 安装脚本）
$RootFiles = @(
  'index.js', 'client.js', 'package.json', 'cordis.patch.yml',
  'README.md', 'PRIVACY.md', 'ASSETS-NOTICE.md',
  'install.ps1', 'uninstall.ps1'
)
$Dirs = @('src', 'art')
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
