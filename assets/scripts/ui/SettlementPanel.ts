import { _decorator, Component, Node, Color, Label, Graphics, UITransform, Vec3, tween } from 'cc';
import { ensureOpacity } from './Anim';
import {
    createLabelNode, createButtonNode, bindSafeClick, repaintButtons,
    createTileNode, setTileBgColor, tileFaceSize, ButtonStyle,
} from './UIFactory';
import { TileView, tileRadius } from './TileView';
import { Tile } from '../core/Tile';
import { FanItem, SeatResult, SettlementData, WinnerResult } from '../core/HuScore';
import { HuChecker } from '../core/HuChecker';
import { HintAdvisor } from '../game/HintAdvisor';
import { careerText } from '../game/CareerStats';
import { CAREER } from '../game/CareerStore';

const { ccclass } = _decorator;

/** 番型块里的一枚芯片: 和的那张牌 + 各番型, 统一按"文字 + 颜色"排版 */
interface ChipItem {
    label: string;
    color: Color;
}

// ==================== 结算面板布局 ====================
// 卡片宽度固定(内容坐标横向永远放得下, 内容 x 恒为 ±840), 高度随可见区自适应。
//
// 为什么要自适应高度: Main 把牌桌内容按"宽度铺满"缩放(_gameRoot.scale = 设计宽 / 1680),
// 因此内容坐标系里的**可见半高** = 840 / 屏幕宽高比:
//   16:9→472  19.5:9→387  21:9→360  竖屏→1867+   (全高是这些数字的两倍)
// 纵向各段按"实际可用高度"自上而下顺排, 任何屏幕比例下都完整可见且互不重叠。
const CARD_W = 1420;
/** 遮罩尺寸(比屏幕大得多, 盖住整张牌桌) */
const MASK_SIZE = 6000;
/** 可见区上下各留出的余量(内容坐标) */
const EDGE_MARGIN = 10;
/** 卡片纵向留白的取值范围 */
const PAD_MIN = 14;
const PAD_MAX = 40;

// ---- 纵向节奏: 每段高度 + 段后间距 ----
const H_TITLE = 54;
const GAP_TITLE = 12;
const H_SUBTITLE = 28;
const GAP_SUBTITLE = 10;
const H_FAN = 130;       // 番型块(标题行 + 芯片区; 合计分数放在标题行右侧)
const GAP_FAN = 18;
const H_DIVIDER = 30;    // "四家手牌" 小标题(与分隔线同一行, 不叠高度)
const GAP_DIVIDER = 16;
const H_ROW = 66;        // 一行手牌(牌高 49 + 上下留白)
const ROW_GAP = 8;
/** 四家手牌下面那行"生涯战绩"(跨会话累积, 打完一局正好看一眼) */
const H_CAREER = 26;
const GAP_CAREER = 8;
const CAREER_FONT = 20;
const GAP_BUTTON = 12;
const H_BUTTON = 58;

// ---- 行内尺寸(行节点居中于卡片, 局部坐标) ----
const ROW_W = CARD_W - 80;
const ROW_HALF = ROW_W / 2;
/** 四家手牌行的左右边界 —— "四家手牌"小标题与分隔线都对齐到这里, 不贴着卡片边框 */
const ROW_LEFT = -ROW_HALF;
const ROW_RIGHT = ROW_HALF;
/** "四家手牌" 小标题 */
const HEADER_TEXT = '四家手牌';
const HEADER_FONT = 26;
/** 小标题与分隔线之间的空隙 */
const HEADER_LINE_GAP = 24;
/** 座位名牌宽 / 中心 x / 字号 */
const NAME_W = 140;
const NAME_CX = -ROW_HALF + 86;
const NAME_FONT = 30;
/** 手牌起点 x / 手牌与副露的间隔 */
const HAND_TILES_X = -ROW_HALF + 180;
const HAND_TILE_W = 36;  // 比牌桌小, 但足够看清牌面花纹
const MELD_TILE_W = 26;  // 副露略小, 一眼分得清
const MELD_GAP = 16;
/** 右侧分数列中心 x / 字号 / 纵向位置(两者错开, 字形不重叠) */
const SCORE_CX = ROW_HALF - 110;
const DELTA_FONT = 32;
const DELTA_Y = 16;
const TOTAL_FONT = 20;
const TOTAL_Y = -17;
/**
 * 流局时右侧改显示"听什么"(此时"本局得失"恒为 0, 没有信息量)
 *
 * 宽度给 200: 左边界到 460, 而手牌 + 满副露最多右展到 ~446, 刚好不撞。
 */
