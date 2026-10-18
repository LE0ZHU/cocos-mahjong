import {
    _decorator, Component, Node, Color, Label, Graphics, UITransform, Vec3, tween, Tween, EventTouch, UIOpacity,
} from 'cc';
import {
    createLabelNode, createButtonNode, bindSafeClick, repaintButtons,
    createTileNode, setTileBgColor, tileFaceSize, ButtonStyle,
} from './UIFactory';
import { TileView, tileRadius } from './TileView';
import { Tile } from '../core/Tile';
import { DrawGame, DRAW_ROWS, DRAW_COLS, DRAW_CELLS, tilePoint } from '../game/DrawGame';
import { stopTweensDeep, ensureOpacity } from './Anim';
import { playDrawPair } from '../audio/Sound';

const { ccclass } = _decorator;

/**
 * 抽牌模式的表现层(牌阵 / 点选抽牌 / 电脑回合 / 积分与结算)
 *
 * 【为什么单独一个组件而不是塞进 Main】抽牌与经典对局是两套完全不同的玩法 ——
 * 没有牌墙、没有吃碰杠、没有回合倒计时。独立成组件后, Main 只负责
 * "建根节点 + 切换显示 + 把可见高度传进来", 经典对局那条链路一个字符都不动。
 *
 * 【坐标系】与牌桌一致: 该组件挂在 `DrawRoot` 下, 由 Main 按"宽度铺满"缩放
 * (scale = 设计宽 / CONTENT_W), 于是内容横向恒为 ±840, 可见半高由 Main 传入。
 */

/** 与 Main.CONTENT_W 同一口径: 内容横向恒为 ±840 */
const CONTENT_W = 1680;

/** 电脑抽牌节奏(秒): 让"电脑抽到 X"这句话读得完再落下一组 */
const AI_THINK_DELAY = 0.75;
/** 一组牌被抽走的消失动画总时长(秒) */
const REMOVE_ANIM = 0.3;
/**
 * 开局"摆牌"入场动画: 每张牌的错峰间隔 / 单张飞行时长(秒)
 *
 * 136 张牌从牌阵中心一张张飞到自己那一格 —— 错峰 5ms 时最后一张约 0.94s 落地,
 * 再慢玩家就要干等, 再快就退回"啪一下全出来"。
 *
 * 【分帧建牌】136 张牌每个都带 Graphics/Sprite/Label/事件, 同一帧建完会把
 * 主线程卡住一大截 —— "从主菜单点抽牌先顿一会儿"与"重开顿一下才有摆牌动画"
 * 都是它。所以节点分帧创建(每帧 BUILD_BATCH 张), 入场动画的延迟仍按格位索引
 * 排, 最终观感与一次性建完一致; 回合交接由最后一块 chunk 按实际落地时刻排程
 * (不再用定值 INTRO_TOTAL)。
 */
const INTRO_STAGGER = 0.005;
const INTRO_FLY = 0.26;
/** 每帧创建的牌数(136 ÷ 18 ≈ 8 帧 ≈ 0.13s 的创建量摊开) */
const BUILD_BATCH = 18;
/** 旧牌淡出时长 / 每帧销毁的旧牌数(重开时同帧销毁 136 个节点同样卡) */
const CLEAR_FADE = 0.15;
const CLEAR_BATCH = 28;

/**
 * 牌尺寸上限 / 下限(随可见高度自适应, 上下夹住)
 *
 * 【平板必须比手机大】`TILE_W_MAX` 是**手机 16:9 的基准宽**(56), 不是绝对上限 ——
 * 平板(3:2 / 4:3)的可见半高 560~630 远大于手机的 472, 若还按 56 建牌,
 * 17×8 的牌阵只占屏幕中间一小块, 牌看着比手机上还小。
 * 所以按 `TILE_REF_HALF_H`(16:9 的半高) 算倍率 `tileK = clamp(halfH / 472.5, 1, 1.3)`,
 * 倍率上限 1.3 不是随便取的: 牌阵变宽会把"牌库 → 内容边缘"的横向净空从 286 压到 143,
 * 4:3 上刚好还能摆下 3 列收牌(容量见 `tools/ai-test/draw-mode-test.ts` 第 2 组)。
 * 16:9 及更窄的手机倍率恒为 1 —— 手机排版一个像素都不变。
 */
const TILE_W_MAX = 56;
const TILE_W_MIN = 22;
const TILE_SCALE_MAX = 1.3;
/** 倍率基准的可见半高(16:9), 与麻将桌 _applyTileScale 同一口径 */
const TILE_REF_HALF_H = 472.5;
/** 阵型左右留白 / 顶部信息区 / 阵型底部留白 */
const GRID_MARGIN_X = 60;
/**
 * 顶部信息区改成**两行**(2026-10-18):
 *   第 1 行(距顶 `HUD_ROW_DY`): 左边「返回主页面 / 重新开始」, 右边三枚信息芯片
 *   第 2 行(距顶 `HUD_STATUS_DY`): 状态胶囊(谁的回合 / 抽到什么)
 * 原来是三行(按钮、芯片、一行裸文字), 又挤又乱, 裸文字也"太丑"(用户反馈);
 * 合并成两行后省下的高度正好让给两侧收牌面板。
 */
const HUD_ROW_DY = 40;
const HUD_STATUS_DY = 96;
const GRID_TOP_OFFSET = 172;
const GRID_BOTTOM_PAD = 30;

/** 信息芯片: 高 / 字号 / 左右内边距 / 间距 */
const CHIP_H = 40;
const CHIP_FONT = 24;
const CHIP_PAD = 16;
const CHIP_GAP = 16;
/** 芯片行右端距内容右缘(与左上角按钮同一行, 右对齐) */
const CHIP_EDGE_PAD = 12;

/**
 * 状态胶囊: 高 / 字号 / 左右内边距 / 左侧状态圆点半径与间距
 *
 * 【为什么从裸文字改成胶囊】原来是一行居中裸文字("轮到你抽: 点两张相同的牌"),
 * 在毡布上既没有底衬托、也分不清是提示还是标题, 用户反馈"太丑"。
 * 现在是圆角胶囊 + 左侧一个按回合变色的小圆点, 与芯片同一套质感;
 * 文案也缩短成"轮到你 · 点两张相同的牌"这种读得快的写法。
 */
const STATUS_H = 38;
const STATUS_FONT = 24;
const STATUS_PAD = 18;
const STATUS_DOT_R = 4;
const STATUS_DOT_GAP = 10;

/**
 * 开局"谁先抽"宣告: 居中大字胶囊(先手一方配色) + 该侧面板闪烁
 *
 * 【时长】淡入 IN + 停留 HOLD + 淡出 OUT + 缓冲 GAP ≈ 1.6s ——
 * 先手是随机的, 原来只在状态条闪一行小字就被电脑抽牌盖过去了, 玩家看不清(用户反馈)。
 * HOLD 至少要 0.8s 才读得完"电脑先抽"四个字, 再加上先手一侧闪两下, 双重确认。
 */
const ANNOUNCE_FONT = 64;
const ANNOUNCE_PAD_X = 56;
const ANNOUNCE_PAD_Y = 24;
const ANNOUNCE_IN = 0.24;
const ANNOUNCE_HOLD = 1.0;
const ANNOUNCE_OUT = 0.28;
const ANNOUNCE_GAP = 0.1;
/** 宣告胶囊的中心 y(内容坐标; 略高于牌阵中心, 别压住刚飞完的那张牌) */
const ANNOUNCE_Y = 30;
/** 先手一侧面板闪烁: 单次变暗时长 / 次数 */
const PULSE_TIME = 0.24;
const PULSE_TIMES = 2;

/** 结算卡片尺寸与内部纵坐标 */
const CARD_W = 720;
const CARD_H = 400;
const CARD_RADIUS = 22;
const RES_TITLE_Y = 138;
const RES_YOU_Y = 56;
const RES_AI_Y = 10;
const RES_WHO_Y = -56;
const RES_BTN_Y = -140;
const RES_BTN_W = 240;
const RES_BTN_H = 64;

/**
 * 收牌列: 抽到的牌分列牌桌两侧(电脑在左、玩家在右), 每组只摆一张代表牌,
 * 按**点数**(字牌 10 点、数牌按面值)从大到小排开 —— **不区分花色**:
 * 9 萬 / 9 条 / 9 筒 混在一起按 9 排, 因为抽牌玩法的得分只看点数,
 * 花色参与排序反而会让"一眼看出谁领先"变难。同点数的牌保持抽到先后(稳定)。
 * (花色权重只属于麻将理牌——`Tile.sortKey`, 别拿来排这里的牌。)
 *
 * 【尺寸】用户要求"已抽的牌可以和牌库里的一样大"(面板已经能区分两块区域) ——
 * 所以从"牌宽的 0.72 倍"改成**从牌库牌宽往下试**: 取能让 `SIDE_MAX` 张都摆下的
 * 最大尺寸(`_fitSideW`)。手机 16:9 / 超宽 / 竖屏上恰好等于牌库牌宽;
 * 平板(3:2 / 4:3)的侧栏净空只有 130~190px, 装不下 34 张同尺寸的牌, 自动退到
 * 能装下的最大值(仍比旧的固定 40 大)。
 */
