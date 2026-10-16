import { _decorator, Component, Node, Color, Label, Graphics, UITransform, Vec3, view, Canvas, Camera, UIOpacity, tween } from 'cc';
import { GameManager, GamePhase, MeldPromptItem, MeldPromptRequest, SEAT_NAMES } from './managers/GameManager';
import { createTileNode, createTileBackNode, createLabelNode, createButtonNode, createIconButton, repaintButtons, setTileBgColor, getFrontBand, applyDesignResolution, BTN_COLOR_GREY, ButtonStyle, bindSafeClick } from './ui/UIFactory';
import { TileView } from './ui/TileView';
import { MenuUI } from './ui/MenuUI';
import { SettlementPanel } from './ui/SettlementPanel';
import { HintPanel } from './ui/HintPanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { Hint } from './game/HintAdvisor';
import { GAME_RULES } from './game/GameRules';
import { preloadTileImages } from './ui/TileImage';
import { preloadSounds, playTileVoice, playMeldVoice, playPassVoice, playBgm } from './audio/Sound';
import {
    ANIM, centerOf, ensureOpacity, flashBurst, flyToSlot, gatherIn, glideTo, popIn, slideIn, stopTweensDeep, toWorld,
} from './ui/Anim';
import { Tile } from './core/Tile';
import { HAND_SIZE } from './core/TileDefine';
import { Meld } from './core/Meld';
import { SettlementData } from './core/HuScore';

const { ccclass } = _decorator;

/** 场景状态: 主页面 / 规则设置 / 对局中 */
enum SceneState { HOME, RULES, PLAYING }

/** 吃/碰选择按钮尺寸与间距(按钮自带 3D 底框,不再套外层黑底) */
const MELD_BTN_H = 52;
const MELD_BTN_GAP = 12;
/** 副露按钮金色 / "过"按钮灰色 / 吃胡按钮红色 */
const MELD_BTN_COLOR = new Color(196, 132, 44, 255);
const PASS_BTN_COLOR = new Color(96, 104, 116, 255);
const RON_BTN_COLOR = new Color(178, 52, 48, 255);

// ---- AI 提示按钮 ----
/** 提示按钮尺寸(与"听牌"按钮同一档, 视觉上属同一组) */
const HINT_BTN_W = 120;
const HINT_BTN_H = 46;
/** 提示按钮与"听牌"按钮之间的水平间距 */
const HINT_BTN_GAP = 14;
/** 提示面板与吃/碰按钮行之间的垂直间距 */
const HINT_PANEL_GAP = 18;
/**
 * 提示面板贴到转盘/手牌时保留的呼吸位
 *
 * 不留这一点的后果不是"压住", 而是**刚好贴死**: 版式校验算出来是 `panelBottom == handTop`,
 * 看起来像贴在一起。加几像素空隙才读得出"这是浮在上层的一张卡片"。
 */
const HINT_BREATH = 8;
/**
 * 提示面板高度的兜底值(面板还没显示时用它排版)
 *
 * 取"只有首选 + 一条次选"的典型高度: 顶部队落 + 首选 + 理由 + 分隔 + 1 条次选 + 上下内边距。
 */
const HINT_PANEL_FALLBACK_H = 26 + 6 + 46 + 4 + 28 + 18 + 26 + 44;

/**
 * 中央转盘的盘面半径(钳制范围)
 *
 * 实际半径由 _applyLayout 按"上下两家弃牌河(各按两行)之间的空隙"自适应:
 * 屏幕越扁(手机横屏)、牌河越大,盘面就越小,保证罗盘不会被弃牌压住。
 * 上限即目标尺寸 —— 手机上宁可小一点,也要把地方让给麻将牌。
 */
const TURN_DISC_R_MIN = 30;
const TURN_DISC_R_MAX = 52;
/** 指针尖端长度 / 盘面半径: 尖端略探出盘缘,盘变小指针同比变小 */
const TURN_NEEDLE_TIP_RATIO = 1.27;
/** 盘面外缘与弃牌河之间至少留出的空隙 */
const TURN_DISC_MARGIN = 6;

/** 吃/碰/杠来源标记的文字(索引 = 出牌者座位 0-3) */
const MELD_SOURCE_CHARS = ['你', '上', '左', '右'];
/** 副露行与手牌/牌河之间的留白: 要容下副露外侧的来源小标记 */
const MELD_MARK_GAP = 24;

/** 把数值限制在 [min, max] 内 */
function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

/**
 * 场景入口脚本 - 仿欢乐麻将界面
 *
 * 坐标以屏幕中心为原点(内容坐标,非固定分辨率):
 *  - 中央: 绿色麻将桌台面 + 方向盘
 *  - 4 家围坐: 自己(下) / 上家(上) / 左家(左) / 右家(右)
 *  - 中央出牌河: 4 家弃牌按方位显示
 *  - 顶部: 信息栏; 左上角: 重新开始
 *
 * 回合提示: 牌桌中央转盘上的金色指针转到当前出牌者方位(不再用座位发光框)
 *  - 自己(下) 180° / 上家(上) 0° / 左家(左) 90° / 右家(右) -90°
 *
 * 出牌交互(无摸牌/出牌按钮):
 *  - 轮到自己时自动摸牌,摸到的牌单独排在手牌最右侧并加金色标注
 *  - 点击手牌 → 该牌突出(选中);再次点击同一张 → 打出;点击其他区域 → 取消选中
 *  - 也可以按住手牌往上拖: 牌跟着手指走,离开手牌区(出现金色描边提示)后松手即出牌;
 *    拖回手牌区再松手则回弹到原位,不出牌(手势实现在 TileView,这里只做业务判定)
 *  - 打出后手牌自动理牌,摸到的牌并入正常位置
 *  - 别家打出的牌自己能吃/碰/杠时,弹面板由玩家选择(含"过"继续摸牌)
 *
 * 适配: 内容横向按屏宽铺满,纵向任由桌面超出屏幕(裁掉上下边框),
 *       UI 按可见区高度贴边排布,形成贴近桌面的第一视角。
 * 3D 透视效果: 底部牌最大(最近) → 顶部牌最小(最远)
 */
@ccclass('Main')
export class Main extends Component {
    // ---- 内容根节点与屏幕适配 ----
    // 所有游戏内容挂在 _gameRoot 下。横向按屏幕宽度铺满(左右边框可见),
    // 纵向任由桌面超出屏幕(裁掉上下边框),营造贴近桌面的第一视角。
    private _gameRoot: Node | null = null;
    /** 内容宽度基准(桌面最宽 1648 + 少量留白),决定横向铺满的缩放比 */
    private readonly CONTENT_W = 1680;
    /** 参考设计分辨率(16:9),运行时按屏幕比例扩展,保证至少 1920×1080 都可见 */
    private readonly BASE_W = 1920;
    private readonly BASE_H = 1080;

    // ---- UI 容器节点 ----
    private _handContainer: Node | null = null;
    private _discardContainer: Node | null = null;
    private _aiHandContainers: (Node | null)[] = [null, null, null];
    private _aiDiscardContainers: (Node | null)[] = [null, null, null];
    private _meldContainers: (Node | null)[] = [null, null, null, null];
    private _infoLabel: Label | null = null;
    /** 当前选中的手牌索引(-1=未选中);第一次点击选中突出,再次点击即出牌 */
    private _selectedIndex: number = -1;
    /** 手牌节点表(索引 = 手牌下标): 拖牌会把牌提到最上层,不能再靠 children[i] 取牌 */
    private _handNodes: Node[] = [];
    /** 拖牌出牌时,弃牌飞行动画的起点(松手的位置);用完即清 */
    private _dropFromWorld: Vec3 | null = null;
    /** 牌局已结束: 四家手牌全部亮出(牌背改牌面) */
    private _revealAll = false;
    // ---- 吃/碰/杠选择面板 ----
    /** 副露选择面板容器(默认隐藏,出现吃/碰时机时弹出) */
    private _meldPanel: Node | null = null;
    /** 面板按钮行容器(每次弹出按提示内容重建) */
    private _meldBtnRow: Node | null = null;
    /** 面板纵向位置(由 _applyLayout 按可见高度计算) */
    private _meldPanelY = 0;
    // ---- 结算面板 / 听牌(立直) ----
    /** 独立结算面板(胡牌或流局时弹出, 显示番型/得失分/四家手牌) */
    private _settlement: SettlementPanel | null = null;
    /** "听牌"宣言按钮(听牌时才出现) */
    private _riichiBtn: Node | null = null;
    /** 四家的"听"标记(已宣告听牌时亮出) */
    private _tenpaiMarkers: (Node | null)[] = [null, null, null, null];
    // ---- AI 提示 ----
    /** "提示"按钮: 玩家需要做决定时才亮 */
    private _hintBtn: Node | null = null;
    /** 提示面板(显示首选/理由/次选) */
    private _hintPanel: HintPanel | null = null;
    /** 当前被提示标记的手牌下标(-1 = 无); 手牌重建后据此重新贴标记 */
    private _hintedTileIndex = -1;
    /** 玩家手牌的上沿 y(提示面板绝不能压到这里, 由 _applyLayout 更新) */
    private _handTopY = 0;
    // ---- 需要按屏幕比例动态定位的零散节点 ----
    /**
     * 设置按钮(齿轮图标, 固定屏幕左上角)
     *
     * 2026-10-16: 原先这里并排两个文字按钮"重新开始 / 返回主页面",
     * 现按需求收成一个设置按钮 —— 点开弹窗里同时有声音设置与这两个操作。
     * 好处: 对局中能直接调音量(以前必须退回主菜单), 且牌桌上方让出一大片视觉空间。
     */
    private _settingsBtn: Node | null = null;
    /** 对局内设置弹窗(声音设置 + 重新开始 / 返回主页面) */
    private _settingsPanel: SettingsPanel | null = null;
    /** 设置按钮位置(由 _applyLayout 计算) */
    private _settingsBtnX = 0;
    private _settingsBtnY = 0;
    /** 当前场景状态(主页面 / 规则设置 / 对局中) */
    private _sceneState: SceneState = SceneState.HOME;
    /** 主页面与设置页面 */
    private _menu: MenuUI | null = null;
    /** 牌面图片是否已预加载完成 */
    private _tileImagesReady = false;
    /**
     * 静态矢量图形(牌桌/转盘/牌墙)是否已绘制到 GPU。
     *
     * 为什么不能在 onLoad 里直接画: 原生(JSB)平台上,组件 onLoad 阶段场景尚未进入
     * 第一个渲染帧,此时 Graphics 的绘制指令不会真正上传到 GPU —— 顶点数据在随后
     * 的渲染数据清空中被丢弃,表现为"牌桌/底板/转盘在真机上完全不见,而运行期
     * (对局中)新建的 Graphics 一切正常"。浏览器/编辑器预览没有这个差异。
     * 因此这些一次性静态图形统一推迟到 start() 之后的下一帧再画。
     */
    private _staticGraphicsDrawn = false;
    // ---- 过渡动画用的状态记录 ----
    /** 各座位手牌每张牌在"手牌容器"内的局部坐标(键=牌 id): 理牌滑位、出牌/副露飞行的起点 */
    private _handSlots: Map<number, Map<number, Vec3>> = new Map();
    /** 上一次渲染的手牌槽位快照(被打出的牌只存在于这份快照里) */
    private _prevHandSlots: Map<number, Map<number, Vec3>> = new Map();
    /** 各家弃牌河上一帧的张数(索引 0=自己,1-3=三家 AI): 只有 +1 才做出牌飞入,吃碰杠收牌时不动画 */
    private _riverCount: number[] = [0, 0, 0, 0];
    // ---- 发牌动画 ----
    /**
     * 发牌动画进行中
     *
     * 期间手牌是"只读"的: 玩家点不到(`playTile` 要求 PLAYER_TURN, 而发牌时阶段是 DEALING),
     * 这里额外拦一道是为了让"能不能点"与阶段无关, 逻辑更直白。
     */
    private _dealing = false;
    // ---- 回合提示(牌桌中央转盘指向)与剩余牌墙(图形化) ----
    /** 转盘盘面当前半径(由 _applyLayout 按可见高度自适应,见 TURN_DISC_R_MAX 注释) */
    private _discR = TURN_DISC_R_MAX;
    /** 中央转盘节点(盘面 + 指针) */
    private _turnDisc: Node | null = null;
    /** 转盘上的指针: 默认朝上(座位1),随回合转到当前出牌者方位 */
    private _turnPointer: Node | null = null;
    /** 指针目标角度(度,0=朝上/座位1) */
    private _pointerTargetAngle = 0;
    /** 指针当前角度(度),逐帧缓动逼近目标 */
    private _pointerAngle = 0;
    /** 指针呼吸动画计时 */
    private _pointerPulseT = 0;
    /** 决策倒计时: 环形进度 Graphics + 中央秒数 Label(平时整体隐藏) */
    private _countdownG: Graphics | null = null;
    private _countdownLabel: Label | null = null;
    /** 倒计时显示是否已创建(原生平台要等首帧后才画,见 _staticGraphicsDrawn) */
    private _countdownShown = false;
    /** 转盘的Y(倒计时叠在盘心, 目前不用单独记录) */
    private _discY = 0;
    private _wallNode: Node | null = null;
    private _wallG: Graphics | null = null;
    private _halfH = 0;

    /** 各座位在中央转盘上的指向角度(度): 0=朝上(上家), 180=朝下(自己), 90=朝左(左家), -90=朝右(右家) */
    private readonly POINTER_ANGLES = [180, 0, 90, -90];

    // ---- 牌的统一长宽比例 ----
    // 所有牌(自己手牌 / 上家手牌 / 左右家手牌 / 弃牌河 / 吃碰杠副露)的宽高比都与此一致,
    // 统一为 3:4(宽:高), 只通过宽度区分远近大小,改比例只需改 TILE_W / TILE_H 两个值。
    /** 玩家(底部)手牌宽度: 全局尺寸基准(最大,最近) */
    private readonly TILE_W = 63;
    /** 玩家(底部)手牌高度: 与宽度成 3:4(63×84) */
    private readonly TILE_H = 84;

    // ---- 玩家(底部)手牌 ----
    /** 牌间距: 0 = 牌与牌紧贴排成一整条 */
    private readonly TILE_GAP = 0;

    // ---- 上家(顶部)牌尺寸(最小,最远) ----
    // 对家(顶部)手牌略微加大,远端的牌不至于太小
    private readonly TOP_TILE_W = 36;
    private readonly TOP_TILE_GAP = 0;

    // ---- 左/右家牌尺寸(中等) ----
    private readonly SIDE_TILE_W = 38;
    private readonly SIDE_TILE_GAP = 0;