const WAIT_FONT = 20;
const WAIT_W = 200;
/** 本局 AI 台词(挂在"四家手牌"那一行的最右侧) */
const SPEECH_FONT = 24;
const SPEECH_TEXT = new Color(255, 226, 158, 255);

// ---- 番型块 ----
/** 块最小宽(要放得下"谁胡了什么牌" + "N番 · X分"这一行) */
const FAN_BLOCK_MIN_W = 470;
/** 标题行里"合计分数"文字的宽度与内边距 */
const FAN_TOTAL_W = 230;
const FAN_PAD_X = 28;
const FAN_HEAD_GAP = 16;
/** 芯片 */
const CHIP_H = 30;
const CHIP_PITCH = 34;
/** 和的那张牌用的芯片配色 */
const CHIP_WIN_COLOR = new Color(250, 214, 140, 255);

/** 依可见高度算出的面板纵向排布(全部由 _computeLayout 算出, 别处不再写死 y) */
interface PanelLayout {
    /** 卡片排版高度(节点再按 scale 兜底缩放) */
    h: number;
    /** 极端比例(可见高不足内容高)才 < 1; 常见手机/桌面都是 1, 字号保持原样 */
    scale: number;
    titleY: number;
    subtitleY: number;
    fanCY: number;
    fanH: number;
    /** "四家手牌" 小标题所在行的中心 y */
    headerY: number;
    rowsTopY: number;
    rowH: number;
    /** 生涯战绩行的中心 y */
    careerY: number;
    btnY: number;
}

// ==================== 配色(与牌桌同一套暖金/玉绿) ====================
const CARD_BG = new Color(16, 32, 27, 242);
const CARD_BORDER = new Color(214, 176, 96, 225);
const TEXT_TITLE = new Color(255, 240, 190, 255);
const TEXT_SUB = new Color(200, 216, 198, 255);
const TEXT_MUTED = new Color(170, 184, 170, 255);
const TEXT_ROW = new Color(240, 242, 228, 255);
const GAIN = new Color(250, 208, 118, 255);
const LOSS = new Color(238, 138, 124, 255);
const WINNER_BG = new Color(38, 84, 60, 242);
const WINNER_EDGE = new Color(244, 200, 108, 250);
const ROW_BG = new Color(26, 46, 38, 225);
const DIVIDER_LINE = new Color(214, 176, 96, 105);

/**
 * 番型色阶: 番数越高颜色越暖
 *
 * 导出给菜单「玩法说明」页复用 —— 番数配色只能有一套定义,
 * 两处各写一份必然出现"结算里 4 番是蓝、说明页里是绿"这类漂移。
 */
export function fanColor(fan: number): Color {
    if (fan <= 0) return new Color(178, 188, 178, 255);
    if (fan <= 2) return new Color(132, 206, 152, 255);
    if (fan <= 4) return new Color(126, 192, 230, 255);
    if (fan <= 6) return new Color(244, 192, 100, 255);
    return new Color(236, 134, 90, 255);
}

/**
 * 文本宽度估算: CJK/全角按字号, 数字/空格/中点按半角
 *
 * 用来给"同一行放两个 Label"或自适应宽度的地方(小标题、芯片)算所需宽度 ——
 * 直接凭感觉给宽度会让 Label.Overflow.SHRINK 把字压扁。
 */
function textWidth(text: string, font: number): number {
    let w = 0;
    for (const ch of text) {
        w += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
    }
    return w;
}

/**
 * 结算面板 - 牌局结束(胡牌或流局)时弹出
 *
 * 自上而下:
 *  - 标题(你胡了!/一炮多响/流局) + 来源说明(自摸 / 谁点炮)
 *  - 赢家番型块: "谁胡了什么牌" + "共 N 番 · X 分" 一行, 下面一排番型芯片
 *  - "四家手牌" 小标题 + 同高度的分隔线(本局 AI 台词挂在这一行最右侧)
 *  - 四家各一行: 座位名(带"听"标记) + 手牌(和的那张金边高亮) + 副露 + 本局得失 / 累计
 *  - 生涯战绩(跨会话累积: 总局数 / 胡牌次数 / 最高番 / 最长连庄)
 *  - 再来一局 / 返回主页面
 */
