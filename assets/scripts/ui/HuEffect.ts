import { _decorator, Color, Component, Graphics, Node, tween, UITransform, Vec3, v3 } from 'cc';
import { ensureOpacity, flashBurst, stopTweensDeep, toLocal, toWorld } from './Anim';
import { createTileNode, setTileBgColor } from './UIFactory';
import { TileView } from './TileView';
import { SettlementData, WinnerResult } from '../core/HuScore';
import { Tile } from '../core/Tile';

const { ccclass } = _decorator;

// ==================== 节奏(秒, 从 play() 起算) ====================
// **只留"和牌归位"这一件事**(2026-10-18 用户拍板删掉了全桌压暗 / 大字宣告 / 摘要行三拍):
// 飞牌 → 落位金环 + 闪光 → 留一眼 → 直接把结算面板交给 SettlementPanel。
// **没有压暗**: 全程在亮桌面上演, "谁胡了 / 几番"由结算面板自己说(它自带遮罩)。
// play() 在三家翻面播完之后才被 Main 调进来(HU_FX_REVEAL_TAIL = 1.15s 之前只播翻面)。
const T_FLY_DUR = 0.7;      // 第 1 拍: 副本起飞(play 一开始就飞, 亮桌面上看得清)
const T_LAND = 0.7;         // 落位 → 金环 + 闪光
/** 金环寿命: 0.3s —— 落位后**一闪即收**, 明显短于闪光 */
const RING_LIFE = 0.3;
const FLASH_DUR = 0.6;      // 闪光主体时长(flashBurst 内部还有 0.05 淡入)
const FLASH_SUB_DUR = 0.42; // 收着演的闪光更短
/** 闪光相对**落位**的收束时刻(0.6 + 0.05 淡入 = 0.65) */
const FLASH_LIFE = FLASH_DUR + 0.05;
/** 闪光收束 → 交棒之间留的一眼(余韵看完再让面板上来) */
const T_BEAT = 0.5;
const T_TILE = 0.7;         // 自摸(无飞行)的金环时刻(与吃胡落位同一时刻)
/** 交棒: 面板开始上滑 —— 落位 0.7 + 闪光 0.65 + 留一眼 0.5(点胡起 ≈3.5s 就位) */
const T_DONE = 1.85;
// 流局没有任何"归位"可播(没人胡, 没有关键牌), 陪着等就是纯枯等 —— 立刻交棒
const DRAW_T_DONE = 0.15;

// ==================== 视觉 ====================
/** 遮罩尺寸(与 SettlementPanel 同一招, 盖住整张牌桌 —— 这里只用来吞点击) */
const MASK_SIZE = 6000;

const C_GOLD = new Color(255, 214, 120, 255);

/** 关键牌/弃牌河的锚点: 容器 + 容器内局部坐标(由 Main 提供, 特效不认识牌桌内部) */
export interface HuFxAnchor {
    container: Node;
    local: Vec3;
    /** 锚点处牌的显示尺寸(画"定格金环"用; 缺省就只闪光不画环) */
    w?: number;
    h?: number;
    /** 容器自身旋转角(左右家的牌河/手牌是竖躺的, 副本飞行要沿它转正) */
    angle?: number;
}

/** Main 注入的取锚点回调 —— 特效只拿坐标, 不碰牌桌的任何内部结构 */
export interface HuFxHooks {
    anchorOf(seat: number, tile: Tile | null): HuFxAnchor | null;
    /**
     * 和牌的"来路"锚点(仅吃胡/抢杠会问; 自摸不问 —— 牌本来就在手里)。
     * 吃胡 = 牌河被取走的那一格; 抢杠 = 补杠者的副露区。返回 null = 不做飞行。
     */
    originOf(winner: WinnerResult): HuFxAnchor | null;
}

