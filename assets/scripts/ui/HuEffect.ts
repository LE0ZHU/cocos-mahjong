import { _decorator, Color, Component, Graphics, Label, Node, tween, UIOpacity, UITransform, Vec3, v3 } from 'cc';
import { ensureOpacity, flashBurst, stopTweensDeep, toLocal, toWorld } from './Anim';
import { createLabelNode, createTileNode, setTileBgColor } from './UIFactory';
import { TileView } from './TileView';
import { SettlementData, WinnerResult } from '../core/HuScore';
import { Tile } from '../core/Tile';
import { vibrateHu } from '../feedback/Haptics';

const { ccclass } = _decorator;

// ==================== 节奏(秒, 从 play() 起算) ====================
// **方案二 · 完全串行 / 零重叠**(2026-10-18 用户拍板):
// 每一拍(**含它的余韵**)整段播完, 再留"一眼"呼吸, 才进下一拍 ——
// 宁可节奏明显拖一点(面板从点胡起 ≈5.65s 就位), 也不让两件事同时在演。
// play() 在三家翻面播完之后才被 Main 调进来(HU_FX_REVEAL_TAIL = 1.15s 之前只播翻面)。
const T_FLY_DUR = 0.7;      // 第 1 拍: 副本起飞(play 一开始就飞, 亮桌面上看得清)
const T_LAND = 0.7;         // 落位 → 金环 + 闪光
/**
 * 金环寿命(方案二): 0.3s —— 落位后**一闪即收**, 明显短于闪光。
 * (旧做法 = T_DIM - T_LAND, 金环一直拖到压暗前一刻, 被判成"和压暗叠在一起"。)
 */
const RING_LIFE = 0.3;
const FLASH_DUR = 0.6;      // 闪光主体时长(flashBurst 内部还有 0.05 淡入)
const FLASH_SUB_DUR = 0.42; // 收着演的闪光更短
/** 闪光相对**落位**的收束时刻(0.6 + 0.05 淡入 = 0.65) */
const FLASH_LIFE = FLASH_DUR + 0.05;
/** 闪光收束 → 压暗之间留的一眼(亮桌面上把余韵看完再暗下来) */
const T_BEAT = 0.5;
/** 压暗完成后再停一眼才上大字(让"暗"先被看见, 大字不是追着压暗出来) */
const T_DIM_TAIL = 0.3;
const T_DIM = 1.85;         // 第 2 拍: 压暗开始 = 落位 0.7 + 闪光 0.65 + 留一眼 0.5
const T_DIM_IN = 0.3;       // 压暗淡入时长
const T_TILE = 0.7;         // 自摸(无飞行)的金环时刻(与吃胡落位同一时刻)
const T_BANNER = 2.45;      // 第 3 拍: 大字宣告 + 震动 = 压暗起 1.85 + 淡入 0.3 + 停一眼 0.3
const T_BANNER_IN = 0.42;
const T_SUMMARY = 3.45;     // 第 4 拍: 摘要行浮出(大字弹入 0.42 播完之后)
const T_DONE = 4.0;         // 交棒: 结算面板开始上滑(+0.5 上滑 ≈ 点胡起 5.65s 就位)
// ---- AI 胡"收着演"支线: 同样整体顺延 0.85s(输的时候被金色轰炸并不舒服, 但节奏要同款) ----
const SUB_T_TILE = 0.7;
const SUB_T_BANNER = 2.15;
const SUB_T_SUMMARY = 2.95;
const SUB_T_DONE = 3.4;
// ---- 流局: 没有飞行/闪光要等, 不必陪着拖 —— 但它自己的压暗要早于自己的大字 ----
const DRAW_T_DIM = 0.3;
const DRAW_T_BANNER = 1.0;
const DRAW_T_SUMMARY = 1.7;
const DRAW_T_DONE = 2.2;
/** 收着演: 大字缩到 0.72 倍 */
const SUB_SCALE = 0.72;

// ==================== 视觉 ====================
/** 压暗层的黑度(255 满): 玩家胡 / AI 胡(收着演) / 流局 */
const DIM_FULL = 115;
const DIM_SUB = 70;
const DIM_DRAW = 90;
/** 大字宣告: 主字 / 来源小字 / 盒子内边距与高度 */
const STAMP_FONT = 96;
const STAMP_SUB_FONT = 28;
const STAMP_PAD_X = 64;
const STAMP_H = 176;
/** 摘要行: 胶囊高 / 字号 / 左右内边距 */
const SUMMARY_H = 56;
const SUMMARY_FONT = 30;
const SUMMARY_PAD_X = 24;
/** 遮罩尺寸(与 SettlementPanel 同一招, 盖住整张牌桌) */
const MASK_SIZE = 6000;