@ccclass('SettlementPanel')
export class SettlementPanel extends Component {
    /** 点击"再来一局" */
    onRestart: (() => void) | null = null;
    /** 点击"返回主页面" */
    onBack: (() => void) | null = null;

    private _card: Node | null = null;
    /** 全屏遮罩(胡牌特效交棒后由它接管压暗; 入场时淡入) */
    private _mask: Node | null = null;
    private _isOpen = false;
    /** 可见区半高(内容坐标), 由 Main 在 _applyLayout 里告知 */
    private _halfH = 0;
    /** 上一次结算数据(屏幕尺寸变化时需要按新布局重建) */
    private _data: SettlementData | null = null;
    /** 初始按 16:9 排一次, 等 Main 送来真实可见高度后重排 */
    private _layout: PanelLayout = SettlementPanel._computeLayout(472);

    onLoad(): void {
        this._buildSkeleton();
        this.hide();
    }

    /**
     * 告知可见区半高并重排(由 Main._applyLayout 调用)
     *
     * 面板正在打开时高度变了就直接按新布局重建内容,
     * 避免转屏/改窗口大小后卡片超出屏幕。
     */
    fit(halfH: number): void {
        const changed = Math.abs(halfH - this._halfH) > 0.5;
        this._halfH = halfH;
        this._layout = SettlementPanel._computeLayout(halfH);
        const card = this._card;
        if (!card) return;
        card.getComponent(UITransform)?.setContentSize(CARD_W, this._layout.h);
        // 兜底缩放只作用于卡片(遮罩是兄弟节点, 不受影响)
        const k = this._layout.scale;
        card.setScale(k, k, 1);
        if (changed && this._isOpen && this._data) this._rebuild(this._data);
    }

    /** 显示结算面板(每次调用按最新数据重建内容) */
    show(data: SettlementData): void {
        this._data = data;
        this._rebuild(data);
        this.node.active = true;
        this._isOpen = true;
        // show 可能早于第一次 fit(理论上 Main 先排版), 这里补一次兜底缩放
        const k = this._layout.scale;
        const card = this._card;
        if (card) {
            card.setScale(k, k, 1);
            // 入场(2026-10-18 胡牌特效交棒): 卡片从下方 70 滑到位 + 遮罩淡入,
            // 不再"啪一下"糊在脸上。hide() 里会把透明度/位移复位。
            const targetY = card.position.y;
            const cardOp = ensureOpacity(card);
            cardOp.opacity = 0;
            card.setPosition(card.position.x, targetY - 70, 0);
            tween(cardOp).to(0.28, { opacity: 255 }).start();
            tween(card)
                .to(0.5, { position: new Vec3(card.position.x, targetY, 0) }, { easing: 'backOut' })
                .start();
        }
        if (this._mask) {
            const maskOp = ensureOpacity(this._mask);
            maskOp.opacity = 0;
            tween(maskOp).to(0.34, { opacity: 255 }).start();
        }
        // 原生平台: 按钮底框按"显示时补画"处理一次(与牌桌按钮同一套约定)
        this.scheduleOnce(() => repaintButtons(this._card), 0);
    }

    /** 隐藏面板(遮罩一起隐藏, 不留半透明黑幕) */
    hide(): void {
        this._isOpen = false;
        this._data = null;
        // 复位入场动画的残留: 下一局 show 时必须从"不透明 + 原位"开始
        if (this._card) {
            ensureOpacity(this._card).opacity = 255;
            this._card.setPosition(this._card.position.x, 0, 0);
        }
        if (this._mask) ensureOpacity(this._mask).opacity = 255;
        this.node.active = false;
    }

    get isOpen(): boolean { return this._isOpen; }

    // ==================== 纵向排布 ====================

