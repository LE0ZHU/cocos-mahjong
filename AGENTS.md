# AGENTS.md

给 AI 助手的工作说明。**动手前先读「硬约束」一节，那里每一条都对应一个真实翻过车的坑。**

---

## 项目速览

- Cocos Creator 3.8.8 + TypeScript，单场景（`assets/game.scene`），全部 UI 由代码构建
- `assets/scripts` 共约 12600 行；`Main.ts`(3054) 与 `GameManager.ts`(1717) 是两个大头
- 分层：`core/` `game/`（纯逻辑，零 `cc` 依赖） → `managers/`（状态机） → `ui/` + `Main.ts`（表现层）

---

## 硬约束（违反会出 bug）

### 1. target 是 ES2015，不能用 `Array.prototype.includes`

`tsconfig.json` 继承 Cocos 的 `target: ES2015`。`includes` 要 ES2016。
用 `arr.indexOf(x) >= 0` 或 `arr.some(...)`。

### 2. 内容坐标系里，"保证完整可见"的 UI 不能写死高度

`Main._applyAdaptation()` 把牌桌按**宽度铺满**：

```
_gameRoot.scale = design.width / 1680        // CONTENT_W = 1680
可见半高 halfH = (design.height / 2) / scale = 840 / 屏幕宽高比
```

所以内容坐标系（横向 ±840）里的可见高度**随屏幕比例变化**：

| 屏幕 | 可见半高 | 全高 |
|---|---|---|
| 21:9 / 2.4:1 超宽 | 350 ~ 360 | 700 ~ 720 |
| 19.5:9 (2340×1080) | 387 | 775 |
| 16:9 (1920×1080) | 472 | 945 |
| 3:2 平板 | 560 | 1120 |
| 4:3 (iPad) | 630 | 1260 |
| 竖屏 | 1867 ~ 4200 | — |

⚠️ **别把全高当半高用**。本节早期版本只写了 945/720 那一列（全高），
而 `_applyLayout(halfH)` 收的是**半高**，差一个 2 倍 —— 照抄会把面板排到屏幕外。

结算面板最初把高度写死 940，只在恰好 16:9 时成立，手机横屏溢出 82~110。
**要完整可见的 UI 必须接 `_applyLayout(halfH)` 里的 halfH 动态计算。**
（横向无需处理：内容 x 恒为 ±840，宽度 < 840 的元素不会横向溢出。）

⚠️ **横屏时牌桌中间那条纵向带极窄**。21:9 下"吃/碰按钮行上沿 → 转盘下沿"
只剩约 10px，16:9 也只有约 100px。浮动面板**不能写死高度**，
必须按可用空间缩放（见硬约束 13b 的 `HintPanel.fit`）。

⚠️ **平板（3:2 / 4:3）上"可见半高"会超过桌面本身**：桌面是固定几何
（近端半高 560 / 远端 530），halfH=560 时整张桌子会**完整露出来**，
而牌位是按 halfH 贴屏幕边排的 —— 上家手牌整排压过桌沿、自家手牌坐到木框上，
看上去就是"牌摆到桌子外面"。两条必须同时成立：

- `_applyTableScale(halfH)`：把桌面节点整体放大，倍率 = `(halfH + 10) / TABLE_FAR_HH`（≥1），
  让桌面永远比可见区大一圈（和手机横屏一个观感）。桌面是纯 Graphics，缩放节点即可。
- `_applyLayout` 里牌位用
  `topHalf = min(halfH, FELT_TILE_TOP × 倍率)` / `bottomHalf = min(halfH, FELT_TILE_BOTTOM × 倍率)`
  分别夹住上家手牌与自家手牌 —— **毡布上下不对称**（远端 497.75、近端 -526），
  只用一个对称值会让底部白空一截。

16:9 及更宽时这两项恒为 `1` / `halfH`，**手机排版一个像素都不变**。
涉及常量都收在 `Main.ts` 顶部的
`TABLE_NEAR_HH / TABLE_FAR_HH / FELT_TILE_TOP / FELT_TILE_BOTTOM`
（`_buildTable` 与 `_applyLayout` 共用，别各写一套）。

⚠️ **牌尺寸本身也必须跟着放大**（2026-10-17 加）：桌面被放大 1.08~1.21 倍后，
牌若还是手机上的 63×84，牌/桌比例就比手机小一截 —— 观感是"麻将很小、桌子很空旷"。
所以 `TILE_W / TILE_H / TOP_TILE_W / SIDE_TILE_W / RIVER_TILE_W` **不是常量**，
而是运行期字段，由 `_applyTileScale(halfH)` 按 `halfH / TILE_REF_HALF_H`（472.5）
统一乘倍率；基准值收在 `BASE_*`，改牌大小只改 `BASE_*`。

**放大上限 `TILE_SCALE_MAX = 1.4` 的前提是"手牌行两侧已经让干净"**：
14 张手牌本来就占 882px，横向净空由两侧的常驻元素决定 ——
平板（`wideTiles = tileK > 1`）把按钮竖排，手机保持横排；听牌芯片两种屏幕都贴内容右边缘：

| 元素 | 手机（k = 1） | 平板（k > 1） |
|---|---|---|
| 听牌 / 提示按钮 | 手牌左侧**横排**，右缘 -531 | **竖排贴左边缘**（`LEFT_BTN_PAD`），右缘 -700 |
| 听牌芯片 | 贴内容右边缘（`CHIP_EDGE_PAD`）+ 抬到手牌上沿上方 | 同左 |

芯片为什么两种屏幕都贴边：手牌还要再乘 `HAND_SCALE`（见下），"手牌右侧"那条净空
只剩 202px（手机）/ 156px（4:3），长文案缩到 `CHIP_MIN_SCALE` 都塞不下。

让位后真正卡住上限的是**牌河**：9 张 × 44 × k 的半宽要让开左右家牌河内缘
（340 − 22k），留 30px → `k ≤ 1.41`，取 1.4（4:3 实际是 `630/472.5 = 1.33`，
1:1 与竖屏才撞到 1.4）。**改按钮 / 芯片位置或牌河列数，必须重跑测试的 E 组。**

⚠️ 副露**不能**和手牌同排：14 张手牌 882k + 最多 16 张副露 704k = 1586k，
k=1 时居中就会把左缘推到 -793，直接压住两个按钮；放大后更不可能。
纵向空间在平板上一直是富余的，瓶颈只可能在横向。

牌的长宽是创建节点时写进 `UITransform` 的，**光改字段不会让已经画出来的牌变大** ——
`_applyLayout` 在倍率变化时调 `_rebuildTiles()` 重建四家手牌 / 牌河 / 副露
（发牌动画期间跳过，那一帧本来就在按 `_dealing` 重画）。

⚠️ **自家手牌再额外乘 `HAND_SCALE`（1.13）**：手牌是玩家的视线落点，比其它三档再大一圈
（手机 63×84 → 71×95，4:3 平板 84×112 → 95×127）。上家 / 左右家 / 牌河 / 副露**都不变**，
所以手牌与副露的大小对比会比以前明显，这是有意的。两条连带影响：

- 手牌行变高会把副露与牌河整体往上推：21:9 这类超宽屏的转盘会被挤到下限 30
  （可用空隙 33 > 30，仍不压牌；见测试 F 组）；
- 听牌芯片必须从"手牌右侧"挪到**手牌右上角、贴内容右边缘**（`CHIP_EDGE_PAD`）：
  满手 14 张只剩 202px（手机）/ 156px（4:3），长文案缩到 `CHIP_MIN_SCALE` 都塞不下。
  芯片与「你·听」标记靠**纵向**错开（`max(TILE_H/2 − 7, 标记半高 + 芯片半高 + 8)`）。
- 手牌横向净空：手机 498 半宽 vs 横排按钮 -531（留 33），平板 664 vs 竖排按钮 -700（留 35）。

出图：`python tools/preview-layout.py --tablet`
（`tablet-preview.png`，16:9 / 3:2 / 4:3 三张叠一起，会打印牌倍率与"牌是否越界"）。
复核：`tools/ai-test/tablet-layout-test.ts`（A 手机不变 / B 桌面盖住屏幕 /
C 牌在毡布内 / D 源码接线 / E 放大后的牌不撞常驻 UI / F 超宽屏转盘不压牌河）。

### 3. 纵向排版的游标写法

游标 `y` 恒表示**上一段的底边**，每段先取中心再连同高度下移：

```ts
let y = h / 2 - pad;
const titleY = y - H_TITLE / 2;
y -= H_TITLE + GAP;          // ← 必须是 y -= ...
```

写成 `y + H/2` 会让下一段**正好压在上一段上**。这个 bug 连续犯过两次
（按钮盖住最后一行手牌、"四家手牌"标签压住第一行）。
**交付前必须核对所有段间间距 > 0。**

### 4. Label 宽度不够会被 SHRINK 压扁

`createLabelNode(text, fontSize, color, width, height, alignLeft)` 的 `width` 是**文本域宽度**。
给小了 → `Label.Overflow.SHRINK` 把字压成两行蚂蚁字（番型块头部被压成 50px 就是这么来的）。

```ts
// 左对齐时: 文字起点 = 节点 x - 宽度/2
// 要文字起点落在 T, 节点 x 必须取 T + 宽度/2
```

