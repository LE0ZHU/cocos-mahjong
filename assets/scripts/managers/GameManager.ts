import { _decorator, Component } from 'cc';
import { Wall } from '../core/Wall';
import { Tile } from '../core/Tile';
import { Meld } from '../core/Meld';
import { MeldCandidate, MeldDetector } from '../core/MeldDetector';
import { Player } from '../game/Player';
import { AIBrain } from '../game/AIBrain';
import { HAND_SIZE, SUIT_CHARS, CN_NUMERALS } from '../core/TileDefine';
import { GameRules, GAME_RULES } from '../game/GameRules';
import { HuChecker } from '../core/HuChecker';

const { ccclass } = _decorator;

/** 游戏阶段 */
export enum GamePhase {
    IDLE = 0,
    DEALING,
    PLAYER_TURN,   // 玩家回合(可摸牌或出牌)
    AI_TURN,       // AI 回合
    GAME_OVER,
}

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
     * 开始新游戏: 新建牌墙 → 4 家各发起手牌 → 玩家回合
     * @param rules 本局规则(起手牌数/是否允许吃/AI 速度);不传则沿用当前规则
     */
    startGame(rules: GameRules = GAME_RULES.rules): void {
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

        // 进入玩家回合: 自动摸牌,等玩家点选/出牌
        this._phase = GamePhase.PLAYER_TURN;
        this._canDiscard = false;
        this._firePhaseChanged();
        this._fireHandChanged();
        for (let a = 0; a < this.AI_COUNT; a++) this._fireAIHandChanged(a);
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

        this._player.addDrawnTile(tile);
        this._playerDrawnTile = tile;
        this._canDiscard = true;
        this._fireHandChanged();
        // 摸到与已碰牌相同的牌 → 可续杠
        this._checkPlayerAddKan();
        // 摸牌后检测胡牌
        if (HuChecker.isHu(this._player.hand, this._player.melds)) {
            this._finishGame(0, '你胡了!');
            return tile;
        }
        // 听牌提示
        this._checkPlayerTenpai();
        return tile;
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
        this.onPlayerMeldChoice?.({
            kind: 'meld',
            items: [{ label: '续杠', tilesText: `${tile.displayText}(手中摸到)` }],
        });
        return true;
    }

    /**
     * 执行续杠: 把摸到的第4张补进已碰的面子 → 从牌墙补摸一张 → 继续出牌
     * @param tile 手里用来续杠的牌
     */
    private _upgradeToKan(seat: number, tile: Tile): void {
        const player = this._getPlayer(seat);
        if (!player) return;
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
        if (seat === 0) {
            if (replacement) {
                this._canDiscard = true;
                this._phase = GamePhase.PLAYER_TURN;
                this._firePhaseChanged();
                // 补摸的牌再检测一次胡牌
                if (this._player && HuChecker.isHu(this._player.hand, this._player.melds)) {
                    this._finishGame(0, '你胡了!(杠上开花)');
                    return;
                }
            }
        } else {
            // AI: 稍作停顿后继续出牌
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
        const tile = this._player.removeTile(index);
        if (!tile) return false;
        this._player.discards.push(tile);
        this._playerDrawnTile = null;
        this._player.sortHand(); // 出牌后把摸到的牌并入理牌
        this._canDiscard = false;
        this._fireHandChanged();
        this._fireDiscardChanged();
        this._afterDiscard(0, tile);
        return true;
    }

    // ==================== 出牌后流程: 副露检测 / 下家摸牌 ====================

    /**
     * 出牌后统一处理: 检测吃胡 → 检测副露 → 下家摸牌
     *
     * 自己需要选择吃/碰/杠/吃胡时,流程在此暂停(等玩家点面板),
     * 由 resolvePlayerMeld 决定后再从这里继续往下家走。
     * @param discarder 出牌者座位(0-3)
     * @param tile 打出的牌
     */
    private _afterDiscard(discarder: number, tile: Tile): void {
        this._lastDiscard = tile;
        // 流局: 牌墙空且无人胡
        if (!this._wall || this._wall.remaining <= 0) {
            this._endByDraw();
            return;
        }
        // 1) 吃胡(点炮)优先于吃/碰/杠: 玩家可选择胡别人打出的牌
        if (this._checkPlayerRon(discarder, tile)) return;
        // 2) 检测其他3家能否对该牌副露(按轮转顺序: 下家优先)
        const meldResult = this._checkMelds(discarder, tile);
        if (meldResult) {
            this._doMeld(meldResult.seat, meldResult.candidate, tile, discarder);
            return;
        }
        // 玩家正在纠结吃/碰/杠: 回合挂起,等 resolvePlayerMeld 决定后再继续
        if (this._awaitingPlayerMeld) return;
        // 无副露 → 下家(逆时针下一位)摸牌
        const nextSeat = NEXT_SEAT[discarder];
        // 玩家若因"过"而保留着刚摸到的牌(14 张待出),不能重复摸牌,直接回到他的回合
        if (nextSeat === 0 && this._canResumePlayerTurn()) {
            this._phase = GamePhase.PLAYER_TURN;
            this._firePhaseChanged();
            return;
        }
        this._startDrawTurn(nextSeat);
    }

    /** 玩家是否处于"已经摸过牌、仍待出牌"的状态(此时不能再摸一张) */
    private _canResumePlayerTurn(): boolean {
        return !!this._player && this._playerDrawnTile !== null && this._canDiscard;
    }

    // ==================== 吃胡(点炮) ====================

    /**
     * 检测玩家能否吃胡(点炮): 别人打出的牌凑成胡牌
     *
     * 规则 allowChiHu 关闭时直接跳过;玩家胡牌优先于吃/碰/杠。
     * @returns true 表示已弹出选择(胡/过),调用方应暂停后续流程
     */
    private _checkPlayerRon(discarder: number, tile: Tile): boolean {
        if (!this._rules.allowChiHu) return false;
        if (discarder === 0 || !this._player) return false;
        const test = [...this._player.hand, tile];
        if (!HuChecker.isHu(test, this._player.melds)) return false;

        // 复用同一个选择面板: [胡牌] + [过]
        this._pendingMeldCandidates = [{ type: 'ron', handTiles: [] }];
        this._pendingMeldTile = tile;
        this._pendingMeldFrom = discarder;
        this._awaitingPlayerMeld = true;
        this.onPlayerMeldChoice?.({
            kind: 'ron',
            items: [{
                label: '胡牌',
                tilesText: tile.displayText,
            }],
        });
        return true;
    }

    /** 玩家选择吃胡: 把打出的牌收进手牌并结算 */
    private _doPlayerRon(tile: Tile, fromSeat: number): void {
        const player = this._player;
        if (!player) return;
        // 该牌从出牌者的弃牌河移到赢家手牌
        const fromPlayer = this._getPlayer(fromSeat);
        if (fromPlayer && fromPlayer.discards.length > 0) {
            const last = fromPlayer.discards[fromPlayer.discards.length - 1];
            if (last === tile) fromPlayer.discards.pop();
        }
        player.addTile(tile);
        this._playerDrawnTile = null;
        this._canDiscard = false;
        this._fireHandChanged();
        if (fromSeat === 0) this._fireDiscardChanged();
        else this._fireAIDiscard(fromSeat - 1, tile);

        const fromName = SEAT_NAMES[fromSeat];
        console.log(`[吃胡] 你胡了 ${fromName} 打出的 ${tile.displayText}`);
        this._finishGame(0, `你胡了!(${fromName}点炮)`);
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
                this.onPlayerMeldChoice?.({
                    kind: 'meld',
                    items: this._buildMeldPromptItems(candidates),
                });
                return null;
            }
            const chosen = AIBrain.chooseMeld(candidates);
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
        const tile = this._pendingMeldTile;
        const fromSeat = this._pendingMeldFrom;
        const candidate = candidateIndex >= 0 ? this._pendingMeldCandidates[candidateIndex] : null;
        this._awaitingPlayerMeld = false;
        if (!tile) {
            this._pendingMeldCandidates = [];
            this._pendingMeldTile = null;
            this._pendingMeldFrom = -1;
            return;
        }
        // 吃胡: 选中即结算,不走副露流程
        if (candidate && candidate.type === 'ron') {
            this._pendingMeldCandidates = [];
            this._pendingMeldTile = null;
            this._pendingMeldFrom = -1;
            this._doPlayerRon(tile, fromSeat);
            return;
        }
        // 续杠: 摸牌后自己决定是否把碰补成杠(fromSeat 为 -1 时是本回合的续杠抉择)
        if (candidate && candidate.type === 'kan' && fromSeat < 0) {
            this._pendingMeldCandidates = [];
            this._pendingMeldTile = null;
            this._pendingMeldFrom = -1;
            this._upgradeToKan(0, tile);
            return;
        }
        if (candidate) {
            // 副露: 自己继续出牌(_doMeld 内部会清理挂起状态)
            this._doMeld(0, candidate, tile, fromSeat);
            return;
        }
        // 过: 继续向下检查是否还有 AI 要这张牌,否则下家摸牌
        // (跳过座位0,否则会把自己重新问一遍 → 死循环)
        this._pendingMeldCandidates = [];
        this._pendingMeldTile = null;
        this._pendingMeldFrom = -1;
        const rest = this._checkMelds(fromSeat, tile, true);
        if (rest) {
            this._doMeld(rest.seat, rest.candidate, tile, fromSeat);
            return;
        }
        const nextSeat = NEXT_SEAT[fromSeat];
        // 玩家若还留着刚摸到的牌(待出牌),不能重复摸牌
        if (nextSeat === 0 && this._canResumePlayerTurn()) {
            this._phase = GamePhase.PLAYER_TURN;
            this._firePhaseChanged();
            return;
        }
        this._startDrawTurn(nextSeat);
    }

    /** 取消等待中的副露选择(重新开局/手动重开时调用),避免流程被卡住 */
    cancelPendingMeld(): void {
        this._awaitingPlayerMeld = false;
        this._pendingMeldCandidates = [];
        this._pendingMeldTile = null;
        this._pendingMeldFrom = -1;
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
            if (!this._drawReplacement(seat)) return; // 牌墙空已结算流局
        }

        // 副露者需出牌
        this._currentSeat = seat;
        if (seat === 0) {
            // 玩家副露后: 等玩家手动出牌
            this._phase = GamePhase.PLAYER_TURN;
            this._canDiscard = true;
            this._firePhaseChanged();
        } else {
            // AI 副露后: 延时自动出牌
            this._phase = GamePhase.AI_TURN;
            this._firePhaseChanged();
            this.scheduleOnce(() => this._aiDiscard(seat), this._rules.aiDelay);
        }
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
        ai.addTile(drawn);
        this._fireAIHandChanged(seat - 1);

        // 检测胡
        if (HuChecker.isHu(ai.hand, ai.melds)) {
            this._finishGame(seat, `AI(${SEAT_NAMES[seat]})胡了!`);
            return;
        }
        // 摸到与已碰牌相同的牌 → 续杠(规则允许时 AI 总是补杠)
        if (this._findAddKanMeld(ai, drawn)) {
            this._upgradeToKan(seat, drawn);
            return;
        }
        // 听牌(仅日志)
        const waiting = HuChecker.isTenpai(ai.hand, ai.melds);
        if (waiting.length > 0) {
            console.log(`[听牌] AI(${SEAT_NAMES[seat]}) 听: ${waiting.map(t => t.displayText).join(' ')}`);
        }
        // 延时出牌
        this.scheduleOnce(() => this._aiDiscard(seat), this._rules.aiDelay);
    }

    /** AI 选牌出牌 → afterDiscard */
    private _aiDiscard(seat: number): void {
        if (this._phase === GamePhase.GAME_OVER) return;
        const ai = this._aiPlayers[seat - 1];
        if (!ai) return;
        const idx = AIBrain.chooseDiscard(ai.hand);
        const tile = ai.removeTile(idx);
        if (!tile) return;
        ai.discards.push(tile);
        this._fireAIHandChanged(seat - 1);
        this._fireAIDiscard(seat - 1, tile);
        console.log(`[AI] ${SEAT_NAMES[seat]} 打出 ${tile.displayText}`);
        this._afterDiscard(seat, tile);
    }

    // ==================== 牌局结束 ====================

    /**
     * 统一收尾: 结束牌局 → 提示 → 亮出四家手牌
     * 无论哪家胡牌、还是流局,都走这里,保证"结束时四家手牌全亮"只有一条路径。
     * @param winnerSeat 胡牌者座位(0-3);流局传 -1
     * @param message 提示文字
     */
    private _finishGame(winnerSeat: number, message: string): void {
        this._phase = GamePhase.GAME_OVER;
        this._fireHu(message);
        this._firePhaseChanged();
        this.onReveal?.(winnerSeat, message);
    }

    /** 流局: 牌墙摸空且无人胡(同样要亮牌) */
    private _endByDraw(): void {
        this._finishGame(-1, '流局(牌墙已空)');
    }

    /** 玩家听牌检测并提示 */
    private _checkPlayerTenpai(): void {
        if (!this._player) return;
        const waiting = HuChecker.isTenpai(this._player.hand, this._player.melds);
        if (waiting.length > 0) {
            this.onTenpai?.(waiting);
        }
    }

    // ==================== 状态查询 ====================

    get player(): Player | null { return this._player; }
    get phase(): GamePhase { return this._phase; }
    get wallRemaining(): number { return this._wall ? this._wall.remaining : 0; }
    get aiCount(): number { return this.AI_COUNT; }
    get canDiscard(): boolean { return this._canDiscard; }
    get currentSeat(): number { return this._currentSeat; }
    /** 玩家刚摸到、尚未并入理牌的牌(null 表示当前没有) */
    get playerDrawnTile(): Tile | null { return this._playerDrawnTile; }
    /** 玩家是否正在选择吃/碰/杠(此时回合挂起) */
    get awaitingPlayerMeld(): boolean { return this._awaitingPlayerMeld; }

    /** 获取座位玩家(0=自己, 1-3=AI) */
    private _getPlayer(seat: number): Player | null {
        if (seat === 0) return this._player;
        return this._aiPlayers[seat - 1] ?? null;
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