    /**
     * 按可见半高算出卡片高度与各段 y
     *
     * 做法: 游标 y 始终表示"上一段的底边", 从卡顶往下走; **每段先取中心, 再连同
     * 高度与段后间距一起下移**, 于是下一段必然从本段底边开始 —— 结构上不可能重叠。
     * (早期版本把按钮中心写成 `y + H/2`, 直接压在最后一行手牌上。)
     * 剩余空间当上下留白(有上下限), 卡片高度 = 内容高 + 留白×2, 不超过可用高度。
     */
    private static _computeLayout(halfH: number): PanelLayout {
        const availH = Math.max(300, halfH * 2 - EDGE_MARGIN * 2);
        const rowsH = H_ROW * 4 + ROW_GAP * 3;
        const contentH = H_TITLE + GAP_TITLE + H_SUBTITLE + GAP_SUBTITLE
            + H_FAN + GAP_FAN + H_DIVIDER + GAP_DIVIDER + rowsH
            + GAP_CAREER + H_CAREER + GAP_BUTTON + H_BUTTON;
        const pad = Math.max(PAD_MIN, Math.min(PAD_MAX, (availH - contentH) / 2));
        const h = contentH + pad * 2;
        const scale = Math.min(1, availH / h);

        let y = h / 2 - pad;
        const titleY = y - H_TITLE / 2;
        y -= H_TITLE + GAP_TITLE;
        const subtitleY = y - H_SUBTITLE / 2;
        y -= H_SUBTITLE + GAP_SUBTITLE;
        const fanCY = y - H_FAN / 2;
        y -= H_FAN + GAP_FAN;
        const headerY = y - H_DIVIDER / 2;
        y -= H_DIVIDER + GAP_DIVIDER;
        const rowsTopY = y - H_ROW / 2;
        y -= rowsH + GAP_CAREER;
        const careerY = y - H_CAREER / 2;
        y -= H_CAREER + GAP_BUTTON;
        const btnY = y - H_BUTTON / 2;

        return {
            h, scale, titleY, subtitleY, fanCY, fanH: H_FAN,
            headerY, rowsTopY, rowH: H_ROW, careerY, btnY,
        };
    }

    // ==================== 骨架 ====================

    private _buildSkeleton(): void {
        const mask = new Node('Dim');
        mask.parent = this.node;
        mask.addComponent(UITransform).setContentSize(MASK_SIZE, MASK_SIZE);
        const g = mask.addComponent(Graphics);
        g.fillColor = new Color(0, 0, 0, 178);
        g.rect(-MASK_SIZE / 2, -MASK_SIZE / 2, MASK_SIZE, MASK_SIZE);
        g.fill();
        this._mask = mask;

        const card = new Node('Card');
        card.parent = this.node;
        card.addComponent(UITransform).setContentSize(CARD_W, this._layout.h);
        card.addComponent(Graphics);
        this._card = card;
    }

    private _rebuild(data: SettlementData): void {
        const card = this._card;
        if (!card) return;
        for (const child of [...card.children]) child.destroy();
        this._buildContent(card, data);
    }

    private _paintCard(g: Graphics, h: number): void {
        g.clear();
        const r = 34;
        // 落地投影
        g.fillColor = new Color(0, 0, 0, 120);
        g.roundRect(-CARD_W / 2 + 8, -h / 2 - 8, CARD_W, h, r);
        g.fill();
        // 面板底
        g.fillColor = CARD_BG;
        g.roundRect(-CARD_W / 2, -h / 2, CARD_W, h, r);
        g.fill();
        // 内侧柔光边
        g.strokeColor = new Color(255, 255, 255, 18);
        g.lineWidth = 6;
        g.roundRect(-CARD_W / 2 + 10, -h / 2 + 10, CARD_W - 20, h - 20, r - 6);
        g.stroke();
        // 外框
        g.strokeColor = CARD_BORDER;
        g.lineWidth = 3;
        g.roundRect(-CARD_W / 2, -h / 2, CARD_W, h, r);
        g.stroke();
    }

    // ==================== 内容 ====================