/** 主题色: 自摸暖金 / 吃胡赤金 / 一炮多响橙 / 流局灰 */
const C_TSUMO = new Color(255, 202, 96, 255);
const C_RON = new Color(240, 122, 88, 255);
const C_MULTI = new Color(255, 158, 92, 255);
const C_DRAW = new Color(168, 174, 182, 255);
const C_GOLD = new Color(255, 214, 120, 255);
const C_TEXT_DIM = new Color(236, 228, 208, 226);

/** 中文按全宽、ASCII 按半宽估文本宽度(与 HintPanel/SettlementPanel 同一套土办法) */
function textWidth(text: string, font: number): number {
    let w = 0;
    for (const ch of text) w += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
    return w;
}

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

interface StampInfo {
    main: string;
    sub: string;
    color: Color;
}

/**
 * 胡牌特效(三拍: 定格 → 爆发 → 揭晓), 2026-10-18
 *
 * 【为什么存在】原来 `_endGame` 在同一帧里连做: 顶部小字 toast → 三家手牌整体翻面 →
 * 结算卡片直接 active=true —— 玩家的感受是"啪一下卡片糊在脸上"。
 * 本组件把"谁胡了"拆成 2.2s 的节奏, 播完再把结算面板交回来(面板自己上滑入场)。
 *
 * 【实现约定】(与 DrawModeUI._showAnnounce 同一套纪律)
 *  - 只用 tween 改 位置/缩放/UIOpacity, **不逐帧画 Graphics**;
 *  - 所有节点在 play()(节点已 active)时才创建/补画 —— 原生平台"隐藏期画的
 *    Graphics 上不了屏"是本项目踩过多次的坑;
 *  - **不引用牌桌的任何节点**: 锚点由 Main 通过 `HuFxHooks.anchorOf` 给
 *    (容器 + 局部坐标), 这里用 toWorld/toLocal 换算到本节点坐标。
 *    这样 `onReveal` 阶段的 `_applyLayout`/`_rebuildTiles` 重建牌节点也打不断特效;
 *  - 中途重开/返回主页面必须 `abort()`(挂在 Main._clearTable 里), 否则会留半黑屏。
 */
@ccclass('HuEffect')
export class HuEffect extends Component {
    private _halfH = 472;
    private _playing = false;
    private _onDone: (() => void) | null = null;
    private _hooks: HuFxHooks | null = null;
    private _data: SettlementData | null = null;
    /** 压暗层(吞掉点击: 特效期间不允许误点牌桌, 也没有跳过) */
    private _dim: Node | null = null;
    private _stamp: Node | null = null;
    private _stampMain: Label | null = null;
    private _stampSub: Label | null = null;
    private _summary: Node | null = null;
    private _summaryLabel: Label | null = null;

    get playing(): boolean { return this._playing; }

    /**
     * 告知可见区半高(由 Main._applyLayout 调用)
     * 播放中途转屏: 只挪位置不重建 —— 2.2s 的特效不值得为它重建一次 Graphics。
     */
    fit(halfH: number): void {
        this._halfH = halfH;
        if (this._playing) this._layoutNodes();
    }

