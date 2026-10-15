import { _decorator, Component, Node, Color, Label, Graphics, UITransform } from 'cc';
import {
    createLabelNode, createButtonNode, bindSafeClick, repaintButtons,
    createTileNode, setTileBgColor, ButtonStyle,
} from './UIFactory';
import { TileView } from './TileView';
import { Tile } from '../core/Tile';
import { FanItem, SeatResult, SettlementData } from '../core/HuScore';

const { ccclass } = _decorator;

// ==================== 结算面板布局常量(内容坐标,原点=屏幕中心) ====================
const CARD_W = 1180;
const CARD_H = 940;
/** 遮罩尺寸(比屏幕大得多, 盖住整张牌桌) */
const MASK_SIZE = 6000;

const TITLE_Y = 366;
const SUBTITLE_Y = 312;
/** 赢家番型区(多家并排) */
const FAN_BLOCK_Y = 232;
const FAN_BLOCK_H = 168;
const DIVIDER_Y = 130;

/** 四家手牌行 */
const ROW_TOP_Y = 72;
const ROW_GAP = 82;
const ROW_W = CARD_W - 80;
/** 行内手牌宽度 / 副露牌宽度(副露略小, 一眼分得清) */
const HAND_TILE_W = 25;
const MELD_TILE_W = 22;
/** 行内手牌起点 x / 右侧分数 x(均为行节点局部坐标, 行节点居中于卡片) */
const ROW_TILES_X = -452;
const ROW_SCORE_X = ROW_W / 2 - 96;