    private _buildContent(card: Node, data: SettlementData): void {
        const L = this._layout;
        this._paintCard(card.getComponent(Graphics)!, L.h);

        // 标题 + 来源说明
        this._label(card, data.title, 52, TEXT_TITLE, CARD_W - 120, L.titleY);
        if (data.subtitle) {
            this._label(card, data.subtitle, 28, TEXT_SUB, CARD_W - 120, L.subtitleY);
        }

        // 番型区(流局没有番型, 提示"本局不计分")
        if (data.winners.length > 0) this._buildFanArea(card, data);
        else this._label(card, '本局无人胡牌, 不计分', 26, TEXT_MUTED, 900, L.fanCY);

        // "四家手牌" 小标题 + 同高度的分隔线(同一行, 不叠高度)
        // 左对齐的 Label 文字从"节点 x - 宽度/2"开始, 所以 x 要加上半个宽度, 文字起点才落在行块左边界
        const headerW = Math.ceil(textWidth(HEADER_TEXT, HEADER_FONT)) + 8;
        this._label(card, HEADER_TEXT, HEADER_FONT, TEXT_TITLE, headerW, L.headerY,
            ROW_LEFT + headerW / 2, true);
        // 本局 AI 的台词挂在这一行最右侧(分隔线让开它的宽度), 不用再占一行高度
        const speech = data.speech ?? '';
        const speechW = speech ? Math.ceil(textWidth(speech, SPEECH_FONT)) + 12 : 0;
        const divFrom = ROW_LEFT + headerW + HEADER_LINE_GAP;
        const divTo = Math.max(divFrom + 60, ROW_RIGHT - speechW);
        this._divider(card, L.headerY, divFrom, divTo);
        if (speech) {
            this._label(card, speech, SPEECH_FONT, SPEECH_TEXT, speechW, L.headerY,
                ROW_RIGHT - speechW / 2);
        }

        // 四家手牌
        // 流局时右侧那格"本局得失"必然全是 0, 换成"听什么" —— 流局后玩家最想知道
        // 的恰恰是"我到底听没听、他们听什么", 而这时四家手牌本来就已经亮出来了。
        const showWaiting = data.kind === 'draw';
        for (let i = 0; i < data.seats.length; i++) {
            const seat = data.seats[i];
            const winTile = seat.isWinner
                ? (data.winners.find(w => w.seat === seat.seat)?.winTile ?? null)
                : null;
            this._buildSeatRow(card, seat, winTile, L.rowsTopY - i * (L.rowH + ROW_GAP), showWaiting);
        }

        // 生涯战绩(跨会话累积): 打完一局正是想看一眼"总共打到哪了"的时候
        this._label(card, careerText(CAREER.career), CAREER_FONT, TEXT_MUTED, CARD_W - 200, L.careerY);

        this._buildButtons(card);
    }

    /** 赢家番型块: 每家一块(通常一家, 一炮多响时多家并排) */
    private _buildFanArea(card: Node, data: SettlementData): void {
        const L = this._layout;
        const winners = data.winners;
        const multi = winners.length > 1;
        const gap = 22;
        const avail = (CARD_W - 160) / winners.length - gap;

        let cursor = -(winners.length * this._fanBlockW(winners[0], avail) + (winners.length - 1) * gap) / 2;
        for (const w of winners) {
            const bw = this._fanBlockW(w, avail);
            const half = bw / 2;
            const block = new Node(`Fan_${w.seat}`);
            block.parent = card;
            block.addComponent(UITransform).setContentSize(bw, L.fanH);
            const bg = block.addComponent(Graphics);
            bg.fillColor = WINNER_BG;
            bg.roundRect(-half, -L.fanH / 2, bw, L.fanH, 14);
            bg.fill();
            bg.strokeColor = WINNER_EDGE;
            bg.lineWidth = 2;
            bg.roundRect(-half, -L.fanH / 2, bw, L.fanH, 14);
            bg.stroke();
            block.setPosition(cursor + bw / 2, L.fanCY, 0);
            cursor += bw + gap;

            const headY = L.fanH / 2 - 27;

            // 标题行右侧: "N 番 · X 分"(右边界贴内边距), 宽度随块宽收缩保证左侧放得下
            const totalW = Math.max(150, Math.min(FAN_TOTAL_W, bw * 0.44));
            this._label(block, `${w.hu.totalFan} 番 · ${w.hu.points} 分`, 28, GAIN,
                totalW, headY, half - FAN_PAD_X - totalW / 2);

            // 标题行左侧: "谁胡了什么"。多赢家并排时块窄, 只留名字(和的牌在芯片行里)
            const headLeft = -half + FAN_PAD_X;
            const headMaxW = (half - FAN_PAD_X - totalW - FAN_HEAD_GAP) - headLeft;
            const headText = multi ? w.name : `${w.name} · ${w.isSelfDraw ? '自摸' : '胡'}`;
            this._label(block, headText, 26, TEXT_TITLE, Math.max(60, headMaxW), headY,
                headLeft + Math.max(60, headMaxW) / 2, true);

            // 芯片行: 先放"和的那张牌"(金色), 再列番型, 每行居中
            const chips: ChipItem[] = [];
            if (w.winTile) chips.push({ label: w.winTile.displayText, color: CHIP_WIN_COLOR });
            for (const f of w.hu.fans) chips.push({ label: this._fanLabel(f), color: fanColor(f.fan) });

            const bandTop = L.fanH / 2 - 48;
            const bandBottom = -L.fanH / 2 + 12;
            for (const c of this._layoutChips(chips, bw - 28, bandTop, bandBottom)) {
                const node = this._chip(c.item);
                node.parent = block;
                node.setPosition(c.x, c.y, 0);
            }
        }
    }

