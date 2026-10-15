$ErrorActionPreference = 'Stop'
$f = Join-Path (Split-Path -Parent $PSScriptRoot) 'build\android\assets\assets\main\index.js'
$c = [System.IO.File]::ReadAllText($f)

# Convert the three drawing IIFEs from function-declarations to arrow IIFEs.
$pairs = @(
  @('t.addComponent(r).setContentSize(136,136)}function(t){', 't.addComponent(r).setContentSize(136,136)}((t)=>{'),
  @('}(t.addComponent(c));let e=t.getChildByName("Accents")',   '})(t.addComponent(c));let e=t.getChildByName("Accents")'),
  @('e.addComponent(r).setContentSize(1,1)}function(t){',       'e.addComponent(r).setContentSize(1,1)}((t)=>{'),
  @('}(e.addComponent(c));let i=t.getChildByName("TurnPointer")','})(e.addComponent(c));let i=t.getChildByName("TurnPointer")'),
  @('i.addComponent(l).opacity=255}function(t){',               'i.addComponent(l).opacity=255}((t)=>{'),
  @('}(i.addComponent(c)),i.setPosition(0,0,0)',                '})(i.addComponent(c)),i.setPosition(0,0,0)')
)
foreach ($p in $pairs) {
    $c = $c.Replace($p[0], $p[1])
}
[System.IO.File]::WriteAllText($f, $c)
$open = ([regex]::Matches($c, [regex]::Escape('}((t)=>{'))).Count
$c1 = ([regex]::Matches($c, [regex]::Escape('})(t.addComponent(c))'))).Count
$c2 = ([regex]::Matches($c, [regex]::Escape('})(e.addComponent(c))'))).Count
$c3 = ([regex]::Matches($c, [regex]::Escape('})(i.addComponent(c))'))).Count
Write-Output ("arrowOpen=$open closeT=$c1 closeE=$c2 closeI=$c3")
