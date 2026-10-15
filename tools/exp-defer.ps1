# EXPERIMENT (clean baseline): build table + turn disc from update() instead of onLoad,
# and inspect the result. All in one pass so the string anchors stay valid.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$f    = Join-Path $root 'build\android\assets\assets\main\index.js'
$bak  = Join-Path $root 'tools\baseline\main.assets.index.js'
Copy-Item $bak $f -Force
$c = [System.IO.File]::ReadAllText($f)

# 1) stage the builders: do not run them inline in _buildUI
$a = 'this._buildTable(),this._buildTurnPointer(),this._buildWallWidget();'
if (-not $c.Contains($a)) { throw 'anchor A not found' }
$c = $c.Replace($a, 'this._buildWallWidget();')

# 2) auto-enter the game
$a2 = 'this._showScene(Y.HOME),s.on("canvas-resize"'
if (-not $c.Contains($a2)) { throw 'anchor auto not found' }
$c = $c.Replace($a2, 'this._showScene(Y.HOME),' +
    (Get-Content (Join-Path $PSScriptRoot 'diag-autostart.js') -Raw).Trim() +
    's.on("canvas-resize"')

# 3) run the builders from update(), then inspect on the following frame
$b = 'update(t){const e=this._turnPointer;'
if (-not $c.Contains($b)) { throw 'anchor B not found' }
$builder = 'if(!this.__deferredDone){this.__deferredDone=1;this._buildTable();this._buildTurnPointer();console.warn("[DIAG] deferred table+disc built")}'
$inspect = 'if(!globalThis.__DIAG_DONE__){globalThis.__DIAG_DONE__=1;const GR=this._gameRoot;const T=GR&&GR.getChildByName("Table");console.warn("[DIAG] Table="+!!T+" children="+(GR?GR.children.length:-1)+" active="+(T?T.activeInHierarchy:"-")+" world="+(T?JSON.stringify(T.worldPosition):"-"));if(T){const g=T.getComponent(c);console.warn("[DIAG] graphics="+!!g);if(g){try{g.fillColor=new cc.Color(255,0,0,255);g.rect(-500,-400,1000,200);g.fill();console.warn("[DIAG] red rect drawn")}catch(e){console.warn("[DIAG] rect err "+e)}}}}'
$c = $c.Replace($b, 'update(t){' + $builder + $inspect + 'const e=this._turnPointer;')

$c = $c.Replace('console.log("[DIAG]', 'console.warn("[DIAG]')
[System.IO.File]::WriteAllText($f, $c)
Write-Output ("deferred=" + ([System.IO.File]::ReadAllText($f)).Contains('__deferredDone'))
