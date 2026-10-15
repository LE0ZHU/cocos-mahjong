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
// 卡片宽度固定(内容坐标横向永远放得下), 高度随可见区自适应。
//
// 为什么要自适应: Main 把牌桌内容按"宽度铺满"缩放(_gameRoot.scale = 设计宽 / 1680),
// 因此内容坐标系里的可见高度 = 1680 / 屏幕宽高比:
//   16:9 (1920×1080) → 945      19.5:9 (2340×1080) → 775
//   20:9  (2400×1080) → 756      21:9   (2520×1080) → 720
//   竖屏时反而上千(4200+)
// 纵向各段按"实际可用高度"从卡片顶部往下顺排, 而不是写死一个高度 ——
// 否则手机横屏会把面板上下顶出屏幕(早期版本写死 940, 只在恰好 16:9 时成立)。
const CARD_W = 1180;
/** 遮罩尺寸(比屏幕大得多, 盖住整张牌桌) */
const MASK_SIZE = 6000;

/** 可见区上下各留出的余量(内容坐标) */
const EDGE_MARGIN = 10;
/** 卡片纵向留白的取值范围 */
const PAD_MIN = 14;
const PAD_MAX = 44;

/** 纵向各段的固定高度(标题/副标题/番型区/分隔线/四家手牌/按钮) */
const H_TITLE = 60;
const H_SUBTITLE = 34;
const H_FAN = 150;
const H_DIVIDER = 52;
const H_ROW = 64;
const H_BUTTON = 64;
/** 四行之间的额外间距 */
const ROW_GAP = 8;

/** 行内手牌宽度 / 副露牌宽度(副露略小, 一眼分得清) */
const HAND_TILE_W = 25;
const MELD_TILE_W = 22;
/** 行内手牌起点 x / 右侧分数 x(均为行节点局部坐标, 行节点居中于卡片) */
const ROW_TILES_X = -452;
const ROW_SCORE_X = CARD_W / 2 - 40 - 96;

/** 依可见高度算出的面板纵向排布 */
interface PanelLayout {
    /** 卡片高度 */
    h: number;
    /**
     * 兜底缩放: 只在可见高度连"内容最小高度"都装不下时才 < 1
     * (例如 32:9 超宽屏, 可见内容高只有 470)。常见手机/桌面都是 1。
     */
    scale: number;
    titleY: number;
    subtitleY: number;
    /** 番型区中心 y / 高度 */
    fanCY: number;
    fanH: number;
    dividerY: number;
    /** 第一行中心 y */
    rowsTopY: number;
    rowH: number;
    btnY: number;
}

// ==================== 配色(与牌桌同一套暖金/玉绿) ====================
const CARD_BG = new Color(18, 34, 28, 238);
const CARD_BORDER = new Color(214, 176, 96, 220);
const TEXT_TITLE = new Color(255, 238, 186, 255);
const TEXT_SUB = new Color(206, 220, 200, 255);
const TEXT_MUTED = new Color(158, 172, 158, 255);
const TEXT_ROW = new Color(238, 240, 226, 255);
const GAIN = new Color(244, 200, 108, 255);
const LOSS = new Color(226, 128, 116, 255);
const WINNER_BG = new Color(38, 78, 58, 235);
const WINNER_EDGE = new Color(244, 200, 108, 255);
const ROW_BG = new Color(10, 22, 18, 200);

/** 番型色阶: 番数越高颜色越暖 */
function fanColor(fan: number): Color {
    if (fan <= 0) return new Color(150, 160, 150, 255);
    if (fan <= 2) return new Color(126, 196, 148, 255);
    if (fan <= 4) return new Color(120, 186, 222, 255);
    if (fan <= 6) return new Color(240, 186, 96, 255);
    return new Color(232, 130, 88, 255);
}

