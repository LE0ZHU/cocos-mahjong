# Raise the engine log level in the built launcher so console.log reaches logcat.
# The file that matters is assets/application.js (NOT data/application.js).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$f = Join-Path $root 'build\android\assets\application.js'
$c = [System.IO.File]::ReadAllText($f)
$old = 'debugMode: false ? cc.DebugMode.INFO : cc.DebugMode.ERROR'
if ($c.Contains($old)) {
    $c = $c.Replace($old, 'debugMode: cc.DebugMode.INFO')
    [System.IO.File]::WriteAllText($f, $c)
    Write-Output 'assets/application.js debugMode -> INFO'
} elseif ($c.Contains('debugMode: cc.DebugMode.INFO')) {
    Write-Output 'already INFO'
} else {
    throw 'debugMode anchor not found'
}
# keep the unused copy consistent
$f2 = Join-Path $root 'build\android\data\application.js'
if (Test-Path $f2) {
    $c2 = [System.IO.File]::ReadAllText($f2)
    if ($c2.Contains($old)) { [System.IO.File]::WriteAllText($f2, $c2.Replace($old, 'debugMode: cc.DebugMode.INFO')) }
}
