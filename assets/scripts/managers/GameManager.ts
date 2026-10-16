import { _decorator, Component } from 'cc';
import { Wall } from '../core/Wall';
import { Tile } from '../core/Tile';
import { Meld } from '../core/Meld';
import { MeldCandidate, MeldDetector } from '../core/MeldDetector';
import { Player } from '../game/Player';
import { AIBrain, AIContext } from '../game/AIBrain';
import { Hint, HintAdvisor } from '../game/HintAdvisor';
import { HAND_SIZE, SUIT_CHARS, CN_NUMERALS, TILE_TYPE_COUNT, tileIndexOf } from '../core/TileDefine';
import { GameRules, GAME_RULES, difficultyOfDelay } from '../game/GameRules';
import { HuChecker } from '../core/HuChecker';
import { ThreatInfo } from '../core/AIDefense';
import {
    computeHu, HuResult, SeatResult, SettlementData, WinnerResult,
} from '../core/HuScore';

const { ccclass } = _decorator;

/** 游戏阶段 */
export enum GamePhase {
    IDLE = 0,
    DEALING,
    PLAYER_TURN,   // 玩家回合(可摸牌或出牌)
    AI_TURN,       // AI 回合
    /**
     * 刚打出一张牌, 正在等别家反应(吃/碰/杠/胡)的短暂窗口
     *
     * 这是一个**真实存在的空档**: 牌已打出但流程还没往下走。
     * 必须与 PLAYER_TURN / AI_TURN 区分开, 否则这段空档里玩家还能点手牌,
     * 而 `playTile` 会因为 `_canDiscard` 为 false 而拒绝 —— 表现为"点了没反应"，
     * 玩家会以为卡住了。
     */
    DISCARDING,
    GAME_OVER,
}

/**
 * 打出牌之后, 别家开口吃/碰/杠/胡之前的"反应间隔"(秒)
 *
 * 为什么需要它: 牌名播报约 0.2~0.4s, 而别家响应原本是**同帧**发生的
 * (`_afterDiscard` 直接同步调 `_checkMelds`), 两段声音重叠, 什么都听不清。
 *
 * 为什么不是"让播报变短": 播报长度是素材决定的, 改不了; 能改的是**响的时机**。
 * 这也符合真实麻将的观感 —— 听到"五万"之后, 对家想一下才喊"碰"。
 *
 * 取值 0.45s: 略长于最长的牌名播报(0.40s), 保证前一段一定放完;
 * 又不至于让 AI 显得迟钝。这个值只影响**节奏观感**, 不影响任何判定结果。
 */
const MELD_REACT_DELAY = 0.45;

/** 玩家座位: 0=自己(下), 1=上家(上), 2=左家(左), 3=右家(右); AI 索引 0/1/2 对应座位 1/2/3 */
export const SEAT_NAMES = ['你', '上家', '左家', '右家'];

/**
 * 下家座位表(逆时针,与屏幕座位一一对应):
 * 自己(下) → 右家(右) → 上家(上) → 左家(左) → 自己
 * 即坐在桌边看下去逆时针轮转,而不是跨桌直连。
 */
const NEXT_SEAT = [3, 2, 0, 1];

/** 玩家副露/吃胡选择项(供 UI 生成按钮) */
export interface MeldPromptItem {
    /** 操作名: 吃/碰/杠/胡牌 */
    label: string;
    /** 牌面文字,如 "三四万" */
    tilesText: string;
}

/** 一次选择请求的内容: 普通副露(吃/碰/杠)或吃胡(点炮) */
export interface MeldPromptRequest {
    /** 'meld'=吃/碰/杠; 'ron'=吃胡 */
    kind: 'meld' | 'ron';
    items: MeldPromptItem[];
}

/**
 * 一次胡牌结算的现场(内部用)
 *
 * 一炮多响时同一个入口会有多条: 每家各自收牌、各自算番型,
 * 但分数都由"付分方"(点炮者/被抢杠者)一次付清。
 */
interface HuEntry {
    /** 胡牌者座位 */
    seat: number;
    /** 胡牌时的完整手牌(含和牌张) */
    hand: Tile[];
    /** 副露 */
    melds: Meld[];
    /** 和的那张牌 */
    winTile: Tile;
    /** 是否自摸 */
    isSelfDraw: boolean;
    /** 是否杠后补摸胡 */
    isAfterKan: boolean;
    /** 是否摸到牌墙最后一张 */
    isLastTile: boolean;
    /** 是否抢杠胡 */
    isRobKan: boolean;
}

/**
 * 等待玩家决定"胡 / 过"的一次点炮(含一炮多响)
 *
 * AI 已经确定要胡的座位先记在 aiWinners 里, 玩家只决定自己要不要加入;
 * 玩家点"过"时 AI 依然照胡(一炮多响), 全部放弃才继续走副露/下家摸牌。
 */
interface PendingRon {
    /** 付分方座位(点炮者 / 被抢杠者) */
    payerSeat: number;
    /** 和的那张牌 */
    tile: Tile;
    /** AI 赢家座位 */
    aiWinners: number[];
    /** 是否抢杠 */
    robKan: boolean;
    /** 抢杠场景: 玩家点"过"后要继续执行的补杠动作(座位) */
    resumeKanSeat: number;
}

/**
 * 全局游戏管理器 - 单例 Component
 *
 * 职责:
 *  - 持有牌墙、玩家和 3 个 AI 对手
 *  - 驱动完整牌局流程: 发牌 → 摸/出 → 副露(吃/碰/杠) → 听牌 → 胡牌/流局
 *  - 通过回调通知 UI 层刷新
 *
 * 回合调度(逆时针,按屏幕座位轮转: 自己(下)→右家(右)→上家(上)→左家(左)→自己):
 *  - 玩家进入回合自动摸牌,AI 全自动
 *  - 出牌后检测他家能否吃/碰/杠: 玩家由 UI 弹出选择面板决定(吃/碰/杠或"过"继续摸牌),AI 自动决策
 *  - 副露者接着出牌(链式)
 *  - 任意方胡牌或牌墙摸空(流局) → GAME_OVER
 *
 * 胡牌与结算:
 *  - 优先判吃胡: 同一张牌可以被多家同时胡(一炮多响), 玩家要逐个决定要不要胡
 *  - 补杠时可被抢杠(抢杠胡优先于补杠, 抢杠成功则补杠不成立)
 *  - 每次胡牌都算番型(清一色/对对胡/七对/十三幺/杠上开花/海底捞月/门清/立直/连庄…)并结算分数
 *  - 结算数据通过 onSettle 交给 UI 弹出结算面板(番型列表 + 四家得失分 + 四家手牌)
 *
 * 听牌(立直):
 *  - 手牌变化后自动检测听牌状态; 玩家可以主动点"听牌"按钮亮明(加 1 番),
 *    亮明后本局不能再吃/碰/杠, 且出牌必须保持听牌; AI 听牌后自动亮明
 */
@ccclass('GameManager')
export class GameManager extends Component {
    private static _instance: GameManager | null = null;
    static get instance(): GameManager { return this._instance!; }

    // ---- 游戏状态 ----
    private _wall: Wall | null = null;
    private _player: Player | null = null;        // 座位0
    private _aiPlayers: Player[] = [];            // 座位1/2/3
    private _phase: GamePhase = GamePhase.IDLE;
    private _currentSeat: number = 0;             // 当前轮到谁(0-3)
    private _canDiscard: boolean = false;         // 玩家是否可出牌(摸牌/副露后true)
    private _lastDiscard: Tile | null = null;     // 上一张打出的牌(副露检测用)
    private _playerDrawnTile: Tile | null = null; // 玩家刚摸到的牌(UI 单独标注用,null=无)
    // ---- 玩家吃/碰/杠选择(等待玩家点击面板时挂起) ----
    /** 玩家正在选择是否副露(此时不接受出牌,回合流程暂停) */
    private _awaitingPlayerMeld = false;
    /** 等待玩家决策的副露选项 */
    private _pendingMeldCandidates: MeldCandidate[] = [];
    private _pendingMeldTile: Tile | null = null;
    private _pendingMeldFrom = -1;
    /** 等待玩家决定要不要胡的一次点炮/抢杠 */
    private _pendingRon: PendingRon | null = null;
    // ---- 计分(跨局累计,返回主页面时清零) ----
    /** 各家累计得分 */
    private _scores: number[] = [0, 0, 0, 0];
    /** 各家连庄次数(本局胡牌后 +1, 别人胡牌或未胡则清零) */
    private _streaks: number[] = [0, 0, 0, 0];