    // ---- 弃牌河牌尺寸 ----
    private readonly RIVER_TILE_W = 44;
    /** 牌间距/行距: 0 = 弃牌河与副露都排成紧贴的方阵 */
    private readonly RIVER_GAP = 0;
    /**
     * 上家/本家弃牌河每排最多张数
     * 取 9: 一局里每家最多弃 21 张,排到第三排时只剩 1~3 张,且从最外侧那一列开始,
     * 离桌心的转盘还很远。也不能再加大(例如 11 张/排): 那样这块牌河横向会顶到左右两家的牌河。
     */
    private readonly RIVER_COLS = 9;
    /**
     * 左/右家弃牌河每排张数(比上下的 9 张少)
     * 侧边那两块是旋转 80° 摆的,每排张数直接决定它在屏幕竖直方向的长度(9 张=396,7 张=308)。
     * 取 7 让这一块短一点: 残局堆到第 3 行时,两端的牌不会顶到本家副露行的两个角。
     */
    private readonly SIDE_RIVER_COLS = 7;
    // 四家的弃牌河容器一律不做纵向压缩(scaleY 全为 1):
    // 同一张 44 宽的牌,压过的比没压过的又扁又小,本家的牌河就会显得比其他三家小、宽高比也不对。
    // 副露(吃/碰/杠)那一排同样不单独配尺寸,直接用 RIVER_TILE_W / RIVER_GAP(见 _refreshMelds),
    // 容器也不压缩,于是本家的牌河与副露、三家的牌河,牌面完全相同。

    // ---- AI 布局配置: [手牌x, 横向(顶部/侧边), 弃牌x, Y缩放] ----
    // 手牌/弃牌的 y 由 _applyLayout 按可见高度动态计算(顶部贴可见上边,侧边居中)
    // 弃牌河排布统一走 RIVER_COLS,不在这里单独配置
    private readonly AI_LAYOUT: {
        hx: number; hH: boolean;
        dx: number; scaleY: number;
    }[] = [
        { hx: 0,    hH: true,  dx: 0,    scaleY: 1.0 }, // 上家/对家(顶部)
        { hx: -620, hH: false, dx: -340, scaleY: 1.0 }, // 左家
        { hx: 620,  hH: false, dx: 340,  scaleY: 1.0 }, // 右家
    ];

    /** 桌面侧边相对竖直方向的透视倾斜角(度),由桌台梯形几何推导(与 _buildTable 一致) */
    private readonly SIDE_EDGE_TILT = Math.atan2(
        786 - 786 * 0.78,           // 近端半宽 - 远端半宽
        526 + 526 * (530 / 560),    // 近端半高 + 远端半高
    ) * 180 / Math.PI;

    /**
     * 按手牌比例求高度: 传入任意宽度,返回与手牌同宽高比的高度。
     * 所有牌面统一走这里,避免各处硬编码高度导致比例不一致。
     */
    private _tileH(w: number): number {
        return (w * this.TILE_H) / this.TILE_W;
    }

    // ==================== 生命周期 ====================

    onLoad(): void {
        this._ensureGameManager();
        // 先建菜单(它会作为最后一个子节点置顶),再建牌桌
        this._buildMenu();
        this._buildUI();
        this._registerEvents();
        this._applyAdaptation();
        // 开局先进主页面,由"开始游戏"进入对局
        this._showScene(SceneState.HOME);
        // 屏幕比例变化时重新适配
        view.on('canvas-resize', this._onResize, this);
    }

    onDestroy(): void {
        view.off('canvas-resize', this._onResize, this);
    }

    start(): void {
        // 先把牌面图片预加载好,点"开始游戏"时首手牌即为图片牌面
        preloadTileImages(() => {
            this._tileImagesReady = true;
        });
        // 音效与背景音乐一起预加载(没加载好时点击声/出牌声会自动跳过,
        // 背景音乐则记下意图、加载完成后自动补播)
        preloadSounds();
        playBgm();
        // 静态矢量图形必须等首帧之后才画(原因见 _staticGraphicsDrawn 注释)。
        // scheduleOnce(0) 把绘制推到下一帧,此时渲染管线已就绪。
        this.scheduleOnce(() => this._drawStaticGraphics(), 0);
    }

    /**
     * 重画所有一次性静态矢量图形(牌桌 / 中央转盘 / 剩余牌墙 / 菜单底板)。
     * 这些图形都挂在 _gameRoot 或 MenuRoot 下且尺寸不随可见高度变化,重画是幂等的;
     * 牌墙位置依赖 _halfH,故顺带刷新一次。
     */
    private _drawStaticGraphics(): void {
        if (this._staticGraphicsDrawn) return;
        this._staticGraphicsDrawn = true;
        this._buildTable();
        this._buildTurnPointer();
        this._refreshWall();
        this._menu?.redrawBackdrop();
        // 按钮同理: onLoad 期间画的底框在原生平台上下不来(只剩文字),
        // 菜单与牌桌上所有按钮都在这里补画一次,之后由各处"显示时补画"维持。
        repaintButtons(this.node);
    }

    private _onResize(): void {
        this._applyAdaptation();
        this._menu?.adapt();
    }

    // ==================== 主页面 / 规则设置 ====================

    /** 创建主页面与设置页面(MenuUI 挂在独立子节点上,与牌桌互斥显示) */
    private _buildMenu(): void {
        const menuNode = new Node('Menu');
        menuNode.parent = this.node;
        this._menu = menuNode.addComponent(MenuUI);
        this._menu.onStart = () => this._startGameFromMenu();
    }

    /** 切换场景显示: 主页面 / 规则设置 / 对局中 */
    private _showScene(state: SceneState): void {
        this._sceneState = state;
        const playing = state === SceneState.PLAYING;
        if (playing) {
            this._menu?.hide();
        } else if (state === SceneState.RULES) {
            this._menu?.showRules();
        } else {
            this._menu?.showHome();
        }
        if (this._gameRoot) this._gameRoot.active = playing;
        // 原生平台: 牌桌被隐藏过之后,表上的按钮(重新开始/返回主页面)只剩文字,开局时补画
        if (playing) repaintButtons(this._gameRoot);
        // 节点顺序决定渲染层级: 先牌桌后菜单,菜单始终在最上层
        this._bringToFront(this._gameRoot);
        this._bringToFront(this._menu?.node ?? null);
    }

    /** 把节点移到父节点最后一个子节点位置(最后子节点渲染在最上层) */
    private _bringToFront(node: Node | null): void {
        if (node) node.setSiblingIndex(node.parent ? node.parent.children.length - 1 : 0);
    }

    /** 主菜单"开始游戏": 预加载完成后按当前规则重新开局 */
    private _startGameFromMenu(): void {
        const begin = (): void => {
            this._showScene(SceneState.PLAYING);
            this._revealAll = false;
            // 对局中随时可以调设置/重开/退出,开局就把设置按钮亮出来
            this._showSettingsButton();
            // 浏览器预览下音频要用户手势才能解锁,开局时再确保一次(已在播则无副作用)
            playBgm();
            this._startDealing();
        };
        if (this._tileImagesReady) {
            begin();
        } else {
            preloadTileImages(() => {
                this._tileImagesReady = true;
                begin();
            });
        }
    }

    // ==================== 发牌动画 ====================

    /**
     * 开局发牌(带动画)
     *
     * 原本 52 张牌在同一帧全部发完, 四家手牌"啪"地整排出现, 很突兀。
     *
     * 【关键设计: 牌同步发完, UI 分帧"揭示"】
     * 最初想把发牌拆成 13 次异步回调逐轮播, 但 `startGame` 是**同步**方法 ——
     * 13 次回调全落在同一帧, 每帧重建手牌都会把上一帧的动画节点销毁,
     * 结果等于**没动画**(还白白重建 13 次)。这个坑踩过。
     *
     * 所以最终方案: `GameManager.startGame()` 一次性把牌发完并停在 DEALING,
     * UI 再按 `ANIM.dealInterval` 逐帧多显示一张, 让它从牌墙飞进各家手里。
     * 规则层保持同步可测(AGENTS.md 的分层约定), 动画节奏完全由 UI 控制。
     *
     * 【时序安全】
     * 发牌期间 `GameManager.phase` 是 DEALING, 于是玩家点不到手牌、
     * 不会起 20 秒倒计时、AI 也不会行动 —— 直到动画播完调 `beginPlay()`。
     * 中途返回主页面/重新开始时, 调用方要自己 `unscheduleAllCallbacks()`
     * (清 Main 排的帧) + `_abortDealing()` (清 UI 标记)。
     */
    private _startDealing(): void {
        const gm = GameManager.instance;
        if (!gm) return;
        this._dealing = true;
        this._dealShown = 0;
        // 发牌期间不能沿用上一局的槽位快照:
        // 否则新发的牌会"从上一局的位置滑过来", 读起来是错位的瞬移
        this._handSlots.clear();
        this._prevHandSlots.clear();
        this._riverCount = [0, 0, 0, 0];

        // 牌同步发完(张数立刻就是 13), 但由下面的帧逐张揭示
        gm.startGame(GAME_RULES.rules, () => this._renderDealFrame(0));
        // 记下"发完牌后墙里剩多少张", 之后每帧减去已揭示的张数,
        // 牌墙就会看起来在一张张被取走(而不是发完就一直是最终张数)
        this._wallRemainingBase = gm.wallRemaining;
        this.scheduleOnce(() => this._dealNextFrame(), ANIM.dealLeadIn);
    }

    /** 当前已揭示到第几张(0 = 一张都没显示, 13 = 全部显示) */
    private _dealShown = 0;

    /** 发完 13 张后牌墙的真实剩余张数(发牌动画每帧从它往回退) */
    private _wallRemainingBase = 0;

    /** 推进一帧发牌动画: 多揭示一张, 再排下一帧 */
    private _dealNextFrame(): void {
        const gm = GameManager.instance;
        if (!gm || this._sceneState !== SceneState.PLAYING) return;
        if (gm.phase !== GamePhase.DEALING) {
            // 期间被 stopGame / 重开打断了: 收尾, 别把牌留在半截状态
            this._dealing = false;
            this._dealShown = 0;
            this._refreshHand();
            return;
        }

        this._dealShown++;
        this._renderDealFrame(this._dealShown);

        if (this._dealShown >= HAND_SIZE) {
            // 13 张都到位: 等最后一轮飞行动画收尾, 再让玩家真正开始
            this.scheduleOnce(() => this._finishDealing(), ANIM.dealLastSettle);
            return;
        }
        this.scheduleOnce(() => this._dealNextFrame(), ANIM.dealInterval);
    }

    /**
     * 按"已揭示 n 张"重画四家手牌, 并让第 n 张从牌墙飞进来
     *
     * @param shown 已揭示的张数(0~13)
     */
    private _renderDealFrame(shown: number): void {
        const gm = GameManager.instance;
        if (!gm) return;
        const n = Math.max(0, Math.min(HAND_SIZE, shown));

        // 每帧都要重建: 整排是居中排布的, 张数变了位置就得重算。
        // 只给"本帧新揭示的那张"加飞入动画, 其余静止 —— 否则每帧都在重排, 读起来像洗牌。
        this._refreshHand(n);
        const aiCount = gm.aiCount;
        for (let a = 0; a < aiCount; a++) this._refreshAIHand(a, n);
        // 牌墙同步回退: 视觉上牌一张张从墙里被取走
        this._refreshWall(this._wallRemainingBase - n);

        if (n === 0) return;
        const wallWorld = this._wallNode ? centerOf(this._wallNode) : null;
        this._dealTileFly(0, n - 1, wallWorld);
        for (let a = 0; a < aiCount; a++) this._dealTileFly(a + 1, n - 1, wallWorld);
    }

    /**
     * 让某家"本帧新揭示的那张牌"从牌墙飞进手牌
     * @param seat 座位(0=自己,1-3=AI)
     * @param index 该牌在自家手牌容器里的序号
     * @param fromWorld 起点(牌墙中心);为空则只做原地弹入
     */
    private _dealTileFly(seat: number, index: number, fromWorld: Vec3 | null): void {
        const container = seat === 0 ? this._handContainer : this._aiHandContainers[seat - 1];
        if (!container) return;
        const node = container.children[index];
        if (!node) return;

        // 错峰: 同一帧里 4 家依次落下, 读起来像"一张张码到各家手里"
        const order = [0, 1, 3, 2];  // 自己 → 上家 → 左家 → 右家, 绕桌顺时针
        const delay = order.indexOf(seat) * ANIM.dealStagger;
        const op = ensureOpacity(node);
        op.opacity = 0;
        flyToSlot(node, container, {
            fromWorld,
            startScale: 0.82,
            // 轻微歪着落位再回正 —— 读起来是"牌被甩进手里", 而不是平移过去
            startTilt: seat === 0 ? -8 : 8,
            startOpacity: 255,
            duration: ANIM.dealFly,
            delay,
        });
        tween(op).delay(delay).to(ANIM.dealFly * 0.45, { opacity: 255 }).start();
    }

    /**
     * 发牌动画播完: 定稿刷新全部手牌, 再让玩家真正进入回合
     *
     * 这次刷新**必须**做: 前面每帧只画了前 n 张(且位置按 n 张居中),
     * 这里要按完整 14 张重画一遍, 否则玩家会少牌、且整排位置也不对。
     */
    private _finishDealing(): void {
        const gm = GameManager.instance;
        if (!gm || this._sceneState !== SceneState.PLAYING) return;
        this._dealShown = 0;
        this._refreshHand();
        for (let a = 0; a < gm.aiCount; a++) this._refreshAIHand(a);
        this._refreshWall();
        this._dealing = false;
        // 真正开局: 自动摸牌 + 起 20 秒倒计时(发牌期间刻意不起, 否则动画还没完就开始计时)
        gm.beginPlay();
    }

    /**
     * 对局中/结束后"返回主页面": 停下当前对局,收起牌桌回到主菜单
     */
    private _backToMenu(): void {
        this._setSelection(-1);
        this._hideMeldPrompt();
        // 发牌动画可能正在播: 一并撤销, 否则排队的帧会在主菜单里继续刷新手牌。
        // 注意清的是 **Main 自己**的调度 —— GameManager.stopGame() 里的
        // unscheduleAllCallbacks() 只清 GameManager 自己的(AI 调度), 清不到这里。
        this.unscheduleAllCallbacks();
        this._abortDealing();
        // 返回前先收起设置弹窗(含恢复倒计时) —— 否则下局开始时它还压在牌桌上
        this._closeSettings();
        // 中途返回要把对局真的停下来: 撤销排队中的 AI 调度 + 清掉等待中的副露选择
        GameManager.instance?.stopGame();
        this._clearTable();
        this._revealAll = false;
        if (this._settingsBtn) this._settingsBtn.active = false;
        this._showScene(SceneState.HOME);
    }

    /**
     * 中断发牌动画(返回主页面 / 重新开始时调用)
     *
     * 排队中的帧由**调用方**的 `this.unscheduleAllCallbacks()` 清掉 ——
     * `GameManager.stopGame()`/`startGame()` 里那个同名方法作用在 GameManager 组件上,
     * 清不到 Main 排的 `_dealNextFrame` / `_finishDealing`。
     * 这里只负责把 UI 侧的发牌状态归零 —— 否则 `_dealing` 残留为 true,
     * 下一局开始时点击手牌会被静默吞掉(表现为"牌点不动")。
     */
    private _abortDealing(): void {
        this._dealing = false;
        this._dealShown = 0;
    }

    /**
     * 亮出左上角设置按钮
     * 整局都显示(含牌局结束后),想调声音/重开/退出随时可点;
     * 原生平台上"藏过再亮"的 Graphics 会只剩文字,所以激活后立刻补画一次底框。
     */
    private _showSettingsButton(): void {
        if (!this._settingsBtn) return;
        this._settingsBtn.active = true;
        repaintButtons(this._settingsBtn);
    }