/**
 * 胡牌特效(只剩一拍: 和牌归位), 2026-10-18
 *
 * 【为什么存在】原来 `_endGame` 在同一帧里连做: 顶部小字 toast → 三家手牌整体翻面 →
 * 结算卡片直接 active=true —— 玩家的感受是"啪一下卡片糊在脸上", 而且玩家从没"看见"
 * 那张和牌是从哪来的。本组件只补上这一段过渡, 播完立刻把结算面板交回来
 * (面板自己上滑入场 + 自带遮罩)。
 *
 * 【曾经删过什么】(2026-10-18 用户拍板) 全桌压暗淡入、"吃胡/自摸"大字宣告 + 震动、
 * 摘要行「你 3 番 · +12 分」三拍都删了 —— 结论信息由结算面板负责,
 * 特效只在亮桌面上讲清楚"哪张牌胡了"。
 *
 * 【实现约定】(与 DrawModeUI._showAnnounce 同一套纪律)
 *  - 只用 tween 改 位置/缩放/UIOpacity, **不逐帧画 Graphics**;
 *  - 所有节点在 play()(节点已 active)时才创建/补画 —— 原生平台"隐藏期画的
 *    Graphics 上不了屏"是本项目踩过多次的坑;
 *  - **不引用牌桌的任何节点**: 锚点由 Main 通过 `HuFxHooks.anchorOf` 给
 *    (容器 + 局部坐标), 这里用 toWorld/toLocal 换算到本节点坐标。
 *    这样 `onReveal` 阶段的 `_applyLayout`/`_rebuildTiles` 重建牌节点也打不断特效;
 *  - 中途重开/返回主页面必须 `abort()`(挂在 Main._clearTable 里), 否则半路的补间会
 *    留下一张卡在飞行途中的副本。
 */
@ccclass('HuEffect')
export class HuEffect extends Component {
    private _halfH = 472;
    private _playing = false;
    private _onDone: (() => void) | null = null;
    private _hooks: HuFxHooks | null = null;
    /** 吞点击的背景层(不画东西: 特效期间不许误点牌桌, 也没有"跳过") */
    private _blocker: Node | null = null;

    get playing(): boolean { return this._playing; }

    /** 告知可见区半高(由 Main._applyLayout 调用); 本组件已无需要重排的节点 */
    fit(halfH: number): void {
        this._halfH = halfH;
    }

    /**
     * 播放胡牌特效, 结束时回调 onDone(由 Main 在那里弹出结算面板)
     *
     * AI 胡且玩家没份时自动切成"收着演"(闪光更短、金环更细) —— 输的时候轰得太热闹不舒服。
     */
    play(data: SettlementData, hooks: HuFxHooks, onDone: () => void): void {
        this.abort();               // 防重入: 上一场还没播完又来一场(理论到不了)
        this._hooks = hooks;
        this._onDone = onDone;
        this._playing = true;
        this.node.active = true;
        this._ensureNodes();        // 节点已 active, 此时创建/补画 Graphics 才上得了屏(原生)

        const subdued = data.kind === 'hu' && !data.winners.some(w => w.seat === 0);
        const draw = data.kind === 'draw';
        // 流局没有任何"归位"可播, 立刻交棒; 胡牌则等"落位 + 闪光收束 + 留一眼"
        const tDone = draw ? DRAW_T_DONE : T_DONE;

        // ---- 唯一的一拍: 和牌归位(飞行) + 关键牌定格金环 ----
        // 全程在亮桌面上演(已删除全桌压暗): 那张带金边的牌才看得清; 吃胡/抢杠的副本从
        // "来路"(牌河被取走的那格 / 补杠者副露区)飞向手牌落位, 落位即销毁(真牌已在
        // 手里)并金环定格 —— 宣告那一帧的"凭空消失/凭空出现"就有了来路。
        // 自摸: 牌本来就在手里(自带金标), 不飞, 只在 T_TILE 时刻给一次金环。
        // 流局没有关键牌: 整个金环/飞行段都被 data.kind === 'hu' 挡住。
        if (data.kind === 'hu') {
            for (const w of data.winners) {
                const dest = this._anchorOf(w.seat, w.winTile);
                if (!dest) continue;
                const origin = (!w.isSelfDraw && w.fromSeat >= 0)
                    ? (this._hooks?.originOf?.(w) ?? null)
                    : null;
                if (origin) {
                    this._flyCopy(origin, dest, w.winTile!, subdued);
                    this.scheduleOnce(() => this._showRing(dest, subdued), T_LAND);
                } else {
                    this.scheduleOnce(() => this._showRing(dest, subdued), T_TILE);
                }
            }
        }

        // ---- 交棒: 结算面板自己带遮罩和全部结论信息(已被删掉的三拍都由它接管) ----
        this.scheduleOnce(() => this._finish(), tDone);
    }