    // ---- 决策超时(自动行动) ----
    /** 玩家每次需要做决定时的时限(秒) */
    private static readonly DECIDE_LIMIT = 20;
    /** 本次决策已过的秒数;<=0 表示当前没有在计时 */
    private _decideElapsed = 0;
    /** 这次计时对应的是"出牌"还是"副露选择"(影响超时动作) */
    private _decideKind: 'discard' | 'meld' | 'none' = 'none';
    /** 已因超时自动行动过(防止同一决策被重复处理) */
    private _decideTimedOut = false;
    /**
     * 决策倒计时被暂停(打开设置弹窗时冻结)
     *
     * 为什么要暂停而不是"让它继续走": 玩家在设置里调音量时看不到牌桌,
     * 却会被 20 秒判超时自动打牌 —— 那是系统替玩家做的、玩家并不知情的决定。
     * 冻结只影响**玩家决策**的计时, AI 的调度不受影响(见 pauseDecideTimer 注释)。
     */
    private _decidePaused = false;
    // ---- AI 提示 ----
    /** 玩家最近一次请求的提示(局面变化时清空, 避免显示过期的建议) */
    private _hint: Hint | null = null;

    // ---- 常量 ----
    private readonly AI_COUNT = 3;
    /** 本局生效的规则(由 startGame 传入,默认取全局设置) */
    private _rules: GameRules = { ...GAME_RULES.rules };

    // ---- 事件回调 (UI 层注册) ----
    onHandChanged: (() => void) | null = null;
    onDiscardChanged: (() => void) | null = null;
    onPhaseChanged: ((phase: GamePhase) => void) | null = null;
    onHu: ((message: string) => void) | null = null;
    /**
     * 牌局结束(胡牌或流局): UI 需要亮出四家手牌
     * @param winnerSeat 胡牌者座位(0-3);流局为 -1
     * @param message 结束提示文字
     */
    onReveal: ((winnerSeat: number, message: string) => void) | null = null;
    onAIHandChanged: ((aiIndex: number) => void) | null = null;
    onAIDiscard: ((aiIndex: number, tile: Tile) => void) | null = null;
    /** 副露发生: seat=座位(0-3), meld=副露 */
    onMeld: ((seat: number, meld: Meld) => void) | null = null;
    /** 玩家可吃/碰/杠/吃胡: 需要 UI 弹出选择面板,玩家决策后调用 resolvePlayerMeld */
    onPlayerMeldChoice: ((request: MeldPromptRequest) => void) | null = null;
    /** 听牌提示(玩家): waitingTiles=听牌张 */
    onTenpai: ((waitingTiles: Tile[]) => void) | null = null;
    /** 听牌状态变化: seat=座位, tenpai=当前是否听牌(UI 据此显示"听"标记) */
    onTenpaiChanged: ((seat: number, tenpai: boolean) => void) | null = null;
    /** 需要给玩家一句临时提示(如"已宣告听牌,不能这样出") */
    onNotice: ((message: string) => void) | null = null;
    /**
     * 牌局结算数据(有人胡牌或流局都会给): UI 用它弹出独立结算面板
     */
    onSettle: ((data: SettlementData) => void) | null = null;
    /**
     * 提示内容已变化(玩家点了"提示"): UI 据此刷新提示面板
     *
     * 用回调而不是让 UI 主动轮询, 是为了与本文件其余事件保持同一套风格;
     * 触发点只有"玩家主动点提示", 所以不会有高频调用。
     */
    onHint: ((hint: Hint | null) => void) | null = null;

    onLoad(): void {
        if (GameManager._instance && GameManager._instance !== this) {
            this.destroy();
            return;
        }
        GameManager._instance = this;
    }

    onDestroy(): void {
        if (GameManager._instance === this) GameManager._instance = null;
    }

    // ==================== 游戏流程 ====================

    /**
 * 开始新游戏: 新建牌墙 → 4 家各发起手牌 → **停在 DEALING 等 UI**
     *
     * 【为什么发牌与"进入玩家回合"要分成两步】
     * 发牌是**同步**完成的(13 轮 × 4 张一次算完), 这是规则事实, 不该被动画节奏拖慢;
     * 而"发牌动画"要分十几帧播放, 是纯表现层的事。
     * 如果在 startGame 里一口气发完再直接进玩家回合, 玩家会看到 14 张牌瞬间出现;
     * 如果把发牌拆成 13 次异步, 规则层就被补间污染了(也没法脱离引擎单测)。
     *
     * 所以拆成: `startGame()` 同步发完 → UI 播动画 → `beginPlay()` 才真正开局。
     * 期间阶段一直是 DEALING, 于是:
     *  - 玩家点不到手牌(`playTile` 要求 PLAYER_TURN)
     *  - 不会起 20 秒倒计时(`_startDecisionTimer` 只在 `_playerDraw` 里调)
     *  - AI 不会行动(`_startDrawTurn` 只在 beginPlay 之后被调用)
     *
     * @param rules 本局规则;不传则沿用当前规则
     * @param onDealt 牌已全部发完(但还没进玩家回合)时回调一次, UI 在此定稿刷新手牌
     */
    startGame(rules: GameRules = GAME_RULES.rules, onDealt?: () => void): void {
        this._rules = { ...rules };
        this.unscheduleAllCallbacks();
        this._wall = new Wall();
        this._player = new Player();
        this._aiPlayers = [];
        for (let i = 0; i < this.AI_COUNT; i++) this._aiPlayers.push(new Player());
        this._phase = GamePhase.DEALING;
        this._currentSeat = 0;
        this._canDiscard = false;
        this._lastDiscard = null;
        this._playerDrawnTile = null;
        // 上一局若停在"等待副露选择",一并清掉,避免新局被卡住
        this.cancelPendingMeld();
        this._firePhaseChanged();

        // 4 家各发 13 张(起手牌数固定)
        for (let i = 0; i < HAND_SIZE; i++) {
            const t0 = this._wall.draw();
            if (t0) this._player.addTile(t0);
            for (let a = 0; a < this.AI_COUNT; a++) {
                const ta = this._wall.draw();
                if (ta) this._aiPlayers[a].addTile(ta);
            }
        }
        this._player.sortHand();
        for (const ai of this._aiPlayers) ai.sortHand();

        // 牌发完了, 但**先不进玩家回合**: 等 UI 发牌动画播完再调 beginPlay()
        onDealt?.();
    }

    /**
     * 发牌动画播完, 正式开始玩家回合(自动摸牌 + 起 20 秒倒计时)
     *
     * 幂等: 只有 DEALING 阶段才继续, 重复调用或已开局时直接返回。
     */
    beginPlay(): void {
        if (this._phase !== GamePhase.DEALING) return;
        this._phase = GamePhase.PLAYER_TURN;
        this._canDiscard = false;
        this._firePhaseChanged();
        this._playerDraw();
    }

    /**
     * 中途停止当前对局(对局中"返回主页面"时调用)
     *
     * 撤销所有排队中的 AI 调度,清掉等待中的副露选择,并把阶段置为结束态:
     * 万一还有回调已经被触发,它们开头的 `phase === GAME_OVER` 判断会直接返回。
     * 下一局由 startGame 重新初始化,状态不会被这里影响。
     */
    stopGame(): void {
        this.unscheduleAllCallbacks();
        this.cancelPendingMeld();
        this._canDiscard = false;
        this._phase = GamePhase.GAME_OVER;
        // 返回主页面 = 一个会话结束, 累计分与连庄一起清零
        this._scores = [0, 0, 0, 0];
        this._streaks = [0, 0, 0, 0];
    }