    /** 清空牌桌上所有牌面(手牌/弃牌河/副露) */
    private _clearTable(): void {
        if (this._handContainer) this._clearChildren(this._handContainer);
        if (this._discardContainer) this._clearChildren(this._discardContainer);
        for (let i = 0; i < 3; i++) {
            this._clearChildren(this._aiHandContainers[i]!);
            this._clearChildren(this._aiDiscardContainers[i]!);
        }
        for (let i = 0; i < 4; i++) {
            this._clearChildren(this._meldContainers[i]!);
        }
        // 新一局: 手牌槽位快照与弃牌河张数一并归零,避免新局的第一次出牌误做飞入动画
        this._handSlots.clear();
        this._prevHandSlots.clear();
        this._riverCount = [0, 0, 0, 0];
        // 手牌节点引用也必须归零(极易漏,踩过):
        // 上面 destroy 掉的牌节点在**帧末**才真正销毁,而下一局开始时已经跨帧了 ——
        // 此时 `_handNodes` 里若还留着它们,任何对这批节点的 getComponent 调用
        // 都会进引擎 `Node._findComponent` 读已置 null 的 `_components.length`,
        // 抛 "Cannot read properties of null (reading 'length')"。
        // 表现是"返回主页面后再点开始游戏必崩"(同一 tick 内重开反而正常,
        // 因为那时节点还没被真正销毁)。
        this._handNodes = [];
        this._hintedTileIndex = -1;
        // 收起结算面板与听牌标记
        this._settlement?.hide();
        for (const m of this._tenpaiMarkers) if (m) m.active = false;
        if (this._riichiBtn) this._riichiBtn.active = false;
        // 新一局/返回主页面: 倒计时与提示一并收起(下一局需要时会重新起/重新要)
        this._hideCountdown();
        this._hideHint();
        // 设置弹窗一并收起(它可能开着; 收起时恢复被冻结的决策倒计时)
        this._closeSettings();
        // 发牌链被 unscheduleAllCallbacks 清掉时, toast 的自动清除也一并没了,
        // 这里主动清一次, 免得上一局的提示文字留到下一局还挂在桌上
        this._clearMessage();
    }

    /**
     * 中央转盘指针动画 + 决策倒计时刷新:
     *  - 缓动旋转到当前出牌者方位(走最短路径,避免绕圈)
     *  - 回合进行中指针轻微呼吸,强调"该这边出牌了";牌局结束则压暗
     *  - 倒计时跟随 GameManager 的剩余时间, 只在玩家需要做决定时显示
     */
    update(dt: number): void {
        // 倒计时不依赖转盘指针是否存在(指针没建好时也要能画),
        // 且必须在 pointer 早退之前调用
        this._refreshCountdown();
        const pointer = this._turnPointer;
        if (!pointer) return;

        // 最短路径缓动到目标角度
        let diff = this._pointerTargetAngle - this._pointerAngle;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        if (Math.abs(diff) < 0.05) {
            this._pointerAngle = this._pointerTargetAngle;
        } else {
            this._pointerAngle += diff * Math.min(1, dt * 7);
        }
        pointer.angle = this._pointerAngle;

        const op = pointer.getComponent(UIOpacity);
        if (!op) return;
        const gm = GameManager.instance;
        const running = !!gm && gm.isTurnRunning;
        if (!running) {
            // 发牌中/已结束: 压暗但保留指向,不做呼吸
            op.opacity = 160;
            return;
        }
        this._pointerPulseT += dt;
        op.opacity = 210 + Math.round(45 * (0.5 + 0.5 * Math.sin(this._pointerPulseT * 4)));
    }

    /**
     * 屏幕适配:
     * 1) 把设计分辨率扩成与屏幕相同的比例(且不小于 1920×1080),从而铺满整个屏幕、不留黑边;
     * 2) 内容按宽度铺满(缩放比 = 设计宽 / CONTENT_W),左右桌面边框完整可见;
     * 3) 纵向允许桌面超出屏幕(裁掉上下边框),再把 UI 贴到可见区上下边界,形成贴近桌面的第一视角。
     */
    private _applyAdaptation(): void {
        const design = applyDesignResolution(this.BASE_W, this.BASE_H);
        if (!this._gameRoot) return;
        const scale = design.width / this.CONTENT_W;
        this._gameRoot.setScale(scale, scale, 1);

        // 可见区在内容坐标系中的半高 = 设计半高 / 缩放比
        this._applyLayout((design.height / 2) / scale);
    }

    /**
     * 依据可见半高 halfH 定位所有 UI(内容坐标,原点为屏幕中心):
     *  - 底部由下到上: 手牌 → 副露 → 弃牌河
     *  - 顶部由上到下: 上家手牌 → 上家副露 → 上家弃牌河(整组紧贴屏幕顶边)
     *  - 信息栏(临时提示)让位,放在上家牌组下方
     *  - 吃/碰选择面板浮在自家弃牌河之上
     *  - 左/右家保持竖直居中;重新开始按钮固定在屏幕左上角
     */
    private _applyLayout(halfH: number): void {
        const rivH = this._tileH(this.RIVER_TILE_W);
        const topTileH = this._tileH(this.TOP_TILE_W);
        // 副露行高 = 牌河牌高: 那一排的牌就用弃牌河的尺寸(见 _refreshMelds),
        // 两处牌面一样大,行高自然也一样,不再单列一个数字
        const meldH = rivH;
        // 副露行与手牌/牌河之间留宽一点: 副露牌外侧要挂"吃/碰/杠是从谁那里来的"小标记
        const meldGap = MELD_MARK_GAP;

        // ---- 底部: 手牌 → 副露 → 弃牌河(按钮已移除) ----
        const handY = -halfH + this.TILE_H / 2 + 8;
        const meldY = handY + this.TILE_H / 2 + meldH / 2 + meldGap;
        const discY = meldY + meldH / 2 + rivH / 2 + meldGap;

        // ---- 顶部: 上家 → 手牌(牌背) → 副露 → 弃牌河,依次紧贴屏幕顶部 ----
        // 亮牌时上家手牌改用正面绘制,正面牌会多出一点顶侧厚度(band),
        // 所以整组下移 band,避免牌顶被屏幕裁掉
        const topBand = this._revealAll ? getFrontBand(this.TOP_TILE_W, topTileH) : 0;
        const topHandY = halfH - 8 - topBand - topTileH / 2;
        const topMeldY = topHandY - topTileH / 2 - meldH / 2 - meldGap;
        const topDiscY = topMeldY - meldH / 2 - rivH / 2 - meldGap;
        // 信息栏仅作临时提示,让位给上家牌组,放在其下方。
        // 只按两行弃牌河让位: 牌堆到第三行时已是残局,而按三行让位会把提示压到
        // 桌面中央的象牙盘面上(金色字压在米色盘上几乎看不清),宁可残局时和牌河叠一下
        const infoY = topDiscY - (rivH + this.RIVER_GAP) - rivH / 2 - 24 - 22;

        // ---- 中央转盘: 半径按上下弃牌河(各按两行)之间的空隙自适应 ----
        // 牌河按"每排 RIVER_COLS 张、从中间往外填"排布,堆到第三行时新的一行从最外侧
        // 那一列开始,离盘心还很远,所以按两行留空隙就够 —— 前中期罗盘必然完整露出来。
        // 牌本身画在盘面之上,万一后半段堆到盘心附近,也是牌压盘、不会盘压牌。
        const bottomRiverTop = discY + (rivH + this.RIVER_GAP) + rivH / 2;
        const topRiverBottom = topDiscY - (rivH + this.RIVER_GAP) - rivH / 2;
        this._setTurnDiscRadius(clamp(
            Math.min(-bottomRiverTop, topRiverBottom) - TURN_DISC_MARGIN,
            TURN_DISC_R_MIN,
            TURN_DISC_R_MAX,
        ));
        // 转盘的 Y 记下来: 倒计时圆牌要摆在盘面下方(见 _ensureCountdownWidget)
        this._discY = 0;

        if (this._handContainer) this._handContainer.setPosition(0, handY, 0);
        // 左上角设置按钮(齿轮图标, 对局中唯一常驻按钮; 其余操作在弹窗里)
        this._settingsBtnX = -this.CONTENT_W / 2 + 24 + 32;
        this._settingsBtnY = halfH - 8 - 32;
        this._settingsBtn?.setPosition(this._settingsBtnX, this._settingsBtnY, 0);
        if (this._meldContainers[0]) this._meldContainers[0].setPosition(0, meldY, 0);
        if (this._discardContainer) this._discardContainer.setPosition(0, discY, 0);
        if (this._infoLabel) this._infoLabel.node.setPosition(0, infoY, 0);
        // 吃/碰选择面板: 浮在自家弃牌河之上(不遮挡手牌)
        this._meldPanelY = discY + rivH / 2 + 30;
        this._meldPanel?.setPosition(0, this._meldPanelY, 0);
        // 提示面板: 由 _placeHintPanel 在按钮行上/下两条通道里挑宽的那条落位,
        // 这里只更新它依赖的边界(手牌上沿; 转盘半径已在本函数里算好)。
        this._handTopY = handY + this.TILE_H / 2;
        this._placeHintPanel();

        // 听牌(立直)按钮在自家手牌左侧; "提示"按钮排在它右边同一排
        const halfW = this.CONTENT_W / 2;
        const riichiX = -halfW + 115;
        this._riichiBtn?.setPosition(riichiX, handY, 0);
        this._hintBtn?.setPosition(riichiX + HINT_BTN_W / 2 + HINT_BTN_GAP + HINT_BTN_W / 2, handY, 0);
        this._tenpaiMarkers[0]?.setPosition(halfW - 70, handY, 0);
        this._tenpaiMarkers[1]?.setPosition(-halfW + 70, topMeldY, 0);
        this._tenpaiMarkers[2]?.setPosition(-halfW + 70, 0, 0);
        this._tenpaiMarkers[3]?.setPosition(halfW - 70, 0, 0);

        // ---- 上家(索引 0): 贴可见顶部 ----
        this._aiHandContainers[0]?.setPosition(0, topHandY, 0);
        this._meldContainers[1]?.setPosition(0, topMeldY, 0);
        this._aiDiscardContainers[0]?.setPosition(0, topDiscY, 0);

        // ---- 左/右家(索引 1、2): 竖直居中 ----
        for (let i = 1; i <= 2; i++) {
            const layout = this.AI_LAYOUT[i];
            this._aiHandContainers[i]?.setPosition(layout.hx, 0, 0);
            this._aiDiscardContainers[i]?.setPosition(layout.dx, 0, 0);
            if (this._meldContainers[i + 1]) {
                const offX = i === 1 ? 70 : -70;
                this._meldContainers[i + 1]!.setPosition(layout.hx + offX, 0, 0);
            }
        }

        // ---- 回合提示: 中央转盘固定在桌心,方向由指针旋转表达(无需随可见高度重排) ----

        // ---- 剩余牌墙(图形化),依赖当前可见高度 ----
        this._halfH = halfH;
        // 结算面板按可见高度自适应(手机横屏比 16:9 矮很多), 转屏/改窗口时跟着重排
        this._settlement?.fit(halfH);
        // 设置弹窗同理: 卡片高度随可见高度缩放, 转屏时要重排(否则按钮会被挤出屏幕)
        this._settingsPanel?.fit(halfH);
        this._refreshWall();
    }

    // ==================== GameManager 初始化 ====================

    private _ensureGameManager(): void {
        if (GameManager.instance) return;
        const gmNode = new Node('GameManager');
        gmNode.parent = this.node;
        gmNode.addComponent(GameManager);
    }

    // ==================== UI 构建 ====================

    private _buildUI(): void {
        this._setupBackdrop();

        // 内容根: 所有游戏内容挂在它下面,统一做屏幕适配缩放
        const root = new Node('GameRoot');
        root.parent = this.node;
        // 给内容根一个足够大的可点击区域,用于"点击其他区域取消选牌"
        root.addComponent(UITransform).setContentSize(6000, 6000);
        root.on(Node.EventType.TOUCH_START, this._onBackgroundTouch, this);
        this._gameRoot = root;

        this._buildTable();
        // 转盘指针需渲染在桌面(含中央转盘)之上、各座位牌之下,故紧随桌面创建
        this._buildTurnPointer();
        this._buildWallWidget();

        const infoNode = createLabelNode('', 32, new Color(255, 240, 180, 255), 1000);
        infoNode.parent = this._gameRoot;
        this._infoLabel = infoNode.getComponent(Label);

        this._discardContainer = new Node('PlayerDiscard');
        // 不设 scale: 与三家 AI 的弃牌河容器一样保持 1:1,否则本家的牌会显得又扁又小
        // UITransform 只为坐标换算(出牌动画把世界坐标转成容器局部坐标),不参与渲染
        this._discardContainer.addComponent(UITransform).setContentSize(1, 1);
        this._discardContainer.parent = this._gameRoot;

        this._handContainer = new Node('PlayerHand');
        this._handContainer.addComponent(UITransform).setContentSize(1, 1);
        this._handContainer.parent = this._gameRoot;

        // 左上角设置按钮(齿轮图标): 对局中唯一常驻的按钮,
        // 声音设置与"重新开始 / 返回主页面"都收进它弹出的设置弹窗里
        this._buildSettingsUI();

        this._buildAISeats();

        this._buildMeldAreas();

        this._buildMeldPrompt();

        this._buildRiichiButton();

        this._buildHintUI();

        this._buildTenpaiMarkers();

        this._buildSettlementPanel();

        // 节点创建顺序带来的层级不对: 副露区是最后建的,会盖在自家手牌上
        // (选中的牌上抬、以及拖牌时,上半截会被自家吃/碰/杠那一行压住),统一排一次
        this._applyLayerOrder();
    }

    /**
     * 统一各座位牌面的渲染层级(后移的压在上面)
     *
     * 1) 三家 AI 在自己座位内部按远近排(手牌最远、弃牌河最近): 手牌 → 副露 → 弃牌河
     * 2) 自己那一组整体排在所有 AI 之上(手牌离镜头最近,而且要承载"拖动的牌"),
     *    组内同样是 弃牌河 → 副露 → 手牌
     * 3) 最上层: 左上角按钮与吃/碰选择面板
     *
     * 这样拖动手牌经过任何一家的牌区都不会被遮挡,选中的牌也不会被自家副露挡住。
     */
    private _applyLayerOrder(): void {
        const root = this._gameRoot;
        if (!root) return;
        // 依次移到最上层: 先移的在下面,后移的在上面
        const push = (node: Node | null | undefined): void => {
            if (node && node.parent === root) node.setSiblingIndex(root.children.length - 1);
        };

        // ---- 三家 AI: 各自 手牌(远) → 副露 → 弃牌河(近) ----
        for (let i = 0; i < 3; i++) {
            push(this._aiHandContainers[i]);
            push(this._meldContainers[i + 1]);
            push(this._aiDiscardContainers[i]);
        }

        // ---- 自己整组压在所有 AI 之上: 弃牌河 → 副露 → 手牌(最近) ----
        push(this._discardContainer);
        push(this._meldContainers[0]);
        push(this._handContainer);

        push(this._settingsBtn);
        push(this._riichiBtn);
        push(this._hintBtn);
        push(this._hintPanel?.node);
        push(this._meldPanel);
        // 设置弹窗(含遮罩)压在牌桌之上、结算面板之下:
        // 结算出现时牌局已结束, 不该再被设置弹窗盖住
        push(this._settingsPanel?.node);
        // 结算面板永远在最上层: 遮罩 + 番型/手牌, 盖住整张牌桌
        push(this._settlement?.node);
    }