**同一行放两个 Label**，先按字宽算出总需求再分配，别凭感觉减。
用 `SettlementPanel.ts` 里的 `textWidth()`：CJK 按字号、数字/空格/中点按半角。

### 5. 同一区块内只能用一套边界常量

结算面板曾同时存在 `-CARD_W/2 + 100`（卡片内边界）和 `-ROW_HALF`（行块边界）两套左边界，
差 40px，"四家手牌"标题比下面的手牌列左突一截。
**同一区块内的元素统一用 `ROW_LEFT / ROW_RIGHT`。**

### 6. 原生（JSB）平台：`onLoad` 阶段画的 Graphics 不上屏

组件 `onLoad` 时场景尚未进入第一个渲染帧，Graphics 顶点数据会被丢弃 →
牌桌/底板/转盘在真机上完全不见，浏览器预览没有这个差异。

- 一次性静态图形：延后到 `start()` 之后的下一帧再画（见 `Main._staticGraphicsDrawn`）
- 按钮：节点会被隐藏（切页面/开局），显示时调 `repaintButtons(node)` 补画底框
- 页面重新显示：`MenuUI.showHome()` / `showRules()` 里已调用
- **"隐藏过再显示"同样会丢 Graphics，不只是 `onLoad`**：
  牌桌/中央转盘/牌墙只在首帧后画一次，而返回主页面会把 `_gameRoot` 整个
  `active = false`，再点"开始游戏"时顶点回不来 —— 表现为**牌桌整块消失**
  （只剩相机清屏色），而牌面/按钮/文字一切正常。
  所以 `_showScene(PLAYING)` 里必须调 `Main._redrawTableGraphics()` 补画，
  且要排在 `_gameRoot.active = true` **之后**（画在隐藏节点上一样丢）。
  新增"只在开局画一次"的静态图形时，同步问一句：回主页面再进来有补画入口吗。

### 6b. 牌桌美术：台面用渐变带，禁止平涂色块

牌桌由 `Main._buildTable()` 纯 Graphics 绘制。**台面不要用单个 `fillColor` 平涂** ——
平涂色块一眼就是"卡通"，而且叠加色块（尤其中间垫一块浅色）会形成突兀色斑。

- 用 `drawTrapBands(hwb, hh, colFar, colNear, bands)` 画**光照渐变**：
  远端（上，受光）取 `colFar` 偏亮，近端（下）取 `colNear` 偏暗。
  72 条色带肉眼已无色阶；每条色带自身也是梯形（按所在位置插值半宽），侧边才不溢出。
- 毡布内侧压一圈**半透明黑描边**做暗角，桌面才像"嵌"在木框里而不是"贴"上去。
- **`lineWidth` 是像素单位**，画粗了就是一圈黑边（曾把 14 写成 26 直接变成黑框）。
- 2026-10-15 按要求**删掉了中央那块浅绿色块**（原 `Color(42,102,66)` 的"中央出牌河"，
  半宽 460/320）：它平涂在深绿上形成突兀梯形，还把转盘那一圈地色抬高显得脏。
  现在台面保持整块连续，只用一圈极淡细线勾内沿。

改桌面后用 `python tools/preview-layout.py` 出图确认（会镜像 `_buildTable`），
**改 Main.ts 必须同步改这个脚本**，否则预览会骗人。
注意该脚本的 `Painter.poly()` 曾因用 RGBA 画笔画半透明描边（不会与底图混合）
而渲染成实色白边，误判过一次；现已改为 `alpha_composite` 合成，画布也必须用 RGBA。

### 6c. 发牌动画：牌同步发完，UI 分帧"揭示"

开局原本 52 张牌在同一帧发完，四家手牌"啪"地整排出现。现有逐张弹出的动画，
**关键设计是"规则同步、表现分帧"**：

- `GameManager.startGame()` **同步**发完 13×4 张，结束时停在 `DEALING`
- UI 的 `_dealNextFrame()` 每 `ANIM.dealInterval` 多显示一张，让它从牌墙飞进各家手里
- 动画播完才调 `GameManager.beginPlay()`（内部才 `_playerDraw()`，即摸牌 + 起 20 秒倒计时）

**为什么不能把发牌拆成 13 次异步回调**（踩过）：
`startGame` 是同步方法，13 次回调全落在**同一帧**，每帧重建手牌都会把上一帧的
动画节点销毁 —— 结果等于**没动画**，还白白重建 13 次。所以是"一次发完 + UI 逐帧揭示"。

**发牌期间的三条时序保证**：
- 阶段是 `DEALING` → `playTile` 拒收，玩家点不到；也不会起倒计时（`_startDecisionTimer`
  只在 `_playerDraw` 里调），AI 也不会行动（`_startDrawTurn` 只在 `beginPlay` 之后）
- UI 的 `_onTileClick` / `_onTileDropDiscard` 里 `if (this._dealing) return` 是**静默拦截**，
  放在 `_showToast` **之前** —— 发牌时弹"还没轮到你出牌"会像出错了
- 返回主页面 / 重新开始都要调 `_abortDealing()` 把 `_dealing`、`_dealShown` 归零。
  **漏了会残留 true，下一局点手牌没反应**（最难查的一类，`unscheduleAllCallbacks`
  只清得掉排队的帧，清不掉 UI 标记）

**收尾 `_finishDealing()` 的定稿刷新不能漏**：前面每帧只画前 n 张（整排居中，位置随张数变），
收尾必须按完整 14 张重画一遍，否则玩家少牌。顺序是"先刷新手牌 → 再 `beginPlay()`"，
反了会让刚摸到的牌标注来不及画。