    /**
     * 播放胡牌特效, 结束时回调 onDone(由 Main 在那里弹出结算面板)
     *
     * @param subdued true = 收着演(AI 胡, 玩家没份): 更暗/更小/更短
     */
    play(data: SettlementData, hooks: HuFxHooks, onDone: () => void): void {
        this.abort();               // 防重入: 上一场还没播完又来一场(理论到不了)
        this._data = data;
        this._hooks = hooks;
        this._onDone = onDone;
        this._playing = true;
        this.node.active = true;
        this._ensureNodes();        // 节点已 active, 此时创建/补画 Graphics 才上得了屏(原生)

        const subdued = data.kind === 'hu' && !data.winners.some(w => w.seat === 0);
        const draw = data.kind === 'draw';
        // 流局不等飞行/闪光(压暗早就该起), 玩家/AI 胡则等"闪光收束 + 留一眼"
        const tDim = draw ? DRAW_T_DIM : T_DIM;
        const info = this._stampInfo(data);
        // 流局没有"关键牌"这一拍: 整个金环/飞行段都被 data.kind === 'hu' 挡住
        const tBanner = draw ? DRAW_T_BANNER : (subdued ? SUB_T_BANNER : T_BANNER);
        const tSummary = draw ? DRAW_T_SUMMARY : (subdued ? SUB_T_SUMMARY : T_SUMMARY);
        const tDone = draw ? DRAW_T_DONE : (subdued ? SUB_T_DONE : T_DONE);
        const dim = draw ? DIM_DRAW : (subdued ? DIM_SUB : DIM_FULL);

        // ---- 第 1 拍: 和牌归位(飞行) + 关键牌定格金环 ----
        // **先飞牌再压暗**: 亮桌面上那张带金边的牌才看得清; 吃胡/抢杠的副本从
        // "来路"(牌河被取走的那格 / 补杠者副露区)飞向手牌落位, 落位即销毁(真牌已在
        // 手里)并金环定格 —— 宣告那一帧的"凭空消失/凭空出现"就有了来路。
        // 自摸: 牌本来就在手里(自带金标), 不飞, 与压暗同时定格。
        if (data.kind === 'hu') {
            const tRingStill = subdued ? SUB_T_TILE : T_TILE;
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
                    this.scheduleOnce(() => this._showRing(dest, subdued), tRingStill);
                }
            }
        }

        // ---- 第 2 拍: 压暗(飞完落定 + 闪光的余韵看完之后才开始) ----
        this.scheduleOnce(() => {
            const dimOp = ensureOpacity(this._dim!);
            dimOp.opacity = 0;
            tween(dimOp).to(T_DIM_IN, { opacity: dim }).start();
        }, tDim);

        // ---- 第 3 拍: 大字宣告 + 震动 ----
        this._stampMain!.string = info.main;
        this._stampSub!.string = info.sub;
        this._paintStamp(info.color, subdued);
        this.scheduleOnce(() => {
            vibrateHu();
            const op = ensureOpacity(this._stamp!);
            op.opacity = 0;
            const k = subdued ? SUB_SCALE : 1;
            this._stamp!.setScale(k * 1.45, k * 1.45, 1);
            tween(op).to(T_BANNER_IN * 0.4, { opacity: 255 }).start();
            tween(this._stamp!)
                .to(T_BANNER_IN, { scale: v3(k, k, 1) }, { easing: 'backOut' })
                .start();
        }, tBanner);

        // ---- 第 3 拍: 摘要行 ----
        this._summaryLabel!.string = this._summaryText(data);
        this._paintSummary(info.color, subdued);
        this._summary!.active = true;
        this.scheduleOnce(() => {
            const op = ensureOpacity(this._summary!);
            op.opacity = 0;
            this._summary!.setPosition(this._summary!.position.x, this._summary!.position.y - 18, 0);
            const target = this._summary!.position.clone();
            tween(op).to(0.22, { opacity: 255 }).start();
            tween(this._summary!).to(0.34, { position: target }, { easing: 'quadOut' }).start();
        }, tSummary);

        // ---- 交棒 ----
        this.scheduleOnce(() => this._finish(), tDone);
    }

    /** 中途取消(重开/返回主页面): 停补间、复位透明度、不再交棒 */
    abort(): void {
        if (!this._playing && !this.node.active) return;
        this._playing = false;
        this._onDone = null;
        this.unscheduleAllCallbacks();
        stopTweensDeep(this.node);
        if (this._dim) ensureOpacity(this._dim).opacity = 0;
        if (this._stamp) ensureOpacity(this._stamp).opacity = 0;
        if (this._summary) ensureOpacity(this._summary).opacity = 0;
        this.node.active = false;
    }

    // ==================== 内部 ====================

    private _finish(): void {
        this._playing = false;
        // 压暗层交给结算面板接管(它的遮罩更黑), 本节点退场但不销毁
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
        if (!this._dim) {
            const dim = new Node('Dim');
            dim.parent = this.node;
            dim.addComponent(UITransform).setContentSize(MASK_SIZE, MASK_SIZE);
            dim.addComponent(Graphics);
            // 吞掉触摸: 特效期间不许误点牌桌(也没有"跳过" —— 产品决定不加)
            dim.on(Node.EventType.TOUCH_START, () => { /* 故意吞掉 */ }, dim);
            this._dim = dim;
        }
        {
            const g = this._dim!.getComponent(Graphics)!;
            g.clear();
            g.fillColor = new Color(0, 0, 0, 255);
            g.rect(-MASK_SIZE / 2, -MASK_SIZE / 2, MASK_SIZE, MASK_SIZE);
            g.fill();
        }
        if (!this._stamp) {
            const stamp = new Node('Stamp');
            stamp.parent = this.node;
            stamp.addComponent(UITransform);
            stamp.addComponent(Graphics);
            const main = createLabelNode('', STAMP_FONT, Color.WHITE, 900, STAMP_FONT + 14);
            main.parent = stamp;
            this._stampMain = main.getComponent(Label)!;
            const sub = createLabelNode('', STAMP_SUB_FONT, C_TEXT_DIM, 900, STAMP_SUB_FONT + 10);
            sub.parent = stamp;
            this._stampSub = sub.getComponent(Label)!;
            this._stamp = stamp;
        }
        if (!this._summary) {
            const sum = new Node('Summary');
            sum.parent = this.node;
            sum.addComponent(UITransform);
            sum.addComponent(Graphics);
            const lbl = createLabelNode('', SUMMARY_FONT, Color.WHITE, 1200, SUMMARY_H);
            lbl.parent = sum;
            this._summaryLabel = lbl.getComponent(Label)!;
            this._summary = sum;
        }
        this._layoutNodes();
    }

    /** 按可见半高摆放: 大字略偏上(避开牌河), 摘要在其下方 */
    private _layoutNodes(): void {
        const stampY = this._halfH * 0.1;
        this._stamp?.setPosition(0, stampY, 0);
        this._summary?.setPosition(0, stampY - STAMP_H / 2 - 54, 0);
    }

    /** 大字内容: 自摸/吃胡/一炮多响/流局 + 来源小字(数据里已有现成的文案) */
    private _stampInfo(data: SettlementData): StampInfo {
        if (data.kind === 'draw') return { main: '流局', sub: '', color: C_DRAW };
        if (data.winners.length > 1) {
            return { main: '一炮多响', sub: data.subtitle, color: C_MULTI };
        }
        const w = data.winners[0];
        // 自摸的大字就是结论; AI 自摸时来源小字补上人名(不然不知道是谁在自摸)
        if (w.isSelfDraw) return { main: '自摸', sub: w.seat === 0 ? '' : w.name, color: C_TSUMO };
        return { main: '吃胡', sub: data.subtitle, color: C_RON };
    }

    private _paintStamp(color: Color, subdued: boolean): void {
        const stamp = this._stamp!;
        const main = this._stampMain!;
        const sub = this._stampSub!;
        main.color = color;
        const w = Math.max(textWidth(main.string, STAMP_FONT), textWidth(sub.string, STAMP_SUB_FONT)) + STAMP_PAD_X * 2;
        const h = STAMP_H;
        stamp.getComponent(UITransform)!.setContentSize(w, h);
        const g = stamp.getComponent(Graphics)!;
        g.clear();
        // 底: 近黑的墨色圆角 + 双层描边(外彩内白), "印章"感靠它, 不依赖字体
        g.fillColor = new Color(16, 13, 9, 208);
        g.roundRect(-w / 2, -h / 2, w, h, 26);
        g.fill();
        g.strokeColor = color;
        g.lineWidth = subdued ? 4 : 6;
        g.roundRect(-w / 2, -h / 2, w, h, 26);
        g.stroke();
        g.strokeColor = new Color(255, 255, 255, 70);
        g.lineWidth = 2;
        g.roundRect(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18, 18);
        g.stroke();
        const mainH = STAMP_FONT + 14;
        main.node.setPosition(0, sub.string ? h * 0.5 - mainH * 0.5 - 18 : 0, 0);
        sub.node.setPosition(0, -h * 0.5 + (STAMP_SUB_FONT + 10) * 0.5 + 16, 0);
        sub.node.active = !!sub.string;
    }

    private _summaryText(data: SettlementData): string {
        if (data.kind === 'draw') return data.subtitle;
        const fans = data.winners.map(w => w.hu.totalFan);
        const fan = Math.max(...fans);
        const mine = data.seats.find(s => s.seat === 0);
        const delta = mine ? mine.delta : 0;
        const sign = delta > 0 ? '+' : '';
        // 谁胡的必须写出来: AI 胡时玩家看不到大字上下文, 只有番数会莫名其妙
        const who = data.winners.length > 1
            ? `${data.winners.length}家`
            : (data.winners[0].seat === 0 ? '你' : data.winners[0].name);
        return `${who} ${fan} 番 · ${sign}${delta} 分`;
    }

    private _paintSummary(color: Color, subdued: boolean): void {
        const sum = this._summary!;
        const lbl = this._summaryLabel!;
        lbl.color = subdued ? C_TEXT_DIM : Color.WHITE;
        const w = textWidth(lbl.string, SUMMARY_FONT) + SUMMARY_PAD_X * 2;
        sum.getComponent(UITransform)!.setContentSize(w, SUMMARY_H);
        const g = sum.getComponent(Graphics)!;
        g.clear();
        g.fillColor = new Color(12, 10, 8, 188);
        g.roundRect(-w / 2, -SUMMARY_H / 2, w, SUMMARY_H, SUMMARY_H / 2);
        g.fill();
        g.strokeColor = new Color(color.r, color.g, color.b, 150);
        g.lineWidth = 2;
        g.roundRect(-w / 2, -SUMMARY_H / 2, w, SUMMARY_H, SUMMARY_H / 2);
        g.stroke();
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
