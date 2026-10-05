# 庄方宜主题 · 卸载器
#
# 用法：
#   .\uninstall.ps1 -DryRun                 # 只打印将做什么
#   .\uninstall.ps1                         # 卸载默认 profile（desktop）
#   .\uninstall.ps1 -DshHome 'D:\MyDshData'
#
# 行为（对标 Mornye 的字节级还原）：
#   1. 读 .zf-theme-install-state.json 里**安装前的 package.json 原始字节**；
#   2. 把当前 profile package.json 去掉本插件的依赖与 bundle 条目：
#        · 若结果与安装前内容一致 → **直接写回原始字节**（字节级还原，
#          注释/格式/键序全保留）；
#        · 若之后装过别的插件 → 只移除本插件的两个条目，保留其它改动；
#   3. 删除插件目录 —— **拒绝符号链接**（先看是不是 reparse point，
#      是则拒绝并提示，绝不递归删除链接目标）；
#   4. 删除状态文件。
#
# 不碰：cordis.patch.yml、凭据、模型配置、人格提示词、会话。

[CmdletBinding()]
param(
  [string]$DshHome,
  [string]$ProfileName = 'desktop',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$PluginName = 'dsh-zhuang-fangyi'

if (-not $DshHome) { $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' } }
$ProfileDir = Join-Path $DshHome "profiles\$ProfileName"
$PkgJson = Join-Path $ProfileDir 'package.json'
$StateFile = Join-Path $ProfileDir '.zf-theme-install-state.json'
$Dst = Join-Path $ProfileDir "node_modules\$PluginName"

if (-not (Test-Path $ProfileDir)) { Write-Host "profile 不存在：$ProfileDir" -ForegroundColor Red; exit 1 }

Write-Host "目标: $ProfileDir"

# ── 1. package.json：算出去掉我们条目后的形态 ────────────────────────────
$plan = 'no-package-json'
$origBytes = $null
if (Test-Path $PkgJson) {
  $currentText = [System.IO.File]::ReadAllText($PkgJson, [System.Text.Encoding]::UTF8)
  $pj = $currentText | ConvertFrom-Json

  # 移除依赖
  $depExists = $null -ne $pj.PSObject.Properties['dependencies'] -and
    $null -ne $pj.dependencies.PSObject.Properties[$PluginName]
  # 移除 bundle
  $bundles = @()
  if ($null -ne $pj.PSObject.Properties['dsh'] -and
      $null -ne $pj.dsh.PSObject.Properties['profile'] -and
      $null -ne $pj.dsh.profile.PSObject.Properties['bundles']) {
    $bundles = @($pj.dsh.profile.bundles)
  }
  $bundleExists = $bundles -contains $PluginName

  if (-not $depExists -and -not $bundleExists) {
    $plan = 'not-in-package-json'
  } else {
    # 还原判断：去条目后 == 安装前内容（结构比较）→ 用原始字节
    if (Test-Path $StateFile) {
      try {
        $state = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $origBytes = [Convert]::FromBase64String($state.packageJsonB64)
        $origObj = ([System.Text.Encoding]::UTF8.GetString($origBytes) | ConvertFrom-Json)
        $stripped = $pj
        if ($depExists) { $stripped.dependencies.PSObject.Properties.Remove($PluginName) }
        if ($bundleExists) { $stripped.dsh.profile.bundles = @($bundles | Where-Object { $_ -ne $PluginName }) }
        $a = ($stripped | ConvertTo-Json -Depth 20)
        $b = ($origObj | ConvertTo-Json -Depth 20)
        if ($a -eq $b) { $plan = 'byte-restore' } else { $plan = 'surgical-remove' }
      } catch {
        $plan = 'surgical-remove'
        $origBytes = $null
      }
    } else {
      $plan = 'surgical-remove'   # 没有状态文件（手工装的）→ 只做条目级移除
    }
  }
}

# ── 2. 打印计划 ──────────────────────────────────────────────────────────
switch ($plan) {
  'byte-restore'        { Write-Host '  package.json: 字节级还原到安装前（含原始格式）' }
  'surgical-remove'     { Write-Host '  package.json: 移除本插件的依赖与 bundle 条目（保留其它插件改动）' }
  'not-in-package-json' { Write-Host '  package.json: 本插件条目已不在，无需改动' }
  'no-package-json'     { Write-Host '  package.json: 不存在，跳过' }
}
$dirExists = Test-Path $Dst
$dirIsLink = $false
if ($dirExists) {
  $dirIsLink = [bool]((Get-Item $Dst -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
}
if (-not $dirExists) { Write-Host '  插件目录: 不存在，无需删除' }
elseif ($dirIsLink) { Write-Host '  插件目录: **符号链接，将拒绝删除**（请人工检查链接与目标）' -ForegroundColor Yellow }
else { Write-Host "  插件目录: 删除 $Dst" }

if ($DryRun) { Write-Host ''; Write-Host '[DryRun] 未做任何修改。' -ForegroundColor Yellow; exit 0 }

# ── 3. 执行 ──────────────────────────────────────────────────────────────
if ((Test-Path $PkgJson) -and ($plan -eq 'byte-restore' -or $plan -eq 'surgical-remove')) {
  if ($plan -eq 'byte-restore') {
    [System.IO.File]::WriteAllBytes($PkgJson, $origBytes)
    Write-Host '  package.json 已字节级还原'
  } else {
    $currentText = [System.IO.File]::ReadAllText($PkgJson, [System.Text.Encoding]::UTF8)
    $pj = $currentText | ConvertFrom-Json
    if ($null -ne $pj.PSObject.Properties['dependencies'] -and
        $null -ne $pj.dependencies.PSObject.Properties[$PluginName]) {
      $pj.dependencies.PSObject.Properties.Remove($PluginName)
    }
    if ($null -ne $pj.PSObject.Properties['dsh'] -and
        $null -ne $pj.dsh.PSObject.Properties['profile'] -and
        $null -ne $pj.dsh.profile.PSObject.Properties['bundles']) {
      $pj.dsh.profile.bundles = @($pj.dsh.profile.bundles | Where-Object { $_ -ne $PluginName })
    }
    [System.IO.File]::WriteAllText($PkgJson,
      (($pj | ConvertTo-Json -Depth 20) + "`n"),
      (New-Object System.Text.UTF8Encoding($false)))
    Write-Host '  package.json 条目已移除'
  }
}

if ($dirExists) {
  if ($dirIsLink) {
    Write-Host '  已跳过删除（符号链接保护）' -ForegroundColor Yellow
  } else {
    Remove-Item $Dst -Recurse -Force
    Write-Host '  插件目录已删除'
  }
}
if (Test-Path $StateFile) { Remove-Item $StateFile -Force; Write-Host '  状态文件已删除' }

Write-Host ''
Write-Host '卸载完成。请完全退出并重启 DSH。' -ForegroundColor Green