    /** 番型块的芯片文字 */
    private _fanLabel(item: FanItem): string {
        return item.fan > 0 ? `${item.name} ${item.fan}番` : item.name;
    }

    /**
     * 番型块宽度: 下限 FAN_BLOCK_MIN_W, 再按芯片总宽与标题行实际需求一起放大
     *
     * 标题行需要 = 左内边距 + "谁胡了什么牌" + 间隙 + "N番·X分" + 右内边距
     */
    private _fanBlockW(w: WinnerResult, avail: number): number {
        const chipsW = this._chipsWidth(this._winnerChips(w));
        const headW = w.name.length * 26 + 26;          // 多赢家时只显示名字
        const headNeed = w.name.length * 4 * 26;          // 单赢家显示"名字 · 自摸/胡"
        const titleNeed = FAN_PAD_X * 2 + Math.max(headW, headNeed) + FAN_HEAD_GAP + FAN_TOTAL_W;
        return Math.min(avail, Math.max(FAN_BLOCK_MIN_W, Math.max(chipsW + 56, titleNeed)));
    }

    /** 该赢家的芯片列表(和的牌 + 番型) */
    private _winnerChips(w: WinnerResult): ChipItem[] {
        const chips: ChipItem[] = [];
        if (w.winTile) chips.push({ label: w.winTile.displayText, color: CHIP_WIN_COLOR });
        for (const f of w.hu.fans) chips.push({ label: this._fanLabel(f), color: fanColor(f.fan) });
        return chips;
    }

    /** 单个芯片的宽度 */
    private _chipWidth(item: ChipItem): number {
        return Math.max(76, Math.ceil(textWidth(item.label, 21)) + 34);
    }

    /** 一排芯片的总宽度 */
    private _chipsWidth(items: ChipItem[]): number {
        let sum = 0;
        for (const c of items) sum += this._chipWidth(c) + 8;
        return Math.max(0, sum - 8);
    }

    /**
     * 芯片排布: 超过 maxW 就换行, **每行各自居中**, 整组在给定纵向空带里垂直居中
     */
    private _layoutChips(
        items: ChipItem[],
        maxW: number,
        bandTop: number,
        bandBottom: number,
    ): { item: ChipItem; x: number; y: number }[] {
        // 先分行
        const lines: ChipItem[][] = [];
        let line: ChipItem[] = [];
        let lineW = 0;
        for (const c of items) {
            const w = this._chipWidth(c) + 8;
            if (line.length > 0 && lineW + w > maxW) {
                lines.push(line);
                line = [];
                lineW = 0;
            }
            line.push(c);
            lineW += w;
        }
        if (line.length > 0) lines.push(line);

        // 整组垂直居中于空带
        const blockH = lines.length * CHIP_PITCH - (CHIP_PITCH - CHIP_H);
        const top = (bandTop + bandBottom) / 2 + blockH / 2;
        const out: { item: ChipItem; x: number; y: number }[] = [];
        for (let r = 0; r < lines.length; r++) {
            const rowY = top - CHIP_H / 2 - r * CHIP_PITCH;
            let totalW = 0;
            for (const c of lines[r]) totalW += this._chipWidth(c) + 8;
            totalW = Math.max(0, totalW - 8);
            let x = -totalW / 2;
            for (const c of lines[r]) {
                const w = this._chipWidth(c);
                out.push({ item: c, x: x + w / 2, y: rowY });
                x += w + 8;
            }
        }
        return out;
    }

    private _chip(item: ChipItem): Node {
        const w = this._chipWidth(item);
        const node = new Node('Chip');
        node.addComponent(UITransform).setContentSize(w, CHIP_H);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(0, 0, 0, 105);
        g.roundRect(-w / 2, -CHIP_H / 2, w, CHIP_H, CHIP_H / 2);
        g.fill();
        g.strokeColor = item.color;
        g.lineWidth = 1.5;
        g.roundRect(-w / 2, -CHIP_H / 2, w, CHIP_H, CHIP_H / 2);
        g.stroke();
        const label = createLabelNode(item.label, 21, item.color, w - 8, CHIP_H);
        label.parent = node;
        return node;
    }

