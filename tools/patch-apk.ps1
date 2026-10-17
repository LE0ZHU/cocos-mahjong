# Fast device iteration: repack an APK from the plain-text build output, align, sign, install.
# Avoids the ~8 minute full native build.
# Usage: & tools\patch-apk.ps1 [-NoInstall]
[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$NoInstall
)
$ErrorActionPreference = 'Stop'

$sdk       = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adb       = Join-Path $sdk 'platform-tools\adb.exe'
$zipalign  = Join-Path $sdk 'build-tools\35.0.0\zipalign.exe'
$apksigner = Join-Path $sdk 'build-tools\35.0.0\apksigner.bat'
$ks        = 'C:\ProgramData\cocos\editors\Creator\3.8.8\resources\tools\keystore\debug.keystore'

$baseApk  = Join-Path $ProjectRoot 'tools\baseline\CocosGame-release.apk'
# NOTE: the engine loads 'assets/...' inside the APK, NOT 'data/...'.
# Copying only data/ has no effect at runtime.
$srcAssets = Join-Path $ProjectRoot 'build\android\assets'
$work     = Join-Path $ProjectRoot 'temp\apkpatch'
$unpack   = Join-Path $work 'unpacked'
$outApk   = Join-Path $work 'patched.apk'
$tmpApk   = Join-Path $work 'patched-stored.apk'
$signed   = Join-Path $work 'patched-signed.apk'

if (-not (Test-Path $baseApk)) { throw "baseline APK missing: $baseApk" }

if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
New-Item -ItemType Directory -Path $unpack -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($baseApk, $unpack)

# Refresh the whole assets/ tree (the one the engine reads) from the build output,
# and refresh data/ too so both copies stay consistent.
foreach ($name in @('assets', 'data')) {
    $src = Join-Path $ProjectRoot ("build\android\$name")
    $dst = Join-Path $unpack $name
    if (-not (Test-Path $src)) { continue }
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    Copy-Item $src $dst -Recurse -Force
    Write-Output "$name/ refreshed from build output"
}

# Drop stale signatures (v1 files live under META-INF)
foreach ($s in @('META-INF\CERT.SF', 'META-INF\CERT.RSA', 'META-INF\MANIFEST.MF')) {
    $p = Join-Path $unpack $s
    if (Test-Path $p) { Remove-Item $p -Force }
}

$py = 'C:\Users\28337\AppData\Local\Programs\Python\Python312\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }

# Inject android.permission.VIBRATE into the manifest before repacking.
# The vibration feedback (scripts/feedback/Haptics.ts) is a no-op without it,
# and the baseline APK was produced from the engine template which omits it.
# The script is idempotent: if the permission is already there it just says so.
& $py (Join-Path $PSScriptRoot 'patch_manifest_vibrate.py') $unpack
if ($LASTEXITCODE -ne 0) { throw 'patch_manifest_vibrate.py failed' }

& $py (Join-Path $PSScriptRoot 'repack_apk.py') $unpack $tmpApk
if ($LASTEXITCODE -ne 0) { throw 'repack_apk.py failed' }


if (Test-Path $signed) { Remove-Item $signed -Force }
# resources.arsc is already STORED by repack_apk.py; zipalign only needs to align it.
# 直接调用而不是 Start-Process: PS 5.1 的 Start-Process 会用大小写不敏感字典重建环境块,
# 本机同时存在 HTTP_PROXY / http_proxy 时会抛 "已添加项..." 直接把流程打断。
& $zipalign -f -p 4 $tmpApk $signed
if ($LASTEXITCODE -ne 0) { throw "zipalign failed (exit $LASTEXITCODE)" }
if (-not (Test-Path $signed)) { throw "zipalign produced no output: $signed" }

& $apksigner sign --ks $ks --ks-pass pass:123456 --key-pass pass:123456 `
    --ks-key-alias debug_keystore --out $signed $signed 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }
Write-Output "signed: $signed"

if ($NoInstall) { return $signed }

& $adb install -r -d $signed
if ($LASTEXITCODE -ne 0) { throw 'adb install failed' }
& $adb shell monkey -p com.zgl.jyh -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
Write-Output 'installed + launched'
return $signed
