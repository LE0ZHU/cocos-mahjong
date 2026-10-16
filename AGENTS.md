# AGENTS.md

给 AI 助手的工作说明。**动手前先读「硬约束」一节，那里每一条都对应一个真实翻过车的坑。**

---

## 项目速览

- Cocos Creator 3.8.8 + TypeScript，单场景（`assets/game.scene`），全部 UI 由代码构建
- `assets/scripts` 共约 7300 行；`Main.ts`(1896) 与 `GameManager.ts`(1168) 是两个大头
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
| 16:9 (1920×1080) | 472 | 945 |
| 19.5:9 (2340×1080) | 387 | 775 |
| 21:9 (2520×1080) | 360 | 720 |
| 竖屏 | 1867 ~ 4200 | — |

⚠️ **别把全高当半高用**。本节早期版本只写了 945/720 那一列（全高），
而 `_applyLayout(halfH)` 收的是**半高**，差一个 2 倍 —— 照抄会把面板排到屏幕外。

结算面板最初把高度写死 940，只在恰好 16:9 时成立，手机横屏溢出 82~110。
**要完整可见的 UI 必须接 `_applyLayout(halfH)` 里的 halfH 动态计算。**
（横向无需处理：内容 x 恒为 ±840，宽度 < 840 的元素不会横向溢出。）

⚠️ **横屏时牌桌中间那条纵向带极窄**。21:9 下"吃/碰按钮行上沿 → 转盘下沿"
只剩约 10px，16:9 也只有约 100px。浮动面板**不能写死高度**，
必须按可用空间缩放（见硬约束 13b 的 `HintPanel.fit`）。

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

### 12. 设置页是全屏 + 滚动，没有居中面板

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
  onHu / onReveal / onSettle
```

改玩法逻辑**只动 `GameManager`**，不要在 UI 里写规则。新增回调记得在 `Main._registerEvents()` 里接上。

### 回合调度顺序

座位 0=自己(下)，逆时针轮转：**自己(0) → 右家(3) → 上家(1) → 左家(2)**
（`NEXT_SEAT = [3, 2, 0, 1]` —— 沿桌边逆时针，不是跨桌直连）

出牌后流程：`_afterDiscard()` → 吃胡(一炮多响) → 流局判定 → 吃碰杠 → 下家摸牌

### 计分口径

- 番型在 `core/HuScore.ts`，底分 1 分、每番翻倍、8 番封顶
- `HuChecker.analyze()` 返回牌型拆解，**同一手牌多种拆法时优先返回对对胡**（番数更高）
- `_scores` / `_streaks`（累计分 / 连庄）**跨局保留**，只有 `stopGame()` 清零 —— 单局内不可能有第二次连庄

---

## 验证工作流

改完代码至少跑这两步：

**1. 类型检查**

```bash
node <workspace>/node_modules/typescript/bin/tsc --noEmit --skipLibCheck -p tsconfig.json
```

`UIFactory.ts:757` 有一处**历史遗留**报错（`{x,y}` 传给要 `Vec3` 的参数），不是新引入的。

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
