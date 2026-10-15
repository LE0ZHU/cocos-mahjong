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

| 屏幕 | 可见内容高 |
|---|---|
| 16:9 (1920×1080) | 945 |
| 19.5:9 (2340×1080) | 775 |
| 21:9 (2520×1080) | 720 |
| 竖屏 | 2600 ~ 4200 |

结算面板最初把高度写死 940，只在恰好 16:9 时成立，手机横屏溢出 82~110。
**要完整可见的 UI 必须接 `_applyLayout(halfH)` 里的 halfH 动态计算。**
（横向无需处理：内容 x 恒为 ±840，宽度 < 840 的元素不会横向溢出。）

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

### 7. 牌对象是引用，不是拷贝

`Meld.sourceTile` 用 `===` 比较；`Player.removeTileRef()` 按引用删。
改动牌流转时注意别把同一张牌既留在手里又留在副露里。

### 8. 胡牌判定必须在流局判定之前

`_afterDiscard()` 里顺序是 **先 `_beginRon()` 再判 `wall.remaining <= 0`**。
反了的话，牌墙摸空时打出的最后一张就永远无法被点炮。

---

## 架构约定

### 纯逻辑层可以脱离引擎单测

`core/` 全部文件、以及 `game/Player.ts`、`game/AIBrain.ts` **不 import `cc`**
（唯一例外是 `game/GameRules.ts`，它要用引擎的 `sys` 读写 localStorage）。
验证它们不需要开编辑器：

```bash
node <tsc> --target ES2020 --module commonjs --strict false --skipLibCheck \
     --outDir <out> temp/hutest/main.ts \
     assets/scripts/core/{HuChecker,HuScore,Tile,TileDefine,Meld}.ts
node <out>/temp/hutest/main.js
```

（`tsc` 用 `<workspace>/node_modules/typescript/bin/tsc`；项目自带 `temp/tsconfig.cocos.json` 提供 `cc` 类型声明。）

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