    /**
     * 创建"听牌(立直)"宣言按钮(默认隐藏)
     *
     * 听牌且没宣告过时才出现; 点它把听牌亮给对手看(加 1 番),
     * 宣告后本局不能再吃/碰/杠, 出牌也必须保持听牌。
     */
    private _buildRiichiButton(): void {
        const color = new Color(226, 182, 74, 255);
        const btn = createButtonNode('听牌', 120, 46, color, ButtonStyle.Pill);
        btn.parent = this._gameRoot;
        bindSafeClick(btn, () => this._onRiichiClick(), this);
        btn.active = false;
        this._riichiBtn = btn;
    }

    /**
     * 创建 AI 提示的按钮与面板(默认隐藏)
     *
     * 按钮放在**自家手牌左侧**: 玩家的视线本来就在手牌上, 而"提示"要回答的
     * 正是"这张/那张怎么打"。放在"听牌"按钮右边同一排, 两者都属于"关于手牌的辅助操作"。
     *
     * 面板浮在自家弃牌河上方(与吃/碰面板同一带), 不遮挡手牌 —— 玩家看到建议后
     * 还要能立刻点那张牌, 所以**绝不能压在手牌区上面**。
     */
    private _buildHintUI(): void {
        // 青蓝色: 牌桌上原本只有金(刚摸到/副露)与红(吃胡)两种信号色,
        // 提示是第三种语义, 用一个没出现过的颜色最不容易混淆
        const hintColor = new Color(96, 186, 190, 255);
        const btn = createButtonNode('提示', HINT_BTN_W, HINT_BTN_H, hintColor, ButtonStyle.PillGhost);
        btn.parent = this._gameRoot;
        bindSafeClick(btn, () => this._onHintClick(), this);
        btn.active = false;
        this._hintBtn = btn;

        const panelNode = new Node('HintPanel');
        panelNode.parent = this._gameRoot;
        panelNode.addComponent(UITransform).setContentSize(1, 1);
        const panel = panelNode.addComponent(HintPanel);
        panel.onClose = () => this._hideHint();
        panelNode.active = false;
        this._hintPanel = panel;
    }

    /**
     * 创建设置按钮与设置弹窗
     *
     * 按钮是齿轮图标(浅色圆底 + 深图标), 位置沿用原"重新开始"按钮的左上角;
     * 弹窗里放声音设置与"重新开始 / 返回主页面"两个对局操作。
     * 声音设置直接读写 GAME_RULES + syncAudioSettings(), 与主菜单"设置规则"页
     * 共用同一份数据与档位定义(MenuUI 导出) —— 两处各存一份必然漂移。
     */
    private _buildSettingsUI(): void {
        // 底: 近白偏暖的浅色圆底(深绿牌桌上清晰), 图标只有 40px, 靠底托住
        const btn = createIconButton('icons/settings', 64, 64, new Color(245, 240, 228, 255), ButtonStyle.Pill, 40);
        btn.parent = this._gameRoot;
        bindSafeClick(btn, () => this._onSettingsClick(), this);
        this._settingsBtn = btn;

        const panelNode = new Node('SettingsPanel');
        panelNode.parent = this._gameRoot;
        panelNode.addComponent(UITransform).setContentSize(1, 1);
        const panel = panelNode.addComponent(SettingsPanel);
        // 两个对局操作都要先把弹窗收掉再执行: 否则重开后弹窗还压在牌桌上
        panel.onRestart = () => this._closeSettings(() => this._onRestartClick());
        panel.onBack = () => this._closeSettings(() => this._onBackToMenuClick());
        panel.onClose = () => this._closeSettings();
        panelNode.active = false;
        this._settingsPanel = panel;
    }

    /** 点设置按钮: 弹出设置弹窗, 并冻结 20 秒决策倒计时 */
    private _onSettingsClick(): void {
        if (this._sceneState !== SceneState.PLAYING) return;
        const panel = this._settingsPanel;
        if (!panel || panel.isOpen) return;
        // 先按当前可见高度重排(转屏后可能变过), 再显示
        panel.fit(this._halfH);
        // 冻结倒计时: 玩家在调音量时看不到牌桌, 不该被系统判超时替他出牌
        GameManager.instance?.pauseDecideTimer();
        panel.show();
    }

    /**
     * 关闭设置弹窗并恢复决策倒计时
     * @param after 关闭后要执行的动作(重新开始 / 返回主页面)
     */
    private _closeSettings(after?: () => void): void {
        if (this._settingsPanel?.isOpen) this._settingsPanel.hide();
        GameManager.instance?.resumeDecideTimer();
        after?.();
    }

    /** 设置弹窗是否正开着(牌桌输入要在这期间被拦掉) */
    private _settingsOpen(): boolean {
        return this._settingsPanel?.isOpen === true;
    }

    /** 点"提示": 向 GameManager 要一份建议, 由 onHint 回调驱动显示 */
    private _onHintClick(): void {
        const gm = GameManager.instance;
        if (!gm || this._sceneState !== SceneState.PLAYING) return;
        // 发牌动画期间点提示没有意义(此刻还没轮到自己), 静默忽略, 与牌面点击同理
        if (this._dealing) return;
        gm.requestHint();
    }

    /**
     * 显示一份提示: 面板 + 在被建议的手牌上贴青色标记
     *
     * 标记的是**手牌下标**, 而手牌每次刷新都是整体重建的 —— 所以这里既记录下标,
     * 也由 `_refreshHand` 在重建后重新贴一次(见 `_reapplyHintMark`)。
     */
    private _showHint(hint: Hint): void {
        const panel = this._hintPanel;
        if (!panel) return;
        panel.show(hint);
        // 面板高度随"次选条数"变化, 每次显示后都要按新高度重新定位
        this._placeHintPanel();
        // 出牌类提示才需要标手牌; 吃/碰/胡的提示标的是副露面板上的按钮, 由 _showMeldPrompt 处理
        if (hint.kind === 'discard' && hint.best) {
            this._hintedTileIndex = hint.best.index;
            this._reapplyHintMark();
        } else {
            this._clearHintMark();
        }
    }

    /**
     * 按可用高度自适应并定位提示面板
     *
     * 【两种落位, 看屏幕比例】面板锚在吃/碰按钮行的上沿, 向上生长;
     * 但屏幕越扁(手机横屏)这条带越窄, 极端比例下按钮行上沿已经贴着中央转盘,
     * 此时再往上放就会盖住转盘与倒计时 —— 那种情况下改为**落到按钮行下方**
     * (压在自家弃牌河上方, 与吃/碰面板本身的做法一致)。
     *
     * 两种落位都把可用高度交给 `fit()`: 空间不够就整体缩放, 缩到下限仍不够就砍次选,
     * 于是**永远不会压到中央转盘、也不会压到手牌** —— 后者尤其重要,
     * 提示之后玩家要立刻点那张牌, 手牌区必须始终可点。
     */
    private _placeHintPanel(): void {
        const panel = this._hintPanel;
        if (!panel) return;
        const gap = MELD_BTN_H / 2 + HINT_PANEL_GAP;
        const btnTop = this._meldPanelY + gap;       // 按钮行上沿
        const discBottom = -this._discR - 6 - HINT_BREATH;  // 转盘下沿(倒计时在这一带)
        const handTop = this._handTopY + HINT_BREATH;        // 手牌上沿: 提示绝不能压过去
        const btnBottom = this._meldPanelY - gap;

        // 两条通道各自有多少净空, 取宽的那条
        const availAbove = discBottom - btnTop;
        const availBelow = btnBottom - handTop;
        const above = availAbove >= availBelow;
        const avail = above ? availAbove : availBelow;

        panel.fit(avail);
        const h = panel.cardHeight || HINT_PANEL_FALLBACK_H;
        // 兜底: 万一 fit 之后仍越界, 夹回可用区间(宁可贴边也不压住手牌)
        const minY = above ? btnTop : handTop;
        const maxY = above ? discBottom : btnBottom;
        let y = above ? btnTop + h / 2 : btnBottom - h / 2;
        if (above && y + h / 2 > maxY) y = maxY - h / 2;
        if (!above && y - h / 2 < minY) y = minY + h / 2;
        panel.node.setPosition(0, y, 0);
    }

    private _hideHint(): void {
        this._hintedTileIndex = -1;
        this._clearHintMark();
        this._hintPanel?.hide();
    }

    /** 清掉手牌上的提示标记(不涉及面板) */
    private _clearHintMark(): void {
        // isValid 不能省: 节点被 destroy 后 isValid 立即为 false,但引擎要到帧末才把
        // _components 置 null —— 这中间任何一次 getComponent 都会读到 null.length 而崩。
        // 跨局残留的引用(理论上已由 _clearTable 清空)这里再兜一层。
        for (const n of this._handNodes) {
            if (n && n.isValid) n.getComponent(TileView)?.setHinted(false);
        }
    }

    /** 手牌重建后重新贴上提示标记(下标没变则原样恢复) */
    private _reapplyHintMark(): void {
        this._clearHintMark();
        if (this._hintedTileIndex < 0) return;
        const n = this._handNodes[this._hintedTileIndex];
        if (n && n.isValid) n.getComponent(TileView)?.setHinted(true);
    }

    /**
     * 创建四家的"听"标记(默认隐藏, 宣告听牌后亮出)
     *
     * 放在牌桌四角: 自己右下 / 上家左上 / 左家左侧 / 右家右侧,
     * 都不与手牌、牌河、副露行重叠。
     */
    private _buildTenpaiMarkers(): void {
        for (let seat = 0; seat < 4; seat++) {
            const node = createTenpaiChip(SEAT_NAMES[seat]);
            node.parent = this._gameRoot;
            node.active = false;
            this._tenpaiMarkers[seat] = node;
        }
    }

    /** 创建独立结算面板(默认隐藏, 牌局结束时由 onSettle 弹出) */
    private _buildSettlementPanel(): void {
        const node = new Node('Settlement');
        node.parent = this._gameRoot;
        const panel = node.addComponent(SettlementPanel);
        panel.onRestart = () => this._onRestartClick();
        panel.onBack = () => this._onBackToMenuClick();
        this._settlement = panel;
    }

    /**
     * 创建吃/碰/杠选择容器(默认隐藏):
     * 别家打出的牌自己能吃/碰时弹出,内容为 各副露按钮 + "过"(继续摸牌)。
     * 容器本身不画任何底板,直接由按钮浮在牌桌上方。
     */
    private _buildMeldPrompt(): void {
        const panel = new Node('MeldPrompt');
        panel.parent = this._gameRoot;
        // 尺寸在 _showMeldPrompt 里按按钮总宽设置,这里只占位
        panel.addComponent(UITransform).setContentSize(1, MELD_BTN_H);
        panel.setPosition(0, this._meldPanelY, 0);
        panel.active = false;
        this._meldPanel = panel;

        const row = new Node('BtnRow');
        row.parent = panel;
        row.addComponent(UITransform).setContentSize(1, MELD_BTN_H);
        this._meldBtnRow = row;
    }

    /**
     * 底色: 设置 UI 相机的清屏色(深木色,与桌面边框呼应),填充桌面外的区域。
     */
    private _setupBackdrop(): void {
        const canvas = this.node.getComponent(Canvas);
        const camera = canvas?.cameraComponent ?? this.node.getChildByName('Camera')?.getComponent(Camera);
        if (camera) {
            camera.clearColor = new Color(24, 16, 10, 255);
        }
    }

    /**
     * 创建牌桌中央的"罗盘转盘"与指向指针
     *
     * 结构:
     *   TurnDisc(静态盘面)
     *     ├ Graphics  → 盘面本身: 投影 + 金色外圈 + 玉色盘身 + 象牙内盘
     *     ├ Accents   → 四方金标记 + 四角菱形
     *     └ TurnPointer(随回合旋转): 指针本体 + 金色轴帽
     *
     * 盘面保持静止,只有指针旋转指向当前出牌者,读起来像桌上的实体罗盘。
     */
    private _buildTurnPointer(): void {
        // 可重入: 节点已存在时只重画,不重复创建(原生平台首帧后需要重画一次;
        // 屏幕比例变化导致盘面半径改变时也从这里重画)
        const R = this._discR;
        const tip = R * TURN_NEEDLE_TIP_RATIO;
        let disc = this._gameRoot!.getChildByName('TurnDisc');
        const created = !disc;
        if (!disc) {
            disc = new Node('TurnDisc');
            disc.parent = this._gameRoot;
            disc.addComponent(UITransform).setContentSize(R * 2, R * 2);
        }
        disc.getComponent(UITransform)?.setContentSize(R * 2, R * 2);
        drawTurnDisc(disc.getComponent(Graphics) ?? disc.addComponent(Graphics), R);

        // 方位标记: 与盘面一起静止,叠在盘面之上、指针之下
        let accent = disc.getChildByName('Accents');
        if (!accent) {
            accent = new Node('Accents');
            accent.parent = disc;
            accent.addComponent(UITransform).setContentSize(1, 1);
        }
        drawTurnDiscAccents(accent.getComponent(Graphics) ?? accent.addComponent(Graphics), R);

        // 指针层(可单独做呼吸亮度)
        let pointer = disc.getChildByName('TurnPointer');
        if (!pointer) {
            pointer = new Node('TurnPointer');
            pointer.parent = disc;
            pointer.addComponent(UITransform).setContentSize(1, 1);
            pointer.addComponent(UIOpacity).opacity = 255;
        }
        drawTurnNeedle(pointer.getComponent(Graphics) ?? pointer.addComponent(Graphics), R, tip);
        pointer.setPosition(0, 0, 0);

        disc.setPosition(0, 0, 0);
        this._turnPointer = pointer;
        this._turnDisc = disc;
        // 只有首次创建才重置指向: 重画(首帧后补画 / 屏幕比例变化)不能把指针甩回座位1
        if (created) {
            this._pointerAngle = this.POINTER_ANGLES[0];
            this._pointerTargetAngle = this._pointerAngle;
        }
        pointer.angle = this._pointerAngle;
        this._ensureCountdownWidget();
    }

    /**
     * 创建转盘中央的决策倒计时(环形进度 + 中央秒数)
     *
     * 挂在 _gameRoot 之下(与 TurnDisc 同级, 建在 TurnPointer 之后 → 盖住指针):
     * 不透明圆牌压在象牙内盘正中, 数字不受指针与桌面背景干扰。
     * 平时整体隐藏, 只有玩家需要做决定(出牌/副露)时才显示。
     */
    private _ensureCountdownWidget(): void {
        const root = this._gameRoot;
        if (!root) return;
        const R = this._discR;

        // 【为什么还是叠在盘心, 而不是挪到盘外】
        // 盘外一圈全是牌: 上方弃牌河紧贴盘缘(y≈-34~-73), 下方是自己手牌与副露区,
        // 实测挪出去在所有分辨率下都会压到牌河。
        // 象牙内盘半径 0.73R 是转盘上唯一稳定空着的地方, 且倒计时节点
        // 建在 TurnPointer **之后** → z序更高, 圆牌的不透明底会把指针盖住,
        // 数字因此始终清晰。圆牌半径取 0.575R(内盘的 79%), 不会压到金圈。
        let ring = root.getChildByName('CountdownRing');
        if (!ring) {
            ring = new Node('CountdownRing');
            ring.parent = root;
            ring.addComponent(UITransform).setContentSize(1, 1);
            ring.addComponent(UIOpacity).opacity = 255;
        }
        // 新建/重画时一律先置为隐藏, 由 _refreshCountdown 按需点亮。
        // (不能只依赖 _countdownShown 标记: 重画会拿到已存在的节点, 标记是 false)
        ring.active = false;
        this._countdownG = ring.getComponent(Graphics) ?? ring.addComponent(Graphics);
        this._countdownG.clear();

        // 圆牌直径: 锁定为内盘半径的 79%, 与盘半径一起缩放
        const d = R * 0.575 * 2;
        let label = root.getChildByName('CountdownLabel') as Node | null;
        if (!label) {
            label = createLabelNode('', 40, new Color(60, 40, 20, 255), d, d);
            label.name = 'CountdownLabel';
            label.parent = ring;
        }
        this._countdownLabel = label.getComponent(Label) ?? null;
        const lbl = label.getComponent(Label);
        if (lbl) lbl.fontSize = 40;
        const tf = label.getComponent(UITransform);
        if (tf) tf.setContentSize(d, d);
        label.setPosition(0, 0, 0);

        this._countdownShown = false;
        this._hideCountdown();
    }