    /**
     * 玩家自动摸牌(进入玩家回合时自动执行,无需手动点按钮)
     * 摸到的牌追加在手牌末尾且暂不理牌,由 UI 单独标注在右侧
     */
    private _playerDraw(): Tile | null {
        if (!this._wall || !this._player) return null;
        if (this._wall.remaining <= 0) {
            this._endByDraw();
            return null;
        }
        const tile = this._wall.draw();
        if (!tile) return null;
        // 摸走的是牌墙最后一张 → 摸牌自摸即"海底捞月"
        const isLastTile = this._wall.remaining === 0;

        this._player.addDrawnTile(tile);
        this._playerDrawnTile = tile;
        this._canDiscard = true;
        this._fireHandChanged();
        // 胡牌优先于续杠(杠上开花比补杠更值钱)
        if (HuChecker.isHu(this._player.hand, this._player.melds)) {
            this._settleSelfDraw(0, tile, false, isLastTile);
            return tile;
        }
        // 摸到与已碰牌相同的牌 → 可续杠(已宣告听牌则不能再动副露)
        if (!this._player.declaredTenpai) this._checkPlayerAddKan();
        // 摸牌后检测听牌(刚摸的那张不算进听牌判定)
        this._refreshTenpaiFlag(0, tile, true);
        // 走到这里说明没有自摸、也没进续杠面板 → 该玩家要自己决定出哪张牌了
        // (若 _checkPlayerAddKan 弹了面板, 它已经把计时切成了 'meld', 这里必须跳过)
        if (!this._awaitingPlayerMeld) this._startDecisionTimer('discard');
        return tile;
    }

    /**
     * 自摸结算: 清掉"刚摸到"的状态, 走统一胡牌结算
     * @param seat 胡牌座位
     * @param tile 刚摸到的那张(胡的就是它)
     * @param isAfterKan 是否杠后补摸(杠上开花)
     * @param isLastTile 是否牌墙最后一张(海底捞月)
     */
    private _settleSelfDraw(seat: number, tile: Tile, isAfterKan: boolean, isLastTile: boolean): void {
        const player = this._getPlayer(seat);
        if (!player) return;
        if (seat === 0) {
            this._playerDrawnTile = null;
            this._canDiscard = false;
        }
        this._finishWithHu([{
            seat,
            hand: [...player.hand],
            melds: [...player.melds],
            winTile: tile,
            isSelfDraw: true,
            isAfterKan,
            isLastTile,
            isRobKan: false,
        }], -1);
    }

    // ==================== 续杠(碰 → 杠) ====================

    /**
     * 找出手里刚摸到的牌能续杠的副露(碰过的牌后来又摸到)
     * 规则 allowAddKan 关闭时永远返回 null。
     */
    private _findAddKanMeld(player: Player, tile: Tile): Meld | null {
        if (!this._rules.allowAddKan) return null;
        return player.melds.find(m => m.type === 'pon' && m.handTilesRef().some(t => t.sameType(tile))) ?? null;
    }

    /**
     * 玩家摸牌后检查续杠: 弹出 [续杠] + [过] 选择
     * @returns true 表示已弹出选择,调用方应暂停
     */
    private _checkPlayerAddKan(): boolean {
        const player = this._player;
        const tile = this._playerDrawnTile;
        if (!player || !tile) return false;
        const meld = this._findAddKanMeld(player, tile);
        if (!meld) return false;

        // 复用选择面板: [杠] + [过]
        this._pendingMeldCandidates = [{ type: 'kan', handTiles: [tile] }];
        this._pendingMeldTile = tile;
        this._pendingMeldFrom = -1;
        this._awaitingPlayerMeld = true;
        this._startDecisionTimer('meld');
        this.onPlayerMeldChoice?.({
            kind: 'meld',
            items: [{ label: '续杠', tilesText: `${tile.displayText}(手中摸到)` }],
        });
        return true;
    }

    /**
     * 执行补杠: 把摸到的第4张补进已碰的面子 → 从牌墙补摸一张 → 继续出牌
     *
     * 补杠前先给别家一次"抢杠胡"的机会(抢杠优先于补杠)。
     * @param tile 手里用来续杠的牌
     * @param skipRobCheck true=玩家刚在抢杠面板点了"过",继续补杠,不再重复检测抢杠
     */
    private _upgradeToKan(seat: number, tile: Tile, skipRobCheck = false): void {
        const player = this._getPlayer(seat);
        if (!player) return;
        // 抢杠: 别家可以抢这张牌胡,抢成功则补杠不成立
        if (!skipRobCheck && this._rules.allowRobKan && this._tryRobKan(seat, tile)) return;

        const meld = this._findAddKanMeld(player, tile);
        if (!meld || !meld.upgradeToKan(tile)) return;

        player.removeTileRef(tile);
        if (seat === 0) {
            this._playerDrawnTile = null;
            this._canDiscard = false;
        }
        player.sortHand();
        // 通知 UI 重建副露区(碰 → 杠多了第 4 张,必须重画;UI 会顺手做"补牌弹入"过渡)
        this._fireMeld(seat, meld);
        console.log(`[续杠] ${SEAT_NAMES[seat]} ${meld.toString()}`);

        // 补摸一张(简化: 直接从牌墙摸,非岭上牌);补摸后继续该玩家出牌
        const replacement = this._drawReplacement(seat);
        if (!replacement) return; // 牌墙空已结算流局
        // 补摸的这张就是杠上开花的机会
        const isLastTile = !!this._wall && this._wall.remaining === 0;
        if (HuChecker.isHu(player.hand, player.melds)) {
            this._settleSelfDraw(seat, replacement, true, isLastTile);
            return;
        }
        this._refreshTenpaiFlag(seat, seat === 0 ? replacement : null);
        this._continueAfterKanDraw(seat);
    }

    /** 杠后补摸完成(未胡): 轮到该家出牌 */
    private _continueAfterKanDraw(seat: number): void {
        this._currentSeat = seat;
        if (seat === 0) {
            // 玩家杠后: 等玩家手动出牌
            this._phase = GamePhase.PLAYER_TURN;
            this._canDiscard = true;
            this._firePhaseChanged();
            // 杠后补摸的那张已挂在 _playerDrawnTile 上, 超时自动打的也正是它
            this._startDecisionTimer('discard');
        } else {
            // AI 杠后: 延时自动出牌
            this._phase = GamePhase.AI_TURN;
            this._firePhaseChanged();
            this.scheduleOnce(() => this._aiDiscard(seat), this._rules.aiDelay);
        }
    }

    /**
     * 补摸一张牌(杠之后)
     * @returns 摸到的牌;牌墙已空时结算流局并返回 null
     */
    private _drawReplacement(seat: number): Tile | null {
        if (!this._wall || this._wall.remaining <= 0) {
            this._endByDraw();
            return null;
        }
        const drawn = this._wall.draw();
        if (!drawn) {
            this._endByDraw();
            return null;
        }
        const player = this._getPlayer(seat);
        if (!player) return null;
        if (seat === 0) {
            player.addDrawnTile(drawn);
            this._playerDrawnTile = drawn;
            this._fireHandChanged();
        } else {
            player.addTile(drawn);
            this._fireAIHandChanged(seat - 1);
        }
        return drawn;
    }


    /** 玩家出牌(再次点击已选中的手牌触发) */
    playTile(index: number): boolean {
        if (!this._player) return false;
        if (this._phase !== GamePhase.PLAYER_TURN) return false;
        if (!this._canDiscard) return false;
        // 正在等玩家决定是否吃/碰/杠,不处理出牌
        if (this._awaitingPlayerMeld) return false;
        const tile = this._player.hand[index];
        if (!tile) return false;
        // 立直锁: 宣告听牌后只能打"打完仍然听牌"的牌
        if (this._player.declaredTenpai && !this._keepsTenpaiAfterDiscard(index)) {
            this.onNotice?.('已宣告听牌,只能打出保持听牌的牌');
            return false;
        }
        const discarded = this._player.removeTile(index);
        if (!discarded) return false;
        // 玩家已做出选择 → 停止倒计时(必须在移牌前, 避免与超时分支抢跑)
        this._clearDecisionTimer();
        this._player.discards.push(discarded);
        this._playerDrawnTile = null;
        this._player.sortHand(); // 出牌后把摸到的牌并入理牌
        this._canDiscard = false;
        this._fireHandChanged();
        this._fireDiscardChanged();
        // 打完重新检测听牌(立直状态下仍然听牌, 状态不变)
        this._refreshTenpaiFlag(0);
        this._afterDiscard(0, discarded);
        return true;
    }

    /** 打出第 index 张后是否仍听牌(立直锁判定用) */
    private _keepsTenpaiAfterDiscard(index: number): boolean {
        const p = this._player;
        if (!p) return false;
        const rest = p.hand.filter((_, i) => i !== index);
        return HuChecker.isTenpai(rest, p.melds).length > 0;
    }

    // ==================== 出牌后流程: 副露检测 / 下家摸牌 ====================