时序常量都在 `Anim.ts`（`dealFly/dealStagger/dealInterval/dealLeadIn/dealLastSettle`）。
**硬约束：`dealInterval ≥ dealStagger × 3`**，否则下一轮的重建会打断上一轮还没落位的牌，
看起来就是"卡了一下"。改这些值后跑：

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/d tools/ai-test/deal-anim-test.ts
node temp/d/deal-anim-test.js
```

它从**真实源码**复核 6 组共 30 项：节奏观感（总耗时 0.8~2.6s、帧间不打架）、
规则层没被补间污染、发牌期间不能操作/计时、状态能归零、定稿刷新不漏、牌墙随发牌递减。

> 写这类"从源码提取方法体"的脚本时，**必须先 `stripComments()` 再匹配**。
> 方法名常出现在文档注释里（本例注释中就有 `startGame()`），
> 直接 `indexOf` 会命中注释那处并取到无关代码 —— 本脚本前两版都因此误报。
> 另外 `includes('_playerDraw')` 会误判 `_playerDrawnTile`，要用 `/this\._playerDraw\s*\(/`。

### 6d. 跨局状态必须归零：`destroy()` 是延迟的

`Main._clearTable()` 销毁牌桌节点时，**必须把缓存了节点引用的字段一起归零**。
漏一个就会变成"跨局悬垂引用"，下一局访问时崩在引擎里。

2026-10-16 修过一个真实 bug：对局中点"返回主页面"再点"开始游戏"必崩
`Cannot read properties of null (reading 'length')`。堆栈：

```
Node._findComponent ← Main._clearHintMark ← Main._hideHint
  ← Main._refreshHintButton ← Main._refreshInfo ← GameManager.startGame
```

`_clearTable()` 清了 `_handSlots`/`_prevHandSlots`/`_riverCount`，唯独漏了 `_handNodes`。
关键在 `node.destroy()` 是**帧末才真正执行**的：

| 操作 | 旧节点状态 | 结果 |
|---|---|---|
| 对局中直接"重新开始"（同一 tick） | 只是标记销毁，`_components` 仍有效 | 不崩 |
| 返回主页面后再"开始游戏"（隔一帧） | `_components` 已置 null | **崩** |

**为什么"重新开始"正常反而掩盖了问题** —— 修这类 bug 时要意识到：同一条路径里
"同帧重入"和"隔帧重入"的结果可能完全不同，光测一条会漏。

两条规则：

1. **新增"缓存节点引用"的字段时，同步问一句：清理函数里归零了吗。**
   本项目已因此犯过两次（`_dealing`、`_handNodes`），形状完全一样。
2. **对可能已销毁的节点取组件/坐标前判 `isValid`。**
   `n?.getComponent(...)` 里的 `?.` 只防数组越界，**不防元素是已销毁节点** ——
   已销毁节点的 `getComponent` 会进引擎读已置 null 的 `_components.length`。

```ts
// 对
if (n && n.isValid) n.getComponent(TileView)?.setHinted(false);
// 错: n 为已销毁节点时照样炸
n?.getComponent(TileView)?.setHinted(false);
```

另有一条容易想当然的：**`unscheduleAllCallbacks()` 只清"自己这个组件"排的回调**。
发牌链的 `scheduleOnce` 挂在 `Main` 上，`GameManager.stopGame()/startGame()` 里那个
同名方法作用在 GameManager 组件上，**清不到**。返回主页面/重新开始必须自己调
`this.unscheduleAllCallbacks()`，否则上一局残留的 `_finishDealing()` 会在新局中途触发、
提前 `beginPlay()`。

复核脚本：`tools/ai-test/state-cleanup-test.ts`（21 项，从真实源码提取断言，四组：
清牌桌归零跨局状态 / 取组件与 `centerOf` 前判 `isValid` / 打断对局清 Main 自己的帧 /
手牌数组保持纯 `Node[]`）。加新的节点缓存字段后要把它加进 A 组的字段列表。

### 6e. 对局内设置弹窗：一个齿轮按钮收掉所有全局操作

2026-10-16 按要求把牌桌左上角的"重新开始 / 返回主页面"两个文字按钮**删掉**，
收成一个齿轮图标按钮 + `SettingsPanel` 弹窗（声音设置 + 那两个操作）。
改这块 UI 时记住下面几条：

- **声音设置与主菜单"设置规则"页共用同一份定义**（`VOLUME_LEVELS` / `nearestVolumeLevel` /
  `ON_OFF_AUDIO` 从 `MenuUI` 导出）。不要在对局侧另写一套档位 —— 两处各写一份必然漂移。
- **打开弹窗要冻结 20 秒决策倒计时**（`GameManager.pauseDecideTimer()`）。
  玩家在设置里调音量时看不到牌桌，不该被系统判超时替他出牌。
  暂停标志挂在 `_clearDecisionTimer()` 里复位 —— 那条路径覆盖
  `startGame`/`stopGame`/`cancelPendingMeld`，漏了会让下一局的倒计时"看着在走、实际不动"。
- **牌桌输入要显式拦**（`_onTileClick` / `_onTileDropDiscard` 里的 `_settingsOpen()`）。
  遮罩节点虽然会 `propagationStopped`，但"事件会不会穿透到下层节点"取决于引擎的派发顺序，
  不能想当然 —— 万一穿透，玩家在弹窗上点两下就把手牌打出去了。
- **卡片高度不能写死**：里面的"重新开始 / 返回主页面"是玩家唯一的出口，
  21:9 横屏压出去就等于卡死。`SettingsPanel.fit(halfH)` 按可用高度整体缩放
  （与 `HintPanel.fit`、`SettlementPanel.fit` 同一套做法）。
- 重开/返回都要**先收弹窗再执行**（`_closeSettings(after)`），否则新一局的牌桌上还压着弹窗。

复核脚本：`tools/ai-test/settings-layout-test.ts`（四组：各屏幕比例完整可见 / 段落不重叠 /
文本域与按钮宽度 / 行为约束源码级校验）。出图：`python tools/preview-settings.py`。

### 6f. 牌面：素材图 1:1 平铺，圆角裁在素材上，无程序化牌身

2026-10-16 定稿。有素材图时 `TileView._applyDisplay` 会把 `Bg`（程序绘制的牌身/凹槽）
**整个隐藏**，`Face`（素材图）按 `width × height` 铺满整张牌。要点：

- **素材四角必须是"圆角 + 透明"**：`assets/resources/tiles/*.png` 不是原始素材，
  而是 `tools/make-tile-faces.py` 从 jpg 加工的（圆角半径 = 短边 × 12%，**尺寸不变、
  不补边**，`meta` 里 `hasAlpha=true`、`trimType=none`，uuid 沿用旧的）。
  **换素材必须重跑该脚本**，直接丢直角 jpg 进去四角会在桌面上露出白色直角。
- **原始 jpg 不在 assets 里**，在仓库根的 `majiang_paimian/`（34 张，75×100）。
  改圆角 / 换素材要跑 `python tools/make-tile-faces.py --src majiang_paimian`
  （写回 `assets/resources/tiles`，**保留已有 `*.png.meta`**，uuid 不变）。
  就地模式（不带 `--src`）只在源目录还留着 jpg 时才有得转，别指望它。
  改完圆角必须同步 `TileView.ts` 的 `TILE_RADIUS_RATIO`，否则高光框与牌边不同心。
- **不要同时存在同名 `.jpg` 和 `.png`**（`resources.load('tiles/1W/spriteFrame')` 按名加载，
  脚本会删旧 jpg，正是为了避免歧义）。
- `Bg` 只在"图片缺失"时作矢量兜底（筒/条图案、Label 都画在它上面）；`setTileBgColor`
  保留但图片模式下不可见。
- 牌面不再有"立体厚度(band)/阴影"，**依赖它们的布局补偿要一起删**
  （例：`_applyLayout` 里给上家亮牌留的 `topBand` 已删）。
- 改 `createTileNode` / `TileView._applyDisplay` / `make-tile-faces.py` 后，
  必须同步 `tools/preview-tile.py`（镜像牌面渲染，出 `tile-face-preview.png`），否则预览会骗人。

#### 6f-2. 贴牌边画圈的（金框/青框/金边）必须共用 `tileRadius()`

牌的实际圆角 = **短边 × 12%**（裁在素材图上）。所有"沿牌边画一圈"的边框都要用
`TileView.ts` 导出的 `tileRadius(w, h)`，**不要另写一套比例**（哪怕数字碰巧相同 ——
`UIFactory` 里曾有一份 `TILE_FACE_RADIUS_RATIO = 0.093` 的死代码，改圆角时漏改就是两套）：
比例不同 → 角上的弧与牌边不同心 → 弧线在角的"肩部"离牌边而去，露出一道桌布色的
缝隙（"金牌边框和牌边不契合"就是这么来的，2026-10-17 修过一批）。

还有一条与画在谁之上有关：

- 圈画在**牌身之下**（`setSiblingIndex(0)`）时，路径要按线宽一半**外扩**
  （亮金 +1 / 柔光 +2.5），让整个描边落在牌边之外、内侧 0.5 藏在牌下。
  路径压在牌边上就等于内侧半个线宽被牌面吃掉：直边只剩一条细线、角上被吃得更多，
  看起来像"框断了"。
- 画在牌身**之上**的（AI 提示青框）同参数即可，内侧 0.5 直接压在牌边那半像素上。

涉及的五处（改一处要顺手检查其余）：`TileView.drawDrawnMark` / `drawHintMark` /
`drawDragGlow`、`Main.addClaimedRing`（副露触发牌）、`SettlementPanel` 的 `WinRing`。
出图：`python tools/preview-tile-highlight.py`（`tile-highlight-preview.png`，
上排放大看几何、下排 1:1 看实际粗细）。

### 6g. 对局信息常驻：比分条与听牌芯片只放在「净空」里

2026-10-16 新增（用户要求：累计分不再只在结算面板出现，听牌详情不用再点「提示」）。
两块信息都常驻牌桌边角，**不占任何出牌区域**：

- **比分条**（`Main._buildScoreStrip` / `_refreshScoreStrip`）：左上角齿轮按钮右侧、与齿轮
  同一排。那是牌桌四角里唯一稳定的净空 —— 右上角是剩余牌墙（高度随张数变）、下边两角是
  手牌与「听牌/提示」按钮。可用宽度 = 齿轮右缘 → 上家手牌**最宽情形**（14 张）左缘 ≈ 480px，
  累计到四位数时按 `CHIP_MIN_SCALE`(0.62) 整体缩。名字与分数是**两个 Label**（分数按正负
  着色、名字始终米白），两段字宽 + 一个空格宽必须正好等于整串宽。
- **听牌芯片**（`_buildTenpaiChip` / `_showTenpaiChip` / `_placeTenpaiChip`）：贴在手牌右侧、
  与手牌同一排，**右缘固定**（`halfW − TENPAI_CHIP_RIGHT`，让开右侧「你·听」标记）→
  文案变长时向左伸、位置不跳；左缘以满手 14 张的右缘为界，多面听长文案同样靠缩放兜底。
  它纵向整体位于手牌上沿之下，所以不会侵入提示面板的落位通道（硬约束 13b）。
- **座位名牌**（`_buildSeatPlates` / `_refreshSeatPlates` / `_placeSeatPlates`，2026-10-17）：
  **只给三家 AI 做**（自己坐哪不用提示，四角净空也都占满了）。内容 = `seatLabel` + 连庄角标
  `×N`，**不带分数** —— 分数只在比分条里，两处各写一份必然出现"改名忘了改分"的漂移。
  角标口径 = `GameManager.getStreak(seat)`（连续胡牌 ≥ 2 才显示），与结算面板的 `连庄×N` 同源。
  位置：上家挂**手牌行右端之外**（按 14 张最宽取位）；左右家挂**桌沿外侧那一列**
  （x = ±(halfW − `TENPAI_MARK_INSET`)），落在「xx·听」标记**下方** —— 手牌列下端看着更近，
  但 21:9 上那条带只剩 ~94px，而听牌/提示按钮就咬在那儿，30px 高的名牌塞不进去（实测撞车）。
- **数据一律由 GameManager 算**（`TenpaiInfo` + `onTenpaiInfo`）：剩余张数 = Σ(4 − 可见张数)，
  与提示里的「N 张进张」同一算法（硬约束 13d）；可见张数直接复用
  `_buildAIContext(0).visible`，玩家与 AI 看到的公开信息一致（硬约束 10）。
  **不要在 UI 里自己数张数** —— 那必然与提示漂移。
- **`onTenpaiInfo` 是状态、`onTenpai` 是事件**：前者变化才推（UI 常驻显示），后者是一次性提醒
  （只在玩家摸牌且详情真的变了时喊）。原先每次摸牌只要听牌就喊一遍，配上常驻芯片就是噪音。
- 刷新点挂在 `_refreshTenpaiFlag`，且**所有座位都刷** —— 别家弃牌/副露会改变「剩余张数」。
  开局 / 结束 / 返回主页面各清一次；`_clearTable()` 里必须 `_hideTenpaiChip()` 并把
  `_scoreSig` / `_tenpaiChipW` 归零（形状同硬约束 6c/6d 的"跨局状态归零"）。
- **原生（JSB）**：两块信息的 Graphics 都必须在首帧之后画 —— 比分条走 `_drawStaticGraphics`
  补画，且每次 `_startDealing()` 强制重建（牌桌可能刚从主菜单"隐藏过再显示"）；听牌芯片
  每次显示时重建。

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/infovis tools/ai-test/info-visibility-test.ts \
     assets/scripts/core/{Shanten,HuChecker,HuScore,Tile,TileDefine,Meld,MeldDetector,Wall,AIDefense}.ts \
     assets/scripts/game/{AIBrain,HintAdvisor,Player}.ts
node temp/infovis/tools/ai-test/info-visibility-test.js
```

五组：①各屏幕比例下比分条不压齿轮/上家手牌/副露行/听标记（含四位数分的最坏文案）
②听牌芯片不压满手 14 张牌与「你·听」标记、不侵入提示面板通道 ③文案格式**打真实
`HintAdvisor`**（花色合并、排序、张数口径）④刷新点与跨局归零的源码级断言
⑤座位名牌：上家在手牌右端之外、侧名牌在桌沿列且不压按钮行/手牌（含 3:2 / 4:3），
角标口径与 JSB 补画、跨局指纹归零的源码级断言。
出图：`python tools/preview-status.py`（16:9 / 21:9 / 超宽 / 竖屏）。

### 6h. 菜单内容页（设置规则 / 玩法说明）：字号优先，超出就滚动

主菜单的次按钮行是「设置规则 | 玩法说明」并排（各 330 宽，**纵向不多占一行**），
`MenuUI.showRules()` / `showHelp()` 切到两个内容页。

**2026-10-16 晚改版（用户反馈"文字和背景密密麻麻"）** —— 两条硬规则：

1. **字号优先，超出就滚动**：标题 36 / 说明 26 / 说明页正文 28、番型表 26~30，
   内容因此比视口高（设置页 +175px、说明页 +262px），两页共用
   `_createScrollPage()` 的滚动视口 + 右侧滚动指示条。校验脚本断言"滚动量在
   40~60% 屏高之间"，并卡住**字号下限**（标题 ≥34 / 说明 ≥24 / 正文 ≥26）——
   别为了塞进一屏又把字缩回去，那是这次改版要解决的问题本身。
2. **整页阅读底板**（`PAGE_DIM_COLOR`，alpha 175）：背景是麻将桌照片，文字直接压上去读不清。
   注意这与硬约束 12 里被用户删掉的"上下两条黑色渐变遮罩"**不是一回事**（那是两条渐变带），
   底板是整页均匀压暗、压在内容之下（`_addPageDim` 必须是页面的第一个子节点）。

**滚动实现的三条要点**（踩过就想不起来为什么这么写的）：

- **坐标系**：内容锚点取 `(0.5, 1)`、位置取视口顶边 → 内容局部 `y = 0` 就是内容顶边，
  页面元素从 0 往下排（负数），与 Cocos ScrollView 的边界模型（按"内容顶边 vs 视口顶边"
  判越界）一致，初始就在最上面。**别再用早期那版"把 content 原点挪到屏幕中心"的写法**
  （那是给静态单屏用的，滚动时会一开页就看到中间）。
- **滚动条**：位置由 `sv.getScrollOffset()`（顶=0、底=-max）与 `getMaxScrollOffset()` 反推，
  不自己算边界；内容没超出视口时整条不画；`update()` 里只在状态变化时重画。
- **首行不能被裁**：首行的标题上沿要 ≤ 0（内容顶边），否则会被 Mask 吃掉半截 ——
  `RULES_ROW_TOP = -40` 就是这么定的。
- **原生（JSB）**：阅读底板、章节分隔线、滚动条、按钮都是 Graphics/画出来的，
  `showXxx()` 与 `redrawBackdrop()` 里都要补画一遍（补画必须 `clear()` 后再画）。

**番型表的数据只能有一份**：`core/HuScore.ts` 的 `FAN_DEFS`（名称 / 番数 / 说明）
是唯一真源 —— `computeHu` 通过 `pushFan(fans, '清一色')` 取番数，
说明页 `buildFanRows()` 渲染同一张表。**判定里不许再出现写死的番数**
（测试会扫 `fan:` 后面有没有数字或 `FAN_*` 常量），README 的番型表也被同一脚本逐条核对。
连庄番数随次数变化，不进表，用导出的 `STREAK_FAN_MAX`。

说明页文案在 `MenuUI.HELP_SECTIONS`（纯数据：段落 / 正文行 / 是否带番型表），
版式只按行数往下排；`tools/preview-menu.py` **解析这份数组 + 设置页的选项组**出图 ——
预览里的文字与真机一致（手抄一份到预览里必然漂移）。

```bash
# 说明页版式
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/help tools/ai-test/help-layout-test.ts \
     assets/scripts/core/{HuChecker,HuScore,Tile,TileDefine,Meld}.ts
node temp/help/tools/ai-test/help-layout-test.js
# 设置规则页版式(读 MenuUI.ts, 不需要编译依赖)
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/l tools/ai-test/rules-layout-test.ts
node temp/l/tools/ai-test/rules-layout-test.js
```

两个脚本都从源码提取常量后**复刻排版算术**，断言：各段间距 > 0 且与常量一致、
内容/视口/滚动量合理、文字框逐行放得下（字号加大后最容易超宽）、
阅读底板与滚动条到位、原生补画接线齐全（说明页还打真实 `computeHu` 对番数）。
出图：`python tools/preview-menu.py`（主菜单 / 设置页 / 设置页滚到底 / 说明页 / 说明页竖屏）。

> 写这类脚本时注意：**跨行拼接的字符串常量不能按"第一个分号"截断** ——
> 文案里本身就有分号（`RULES_TIPS_TEXT` 就踩了），要取行尾那个分号，
> 并且把源码里的 `\n` 转义还原成真换行，否则"三行"的断言会全部落空。

### 6i. 菜单三页切换：淡出 → 淡入，只动 UIOpacity

主页面 / 设置规则 / 玩法说明三页的切换统一走 `MenuUI._beginShow(to)`
（`showHome` / `showRules` / `showHelp` 都是它 + 各自的补画），
`PAGE_FADE_OUT = 0.12s` → `PAGE_FADE_IN = 0.16s`（总 0.28s，看得出来但不拖沓）。

**三条硬规则**（踩过才知道为什么这么写）：

1. **过渡只碰 `UIOpacity`，不动位置/尺寸/层级**。布局仍由各自的构建函数定稿，
   于是"被打断 / 被跳过 / 在原生平台被隐藏"都不会留下半透明或半位移的残留。
2. **`_currentPage` 在开始切换那一刻就更新为目标页** —— "过渡中"不需要额外标志位，
   重复调用自然落到"已在目标页"这一支（只强制 `active=true` + `opacity=255`）。
   首次显示（`_currentPage` 为空，启动时 `onLoad → showHome`）不播动画，第一帧就该是主页面。
3. **每次切换递增 `_transitSeq`，回调里比对后作废过期动作**。旧补间里
   "淡出结束后隐藏旧页"那一刀可能正指向这一次的**目标页**：
   快速连点两次会让旧回调把刚淡入的页隐藏掉 —— 表现为"点了没反应"。
   切换开始时还要 `Tween.stopAllByTarget()` 掉两个页面上的旧补间。

`onDestroy()` 必须停掉三页上的补间（目标 UIOpacity 会随节点销毁，留着的补间会写已销毁组件）。

改动后跑：

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/v tools/ai-test/menu-fade-test.ts
node temp/v/menu-fade-test.js
```

它用假的 `tween`/`Tween` 跑**真实的 `_beginShow` 方法体**（不是复刻排版），
断言首显无补间、切换两条补间的时长与延迟、播完后的最终状态，
以及连点打断 / 过期回调作废 / 三页互斥这些只在真机上手才看得见的分支。

### 6j. 跨会话战绩：生涯长期保留，比分快照随会话结束清除

2026-10-16 新增（用户要求：累计分/连庄退出应用即清零，生涯统计要跨会话；
顺带解决"切后台被杀后比分丢失"）。

数据分两层，**生命周期不同，别混为一谈**：

| 数据 | 内容 | 什么时候写 | 什么时候清 |
|---|---|---|---|
| 生涯统计（`CareerStats`） | 总局数 / 胡牌次数 / 最高番 / 最高连庄 | 每局结算 | 永不（除非加"清空战绩"入口） |
| 会话快照（`SessionSnapshot`） | 四家累计分 + 连庄 | 每局结算 | **只有** `stopGame()`（返回主页面） |

要点：

- **落盘点只有一个**：`GameManager._endGame()`（胡牌与流局都走它），且必须在
  `onSettle` **之前** —— 结算面板显示的就是更新后的生涯。
- **恢复要能重试**：`onLoad` 与 `startGame` 各调一次 `_restoreSession()`。
  原生平台的 `sys.localStorage` 是 `sys.init()` 里**异步**挂上去的（之前它是个空对象，
  `getItem` 根本不存在），`onLoad` 那会儿多半还没就绪。`_restoreSession` 里"已经打过局
  就不再覆盖"的守卫不能删 —— 否则中途恢复会把这一局的分冲掉。
- **主动退出才清零**：切后台被杀、应用被回收都不算"结束会话"，所以只有
  `stopGame()` 调 `clearSession()`。这也正是这次要解决的问题本身。
- **存档"只读不写"的守卫不能删**：`CareerStore._ready()`。存储没就绪时 `_save()`
  必须直接返回 —— 否则会用内存里的空战绩**覆盖真存档**，历史成绩静默丢失且不报错。
  同理 `_ensureLoaded()` 只有在 `_ready()` 为真时才置 `_loaded`。
- **生涯统计是玩家口径**：只记"你"。流局涨局数，但不涨胡牌次数与最高番
  （没胡的一局 `fan` 传 0，不该把纪录刷成 0）。
- 一分两层：`CareerStats.ts` 只管"怎么算 / 怎么编解码"（纯函数，能 node 直跑），
  `CareerStore.ts` 只管"存到哪"（import `sys`，与 `GameRules.ts` 同一条分层例外）。

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/career tools/ai-test/career-persona-test.ts \
     assets/scripts/game/CareerStats.ts assets/scripts/game/AIPersona.ts
node temp/career/tools/ai-test/career-persona-test.js
```

### 6k. AI 拟人化：名字只能两个字，胡牌台词走结算面板

三家 AI 有名字与口头禅（`game/AIPersona.ts`，纯数据）。**只影响表现层**，
不参与任何决策计算 —— AI 强度恒为满能力档（硬约束 11）。

- **名字必须是 2 个汉字**。凡是显示座位名的地方（比分条四枚芯片、`xx·听` 标记、
  结算名牌）都是按"上家 / 左家 / 右家"这两个字的宽度排的，换成两字人名宽度分毫不差；
  三个字就会把比分条撑到整体缩放。名字出口只有 `GameManager.seatLabel()`，
  方位词 `SEAT_NAMES` 只留给日志与"吃/碰/杠来源"那种单字小牌子。
- **碰 / 杠 → 气泡，胡 / 点炮 → 结算面板**。牌桌气泡走 `onAISpeech`；但胡牌那一刻
  结算面板立刻用整屏遮罩盖住牌桌，此时冒气泡 = 闪一下就没了，所以那句台词随
  `SettlementData.speech` 显示在面板的"四家手牌"那一行右侧
  （`_showAISpeech` 里 `if (this._settlement?.isOpen) return` 是同一件事的另一半）。
- **吃不给台词**（频率高得多，每次都说话就是噪音；与震动同一口径）。
- **气泡贴在自己手牌上**：牌桌中间那条纵向带在横屏只有 10~100px（硬约束 2），
  浮过去必然压牌河或转盘；自己那排牌背上没有"正在变化的信息"，盖一两秒无妨，
  而且位置本身就是主语。左右两家再往外挪 `SPEECH_SIDE_DX`（60px）——
  侧边手牌的内侧就是自家弃牌河，残局第三排时牌河外沿已经快贴到手牌列了。
  `career-persona-test` 的 B4 组按最坏文案逐比例算过这些间隙。
- **计时用数组而不是 `scheduleOnce`**：一条台词 1.6 秒，而重开/返回随时会打断，
  排队的回调得逐个 `unschedule` 才清得干净；用"剩余秒数"跟着 `update` 走，
  `_clearTable()` 里把 `_aiBubbleHold` / `_aiBubbleFade` 归零就结束了
  （这两个字段已加进 `state-cleanup-test` 的 A 组字段表）。

### 7. 牌对象是引用，不是拷贝

`Meld.sourceTile` 用 `===` 比较；`Player.removeTileRef()` 按引用删。
改动牌流转时注意别把同一张牌既留在手里又留在副露里。

### 8. 胡牌判定必须在流局判定之前

`_afterDiscard()` 里顺序是 **先 `_beginRon()` 再判 `wall.remaining <= 0`**。
反了的话，牌墙摸空时打出的最后一张就永远无法被点炮。

### 8. 向听数必须与 `HuChecker` 对齐（AI 的地基）

`core/Shanten.ts` 是 AI 牌效的地基，它与 `HuChecker` 必须是**同一套判定**。
`Shanten.calc` 只有在下面三条同时成立时才允许被 AI 依赖：

- 14 张（`(4-副露)×3+2`）时 `calc === -1` ⟺ `HuChecker.isHu`
- 13 张（`(4-副露)×3+1`）时 `calc === 0` ⟺ `HuChecker.isTenpai` 非空
- `Shanten.ukeire` 的结果集合 == `HuChecker.isTenpai` 的听牌张

改动 `Shanten.ts` 后**必须**跑 `tools/ai-test/shanten-test.ts`（6000 手随机牌全量对拍）。
已踩过的坑：

- **将牌只能是对子**。公式 `8 - 2×(副露+面子) - 搭子` 会把「4 副露 + 两张不相干的牌」
  （如 三萬一萬，它们构成嵌张搭子）算成 -1，但凑不成将。`calc` 末尾单独处理了这个边界。
- **七对/十三幺必须加前置条件**，否则会算出假的好成绩：
  - 七对要求每种牌 ≤ 2 张（`_canBeChiitoitsu`）
  - 十三幺要求非幺九牌 ≤ 1 张（`_canBeThirteenOrphans`）
  不加限制时，一手普通牌只要恰好凑了点幺九就凭空少好几个向听，AI 会拆顺子去追一个做不到的牌型。
- **不要拿「打出后的 13 张」去减「现在的 14 张」**：公式按张数口径不同，14 张会多算一张，
  两者相减会让评分完全错乱。所有出牌候选都统一用 13 张口径横向比较。

### 9. 断幺在本项目没有番

`HuScore.ts` 的番表里**没有断幺**。所以 AI 不要为了断幺保留幺九
（`Profile.prefersTanyao` 保持 false），那只会白白打乱牌型、拖慢速度。
但 `AIDefense` 里「对手在做断幺」的**读牌**仍然有价值 —— 那是防守用的，别一起关掉。

### 10. AI 只能看到公开信息

`GameManager._buildAIContext(seat)` 组装上下文时**不能把别家的手牌给 AI**。
可用：自己的手牌、所有人的弃牌与副露、自己手牌+副露+弃牌的可见张数。
（作弊的 AI 会让整个难度体系失去意义。）

### 11. AI 恒为满能力；玩家决策 20 秒超时自动处理

**AI 难度不再可调**：`GameRules.difficultyOfDelay()` 恒返回 `'expert'`，
设置页的"AI 思考速度"三档已移除。原因：速度档同时决定强度，
让玩家用"速度"换"难度"不合理。`AI_DELAY`(0.9s) 只保留为**出牌节奏延时**，
不参与任何计算量控制 —— 也不存在"因为时间不够而少算"的逻辑，
AI 每次决策都是一次性算完（实测 0.31ms/回合）。

**决策超时**（`GameManager.DECIDE_LIMIT = 20`）：
只在**玩家需要做决定**时计时，AI 回合不计时（AI 本来就自己走）。

| 场景 | 起计时点 | 超时动作 |
|---|---|---|
| 玩家摸完牌要出牌 | `_playerDraw` 末尾 | `playTile(_playerDrawnTile 的下标)` —— 直接打掉**刚摸的那张** |
| 杠后补摸要出牌 | `_continueAfterKanDraw(0)` | 同上 |
| 副露选择面板弹出 | 三处 `_awaitingPlayerMeld = true` | `resolvePlayerMeld(-1)` 一律"过" |

**计时状态只有一份**：`GameManager` 持有，Main 的倒计时显示只读 `decideRemain`/`decideLimit`，
不要在 UI 侧再存一份计时器（两套会走偏）。
起计时 6 处、停计时 6 处；`_clearDecisionTimer()` 挂在
`playTile` / `resolvePlayerMeld` / `cancelPendingMeld`，而
`startGame`/`stopGame`/`_endGame` 都经过 `cancelPendingMeld()`，所以结束路径自动覆盖。

**为什么超时打"刚摸的牌"**：那张牌一定在手牌里、一定打得出去，
不会产生非法出牌；行为也可预期（用户原话："不管三饼对我是否有用"）。
副露则一律"过"，因为副露会**永久**失去门清+1番与立直资格，
发呆的成本不该由系统替玩家承担。

验证：`node temp/<out>/tools/ai-test/timeout-test.js`
（该脚本从**真实源码**里提取 `update()` 方法体执行，不是手抄副本，避免测试与实现漂移）

### 11. 音频：改设置必须显式同步到播放器

`AudioSource.volume` **在 `play()` 时就固定了**，之后改 `GAME_RULES` 不会让
"正在播放的 BGM"变化。所以设置页每次改音量/开关后都要调 `syncAudioSettings()`，
它负责：开关关 → `stopBgm()`；在播 → 同步 `volume`；没在播 → `playBgm()` 补播。

**关开关必须 `stop()`，不能只把音量设 0**：否则播放器仍占用，且 `playBgm()`
里"已在播就返回"的早退分支会把后续补播挡掉，留下"静音但仍在播"的僵尸状态。

音效没有这个问题：`playOneShot(clip, volume)` 每次都传当前音量，天然即时。
音量不写死在 `Sound.ts`，一律运行时读 `GAME_RULES`。

### 11b. 牌型播报：出牌/副露/胡牌发声

39 个播报文件放在 `assets/resources/audio/`（34 张牌 + 吃/碰/杠/胡/过），
文件名与桌面 `mahjong/` 源文件夹保持一致：

| 类别 | 文件名 | 映射 |
|---|---|---|
| 数牌 27 | `1wan`~`9wan` / `1tiao`~`9tiao` / `1tong`~`9tong` | `TILE_VOICE_NAMES[紧凑下标]` |
| 风牌 4 | `dongfeng` `nanfeng` `xifeng` `beifeng` | 同序于 `FENG_CHARS` |
| 箭牌 3 | `hongzhong` `facai` `baipi` | 中/发/白，**文件名是俗名不是字面** |
| 动作 5 | `chi` `peng` `gang` `hule` `guo` | `MeldType` → 动作词 |

**接线点（都在 `Main.ts`）**：

| 事件 | 回调 | 播什么 |
|---|---|---|
| 任意一家出牌 | `_animateRiverDrop()` | `playTileVoice(tile)` — 按牌型 |
| 吃/碰/杠（自家与 AI 都会走） | `onMeld` | `playMeldVoice(meld.type)` |
| 胡牌 | `onSettle` 且 `kind === 'hu'` | `playHuVoice()` |
| 玩家点"过" | `_onMeldChoiceClick(index < 0)` | `playPassVoice()` |

**两个必须记住的坑**：

1. **胡牌播报不能挂 `onHu`**：`_endGame()` 里流局也会走 `_fireHu(message)`，
   挂上去流局会播"胡了"。只有 `onSettle` 能用 `data.kind` 区分 `'hu'` / `'draw'`。
2. **新增 mp3 必须同时建 `.meta`，且 uuid 唯一**。UUID 重复不会报错，
   只会让两个音频互相覆盖（表现为"播出来是另一个音"），极难靠肉眼发现。

改映射表（换文件命名、调音量）后**必须**跑：

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/v tools/ai-test/voice-map-test.ts
node temp/v/voice-map-test.js
```

它从**真实源码**提取映射逻辑，与磁盘上的 mp3 + meta 三方对拍，复核
34 种牌型无缺漏、预加载名单一致、文件与 meta 都在、uuid 全局唯一。
**少一个文件不会抛异常** —— `play()` 里 clip 缺失是静默跳过的，只能靠脚本兜。

### 11c. 播报重叠：别家响应必须晚于牌名播完

牌名播报 0.2~0.4s，而"吃/碰/杠/胡"原本是**同帧**触发的
（`_afterDiscard()` 同步直接调 `_checkMelds()`），两段声音叠在一起，
真机听感是"一坨"，什么都分不清。

修法是**加反应间隔**而不是改音量：`GameManager.MELD_REACT_DELAY = 0.45`
把流程拆成 `_afterDiscard()`（立刻置 `DISCARDING` + 起延时）
与 `_resolveAfterDiscard()`（0.45s 后才真正判吃胡/副露/下家摸牌）。

**`DISCARDING` 这个状态不能省**。它是"牌已打出、流程还没往下走"的真实空档，
必须与 `PLAYER_TURN`/`AI_TURN` 区分，否则这段空档里玩家还能点手牌，
而 `playTile` 因 `_canDiscard=false` 拒绝 —— 表现为"点了没反应"，像卡死。

**UI 判断"进行中"一律用 `gm.isTurnRunning`，不要手写枚举。**
`Main.ts` 曾写 `phase === PLAYER_TURN || phase === AI_TURN`（指针脉冲 + 指向），
漏掉 `DISCARDING` 后每次出牌指针都暗一下再亮起来 —— 一次出牌一次闪烁。
这类"新增枚举值 → 旧比较表达式漏覆盖"的坑，脚本断言里已加防回归。

改动相关时序后跑：

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/v tools/ai-test/voice-timing-test.ts
node temp/v/voice-timing-test.js
```

它从源码取 `MELD_REACT_DELAY`/`AI_DELAY`、从**真实 mp3 量时长**对拍：
反应间隔 ≥ 最长牌名播报、≤ 0.8s（AI 不显迟钝）、≥ 0.15s（短到不像停顿像卡顿）、
副露→下一张牌名不重叠，外加状态机完整性断言。
**换一批更长的语音就会重新叠上**，而这在编辑器里看不出来，必须真机听。

### 11d. 震动反馈：碰杠震一下，胡牌重一点，流局不震

反馈在 `assets/scripts/feedback/Haptics.ts`（只依赖 `cc` 的 `sys`，无节点依赖），
两个入口：`vibrateMeld()` 30ms、`vibrateHu()` 60ms。接线点同样在 `Main.ts`：

| 事件 | 回调 | 条件 |
|---|---|---|
| 碰/杠（自家与 AI 都震，与语音同口径） | `onMeld` | `meld.type !== 'chi'` |
| 胡牌 | `onSettle` | `data.kind === 'hu'` |

**四个必须记住的点**：

1. **胡牌震动不能挂 `onHu`** —— 与 11b 同理，流局也会走 `_fireHu`。
2. **吃牌不震**：吃只在下家，频率高于碰杠，每次都震会变成噪音；
   "改变局面"的是碰杠（抢别人的牌）与胡牌。
3. **原生接口收"秒"，Web 收"毫秒"**：`cc::Device::vibrate(float seconds)`，
   所以模块里用毫秒定义、调用处 `ms / 1000`。iOS 上引擎 3.8 的 Vibrator 是空实现，
   照常调用、不特判。
4. **jsb 上 `Device`/`device` 两种大小写都要探测**：引擎各版本绑定名不一致，
   且 `temp/declarations/jsb.d.ts` 里**没有** `vibrate` 的类型声明 ——
   只能运行期探测，谁有 `vibrate` 用谁，都没有就静默跳过，全程 `try/catch`。

**Android 必须声明 `android.permission.VIBRATE`，否则真机不会震（也不报错）**：
引擎 Java 侧把 `SecurityException` 吞了，而 baseline APK 是从引擎模板出的，
模板清单里**没有**这条权限。所以：

- `native/engine/android/app/AndroidManifest.xml` 已补上（走完整构建时用得到）；
- 快迭代（`tools/patch-apk.ps1`）解包后、repack **之前**调
  `tools/patch_manifest_vibrate.py` 往**二进制 AXML**里注入（幂等，已有则跳过）。
  顺序不能反，否则打包的还是旧清单。

改动后跑：

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/v tools/ai-test/haptics-test.ts
node temp/v/haptics-test.js
```

它复核平台守卫、时长口径、Main 接线（含"流局不震"）、权限链顺序，
并在 `temp/apkpatch/` 有产物时**直接读二进制 manifest**核对 VIBRATE 与根 chunk 尺寸。
**权限漏了在电脑上看不出任何异常**，只有真机不震 —— 必须机器复查。

### 12. 设置页是全屏 + 滚动，没有居中面板

> **2026-10-16 晚补充**：用户随后反馈"文字和背景密密麻麻"，于是这一页**改成了可滚动**
> （字号 30→36 / 20→26，内容比视口高 175px）并加了整页阅读底板 —— 见硬约束 6h。
> 下面这段"9 行一屏就装得下"的历史结论**只说明当时的取舍**，别再拿它当"必须一屏装下"的依据；
> 但"不要居中深色面板"这条仍然有效（面板白吃上下各 50px，滚动也救不回那种浪费）。

规则页**不要**再画居中深色面板。曾经的 `PANEL_H=940` 装在 `MENU_CONTENT_H=1040` 里，
内部可用纵向只有 703px，导致 9 个"标题+说明"的选项（每行 76px，需 998px）根本排不下 ——
当时误以为是行距问题，在面板内反复调了两轮，**方向错了**。

去掉面板后可视高度 703→941px，9 行只需 832px，**一屏就装得下**。

- 背景可读性只靠主页/设置页共用的 `MenuMask` 整页渐变（上深下浅）。
  设置页自己的上下两条黑色半透明渐变（原 `_paintRulesFade`）与"规则设置"标题
  已于 2026-10-15 应用户要求删除，**不要再加回来**；校验脚本对这三者的缺失有断言。
- 返回/恢复默认在**左上角**顶部一行（原标题所在行，`RULES_TOP_Y=474`），不占底部纵向。
- `_createRulesScroll()` 提供 ScrollView 作兜底：内容超出视口时可拖动。
  当前 832 < 944，ScrollView 自动不响应拖动 = 等同静态布局。
- **`ScrollView.content` 的原点在视口中心，而 `RULES_ROW_YS` 按全屏中心 y=0 设计**，
  必须 `content.setPosition(0, -viewCenterY, 0)` 补偿，否则整体上移 40px。
  校验脚本对此有断言。

**层次铁律：行内间距 < 行间间距。** 曾有 `CAPTION_DY=16 / HINT_DY=-18`，
行内仅 9px 而行间 31px —— 项内比项间还挤，看不出"一行是一个选项"（真机截图确认）。
加大行距解决不了，只会让标题和自己的说明贴得更紧。

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/l tools/ai-test/rules-layout-test.ts
node temp/l/rules-layout-test.js
```

脚本从源码提取真实常量，复核：①全屏内不溢出 ②段间距为正且**项间 ≥ 20、行内 < 行间**
③标题列与按钮列不撞车 ④滚动视口坐标系对齐 ⑤居中面板/标题/上下遮罩确已移除。

其他坑：
- **横向**：按钮列可用宽 564px，4 个 170px 按钮会压到文字列。
  `_buildChoiceGroup` 已改成按选项数**自适应按钮宽**（4 键时 129px）。
- **`RULES_TIPS_H` 同时是版式参数与 Label 框高**：改提示行数必须同步改它。
- **超宽屏要看实际像素**：截图 1043×466 → `scale=0.448`。
  字号与行距同比例缩放，所以拥挤程度与 scale 无关，只看设计值里的比例关系。

### 13. AI 提示：必须与 AI 走同一条评估路径

玩家的"提示"功能**不是**另写一套启发式。`AIBrain.rankDiscards/rankMelds`
把原来私有的评分函数开放出来并返回明细（score + 向听/进张/危险度），
`HintAdvisor` 只负责把这些数字翻译成中文。**提示首选 === AI 实际会选的牌**。

```ts
static rankDiscards(ctx): DiscardEval[]   // 按分数降序
static rankMelds(ctx, candidates, tile): MeldEval[]
```

`chooseDiscard` / `chooseMeld` 现在是这两个方法的一行封装。
**若日后有人把提示改成独立逻辑，"说一套做一套"就是必然结果** ——
玩家按提示打反而吃亏, 比没有提示更糟。

两条必须守住的不变量:
- **只用公开信息**：`GameManager._buildAdviceContext` 就是 `_buildAIContext(0)`,
  玩家只额外知道自己的手牌 —— 等于把 AI 的思考过程透明讲出来, 不是让 AI 透视玩家手牌。
- **立直锁同样生效**：`rankDiscards` 在 `declaredTenpai` 时只保留"打完仍听牌"的候选。

**提示必须随局面失效**：`GameManager._clearDecisionTimer` 里调 `clearHint()`。
出牌/选副露/结束牌局都经过 `_clearDecisionTimer`, 所以只挂这一处就够。
留着旧提示 = 显示过期的"建议打 X", 比不显示更糟。

验证（30 项，从真实源码跑，不手抄）：

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/hint tools/ai-test/hint-test.ts \
     assets/scripts/core/{Shanten,HuChecker,HuScore,Tile,TileDefine,Meld,MeldDetector,Wall,AIDefense}.ts \
     assets/scripts/game/{AIBrain,HintAdvisor,Player}.ts
node temp/hint/tools/ai-test/hint-test.js
```

> 写这类测试时注意**牌的张数口径**：立直用例必须造 **14 张**
> （打出后 13 张才是合法的"待摸形状"）。用 13 张去测, `rest` 变成 12 张,
> 测出来的是伪问题, 不是实现 bug。

### 13b. 提示面板：横屏几乎没有纵向空间，必须自适应

牌桌纵向是"贴边排布"的, 横屏时中间那条带极窄。实测各比例下
**吃/碰按钮行上沿到转盘下沿**只有 10~100px —— 写死高度的面板必然压到东西。

`Main._placeHintPanel()` 的做法：算按钮行**上方/下方两条通道**的净空,
取宽的那条, 再把可用高度交给 `HintPanel.fit(maxH)` ——
整体缩放, 缩到 `MIN_SCALE`(0.62) 仍不够就**砍掉次选**（次选是锦上添花, 首选与理由必须有）。

三条硬性落位约束（版式校验逐比例断言）:
1. **不压中央转盘/倒计时** —— 那是正在变化的信息, 盖住玩家就失去时间感
2. **不压手牌** —— 提示之后玩家要立刻点那张牌, 手牌区必须始终可点
3. **不压吃/碰按钮行** —— 玩家要点它们做决定

`HINT_BREATH`(8px) 是贴到边界时保留的呼吸位: 没有它算出来是
`panelBottom == handTop`, 看起来像贴在一起。

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/hintlayout tools/ai-test/hint-layout-test.ts
node temp/hintlayout/hint-layout-test.js
```

出图确认（会镜像 `Main._applyLayout` + `HintPanel._buildContent` 的真实常量）：

```bash
python tools/preview-hint.py   # 16:9 / 21:9 / 超宽 / 竖屏 四张
```

> 预览脚本踩过的坑（都会让预览**骗人**）:
> - PIL 默认字体没有 CJK 字形 → 满屏豆腐块。已按优先级找系统字体(msyh.ttc/Deng.ttf)。
> - 卡片局部坐标 y 向上、画布像素 y 向下, 漏了取负会让所有行**上下颠倒**。
> - 内部排版必须**逐行复刻** `_buildContent` 的游标写法; 另写一套会把次选画到卡片外。

### 13c. 将牌被面子吃掉：`Shanten.calc` 曾错报"已和牌"

**症状**：听牌是"单钓"时，提示显示"N 张进张"大得离谱（实测一手单钓东的牌显示
**13 种**进张，而 `HuChecker.isTenpai` 只认东）。直接违反硬约束 8。

**根因**（已修）：`sets >= 4` 那一支用**全局计数**判断将牌：

```ts
// 旧代码：只看"手牌里有没有任何一对"
for (let i = 0; i < TILE_TYPE_COUNT; i++) if (counts[i] >= 2) hasPair = true;
if (sets >= 4) { if (hasPair) return Shanten.WIN; ... }
```

那个对子可能**已经被面子消耗掉了**：

```
一萬一萬 二萬…九萬 一條二條三條 东   (14 张)
面子 一二三萬 / 四五六萬 / 七八九萬 / 一二條三条 用掉了两张一萬中的一张，
剩下「一萬 + 东」凑不成将 → **不是和牌**
但 counts[一萬] === 2 让 hasPair 判真 → 错报 -1
```

对 **13 张**的待摸形状危害更大：13 张**不可能是和牌**，但只要"能拆出 4 个面子 + 手上有对子"
就会被报成 -1。而 `_scoreDiscard` 恰恰用 13 张的 rest 打分，
`score = -shanten × 100` → 这些候选白拿 **+100 分（整整一个向听档）**。
实测 4347 个决策点里 **117 个（2.7%）** 含这类虚假候选。

**修法**：新增 `_canWinWithPair` / `_canFormSets` —— 枚举将牌候选，再验证剩下的牌
能否**恰好**拆成 (4-副露) 个面子（数牌可顺子且不跨花色，字牌只能刻子）。
只在 `sets >= 4` 这支走这条较贵的路径，常见路径不受影响（实测 perf 0.297→0.300ms）。

**回归**：`shanten-test.ts` 的手工用例改为**断言式**（原来只 `console.log`，
于是错期望值一直没被发现 —— 其中 `tp1` 那条的期望 `-1` 恰恰就是本 bug 本身，
测试反而把 bug 固化了下来）。新增用例覆盖：将牌被吃掉(13/14 张)、
4 面子+2 孤张不成对、刻子与将牌同型、进张只有东。
**能断言的期望值一定要断言，否则等于没测。**

### 13d. 进张的两个口径：评分用"种类数"，显示用"张数"

`Shanten.ukeire()` 返回的是**牌型种类**（每型一张 Tile）。`DiscardEval` 因此有两个字段：

| 字段 | 含义 | 用途 |
|---|---|---|
| `ukeire` | 种类数 | **评分**（`×10` / `sqrt(×12)` 的权重是按这个量级调的） |
| `ukeireTiles` | Σ(4 − 可见张数) | **显示**（提示里"N 张进张"玩家理解的就是这个数） |

为什么评分不改成张数：实测（交换座位 A/B，各 400 局 ×2）**无胜率收益**（−0.43pt，
在噪声内），而改口径会连带改变"牌效 vs 防守"的平衡、需要重新调参 —— 无收益的改动不做。

为什么显示必须用张数：单钓只剩 2 张时，种类数是 1 —— 显示"1 张进张"会让玩家
按错误的数判断。这是**给玩家看的数字必须真实**，与评分口径是两件事。

### 13e. 孤张字牌：同分决胜项曾让字牌永远输给数牌

**症状**：玩家手上有字牌，提示却建议打数牌（尤其是孤张风/箭牌）。

**根因**（已修）：`rankDiscards` 的排序决胜项是**手牌下标**：

```ts
list.sort((a, b) => (b.score - a.score) || (a.index - b.index));
```

而理牌后字牌恒排在手牌末尾。当多张候选的 `(向听, 进张, 危险度)` **完全相同**时
（常见于牌型散乱的垃圾牌），胜负就由下标决定 —— 于是**孤张字牌永远赢不了**
排在它前面的任何一张数牌。构造一组全同分手牌即可复现：12 张孤立牌
（三花色各取 1/4/7 + 三张字牌）的 score 精确相等。

**修法**：在 `_keepValue` 里给**孤张字牌 +2**（不是 -2！见下），让它压过同样
"没用"的孤张数牌，但仍低于"有对子"(+6) —— 成对字牌照旧被保留。

> ⚠️ **符号方向**：`_keepValue` 是被 `score +=` 加进"越高越该打"的分数里，
> 所以孤张字牌要更该打就必须**加分**。先写成 `value -= 4` 时结果完全相反
> （孤张字牌分数变低、更不容易被打，实测"该打字牌"的比例从 31.8% 掉到 54.7%）。
> **评分符号改错不会有任何报错, 只会安静地反向生效 —— 必须用 A/B 数字验。**

**影响面**：真实对局里只有 **0.74%** 的出牌决策因此改变，其余 99% 不受影响。
`strategy-test` 的胜率数字有 ±7pt 量级的运行间噪声（150 局样本），
不要拿两次结果的小幅差异判断改动好坏。

**回归**（`hint-test.ts` 第 4 组，共 34 项）断言三件事：
① 全同分时首选是孤张字牌 ② 孤张字牌分数不低于首选 ③ 成对字牌仍排在孤张之后。

> 写这类测试时踩的坑：`makeHand` 早期只认 `m/t/p` 三个前缀，`else` 兜底成筒 ——
> 于是 `f1 j1 j3` 被解析成三张"一筒"，**测试看着有字牌其实根本没有**。
> 加新花色前缀时务必同步，并打一遍实际牌面确认。

---

## 架构约定

### AI 难度分档：速度同时决定强度

`aiDelay` 不只是「想多久」，还决定「想多聪明」——`GameRules.difficultyOfDelay()` 换算：

| 档位 | delay | 牌效 | 防守 | 副露 |
|---|---|---|---|---|
| `reckless` 快 | ≤0.35 | **原版启发式**（刻子30/对子15/搭子8），不算向听 | 无 | 见牌就收 |
| `balanced` 常规 | ≤0.7 | 向听数 + 进张 | 轻度 (0.4) | 看牌型 |
| `expert` 慢 | >0.7 | 向听数 + 进张 | 强 (0.9) | 保门清/清一色 |

**快档必须真的笨**：如果三档都跑同一套向听算法、只调权重，玩家感觉不到差别。
`useEfficiency: false` 是刻意的——它保留升级前的原始算法。

**不要用胜率单独衡量慢档**：慢档是「防守型」加强，胜率与常规档基本持平
（实测差 ±0.3pt，在噪声内），但**场均分更高**（少被点炮）。
判断强弱要看 `tools/ai-test/strategy-test.ts` 的两个维度。

**评测必须用交换座位法**：座位 0 是一家、座位 1-3 是三家，
1:3 的局面天生偏向三家，直接比胜率会得出「强 AI 更弱」的错误结论。
正确做法是比较 `runBatch(A,B)` 与 `runBatch(B,A)` 中 A 单独上场时的表现。

⚠️ **`strategy-test` 的胜率数字有 ±5pt 量级的运行间噪声，且这是先天决定的**：
`reckless` 档 `noise: 45`、`balanced` 档 `noise: 2`，都由**未播种的 `Math.random()`**
喂（`_scoreDiscard`/`_scoreMeld`/`rankMelds` 里共 3 处）。
同一份源码连跑两次，`expert vs reckless` 实测出现过 +32.8 / +30.3 / +25.8 三种结果。
所以：
- **绝不要拿两次运行的胜率差判断某个 AI 改动的好坏**（差值小于 ~7pt 一律是噪声）。
- `expert vs balanced` 那条断言在 150 局样本下本身就不稳（同一份源码出现过
  +1.3 通过 / -3.5 失败），**它报红不代表回归**，先确认改动影响面（用采样脚本
  数"首选变化率"）再下结论。
- 要判断改动是否有害，看**行为断言**（无非法操作、立直不打坏听牌、
  `rankDiscards` 首选 === `chooseDiscard`）与**影响面百分比**，而不是胜率。

### 纯逻辑层可以脱离引擎单测

`core/` 全部文件、以及 `game/Player.ts`、`game/AIBrain.ts` **不 import `cc`**
（唯一例外是 `game/GameRules.ts`，它要用引擎的 `sys` 读写 localStorage）。
验证它们不需要开编辑器：

```bash
TSC="/c/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/bin/tsc"
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir <out> temp/hutest/main.ts \
     assets/scripts/core/{HuChecker,HuScore,Tile,TileDefine,Meld}.ts
node <out>/temp/hutest/main.js
```

（`tsc` 用 Cocos 自带的那份（上面的路径）或 `<workspace>/node_modules/typescript/bin/tsc`；
项目自带 `temp/tsconfig.cocos.json` 提供 `cc` 类型声明。
`tsconfig.json` 已把 `tools/` 排除，因为那里的验证脚本是 node 环境、
可以用 ES2016+ 的 API，而项目本体受 `target: ES2015` 限制。）

### AI 改动的验证脚本

`tools/ai-test/` 下有三个纯 node 脚本，编译后直接跑：

| 脚本 | 作用 | 期望 |
|---|---|---|
| `shanten-test.ts` | `Shanten` 与 `HuChecker` 全量对拍 | 和牌/听牌/进张 三项 100% 一致 |
| `strategy-test.ts` | 难度分档行为 + 三档强度对比 | 全部通过；强档胜快档 >5pt 且场均分更高 |
| `perf-test.ts` | 单回合决策耗时 | expert ≈ 0.3ms（远小于最短延时 220ms） |
| `timeout-test.ts` | 20 秒决策超时与自动动作 | 全部通过（从真实源码提取 `update()` 执行） |
| `career-persona-test.ts` | 生涯统计口径 / 存档编解码 / AI 名字台词 / 战绩与台词的接线与气泡落位 | 全部通过 |

跑法（`TSC` 路径同上）：

```bash
node "$TSC" --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir temp/aitest tools/ai-test/*.ts \
     assets/scripts/core/{Shanten,HuChecker,HuScore,Tile,TileDefine,Meld,MeldDetector,Wall,AIDefense}.ts \
     assets/scripts/game/{AIBrain,Player}.ts
node temp/aitest/tools/ai-test/shanten-test.js
node temp/aitest/tools/ai-test/strategy-test.js   # 约 3 分钟(N=600)
node temp/aitest/tools/ai-test/perf-test.js
```

`simulator.ts` 实现了自摸**与点炮**——只测自摸的模拟器会让防守显得毫无价值，
测出来的难度差异是假的。

### GameManager 用事件回调驱动 UI，不直接碰节点

```
GameManager 持有牌局状态与规则，通过 onXxx 回调通知 UI：
  onHandChanged / onDiscardChanged / onPhaseChanged / onAIHandChanged / onAIDiscard
  onMeld / onPlayerMeldChoice / onTenpai / onTenpaiChanged / onNotice
  onHu / onReveal / onSettle / onAISpeech
```

改玩法逻辑**只动 `GameManager`**，不要在 UI 里写规则。新增回调记得在 `Main._registerEvents()` 里接上。

### 回合调度顺序

座位 0=自己(下)，逆时针轮转：**自己(0) → 右家(3) → 上家(1) → 左家(2)**
（`NEXT_SEAT = [3, 2, 0, 1]` —— 沿桌边逆时针，不是跨桌直连）

出牌后流程：`_afterDiscard()` → 吃胡(一炮多响) → 流局判定 → 吃碰杠 → 下家摸牌

### 计分口径

- 番型在 `core/HuScore.ts`：**`FAN_DEFS` 是唯一真源**（名称 / 番数 / 说明），
  `computeHu` 通过 `pushFan` 从中取番数，玩法说明页渲染同一张表（见硬约束 6h）；
  底分 1 分、每番翻倍、8 番封顶（= 256 分），连庄最多 `STREAK_FAN_MAX`(3) 番
- 支付：自摸 = 三家各付一份；点炮 / 抢杠 = 付分方一次付清（一炮多响时付给每个赢家）；
  流局不得分且连庄不中断
- `HuChecker.analyze()` 返回牌型拆解，**同一手牌多种拆法时优先返回对对胡**（番数更高）
- `_scores` / `_streaks`（累计分 / 连庄）**跨局保留**，只有 `stopGame()` 清零 —— 单局内不可能有第二次连庄。
  2026-10-16 起每次结算还会落盘，下次启动自动恢复（详见硬约束 6j）

---

## 验证工作流

改完代码至少跑这两步：

**1. 类型检查**

```bash
node <workspace>/node_modules/typescript/bin/tsc --noEmit --skipLibCheck -p tsconfig.json
```

当前**全绿**（历史遗留的 `UIFactory` 类型错误已于 2026-10-16 修复）。

**2. 视改动类型选验证方式**

| 改了什么 | 怎么验 |
|---|---|
| `core/` `game/` 纯逻辑 | 编译后 node 直跑断言（见上） |
| UI 布局 / 自适应 | 写脚本镜像常量与布局函数，跑数字：①各分辨率不溢出 ②所有段间距 > 0 ③行内元素最坏组合不撞车 ④文字框够宽不触发 SHRINK。**光看代码算不出重叠，真机截图也得看** |
| 玩法流程 | 跑一局，连点验证；控制台有 `[胡牌]` `[续杠]` `[抢杠]` `[立直]` `[听牌]` 等日志 |

---

## Git

远程：`git@github.com:LE0ZHU/cocos-mahjong.git`（分支 `master`）

**必须用 SSH**。本机 HTTPS 访问 github.com 被阻断（直连失败、代理 CONNECT 返回 502），
SSH 22 端口可用且已认证。换 `https://` 地址会推不上去。

`.gitignore` 已忽略 `library/ temp/ local/ build/ profiles/ native/ node_modules/` 与 `.workbuddy/`。
**新增的 `.ts` 文件要一并建 `.ts.meta`**（Cocos 用它做资产标识），否则构建时可能不认。

---

## 代码风格（跟随现有代码）

- 全中文注释，重点解释**为什么**这么写，不是复述代码在做什么
- 纯逻辑类用 `export class` + `static` 方法，不继承 `Component`
- 私有字段 `private _xxx`，公开只读 `get xxx()`
- 坐标系注释写清楚是屏幕坐标还是内容坐标