const SIDE_W_MAX = 80;      // 只是安全上限(实际不会超过牌库牌宽)
const SIDE_W_MIN = 26;
const SIDE_COL_GAP = 10;
const SIDE_ROW_GAP = 6;
/**
 * 侧栏(收牌区)的几何: **整块面板**而不是"几条线 + 一列牌"。
 *
 * 2026-10-18 二次反馈: 之前只在隔离带里画了一条 2px 半透明竖线、顶部挂个小胶囊,
 * 在深绿毡布上几乎看不见 —— 玩家认不出"这两列是什么、是谁的"。
 * 现在每侧是一块从顶部信息区下方伸出、贴到屏底的深色面板(半透明黑绿底 + 金边),
 * 归属标签浮在面板**上方**当标题(不占面板内部空间)。
 *
 * 【四周留白必须一致】面板内部只有 `SIDE_INNER_PAD` 一个内边距 ——
 * 首行牌离面板顶边、首列牌离面板内缘、末列牌离面板外缘都是这个数
 * (用户反馈过"顶部留白比其他三边大", 根因是标签占了一行)。
 */
const SIDE_PAD = 30;
const SIDE_INNER_PAD = 22;
const SIDE_EDGE_PAD = 16;
/** 面板圆角 / 面板底距屏幕下缘的最小值(底下没有空间时兜底) */
const SIDE_PANEL_RADIUS = 16;
const SIDE_PANEL_BOTTOM_MIN = 6;
/** 归属标签(左"电脑抽的" / 右"你抽的"): 胶囊高 / 字号 / 左右内边距 / 标签底到面板顶 */
const SIDE_TAG_H = 30;
const SIDE_TAG_FONT = 22;
const SIDE_TAG_PAD = 12;
const SIDE_TAG_GAP = 6;
/** 顶部信息区底 → 归属标签顶: 状态胶囊底(96+19) + 9px */
const SIDE_TOP_GAP = 124;
const SIDE_BOTTOM_PAD = 26;
/** 一侧最多收多少张代表牌 */
const SIDE_MAX = 34;
/** 收牌飞行动画: 从牌阵格位飞到侧栏槽位的时长 / 已收牌让位的平移时长(秒) */
const COLLECT_FLY = 0.38;
const COLLECT_SHIFT = 0.22;

// ---- 配色(沿用牌桌那套暖金 + 墨绿) ----
const TEXT_TITLE = new Color(255, 240, 190, 255);
const TEXT_SUB = new Color(206, 218, 202, 255);
const TEXT_DIM = new Color(176, 182, 172, 255);
const CHIP_BG = new Color(24, 58, 40, 235);
const CHIP_EDGE = new Color(214, 176, 96, 190);
const CHIP_TEXT = new Color(255, 236, 190, 255);
/**
 * 侧栏面板与归属标签配色: 面板是"压暗的牌桌色块 + 金边",
 * 标签按归属分色 —— 电脑偏冷蓝、你偏暖金, 不看字也能分辨。
 */
const SIDE_PANEL_FILL = new Color(9, 24, 16, 150);
const SIDE_PANEL_EDGE = new Color(212, 174, 96, 110);
const TAG_AI_FILL = new Color(26, 52, 78, 245);
const TAG_AI_EDGE = new Color(118, 178, 224, 215);
const TAG_AI_TEXT = new Color(206, 232, 250, 255);
const TAG_ME_FILL = new Color(84, 62, 22, 245);
const TAG_ME_EDGE = new Color(230, 188, 96, 225);
const TAG_ME_TEXT = new Color(255, 236, 176, 255);
/** 状态胶囊: 底 / 边 / 各语气的文字色与圆点色 */
const STATUS_BG = new Color(10, 28, 20, 205);
const STATUS_EDGE = new Color(214, 176, 96, 96);
const STATUS_YOU = new Color(255, 232, 168, 255);
const STATUS_AI = new Color(176, 214, 246, 255);
const STATUS_INFO = new Color(196, 208, 196, 255);
const STATUS_WARN = new Color(240, 170, 150, 255);
/** 圆点按语气分色(比文字更亮一档, 余光就能看出轮到谁) */
const STATUS_DOT_YOU = new Color(240, 192, 92, 255);
const STATUS_DOT_AI = new Color(112, 172, 224, 255);
const STATUS_DOT_INFO = new Color(150, 166, 150, 255);
const STATUS_DOT_WARN = new Color(230, 136, 112, 255);

/** 状态胶囊的语气: 你的回合 / 电脑回合 / 中性提示 / 驳回提示 */
type StatusTone = 'you' | 'ai' | 'info' | 'warn';
/**
 * 桌面毡布的两端色 —— **必须与 Main._buildTable 里主毡布的渐变同色**
 * (远端受光偏亮 36,72,45 → 近端沉暗 19,42,26)。
 * 抽牌模式的整页背景就用这一套渐变, 于是"抽牌的桌子"与麻将桌是同一块毡布。
 */
const FELT_FAR = new Color(36, 72, 45, 255);
const FELT_NEAR = new Color(19, 42, 26, 255);
/** 毡布渐变色带条数(和牌桌一致: 72 条肉眼已无色阶) */
const FELT_BANDS = 72;
const SEL_EDGE = new Color(255, 232, 152, 255);
const SEL_GLOW = new Color(255, 214, 120, 120);
const PANEL_BG = new Color(16, 32, 27, 246);
const PANEL_EDGE = new Color(214, 176, 96, 225);
const RES_GAIN = new Color(250, 208, 118, 255);
const RES_LOSS = new Color(238, 138, 124, 255);
const RES_EVEN = new Color(200, 216, 198, 255);

const BTN_PRIMARY = new Color(230, 182, 68, 255);
const TEXT_INK = new Color(28, 21, 12, 255);
const LINE_GHOST = new Color(240, 238, 228, 255);
const PILL = ButtonStyle.Pill;
const PILL_GHOST = ButtonStyle.PillGhost;

/** 文本宽度估算(CJK 按字号, 数字/空格按半角) —— 与项目其它处同一口径 */
function textWidth(text: string, font: number): number {
    let w = 0;
    for (const ch of text) w += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
    return w;
}

/** 夹取到 [min, max] */
function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

@ccclass('DrawModeUI')
export class DrawModeUI extends Component {
    /** 点"返回主页面"(由 Main 接上: 清牌阵 + 回主菜单) */
    onExit: (() => void) | null = null;
    /** 点"重新开始"(由 Main 接上: 就地开新的一局) */
    onRestart: (() => void) | null = null;

    private _game: DrawGame | null = null;
    private _halfH = 472;
    private _tileW = TILE_W_MIN;
    private _tileH = TILE_W_MIN * 4 / 3;
    private _gridW = 0;
    private _gridH = 0;
    /** 牌阵容器的 y(收牌飞行的起点要把它算进 this.node 坐标) */
    private _gridCY = 0;
    /** 已按哪个牌宽建过牌(变化才重建; 0 = 还没建) */
    private _builtTileW = -1;
    private _chipY = 0;
    /**
     * 建牌/清牌的代次号: 每次重建 +1
     *
     * 建牌分帧进行, 期间若又触发重建(转屏/重开)或被 abort() 打断
     * (unscheduleAllCallbacks 掐掉排队), 旧 chunk 的回调靠比对代次号自行作废。
     */
    private _buildSeq = 0;
    private _clearSeq = 0;

    // ---- 节点引用 ----
    private _backdrop: Node | null = null;
    private _grid: Node | null = null;
    private _backBtn: Node | null = null;
    private _restartBtn: Node | null = null;
    private _chips: Node[] = [];
    private _chipW: number[] = [0, 0, 0];
    /** 状态胶囊(整枚节点) + 文案 + 上次的文案/语气(重排时原样重画) */
    private _status: Node | null = null;
    private _statusLabel: Label | null = null;
    private _statusText = '';
    private _statusTone: StatusTone = 'info';
    private _statusW = 0;
    private _statusY = 0;
    /** 开局"谁先抽"的宣告胶囊(默认隐藏) */
    private _announce: Node | null = null;
    private _announceLabel: Label | null = null;

