# Inject diagnostic probes into the built (plain-text) main bundle JS.
#
# IMPORTANT: the native APK ships TWO copies of the bundle:
#   assets/assets/main/index.js   <- the one the engine actually loads
#   data/assets/main/index.js     <- unused leftover of the build layout
# Patch the first one; patching the second changes nothing at runtime.
#
# All-ASCII on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI when there is no BOM.
# Usage: & tools\patch-js-diag.ps1 [-NoAutoStart]
param([switch]$NoAutoStart)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$f    = Join-Path $root 'build\android\assets\assets\main\index.js'
$bak  = Join-Path $root 'tools\baseline\main.assets.index.js'

if (-not (Test-Path $bak)) { Copy-Item $f $bak -Force }
Copy-Item $bak $f -Force

$c = [System.IO.File]::ReadAllText($f)
$len0 = $c.Length

# 1) probe node with trapezoid / rect / roundRect (inside _buildUI, before TileWall)
$a1 = 'this._buildTurnPointer(),this._buildWallWidget();'
if (-not $c.Contains($a1)) { throw 'anchor 1 not found' }
$probe = 'this._buildTurnPointer();{' + (Get-Content (Join-Path $PSScriptRoot 'diag-probe.js') -Raw).Trim() + '}this._buildWallWidget();'
$c = $c.Replace($a1, $probe)
Write-Output ("A1 delta=" + ($c.Length - $len0))

# 2) one-shot inspection inside update(), which survives scene rebuilds
$a2 = 'update(t){const e=this._turnPointer;'
if (-not $c.Contains($a2)) { throw 'anchor 2 (update) not found' }
$c = $c.Replace($a2, 'update(t){' +
    (Get-Content (Join-Path $PSScriptRoot 'diag-update.js') -Raw).Trim() +
    'const e=this._turnPointer;')

# 3) auto-enter the game scene (MIUI blocks 'adb shell input tap')
if (-not $NoAutoStart) {
    $a3 = 'this._showScene(Y.HOME),s.on("canvas-resize"'
    if (-not $c.Contains($a3)) { throw 'anchor 3 not found' }
    $c = $c.Replace($a3, 'this._showScene(Y.HOME),' +
        (Get-Content (Join-Path $PSScriptRoot 'diag-autostart.js') -Raw).Trim() +
        's.on("canvas-resize"')
}

# 4) On JSB the engine replaces console.log with a no-op unless debugMode allows it;
#    console.warn always reaches logcat. Route our diagnostics through warn.
$c = $c.Replace('console.log("[DIAG]', 'console.warn("[DIAG]')

[System.IO.File]::WriteAllText($f, $c)
$chk = [System.IO.File]::ReadAllText($f)
Write-Output ("updateHook=" + $chk.Contains('__DIAG_DONE__'))
Write-Output ("autoStart=" + $chk.Contains('auto startGame'))
Write-Output ("probe=" + $chk.Contains('TableProbe'))
Write-Output "diag patch injected"
