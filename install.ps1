# 庄方宜主题 · 安装器
#
# 从本目录（发行 ZIP 解压处或仓库根）把插件装进 DSH profile。
#
# 用法：
#   .\install.ps1 -CheckOnly                  # 只校验本包完整性与目标可写
#   .\install.ps1                             # 装进默认 profile（desktop）
#   .\install.ps1 -DshHome 'D:\MyDshData'     # 独立数据目录（不是 electron user-data-dir）
#   .\install.ps1 -ProfileName web            # 装进别的 profile
#   .\install.ps1 -DshPath 'D:\dsh'           # 附带校验 DSH 安装目录存在（可选）
#
# 行为（对标 Mornye 的安装器，全部只写 DSH 数据目录）：
#   1. 备份 profile 的 package.json **原始字节** → .zf-theme-install-state.json
#      （base64；卸载时用它做字节级还原判断）；
#   2. 先删旧插件目录（**拒绝符号链接/联接**，防误删链接目标）再拷贝；
#   3. 给装好的 index.js 打构建标记（/diag 可对版）；
#   4. 幂等更新 package.json：依赖 + dsh.profile.bundles 条目（无 BOM 写回）。
#
# 不碰：cordis.patch.yml（profile 级）、凭据、模型配置、人格提示词、会话。
# 建议：安装前**完全退出 DSH**（含托盘），装完再启动。