    // ---- 收牌列(两侧) ----
    /** 侧栏容器 [0]=玩家(右) [1]=电脑(左); 容器固定在原点, 牌直接摆 this.node 坐标 */
    private _sideRoots: (Node | null)[] = [null, null];
    /** 已收牌的展示节点, 按显示顺序(大→小)排列; 与 _sideTiles 一一对应 */
    private _sideNodes: Node[][] = [[], []];
    private _sideTiles: Tile[][] = [[], []];
    private _sideW = 0;
    private _sideH = 0;
    private _sidePerCol = 0;
    private _sideMaxCols = 0;
    private _sideTop = 0;
    /** 归属标签 [0]=你(右) [1]=电脑(左); 标出两侧收牌区是谁的 */
    private _sideTags: (Node | null)[] = [null, null];
    /** 侧栏面板 [0]=你(右) [1]=电脑(左): 深色底 + 金边, 与牌库明显隔开 */
    private _sidePanels: (Node | null)[] = [null, null];
    /** 面板矩形(正数口径, 右侧为 +x、左侧镜像): 内缘 / 外缘 / 顶 / 底 */
    private _panelX0 = 0;
    private _panelX1 = 0;
    private _panelTop = 0;
    private _panelBottom = 0;
    /** 标签中心 y */
    private _tagCY = 0;
    /** 按哪个侧栏牌宽建过收牌列(变化才重建) */
    private _sideBuiltW = -1;

    // ---- 结算面板(默认隐藏) ----
    private _result: Node | null = null;
    private _resultCard: Node | null = null;
    private _resTitle: Label | null = null;
    private _resYou: Label | null = null;
    private _resAi: Label | null = null;
    private _resWho: Label | null = null;

    // ---- 牌阵 ----
    private _tileNodes: (Node | null)[] = [];
    private _rings: (Node | null)[] = [];
    private _selected = -1;
    /** 玩家输入锁: 非玩家回合 / 动画/结算中一律吞掉点击 */
    private _locked = false;
    /**
     * 下一次建牌是否播"摆牌"入场动画(仅开局那一次)
     *
     * 只在 `start()` 里置真: 转屏重排也会走 `_buildTiles`, 那时候再放一遍入场动画
     * 是纯噪音(玩家会以为重开了)。
     */
    private _pendingIntro = false;

    // ==================== 生命周期 ====================

    onLoad(): void {
        // 整页背景: 与麻将桌同一块毡布(先建 → 在所有内容之下)
        const backdrop = new Node('Backdrop');
        backdrop.parent = this.node;
        backdrop.addComponent(UITransform).setContentSize(4800, 4800);
        this._backdrop = backdrop;

        const grid = new Node('Grid');
        grid.parent = this.node;
        grid.addComponent(UITransform).setContentSize(1, 1);
        this._grid = grid;

        // 侧栏面板: 必须在收牌牌**之下**(先建 → 渲染层级更低), 又要在背景之上
        for (let s = 0; s < 2; s++) {
            const panel = new Node(s === 1 ? 'SidePanelAI' : 'SidePanelYou');
            panel.parent = this.node;
            panel.addComponent(UITransform).setContentSize(1, 1);
            this._sidePanels[s] = panel;
        }

        // 收牌列容器: 电脑在左([1])、玩家在右([0]), 只做分组, 牌按 this.node 坐标摆
        for (let s = 0; s < 2; s++) {
            const side = new Node(s === 1 ? 'SideAI' : 'SideYou');
            side.parent = this.node;
            side.addComponent(UITransform).setContentSize(1, 1);
            this._sideRoots[s] = side;
        }

        // 归属标签: 作为面板标题嵌在面板顶部, 文案直接说明"这些牌是谁抽的"
        this._sideTags[1] = this._makeSideTag('电脑抽的', true);
        this._sideTags[0] = this._makeSideTag('你抽的', false);

        // 顶部只留左上角的"返回主页面 / 重新开始"(按要求去掉了"抽牌模式"标题)
        const back = createButtonNode('返回主页面', 210, 56, LINE_GHOST, PILL_GHOST);
        back.parent = this.node;
        bindSafeClick(back, () => this.onExit?.(), this);
        this._backBtn = back;

        const restart = createButtonNode('重新开始', 170, 56, LINE_GHOST, PILL_GHOST);
        restart.parent = this.node;
        bindSafeClick(restart, () => this.onRestart?.(), this);
        this._restartBtn = restart;

        this._chips = [this._makeChip(), this._makeChip(), this._makeChip()];

        // 状态胶囊: 圆角底 + 左侧状态圆点 + 一行文案(按"谁的回合"变色)
        const status = new Node('Status');
        status.parent = this.node;
        status.addComponent(UITransform).setContentSize(1, STATUS_H);
        const sl = createLabelNode('', STATUS_FONT, TEXT_SUB, 10, STATUS_H);
        sl.parent = status;
        this._status = status;
        this._statusLabel = sl.getComponent(Label);

        // 开局宣告(默认隐藏): 挂在最上层的内容节点里, 结算遮罩仍在它之上
        const announce = new Node('Announce');
        announce.parent = this.node;
        announce.addComponent(UITransform).setContentSize(1, ANNOUNCE_FONT + ANNOUNCE_PAD_Y * 2);
        const al = createLabelNode('', ANNOUNCE_FONT, STATUS_YOU, 10, ANNOUNCE_FONT + 10);
        al.parent = announce;
        announce.active = false;
        this._announce = announce;
        this._announceLabel = al.getComponent(Label);

        this._buildResult();
    }

    /**
     * 进入抽牌场景时调用(原生平台: 隐藏过再显示的节点上 Graphics 会丢, 显示后补画)
     */
    onShow(): void {
        repaintButtons(this.node);
        this._repaintSideChrome();
    }

    /** 中断(返回主页面): 撤销排队中的电脑回合/延时回调, 收起结算面板 */
    abort(): void {
        this.unscheduleAllCallbacks();
        this._locked = false;
        this._pendingIntro = false;
        this._hideAnnounce();       // 宣告可能正播着; 面板闪烁也要复位
        this._setSelected(-1);
        this._hideResult();
    }

    /**
     * 开新的一局: 分帧铺好牌阵并播"摆牌"动画, 动画结束才把回合交出去
     *
     * ⚠️ **不能叫 `start()`** —— 那是 Cocos 组件的生命周期回调名, 组件首次启用时
     * 引擎会自动调一次, 于是"进页面"被无声地开了两局(双倍建牌卡顿), 而且那一遍里
     * 的 unscheduleAllCallbacks 会误伤正在排队的分帧回调。对外统一用 newRound。
     */
    newRound(): void {
        this.unscheduleAllCallbacks();
        this._game = new DrawGame();
        this._selected = -1;
        this._locked = true;            // 摆牌动画期间不接受点击
        this._hideResult();
        this._hideAnnounce();           // 上一局的"谁先抽"宣告 / 面板闪烁复位
        this._clearSides();             // 新的一局: 两侧收牌列清空
        this._pendingIntro = true;      // 这一次建牌要播入场动画
        this._builtTileW = -1;          // 强制按当前尺寸重建整副牌
        this.applyLayout(this._halfH);
        this._refreshHud();
        this._setStatus('正在摆牌…', 'info');
        // 回合交接不再按定值 INTRO_TOTAL 排程 —— 建牌分帧进行, 最后一块
        // chunk 建完时按"最后一张牌落地"的实际时刻排 _beginTurn
    }

    /** 摆牌动画结束 → 把回合交给"该先抽"的一方 */
    /**
     * 摆牌动画结束 → 先给一个"谁先抽"的宣告, 再正式交回合
     *
     * 【为什么要宣告】先手是随机的, 原来只在状态条闪一行小字, 电脑先手时
     * 0.75s 后就开始抽了 —— 玩家根本来不及看清是谁先手(用户反馈)。
     * 现在: 居中大字胶囊(先手一方的配色) + 该侧收牌面板闪烁两下, 停留 ~1s,
     * 淡出后才把回合交出去; 期间 `_locked = true` 不接受点击。
     */
    private _beginTurn(): void {
        const g = this._game;
        if (!g || g.isOver) { this._locked = false; return; }
        const ai = g.seat === 1;
        this._locked = true;                 // 宣告期间先别接受点击
        this._setStatus(ai ? '电脑先抽' : '你先抽', ai ? 'ai' : 'you');
        const wait = this._showAnnounce(ai ? '电脑先抽' : '你先抽', ai ? 'ai' : 'you', g.seat);
        this.scheduleOnce(() => {
            if (ai) {
                this._setStatus('电脑先抽…', 'ai');
                this.scheduleOnce(() => this._aiTurn(), AI_THINK_DELAY);
            } else {
                this._locked = false;
                this._setStatus('轮到你 · 点两张相同的牌', 'you');
            }
        }, wait);
    }