    /**
     * 出牌后统一处理: 检测吃胡(一炮多响) → 检测副露 → 下家摸牌
     *
     * **这里必须异步**(见 `MELD_REACT_DELAY`): 出牌播报刚响起时, 别家就同帧喊"碰"，
     * 两段声音会叠在一起谁都听不清。加一个可感知的反应间隔后,
     * 牌名播完 → 停顿一下 → "碰"，才像真人对局。
     *
     * 流程在此暂停时由 resolvePlayerMeld 决定后再从这里继续往下家走。
     *
     * 胡牌判定排在流局判定之前: 牌墙摸空时打出的最后一张仍然可以被胡(点炮)。
     * @param discarder 出牌者座位(0-3)
     * @param tile 打出的牌
     */
    private _afterDiscard(discarder: number, tile: Tile): void {
        this._lastDiscard = tile;
        this._phase = GamePhase.DISCARDING;
        this._firePhaseChanged();
        this.scheduleOnce(() => this._resolveAfterDiscard(discarder, tile), MELD_REACT_DELAY);
    }

    /**
     * 出牌后的实际处理(延迟 MELD_REACT_DELAY 之后才跑)
     *
     * 与 `_afterDiscard` 分开是为了让"反应间隔"只加在**牌名播报之后**这一处,
     * 而 AI 摸牌→出牌之间的节奏仍由 `AI_DELAY` 控制, 两者互不干扰。
     */
    private _resolveAfterDiscard(discarder: number, tile: Tile): void {
        if (this._phase === GamePhase.GAME_OVER) return;
        // 1) 吃胡(点炮)优先于吃/碰/杠, 且允许多家同时胡(一炮多响)
        if (this._beginRon(discarder, tile, false, -1)) return;
        // 2) 流局: 牌墙空且无人胡
        if (!this._wall || this._wall.remaining <= 0) {
            this._endByDraw();
            return;
        }
        // 3) 检测其他3家能否对该牌副露(按轮转顺序: 下家优先)
        const meldResult = this._checkMelds(discarder, tile);
        if (meldResult) {
            this._doMeld(meldResult.seat, meldResult.candidate, tile, discarder);
            return;
        }
        // 玩家正在纠结吃/碰/杠: 回合挂起,等 resolvePlayerMeld 决定后再继续
        if (this._awaitingPlayerMeld) return;
        this._continueToNextSeat(discarder);
    }

    /**
     * 本轮无人胡之后继续推进: 下家(逆时针下一位)摸牌
     * 玩家若因"过"而保留着刚摸到的牌(14 张待出),不能重复摸牌,直接回到他的回合。
     */
    private _continueToNextSeat(discarder: number): void {
        const nextSeat = NEXT_SEAT[discarder];
        if (nextSeat === 0 && this._canResumePlayerTurn()) {
            this._phase = GamePhase.PLAYER_TURN;
            this._firePhaseChanged();
            // 回到自己的回合: 手里那张还没打, 继续给 20 秒
            this._startDecisionTimer('discard');
            return;
        }
        this._startDrawTurn(nextSeat);
    }

    /** 玩家是否处于"已经摸过牌、仍待出牌"的状态(此时不能再摸一张) */
    private _canResumePlayerTurn(): boolean {
        return !!this._player && this._playerDrawnTile !== null && this._canDiscard;
    }

    // ==================== 吃胡(点炮) / 抢杠胡 / 一炮多响 ====================

    /**
     * 收集除 fromSeat 之外所有能用 tile 胡牌的座位
     * @returns 座位列表(按逆时针轮转顺序);空表示无人胡
     */
    private _collectRonSeats(fromSeat: number, tile: Tile): number[] {
        if (!this._rules.allowChiHu) return [];
        const seats: number[] = [];
        let seat = fromSeat;
        for (let i = 0; i < 3; i++) {
            seat = NEXT_SEAT[seat];
            const player = this._getPlayer(seat);
            if (!player) continue;
            if (HuChecker.isHu([...player.hand, tile], player.melds)) seats.push(seat);
        }
        return seats;
    }

    /**
     * 开始一次吃胡判定: 玩家要决定要不要胡, AI 直接胡(一炮多响)
     *
     * @param payerSeat 付分方(点炮者 / 被抢杠者)
     * @param tile 和的那张牌
     * @param robKan 是否抢杠(抢杠时玩家点"过"要继续补杠,而不是往下走)
     * @param resumeKanSeat 抢杠场景下, 玩家放弃后要继续补杠的座位(普通点炮传 -1)
     * @returns true 表示已弹出选择或已结算,调用方应暂停后续流程
     */
    private _beginRon(payerSeat: number, tile: Tile, robKan: boolean, resumeKanSeat: number): boolean {
        const huSeats = this._collectRonSeats(payerSeat, tile);
        if (huSeats.length === 0) return false;
        // 关闭一炮多响时只让轮转里最近的一家胡(下家优先)
        const winners = this._rules.allowMultiRon ? huSeats : [huSeats[0]];
        const aiWinners = winners.filter(s => s !== 0);

        // 玩家能胡: 弹 [胡牌] + [过], 玩家决定期间 AI 的胡先记账
        if (winners.indexOf(0) >= 0) {
            this._pendingRon = { payerSeat, tile, aiWinners, robKan, resumeKanSeat };
            this._pendingMeldCandidates = [{ type: 'ron', handTiles: [] }];
            this._pendingMeldTile = tile;
            this._pendingMeldFrom = payerSeat;
            this._awaitingPlayerMeld = true;
            this._startDecisionTimer('meld');
            this.onPlayerMeldChoice?.({
                kind: 'ron',
                items: [{
                    label: '胡牌',
                    tilesText: aiWinners.length > 0
                        ? `${tile.displayText} · 一炮多响`
                        : tile.displayText,
                }],
            });
            return true;
        }

        // 玩家不在其中(或自己打出的牌): AI 直接胡
        this._settleRon(payerSeat, tile, aiWinners, robKan);
        return true;
    }

    /**
     * 抢杠胡: 别人补杠时可以抢这张牌胡, 抢杠优先于补杠
     * @param kanSeat 正在补杠的座位(同时也是付分方)
     * @returns true 表示抢杠流程已启动(玩家要决定, 或已直接结算)
     */
    private _tryRobKan(kanSeat: number, tile: Tile): boolean {
        // 该牌本来就在补杠者手里, 不需要走"从弃牌河取牌"
        const huSeats = this._collectRonSeats(kanSeat, tile);
        if (huSeats.length === 0) return false;
        console.log(`[抢杠] ${SEAT_NAMES[kanSeat]} 补杠 ${tile.displayText}, ${huSeats.map(s => SEAT_NAMES[s]).join('、')} 可抢`);
        return this._beginRon(kanSeat, tile, true, kanSeat);
    }

    /**
     * 吃胡结算: 每家赢家把和的牌收进手牌, 统一算番型并结算分数
     * @param payerSeat 付分方座位(点炮者 / 被抢杠者)
     * @param tile 和的那张牌
     * @param winnerSeats 赢家座位列表(一炮多响时多家)
     * @param robKan 是否抢杠胡
     */
    private _settleRon(payerSeat: number, tile: Tile, winnerSeats: number[], robKan: boolean): void {
        if (this._phase === GamePhase.GAME_OVER) return;
        // 点炮: 这张牌从出牌者弃牌河移走; 抢杠: 本来就在补杠者手里, 从手牌移走
        if (robKan) {
            this._getPlayer(payerSeat)?.removeTileRef(tile);
        } else {
            const fromPlayer = this._getPlayer(payerSeat);
            if (fromPlayer && fromPlayer.discards.length > 0) {
                const last = fromPlayer.discards[fromPlayer.discards.length - 1];
                if (last === tile) fromPlayer.discards.pop();
            }
        }

        const entries: HuEntry[] = [];
        for (const seat of winnerSeats) {
            const player = this._getPlayer(seat);
            if (!player) continue;
            // 每家都把这张牌收进手牌: 便于各家独立算番型, 结算面板四家手牌也能对齐显示
            player.addTile(tile);
            if (seat === 0) {
                this._playerDrawnTile = null;
                this._canDiscard = false;
                this._fireHandChanged();
            } else {
                this._fireAIHandChanged(seat - 1);
            }
            entries.push({
                seat,
                hand: [...player.hand],
                melds: [...player.melds],
                winTile: tile,
                isSelfDraw: false,
                isAfterKan: false,
                isLastTile: false,
                isRobKan: robKan,
            });
            console.log(`[${robKan ? '抢杠胡' : '吃胡'}] ${SEAT_NAMES[seat]} 胡 ${SEAT_NAMES[payerSeat]} 的 ${tile.displayText}`);
        }
        // 刷新付分方(牌被取走: 点炮时牌河少一张, 抢杠时手牌少一张)
        if (payerSeat === 0) this._fireHandChanged();
        if (robKan && payerSeat !== 0) this._fireAIHandChanged(payerSeat - 1);
        if (payerSeat === 0) this._fireDiscardChanged();
        else this._fireAIDiscard(payerSeat - 1, tile);

        if (entries.length === 0) return;
        this._finishWithHu(entries, payerSeat);
    }