    /**
     * 逐帧刷新倒计时显示
     *
     * 剩余时间以 GameManager 为准, 这里只负责画, 不持有自己的计时状态,
     * 避免"两套计时器各走各的"导致显示和实际超时对不上。
     */
    private _refreshCountdown(): void {
        const gm = GameManager.instance;
        const g = this._countdownG;
        const lbl = this._countdownLabel;
        if (!g || !lbl) return;

        if (!gm || !gm.deciding) {
            this._hideCountdown();
            return;
        }
        const limit = gm.decideLimit;
        const remain = gm.decideRemain;
        const ratio = limit > 0 ? Math.max(0, Math.min(1, remain / limit)) : 0;
        const secs = Math.ceil(remain);
        const R = this._discR;
        // 计时圆牌: 叠在象牙内盘正中, 直径 = 内盘半径的 79% × 2
        const d = R * 0.575 * 2;
        const rr = d * 0.5;

        // 剩余时间不多时把环和数字染成警示色, 让人一眼看到"快到点了"
        const urgent = remain <= 5;
        const arcColor = urgent ? new Color(206, 74, 58, 255) : new Color(224, 160, 48, 255);
        const textColor = urgent ? new Color(158, 30, 24, 255) : new Color(58, 38, 16, 255);

        g.clear();
        // 1. 落地投影(与转盘同一套浮雕语言, 把圆牌托起来)
        g.fillColor = new Color(0, 0, 0, 80);
        g.circle(d * 0.02, -d * 0.02, rr);
        g.fill();
        // 2. 金色外圈
        g.fillColor = new Color(176, 132, 58, 255);
        g.circle(0, 0, rr);
        g.fill();
        // 3. 象牙底 —— **不透明纯色底是"数字看得清"的根本原因**:
        //    早先把字直接压在指针与桌面毡布上, 无论字号多大都读不清。
        g.fillColor = new Color(248, 243, 231, 255);
        g.circle(0, 0, rr * 0.88);
        g.fill();
        // 4. 底槽: 整圈淡金, 表示"总共 20 秒"
        g.strokeColor = new Color(186, 158, 112, 120);
        g.lineWidth = rr * 0.12;
        g.circle(0, 0, rr * 0.7);
        g.stroke();
        // 5. 剩余量: 从 12 点方向顺时针填充
        if (ratio > 0.001) {
            g.strokeColor = arcColor;
            g.lineWidth = rr * 0.12;
            // Cocos 的 arc 角度用弧度, 起点 -PI/2 即 12 点方向, 逆时针为 false
            g.arc(0, 0, rr * 0.7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
            g.stroke();
        }
        lbl.string = `${secs}`;
        lbl.color = textColor;
        // 圆牌叠在盘心(节点建在 TurnPointer 之后, 天然盖住指针)
        g.node.setPosition(0, 0, 0);

        // 显示/隐藏
        const parent = g.node;
        if (!this._countdownShown) {
            parent.active = true;
            this._countdownShown = true;
        }
    }

    /** 隐藏倒计时(不在决策中时调用) */
    private _hideCountdown(): void {
        if (!this._countdownShown) return;
        this._countdownG?.clear();
        if (this._countdownLabel) this._countdownLabel.string = '';
        const n = this._countdownG?.node;
        if (n) n.active = false;
        this._countdownShown = false;
    }

    /**
     * 设置盘面半径: 尺寸有变化才重画转盘图形
     * (自适应尺寸只在横向比例变化时才会变,平时 resize 不会反复重建 Graphics)
     */
    private _setTurnDiscRadius(r: number): void {
        if (Math.abs(r - this._discR) < 0.5) return;
        this._discR = r;
        this._buildTurnPointer();
    }

    /** 创建剩余牌墙(图形化)节点(可重入) */
    private _buildWallWidget(): void {
        let node = this._gameRoot!.getChildByName('TileWall');
        if (!node) {
            node = new Node('TileWall');
            node.parent = this._gameRoot;
            node.addComponent(UITransform).setContentSize(1, 1);
        }
        this._wallG = node.getComponent(Graphics) ?? node.addComponent(Graphics);
        this._wallNode = node;
    }

    /** 依据当前阶段/座位更新中央转盘指针的指向 */
    private _refreshTurnPointer(): void {
        const gm = GameManager.instance;
        const turnPhase = !!gm && gm.isTurnRunning;
        const seat = turnPhase ? gm!.currentSeat : -1;
        if (seat < 0) return; // 非进行中(发牌/结算)保持上一次指向
        this._pointerTargetAngle = this.POINTER_ANGLES[seat] ?? 0;
    }

    /**
     * 用牌背小图拼出牌墙, 直观表示剩余张数(不再使用文字)
     * @param countOverride 指定要显示的张数(发牌动画用: 让牌墙看起来在一张张被取走);
     *                      不传则用真实的 wallRemaining
     */
    private _refreshWall(countOverride?: number): void {
        const g = this._wallG;
        const node = this._wallNode;
        if (!g || !node) return;
        g.clear();

        const count = countOverride ?? GameManager.instance?.wallRemaining ?? 0;
        if (count <= 0) return;

        const cols = 12;
        const cellW = 8;
        const cellH = 11;
        const rows = Math.ceil(count / cols);
        const w = cols * cellW;
        const h = rows * cellH;
        // 贴可见区右上角
        node.setPosition(this.CONTENT_W / 2 - 28 - w / 2, this._halfH - 16 - h / 2, 0);

        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = -w / 2 + cellW / 2 + col * cellW;
            const y = h / 2 - cellH / 2 - row * cellH;
            drawTileBackIcon(g, x, y, 7, 9);
        }
    }

    private _buildMeldAreas(): void {
        const playerMeld = new Node('Meld_0');
        // 与自家弃牌河一样不压缩: 副露牌要和牌河的牌面完全同尺寸(牌宽相同 + 容器都不缩放)
        playerMeld.parent = this._gameRoot;
        this._meldContainers[0] = playerMeld;

        const offX = [0, 70, -70];  // 上家居中,左家偏右,右家偏左
        for (let i = 0; i < 3; i++) {
            const layout = this.AI_LAYOUT[i];
            const meldCon = new Node(`Meld_${i + 1}`);
            meldCon.setPosition(layout.hx + offX[i], 0, 0);
            // 左/右家副露容器与手牌容器用同一倾斜角,使吃/碰这一行与桌面侧边平行
            meldCon.angle = layout.hH ? 0 : (i === 1 ? 90 - this.SIDE_EDGE_TILT : this.SIDE_EDGE_TILT - 90);
            meldCon.scale = new Vec3(1, layout.scaleY, 1);
            meldCon.parent = this._gameRoot;
            this._meldContainers[i + 1] = meldCon;
        }
    }

    /**
     * 绘制麻将桌: 深胡桃木边框 + 深墨绿毡布台面(带光照渐变)
     *
     * 【为什么不用平涂色块】原先台面是纯色填充,一眼就是"卡通"。
     * 真实桌面的观感来自**光**: 木框上亮下暗、毡布中心受光而四周沉暗。
     * 这里用多层渐变带(每层几十个色阶)模拟这种光照, 介于动画与写实之间,
     * 同时保持纯 Graphics 绘制(不引入贴图, 换分辨率也不会糊)。
     *
     * 木质边框层次(由外到内):
     *  投影 → 深木外边 → 主木框(木纹) → 镶嵌凹槽 → 镶嵌高光
     *  → 内沿亮边 → 内沿沉槽 → 毡布(带径向明暗)
     */
    private _buildTable(): void {
        // 可重入: onLoad 里先建节点,首帧之后由 _drawStaticGraphics 重画一次
        // (原生平台 onLoad 期间绘制的 Graphics 不会上屏,见 _staticGraphicsDrawn 注释)
        let tableNode = this._gameRoot!.getChildByName('Table');
        if (!tableNode) {
            tableNode = new Node('Table');
            tableNode.parent = this._gameRoot;
            const created = tableNode.addComponent(UITransform);
            created.setContentSize(1080, 1080);
            tableNode.addComponent(Graphics);
        }
        const g = tableNode.getComponent(Graphics)!;
        // 重入时必须先清空: 不清的话第二遍路径会叠在第一遍的数据上,
        // 原生平台下这些旧顶点无法被正确替换,牌桌依然不显示。
        g.clear();

        // 3D 透视: 正方形桌面经透视后视觉变扁(近端宽、远端窄)
        // 近端半宽 NEAR_HW=820(物理桌面宽1640),远端半宽按 FAR_RATIO 收缩
        // 高度 HH 也压缩(俯视投影 y 方向变短),整体呈扁梯形,符合低头看桌视角
        const NEAR_HH = 560;          // 近端 y(半高,压缩后)
        const FAR_RATIO = 0.78;       // 远端半宽 / 近端半宽
        const FAR_HH = NEAR_HH - 30;  // 远端 y 略低于近端,使侧边轻微上扬
        const drawTrap = (hwb: number, hh: number, mode: 'fill' | 'stroke') => {
            // hh 表示近端半高;远端半高同比例收缩
            const hwt = hwb * FAR_RATIO;
            const hhn = hh;
            const hhf = hh * (FAR_HH / NEAR_HH);
            g.moveTo(-hwb, -hhn);
            g.lineTo(hwb, -hhn);
            g.lineTo(hwt, hhf);
            g.lineTo(-hwt, hhf);
            g.close();
            if (mode === 'fill') g.fill(); else g.stroke();
        };

        /**
         * 在梯形内画一组横向色带, 由远及近做亮度插值 —— 这是"光照渐变"的实现。
         *
         * 真实桌面的光来自上方, 所以**远端(上)偏亮、近端(下)偏暗**;
         * 每条色带按它所处的纵向位置取亮度, 于是整体形成一道柔和的明暗过渡。
         * 纯色块做不到这个, 这也是原先"一眼卡通"的主因。
         *
         * @param hwb 近端半宽  @param hh 近端半高
         * @param colFar 远端颜色  @param colNear 近端颜色
         * @param bands 色带条数(越多越平滑, 60~80 肉眼已无色阶)
         */
        const drawTrapBands = (
            hwb: number, hh: number,
            colFar: Color, colNear: Color,
            bands = 72,
        ): void => {
            const hwt = hwb * FAR_RATIO;
            const hhn = hh;
            const hhf = hh * (FAR_HH / NEAR_HH);
            const bandH = (hhn + hhf) / bands;
            for (let i = 0; i < bands; i++) {
                // i=0 在最远端, i=bands-1 在最近端
                const t = i / (bands - 1);
                const yTop = hhf - (i + 1) * bandH;
                const yBot = hhf - i * bandH;
                g.fillColor = new Color(
                    Math.round(colFar.r + (colNear.r - colFar.r) * t),
                    Math.round(colFar.g + (colNear.g - colFar.g) * t),
                    Math.round(colFar.b + (colNear.b - colFar.b) * t),
                    255,
                );
                // 每条色带自身也是梯形(按所在位置的半宽), 侧边才不会溢出木框
                const wTop = hwb + (hwt - hwb) * ((yTop + hhn) / (hhn + hhf));
                const wBot = hwb + (hwt - hwb) * ((yBot + hhn) / (hhn + hhf));
                g.moveTo(-wBot, yBot);
                g.lineTo(wBot, yBot);
                g.lineTo(wTop, yTop);
                g.lineTo(-wTop, yTop);
                g.close();
                g.fill();
            }
        };

        // ===== 木质边框(梯形层次,由外到内,每层向内缩进) =====
        // 1. 外层投影(落地阴影)
        g.fillColor = new Color(18, 10, 4, 200);
        drawTrap(824, 560, 'fill');

        // 2. 外框深木边(最外层深棕,勾勒轮廓)
        g.fillColor = new Color(54, 32, 16, 255);
        drawTrap(820, 556, 'fill');

        // 3. 主木框: 改用渐变带, 上亮下暗, 模拟侧光落在胡桃木框上
        //    (原为平涂 124,78,42 —— 这正是"卡通感"的主要来源)
        drawTrapBands(814, 550, new Color(158, 104, 58, 255), new Color(104, 64, 34, 255));

        // 4. 镶嵌凹槽(深色线,仿真实麻将桌木框嵌线)
        g.strokeColor = new Color(52, 30, 14, 255);
        g.lineWidth = 2;
        drawTrap(804, 544, 'stroke');

        // 5. 镶嵌高光(浅色线,凹槽内侧反光)
        g.strokeColor = new Color(186, 132, 78, 255);
        g.lineWidth = 1;
        drawTrap(800, 540, 'stroke');

        // 6. 内沿亮边(浅木色,木框向毡布过渡的提亮)
        g.fillColor = new Color(150, 98, 54, 255);
        drawTrap(794, 534, 'fill');

        // 7. 内沿沉槽阴影(深色,毡布下沉的暗边)
        g.fillColor = new Color(58, 36, 20, 255);
        drawTrap(790, 530, 'fill');

        // ===== 毡布台面 =====
        // 8. 主毡布: 深墨绿渐变(远端受光偏亮 → 近端沉暗), 不再是平涂
        //    色相取 ~135° 正绿(原先 ~148° 偏青), 去蓝提绿后的暗绿护眼色调;
        //    明度/饱和度刻意保持原档位 —— 更暗更饱和会发闷, 亮起来反而刺眼
        drawTrapBands(786, 526, new Color(36, 72, 45, 255), new Color(19, 42, 26, 255));
        g.strokeColor = new Color(12, 28, 22, 255);
        g.lineWidth = 2;
        drawTrap(786, 526, 'stroke');

        // 8b. 四边暗角: 沿毡布内侧再压一圈半透明黑, 模拟绒布被木框挡光后的自然阴影。
        //     平涂色块没有这个, 桌面会显得"贴"在框上而不是"嵌"进去。
        //     线宽取小值(6/3): Cocos 的 lineWidth 是像素单位, 画粗了会变成一圈黑边。
        g.strokeColor = new Color(0, 0, 0, 52);
        g.lineWidth = 14;
        drawTrap(776, 521, 'stroke');
        g.strokeColor = new Color(0, 0, 0, 44);
        g.lineWidth = 6;
        drawTrap(779, 523, 'stroke');

        // 9. 毡布内沿装饰线(极淡的金绿细线, 只勾一圈轮廓, 不再填充浅绿色块)
        //    【原先这里有一块 Color(42,102,66) 的浅绿"中央出牌河"色块, 已按要求去掉】
        //    原因: 平涂浅绿压在深绿上形成一块突兀的色斑, 既像卡通,
        //    又把中央转盘那一圈的地色抬高, 显得桌面"脏"。
        //    改为只用细线勾边, 台面保持整块连续, 视觉上更接近真实绒布。
        g.strokeColor = new Color(132, 158, 124, 40);
        g.lineWidth = 1;
        drawTrap(768, 515, 'stroke');

        // 中央转盘(罗盘样式)由 _buildTurnDisc 单独绘制:
        // 它需要按回合旋转指针,必须是独立节点,故不再并入桌面 Graphics。
    }

