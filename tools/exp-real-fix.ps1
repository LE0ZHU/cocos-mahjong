# Verify the real fix on device.
# Mirrors the TypeScript sources: drawing of the one-shot static Graphics
# (table / turn disc / wall / menu backdrop) is deferred to the next frame
# after start(), because Graphics drawn during onLoad never reaches the GPU
# on native (JSB) builds.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$f    = Join-Path $root 'build\android\assets\assets\main\index.js'
$bak  = Join-Path $root 'tools\baseline\main.assets.index.js'
Copy-Item $bak $f -Force
$c = [System.IO.File]::ReadAllText($f)
$log = @()

# ---- 1) _buildTable(): reuse the existing node/graphics on re-entry ----
$oldTable = 'const t=new o("Table");t.parent=this._gameRoot;t.addComponent(r).setContentSize(1080,1080);const e=t.addComponent(c),'
if (-not $c.Contains($oldTable)) { throw 'anchor table not found' }
$newTable = 'let t=this._gameRoot.getChildByName("Table");if(!t){t=new o("Table");t.parent=this._gameRoot;t.addComponent(r).setContentSize(1080,1080);t.addComponent(c)}const e=t.getComponent(c),'
$c = $c.Replace($oldTable, $newTable); $log += 'buildTable-idempotent'

# ---- 2) _buildTurnPointer(): reuse existing disc / accents / pointer ----
$oldDisc = 'const t=new o("TurnDisc");t.parent=this._gameRoot,t.addComponent(r).setContentSize(136,136),function(t){'
if (-not $c.Contains($oldDisc)) { throw 'anchor turnDisc not found' }
$newDisc = 'let t=this._gameRoot.getChildByName("TurnDisc");if(!t){t=new o("TurnDisc"),t.parent=this._gameRoot,t.addComponent(r).setContentSize(136,136)}function(t){'
$c = $c.Replace($oldDisc, $newDisc); $log += 'turnDisc-idempotent'

# accents + pointer reuse
$oldAcc = 'const e=new o("Accents");e.parent=t,e.addComponent(r).setContentSize(1,1),function(t){'
if (-not $c.Contains($oldAcc)) { throw 'anchor accents not found' }
$c = $c.Replace($oldAcc, 'let e=t.getChildByName("Accents");if(!e){e=new o("Accents"),e.parent=t,e.addComponent(r).setContentSize(1,1)}function(t){'); $log += 'accents-idempotent'

$oldPtr = 'const i=new o("TurnPointer");i.parent=t,i.addComponent(r).setContentSize(1,1),i.addComponent(l).opacity=255,function(t){'
if (-not $c.Contains($oldPtr)) { throw 'anchor pointer not found' }
$c = $c.Replace($oldPtr, 'let i=t.getChildByName("TurnPointer");if(!i){i=new o("TurnPointer"),i.parent=t,i.addComponent(r).setContentSize(1,1),i.addComponent(l).opacity=255}function(t){'); $log += 'pointer-idempotent'

# ---- 3) defer the static drawing to the frame after start() ----
$oldShow = 'this._showScene(Y.HOME),s.on("canvas-resize"'
if (-not $c.Contains($oldShow)) { throw 'anchor showScene not found' }
$autostart = (Get-Content (Join-Path $PSScriptRoot 'diag-autostart.js') -Raw).Trim()
$c = $c.Replace($oldShow, 'this._showScene(Y.HOME),this.scheduleOnce(()=>this._drawStatic(),0),' + $autostart + 's.on("canvas-resize"'); $log += 'defer-hook+autostart'

# ---- 4) _drawStatic(): redraw table / disc / wall / menu backdrop once ----
$oldUpd = 'update(t){const e=this._turnPointer;'
if (-not $c.Contains($oldUpd)) { throw 'anchor update not found' }
$drawStatic = '_drawStatic(){if(this._staticDone)return;this._staticDone=1;this._buildTable();this._buildTurnPointer();this._refreshWall();const M=this._menu&&this._menu.node&&this._menu.node.getChildByName("MenuRoot");const bd=M&&M.getChildByName("MenuBackdrop");const bg=bd&&bd.getComponent(c);if(bg){bg.fillColor=new n(26,17,10,248);bg.rect(-3e3,-3e3,6e3,6e3);bg.fill();bg.fillColor=new n(34,92,62,255);bg.roundRect(-540,-360,1080,720,26);bg.fill();bg.fillColor=new n(42,108,74,255);bg.roundRect(-534,-354,1068,708,22);bg.fill();bg.strokeColor=new n(168,120,52,255);bg.lineWidth=6;bg.roundRect(-540,-360,1080,720,26);bg.stroke();bg.strokeColor=new n(230,192,110,255);bg.lineWidth=2;bg.roundRect(-531,-351,1062,702,20);bg.stroke()}console.warn("[DIAG] static graphics redrawn")}'
$c = $c.Replace($oldUpd, $drawStatic + $oldUpd); $log += 'drawStatic'

[System.IO.File]::WriteAllText($f, $c)
Write-Output ($log -join ', ')