    /**
     * 牌面图片迟到时就地重刷
     *
     * 点进抽牌模式**不再等牌面预加载**(否则会"点了半天才进页面"), 而是直接开局 +
     * 摆牌动画; 万一图片还在路上, 先按矢量兜底, 加载完成后由 Main 调这里补一次 ——
     * `setData` 会重走一遍显示逻辑, 图片就位后自动切成图片牌面。
     */
    refreshFaces(): void {
        const g = this._game;
        if (!g) return;
        for (let i = 0; i < DRAW_CELLS; i++) {
            const n = this._tileNodes[i];
            if (!n || !n.isValid) continue;
            const tile = g.tileAt(i);
            if (!tile) continue;
            const view = n.getComponent(TileView);
            if (view) view.setData(tile, i);
        }
    }

    /**
     * 按可见半高重排: 算牌尺寸与阵型位置, 摆好顶部信息区。
     * 牌尺寸变了才重建牌(尺寸写在节点的 UITransform 里, 改字段不会让已画的牌变大)。
     */
    applyLayout(halfH: number): void {
        this._halfH = halfH;
        // 17 列 × 8 行都必须放得下: 横向受内容宽度限, 纵向受"扣掉顶部信息区后的高度"限。
        // 平板上纵向富余, 牌宽上限按可见半高放大(手机倍率恒为 1, 排版不变)
        const tileK = clamp(halfH / TILE_REF_HALF_H, 1, TILE_SCALE_MAX);
        const maxW = TILE_W_MAX * tileK;
        const byW = (CONTENT_W - GRID_MARGIN_X * 2) / DRAW_COLS;
        const gridMaxH = Math.max(140, halfH * 2 - GRID_TOP_OFFSET - GRID_BOTTOM_PAD);
        const byH = (gridMaxH / DRAW_ROWS) * 0.75;   // 牌 3:4 → 高 = 宽 / 0.75
        const tileW = clamp(Math.min(maxW, byW, byH), TILE_W_MIN, maxW);
        this._tileW = tileW;
        this._tileH = (tileW * 4) / 3;
        this._gridW = DRAW_COLS * tileW;
        this._gridH = DRAW_ROWS * this._tileH;

        // ---- 顶部第 1 行: 左边两个操作按钮, 右边三枚信息芯片 ----
        const topY = halfH - HUD_ROW_DY;
        const bx = -CONTENT_W / 2 + 12 + 210 / 2;
        this._backBtn?.setPosition(bx, topY, 0);
        this._restartBtn?.setPosition(bx + 210 / 2 + 12 + 170 / 2, topY, 0);
        this._chipY = topY;
        // ---- 顶部第 2 行: 状态胶囊 ----
        this._statusY = halfH - HUD_STATUS_DY;
        this._setStatus(this._statusText, this._statusTone);
        // 开局宣告固定在内容坐标系中心偏上(不随牌阵缩放)
        this._announce?.setPosition(0, ANNOUNCE_Y, 0);

        // ---- 阵型居中(牌相对容器摆放, 移动容器即可) ----
        const gridTop = halfH - GRID_TOP_OFFSET;
        const gridCY = gridTop - this._gridH / 2;
        this._gridCY = gridCY;
        this._grid?.setPosition(0, gridCY, 0);
        // 整页背景固定居中(铺满可见区, 不随牌阵移动)
        this._backdrop?.setPosition(0, 0, 0);
        this._paintBackdrop();

        // ---- 收牌面板矩形(正数口径, 左右镜像) ----
        // 面板**按"装满 34 张所需的大小"收缩**, 这样满局时四边留白都等于 SIDE_INNER_PAD
        // (实测每局都是 34:34 收满, 所以这就是常态下看到的形状)。
        this._panelX0 = this._gridW / 2 + SIDE_PAD;
        const tagTop = halfH - SIDE_TOP_GAP;
        this._tagCY = tagTop - SIDE_TAG_H / 2;
        this._panelTop = tagTop - SIDE_TAG_H - SIDE_TAG_GAP;
        const tilesTop = this._panelTop - SIDE_INNER_PAD;

        // ---- 收牌牌尺寸: 从牌库牌宽往下试, 取"能装下 SIDE_MAX 张"的最大值 ----
        // 用户要求"已抽的牌和牌库一样大"(面板已经能区分了); 手机上确实装得下,
        // 平板的侧栏净空只有 130~190px, 只能退回能装下的最大值。
        const availW = (CONTENT_W / 2 - SIDE_EDGE_PAD) - this._panelX0;
        const stripW = availW - SIDE_INNER_PAD * 2;
        const fit = this._fitSideW(stripW, tilesTop, -halfH + SIDE_BOTTOM_PAD);
        this._sideW = fit.w;
        this._sideH = (this._sideW * 4) / 3;
        this._sideMaxCols = fit.cols;
        this._sidePerCol = fit.rows;
        this._sideTop = tilesTop;

        // 面板宽 = 装满所需列数 + 左右内边距; 面板底 = 最底一张牌 + 内边距
        const usedCols = Math.min(fit.cols, Math.ceil(SIDE_MAX / fit.rows));
        const panelW = SIDE_INNER_PAD * 2 + usedCols * this._sideW + (usedCols - 1) * SIDE_COL_GAP;
        this._panelX1 = this._panelX0 + panelW;
        const capBottom = tilesTop - (fit.rows - 1) * (this._sideH + SIDE_ROW_GAP) - this._sideH;
        this._panelBottom = Math.max(-halfH + SIDE_PANEL_BOTTOM_MIN, capBottom - SIDE_INNER_PAD);

        const tagX = (this._panelX0 + this._panelX1) / 2;
        this._sideTags[0]?.setPosition(tagX, this._tagCY, 0);
        this._sideTags[1]?.setPosition(-tagX, this._tagCY, 0);

        if (this._game && Math.abs(tileW - this._builtTileW) > 1e-3) this._buildTiles();
        // 收牌列: 尺寸变了就地重建(无动画); 只是可见高度变了就平移到新槽位
        if (this._sideW !== this._sideBuiltW) this._rebuildSides();
        else this._repositionSides();
        // 面板/标签随布局重画(原生平台"隐藏期画不上屏"的兜底)
        this._repaintSideChrome();
        this._layoutChips();
    }

    /**
     * 求"能装下 `SIDE_MAX` 张收牌牌"的最大牌宽
     *
     * 从牌库牌宽(`this._tileW`)往下逐个试: 列数 × 每列行数 ≥ 34 就收。
     * 为什么不能固定一个比例: 手机侧栏净空 270~380px、平板只剩 130~190px,
     * 同一个比例在两处的结论完全相反 —— 手机上"和牌库一样大"装得下,
     * 平板上同尺寸只能装 18 张, 必须退到能装下的最大值。
     * @returns w 牌宽 / cols 列数 / rows 每列行数
     */
    private _fitSideW(stripW: number, tilesTop: number, sideBottom: number): { w: number; cols: number; rows: number } {
        const cap = Math.min(SIDE_W_MAX, Math.round(this._tileW));
        for (let w = cap; w >= SIDE_W_MIN; w--) {
            const h = (w * 4) / 3;
            const cols = Math.max(1, Math.floor((stripW + SIDE_COL_GAP) / (w + SIDE_COL_GAP)));
            const rows = Math.max(1, Math.floor((tilesTop - sideBottom + SIDE_ROW_GAP) / (h + SIDE_ROW_GAP)));
            if (cols * rows >= SIDE_MAX) return { w, cols, rows };
        }
        // 极端窄屏兜底: 按最小牌宽算能给多少算多少(布局仍不重叠, 容量由 _collectTile 兜)
        const h = (SIDE_W_MIN * 4) / 3;
        return {
            w: SIDE_W_MIN,
            cols: Math.max(1, Math.floor((stripW + SIDE_COL_GAP) / (SIDE_W_MIN + SIDE_COL_GAP))),
            rows: Math.max(1, Math.floor((tilesTop - sideBottom + SIDE_ROW_GAP) / (h + SIDE_ROW_GAP))),
        };
    }

    // ==================== 牌阵 ====================