/**
 * 结算面板 - 牌局结束(胡牌或流局)时弹出
 *
 * 展示内容:
 *  - 标题(你胡了!/一炮多响/流局) + 来源说明(自摸 / 谁点炮)
 *  - 每家赢家的番型列表: 名称 + 番数, 末尾给"共 N 番 = X 分"
 *  - 四家手牌对比: 座位名(带"听"标记) + 手牌(和的那张金边高亮) + 副露 + 本局得失分 / 累计分
 *  - 操作: 再来一局 / 返回主页面
 *
 * 面板挂在牌桌根节点最上层, 半透明遮罩压住牌桌, 四家手牌在这里一次看全。
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
     * 做法: 各段高度固定 → 累加出内容总高 contentH → 剩余空间当上下留白(有上下限)
     * → 卡片"排版高度" layoutH = contentH + 留白×2。
     * layoutH 装得下就不缩放(常见手机/桌面, 字号保持原样);
     * 只有极端比例(超宽屏可见高不足 contentH)才整体等比缩, 缩放按 layoutH 算,
     * 保证缩放后内容仍然居中且完整可见。
     */
    private static _computeLayout(halfH: number): PanelLayout {
        const availH = Math.max(300, halfH * 2 - EDGE_MARGIN * 2);
        const rowsH = H_ROW * 4 + ROW_GAP * 3;
        const contentH = H_TITLE + H_SUBTITLE + H_FAN + H_DIVIDER + rowsH + H_BUTTON;
        const pad = Math.max(PAD_MIN, Math.min(PAD_MAX, (availH - contentH) / 2));
        const h = contentH + pad * 2;
        const scale = Math.min(1, availH / h);

        // 自卡片顶部往下顺排, 逐段扣高度, 保证任何高度下各段都不重叠
        let y = h / 2 - pad;
        const titleY = y - H_TITLE / 2;
        y -= H_TITLE;
        const subtitleY = y - H_SUBTITLE / 2;
        y -= H_SUBTITLE;
        const fanCY = y - H_FAN / 2;
        y -= H_FAN;
        const dividerY = y - 26;
        y -= H_DIVIDER;
        const rowsTopY = y - H_ROW / 2;
        y -= rowsH;
        const btnY = y + H_BUTTON / 2;

        return { h, scale, titleY, subtitleY, fanCY, fanH: H_FAN, dividerY, rowsTopY, rowH: H_ROW, btnY };
    }

    // ==================== 骨架 ====================

    private _buildSkeleton(): void {
        const mask = new Node('Dim');
        mask.parent = this.node;
        mask.addComponent(UITransform).setContentSize(MASK_SIZE, MASK_SIZE);
        const g = mask.addComponent(Graphics);
        g.fillColor = new Color(0, 0, 0, 175);
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
        g.fillColor = new Color(0, 0, 0, 110);
        g.roundRect(-CARD_W / 2 + 8, -h / 2 - 8, CARD_W, h, r);
        g.fill();
        // 面板底
        g.fillColor = CARD_BG;
        g.roundRect(-CARD_W / 2, -h / 2, CARD_W, h, r);
        g.fill();
        // 内侧柔光边
        g.strokeColor = new Color(255, 255, 255, 16);
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
        this._label(card, data.title, 54, TEXT_TITLE, CARD_W - 120, L.titleY);
        if (data.subtitle) {
            this._label(card, data.subtitle, 26, TEXT_SUB, CARD_W - 120, L.subtitleY);
        }

        // 番型列表(流局没有番型区, 提示"本局不计分")
        if (data.winners.length > 0) {
            this._buildFanArea(card, data);
        } else {
            this._label(card, '本局无人胡牌, 不计分', 26, TEXT_MUTED, 900, L.fanCY);
        }

        // 分隔线 + 四家手牌
        this._divider(card, L.dividerY);
        this._label(card, '四家手牌', 24, TEXT_SUB, 200, L.dividerY - 34, -CARD_W / 2 + 96, true);
        for (let i = 0; i < data.seats.length; i++) {
            const seat = data.seats[i];
            const winTile = seat.isWinner
                ? (data.winners.find(w => w.seat === seat.seat)?.winTile ?? null)
                : null;
            this._buildSeatRow(card, seat, winTile, L.rowsTopY - i * (L.rowH + ROW_GAP));
        }

        this._buildButtons(card);
    }

    /** 赢家番型区: 每家一个块(通常一家, 一炮多响时多家并排) */
    private _buildFanArea(card: Node, data: SettlementData): void {
        const L = this._layout;
        const winners = data.winners;
        const gap = 24;
        const blockW = Math.min(380, (CARD_W - 160) / winners.length - gap);
        let cursor = -(winners.length * blockW + (winners.length - 1) * gap) / 2;

        for (const w of winners) {
            const block = new Node(`Fan_${w.seat}`);
            block.parent = card;
            block.addComponent(UITransform).setContentSize(blockW, L.fanH);
            const bg = block.addComponent(Graphics);
            bg.fillColor = WINNER_BG;
            bg.roundRect(-blockW / 2, -L.fanH / 2, blockW, L.fanH, 14);
            bg.fill();
            bg.strokeColor = WINNER_EDGE;
            bg.lineWidth = 2;
            bg.roundRect(-blockW / 2, -L.fanH / 2, blockW, L.fanH, 14);
            bg.stroke();
            block.setPosition(cursor + blockW / 2, L.fanCY, 0);
            cursor += blockW + gap;

            // 块内: 谁胡了什么牌(顶部)
            const head = `${w.name} · ${w.isSelfDraw ? '自摸' : '胡'} ${w.winTile ? w.winTile.displayText : ''}`;
            this._label(block, head, 24, TEXT_TITLE, blockW - 24, L.fanH / 2 - 24);

            // 番型芯片(横向排, 放不下自动换行)
            let row = 0;
            for (const chip of this._layoutFans(w.hu.fans, blockW - 28)) {
                const node = this._fanChip(chip.item);
                node.parent = block;
                node.setPosition(chip.x, L.fanH / 2 - 60 - row * 32, 0);
                if (chip.newRow) row++;
            }

            // 合计(底部)
            const cap = w.hu.capped ? ' (已封顶)' : '';
            this._label(
                block,
                `共 ${w.hu.totalFan} 番${cap} · ${w.hu.points} 分`,
                26, GAIN, blockW - 24, -L.fanH / 2 + 24,
            );
        }
    }

    /** 番型芯片按宽度换行排布(返回每个芯片的位置与是否开启新行) */
    private _layoutFans(
        fans: FanItem[],
        maxW: number,
    ): { item: FanItem; x: number; newRow: boolean }[] {
        const out: { item: FanItem; x: number; newRow: boolean }[] = [];
        let cursor = -maxW / 2;
        let isRowFirst = true;
        for (const item of fans) {
            const w = Math.max(72, item.name.length * 20 + 34);
            let newRow = false;
            if (!isRowFirst && cursor + w > maxW / 2) {
                newRow = true;
                isRowFirst = true;
                cursor = -maxW / 2;
            }
            out.push({ item, x: cursor + w / 2, newRow });
            cursor += w + 8;
            isRowFirst = false;
        }
        return out;
    }

    private _fanChip(item: FanItem): Node {
        const w = Math.max(72, item.name.length * 20 + 34);
        const h = 27;
        const node = new Node('Fan');
        node.addComponent(UITransform).setContentSize(w, h);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(0, 0, 0, 90);
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.fill();
        g.strokeColor = fanColor(item.fan);
        g.lineWidth = 1.5;
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.stroke();
        const text = item.fan > 0 ? `${item.name} ${item.fan}番` : item.name;
        const label = createLabelNode(text, 19, fanColor(item.fan), w - 8, h);
        label.parent = node;
        return node;
    }

    /** 一家的一行: 座位名 + 手牌 + 副露 + 得失分 */
    private _buildSeatRow(card: Node, seat: SeatResult, winTile: Tile | null, y: number): void {
        const L = this._layout;
        const rowW = CARD_W - 80;
        const row = new Node(`Row_${seat.seat}`);
        row.parent = card;
        row.addComponent(UITransform).setContentSize(rowW, L.rowH);
        const g = row.addComponent(Graphics);
        g.fillColor = seat.isWinner ? WINNER_BG : ROW_BG;
        g.roundRect(-rowW / 2, -L.rowH / 2, rowW, L.rowH, 12);
        g.fill();
        if (seat.isWinner) {
            g.strokeColor = WINNER_EDGE;
            g.lineWidth = 2;
            g.roundRect(-rowW / 2, -L.rowH / 2, rowW, L.rowH, 12);
            g.stroke();
        }
        row.setPosition(0, y, 0);

        // 座位名(已宣告听牌的加"听"标记)
        const nameBg = new Node('NameBg');
        nameBg.parent = row;
        nameBg.addComponent(UITransform).setContentSize(150, 34);
        const ng = nameBg.addComponent(Graphics);
        ng.fillColor = seat.declaredTenpai ? new Color(180, 120, 40, 220) : new Color(0, 0, 0, 90);
        ng.roundRect(-75, -17, 150, 34, 8);
        ng.fill();
        nameBg.setPosition(-rowW / 2 + 86, 0, 0);
        this._label(row, `${seat.name}${seat.declaredTenpai ? ' 听' : ''}`, 26,
            seat.isWinner ? TEXT_TITLE : TEXT_ROW, 146, 0, -rowW / 2 + 86);

        // 手牌(和的那张金边高亮)
        let x = ROW_TILES_X;
        for (const tile of seat.hand) {
            x = this._placeTile(row, tile, x, winTile === tile ? tile : undefined, HAND_TILE_W);
        }
        // 副露: 牌略小, 与手牌之间留一段空隙
        if (seat.melds.length > 0) {
            x += 14;
            for (const meld of seat.melds) {
                for (const tile of meld.tiles) {
                    x = this._placeTile(row, tile, x, undefined, MELD_TILE_W);
                }
            }
        }

        // 右侧: 本局得失 + 累计
        const deltaText = seat.delta > 0 ? `+${seat.delta}` : `${seat.delta}`;
        this._label(row, deltaText, 30, seat.delta > 0 ? GAIN : (seat.delta < 0 ? LOSS : TEXT_MUTED),
            170, 10, ROW_SCORE_X);
        this._label(row, `累计 ${seat.total >= 0 ? '+' : ''}${seat.total}`, 20, TEXT_MUTED,
            170, -14, ROW_SCORE_X);
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
            g.strokeColor = new Color(255, 206, 110, 210);
            g.lineWidth = 3;
            g.roundRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 5);
            g.stroke();
            ring.setSiblingIndex(0);
        }
        return x + w;
    }

    private _buildButtons(card: Node): void {
        const color = new Color(196, 132, 44, 255);
        const again = createButtonNode('再来一局', 240, H_BUTTON - 2, color, ButtonStyle.Pill);
        again.parent = card;
        again.setPosition(-140, this._layout.btnY, 0);
        bindSafeClick(again, () => this.onRestart?.(), this);

        const back = createButtonNode('返回主页面', 240, H_BUTTON - 2, color, ButtonStyle.Pill);
        back.parent = card;
        back.setPosition(140, this._layout.btnY, 0);
        bindSafeClick(back, () => this.onBack?.(), this);
    }

    // ==================== 小工具 ====================

    private _divider(card: Node, y: number): void {
        const node = new Node('Divider');
        node.parent = card;
        node.addComponent(UITransform).setContentSize(CARD_W - 120, 1);
        const g = node.addComponent(Graphics);
        g.strokeColor = new Color(214, 176, 96, 90);
        g.lineWidth = 2;
        g.moveTo(-(CARD_W - 120) / 2, 0);
        g.lineTo((CARD_W - 120) / 2, 0);
        g.stroke();
        node.setPosition(0, y, 0);
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