[CmdletBinding()]
param(
  [string]$DshHome,
  [string]$DshPath,
  [string]$ProfileName = 'desktop',
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot

# ── 清单（与 tools/package.ps1 同源，两处同步维护）───────────────────────
$RootFiles = @(
  'index.js', 'client.js', 'package.json', 'cordis.patch.yml',
  'README.md', 'PRIVACY.md', 'ASSETS-NOTICE.md'
)
$Dirs = @('src', 'art')
$DocFiles = @('docs/双壳适配说明.md')

# ── 路径解析 ──────────────────────────────────────────────────────────────
if (-not $DshHome) { $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' } }
$ProfileDir = Join-Path $DshHome "profiles\$ProfileName"
$PkgJson = Join-Path $ProfileDir 'package.json'
$StateFile = Join-Path $ProfileDir '.zf-theme-install-state.json'
$Dst = Join-Path $ProfileDir 'node_modules\dsh-zhuang-fangyi'

# ── 1. 本包完整性（CheckOnly 也查）───────────────────────────────────────
$missing = @()
foreach ($f in $RootFiles + $DocFiles) {
  if (-not (Test-Path (Join-Path $Here $f))) { $missing += $f }
}
foreach ($d in $Dirs) {
  if (-not (Test-Path (Join-Path $Here $d))) { $missing += $d }
}
# 版本读取（来自包内 package.json）
$pkg = Get-Content (Join-Path $Here 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json

Write-Host "包:     $Here  (dsh-zhuang-fangyi $($pkg.version))"
Write-Host "目标:   $ProfileDir"

if ($missing.Count -gt 0) {
  Write-Host ('本包不完整，缺失：' + ($missing -join ', ')) -ForegroundColor Red
  exit 1
}

# ── 2. 目标可写性 ────────────────────────────────────────────────────────
$ok = $true
if (-not (Test-Path $ProfileDir)) { Write-Host "  profile 不存在（先启动一次 DSH 初始化）" -ForegroundColor Red; $ok = $false }
if (-not (Test-Path $PkgJson)) { Write-Host "  profile package.json 不存在" -ForegroundColor Red; $ok = $false }
if ($DshPath) {
  if (Test-Path $DshPath) { Write-Host "  DshPath: $DshPath ✓" }
  else { Write-Host "  DshPath 不存在（仅提醒，安装不依赖它）: $DshPath" -ForegroundColor Yellow }
}
if ($CheckOnly) {
  Write-Host ('包完整性: OK  目标: ' + $(if ($ok) { 'OK' } else { '不可用' })) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
  if (-not (Test-Path $Dst)) { Write-Host '  当前未安装此插件（安装是全新写入）' }
  else { Write-Host "  检测到已安装：$Dst（将被覆盖更新）" }
  exit $(if ($ok) { 0 } else { 1 })
}
if (-not $ok) { exit 1 }

# ── 3. 备份 profile package.json 原始字节 ────────────────────────────────
$pkgBytes = [System.IO.File]::ReadAllBytes($PkgJson)
$state = [ordered]@{
  installedAt    = (Get-Date).ToString('o')
  plugin         = 'dsh-zhuang-fangyi'
  version        = "$($pkg.version)"
  packageJsonB64 = [Convert]::ToBase64String($pkgBytes)
}
# JSON UTF-8 无 BOM
[System.IO.File]::WriteAllText($StateFile,
  ($state | ConvertTo-Json -Depth 5),
  (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  已备份 package.json 原始字节 → $(Split-Path $StateFile -Leaf)"

# ── 4. 写插件目录（先删后拷，拒绝符号链接）───────────────────────────────
if (Test-Path $Dst) {
  $item = Get-Item $Dst -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    Write-Host "  拒绝删除：$Dst 是符号链接/联接（请用插件管理器或人工检查链接目标）" -ForegroundColor Red
    exit 1
  }
  Remove-Item $Dst -Recurse -Force
  Write-Host '  已移除旧插件目录'
}
New-Item -ItemType Directory -Path $Dst | Out-Null
foreach ($f in $RootFiles) { Copy-Item (Join-Path $Here $f) (Join-Path $Dst $f) -Force }
foreach ($d in $Dirs) { Copy-Item (Join-Path $Here $d) (Join-Path $Dst $d) -Recurse -Force }
foreach ($f in $DocFiles) {
  $to = Join-Path $Dst $f
  New-Item -ItemType Directory -Path (Split-Path $to) -Force | Out-Null
  Copy-Item (Join-Path $Here $f) $to -Force
}
$n = (Get-ChildItem $Dst -Recurse -File).Count
Write-Host "  插件文件：$n 个"

# ── 5. 包内构建标记 ──────────────────────────────────────────────────────
$indexPath = Join-Path $Dst 'index.js'
$indexText = [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8)
if ($indexText.Contains("'__ZF_BUILD__'")) {
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $indexText = $indexText.Replace("'__ZF_BUILD__'", "'$stamp'")
  [System.IO.File]::WriteAllText($indexPath, $indexText, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "  构建标记                $stamp"
}

# ── 6. 幂等更新 profile package.json（依赖 + bundle）─────────────────────
$raw = [System.IO.File]::ReadAllText($PkgJson, [System.Text.Encoding]::UTF8)
$pj = $raw | ConvertFrom-Json
$changed = $false

if ($null -eq $pj.PSObject.Properties['dependencies']) {
  $pj | Add-Member -NotePropertyName dependencies -NotePropertyValue ([ordered]@{})
}
if ($pj.dependencies.PSObject.Properties[$pkg.name]) {
  if ($pj.dependencies."$($pkg.name)" -ne "file:./node_modules/$($pkg.name)") {
    $pj.dependencies."$($pkg.name)" = "file:./node_modules/$($pkg.name)"; $changed = $true
  }
} else {
  $pj.dependencies | Add-Member -NotePropertyName $pkg.name -NotePropertyValue "file:./node_modules/$($pkg.name)"
  $changed = $true
}

if ($null -eq $pj.PSObject.Properties['dsh']) {
  $pj | Add-Member -NotePropertyName dsh -NotePropertyValue ([ordered]@{})
}
if ($null -eq $pj.dsh.PSObject.Properties['profile']) {
  $pj.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([ordered]@{})
}
if ($null -eq $pj.dsh.profile.PSObject.Properties['bundles']) {
  $pj.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @()
}
$bundles = @($pj.dsh.profile.bundles)
if ($bundles -notcontains $pkg.name) {
  $pj.dsh.profile.bundles = @($bundles) + @($pkg.name)
  $changed = $true
}

if ($changed) {
  [System.IO.File]::WriteAllText($PkgJson,
    (($pj | ConvertTo-Json -Depth 20) + "`n"),
    (New-Object System.Text.UTF8Encoding($false)))   # Node 读，必须无 BOM
  Write-Host '  package.json 已更新（依赖 + bundles）'
} else {
  Write-Host '  package.json 无需变化（幂等）'
}

Write-Host ''
Write-Host '安装完成。请完全退出并重启 DSH。' -ForegroundColor Green
Write-Host '验收：'
Write-Host '  Invoke-WebRequest http://127.0.0.1:19387/api/zhuang-fangyi/themes | % Content'
Write-Host '  （build 应与本次安装时间一致；观测台设置见「设置 → 庄方宜」）'