    /**
     * 检测3家能否对打出的牌副露
     *
     * 玩家: 有可选项时弹出选择面板(吃/碰/杠/过),流程挂起并返回 null;
     * 若该玩家放弃,继续判断后面是否还有 AI 要副露,都放弃则由调用方让下家摸牌。
     * AI: 自动决策。
     *
     * @param skipPlayer 跳过座位0(玩家已明确表示"过",不再重复询问)
     * @returns 第一家要副露的 {seat, candidate},按 杠>碰>吃 优先;无人副露返回 null
     */
    private _checkMelds(
        discarder: number,
        tile: Tile,
        skipPlayer = false,
    ): { seat: number; candidate: MeldCandidate } | null {
        // 按逆时针轮转顺序遍历其他3家
        let seat = discarder;
        for (let offset = 1; offset <= 3; offset++) {
            seat = NEXT_SEAT[seat];
            if (seat === 0 && skipPlayer) continue;
            // 已宣告听牌(立直)后不能再吃/碰/杠 —— 对 AI 同样成立。
            // AI 听牌后会自动亮明"听", 若这里仍允许它副露, 它会自己把听牌拆掉
            // (副露会改变手牌张数与副露数, 立直锁的前提就不成立了)。
            const p0 = this._getPlayer(seat);
            if (p0?.declaredTenpai) continue;
            const isNext = offset === 1; // 仅下家可吃
            // 规则可禁止吃牌(碰/杠不受影响)
            const canChi = isNext && this._rules.allowChi;
            const player = this._getPlayer(seat);
            if (!player) continue;
            const candidates = MeldDetector.detectAll(player.hand, tile, canChi);
            if (candidates.length === 0) continue;

            if (seat === 0) {
                // 玩家: 交给 UI 弹面板选择,选中后由 resolvePlayerMeld 继续流程
                this._pendingMeldCandidates = candidates;
                this._pendingMeldTile = tile;
                this._pendingMeldFrom = discarder;
                this._awaitingPlayerMeld = true;
                this._startDecisionTimer('meld');
                this.onPlayerMeldChoice?.({
                    kind: 'meld',
                    items: this._buildMeldPromptItems(candidates),
                });
                return null;
            }
            const chosen = AIBrain.chooseMeld(
                this._buildAIContext(seat),
                candidates,
                tile,
            );
            if (chosen) return { seat, candidate: chosen };
        }
        return null;
    }

    /** 组装玩家副露选择项(供 UI 生成按钮文字) */
    private _buildMeldPromptItems(candidates: MeldCandidate[]): MeldPromptItem[] {
        const nameOf = (t: MeldCandidate['type']): string =>
            t === 'chi' ? '吃' : t === 'pon' ? '碰' : '杠';
        // 同一操作类型出现多个吃法时编号区分
        const seen = new Map<string, number>();
        for (const c of candidates) seen.set(c.type, (seen.get(c.type) ?? 0) + 1);
        const used = new Map<string, number>();
        return candidates.map(c => {
            const label = nameOf(c.type);
            const total = seen.get(c.type) ?? 1;
            let text = label;
            if (total > 1) {
                const n = (used.get(c.type) ?? 0) + 1;
                used.set(c.type, n);
                text = `${label}${n}`;
            }
            return {
                label: text,
                tilesText: this._meldTilesText(c, this._pendingMeldTile),
            };
        });
    }

    /** 副露牌面文字: 触发牌 + 所用的手牌,按点数排序,如 "三四万"、"五筒" */
    private _meldTilesText(candidate: MeldCandidate, sourceTile: Tile | null): string {
        const all = sourceTile ? [...candidate.handTiles, sourceTile] : [...candidate.handTiles];
        if (all.length === 0) return '';
        const first = all[0];
        const sorted = all.slice().sort((a, b) => a.rank - b.rank);
        // 数牌(万/条/筒)简化成 "点数+花色",如 三四万 / 五筒;字牌直接用单字
        if (first.isNumberTile) {
            const nums = sorted.map(t => CN_NUMERALS[t.rank - 1]).join('');
            return `${nums}${SUIT_CHARS[first.suit]}`;
        }
        return sorted.map(t => t.displayText).join('');
    }

    /**
     * 玩家对"吃/碰/杠/吃胡选择面板"的回应(由 UI 调用)
     * @param candidateIndex 选中的项索引;-1 表示"过"(不副露/不胡,继续摸牌)
     */
    resolvePlayerMeld(candidateIndex: number): void {
        if (!this._awaitingPlayerMeld) return;
        // 玩家已回应(无论是选了一项还是点"过")→ 停止倒计时
        this._clearDecisionTimer();
        const tile = this._pendingMeldTile;
        const fromSeat = this._pendingMeldFrom;
        const candidate = candidateIndex >= 0 ? this._pendingMeldCandidates[candidateIndex] : null;
        const ron = this._pendingRon;
        this._awaitingPlayerMeld = false;
        this._clearPendingChoice();
        if (!tile) return;

        // 吃胡/抢杠胡: 选中即结算,不走副露流程
        if (candidate && candidate.type === 'ron') {
            const ctx = ron;
            if (!ctx) return;
            this._settleRon(ctx.payerSeat, ctx.tile, [0, ...ctx.aiWinners], ctx.robKan);
            return;
        }
        // 续杠: 摸牌后自己决定是否把碰补成杠(fromSeat 为 -1 时是本回合的续杠抉择)
        if (candidate && candidate.type === 'kan' && fromSeat < 0) {
            this._upgradeToKan(0, tile);
            return;
        }
        // 放弃胡牌: 抢杠要继续把杠补上, 普通点炮继续副露/下家摸牌
        if (ron && !candidate) {
            if (ron.robKan) {
                // 抢杠方都没抢 → 补杠照常进行
                this._upgradeToKan(ron.resumeKanSeat, ron.tile, true);
                return;
            }
            if (ron.aiWinners.length > 0) {
                // AI 依然胡(一炮多响), 玩家只是没参与
                this._settleRon(ron.payerSeat, ron.tile, ron.aiWinners, false);
                return;
            }
            // 无人胡 → 回到吃/碰/杠判定(跳过玩家, 避免重复询问 → 死循环)
            const rest = this._checkMelds(ron.payerSeat, ron.tile, true);
            if (rest) {
                this._doMeld(rest.seat, rest.candidate, ron.tile, ron.payerSeat);
                return;
            }
            this._continueToNextSeat(ron.payerSeat);
            return;
        }
        if (candidate) {
            // 副露: 自己继续出牌(_doMeld 内部会清理挂起状态)
            this._doMeld(0, candidate, tile, fromSeat);
            return;
        }
        // 过: 继续向下检查是否还有 AI 要这张牌,否则下家摸牌
        // (跳过座位0,否则会把自己重新问一遍 → 死循环)
        const rest = this._checkMelds(fromSeat, tile, true);
        if (rest) {
            this._doMeld(rest.seat, rest.candidate, tile, fromSeat);
            return;
        }
        this._continueToNextSeat(fromSeat);
    }

    /** 清空一次选择请求的全部临时状态 */
    private _clearPendingChoice(): void {
        this._pendingMeldCandidates = [];
        this._pendingMeldTile = null;
        this._pendingMeldFrom = -1;
        this._pendingRon = null;
    }

    /** 取消等待中的副露选择(重新开局/手动重开时调用),避免流程被卡住 */
    cancelPendingMeld(): void {
        this._awaitingPlayerMeld = false;
        this._clearPendingChoice();
        // 面板撤下就不再需要倒计时了
        // (副露者接着出牌时, 会由 _continueAfterKanDraw 重新起一次 discard 计时)
        this._clearDecisionTimer();
    }

