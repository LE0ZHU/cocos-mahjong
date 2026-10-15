# Build the device-verification bundle for the final fix:
#   * static Graphics (table / disc / wall / menu backdrop) redrawn one frame after start()
#   * table + backdrop clear() before redrawing
#   * optional auto-enter-game (for the game-page screenshot)
param([switch]$NoAutoStart)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'exp-real-fix.ps1')
& (Join-Path $PSScriptRoot 'fix-iife.ps1')

$root = Split-Path -Parent $PSScriptRoot
$f = Join-Path $root 'build\android\assets\assets\main\index.js'
$c = [System.IO.File]::ReadAllText($f)

# table: clear before repainting
$a = 'const e=t.getComponent(c),i=(t,n,i)=>{'
if (-not $c.Contains($a)) { throw 'table clear anchor not found' }
$c = $c.Replace($a, 'const e=t.getComponent(c);e.clear();const i=(t,n,i)=>{')

# menu backdrop: clear before repainting
$b = 'if(bg){bg.fillColor=new n(26,17,10,248);'
if (-not $c.Contains($b)) { throw 'backdrop clear anchor not found' }
$c = $c.Replace($b, 'if(bg){bg.clear();bg.fillColor=new n(26,17,10,248);')

if ($NoAutoStart) {
    $auto = (Get-Content (Join-Path $PSScriptRoot 'diag-autostart.js') -Raw).Trim()
    if (-not $c.Contains($auto)) { throw 'autostart snippet not found' }
    $c = $c.Replace($auto, '')
    Write-Output 'autostart removed'
}

[System.IO.File]::WriteAllText($f, $c)
Write-Output ("hasTableClear=" + $c.Contains('getComponent(c);e.clear();') + " hasBackdropClear=" + $c.Contains('bg.clear();'))