    /**
     * 画整页背景: 与麻将桌面毡布同一套竖向渐变(远端亮 → 近端暗)。
     *
     * 【为什么抽牌模式的背景就是"桌面"】用户要求抽牌的桌子与麻将桌同色、且整页背景
     * 也用桌面颜色 —— 于是这里不再画一块与背景异色的"底板", 整个可见区直接铺成毡布,
     * 牌阵就摊在这块毡布上, 与麻将桌是同一块台面。
     */
    private _paintBackdrop(): void {
        const bg = this._backdrop;
        if (!bg) return;
        const g = bg.getComponent(Graphics) ?? bg.addComponent(Graphics);
        g.clear();
        const top = this._halfH + 240;
        const bottom = -this._halfH - 240;
        const span = top - bottom;
        const bh = span / FELT_BANDS;
        for (let i = 0; i < FELT_BANDS; i++) {
            const t = i / (FELT_BANDS - 1);
            g.fillColor = new Color(
                Math.round(FELT_FAR.r + (FELT_NEAR.r - FELT_FAR.r) * t),
                Math.round(FELT_FAR.g + (FELT_NEAR.g - FELT_FAR.g) * t),
                Math.round(FELT_FAR.b + (FELT_NEAR.b - FELT_FAR.b) * t),
                255,
            );
            // 横向画得比可见区宽得多(极端比例也不会露出桌外的清屏色)
            g.rect(-2400, top - (i + 1) * bh, 4800, bh + 0.5);
            g.fill();
        }
        // 注意: 两侧收牌区与牌库的分隔**不在这里**画 —— 那条 2px 细线在毡布上
        // 几乎看不见(用户反馈过), 现在改成整块侧栏面板, 见 _repaintSideChrome。
    }

    private _cellX(index: number): number {
        const c = index % DRAW_COLS;
        return -this._gridW / 2 + this._tileW / 2 + c * this._tileW;
    }

    private _cellY(index: number): number {
        const r = Math.floor(index / DRAW_COLS);
        return this._gridH / 2 - this._tileH / 2 - r * this._tileH;
    }

    /**
     * 重建整副牌(新开一局 / 牌尺寸变化时); 新开那一次会顺带播"摆牌"入场动画
     *
     * 【分帧建牌】136 张牌每个都带 Graphics/Sprite/Label/触摸事件, 一帧建完
     * 会把主线程卡住一大截(进页面/重开的"顿一下"就是它)。每帧建 BUILD_BATCH 张,
     * 动画延迟仍按格位索引排, 观感与一次性建完一致。代次号 `_buildSeq` 保证
     * 期间再次重建/被打断时, 旧 chunk 的排队回调自动作废。
     */
    private _buildTiles(): void {
        this._clearGrid();
        this._tileNodes = new Array<Node | null>(DRAW_CELLS);
        this._rings = new Array<Node | null>(DRAW_CELLS);
        for (let i = 0; i < DRAW_CELLS; i++) { this._tileNodes[i] = null; this._rings[i] = null; }
        this._builtTileW = this._tileW;
        // 牌重建了, 旧的选中金框随旧节点销毁 —— 逻辑上的选中态也一并清掉
        this._selected = -1;

        const intro = this._pendingIntro;
        this._pendingIntro = false;

        const g = this._game;
        const grid = this._grid;
        if (!g || !grid) return;
        const seq = ++this._buildSeq;

        let i = 0;
        let lastDelay = 0;
        const step = (): void => {
            if (seq !== this._buildSeq) return;   // 期间又重建/被打断, 本轮作废
            const end = Math.min(DRAW_CELLS, i + BUILD_BATCH);
            for (; i < end; i++) {
                const tile = g.tileAt(i);
                if (!tile) continue;
                const idx = i;                    // 闭包按张捕获, 不共享循环变量
                const tx = this._cellX(idx);
                const ty = this._cellY(idx);
                const node = createTileNode(this._tileW, this._tileH, false);
                node.parent = grid;
                if (intro) {
                    // 入场: 先全部叠在牌阵中心(透明、略小), 再错峰飞到自己那一格
                    node.setPosition(0, 0, 0);
                    node.setScale(0.66, 0.66, 1);
                    ensureOpacity(node).opacity = 0;
                } else {
                    node.setPosition(tx, ty, 0);
                }
                setTileBgColor(node, tile.suit, false);
                // 挂 TileView 只为"按素材显示牌面"(它自带的手势在没设 setOnClick 时不会启动),
                // 点击由下面这行自己接
                const view = node.addComponent(TileView);
                view.setData(tile, idx);
                node.on(Node.EventType.TOUCH_END, () => this._onTileTap(idx), this);
                this._tileNodes[idx] = node;

                if (!intro) continue;
                const delay = idx * INTRO_STAGGER;
                lastDelay = Math.max(lastDelay, delay);
                tween(node)
                    .delay(delay)
                    .to(INTRO_FLY, { position: new Vec3(tx, ty, 0), scale: new Vec3(1, 1, 1) },
                        { easing: 'backOut' })
                    .start();
                tween(ensureOpacity(node))
                    .delay(delay)
                    .to(INTRO_FLY * 0.5, { opacity: 255 })
                    .start();
            }
            if (i < DRAW_CELLS) {
                // ⚠️ 必须包一层新箭头再排程: 引擎 Scheduler 对"同一 target + 同一回调
                // 引用"会去重(只改 interval 直接 return), 而一次性定时器(repeat=0)触发
                // 完就自我移除 —— 直接 scheduleOnce(step, 0) 会在第 2 帧命中去重被吞,
                // 链条死在第 2 批(真机上就是"摆了两排零两个卡住")。
                this.scheduleOnce(() => step(), 0);   // 下一帧接着建下一批
            } else if (intro) {
                // 最后一张落地的时刻才交回合(分帧建牌后它比 INTRO_TOTAL 晚一点)
                this.scheduleOnce(() => {
                    if (seq === this._buildSeq) this._beginTurn();
                }, lastDelay + INTRO_FLY + 0.05);
            } else {
                this._beginTurn();
            }
        };
        step();
    }

    /**
     * 清空牌阵: 旧牌整批淡出后**分帧销毁**
     *
     * 重开时旧阵 136 个节点(每个带 Graphics/Sprite/事件)同帧 destroy 同样卡顿 ——
     * 先整体淡出 0.15s(与新一局的摆牌动画交叠成自然过渡), 再每帧销毁 CLEAR_BATCH 张。
     * 排队中的销毁被 unscheduleAllCallbacks 掐掉也没关系: 残留的旧牌透明度为 0,
     * 下一次 _clearGrid 的快照仍会兜住它们。
     */
    private _clearGrid(): void {
        const grid = this._grid;
        if (!grid) return;
        const old = grid.children.slice();
        if (old.length === 0) return;
        const seq = ++this._clearSeq;
        for (const child of old) {
            stopTweensDeep(child);
            // 入场动画给节点加了 UIOpacity 上的透明度补间, 那个目标不是节点本身,
            // stopTweensDeep 清不到 —— 节点销毁前必须单独停掉, 否则它会写已销毁的组件
            const op = child.getComponent(UIOpacity);
            if (op) Tween.stopAllByTarget(op);
            const fade = ensureOpacity(child);
            fade.opacity = 255;
            tween(fade).to(CLEAR_FADE, { opacity: 0 }).start();
        }
        let k = 0;
        const step = (): void => {
            if (seq !== this._clearSeq) return;
            const end = Math.min(old.length, k + CLEAR_BATCH);
            for (; k < end; k++) {
                const c = old[k];
                if (c.isValid) c.destroy();
            }
            // 同 _buildTiles: 新闭包再排程, 避开调度器对同一回调引用的去重
            if (k < old.length) this.scheduleOnce(() => step(), 0);
        };
        this.scheduleOnce(step, CLEAR_FADE + 0.02);
    }

    /** 抽走一张牌: 缩小淡出后销毁(逻辑层已经置空, UI 只负责表现) */
    private _removeTileNode(index: number): void {
        const ring = this._rings[index];
        if (ring && ring.isValid) ring.destroy();
        this._rings[index] = null;
        const n = this._tileNodes[index];
        this._tileNodes[index] = null;
        if (!n || !n.isValid) return;
        tween(n)
            .to(REMOVE_ANIM * 0.55, { scale: new Vec3(0.9, 0.9, 1) }, { easing: 'quadIn' })
            .to(REMOVE_ANIM * 0.45, { scale: new Vec3(0.02, 0.02, 1) }, { easing: 'quadIn' })
            .call(() => { if (n.isValid) n.destroy(); })
            .start();
    }

    // ==================== 收牌列(两侧) ====================

    /** 侧栏第 idx 个槽位的 this.node 坐标(电脑在左取负, 玩家在右取正) */
    private _sideSlot(seat: number, idx: number): Vec3 {
        const col = Math.floor(idx / this._sidePerCol);
        const row = idx % this._sidePerCol;
        const dir = seat === 1 ? -1 : 1;
        const x = dir * (this._gridW / 2 + SIDE_PAD + SIDE_INNER_PAD + this._sideW / 2 + col * (this._sideW + SIDE_COL_GAP));
        const y = this._sideTop - row * (this._sideH + SIDE_ROW_GAP) - this._sideH / 2;
        return new Vec3(x, y, 0);
    }