    /** 执行副露: 添加meld → (杠补摸) → 副露者出牌 */
    private _doMeld(seat: number, candidate: MeldCandidate, sourceTile: Tile, fromSeat: number): void {
        // 副露已确定,清掉等待玩家选择的挂起状态
        this.cancelPendingMeld();
        const player = this._getPlayer(seat)!;
        const meld = MeldDetector.toMeld(candidate, sourceTile, fromSeat);
        player.addMeld(meld);

        // 触发牌已被副露拿走,需从出牌者弃牌河移除(最后一张即为本轮打出)
        const fromPlayer = this._getPlayer(fromSeat);
        if (fromPlayer && fromPlayer.discards.length > 0) {
            const last = fromPlayer.discards[fromPlayer.discards.length - 1];
            if (last === sourceTile) fromPlayer.discards.pop();
        }

        this._fireMeld(seat, meld);
        console.log(`[副露] ${SEAT_NAMES[seat]} ${meld.toString()}`);

        // 碰/吃后玩家手牌已理牌,不存在单独标注的摸牌(须在刷新手牌之前清空,否则标注会错位)
        if (seat === 0) this._playerDrawnTile = null;

        // 刷新副露者手牌显示
        if (seat === 0) this._fireHandChanged();
        else this._fireAIHandChanged(seat - 1);
        // 刷新出牌者弃牌河(触发牌已移除)
        if (fromSeat === 0) this._fireDiscardChanged();
        else this._fireAIDiscard(fromSeat - 1, sourceTile);

        // 杠后补摸1张(简化: 直接从牌墙摸,非岭上牌)
        if (candidate.type === 'kan') {
            const replacement = this._drawReplacement(seat);
            if (!replacement) return; // 牌墙空已结算流局
            const owner = this._getPlayer(seat)!;
            // 补摸的这张就是杠上开花的机会
            if (HuChecker.isHu(owner.hand, owner.melds)) {
                this._settleSelfDraw(seat, replacement, true, this._wall.remaining === 0);
                return;
            }
            this._refreshTenpaiFlag(seat, seat === 0 ? replacement : null);
        } else {
            // 吃/碰后手牌变少, 听牌状态可能变了
            this._refreshTenpaiFlag(seat);
        }

        // 副露者需出牌
        this._continueAfterKanDraw(seat);
    }

    // ==================== 回合调度 ====================

    /** 开始某座位的摸牌轮 */
    private _startDrawTurn(seat: number): void {
        this._currentSeat = seat;
        if (seat === 0) {
            // 玩家: 自动摸牌,等玩家出牌
            this._phase = GamePhase.PLAYER_TURN;
            this._canDiscard = false;
            this._firePhaseChanged();
            this._playerDraw();
        } else {
            // AI: 自动摸牌
            this._phase = GamePhase.AI_TURN;
            this._firePhaseChanged();
            this.scheduleOnce(() => this._aiDrawAndPlay(seat), this._rules.aiDelay);
        }
    }

    /** AI 摸牌 → 检测胡 → 听牌 → 出牌 */
    private _aiDrawAndPlay(seat: number): void {
        if (this._phase === GamePhase.GAME_OVER) return;
        const ai = this._aiPlayers[seat - 1];
        if (!ai || !this._wall) return;

        if (this._wall.remaining <= 0) {
            this._endByDraw();
            return;
        }
        const drawn = this._wall.draw();
        if (!drawn) { this._endByDraw(); return; }
        const isLastTile = this._wall.remaining === 0;
        ai.addTile(drawn);
        this._fireAIHandChanged(seat - 1);

        // 检测胡(摸走牌墙最后一张 → 海底捞月)
        if (HuChecker.isHu(ai.hand, ai.melds)) {
            this._settleSelfDraw(seat, drawn, false, isLastTile);
            return;
        }
        // 摸到与已碰牌相同的牌 → 续杠(规则允许时 AI 总是补杠)
        if (this._findAddKanMeld(ai, drawn)) {
            this._upgradeToKan(seat, drawn);
            return;
        }
        // 听牌检测(AI 一旦听牌就自动亮明"听"标记)
        this._refreshTenpaiFlag(seat, drawn, true);
        // 延时出牌
        this.scheduleOnce(() => this._aiDiscard(seat), this._rules.aiDelay);
    }

    /** AI 选牌出牌 → afterDiscard */
    private _aiDiscard(seat: number): void {
        if (this._phase === GamePhase.GAME_OVER) return;
        const ai = this._aiPlayers[seat - 1];
        if (!ai) return;
        const ctx = this._buildAIContext(seat);
        // 已宣告听牌(立直)的 AI 只能打保持听牌的牌
        const idx = ai.declaredTenpai
            ? AIBrain.chooseDiscardTenpaiSafe(ctx)
            : AIBrain.chooseDiscard(ctx);
        const tile = ai.removeTile(idx);
        if (!tile) return;
        ai.discards.push(tile);
        this._fireAIHandChanged(seat - 1);
        this._fireAIDiscard(seat - 1, tile);
        console.log(`[AI] ${SEAT_NAMES[seat]} 打出 ${tile.displayText}`);
        // 打完重新检测听牌
        this._refreshTenpaiFlag(seat);
        this._afterDiscard(seat, tile);
    }

    // ==================== 牌局结束: 胡牌结算 / 流局 ====================

    /**
     * 胡牌结算(自摸/吃胡/抢杠/一炮多响统一入口)
     *
     * 流程: 逐家算番型 → 按付分关系算分数 → 更新连庄与累计分 →
     *       结束牌局 → 亮出四家手牌 → 把结算数据交给 UI 弹结算面板
     * @param entries 各家胡牌现场(一炮多响时有多条)
     * @param payerSeat 付分方座位(点炮者/被抢杠者);自摸传 -1
     */
    private _finishWithHu(entries: HuEntry[], payerSeat: number): void {
        if (this._phase === GamePhase.GAME_OVER) return;
        if (entries.length === 0) return;

        // 1) 逐家算番型(连庄取"本次胡牌后"的连庄次数)
        const winners: WinnerResult[] = [];
        for (const e of entries) {
            const player = this._getPlayer(e.seat);
            const hu: HuResult = computeHu({
                hand: e.hand,
                melds: e.melds,
                isSelfDraw: e.isSelfDraw,
                isAfterKan: e.isAfterKan,
                isLastTile: e.isLastTile,
                isRobKan: e.isRobKan,
                streak: this._streaks[e.seat] + 1,
                declaredTenpai: !!player?.declaredTenpai,
            });
            winners.push({
                seat: e.seat,
                name: SEAT_NAMES[e.seat],
                hu,
                delta: 0,
                winTile: e.winTile,
                isSelfDraw: e.isSelfDraw,
            });
        }

        // 2) 分数: 自摸=三家各付一份; 点炮/抢杠=付分方一次付清(可同时付给多家)
        const deltas = [0, 0, 0, 0];
        for (const w of winners) {
            if (w.isSelfDraw) {
                w.delta = w.hu.points * 3;
                deltas[w.seat] += w.delta;
                for (let s = 0; s < 4; s++) {
                    if (s !== w.seat) deltas[s] -= w.hu.points;
                }
            } else {
                w.delta = w.hu.points;
                deltas[w.seat] += w.delta;
                if (payerSeat >= 0) deltas[payerSeat] -= w.delta;
            }
        }

        // 3) 累计分与连庄(赢家 +1 局, 其他人断庄)
        const winnerSeats = new Set(winners.map(w => w.seat));
        for (let s = 0; s < 4; s++) {
            this._scores[s] += deltas[s];
            this._streaks[s] = winnerSeats.has(s) ? this._streaks[s] + 1 : 0;
        }

        const { title, subtitle } = this._buildHuTitle(winners, payerSeat);
        const message = subtitle ? `${title}(${subtitle})` : title;
        this._endGame(title, subtitle, message, winners[0].seat, this._buildSeatResults(deltas, winnerSeats), winners);
    }

    /** 流局: 牌墙摸空且无人胡(同样要亮牌 + 弹结算面板, 连庄不断) */
    private _endByDraw(): void {
        if (this._phase === GamePhase.GAME_OVER) return;
        const title = '流局';
        const subtitle = '牌墙已空, 无人胡牌';
        const message = `流局(牌墙已空)`;
        this._endGame(title, subtitle, message, -1, this._buildSeatResults([0, 0, 0, 0], new Set()), []);
    }

