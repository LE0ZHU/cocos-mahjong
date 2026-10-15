import { _decorator, Component, Node, Color, Label, Graphics, UITransform } from 'cc';
import {
    createLabelNode, createButtonNode, bindSafeClick, repaintButtons,
    createTileNode, setTileBgColor, ButtonStyle,
} from './UIFactory';
import { TileView } from './TileView';
import { Tile } from '../core/Tile';
import { FanItem, SeatResult, SettlementData } from '../core/HuScore';

const { ccclass } = _decorator;

// ==================== 结算面板布局 ====================
// 卡片宽度固定(内容坐标横向永远放得下, 内容 x 恒为 ±840), 高度随可见区自适应。
//
// 为什么要自适应高度: Main 把牌桌内容按"宽度铺满"缩放(_gameRoot.scale = 设计宽 / 1680),
// 因此内容坐标系里的可见高度 = 1680 / 屏幕宽高比:
//   16:9(1920×1080)→945   19.5:9(2340×1080)→775   20:9→756   21:9→720   竖屏 2600~4200
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
const GAP_TITLE = 6;
const H_SUBTITLE = 28;
const GAP_SUBTITLE = 8;
const H_FAN = 130;       // 番型块(标题行 + 芯片区; 合计分数放在标题行右侧)
const GAP_FAN = 18;
const H_DIVIDER = 30;    // "四家手牌" 小标题(与分隔线同一行, 不叠高度)
const GAP_DIVIDER = 16;
const H_ROW = 66;        // 一行手牌(牌高 49 + 上下留白)
const ROW_GAP = 8;
const GAP_BUTTON = 12;
const H_BUTTON = 58;

// ---- 行内尺寸(行节点居中于卡片, 局部坐标) ----
const ROW_W = CARD_W - 80;
const ROW_HALF = ROW_W / 2;
/** 座位名牌宽 / 中心 x */
const NAME_W = 160;
const NAME_CX = -ROW_HALF + 92;
/** 手牌起点 x / 手牌与副露的间隔 */
const HAND_TILES_X = -ROW_HALF + 180;
const HAND_TILE_W = 36;  // 比牌桌小, 但足够看清牌面花纹
const MELD_TILE_W = 26;  // 副露略小, 一眼分得清
const MELD_GAP = 16;
/** 右侧分数列中心 x */
const SCORE_CX = ROW_HALF - 100;

// ---- 番型芯片 ----
const CHIP_H = 30;
const CHIP_PITCH = 34;

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

/** 番型色阶: 番数越高颜色越暖 */
function fanColor(fan: number): Color {
    if (fan <= 0) return new Color(178, 188, 178, 255);
    if (fan <= 2) return new Color(132, 206, 152, 255);
    if (fan <= 4) return new Color(126, 192, 230, 255);
    if (fan <= 6) return new Color(244, 192, 100, 255);
    return new Color(236, 134, 90, 255);
}

/**
 * 结算面板 - 牌局结束(胡牌或流局)时弹出
 *
 * 自上而下:
 *  - 标题(你胡了!/一炮多响/流局) + 来源说明(自摸 / 谁点炮)
 *  - 赢家番型块: "谁胡了什么牌" + "共 N 番 · X 分" 一行, 下面一排番型芯片
 *  - "四家手牌" 小标题 + 同高度的分隔线
 *  - 四家各一行: 座位名(带"听"标记) + 手牌(和的那张金边高亮) + 副露 + 本局得失 / 累计
 *  - 再来一局 / 返回主页面
 */
@ccclass('SettlementPanel')
export class SettlementPanel extends Component {
    /** 点击"再来一局" */
    onRestart: (() => void) | null = null;
    /** 点击"返回主页面" */
    onBack: (() => void) | null = null;