    /** 中途取消(重开/返回主页面): 停补间、复位透明度、不再交棒 */
    abort(): void {
        if (!this._playing && !this.node.active) return;
        this._playing = false;
        this._onDone = null;
        this.unscheduleAllCallbacks();
        stopTweensDeep(this.node);
        this.node.active = false;
    }

    // ==================== 内部 ====================

    private _finish(): void {
        this._playing = false;
        // 交给结算面板接管(它自带遮罩与全部结论文本), 本节点退场但不销毁
        this.node.active = false;
        const cb = this._onDone;
        this._onDone = null;
        cb?.();
    }

    /** 幂等建层 + 补画(原生平台"隐藏期画的 Graphics 上不了屏") */
    private _ensureNodes(): void {
        // 根节点必须有 UITransform: _flyCopy/_showRing 的坐标要经
        // toWorld → toLocal(本节点) 换算 —— 没有它 toLocal 会静默退回世界坐标,
        // 副本/金环/闪光全被画到屏幕外(真机表现为"看不到过渡, 大字突然弹出")。
        if (!this.node.getComponent(UITransform)) {
            this.node.addComponent(UITransform).setContentSize(MASK_SIZE, MASK_SIZE);
        }
        // 刚 active 的节点世界矩阵可能是脏的, 先刷一遍再换算(同一帧内 play 时尤其如此)
        this.node.updateWorldTransform();
        // 吞点击的背景层(不画任何东西 —— 全桌压暗那三拍已删除, 遮罩交给结算面板)
        if (!this._blocker) {
            const blk = new Node('Blocker');
            blk.parent = this.node;
            blk.addComponent(UITransform).setContentSize(MASK_SIZE, MASK_SIZE);
            // 吞掉触摸: 特效期间不许误点牌桌(也没有"跳过" —— 产品决定不加)
            blk.on(Node.EventType.TOUCH_START, () => { /* 故意吞掉 */ }, blk);
            this._blocker = blk;
        }
    }

    private _anchorOf(seat: number, tile: Tile | null): HuFxAnchor | null {
        return this._hooks?.anchorOf(seat, tile) ?? null;
    }

    /** 把"容器局部坐标"换算到本节点的局部坐标 */
    private _toHere(a: HuFxAnchor): Vec3 {
        return toLocal(this.node, toWorld(a.container, a.local));
    }

    /** 定格金环: 套在关键牌上停 0.9s 再淡出 —— "就是这张" */
    private _showRing(anchor: HuFxAnchor, subdued: boolean): void {
        const p = this._toHere(anchor);
        const w = (anchor.w ?? 84) + 14;
        const h = (anchor.h ?? 112) + 14;
        const ring = new Node('HuRing');
        ring.parent = this.node;
        ring.setPosition(p.x, p.y, 0);
        ring.addComponent(UITransform).setContentSize(w, h);
        const g = ring.addComponent(Graphics);
        g.strokeColor = C_GOLD;
        g.lineWidth = subdued ? 4 : 6;
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.stroke();
        const op = ensureOpacity(ring);
        op.opacity = 0;
        ring.setScale(1.18, 1.18, 1);
        tween(op).to(0.14, { opacity: subdued ? 190 : 240 })
            .to(RING_LIFE - 0.14, { opacity: 0 }).start();
        tween(ring).to(RING_LIFE, { scale: v3(1, 1, 1) }, { easing: 'quadOut' })
            .call(() => ring.destroy())
            .start();
        flashBurst(this.node, p.x, p.y, Math.max(60, w * 0.8), Math.max(60, h * 0.8),
            subdued ? FLASH_SUB_DUR : FLASH_DUR);
    }

