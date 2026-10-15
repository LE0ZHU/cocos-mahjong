import { _decorator, Component, Node, Color, Label, Graphics, UITransform, Vec3, view, Canvas, Camera, UIOpacity } from 'cc';
import { GameManager, GamePhase, MeldPromptItem, MeldPromptRequest, SEAT_NAMES } from './managers/GameManager';
import { createTileNode, createTileBackNode, createLabelNode, createButtonNode, repaintButtons, setTileBgColor, getFrontBand, applyDesignResolution, BTN_COLOR_GREY, ButtonStyle, bindSafeClick } from './ui/UIFactory';
import { TileView } from './ui/TileView';
import { MenuUI } from './ui/MenuUI';
import { GAME_RULES } from './game/GameRules';
import { preloadTileImages } from './ui/TileImage';
import { preloadSounds, playDiscard, playBgm } from './audio/Sound';
import {
    centerOf, flashBurst, flyToSlot, gatherIn, glideTo, popIn, slideIn, stopTweensDeep, toWorld,
} from './ui/Anim';
import { Tile } from './core/Tile';
import { Meld } from './core/Meld';

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
    // ---- 需要按屏幕比例动态定位的零散节点 ----
    /** 重新开始按钮,固定屏幕左上角 */
    private _restartBtn: Node | null = null;
    /** 返回主页面按钮(牌局结束后出现在重新开始右侧) */
    private _returnBtn: Node | null = null;
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
    /** 对局界面(重新开始按钮)是否已显示 */
    private _restartVisible = false;
    /** 两个左上角按钮的位置(由 _applyLayout 计算) */
    private _restartBtnX = 0;
    private _restartBtnY = 0;
    private _returnBtnX = 0;
    private _returnBtnY = 0;
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
    private _wallNode: Node | null = null;
    private _wallG: Graphics | null = null;
    private _halfH = 0;

    /** 各座位在中央转盘上的指向角度(度): 0=朝上(上家), 180=朝下(自己), 90=朝左(左家), -90=朝右(右家) */
    private readonly POINTER_ANGLES = [180, 0, 90, -90];

    // ---- 牌的统一长宽比例 ----
    // 所有牌(自己手牌 / 上家手牌 / 左右家手牌 / 弃牌河 / 吃碰杠副露)的宽高比都与此一致,
    // 只通过宽度区分远近大小,改比例只需改 TILE_W / TILE_H 两个值。
    /** 玩家(底部)手牌宽度: 全局尺寸基准(最大,最近) */
    private readonly TILE_W = 64;
    /** 玩家(底部)手牌高度 */
    private readonly TILE_H = 87;

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
            this._restartVisible = false;
            this._returnBtn?.setPosition(this._returnBtnX, this._returnBtnY, 0);
            // 对局中随时可以重新开始 / 返回主页面,开局就把两个按钮亮出来
            this._showTableButtons();
            // 浏览器预览下音频要用户手势才能解锁,开局时再确保一次(已在播则无副作用)
            playBgm();
            GameManager.instance?.startGame(GAME_RULES.rules);
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

    /**
     * 对局中/结束后"返回主页面": 停下当前对局,收起牌桌回到主菜单
     */
    private _backToMenu(): void {
        this._setSelection(-1);
        this._hideMeldPrompt();
        // 中途返回要把对局真的停下来: 撤销排队中的 AI 调度 + 清掉等待中的副露选择
        GameManager.instance?.stopGame();
        this._clearTable();
        this._revealAll = false;
        this._restartVisible = false;
        if (this._returnBtn) this._returnBtn.active = false;
        if (this._restartBtn) this._restartBtn.active = false;
        this._showScene(SceneState.HOME);
    }

    /**
     * 亮出左上角两个牌桌按钮(重新开始 / 返回主页面)
     * 整局都显示,想退出或重开随时可点;
     * 原生平台上"藏过再亮"的 Graphics 会只剩文字,所以激活后立刻补画一次底框。
     */
    private _showTableButtons(): void {
        if (this._restartBtn) {
            this._restartBtn.active = true;
            repaintButtons(this._restartBtn);
        }
        if (this._returnBtn) {
            this._returnBtn.active = true;
            repaintButtons(this._returnBtn);
        }
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
    }

    /**
     * 中央转盘指针动画:
     *  - 缓动旋转到当前出牌者方位(走最短路径,避免绕圈)
     *  - 回合进行中指针轻微呼吸,强调"该这边出牌了";牌局结束则压暗
     */
    update(dt: number): void {
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
        const running = !!gm && (gm.phase === GamePhase.PLAYER_TURN || gm.phase === GamePhase.AI_TURN);
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

        if (this._handContainer) this._handContainer.setPosition(0, handY, 0);
        // 左上角按钮: 重新开始 / 返回主页面(牌局结束后才显示返回)
        this._restartBtnX = -this.CONTENT_W / 2 + 24 + 75;
        this._restartBtnY = halfH - 8 - 26;
        this._returnBtnX = this._restartBtnX + 150 / 2 + 12 + 75;
        this._returnBtnY = this._restartBtnY;
        this._restartBtn?.setPosition(this._restartBtnX, this._restartBtnY, 0);
        this._returnBtn?.setPosition(this._returnBtnX, this._returnBtnY, 0);
        if (this._meldContainers[0]) this._meldContainers[0].setPosition(0, meldY, 0);
        if (this._discardContainer) this._discardContainer.setPosition(0, discY, 0);
        if (this._infoLabel) this._infoLabel.node.setPosition(0, infoY, 0);
        // 吃/碰选择面板: 浮在自家弃牌河之上(不遮挡手牌)
        this._meldPanelY = discY + rivH / 2 + 30;
        this._meldPanel?.setPosition(0, this._meldPanelY, 0);

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

        // 左上角按钮: 重新开始 / 返回主页面(对局中整局都显示,随时能重开或直接回主菜单)
        // 使用描边胶囊风格,与主菜单次按钮保持一致的软件主题风格
        const tableBtnColor = new Color(245, 240, 228, 255); // 近白偏暖,深绿牌桌上清晰
        const restartBtn = createButtonNode('重新开始', 150, 52, tableBtnColor, ButtonStyle.PillGhost);
        restartBtn.parent = this._gameRoot;
        bindSafeClick(restartBtn, this._onRestartClick, this);
        this._restartBtn = restartBtn;

        const returnBtn = createButtonNode('返回主页面', 150, 52, tableBtnColor, ButtonStyle.PillGhost);
        returnBtn.parent = this._gameRoot;
        bindSafeClick(returnBtn, this._onBackToMenuClick, this);
        returnBtn.active = false;
        this._returnBtn = returnBtn;

        this._buildAISeats();

        this._buildMeldAreas();

        this._buildMeldPrompt();

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

        push(this._restartBtn);
        push(this._returnBtn);
        push(this._meldPanel);
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
        const turnPhase = !!gm && (gm.phase === GamePhase.PLAYER_TURN || gm.phase === GamePhase.AI_TURN);
        const seat = turnPhase ? gm!.currentSeat : -1;
        if (seat < 0) return; // 非进行中(发牌/结算)保持上一次指向
        this._pointerTargetAngle = this.POINTER_ANGLES[seat] ?? 0;
    }

    /** 用牌背小图拼成牌墙,直观表示剩余张数(不再使用文字) */
    private _refreshWall(): void {
        const g = this._wallG;
        const node = this._wallNode;
        if (!g || !node) return;
        g.clear();

        const count = GameManager.instance?.wallRemaining ?? 0;
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
     * 绘制麻将桌: 复杂木质边框 + 绿色毡布台面 + 中央黑白方向盘
     *
     * 木质边框层次(由外到内):
     *  投影 → 深木外边 → 主木框 → 镶嵌凹槽(深线) → 镶嵌高光(浅线)
     *  → 内沿亮边 → 内沿沉槽阴影 → 绿色毡布 → 毡布内沿装饰线
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

        // ===== 木质边框(梯形层次,由外到内,每层向内缩进) =====
        // 1. 外层投影(落地阴影)
        g.fillColor = new Color(18, 10, 4, 200);
        drawTrap(824, 560, 'fill');

        // 2. 外框深木边(最外层深棕,勾勒轮廓)
        g.fillColor = new Color(54, 32, 16, 255);
        drawTrap(820, 556, 'fill');

        // 3. 主木框(暖棕色,边框主体)
        g.fillColor = new Color(124, 78, 42, 255);
        drawTrap(814, 550, 'fill');

        // 4. 镶嵌凹槽(深色线,仿真实麻将桌木框嵌线)
        g.strokeColor = new Color(58, 34, 16, 255);
        g.lineWidth = 2;
        drawTrap(804, 544, 'stroke');

        // 5. 镶嵌高光(浅色线,凹槽内侧反光)
        g.strokeColor = new Color(170, 114, 64, 255);
        g.lineWidth = 1;
        drawTrap(800, 540, 'stroke');

        // 6. 内沿亮边(浅木色,木框向毡布过渡的提亮)
        g.fillColor = new Color(156, 102, 56, 255);
        drawTrap(794, 534, 'fill');

        // 7. 内沿沉槽阴影(深色,毡布下沉的暗边)
        g.fillColor = new Color(64, 40, 22, 255);
        drawTrap(790, 530, 'fill');

        // ===== 绿色毡布台面 =====
        // 8. 主毡布(深绿,带描边)
        g.fillColor = new Color(28, 78, 50, 255);
        g.strokeColor = new Color(15, 52, 32, 255);
        g.lineWidth = 2;
        drawTrap(786, 526, 'fill');
        drawTrap(786, 526, 'stroke');

        // 9. 毡布内沿装饰线(浅绿,双层视觉)
        g.strokeColor = new Color(60, 130, 80, 120);
        g.lineWidth = 1;
        drawTrap(766, 514, 'stroke');

        // ===== 中央出牌河区域(梯形,与桌面同向透视) =====
        // 10. 中央出牌河(浅绿)
        g.fillColor = new Color(42, 102, 66, 255);
        g.strokeColor = new Color(22, 72, 42, 255);
        g.lineWidth = 1;
        drawTrap(460, 320, 'fill');
        drawTrap(460, 320, 'stroke');

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
        gm.onMeld = (seat, meld) => this._refreshMelds(seat, meld);
        gm.onPlayerMeldChoice = (request) => this._showMeldPrompt(request);
        gm.onTenpai = (tiles) => this._showTenpai(tiles);
        gm.onHu = (msg) => this._showHuToast(msg);
        gm.onReveal = (winnerSeat, msg) => this._onGameEndReveal(winnerSeat, msg);
    }

    // ==================== 刷新 UI ====================

    private _refreshHand(): void {
        if (!this._handContainer) return;
        // 手牌整体重建,旧节点即将销毁,先清掉选中态避免索引指向已销毁的牌
        this._selectedIndex = -1;
        this._clearChildren(this._handContainer);

        const gm = GameManager.instance;
        const player = gm?.player;
        if (!player) return;

        const count = player.hand.length;
        const step = this.TILE_W + this.TILE_GAP;
        // 刚摸到的牌挂在手牌末尾(未理牌),单独放到最右侧并做金色标注
        const hasDrawn = !!gm?.playerDrawnTile && count > 0;
        const normalCount = hasDrawn ? count - 1 : count;
        const sep = 0; // 摸到的牌与手牌之间不再留额外间隔(仅靠金色标注区分)
        const blockW = normalCount > 0 ? normalCount * step - this.TILE_GAP : 0;
        const totalWidth = blockW + (hasDrawn ? sep + this.TILE_W : 0);
        const startX = -totalWidth / 2 + this.TILE_W / 2;

        // 上一帧的手牌槽位: 同一张牌这一帧换了位置就滑过去,而不是瞬移
        const prevSlots = this._handSlots.get(0);
        const nextSlots = new Map<number, Vec3>();
        this._handNodes = new Array(count).fill(null);
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
        // 出牌音效: 四家的牌河都是从这里长出来的,统一在这一处播
        playDiscard();

        const tile = tiles[tiles.length - 1];
        const node = container.children[container.children.length - 1];
        if (!node) return;
        flyToSlot(node, container, {
            fromWorld: fromWorld ?? this._handSlotWorld(seat, tile.id),
            startScale: handTileW / this.RIVER_TILE_W,
            startTilt: -12,
        });
    }

    private _refreshAIHand(idx: number): void {
        const container = this._aiHandContainers[idx];
        if (!container) return;
        this._clearChildren(container);

        const ai = GameManager.instance?.getAIPlayer(idx);
        if (!ai) return;

        const count = ai.hand.length;
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

    /** 刷新状态显示: 回合提示用座位发光(图形),剩余张数用牌墙小图(图形),不再输出文字 */
    private _refreshInfo(): void {
        this._refreshTurnPointer();
        this._refreshWall();
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
        // 牌局结束: 确保两个牌桌按钮都在(正常对局中它们也一直亮着)
        this._restartVisible = true;
        this._showTableButtons();
        console.log(`[结束] ${message} → 亮出四家手牌`);
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
        if (gm.phase !== GamePhase.PLAYER_TURN || !gm.canDiscard || gm.awaitingPlayerMeld) {
            this._showToast(gm.awaitingPlayerMeld ? '先选择吃/碰/杠或过' : '还没轮到你出牌');
            return false;
        }
        // 弃牌动画从"松手的位置"起飞,这样牌是顺着甩出去的方向落到牌河里的
        const node = this._handNodes[index];
        this._dropFromWorld = node ? centerOf(node) : null;
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
        if (this._selectedIndex >= 0) {
            this._handNodes[this._selectedIndex]?.getComponent(TileView)?.setSelected(false);
        }
        this._selectedIndex = index;
        if (index >= 0) {
            this._handNodes[index]?.getComponent(TileView)?.setSelected(true);
        }
    }

    private _onRestartClick(): void {
        this._setSelection(-1);
        this._hideMeldPrompt();
        // 新一局: 收回亮出的手牌(三家恢复牌背),按当前规则重新开局
        this._revealAll = false;
        this._restartVisible = false;
        GameManager.instance?.cancelPendingMeld();
        this._clearTable();
        GameManager.instance?.startGame(GAME_RULES.rules);
        // 重开后两个按钮仍然可用(重开期间它们的显示状态可能被改过)
        this._showTableButtons();
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
    }

    private _hideMeldPrompt(): void {
        if (this._meldPanel) this._meldPanel.active = false;
    }

    /** index 指向可选副露项;"过"为最后一项 → 传 -1 */
    private _onMeldChoiceClick(index: number): void {
        if (!this._meldPanel?.active) return;
        this._hideMeldPrompt();
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

    // 3. 玉色盘身(与桌面同色系,呼应桌面)
    g.fillColor = new Color(38, 96, 64, 255);
    g.circle(0, 0, rBodyOut);
    g.fill();
    g.fillColor = new Color(50, 114, 78, 255);
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