    private _card: Node | null = null;
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
        this._card?.setScale(k, k, 1);
        // 原生平台: 按钮底框按"显示时补画"处理一次(与牌桌按钮同一套约定)
        this.scheduleOnce(() => repaintButtons(this._card), 0);
    }

    /** 隐藏面板(遮罩一起隐藏, 不留半透明黑幕) */
    hide(): void {
        this._isOpen = false;
        this._data = null;
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
            + H_FAN + GAP_FAN + H_DIVIDER + GAP_DIVIDER + rowsH + GAP_BUTTON + H_BUTTON;
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
        y -= rowsH + GAP_BUTTON;
        const btnY = y - H_BUTTON / 2;

        return { h, scale, titleY, subtitleY, fanCY, fanH: H_FAN, headerY, rowsTopY, rowH: H_ROW, btnY };
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
            this._label(card, data.subtitle, 25, TEXT_SUB, CARD_W - 120, L.subtitleY);
        }

        // 番型区(流局没有番型, 提示"本局不计分")
        if (data.winners.length > 0) this._buildFanArea(card, data);
        else this._label(card, '本局无人胡牌, 不计分', 26, TEXT_MUTED, 900, L.fanCY);

        // "四家手牌" 小标题 + 同高度的分隔线(同一行, 不叠高度)
        this._label(card, '四家手牌', 24, TEXT_SUB, 180, L.headerY, -CARD_W / 2 + 96, true);
        this._divider(card, L.headerY, -CARD_W / 2 + 196, CARD_W / 2 - 40);

        // 四家手牌
        for (let i = 0; i < data.seats.length; i++) {
            const seat = data.seats[i];
            const winTile = seat.isWinner
                ? (data.winners.find(w => w.seat === seat.seat)?.winTile ?? null)
                : null;
            this._buildSeatRow(card, seat, winTile, L.rowsTopY - i * (L.rowH + ROW_GAP));
        }

        this._buildButtons(card);
    }

    /** 赢家番型块: 每家一块(通常一家, 一炮多响时多家并排) */
    private _buildFanArea(card: Node, data: SettlementData): void {
        const L = this._layout;
        const winners = data.winners;
        const gap = 22;
        const avail = (CARD_W - 160) / winners.length - gap;

        let cursor = -(winners.length * this._fanBlockW(winners[0].hu.fans, avail) + (winners.length - 1) * gap) / 2;
        for (const w of winners) {
            const bw = this._fanBlockW(w.hu.fans, avail);
            const block = new Node(`Fan_${w.seat}`);
            block.parent = card;
            block.addComponent(UITransform).setContentSize(bw, L.fanH);
            const bg = block.addComponent(Graphics);
            bg.fillColor = WINNER_BG;
            bg.roundRect(-bw / 2, -L.fanH / 2, bw, L.fanH, 14);
            bg.fill();
            bg.strokeColor = WINNER_EDGE;
            bg.lineWidth = 2;
            bg.roundRect(-bw / 2, -L.fanH / 2, bw, L.fanH, 14);
            bg.stroke();
            block.setPosition(cursor + bw / 2, L.fanCY, 0);
            cursor += bw + gap;

            // 标题行: 左侧"谁胡了什么牌", 右侧"共 N 番 · X 分"
            const half = bw / 2;
            this._label(block, `${w.name} · ${w.isSelfDraw ? '自摸' : '胡'} ${w.winTile ? w.winTile.displayText : ''}`,
                25, TEXT_TITLE, half - 150, L.fanH / 2 - 26, -half + 26, true);
            const cap = w.hu.capped ? ' 封顶' : '';
            this._label(block, `共 ${w.hu.totalFan} 番${cap} · ${w.hu.points} 分`,
                26, GAIN, half - 26, L.fanH / 2 - 26, half - 150);

            // 番型芯片: 在标题行下方的空带里逐行居中, 放不下自动换行
            const bandTop = L.fanH / 2 - 46;
            const bandBottom = -L.fanH / 2 + 12;
            for (const c of this._layoutFans(w.hu.fans, bw - 28, bandTop, bandBottom)) {
                const node = this._fanChip(c.item);
                node.parent = block;
                node.setPosition(c.x, c.y, 0);
            }
        }
    }

    /** 番型块宽度: 至少放得下"谁胡了什么牌 + 合计N番X分"这一行, 再按芯片总宽自适应 */
    private _fanBlockW(fans: FanItem[], avail: number): number {
        return Math.min(avail, Math.max(400, this._fansWidth(fans) + 56));
    }

    /** 单个番型芯片的宽度 */
    private _fanChipWidth(item: FanItem): number {
        const text = item.fan > 0 ? `${item.name} ${item.fan}番` : item.name;
        return Math.max(78, text.length * 22 + 36);
    }

    /** 一排番型芯片的总宽度 */
    private _fansWidth(fans: FanItem[]): number {
        let sum = 0;
        for (const f of fans) sum += this._fanChipWidth(f) + 8;
        return Math.max(0, sum - 8);
    }

    /**
     * 番型芯片排布: 超过 maxW 就换行, **每行各自居中**, 整组在给定纵向空带里垂直居中
     */
    private _layoutFans(
        fans: FanItem[],
        maxW: number,
        bandTop: number,
        bandBottom: number,
    ): { item: FanItem; x: number; y: number }[] {
        // 先分行
        const lines: FanItem[][] = [];
        let line: FanItem[] = [];
        let lineW = 0;
        for (const f of fans) {
            const w = this._fanChipWidth(f) + 8;
            if (line.length > 0 && lineW + w > maxW) {
                lines.push(line);
                line = [];
                lineW = 0;
            }
            line.push(f);
            lineW += w;
        }
        if (line.length > 0) lines.push(line);

        // 整组垂直居中于空带
        const blockH = lines.length * CHIP_PITCH - (CHIP_PITCH - CHIP_H);
        const top = (bandTop + bandBottom) / 2 + blockH / 2;
        const out: { item: FanItem; x: number; y: number }[] = [];
        for (let r = 0; r < lines.length; r++) {
            const rowY = top - CHIP_H / 2 - r * CHIP_PITCH;
            let totalW = 0;
            for (const f of lines[r]) totalW += this._fanChipWidth(f) + 8;
            totalW = Math.max(0, totalW - 8);
            let x = -totalW / 2;
            for (const f of lines[r]) {
                const w = this._fanChipWidth(f);
                out.push({ item: f, x: x + w / 2, y: rowY });
                x += w + 8;
            }
        }
        return out;
    }

    private _fanChip(item: FanItem): Node {
        const w = this._fanChipWidth(item);
        const node = new Node('Fan');
        node.addComponent(UITransform).setContentSize(w, CHIP_H);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(0, 0, 0, 105);
        g.roundRect(-w / 2, -CHIP_H / 2, w, CHIP_H, CHIP_H / 2);
        g.fill();
        g.strokeColor = fanColor(item.fan);
        g.lineWidth = 1.5;
        g.roundRect(-w / 2, -CHIP_H / 2, w, CHIP_H, CHIP_H / 2);
        g.stroke();
        const text = item.fan > 0 ? `${item.name} ${item.fan}番` : item.name;
        const label = createLabelNode(text, 21, fanColor(item.fan), w - 8, CHIP_H);
        label.parent = node;
        return node;
    }

    /** 一家的一行: 座位名 + 手牌 + 副露 + 得失分 */
    private _buildSeatRow(card: Node, seat: SeatResult, winTile: Tile | null, y: number): void {
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

        // 座位名(已宣告听牌的加"听"标记)
        const nameBg = new Node('NameBg');
        nameBg.parent = row;
        nameBg.addComponent(UITransform).setContentSize(NAME_W, 38);
        const ng = nameBg.addComponent(Graphics);
        ng.fillColor = seat.declaredTenpai ? new Color(186, 124, 40, 235) : new Color(0, 0, 0, 110);
        ng.roundRect(-NAME_W / 2, -19, NAME_W, 38, 9);
        ng.fill();
        ng.strokeColor = seat.declaredTenpai ? new Color(250, 214, 140, 255) : new Color(255, 255, 255, 26);
        ng.lineWidth = 1.5;
        ng.roundRect(-NAME_W / 2, -19, NAME_W, 38, 9);
        ng.stroke();
        nameBg.setPosition(NAME_CX, 0, 0);
        this._label(row, `${seat.name}${seat.declaredTenpai ? ' 听' : ''}`, 27,
            seat.isWinner ? TEXT_TITLE : TEXT_ROW, NAME_W - 10, 0, NAME_CX);

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

        // 右侧: 本局得失(大) + 累计(小)
        const deltaText = seat.delta > 0 ? `+${seat.delta}` : `${seat.delta}`;
        this._label(row, deltaText, 34, seat.delta > 0 ? GAIN : (seat.delta < 0 ? LOSS : TEXT_MUTED),
            190, 11, SCORE_CX);
        this._label(row, `累计 ${seat.total >= 0 ? '+' : ''}${seat.total}`, 22, TEXT_MUTED,
            190, -15, SCORE_CX);
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
        const h = w * 87 / 64;
        const node = createTileNode(w, h, false);
        node.parent = row;
        node.setPosition(x + w / 2, 0, 0);
        setTileBgColor(node, tile.suit, false);
        const view = node.addComponent(TileView);
        view.setData(tile, -1);
        if (highlight) {
            const ring = new Node('WinRing');
            ring.parent = node;
            ring.addComponent(UITransform).setContentSize(w, h);
            const g = ring.addComponent(Graphics);
            g.strokeColor = new Color(255, 206, 110, 220);
            g.lineWidth = 3;
            g.roundRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 5);
            g.stroke();
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