    /**
     * 第 0 拍: 和牌副本从"来路"飞向赢家手牌落位。
     *
     * 为什么用副本: 规则层在宣告的同一帧就把牌从牌河挪进了手牌(牌河/手牌都已重建),
     * 原节点抓不到 —— 而整条链路又在一个渲染帧内跑完, 玩家从没"看见"牌河那张消失,
     * 所以在落位处补一只真牌面副本飞过去, 观感就是连续的。落位即销毁(真牌已在手里)。
     */
    private _flyCopy(origin: HuFxAnchor, dest: HuFxAnchor, tile: Tile, subdued: boolean): void {
        const start = this._toHere(origin);
        const end = this._toHere(dest);
        const w = dest.w ?? 64;
        const h = dest.h ?? 86;
        // 真牌面: 与牌桌同一套工厂 + TileView(素材图 1:1 铺满)
        const copy = createTileNode(w, h, false);
        copy.parent = this.node;
        copy.setPosition(start.x, start.y, 0);
        setTileBgColor(copy, tile.suit, false);
        const view = copy.addComponent(TileView);
        view.setData(tile, -1);
        // 金边框: 挂在副本上一起飞 —— 无论牌面素材是否加载出来,
        // "一张带金边的牌从输家飞向赢家"这个主体都看得清(用户就是靠它认领这段动画的)
        const border = new Node('FlyBorder');
        border.parent = copy;
        const bw = w + 16;
        const bh = h + 16;
        border.addComponent(UITransform).setContentSize(bw, bh);
        const bg = border.addComponent(Graphics);
        bg.strokeColor = C_GOLD;
        bg.lineWidth = subdued ? 4 : 6;
        bg.roundRect(-bw / 2, -bh / 2, bw, bh, 14);
        bg.stroke();
        // 起点大 1.25 倍(比"落位"更显眼), 落位时收到实际尺寸
        copy.setScale(1.25, 1.25, 1);
        copy.angle = origin.angle ?? origin.container.angle;
        const op = ensureOpacity(copy);
        op.opacity = 255;
        tween(copy)
            .to(T_FLY_DUR, { position: new Vec3(end.x, end.y, 0) }, { easing: 'quadOut' })
            .call(() => {
                // 角度/缩放那条补间可能还在跑, 先停再销毁(对已销毁节点补间会刷警告)
                stopTweensDeep(copy);
                copy.destroy();
                flashBurst(this.node, end.x, end.y,
                    Math.max(80, bw), Math.max(80, bh), subdued ? 0.42 : 0.6);
            })
            .start();
        // 缩放/转正略早于落位收束(与 flyToSlot 同一套手感: 85% 处到位, 留一点缓冲)
        tween(copy)
            .to(T_FLY_DUR * 0.85, {
                scale: v3(1, 1, 1),
                angle: dest.angle ?? dest.container.angle,
            }, { easing: 'quadOut' })
            .start();
        // 起点残影: 在牌河末格留一个渐渐消失的金框, 说明"牌是从这里被拿走的"
        const ghost = new Node('FlyGhost');
        ghost.parent = this.node;
        ghost.setPosition(start.x, start.y, 0);
        ghost.addComponent(UITransform).setContentSize(bw, bh);
        const gg = ghost.addComponent(Graphics);
        gg.strokeColor = C_GOLD;
        gg.lineWidth = 3;
        gg.roundRect(-bw / 2, -bh / 2, bw, bh, 14);
        gg.stroke();
        ghost.angle = copy.angle;
        const gop = ensureOpacity(ghost);
        gop.opacity = 170;
        tween(gop).to(0.5, { opacity: 0 }).start();
        tween(ghost).to(0.5, { scale: v3(0.8, 0.8, 1) }).call(() => ghost.destroy()).start();
    }
}