    private _buildAISeats(): void {
        for (let i = 0; i < 3; i++) {
            const layout = this.AI_LAYOUT[i];

            // 左/右家: 容器按桌面侧边透视倾斜角旋转(90°-倾斜角),使整列牌与侧边缘平行;
            // 牌身不再反向旋转,与弃牌河/副露保持同一朝向
            const seatAngle = layout.hH ? 0 : (i === 1 ? 90 - this.SIDE_EDGE_TILT : this.SIDE_EDGE_TILT - 90);

            const handCon = new Node(`AIHand_${i}`);
            handCon.angle = seatAngle;
            handCon.scale = new Vec3(1, layout.scaleY, 1);
            handCon.addComponent(UITransform).setContentSize(1, 1);
            handCon.parent = this._gameRoot;
            this._aiHandContainers[i] = handCon;

            const discCon = new Node(`AIDiscard_${i}`);
            discCon.angle = seatAngle;
            discCon.scale = new Vec3(1, layout.scaleY, 1);
            discCon.addComponent(UITransform).setContentSize(1, 1);
            discCon.parent = this._gameRoot;
            this._aiDiscardContainers[i] = discCon;
        }
    }

    // ==================== 事件注册 ====================

    private _registerEvents(): void {
        const gm = GameManager.instance;
        if (!gm) return;
        gm.onHandChanged = () => this._refreshHand();
        gm.onDiscardChanged = () => this._refreshDiscard();
        gm.onPhaseChanged = () => this._refreshInfo();
        gm.onAIHandChanged = (idx) => this._refreshAIHand(idx);
        gm.onAIDiscard = (idx) => this._refreshAIDiscard(idx);
        // 副露播报: 吃/碰/杠统一在这里发声(自家与 AI 都会走到 onMeld)
        gm.onMeld = (seat, meld) => {
            playMeldVoice(meld.type);
            this._refreshMelds(seat, meld);
        };
        gm.onPlayerMeldChoice = (request) => this._showMeldPrompt(request);
        gm.onTenpai = (tiles) => this._showTenpai(tiles);
        gm.onTenpaiChanged = (seat) => this._refreshTenpaiMarkers();
        gm.onNotice = (msg) => this._showToast(msg);
        gm.onHu = (msg) => this._showHuToast(msg);
        gm.onReveal = (winnerSeat, msg) => this._onGameEndReveal(winnerSeat, msg);
        gm.onSettle = (data) => {
            // 胡牌语音已按需求取消, 这里只走结算面板
            this._onSettle(data);
        };
        // AI 提示: 玩家点"提示"才会回调; 局面一变(出牌/选副露)GM 会给 null 让 UI 收起
        gm.onHint = (hint) => {
            if (hint) this._showHint(hint);
            else this._hideHint();
        };
    }

    // ==================== 刷新 UI ====================

    /**
     * 重建自家手牌
     * @param limit 最多显示几张(发牌动画用: 只画已揭示的那几张);不传=全画
     */
    private _refreshHand(limit?: number): void {
        if (!this._handContainer) return;
        // 手牌整体重建,旧节点即将销毁,先清掉选中态避免索引指向已销毁的牌
        this._selectedIndex = -1;
        this._clearChildren(this._handContainer);

        const gm = GameManager.instance;
        const player = gm?.player;
        if (!player) return;

        // 发牌动画期间只显示前 limit 张,且不按"刚摸到的牌"处理(那时还没到玩家回合)
        const dealing = limit !== undefined && this._dealing;
        const fullCount = player.hand.length;
        const count = dealing ? Math.min(limit as number, fullCount) : fullCount;
        const step = this.TILE_W + this.TILE_GAP;
        // 刚摸到的牌挂在手牌末尾(未理牌),单独放到最右侧并做金色标注
        const hasDrawn = !dealing && !!gm?.playerDrawnTile && count > 0;
        const normalCount = hasDrawn ? count - 1 : count;
        const sep = 0; // 摸到的牌与手牌之间不再留额外间隔(仅靠金色标注区分)
        const blockW = normalCount > 0 ? normalCount * step - this.TILE_GAP : 0;
        const totalWidth = blockW + (hasDrawn ? sep + this.TILE_W : 0);
        const startX = -totalWidth / 2 + this.TILE_W / 2;

        // 上一帧的手牌槽位: 同一张牌这一帧换了位置就滑过去,而不是瞬移
        const prevSlots = this._handSlots.get(0);
        const nextSlots = new Map<number, Vec3>();
        // 用"等长空洞"而不是 fill(null): Node[] 里塞 null 会让"元素为空"和
        // "节点已销毁"两种状态混在一起, 排查时很难看出是哪一种
        this._handNodes = new Array<Node>(count);
        for (let i = 0; i < normalCount; i++) {
            const tile = player.hand[i];
            const x = startX + i * step;
            const node = this._createHandTile(tile, i, x, false);
            const prev = prevSlots?.get(tile.id);
            if (prev) glideTo(node, prev);
            nextSlots.set(tile.id, new Vec3(x, 0, 0));
            this._handNodes[i] = node;
        }
        if (hasDrawn) {
            const drawnX = startX + normalCount * step + sep;
            const tile = player.hand[count - 1];
            const node = this._createHandTile(tile, count - 1, drawnX, true);
            // 刚摸到的牌: 上一帧若已在手牌里(续杠补摸等)就从旧位置滑来,否则从手牌右侧滑入
            const prev = prevSlots?.get(tile.id);
            if (prev) glideTo(node, prev);
            else slideIn(node, new Vec3(78, 0, 0));
            nextSlots.set(tile.id, new Vec3(drawnX, 0, 0));
            this._handNodes[count - 1] = node;
        }
        this._storeHandSlots(0, nextSlots);
        // 手牌是整体重建的, 之前贴的提示标记随旧节点一起没了 —— 按记录的下标补回来。
        // 局面没变(玩家只是点开提示看了看)时这一步是无感的;
        // 局面真变了的话 GameManager 已经把提示清空, 这里也一并收起。
        if (this._hintedTileIndex >= 0 && GameManager.instance?.hint) this._reapplyHintMark();
        this._refreshInfo();
    }

    /** 创建一张手牌节点;drawn=是否为刚摸到的牌(加金色标注) */
    private _createHandTile(tile: Tile, index: number, x: number, drawn: boolean): Node {
        // 平面牌面(不再画顶侧厚度),与三家 AI 的牌看起来一样
        const tileNode = createTileNode(this.TILE_W, this.TILE_H, false);
        tileNode.parent = this._handContainer;
        tileNode.setPosition(x, 0, 0);
        setTileBgColor(tileNode, tile.suit, false);
        const view = tileNode.addComponent(TileView);
        view.setData(tile, index);
        view.setHomePos(new Vec3(x, 0, 0));
        view.setOnClick((idx) => this._onTileClick(idx));
        // 拖出手牌区松手 → 直接出牌(返回 true 表示确实打出去了)
        view.setOnDiscard((idx) => this._onTileDropDiscard(idx));
        view.setDrawn(drawn);
        return tileNode;
    }

    /** 记录本帧手牌槽位,并把上一帧的槽位留作下一次出牌/副露动画的起点 */
    private _storeHandSlots(seat: number, next: Map<number, Vec3>): void {
        const prev = this._handSlots.get(seat);
        if (prev) this._prevHandSlots.set(seat, prev);
        this._handSlots.set(seat, next);
    }

    /** 某张牌上一次出现在手牌里的世界坐标(先查本帧,再查上一帧快照) */
    private _handSlotWorld(seat: number, tileId: number): Vec3 | null {
        const local = this._handSlots.get(seat)?.get(tileId) ?? this._prevHandSlots.get(seat)?.get(tileId);
        if (!local) return null;
        const container = seat === 0 ? this._handContainer : this._aiHandContainers[seat - 1];
        return container ? toWorld(container, local) : null;
    }

    private _refreshDiscard(): void {
        if (!this._discardContainer) return;
        this._clearChildren(this._discardContainer);

        const player = GameManager.instance?.player;
        if (!player) return;

        // 自家弃牌河向上堆(朝着桌心方向),每排最多 RIVER_COLS 张,避免与下方副露/手牌重叠
        // 平面牌面(与三家 AI 的弃牌河一致,不再显示顶侧厚度)
        this._renderRiver(this._discardContainer, player.discards, this.RIVER_COLS, 1, true, 0);
        // 拖牌出牌时从松手的位置起飞,点击出牌则从手牌槽位起飞
        const from = this._dropFromWorld;
        this._dropFromWorld = null;
        this._animateRiverDrop(0, this._discardContainer, player.discards, this.TILE_W, from);
    }

    /**
     * 出牌过渡: 弃牌河重建后,若这一帧恰好比上一帧多一张牌,就让这张新牌从它原先在手牌里的位置飞进来
     * (吃/碰/杠会把触发牌从河里收走,张数减少时不做动画;开局清台时张数归零,同样不动画)
     * @param handTileW 该家手牌宽度,用于把"手牌尺寸"缩放到"牌河尺寸"
     * @param fromWorld 指定起点(拖牌出牌时=松手的位置);不传则按牌 id 查手牌槽位
     */
    private _animateRiverDrop(
        seat: number,
        container: Node,
        tiles: Tile[],
        handTileW: number,
        fromWorld?: Vec3 | null,
    ): void {
        const grew = tiles.length === this._riverCount[seat] + 1;
        this._riverCount[seat] = tiles.length;
        if (!grew || tiles.length === 0) return;

        const tile = tiles[tiles.length - 1];
        // 出牌播报: 四家的牌河都是从这里长出来的,统一在这一处播,
        // 播的是这张牌**各自的**人声(如"五万"), 而非统一落牌声 —— 听声辨牌
        playTileVoice(tile);

        const node = container.children[container.children.length - 1];
        if (!node) return;
        flyToSlot(node, container, {
            fromWorld: fromWorld ?? this._handSlotWorld(seat, tile.id),
            startScale: handTileW / this.RIVER_TILE_W,
            startTilt: -12,
        });
    }

    /**
     * 重建某家 AI 的手牌
     * @param limit 最多显示几张(发牌动画用);不传=全画
     */
    private _refreshAIHand(idx: number, limit?: number): void {
        const container = this._aiHandContainers[idx];
        if (!container) return;
        this._clearChildren(container);

        const ai = GameManager.instance?.getAIPlayer(idx);
        if (!ai) return;

        // 发牌动画期间只显示前 limit 张
        const dealing = limit !== undefined && this._dealing;
        const count = dealing ? Math.min(limit as number, ai.hand.length) : ai.hand.length;
        // 牌局结束后亮牌: 三家手牌由牌背改为牌面(位置/尺寸/朝向完全沿用原有排布)
        const reveal = this._revealAll;
        const seat = idx + 1;
        // 上一帧的手牌槽位: 摸牌/出牌后手牌整体重排,靠它让牌背"滑"到新位置
        const prevSlots = this._handSlots.get(seat);
        const nextSlots = new Map<number, Vec3>();

        if (idx === 0) {
            // 上家: 顶部,牌竖向,横向排列,缩小(高度按手牌比例)
            const step = this.TOP_TILE_W + this.TOP_TILE_GAP;
            const h = this._tileH(this.TOP_TILE_W);
            const startX = -((count - 1) * step) / 2;
            for (let i = 0; i < count; i++) {
                const tile = ai.hand[i];
                const node = reveal
                    ? this._createFaceTile(tile, this.TOP_TILE_W, h, container)
                    : createTileBackNode(this.TOP_TILE_W, h);
                node.parent = container;
                const x = startX + i * step;
                node.setPosition(x, 0, 0);
                this._glideAITile(tile, node, prevSlots);
                nextSlots.set(tile.id, new Vec3(x, 0, 0));
            }
        } else {
            // 左/右家: 牌背与弃牌河/副露保持同一朝向(随桌面侧边倾斜横躺),
            // 不再对每张牌反向旋转;容器已按侧边倾角旋转,沿容器横轴排列即沿侧边纵向排列,
            // 间距按牌身宽度计算,避免重叠
            const w = this.SIDE_TILE_W;
            const h = this._tileH(w);
            const step = w + this.SIDE_TILE_GAP;
            const startX = -((count - 1) * step) / 2;
            for (let i = 0; i < count; i++) {
                const tile = ai.hand[i];
                const node = reveal
                    ? this._createFaceTile(tile, w, h, container)
                    : createTileBackNode(w, h);
                node.parent = container;
                const x = startX + i * step;
                node.setPosition(x, 0, 0);
                this._glideAITile(tile, node, prevSlots);
                nextSlots.set(tile.id, new Vec3(x, 0, 0));
            }
        }
        this._storeHandSlots(seat, nextSlots);
        this._refreshInfo();
    }

    /** AI 手牌理牌过渡: 上一帧就在手里的牌从旧位置滑到新位置(牌背平移,读起来是"手牌收拢/张开") */
    private _glideAITile(tile: Tile, node: Node, prevSlots: Map<number, Vec3> | undefined): void {
        const prev = prevSlots?.get(tile.id);
        if (prev) glideTo(node, prev);
    }

    /**
     * 创建一张"亮出来的"AI 手牌(正面,不可点击)
     * 用于牌局结束时亮出三家手牌,只展示不做交互。
     * 注意: 必须先把牌挂到容器(进入场景树)再 addComponent/setData,
     * 否则 TileView 取不到牌面子节点,会被误判为无图片而退化成矢量牌面。
     */
    private _createFaceTile(tile: Tile, w: number, h: number, parent: Node): Node {
        const node = createTileNode(w, h, false);
        node.parent = parent;
        setTileBgColor(node, tile.suit, false);
        const view = node.addComponent(TileView);
        view.setData(tile, -1);
        return node;
    }

    private _refreshAIDiscard(idx: number): void {
        const container = this._aiDiscardContainers[idx];
        if (!container) return;
        this._clearChildren(container);

        const ai = GameManager.instance?.getAIPlayer(idx);
        if (!ai) return;

        if (idx === 0) {
            // 上家: 顶部,每排 RIVER_COLS 张,向下堆(朝着桌心方向),避免与上方手牌/副露重叠
            this._renderRiver(container, ai.discards, this.RIVER_COLS, -1, true, 0);
            this._animateRiverDrop(1, container, ai.discards, this.TOP_TILE_W);
        } else {
            // 左/右家: 容器已旋转 ±90°,牌用横向多行排列(旋转后即沿侧边纵向)
            // 行增长方向必须"朝桌外": 两家容器旋转方向相反(左 +80.4°/右 -80.4°),
            // 但容器局部 +y 在左家指向世界 -x、在右家指向世界 +x,两边都是"朝桌外",
            // 所以两家都取 +1。原来左家取 -1(朝桌心),牌一多(第 3 行起)就会压到本家的弃牌河上。
            const dir = 1;
            this._renderRiver(container, ai.discards, this.SIDE_RIVER_COLS, dir, true, 0);
            this._animateRiverDrop(idx + 1, container, ai.discards, this.SIDE_TILE_W);
        }
    }