    /**
     * 听牌文案, 超出右侧那格宽度时截断
     *
     * 【为什么必须截断】`createLabelNode` 用的是 `Label.Overflow.SHRINK` ——
     * 文本超宽不会有任何报错, 而是**把字号压小**直到塞进去。国士无双 / 七对这类
     * 多面听能列出十几个牌型, 直接丢给 Label 就会压成一行蚂蚁字(硬约束 4 的老坑)。
     * 这里按"少列几个 + 等"收, 宁可少说也不能看不清。
     */
    private _fitWaitingText(waiting: Tile[]): string {
        let text = HintAdvisor.waitingText(waiting);
        if (textWidth(`听 ${text}`, WAIT_FONT) <= WAIT_W) return text;
        for (let n = waiting.length - 1; n >= 1; n--) {
            text = `${HintAdvisor.waitingText(waiting.slice(0, n))} 等`;
            if (textWidth(`听 ${text}`, WAIT_FONT) <= WAIT_W) return text;
        }
        return text;
    }

    /** 一家的一行: 座位名 + 手牌 + 副露 + 得失分(流局时换成听牌情况) */
    private _buildSeatRow(
        card: Node,
        seat: SeatResult,
        winTile: Tile | null,
        y: number,
        showWaiting: boolean,
    ): void {
        // 流局才去枚举听牌: 胡牌局里赢家手牌是 14 张, 再补一张枚举会算出错误结果
        const waiting = showWaiting ? HuChecker.isTenpai(seat.hand, seat.melds) : [];
        const tenpai = showWaiting ? waiting.length > 0 : seat.declaredTenpai;
        const rowH = this._layout.rowH;
        const row = new Node(`Row_${seat.seat}`);
        row.parent = card;
        row.addComponent(UITransform).setContentSize(ROW_W, rowH);
        const g = row.addComponent(Graphics);
        g.fillColor = seat.isWinner ? WINNER_BG : ROW_BG;
        g.roundRect(-ROW_HALF, -rowH / 2, ROW_W, rowH, 12);
        g.fill();
        if (seat.isWinner) {
            g.strokeColor = WINNER_EDGE;
            g.lineWidth = 2;
            g.roundRect(-ROW_HALF, -rowH / 2, ROW_W, rowH, 12);
            g.stroke();
            // 赢家行左侧一条金色竖条, 一眼扫到谁胡了
            g.fillColor = WINNER_EDGE;
            g.roundRect(-ROW_HALF + 2, -rowH / 2 + 9, 5, rowH - 18, 2.5);
            g.fill();
        }
        row.setPosition(0, y, 0);

        // 座位名(听牌加"听"标记: 流局看实际是否听牌, 其余局看是否宣告过)
        const nameBg = new Node('NameBg');
        nameBg.parent = row;
        nameBg.addComponent(UITransform).setContentSize(NAME_W, 38);
        const ng = nameBg.addComponent(Graphics);
        ng.fillColor = tenpai ? new Color(186, 124, 40, 235) : new Color(0, 0, 0, 110);
        ng.roundRect(-NAME_W / 2, -19, NAME_W, 38, 9);
        ng.fill();
        ng.strokeColor = tenpai ? new Color(250, 214, 140, 255) : new Color(255, 255, 255, 26);
        ng.lineWidth = 1.5;
        ng.roundRect(-NAME_W / 2, -19, NAME_W, 38, 9);
        ng.stroke();
        nameBg.setPosition(NAME_CX, 0, 0);
        this._label(row, `${seat.name}${tenpai ? ' 听' : ''}`, NAME_FONT,
            seat.isWinner ? TEXT_TITLE : TEXT_ROW, NAME_W - 8, 0, NAME_CX);

        // 手牌(和的那张金边高亮)
        let x = HAND_TILES_X;
        for (const tile of seat.hand) {
            x = this._placeTile(row, tile, x, winTile === tile ? tile : undefined, HAND_TILE_W);
        }
        // 副露: 牌略小, 与手牌之间留一段空隙
        if (seat.melds.length > 0) {
            x += MELD_GAP;
            for (const meld of seat.melds) {
                for (const tile of meld.tiles) {
                    x = this._placeTile(row, tile, x, undefined, MELD_TILE_W);
                }
            }
        }

        // 右侧: 得失分(大, 偏上) + 累计(小, 偏下), 两者纵向错开不重叠
        // 流局时上格换成"听 X" —— 这一局的得失恒为 0, 让位给真正有信息量的东西
        if (showWaiting) {
            const has = waiting.length > 0;
            this._label(row, has ? `听 ${this._fitWaitingText(waiting)}` : '未听', WAIT_FONT,
                has ? GAIN : TEXT_MUTED, WAIT_W, DELTA_Y, SCORE_CX);
        } else {
            const deltaText = seat.delta > 0 ? `+${seat.delta}` : `${seat.delta}`;
            this._label(row, deltaText, DELTA_FONT, seat.delta > 0 ? GAIN : (seat.delta < 0 ? LOSS : TEXT_MUTED),
                200, DELTA_Y, SCORE_CX);
        }
        this._label(row, `累计 ${seat.total >= 0 ? '+' : ''}${seat.total}`, TOTAL_FONT, TEXT_MUTED,
            200, TOTAL_Y, SCORE_CX);
    }