const BTN_Y = -CARD_H / 2 + 74;

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

    onLoad(): void {
        this._buildSkeleton();
        this.hide();
    }

    /** 显示结算面板(每次调用按最新数据重建内容) */
    show(data: SettlementData): void {
        const card = this._card;
        if (!card) return;
        this._clear(card);
        this._buildContent(card, data);
        this.node.active = true;
        this._isOpen = true;
        // 原生平台: 按钮底框按"显示时补画"处理一次(与牌桌按钮同一套约定)
        this.scheduleOnce(() => repaintButtons(card), 0);
    }

    /** 隐藏面板(遮罩一起隐藏, 不留半透明黑幕) */
    hide(): void {
        this._isOpen = false;
        this.node.active = false;
    }

    get isOpen(): boolean { return this._isOpen; }

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
        card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
        card.addComponent(Graphics);
        this._card = card;
    }

    private _clear(card: Node): void {
        for (const child of [...card.children]) child.destroy();
    }

    private _paintCard(g: Graphics): void {
        g.clear();
        const r = 34;
        // 落地投影
        g.fillColor = new Color(0, 0, 0, 110);
        g.roundRect(-CARD_W / 2 + 8, -CARD_H / 2 - 8, CARD_W, CARD_H, r);
        g.fill();
        // 面板底
        g.fillColor = CARD_BG;
        g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, r);
        g.fill();
        // 内侧柔光边
        g.strokeColor = new Color(255, 255, 255, 16);
        g.lineWidth = 6;
        g.roundRect(-CARD_W / 2 + 10, -CARD_H / 2 + 10, CARD_W - 20, CARD_H - 20, r - 6);
        g.stroke();
        // 外框
        g.strokeColor = CARD_BORDER;
        g.lineWidth = 3;
        g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, r);
        g.stroke();
    }

    // ==================== 内容 ====================

    private _buildContent(card: Node, data: SettlementData): void {
        this._paintCard(card.getComponent(Graphics)!);

        // 标题 + 来源说明
        this._label(card, data.title, 54, TEXT_TITLE, CARD_W - 120, TITLE_Y);
        if (data.subtitle) {
            this._label(card, data.subtitle, 26, TEXT_SUB, CARD_W - 120, SUBTITLE_Y);
        }

        // 番型列表(流局没有番型区, 提示"本局不计分")
        if (data.winners.length > 0) {
            this._buildFanArea(card, data);
        } else {
            this._label(card, '本局无人胡牌, 不计分', 26, TEXT_MUTED, 900, FAN_BLOCK_Y);
        }

        // 分隔线 + 四家手牌
        this._divider(card, DIVIDER_Y);
        this._label(card, '四家手牌', 24, TEXT_SUB, 200, DIVIDER_Y - 38, -CARD_W / 2 + 96, true);
        for (let i = 0; i < data.seats.length; i++) {
            const seat = data.seats[i];
            const winTile = seat.isWinner
                ? (data.winners.find(w => w.seat === seat.seat)?.winTile ?? null)
                : null;
            this._buildSeatRow(card, seat, winTile, ROW_TOP_Y - i * ROW_GAP);
        }

        this._buildButtons(card);
    }

    /** 赢家番型区: 每家一个块(通常一家, 一炮多响时多家并排) */
    private _buildFanArea(card: Node, data: SettlementData): void {
        const winners = data.winners;
        const gap = 24;
        const blockW = Math.min(380, (CARD_W - 160) / winners.length - gap);
        let cursor = -(winners.length * blockW + (winners.length - 1) * gap) / 2;

        for (const w of winners) {
            const block = new Node(`Fan_${w.seat}`);
            block.parent = card;
            block.addComponent(UITransform).setContentSize(blockW, FAN_BLOCK_H);
            const bg = block.addComponent(Graphics);
            bg.fillColor = WINNER_BG;
            bg.roundRect(-blockW / 2, -FAN_BLOCK_H / 2, blockW, FAN_BLOCK_H, 14);
            bg.fill();
            bg.strokeColor = WINNER_EDGE;
            bg.lineWidth = 2;
            bg.roundRect(-blockW / 2, -FAN_BLOCK_H / 2, blockW, FAN_BLOCK_H, 14);
            bg.stroke();
            block.setPosition(cursor + blockW / 2, FAN_BLOCK_Y, 0);
            cursor += blockW + gap;

            // 块内: 谁胡了什么牌
            const head = `${w.name} · ${w.isSelfDraw ? '自摸' : '胡'} ${w.winTile ? w.winTile.displayText : ''}`;
            this._label(block, head, 24, TEXT_TITLE, blockW - 24, FAN_BLOCK_H / 2 - 26);

            // 番型芯片(横向排, 放不下自动换行)
            let row = 0;
            for (const chip of this._layoutFans(w.hu.fans, blockW - 28)) {
                const node = this._fanChip(chip.item);
                node.parent = block;
                node.setPosition(chip.x, FAN_BLOCK_H / 2 - 62 - row * 34, 0);
                if (chip.newRow) row++;
            }

            // 合计
            const cap = w.hu.capped ? ' (已封顶)' : '';
            this._label(
                block,
                `共 ${w.hu.totalFan} 番${cap} · ${w.hu.points} 分`,
                26, GAIN, blockW - 24, -FAN_BLOCK_H / 2 + 26,
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
        const rowH = ROW_GAP - 12;
        const row = new Node(`Row_${seat.seat}`);
        row.parent = card;
        row.addComponent(UITransform).setContentSize(ROW_W, rowH);
        const g = row.addComponent(Graphics);
        g.fillColor = seat.isWinner ? WINNER_BG : ROW_BG;
        g.roundRect(-ROW_W / 2, -rowH / 2, ROW_W, rowH, 12);
        g.fill();
        if (seat.isWinner) {
            g.strokeColor = WINNER_EDGE;
            g.lineWidth = 2;
            g.roundRect(-ROW_W / 2, -rowH / 2, ROW_W, rowH, 12);
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
        nameBg.setPosition(-ROW_W / 2 + 86, 0, 0);
        this._label(row, `${seat.name}${seat.declaredTenpai ? ' 听' : ''}`, 26,
            seat.isWinner ? TEXT_TITLE : TEXT_ROW, 146, 0, -ROW_W / 2 + 86);

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
        /** 需要高亮的那张(如和的那张);null 表示不高亮 */
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
        const again = createButtonNode('再来一局', 240, 62, color, ButtonStyle.Pill);
        again.parent = card;
        again.setPosition(-140, BTN_Y, 0);
        bindSafeClick(again, () => this.onRestart?.(), this);

        const back = createButtonNode('返回主页面', 240, 62, color, ButtonStyle.Pill);
        back.parent = card;
        back.setPosition(140, BTN_Y, 0);
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