    /**
     * 通用弃牌河渲染
     * @param container 容器节点
     * @param tiles 牌列表
     * @param groupCount 横向排列时=每行列数; 竖向排列时=每列行数
     * @param dir 横向排列时=行增长方向(1下/-1上); 竖向排列时=列增长方向(1右/-1左)
     * @param horizontal true=横向排列多行(牌竖向); false=竖向排列多列(牌横躺)
     * @param tileAngle 牌旋转角度(0=竖向, 90/-90=横躺)
     * @param frontView true=自家牌正面视角(可见正面+顶面), false=3/4视角(右/下厚度)
     */
    private _renderRiver(
        container: Node,
        tiles: Tile[],
        groupCount: number,
        dir: number,
        horizontal: boolean,
        tileAngle: number,
        frontView = false,
    ): void {
        const w = this.RIVER_TILE_W;
        const h = this._tileH(w);   // 与手牌同宽高比
        const gap = this.RIVER_GAP;

        if (horizontal) {
            const stepX = w + gap;
            const stepY = h + gap;
            const startX = -groupCount * stepX / 2 + stepX / 2;
            for (let i = 0; i < tiles.length; i++) {
                const tile = tiles[i];
                const col = i % groupCount;
                const row = Math.floor(i / groupCount);
                const tileNode = createTileNode(w, h, frontView);
                tileNode.parent = container;
                tileNode.setPosition(startX + col * stepX, dir * row * stepY, 0);
                if (tileAngle) tileNode.angle = tileAngle;
                setTileBgColor(tileNode, tile.suit, frontView);
                const view = tileNode.addComponent(TileView);
                view.setData(tile, i);
            }
        } else {
            const stepY = w + gap;
            const stepX = h + gap;
            const startY = groupCount * stepY / 2 - stepY / 2;
            for (let i = 0; i < tiles.length; i++) {
                const tile = tiles[i];
                const row = i % groupCount;
                const col = Math.floor(i / groupCount);
                const tileNode = createTileNode(w, h, frontView);
                tileNode.parent = container;
                tileNode.setPosition(dir * col * stepX, startY - row * stepY, 0);
                tileNode.angle = tileAngle;
                setTileBgColor(tileNode, tile.suit, frontView);
                const view = tileNode.addComponent(TileView);
                view.setData(tile, i);
            }
        }
    }

    /** 刷新状态显示: 回合提示用转盘指针,剩余张数用牌墙小图,按钮按时机亮灭 */
    private _refreshInfo(): void {
        this._refreshTurnPointer();
        this._refreshWall();
        this._refreshRiichiButton();
        this._refreshHintButton();
        this._refreshTenpaiMarkers();
    }

    /**
     * "提示"按钮: 只在玩家**真的要做决定**时亮
     *
     * 亮着的判据直接问 GameManager(`canHint`), 不在 UI 里另写一套阶段比较 ——
     * 那类重复判断迟早会漏掉某个新状态(参见 AGENTS.md 里 DISCARDING 的教训)。
     */
    private _refreshHintButton(): void {
        const btn = this._hintBtn;
        if (!btn) return;
        const show = this._sceneState === SceneState.PLAYING
            && !this._dealing
            && !!GameManager.instance?.canHint;
        if (btn.active === show) return;
        btn.active = show;
        // 原生平台: 藏过再亮的 Graphics 会只剩文字, 亮出来时补画一次底框
        if (show) repaintButtons(btn);
        // 玩家已不能决定(出牌了/轮到 AI)时, 收起还开着的提示面板
        if (!show) this._hideHint();
    }

    /** 听牌按钮: 只有"轮到自己 + 听牌 + 没宣告过 + 门清"时才亮出来 */
    private _refreshRiichiButton(): void {
        const btn = this._riichiBtn;
        if (!btn) return;
        const show = !!GameManager.instance?.canRiichi;
        if (btn.active === show) return;
        btn.active = show;
        // 原生平台: 藏过再亮的 Graphics 会只剩文字, 亮出来时补画一次底框
        if (show) repaintButtons(btn);
    }

    /** 四家"听"标记: 谁宣告了听牌就亮谁 */
    private _refreshTenpaiMarkers(): void {
        const gm = GameManager.instance;
        for (let seat = 0; seat < 4; seat++) {
            const node = this._tenpaiMarkers[seat];
            if (!node) continue;
            const on = !!gm && gm.isTenpaiDeclared(seat);
            if (node.active === on) continue;
            node.active = on;
            if (on) repaintButtons(node);
        }
    }

    /** 显示一条临时文字提示(听牌/胡牌/操作提示),到时自动清除 */
    private _showMessage(msg: string, seconds: number): void {
        if (!this._infoLabel) return;
        this._infoLabel.string = msg;
        this.unschedule(this._clearMessage);
        this.scheduleOnce(this._clearMessage, seconds);
    }

    private _clearMessage = (): void => {
        if (this._infoLabel) this._infoLabel.string = '';
    };

    private _showHuToast(msg: string): void {
        this._showMessage(`【${msg}】`, 3);
    }

    /**
     * 牌局结束(任意一家胡牌或流局): 亮出四家手牌
     * - 自己手牌本来就是正面,无需处理
     * - 三家 AI 手牌由牌背改为牌面,重新排版并刷新
     */
    private _onGameEndReveal(winnerSeat: number, message: string): void {
        this._revealAll = true;
        // 正面牌比牌背多出顶侧厚度,需要重排(上家手牌整组下移,避免被屏幕裁掉)
        this._applyLayout(this._halfH);
        for (let i = 0; i < 3; i++) this._refreshAIHand(i);
        const who = winnerSeat >= 0 ? `${SEAT_NAMES[winnerSeat]} 胡牌` : '流局';
        this._showMessage(`【${who}】四家手牌已亮出`, 4);
        // 牌局结束: 确保设置按钮还在(正常对局中它一直亮着)
        this._showSettingsButton();
        console.log(`[结束] ${message} → 亮出四家手牌`);
    }

    /**
     * 牌局结算: 弹出独立结算面板(番型列表 + 四家得失分 + 四家手牌)
     * 牌桌上的四家手牌同时已亮出, 面板里再集中看一遍
     */
    private _onSettle(data: SettlementData): void {
        this._refreshRiichiButton();
        this._settlement?.show(data);
        console.log(`[结算] ${data.title} ${data.subtitle}`, data.winners.map(w => `${w.name} ${w.hu.totalFan}番 ${w.hu.points}分`));
    }

    /**
     * 重建某座位的副露区(吃/碰/杠)
     *
     * 每次从 owner.melds 整体重建,而不是"追加一组":这样续杠把碰补成杠后,第 4 张牌也能显示出来。
     * 传 animate 的那一组会做入场过渡 —— 新副露从触发牌所在的弃牌河"聚拢"过来,续杠则只让补进来的那张弹一下。
     * @param seat 座位 0-3
     * @param animate 需要做入场动画的副露(新生成的/刚续杠的);null=只静态刷新
     */
    private _refreshMelds(seat: number, animate: Meld | null = null): void {
        const container = this._meldContainers[seat];
        if (!container) return;
        this._clearChildren(container);

        const gm = GameManager.instance;
        const owner = seat === 0 ? gm?.player : gm?.getAIPlayer(seat - 1);
        const melds = owner?.melds ?? [];
        if (melds.length === 0) return;

        // 副露牌尺寸 = 弃牌河牌尺寸(自己/上家/左右家都一样),只给宽度,高度按手牌宽高比推导
        const tileW = this.RIVER_TILE_W;
        const gap = this.RIVER_GAP;
        const tileH = this._tileH(tileW);
        const groupGap = 0;
        // 全部用平面牌面(与手牌/弃牌河一致,不再显示顶侧厚度)
        const widthOf = (m: Meld): number => m.tiles.length * (tileW + gap) - gap;

        const groups: Node[] = [];
        for (const meld of melds) {
            const group = new Node(`MeldGroup_${groups.length}`);
            group.parent = container;
            const groupWidth = widthOf(meld);
            const startX = -groupWidth / 2 + tileW / 2;
            // 触发牌(从别家吃/碰/杠来的那张)在组内的位置: 加金边 + 在外面挂来源标记
            const srcIndex = meld.tiles.indexOf(meld.sourceTile);
            for (let i = 0; i < meld.tiles.length; i++) {
                const tile = meld.tiles[i];
                const node = createTileNode(tileW, tileH, false);
                node.parent = group;
                node.setPosition(startX + i * (tileW + gap), 0, 0);
                setTileBgColor(node, tile.suit, false);
                const view = node.addComponent(TileView);
                view.setData(tile, i);
                if (i === srcIndex) addClaimedRing(node, tileW, tileH);
            }
            // 来源标记: 挂在触发牌外侧(朝桌心的一侧),写明是"上/左/右"哪家打出的
            if (srcIndex >= 0) {
                const chip = createMeldSourceChip(meld.fromPlayer);
                chip.parent = group;
                chip.setPosition(
                    startX + srcIndex * (tileW + gap),
                    meldMarkDir(seat) * (tileH / 2 + 11),
                    0,
                );
                // 左右家副露容器是旋转的,小牌子转回来才是正着的
                chip.angle = -container.angle;
            }
            groups.push(group);
        }

        // 各组横排居中
        const widths = melds.map(widthOf);
        const totalWidth = widths.reduce((s, w) => s + w, 0) + (groups.length - 1) * groupGap;
        let cursor = -totalWidth / 2;
        for (let i = 0; i < groups.length; i++) {
            groups[i].setPosition(cursor + widths[i] / 2, 0, 0);
            cursor += widths[i] + groupGap;
        }

        // ---- 入场过渡 ----
        if (!animate) return;
        const index = melds.indexOf(animate);
        const group = index >= 0 ? groups[index] : null;
        if (!group) return;

        if (animate.addedKanCount > 0) {
            // 续杠: 其余三张位置不变(重建后位置一致,看不出变化),只让新补的第 4 张弹进来
            const tiles = group.children;
            if (tiles.length > 0) popIn(tiles[tiles.length - 1]);
            flashBurst(container, group.position.x, group.position.y, widths[index] + 12, tileH + 12);
            return;
        }
        // 吃/碰/明杠: 整组从触发牌在弃牌河里的位置聚拢过来 + 金色闪光
        gatherIn(group, this._meldSourceWorld(seat, animate));
        flashBurst(container, group.position.x, group.position.y, widths[index] + 12, tileH + 12);
    }

    /**
     * 副露入场动画的起点(世界坐标):
     *  - 吃/碰/明杠: 触发牌还在出牌者弃牌河里(副露事件先于弃牌河刷新),取那张牌的位置
     *  - 续杠: 第 4 张来自自己刚摸到的牌,取它上一帧在手牌里的位置
     */
    private _meldSourceWorld(seat: number, meld: Meld): Vec3 | null {
        if (meld.addedKanCount > 0 && meld.tiles.length > 0) {
            const added = this._handSlotWorld(seat, meld.tiles[meld.tiles.length - 1].id);
            if (added) return added;
        }
        const from = meld.fromPlayer;
        const river = from === 0 ? this._discardContainer : (from > 0 ? this._aiDiscardContainers[from - 1] : null);
        if (river && river.children.length > 0) {
            return centerOf(river.children[river.children.length - 1]);
        }
        // 兜底: 从自己手牌区飞过来,总比原地弹出有交代
        const hand = seat === 0 ? this._handContainer : this._aiHandContainers[seat - 1];
        return hand ? centerOf(hand) : null;
    }

    private _showTenpai(waitingTiles: Tile[]): void {
        const text = waitingTiles.map(t => t.displayText).join(' ');
        this._showMessage(`【听牌】可胡: ${text}`, 4);
    }

    // ==================== 交互处理 ====================

    /**
     * 点击手牌(手指按下后原地松开才会走到这里):
     * 第一次点击选中(突出),再次点击同一张即出牌。
     * 拖牌走的是 _onTileDropDiscard,不会触发这里。
     */
    private _onTileClick(index: number): void {
        const gm = GameManager.instance;
        if (!gm) return;
        if (this._sceneState !== SceneState.PLAYING) return;
        // 发牌动画期间: 静默忽略点击。
        // 不弹"还没轮到你出牌" —— 那是在提示玩家"操作无效", 而发牌时本来就不该操作,
        // 弹提示反而像出错了(玩家此时可能正在看发牌动画)。
        if (this._dealing) return;
        // 设置弹窗开着: 一律静默吞掉牌桌输入。
        // 遮罩本身已经拦截触摸, 这里再拦一道是因为"事件会不会穿透到下层节点"
        // 取决于引擎的派发顺序, 不能想当然 —— 万一穿透, 玩家在弹窗上点两下
        // 就会把手牌打出去, 那是最难复现也最难解释的一类 bug。
        if (this._settingsOpen()) return;
        if (gm.phase !== GamePhase.PLAYER_TURN || !gm.canDiscard || gm.awaitingPlayerMeld) {
            this._showToast(gm.awaitingPlayerMeld ? '先选择吃/碰/杠或过' : '还没轮到你出牌');
            return;
        }
        if (this._selectedIndex === index) {
            // 再次点击同一张 → 出牌
            this._setSelection(-1);
            gm.playTile(index);
        } else {
            this._setSelection(index);
        }
    }

    /**
     * 拖牌出牌: 牌被拖离手牌区后松手
     * @returns true 表示已打出(手牌会整体重建,调用方不要再操作那张牌的节点)
     */
    private _onTileDropDiscard(index: number): boolean {
        const gm = GameManager.instance;
        if (!gm) return false;
        if (this._sceneState !== SceneState.PLAYING) return false;
        // 发牌动画期间一律不响应拖拽(与 _onTileClick 同样静默, 不弹提示)
        if (this._dealing) return false;
        // 设置弹窗开着: 同样静默吞掉(理由见 _onTileClick)
        if (this._settingsOpen()) return false;
        if (gm.phase !== GamePhase.PLAYER_TURN || !gm.canDiscard || gm.awaitingPlayerMeld) {
            this._showToast(gm.awaitingPlayerMeld ? '先选择吃/碰/杠或过' : '还没轮到你出牌');
            return false;
        }
        // 弃牌动画从"松手的位置"起飞,这样牌是顺着甩出去的方向落到牌河里的
        const node = this._handNodes[index];
        this._dropFromWorld = (node && node.isValid) ? centerOf(node) : null;
        this._setSelection(-1);
        const ok = gm.playTile(index);
        if (!ok) this._dropFromWorld = null;
        return ok;
    }

    /** 点击牌以外的区域: 取消选牌 */
    private _onBackgroundTouch(): void {
        if (this._sceneState !== SceneState.PLAYING) return;
        if (this._selectedIndex >= 0) this._setSelection(-1);
    }