    /** 牌阵格位的 this.node 坐标(收牌飞行的起点) */
    private _cellWorldPos(index: number): Vec3 {
        return new Vec3(this._cellX(index), this._gridCY + this._cellY(index), 0);
    }

    /**
     * 收下一张代表牌: 按**点数**从大到小插进对应一侧, 新牌从牌阵格位飞到
     * 槽位, 插入点之后的牌平滑让位(用户要求的过渡动画)。
     * 同点数不区分花色, 插在已有的同分牌之后(先来后到, 稳定)。
     * @param seat 0=玩家(右) 1=电脑(左)
     * @param fromIndex 被抽走的格位(飞行起点)
     */
    private _collectTile(tile: Tile, seat: number, fromIndex: number): void {
        const nodes = this._sideNodes[seat];
        const tiles = this._sideTiles[seat];
        // 排序插入位置: 第一张点数比它小的牌之前(同分保持先来后到)
        const point = tilePoint(tile);
        let at = tiles.length;
        for (let i = 0; i < tiles.length; i++) {
            if (tilePoint(tiles[i]) < point) { at = i; break; }
        }
        // 容量兜底: 摆不下了(理论到不了 SIDE_MAX)就不动画, 只记账
        if (at >= this._sidePerCol * this._sideMaxCols) {
            tiles.splice(Math.min(at, tiles.length), 0, tile);
            return;
        }
        tiles.splice(at, 0, tile);
        nodes.splice(at, 0, null as unknown as Node);   // 占位, 飞行牌落位后即为它
        // 让位: 插入点之后的牌平移到各自的新槽位
        for (let i = at + 1; i < nodes.length; i++) {
            const n = nodes[i];
            if (!n || !n.isValid) continue;
            tween(n).to(COLLECT_SHIFT, { position: this._sideSlot(seat, i) },
                { easing: 'quadOut' }).start();
        }
        // 飞行: 以阵上牌的大小起飞, 落位时缩到收牌尺寸
        const node = createTileNode(this._sideW, this._sideH, false);
        node.parent = this._sideRoots[seat] ?? this.node;
        const from = this._cellWorldPos(fromIndex);
        node.setPosition(from.x, from.y, 0);
        const k = this._tileW / this._sideW;
        node.setScale(k, k, 1);
        setTileBgColor(node, tile.suit, false);
        node.addComponent(TileView).setData(tile, -1);
        nodes[at] = node;
        tween(node)
            .to(COLLECT_FLY, { position: this._sideSlot(seat, at), scale: new Vec3(1, 1, 1) },
                { easing: 'quadOut' })
            .start();
    }

    /** 清空两侧收牌列(新的一局 / 重建) */
    private _clearSides(): void {
        for (let s = 0; s < 2; s++) {
            for (const n of this._sideNodes[s]) {
                if (n && n.isValid) {
                    Tween.stopAllByTarget(n);
                    n.destroy();
                }
            }
            this._sideNodes[s] = [];
            this._sideTiles[s] = [];
        }
    }

    /** 就地重建两侧收牌列(尺寸变化 / 开局), 无动画 */
    private _rebuildSides(): void {
        this._clearSides();
        const g = this._game;
        if (!g) return;
        for (let s = 0; s < 2; s++) {
            const tiles = g.collected(s).slice();
            // 只按点数降序(不分花色); sort 稳定, 同点数仍是抽到先后
            tiles.sort((a, b) => tilePoint(b) - tilePoint(a));   // 大 → 小
            for (const t of tiles) {
                const idx = this._sideNodes[s].length;
                if (idx >= this._sidePerCol * this._sideMaxCols) break;
                const n = createTileNode(this._sideW, this._sideH, false);
                n.parent = this._sideRoots[s] ?? this.node;
                setTileBgColor(n, t.suit, false);
                n.addComponent(TileView).setData(t, -1);
                const pos = this._sideSlot(s, idx);
                n.setPosition(pos.x, pos.y, 0);
                this._sideNodes[s].push(n);
                this._sideTiles[s].push(t);
            }
        }
        this._sideBuiltW = this._sideW;
    }

    /** 尺寸没变、可见高度变了: 已收的牌平移到新槽位(无动画) */
    private _repositionSides(): void {
        for (let s = 0; s < 2; s++) {
            for (let i = 0; i < this._sideNodes[s].length; i++) {
                const n = this._sideNodes[s][i];
                if (!n || !n.isValid) continue;
                const pos = this._sideSlot(s, i);
                n.setPosition(pos.x, pos.y, 0);
            }
        }
    }

    // ==================== 交互 ====================

    /** 点一张牌: 第一次选中, 再点一张与之相同的可抽牌即成组抽走 */
    private _onTileTap(index: number): void {
        const g = this._game;
        if (!g || g.isOver) return;
        if (this._locked || g.seat !== 0) return;
        if (this._result && this._result.active) return;

        const tile = g.tileAt(index);
        if (!tile) return;
        // 通道被挡住 → 抽不出来, 给出说明(不改变当前选择)
        if (!g.isFree(index)) {
            this._setStatus(`${tile.displayText} 被挡住 · 换个方向试试`, 'warn');
            return;
        }
        if (this._selected === index) {
            this._setSelected(-1);
            this._setStatus('轮到你 · 点两张相同的牌', 'you');
            return;
        }

        if (this._selected >= 0) {
            const prev = g.tileAt(this._selected);
            if (prev && prev.sameType(tile) && g.canDraw(this._selected, index)) {
                const a = this._selected;
                this._setSelected(-1);
                this._applyDraw(a, index);
                return;
            }
            // 不是同一张牌 → 改选这一张(玩家改了主意)
            this._setSelected(index);
            this._setStatus(`已选 ${tile.displayText} · 再点一张相同的`, 'you');
            return;
        }
        this._setSelected(index);
        this._setStatus(`已选 ${tile.displayText} · 再点一张相同的`, 'you');
    }

    private _setSelected(index: number): void {
        if (this._selected >= 0) {
            const old = this._rings[this._selected];
            if (old && old.isValid) old.active = false;
        }
        this._selected = index;
        if (index < 0) return;
        const ring = this._ensureRing(index);
        if (ring) ring.active = true;
    }