    /**
     * 收尾公共部分: 结束状态 + 提示 + 亮牌 + 结算数据
     */
    private _endGame(
        title: string,
        subtitle: string,
        message: string,
        winnerSeat: number,
        seats: SeatResult[],
        winners: WinnerResult[],
    ): void {
        this._phase = GamePhase.GAME_OVER;
        this.cancelPendingMeld();
        this._canDiscard = false;
        this._fireHu(message);
        this._firePhaseChanged();
        this.onReveal?.(winnerSeat, message);
        const data: SettlementData = {
            kind: winners.length > 0 ? 'hu' : 'draw',
            title,
            subtitle,
            winners,
            seats,
        };
        this.onSettle?.(data);
    }

    /** 四家结算行(含累计分与本局得失) */
    private _buildSeatResults(deltas: number[], winnerSeats: Set<number>): SeatResult[] {
        const rows: SeatResult[] = [];
        for (let s = 0; s < 4; s++) {
            const p = this._getPlayer(s);
            if (!p) continue;
            rows.push({
                seat: s,
                name: SEAT_NAMES[s],
                hand: [...p.hand].sort((a, b) => a.sortKey - b.sortKey),
                melds: [...p.melds],
                delta: deltas[s] ?? 0,
                total: this._scores[s],
                isWinner: winnerSeats.has(s),
                declaredTenpai: p.declaredTenpai,
            });
        }
        return rows;
    }

    /** 胡牌标题文案(一炮多响单独一句) */
    private _buildHuTitle(
        winners: WinnerResult[],
        payerSeat: number,
    ): { title: string; subtitle: string } {
        if (winners.length > 1) {
            return {
                title: '一炮多响',
                subtitle: `${winners.map(w => w.name).join('、')} 同时胡 ${winners[0].winTile?.displayText ?? ''}`,
            };
        }
        const w = winners[0];
        const title = w.seat === 0 ? '你胡了!' : `${w.name}胡了!`;
        let subtitle: string;
        if (w.isSelfDraw) {
            subtitle = '自摸';
        } else if (w.hu.fans.some(f => f.name === '抢杠胡')) {
            subtitle = `抢${payerSeat === 0 ? '你' : SEAT_NAMES[payerSeat]}的杠`;
        } else {
            subtitle = `${payerSeat === 0 ? '你' : SEAT_NAMES[payerSeat]}点炮`;
        }
        return { title, subtitle };
    }

    // ==================== 听牌检测 / 立直 ====================

    /**
     * 重新检测某家听牌状态并广播变化
     *
     * @param seat 座位 0-3
     * @param exclude 刚摸到的那张牌(未并入理牌, 参与听牌判定时要排除)
     * @param announce true=顺带把听牌张通过 onTenpai 提示给玩家
     */
    private _refreshTenpaiFlag(seat: number, exclude: Tile | null = null, announce = false): void {
        const player = this._getPlayer(seat);
        if (!player) return;
        const hand = exclude ? player.hand.filter(t => t !== exclude) : player.hand;
        const waiting = HuChecker.isTenpai(hand, player.melds);
        const isTenpai = waiting.length > 0;
        const changed = player.tenpai !== isTenpai;
        player.tenpai = isTenpai;
        // AI 一旦听牌就自动亮明"听", 让玩家知道对手在等牌
        if (seat !== 0 && isTenpai && !player.declaredTenpai) {
            player.declaredTenpai = true;
            console.log(`[听牌] AI(${SEAT_NAMES[seat]}) 听: ${waiting.map(t => t.displayText).join(' ')}`);
        }
        if (changed) this.onTenpaiChanged?.(seat, isTenpai);
        if (announce && isTenpai && seat === 0) this.onTenpai?.(waiting);
    }

    /**
     * 玩家是否可以宣告听牌(立直)
     *
     * 条件: 本局进行中、轮到玩家、没在等副露选择、还没宣告过、手上没有副露(必须门清)、当前确实听牌
     */
    get canRiichi(): boolean {
        if (!this._rules.allowRiichi) return false;
        if (this._phase === GamePhase.GAME_OVER || this._phase === GamePhase.DEALING) return false;
        if (this._phase !== GamePhase.PLAYER_TURN) return false;
        if (!this._player || this._awaitingPlayerMeld) return false;
        if (!this._canDiscard || this._player.declaredTenpai) return false;
        if (this._player.melds.length > 0) return false;
        return this._player.tenpai;
    }

    /**
     * 玩家宣告听牌(立直): 亮明"听"标记, 加 1 番
     * 本局不能再吃/碰/杠, 且出牌必须保持听牌(见 playTile 的立直锁)
     * @returns 是否宣告成功
     */
    declareTenpai(): boolean {
        if (!this.canRiichi || !this._player) return false;
        this._player.declaredTenpai = true;
        this.onTenpaiChanged?.(0, true);
        this.onNotice?.('已宣告听牌(立直): 本局不能再吃/碰/杠, 出牌须保持听牌');
        console.log('[立直] 你宣告听牌');
        return true;
    }

    /** 某家是否已亮明听牌(UI 画"听"标记用) */
    isTenpaiDeclared(seat: number): boolean {
        return !!this._getPlayer(seat)?.declaredTenpai;
    }

    /** 某家当前是否听牌(UI 显示"可宣告听牌"按钮用) */
    isTenpai(seat: number): boolean {
        return !!this._getPlayer(seat)?.tenpai;
    }

    // ==================== AI 提示(玩家求助) ====================

    /**
     * 玩家是否处于"需要做决定"的时刻(可以点提示)
     *
     * 两种情形: 轮到自己出牌, 或正在选吃/碰/杠/胡。其余时刻(等 AI 行动、
     * 发牌中、已结束)给提示没有意义, 按钮也不该亮。
     */
    get canHint(): boolean {
        if (this._phase === GamePhase.IDLE || this._phase === GamePhase.DEALING) return false;
        if (this._phase === GamePhase.GAME_OVER) return false;
        if (this._phase === GamePhase.AI_TURN) return false;
        if (this._awaitingPlayerMeld) return this._pendingMeldCandidates.length > 0;
        return this._phase === GamePhase.PLAYER_TURN && this._canDiscard;
    }

    /**
     * 玩家请求一次提示(由 UI 的"提示"按钮调用)
     *
     * 会按当前处境自动选形态: 能胡就提示胡, 在选副露就提示吃/碰/杠,
     * 否则提示该打哪张牌。结果通过 `onHint` 回调交给 UI。
     *
     * 【为什么可以放心把 AI 的算法用在玩家身上】这里用的是**玩家自己能看到的信息**
     * (自己的手牌 + 所有公开的弃牌/副露), 见 `_buildAdviceContext`:
     * 相当于把 AI 的思考过程透明地讲给玩家听, 而不是让 AI 透视玩家的手牌。
     */
    requestHint(): void {
        if (!this.canHint) {
            this._hint = null;
            this.onHint?.(null);
            return;
        }
        this._hint = this._computeHint();
        this.onHint?.(this._hint);
    }

    /** 清除当前提示(局面变化时由 UI 调用, 也可由本文件在状态推进时清) */
    clearHint(): void {
        this._hint = null;
        this.onHint?.(null);
    }

    /** 组装"玩家视角"的决策上下文: 自己的手牌 + 全部公开信息, 不含别家手牌 */
    private _buildAdviceContext(): AIContext | null {
        if (!this._player) return null;
        return this._buildAIContext(0);
    }

    /** 按当前处境计算一份提示(不触发回调) */
    private _computeHint(): Hint | null {
        if (!this.canHint) return null;
        const ctx = this._buildAdviceContext();
        if (!ctx) return null;

        if (!this._awaitingPlayerMeld) return HintAdvisor.discard(ctx);

        // 正在选副露: 候选按类型分两种语义
        const tile = this._pendingMeldTile;
        const candidates = this._pendingMeldCandidates;
        if (!tile || candidates.length === 0) return null;
        // 吃胡单独一条路径: 它没有"该不该"的取舍, 本项目里放过只是白丢分
        if (candidates.length === 1 && candidates[0].type === 'ron') {
            return HintAdvisor.ron(tile);
        }
        // 吃/碰/杠(含续杠)统一走副露评估
        return HintAdvisor.meld(ctx, candidates, tile);
    }

    /** 玩家最近一次请求的提示(UI 重建时用来恢复面板) */
    get hint(): Hint | null { return this._hint; }

    // ==================== 决策超时(自动行动) ====================