    /** 在一行里放一张小牌,返回下一张牌的 x */
    private _placeTile(
        row: Node,
        tile: Tile,
        x: number,
        /** 需要高亮的那张(如和的那张);undefined 表示不高亮 */
        highlight: Tile | undefined,
        w: number,
    ): number {
        const h = w * 4 / 3;   // 与局内麻将一致: 宽高比 3:4
        const node = createTileNode(w, h, false);
        node.parent = row;
        node.setPosition(x + w / 2, 0, 0);
        setTileBgColor(node, tile.suit, false);
        const view = node.addComponent(TileView);
        view.setData(tile, -1);
        if (highlight) {
            // 胡牌那张牌的金边: 圆角与描边位置跟局内高光框同一套
            // (tileRadius + 线宽一半的外扩)。这个圈画在牌身**之下**,
            // 路径压在牌边上时内侧会被牌面盖掉, 圆角取别的值就会在角上露出缝。
            const ring = new Node('WinRing');
            ring.parent = node;
            // 牌面比格位小 TILE_GAP, 金边要贴着**牌面**画(内层沿用 w/h,
            // 与其余四处"贴牌边画圈"的代码保持同一形状, 测试也按这个形状复核)
            const face = tileFaceSize(w, h);
            {
                const w = face.w;
                const h = face.h;
                ring.addComponent(UITransform).setContentSize(w, h);
                const g = ring.addComponent(Graphics);
                const r = tileRadius(w, h);
                g.strokeColor = new Color(255, 206, 110, 220);
                g.lineWidth = 3;
                g.roundRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, r + 1);
                g.stroke();
            }
            ring.setSiblingIndex(0);
        }
        return x + w;
    }

    private _buildButtons(card: Node): void {
        const color = new Color(196, 132, 44, 255);
        const again = createButtonNode('再来一局', 250, H_BUTTON, color, ButtonStyle.Pill);
        again.parent = card;
        again.setPosition(-150, this._layout.btnY, 0);
        bindSafeClick(again, () => this.onRestart?.(), this);

        const back = createButtonNode('返回主页面', 250, H_BUTTON, color, ButtonStyle.Pill);
        back.parent = card;
        back.setPosition(150, this._layout.btnY, 0);
        bindSafeClick(back, () => this.onBack?.(), this);
    }

    // ==================== 小工具 ====================

    /** 水平细线(与"四家手牌"小标题同高, 往右延伸) */
    private _divider(card: Node, y: number, fromX: number, toX: number): void {
        const node = new Node('Divider');
        node.parent = card;
        node.addComponent(UITransform).setContentSize(toX - fromX, 1);
        const g = node.addComponent(Graphics);
        g.strokeColor = DIVIDER_LINE;
        g.lineWidth = 2;
        g.moveTo(0, 0);
        g.lineTo(toX - fromX, 0);
        g.stroke();
        node.setPosition(fromX, y, 0);
    }

    private _label(
        parent: Node,
        text: string,
        size: number,
        color: Color,
        width: number,
        y: number,
        x = 0,
        alignLeft = false,
    ): Label {
        const node = createLabelNode(text, size, color, width, 0, alignLeft);
        node.parent = parent;
        node.setPosition(x, y, 0);
        return node.getComponent(Label)!;
    }
}