    private _setSelection(index: number): void {
        // `?.` 只防数组越界,不防"元素是已销毁的节点" —— 故两处都判 isValid
        if (this._selectedIndex >= 0) {
            const prev = this._handNodes[this._selectedIndex];
            if (prev && prev.isValid) prev.getComponent(TileView)?.setSelected(false);
        }
        this._selectedIndex = index;
        if (index >= 0) {
            const n = this._handNodes[index];
            if (n && n.isValid) n.getComponent(TileView)?.setSelected(true);
        }
    }

    private _onRestartClick(): void {
        this._setSelection(-1);
        this._hideMeldPrompt();
        // 上一局可能正处在发牌动画中: 先归零发牌状态。
        // 必须清 **Main 自己**排队的帧 —— GameManager.startGame() 里的
        // unscheduleAllCallbacks() 作用在 GameManager 上, 清不到 Main 的发牌链;
        // 漏清会让上一局残留的 _finishDealing 在新局中途触发, 提前 beginPlay。
        this.unscheduleAllCallbacks();
        this._abortDealing();
        // 新一局: 收回亮出的手牌(三家恢复牌背),按当前规则重新开局
        this._revealAll = false;
        // 设置弹窗若还开着先收起(从弹窗进来时已关, 从结算面板进来时它本来就没开)
        this._closeSettings();
        GameManager.instance?.cancelPendingMeld();
        this._clearTable();
        this._startDealing();
        // 重开后设置按钮仍然可用(重开期间它的显示状态可能被改过)
        this._showSettingsButton();
    }

    /** 点"听牌": 宣告本局已听牌(亮给对手看, 胡牌时加 1 番) */
    private _onRiichiClick(): void {
        const gm = GameManager.instance;
        if (!gm || this._sceneState !== SceneState.PLAYING) return;
        gm.declareTenpai();
        this._refreshRiichiButton();
    }

    /** 左上角"返回主页面": 结束当前对局,回到主菜单 */
    private _onBackToMenuClick(): void {
        this._backToMenu();
    }

    // ==================== 吃/碰/杠选择 ====================

    /**
     * 弹出吃/碰/杠/续杠/吃胡选择:
     * 每个选项一个按钮 + "过",整行居中浮在牌桌上方(无底板框)
     */
    private _showMeldPrompt(request: MeldPromptRequest): void {
        const panel = this._meldPanel;
        const row = this._meldBtnRow;
        if (!panel || !row) return;
        this._setSelection(-1);
        this._clearChildren(row);
        // 换了一批候选 → 之前的提示已经对不上, 先收起来(点"提示"会重新给)
        this._hideHint();

        const items = request.items;
        const isRon = request.kind === 'ron';
        // 按钮文字: 副露项为 "碰 五萬五萬五萬";吃胡为 "胡牌 五萬";末项为"过"
        const labels = items.map(it => `${it.label} ${it.tilesText}`.trim());
        const passLabel = isRon ? '过 (不胡)' : '过 (继续摸牌)';

        // 按文字长度估算按钮宽度(中文按每字约 20px),整行居中
        const widths = labels.map(t => clamp(MELD_BTN_H + t.length * 20, 84, 210));
        widths.push(clamp(MELD_BTN_H + passLabel.length * 20, 96, 210));
        const totalW = widths.reduce((s, w) => s + w, 0) + (widths.length - 1) * MELD_BTN_GAP;

        // 容器尺寸跟随按钮总宽(仅用于居中与命中范围,不绘制底板)
        panel.getComponent(UITransform)?.setContentSize(totalW, MELD_BTN_H);
        row.getComponent(UITransform)?.setContentSize(totalW, MELD_BTN_H);

        let cursor = -totalW / 2;
        for (let i = 0; i <= labels.length; i++) {
            const isPass = i === labels.length;
            const baseColor = isPass ? PASS_BTN_COLOR : (isRon ? RON_BTN_COLOR : MELD_BTN_COLOR);
            const btn = createButtonNode(
                isPass ? passLabel : labels[i],
                widths[i],
                MELD_BTN_H,
                baseColor,
            );
            btn.parent = row;
            btn.setPosition(cursor + widths[i] / 2, 0, 0);
            bindSafeClick(btn, () => this._onMeldChoiceClick(i), this);
            cursor += widths[i] + MELD_BTN_GAP;
        }

        panel.setPosition(0, this._meldPanelY, 0);
        panel.active = true;
        // 副露面板弹出后玩家多半要重新判断, 提示按钮的可点性随之变化 → 刷一次
        this._refreshHintButton();
    }

    private _hideMeldPrompt(): void {
        if (this._meldPanel) this._meldPanel.active = false;
        this._hideHint();
        this._refreshHintButton();
    }

    /** index 指向可选副露项;"过"为最后一项 → 传 -1 */
    private _onMeldChoiceClick(index: number): void {
        if (!this._meldPanel?.active) return;
        this._hideMeldPrompt();
        // "过"给一声反馈, 让玩家知道系统收到的是放弃而不是没点到
        if (index < 0) playPassVoice();
        GameManager.instance?.resolvePlayerMeld(index);
    }

    // ==================== 工具方法 ====================

    private _clearChildren(node: Node): void {
        for (const child of [...node.children]) {
            // 停掉还没播完的过渡动画,避免补间继续操作即将销毁的节点
            stopTweensDeep(child);
            child.destroy();
        }
    }

    private _showToast(msg: string): void {
        this._showMessage(msg, 1.5);
    }
}

/**
 * 绘制中央转盘的盘面(静止层)
 * 层次: 落地投影 → 金色外圈(深/浅两层) → 玉色盘身 → 象牙内盘 → 内盘细金线
 * 参考真实麻将桌中心的骰盘: 外圈金属、内盘象牙,静止不转。
 * @param R 盘面半径(由主脚本按可见高度自适应传入)
 */
function drawTurnDisc(g: Graphics, R: number): void {
    // 各层半径按盘半径取比例,改尺寸时整体一起缩放
    const rShadow = R * 1.03;
    const rRimOut = R;
    const rRimIn = R * 0.97;
    const rBodyOut = R * 0.91;
    const rBodyIn = R * 0.895;
    const rPlate = R * 0.73;
    const rPlateLine = R * 0.7;
    g.clear();

    // 1. 落地投影(向右下偏移: x 正、y 负,让转盘"浮"在毡布上)
    g.fillColor = new Color(0, 0, 0, 70);
    g.circle(R * 0.022, -R * 0.022, rShadow);
    g.fill();

    // 2. 金色外圈: 深金打底 + 浅金压边,形成金属厚度
    g.fillColor = new Color(168, 120, 52, 255);
    g.circle(0, 0, rRimOut);
    g.fill();
    g.fillColor = new Color(230, 192, 110, 255);
    g.circle(0, 0, rRimIn);
    g.fill();

    // 3. 玉色盘身(与桌面同色系,呼应桌面; 色相跟着毡布一起往正绿调, 别出现两种绿)
    g.fillColor = new Color(41, 98, 57, 255);
    g.circle(0, 0, rBodyOut);
    g.fill();
    g.fillColor = new Color(53, 116, 71, 255);
    g.circle(0, 0, rBodyIn);
    g.fill();

    // 4. 象牙内盘 + 内沿细金线
    g.fillColor = new Color(244, 236, 219, 255);
    g.circle(0, 0, rPlate);
    g.fill();
    g.strokeColor = new Color(206, 172, 104, 255);
    g.lineWidth = 1;
    g.circle(0, 0, rPlateLine);
    g.stroke();
}

/**
 * 绘制盘面的方位标记(静止层,叠在盘面之上、指针之下)
 * 四个正向金色三角标(上/右/下/左) + 四个斜向菱形标
 * @param R 盘面半径
 */
function drawTurnDiscAccents(g: Graphics, R: number): void {
    g.clear();

    // 正向三角标: 指向盘缘,点出四个座位方位(尺寸随盘半径缩放)
    const rIn = R * 0.75;
    const rOut = R * 0.9;
    const dartHalf = R * 0.05;
    for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // 旋转矩阵: (x,y) 绕盘心转 a
        g.moveTo(-rOut * sa, rOut * ca);
        g.lineTo(dartHalf * ca - rIn * sa, dartHalf * sa + rIn * ca);
        g.lineTo(-dartHalf * ca - rIn * sa, -dartHalf * sa + rIn * ca);
        g.close();
        g.fillColor = new Color(228, 190, 108, 255);
        g.fill();
    }

    // 斜向菱形标
    const tan = new Color(196, 158, 92, 255);
    const dR = R * 0.82;
    const dLong = R * 0.055;
    const dShort = R * 0.043;
    for (let k = 0; k < 4; k++) {
        const a = (45 + k * 90) * Math.PI / 180;
        const cx = dR * Math.cos(a);
        const cy = dR * Math.sin(a);
        g.moveTo(cx, cy + dLong);
        g.lineTo(cx + dShort, cy);
        g.lineTo(cx, cy - dLong);
        g.lineTo(cx - dShort, cy);
        g.close();
        g.fillColor = tan;
        g.fill();
    }
}

/**
 * 绘制转盘指针(旋转层): 默认朝上,靠节点旋转指向方位
 * 结构: 投影 → 指针本体(墨色 + 金色描边)→ 金色中脊 → 金色轴帽
 * 指针从轴帽内伸出、尖端探出盘缘,读起来像罗盘指针。
 * @param R 盘面半径 @param tip 尖端长度(略大于 R,探出盘缘)
 */
function drawTurnNeedle(g: Graphics, R: number, tip: number): void {
    g.clear();
    const half = R * 0.12;               // 指针最宽处(肩部)半宽
    const tail = R * 0.34;               // 指针内端(被轴帽盖住)
    const shoulder = tail + (tip - tail) * 0.3;
    const off = R * 0.022;               // 投影偏移量

    // 1. 投影(整体向左下偏移,做出浮雕感)
    g.fillColor = new Color(0, 0, 0, 90);
    g.moveTo(-off, tip - off);
    g.lineTo(half * 1.04 - off, shoulder - off);
    g.lineTo(half * 0.52 - off, tail - off);
    g.lineTo(-half * 0.52 - off, tail - off);
    g.lineTo(-half * 1.04 - off, shoulder - off);
    g.close();
    g.fill();

    // 2. 指针本体(墨色,保证在象牙内盘上有足够对比)
    traceNeedle(g, half, tail, tip, shoulder);
    g.fillColor = new Color(44, 38, 34, 255);
    g.fill();
    g.strokeColor = new Color(232, 196, 118, 255);
    g.lineWidth = 1.5;
    g.stroke();

    // 3. 金色中脊(细长高光,强化"针"的指向感)
    traceNeedle(g, half * 0.34, tail + R * 0.06, tip * 0.92, shoulder);
    g.fillColor = new Color(255, 226, 150, 255);
    g.fill();

    // 4. 金色轴帽(盖住指针内端,像一根穿在轴上的针)
    const rCap = R * 0.16;
    g.fillColor = new Color(58, 34, 18, 255);
    g.circle(0, 0, rCap);
    g.fill();
    g.strokeColor = new Color(255, 226, 150, 255);
    g.lineWidth = 2;
    g.circle(0, 0, rCap * 0.82);
    g.stroke();
    g.fillColor = new Color(255, 228, 156, 255);
    g.circle(0, 0, rCap * 0.3);
    g.fill();
}

/**
 * 勾出指针轮廓(两侧对称的五边形: 尖端 → 肩 → 内端)
 * @param halfW 肩部半宽
 * @param innerY 内端 y(负值侧为针尾)
 * @param tipY 尖端 y(正值指向外)
 * @param shoulderY 肩部 y(最宽处)
 */
function traceNeedle(
    g: Graphics,
    halfW: number,
    innerY: number,
    tipY: number,
    shoulderY: number,
): void {
    g.moveTo(0, tipY);
    g.lineTo(halfW, shoulderY);
    g.lineTo(halfW * 0.5, innerY);
    g.lineTo(-halfW * 0.5, innerY);
    g.lineTo(-halfW, shoulderY);
    g.close();
}

/** 绘制牌背小图(剩余牌墙用) */
function drawTileBackIcon(g: Graphics, cx: number, cy: number, w: number, h: number): void {
    const r = Math.min(w, h) * 0.28;
    g.fillColor = new Color(60, 90, 160, 255);
    g.roundRect(cx - w / 2, cy - h / 2, w, h, r);
    g.fill();
    // 顶部高光
    g.fillColor = new Color(130, 158, 214, 255);
    g.roundRect(cx - w / 2 + 1, cy + h / 2 - 3, w - 2, 1.6, 0.8);
    g.fill();
}

/**
 * 副露来源标记挂在哪一侧(容器局部 y 的正负方向)
 * 自己的副露行在牌河下方,朝上(+y)才是朝桌心;三家 AI 的手牌在外侧,朝下(-y)朝桌心。
 */
function meldMarkDir(seat: number): number {
    return seat === 0 ? 1 : -1;
}

/**
 * 给"从别家吃/碰/杠来的那张牌"描一圈金边,标明这一组里哪张是触发牌
 * 光晕比牌身略大,所以不会被牌面盖住
 */
function addClaimedRing(node: Node, w: number, h: number): void {
    const ring = new Node('ClaimedRing');
    ring.parent = node;
    ring.addComponent(UITransform).setContentSize(w, h);
    const g = ring.addComponent(Graphics);
    const r = Math.max(3, Math.min(w, h) * 0.16);
    g.strokeColor = new Color(255, 214, 120, 110);
    g.lineWidth = 5;
    g.roundRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, r + 2);
    g.stroke();
    g.strokeColor = new Color(255, 232, 152, 235);
    g.lineWidth = 2;
    g.roundRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, r + 2);
    g.stroke();
    ring.setSiblingIndex(0);   // 画在牌身之下,只露出外侧那一圈
}

/**
 * "听"标记小牌: 金边深底 + "xx·听"
 * 宣告听牌后挂到该座位附近, 一眼看出谁在等牌
 */
function createTenpaiChip(seatName: string): Node {
    const w = 112;
    const h = 36;
    const node = new Node('TenpaiChip');
    node.addComponent(UITransform).setContentSize(w, h);
    const g = node.addComponent(Graphics);
    g.fillColor = new Color(24, 58, 40, 235);
    g.roundRect(-w / 2, -h / 2, w, h, 8);
    g.fill();
    g.strokeColor = new Color(244, 200, 108, 245);
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, 8);
    g.stroke();

    const label = createLabelNode(`${seatName}·听`, 22, new Color(255, 226, 158, 255), w - 8, h);
    label.parent = node;
    return node;
}

/**
 * 副露来源小牌子: 深底金边 + "上/左/右"一个字
 * 挂在触发牌外侧,一眼能看出这组吃/碰/杠是哪家打出来的牌
 */
function createMeldSourceChip(fromSeat: number): Node {
    const w = 22;
    const h = 17;
    const node = new Node('MeldSource');
    node.addComponent(UITransform).setContentSize(w, h);
    const g = node.addComponent(Graphics);
    g.fillColor = new Color(24, 58, 40, 240);
    g.roundRect(-w / 2, -h / 2, w, h, 5);
    g.fill();
    g.strokeColor = new Color(230, 192, 110, 255);
    g.lineWidth = 1.5;
    g.roundRect(-w / 2, -h / 2, w, h, 5);
    g.stroke();

    const label = createLabelNode(
        MELD_SOURCE_CHARS[fromSeat] ?? '?',
        12,
        new Color(255, 232, 160, 255),
        w,
        h,
    );
    label.parent = node;
    return node;
}