    /**
     * 每帧推进决策倒计时, 到点自动替玩家做决定
     *
     * 为什么要有这个: 玩家可能离开/走神, 让整局卡死。
     * 超时后的动作刻意取得很"笨":
     *  - 出牌超时 → 直接打掉**刚摸到的那张**(玩家的原话: "不管三饼对我是否有用")
     *    这样行为可预期, 也绝不会出现非法出牌(刚摸的牌永远打得出去)。
     *  - 副露超时 → 一律"过"(保守, 不会因为发呆而白白亮牌/损失门清)
     */
    update(dt: number): void {
        if (this._decideKind === 'none') return;
        // 牌局已结束或玩家已做出选择 → 停止计时
        if (this._phase === GamePhase.GAME_OVER || this._phase === GamePhase.IDLE) {
            this._clearDecisionTimer();
            return;
        }
        // 设置弹窗开着: 冻结计时(不累加 dt), 关闭后从原剩余时间继续
        if (this._decidePaused) return;
        this._decideElapsed += dt;
        if (this._decideElapsed < GameManager.DECIDE_LIMIT) return;

        // 到点: 先摘掉计时状态, 避免自动行动触发的流程里再次命中
        const kind = this._decideKind;
        this._clearDecisionTimer();
        if (this._decideTimedOut) return;
        this._decideTimedOut = true;

        if (kind === 'meld') {
            if (this._awaitingPlayerMeld) {
                console.log('[超时] 副露选择超过 20 秒, 自动"过"');
                this.resolvePlayerMeld(-1);
            }
            return;
        }
        // 出牌超时
        if (this._phase === GamePhase.PLAYER_TURN && this._canDiscard && !this._awaitingPlayerMeld) {
            const drawn = this._playerDrawnTile;
            const idx = drawn ? this._player.hand.indexOf(drawn) : -1;
            if (idx >= 0) {
                console.log(`[超时] 出牌超过 20 秒, 自动打出刚摸的 ${drawn.displayText}`);
                this.playTile(idx);
            } else {
                // 理论上到不了这里(刚摸的牌一定在手牌里), 兜底打第一张保证牌局能继续
                this.playTile(0);
            }
        }
    }

    /** 开始一次决策计时(重复调用会重置, 不会叠加) */
    private _startDecisionTimer(kind: 'discard' | 'meld'): void {
        this._decideKind = kind;
        this._decideElapsed = 0;
        this._decideTimedOut = false;
    }

    /** 停止决策计时(玩家已做出选择 / 回合结束) */
    private _clearDecisionTimer(): void {
        this._decideKind = 'none';
        this._decideElapsed = 0;
        this._decideTimedOut = false;
        // 暂停标志一并复位: 结束路径(startGame/stopGame/cancelPendingMeld)都经过这里,
        // 漏复位会让下一局的倒计时"看着在走、实际不动"(计时被冻住, 永远不超时)
        this._decidePaused = false;
        // 决策一结束(出牌/副露/结束牌局都会经过这里), 之前的提示立刻失效:
        // 局面已经变了, 再显示"建议打 X"就是在给过期建议。
        if (this._hint) this.clearHint();
    }

    /**
     * 暂停玩家决策倒计时(打开设置弹窗时调用)
     *
     * 只冻结**玩家决策**的计时; AI 的回合调度(`scheduleOnce`)不暂停 ——
     * 那需要连带保存/恢复整条调度链, 收益却为零: 玩家关掉弹窗后
     * AI 该走还是会走, 而玩家自己的决定永远不会被系统替他做。
     */
    pauseDecideTimer(): void {
        this._decidePaused = true;
    }

    /** 恢复玩家决策倒计时(关闭设置弹窗时调用), 从暂停时的剩余时间继续 */
    resumeDecideTimer(): void {
        this._decidePaused = false;
    }

    /** 决策倒计时是否被暂停(UI 可据此显示"已暂停") */
    get decidePaused(): boolean { return this._decidePaused; }

    /** 当前决策剩余秒数(UI 画倒计时用;不在计时返回 0) */
    get decideRemain(): number {
        if (this._decideKind === 'none') return 0;
        return Math.max(0, GameManager.DECIDE_LIMIT - this._decideElapsed);
    }

    /** 决策时限总秒数(UI 画进度环用) */
    get decideLimit(): number { return GameManager.DECIDE_LIMIT; }

    /** 当前是否正在为玩家的某个决定计时 */
    get deciding(): boolean { return this._decideKind !== 'none'; }

    // ==================== 状态查询 ====================

    get player(): Player | null { return this._player; }
    get phase(): GamePhase { return this._phase; }
    /**
     * 牌局是否在进行中(含"刚打出一张牌、等别家反应"的短暂空档)
     *
     * UI 判断"该不该动"时用这个, **不要**手写 `phase === PLAYER_TURN || phase === AI_TURN` ——
     * 那样会漏掉 DISCARDING, 表现为每次出牌指针都暗一下再亮起来(闪烁)。
     */
    get isTurnRunning(): boolean {
        return this._phase === GamePhase.PLAYER_TURN
            || this._phase === GamePhase.AI_TURN
            || this._phase === GamePhase.DISCARDING;
    }
    get wallRemaining(): number { return this._wall ? this._wall.remaining : 0; }
    get aiCount(): number { return this.AI_COUNT; }
    get canDiscard(): boolean { return this._canDiscard; }
    get currentSeat(): number { return this._currentSeat; }
    /** 玩家刚摸到、尚未并入理牌的牌(null 表示当前没有) */
    get playerDrawnTile(): Tile | null { return this._playerDrawnTile; }
    /** 玩家是否正在选择吃/碰/杠(此时回合挂起) */
    get awaitingPlayerMeld(): boolean { return this._awaitingPlayerMeld; }
    /** 某家累计得分 */
    getScore(seat: number): number { return this._scores[seat] ?? 0; }

    /** 获取座位玩家(0=自己, 1-3=AI) */
    private _getPlayer(seat: number): Player | null {
        if (seat === 0) return this._player;
        return this._aiPlayers[seat - 1] ?? null;
    }

    /**
     * 为某个 AI 座位组装决策上下文
     *
     * AI 能看到的信息严格限制在"公开信息": 自己的手牌、所有人的弃牌与副露、
     * 自己手牌+副露+弃牌的可见张数。**不把别家的手牌给 AI**, 否则就是作弊。
     */
    private _buildAIContext(seat: number): AIContext {
        const me = this._getPlayer(seat);
        const visible = new Int8Array(TILE_TYPE_COUNT);
        const threats: ThreatInfo[] = [];
        const addAll = (tiles: Tile[]): void => {
            for (const t of tiles) visible[tileIndexOf(t.suit, t.rank)]++;
        };

        for (let s = 0; s < 4; s++) {
            const p = this._getPlayer(s);
            if (!p) continue;
            addAll(p.discards);
            for (const m of p.melds) addAll(m.tiles);
        }
        for (let s = 0; s < 4; s++) {
            if (s === seat) continue;
            const p = this._getPlayer(s);
            if (!p) continue;
            threats.push({
                discards: p.discards,
                melds: p.melds,
                declaredTenpai: p.declaredTenpai,
            });
        }
        if (me) addAll(me.hand);

        return {
            hand: me ? me.hand : [],
            melds: me ? me.melds : [],
            declaredTenpai: me ? me.declaredTenpai : false,
            visible,
            threats,
            wallRemaining: this._wall ? this._wall.remaining : 0,
            difficulty: difficultyOfDelay(this._rules.aiDelay),
        };
    }

    /** 获取指定 AI 索引的玩家(0=上家 1=左家 2=右家) */
    getAIPlayer(index: number): Player | null {
        return this._aiPlayers[index] ?? null;
    }

    // ==================== 内部事件触发 ====================

    private _fireHandChanged(): void { this.onHandChanged?.(); }
    private _fireDiscardChanged(): void { this.onDiscardChanged?.(); }
    private _firePhaseChanged(): void { this.onPhaseChanged?.(this._phase); }
    private _fireHu(message: string): void { this.onHu?.(message); }
    private _fireAIHandChanged(aiIndex: number): void { this.onAIHandChanged?.(aiIndex); }
    private _fireAIDiscard(aiIndex: number, tile: Tile): void { this.onAIDiscard?.(aiIndex, tile); }
    private _fireMeld(seat: number, meld: Meld): void { this.onMeld?.(seat, meld); }
}