    /** 懒建一张牌上的选中金框(画在牌面之上) */
    private _ensureRing(index: number): Node | null {
        const tileNode = this._tileNodes[index];
        if (!tileNode || !tileNode.isValid) return null;
        const old = this._rings[index];
        if (old && old.isValid) return old;

        // 传进来的是格位尺寸; 牌面比格位小 TILE_GAP, 选中框要贴着牌面画
        const faceSize = tileFaceSize(this._tileW, this._tileH);
        const w = faceSize.w;
        const h = faceSize.h;
        const ring = new Node('SelRing');
        ring.parent = tileNode;
        ring.addComponent(UITransform).setContentSize(w, h);
        const g = ring.addComponent(Graphics);
        const r = tileRadius(w, h);
        g.strokeColor = SEL_GLOW;
        g.lineWidth = 7;
        g.roundRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, r + 3);
        g.stroke();
        g.strokeColor = SEL_EDGE;
        g.lineWidth = 3;
        g.roundRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, r + 1);
        g.stroke();
        ring.setSiblingIndex(tileNode.children.length - 1);
        this._rings[index] = ring;
        return ring;
    }

    /** 真正抽走一组: 逻辑层结算 + 表现层消失动画 + 收牌飞入 + 节奏控制 */
    private _applyDraw(a: number, b: number): void {
        const g = this._game;
        if (!g) return;
        const seat = g.seat;
        const tile = g.tileAt(a);
        const value = tile ? tilePoint(tile) : 0;
        if (!g.draw(a, b)) return;

        this._selected = -1;
        this._removeTileNode(a);
        this._removeTileNode(b);
        // 抽成了: 一声"消除"(玩家与电脑都播 —— 这是"这组抽对了"的唯一听觉确认)
        playDrawPair();
        // 每组只收一张代表牌, 从被抽走的格位飞向本方侧栏(电脑在左、玩家在右)
        if (tile) this._collectTile(tile, seat, a);
        const who = seat === 0 ? '你' : '电脑';
        this._setStatus(`${who}抽到 ${tile ? tile.displayText : '?'} ×2 · +${value} 分`, seat === 0 ? 'you' : 'ai');
        this._refreshHud();
        this._afterMove();
    }

    /** 一次抽牌之后: 该谁走、什么时候走 —— 统一在这里排节奏 */
    private _afterMove(): void {
        const g = this._game;
        if (!g) return;
        if (g.isOver) {
            this._locked = true;
            this.scheduleOnce(() => this._showResult(), 0.55);
            return;
        }
        if (g.seat === 1) {
            this._locked = true;
            this.scheduleOnce(() => this._setStatus('电脑正在抽…', 'ai'), AI_THINK_DELAY * 0.6);
            this.scheduleOnce(() => this._aiTurn(), AI_THINK_DELAY);
        } else {
            // 先让"电脑抽到 X"读得完, 再交回玩家
            this._locked = true;
            this.scheduleOnce(() => {
                this._locked = false;
                this._setStatus('轮到你 · 点两张相同的牌', 'you');
            }, 0.5);
        }
    }

    /** 电脑回合: 贪心取点数最高的一组抽走 */
    private _aiTurn(): void {
        const g = this._game;
        if (!g || g.isOver || g.seat !== 1) { this._locked = false; return; }
        const p = g.aiPick();
        if (!p) {
            // 理论上抽不动时 _refreshOver 已经判结束, 这里只做兜底
            this.scheduleOnce(() => this._showResult(), 0.4);
            return;
        }
        this._applyDraw(p.a, p.b);
    }

    // ==================== 信息显示 ====================

    /**
     * 更新状态胶囊(文案 + 语气 + 宽度重算)
     *
     * 语气决定文字色与左侧圆点色: 你的回合暖金、电脑回合冷蓝、中性灰绿、驳回偏红。
     * 胶囊宽度随文案变, 所以每次都要重画底框并让标签重新居中(与信息芯片同一套做法)。
     */
    private _setStatus(text: string, tone: StatusTone = 'info'): void {
        this._statusText = text;
        this._statusTone = tone;
        const node = this._status;
        if (!node) return;

        const color = tone === 'you' ? STATUS_YOU : tone === 'ai' ? STATUS_AI
            : tone === 'warn' ? STATUS_WARN : STATUS_INFO;
        const dot = tone === 'you' ? STATUS_DOT_YOU : tone === 'ai' ? STATUS_DOT_AI
            : tone === 'warn' ? STATUS_DOT_WARN : STATUS_DOT_INFO;
        const tw = textWidth(text, STATUS_FONT);
        const w = STATUS_PAD * 2 + STATUS_DOT_R * 2 + STATUS_DOT_GAP + tw;
        this._statusW = w;
        node.setPosition(0, this._statusY, 0);
        node.getComponent(UITransform)?.setContentSize(w, STATUS_H);

        const g = node.getComponent(Graphics) ?? node.addComponent(Graphics);
        g.clear();
        g.fillColor = STATUS_BG;
        g.roundRect(-w / 2, -STATUS_H / 2, w, STATUS_H, STATUS_H / 2);
        g.fill();
        g.strokeColor = STATUS_EDGE;
        g.lineWidth = 1.5;
        g.roundRect(-w / 2, -STATUS_H / 2, w, STATUS_H, STATUS_H / 2);
        g.stroke();
        g.fillColor = dot;
        g.circle(-w / 2 + STATUS_PAD + STATUS_DOT_R, 0, STATUS_DOT_R);
        g.fill();

        const lbl = this._statusLabel;
        if (lbl) {
            lbl.string = text;
            lbl.color = color;
            const lw = Math.max(10, tw + 8);
            lbl.node.getComponent(UITransform)?.setContentSize(lw, STATUS_H);
            lbl.node.setPosition(-w / 2 + STATUS_PAD + STATUS_DOT_R * 2 + STATUS_DOT_GAP + tw / 2, 0, 0);
        }
    }

    /**
     * 播"谁先抽"的宣告, 返回**从开始到可以交回合**的秒数
     *
     * 三层强调: 居中大字(先手一方配色) + 该侧面板/标题闪两下 + 期间锁输入。
     * 三样都是为了让玩家在电脑动手之前看清先手是谁。
     */
    private _showAnnounce(text: string, tone: 'you' | 'ai', seat: number): number {
        const node = this._announce;
        if (!node) return 0;
        const color = tone === 'you' ? STATUS_YOU : STATUS_AI;
        const edge = tone === 'you' ? STATUS_DOT_YOU : STATUS_DOT_AI;
        const w = textWidth(text, ANNOUNCE_FONT) + ANNOUNCE_PAD_X * 2;
        const h = ANNOUNCE_FONT + ANNOUNCE_PAD_Y * 2;

        node.active = true;
        node.setPosition(0, ANNOUNCE_Y, 0);
        node.getComponent(UITransform)?.setContentSize(w, h);
        const g = node.getComponent(Graphics) ?? node.addComponent(Graphics);
        g.clear();
        g.fillColor = new Color(8, 22, 15, 226);
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.fill();
        g.strokeColor = edge;
        g.lineWidth = 2.5;
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.stroke();
        const lbl = this._announceLabel;
        if (lbl) {
            lbl.string = text;
            lbl.color = color;
            lbl.node.getComponent(UITransform)?.setContentSize(w - 16, h);
        }

        // 淡入 + 轻微放大(backOut 有一点"弹出来"的手感)
        const op = ensureOpacity(node);
        Tween.stopAllByTarget(node);
        Tween.stopAllByTarget(op);
        op.opacity = 0;
        node.setScale(0.82, 0.82, 1);
        tween(op).to(ANNOUNCE_IN, { opacity: 255 }).start();
        tween(node).to(ANNOUNCE_IN, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

        // 先手一侧的收牌面板 / 标题闪两下
        this._pulseSide(seat);

        const hold = ANNOUNCE_IN + ANNOUNCE_HOLD;
        this.scheduleOnce(() => {
            tween(op).to(ANNOUNCE_OUT, { opacity: 0 })
                .call(() => { if (node.isValid) node.active = false; })
                .start();
        }, hold);
        return hold + ANNOUNCE_OUT + ANNOUNCE_GAP;
    }

    /** 先手一侧的面板 + 归属标题闪烁(变暗再亮回来, 循环 PULSE_TIMES 次) */
    private _pulseSide(seat: number): void {
        for (const n of [this._sidePanels[seat], this._sideTags[seat]]) {
            if (!n || !n.isValid) continue;
            const op = ensureOpacity(n);
            Tween.stopAllByTarget(op);
            op.opacity = 255;
            let t = tween(op);
            for (let i = 0; i < PULSE_TIMES; i++) {
                t = t.to(PULSE_TIME, { opacity: 110 }).to(PULSE_TIME, { opacity: 255 });
            }
            t.start();
        }
    }

    /** 收起宣告并复位面板透明度(开局 / 中断 / 重开都要调, 否则闪烁停下会留半透明) */
    private _hideAnnounce(): void {
        const node = this._announce;
        if (node) {
            Tween.stopAllByTarget(node);
            const op = node.getComponent(UIOpacity);
            if (op) Tween.stopAllByTarget(op);
            node.active = false;
        }
        for (const n of [this._sidePanels[0], this._sidePanels[1], this._sideTags[0], this._sideTags[1]]) {
            if (!n || !n.isValid) continue;
            const op = n.getComponent(UIOpacity);
            if (!op) continue;
            Tween.stopAllByTarget(op);
            op.opacity = 255;
        }
    }

    private _refreshHud(): void {
        const g = this._game;
        const you = g ? g.scoreOf(0) : 0;
        const ai = g ? g.scoreOf(1) : 0;
        const pairsLeft = g ? Math.floor(g.remaining / 2) : 0;
        this._setChip(0, `你 ${you} 分`, CHIP_TEXT);
        this._setChip(1, `剩余 ${pairsLeft} 组`, TEXT_DIM);
        this._setChip(2, `电脑 ${ai} 分`, CHIP_TEXT);
        this._layoutChips();
    }

    private _makeChip(): Node {
        const n = new Node('Chip');
        n.addComponent(UITransform).setContentSize(1, CHIP_H);
        const lbl = createLabelNode('', CHIP_FONT, CHIP_TEXT, 200, CHIP_H);
        lbl.parent = n;
        return n;
    }

    /**
     * 侧栏归属标签: 浮在面板上方当"标题", 文案直接说明这些牌是谁抽的。
     * @param ai true = 电脑(冷蓝) / false = 你(暖金)
     */
    private _makeSideTag(text: string, ai: boolean): Node {
        const n = new Node('SideTag');
        const w = textWidth(text, SIDE_TAG_FONT) + SIDE_TAG_PAD * 2;
        n.addComponent(UITransform).setContentSize(w, SIDE_TAG_H);
        const lbl = createLabelNode(text, SIDE_TAG_FONT, ai ? TAG_AI_TEXT : TAG_ME_TEXT, w, SIDE_TAG_H);
        lbl.parent = n;
        return n;
    }

    /**
     * 重画两侧的"面板底 + 归属标签胶囊"(幂等)。
     *
     * onLoad 期节点还隐藏, 原生平台上那时画的 Graphics 上不了屏 ——
     * 所以 onShow / applyLayout 都要补一次(与按钮 repaintButtons 同一套理由)。
     */
    private _repaintSideChrome(): void {
        const w = this._panelX1 - this._panelX0;
        const h = this._panelTop - this._panelBottom;
        if (w > 0 && h > 0) {
            for (let s = 0; s < 2; s++) {
                const panel = this._sidePanels[s];
                if (!panel) continue;
                const dir = s === 1 ? -1 : 1;
                const cx = dir * ((this._panelX0 + this._panelX1) / 2);
                const g = panel.getComponent(Graphics) ?? panel.addComponent(Graphics);
                g.clear();
                g.fillColor = SIDE_PANEL_FILL;
                g.roundRect(cx - w / 2, this._panelBottom, w, h, SIDE_PANEL_RADIUS);
                g.fill();
                g.strokeColor = SIDE_PANEL_EDGE;
                g.lineWidth = 2;
                g.roundRect(cx - w / 2, this._panelBottom, w, h, SIDE_PANEL_RADIUS);
                g.stroke();
            }
        }
        for (let s = 0; s < 2; s++) {
            const tag = this._sideTags[s];
            if (!tag) continue;
            const size = tag.getComponent(UITransform);
            const tw = size ? size.width : 0;
            const th = size ? size.height : SIDE_TAG_H;
            const ai = s === 1;
            const g = tag.getComponent(Graphics) ?? tag.addComponent(Graphics);
            g.clear();
            g.fillColor = ai ? TAG_AI_FILL : TAG_ME_FILL;
            g.roundRect(-tw / 2, -th / 2, tw, th, th / 2);
            g.fill();
            g.strokeColor = ai ? TAG_AI_EDGE : TAG_ME_EDGE;
            g.lineWidth = 2;
            g.roundRect(-tw / 2, -th / 2, tw, th, th / 2);
            g.stroke();
        }
    }

    private _setChip(i: number, text: string, color: Color): void {
        const chip = this._chips[i];
        if (!chip) return;
        const w = textWidth(text, CHIP_FONT) + CHIP_PAD * 2;
        this._chipW[i] = w;
        chip.getComponent(UITransform)?.setContentSize(w, CHIP_H);
        const g = chip.getComponent(Graphics) ?? chip.addComponent(Graphics);
        g.clear();
        g.fillColor = CHIP_BG;
        g.roundRect(-w / 2, -CHIP_H / 2, w, CHIP_H, 10);
        g.fill();
        g.strokeColor = CHIP_EDGE;
        g.lineWidth = 1.5;
        g.roundRect(-w / 2, -CHIP_H / 2, w, CHIP_H, 10);
        g.stroke();
        const lbl = chip.getChildByName('Label')?.getComponent(Label) ?? null;
        if (lbl) {
            lbl.string = text;
            lbl.color = color;
            lbl.node.getComponent(UITransform)?.setContentSize(w - 8, CHIP_H);
        }
    }

    /**
     * 芯片行**右对齐**在顶部第 1 行(左边是「返回 / 重新开始」)。
     * 原来芯片单独占一行居中, 顶部挤成三行; 现在与按钮同一行, 省出的高度给收牌面板。
     */
    private _layoutChips(): void {
        let cursor = CONTENT_W / 2 - CHIP_EDGE_PAD;
        for (let i = this._chips.length - 1; i >= 0; i--) {
            this._chips[i]?.setPosition(cursor - this._chipW[i] / 2, this._chipY, 0);
            cursor -= this._chipW[i] + CHIP_GAP;
        }
    }

    // ==================== 结算 ====================

    private _buildResult(): void {
        const mask = new Node('DrawResult');
        mask.parent = this.node;
        mask.addComponent(UITransform).setContentSize(6000, 6000);
        // 拦掉穿透到下层牌面/顶部按钮的触摸: 遮罩本身没有交互组件, 只靠它盖住是不够的,
        // 这里显式注册一个"吞掉事件"的处理器(卡片里的按钮是它的子节点, 仍然可点)
        const swallow = (e: EventTouch): void => { e.propagationStopped = true; };
        mask.on(Node.EventType.TOUCH_START, swallow, this);
        mask.on(Node.EventType.TOUCH_MOVE, swallow, this);
        mask.on(Node.EventType.TOUCH_END, swallow, this);
        mask.on(Node.EventType.TOUCH_CANCEL, swallow, this);
        mask.active = false;
        this._result = mask;

        const card = new Node('Card');
        card.parent = mask;
        card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
        this._resultCard = card;

        const title = createLabelNode('', 40, TEXT_TITLE, CARD_W - 40, 56);
        title.parent = card;
        title.setPosition(0, RES_TITLE_Y, 0);
        this._resTitle = title.getComponent(Label);

        const you = createLabelNode('', 30, CHIP_TEXT, CARD_W - 40, 44);
        you.parent = card;
        you.setPosition(0, RES_YOU_Y, 0);
        this._resYou = you.getComponent(Label);

        const ai = createLabelNode('', 30, CHIP_TEXT, CARD_W - 40, 44);
        ai.parent = card;
        ai.setPosition(0, RES_AI_Y, 0);
        this._resAi = ai.getComponent(Label);

        const who = createLabelNode('', 34, CHIP_TEXT, CARD_W - 40, 48);
        who.parent = card;
        who.setPosition(0, RES_WHO_Y, 0);
        this._resWho = who.getComponent(Label);

        const again = createButtonNode('再来一局', RES_BTN_W, RES_BTN_H, BTN_PRIMARY, PILL);
        again.parent = card;
        again.setPosition(-130, RES_BTN_Y, 0);
        const againLabel = again.getChildByName('Label')?.getComponent(Label) ?? null;
        if (againLabel) { againLabel.color = TEXT_INK; againLabel.isBold = true; }
        bindSafeClick(again, () => this.onRestart?.(), this);

        const backBtn = createButtonNode('返回主页面', RES_BTN_W, RES_BTN_H, LINE_GHOST, PILL_GHOST);
        backBtn.parent = card;
        backBtn.setPosition(130, RES_BTN_Y, 0);
        bindSafeClick(backBtn, () => this.onExit?.(), this);
    }

    private _hideResult(): void {
        if (this._result) this._result.active = false;
    }

    private _showResult(): void {
        const g = this._game;
        const mask = this._result;
        const card = this._resultCard;
        if (!g || !mask || !card) return;

        this._locked = true;
        this._setSelected(-1);
        mask.active = true;

        // 遮罩 + 卡片底框都在"显示之后"才画: 原生平台上, 隐藏节点里 onLoad 期画的
        // Graphics 顶点会丢, 显示后重画一次才上屏(与按钮补画同一个坑)
        const mg = mask.getComponent(Graphics) ?? mask.addComponent(Graphics);
        mg.clear();
        mg.fillColor = new Color(0, 0, 0, 190);
        mg.rect(-3200, -3200, 6400, 6400);
        mg.fill();

        const cg = card.getComponent(Graphics) ?? card.addComponent(Graphics);
        cg.clear();
        cg.fillColor = PANEL_BG;
        cg.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, CARD_RADIUS);
        cg.fill();
        cg.strokeColor = PANEL_EDGE;
        cg.lineWidth = 3;
        cg.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, CARD_RADIUS);
        cg.stroke();

        const you = g.scoreOf(0);
        const ai = g.scoreOf(1);
        const win = g.winner();
        if (this._resTitle) {
            this._resTitle.string = g.remaining === 0 ? '牌抽完了' : '没有可抽的对子了';
            this._resTitle.color = TEXT_TITLE;
        }
        if (this._resYou) {
            this._resYou.string = `你  ${you} 分`;
            this._resYou.color = you > ai ? RES_GAIN : you < ai ? RES_LOSS : RES_EVEN;
        }
        if (this._resAi) {
            this._resAi.string = `电脑  ${ai} 分`;
            this._resAi.color = ai > you ? RES_GAIN : ai < you ? RES_LOSS : RES_EVEN;
        }
        if (this._resWho) {
            this._resWho.string = win === 0 ? '你赢了！' : win === 1 ? '电脑赢了' : '平局';
            this._resWho.color = win === 0 ? RES_GAIN : win === 1 ? RES_LOSS : RES_EVEN;
        }
        repaintButtons(mask);
    }
}
