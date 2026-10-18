"""抽牌模式布局出图(16:9 手机 / 4:3 平板 并排)

为什么要有这个脚本: "收牌区够不够明显、面板留白是否四周一致、状态条好不好看"
是**观感问题**, 断言只能保证不重叠、不溢出。这里直接按 DrawModeUI.ts 的真实常量
把面板 / 标签 / 状态胶囊 / 牌阵画出来 —— 常量和排版都从源码 regex 解析,
改源码后重跑即可, 不会手抄漂移。

用法: python tools/preview-draw.py
输出: draw-preview.png(仓库根)
"""
import os
import re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(ROOT, 'assets/scripts/ui/DrawModeUI.ts'), encoding='utf-8').read()
FACTORY = open(os.path.join(ROOT, 'assets/scripts/ui/UIFactory.ts'), encoding='utf-8').read()
GAME = open(os.path.join(ROOT, 'assets/scripts/game/DrawGame.ts'), encoding='utf-8').read()

FONT_PATH = 'C:/Windows/Fonts/msyh.ttc'


def num(name, text=None):
    body = SRC if text is None else text
    m = re.search(r'(?:const|readonly)\s+' + name + r'\s*(?::[^=]*)?=\s*([^;\n]+);', body)
    if not m:
        raise SystemExit('源码里找不到常量 ' + name)
    return float(eval(m.group(1).strip().rstrip(',')))


DRAW_ROWS = int(re.search(r'export const DRAW_ROWS\s*=\s*(\d+)', GAME).group(1))
DRAW_COLS = int(re.search(r'export const DRAW_COLS\s*=\s*(\d+)', GAME).group(1))
CONTENT_W = num('CONTENT_W')
# 牌与牌之间露出的桌布缝(定义在 UIFactory: 牌节点比格位小这一圈)
TILE_GAP = num('TILE_GAP', FACTORY)
TILE_W_MAX = num('TILE_W_MAX')
TILE_W_MIN = num('TILE_W_MIN')
TILE_SCALE_MAX = num('TILE_SCALE_MAX')
TILE_REF_HALF_H = num('TILE_REF_HALF_H')
GRID_MARGIN_X = num('GRID_MARGIN_X')
GRID_TOP_OFFSET = num('GRID_TOP_OFFSET')
GRID_BOTTOM_PAD = num('GRID_BOTTOM_PAD')
SIDE_PAD = num('SIDE_PAD')
SIDE_INNER_PAD = num('SIDE_INNER_PAD')
SIDE_EDGE_PAD = num('SIDE_EDGE_PAD')
SIDE_PANEL_RADIUS = num('SIDE_PANEL_RADIUS')
SIDE_PANEL_BOTTOM_MIN = num('SIDE_PANEL_BOTTOM_MIN')
SIDE_TAG_H = num('SIDE_TAG_H')
SIDE_TAG_FONT = num('SIDE_TAG_FONT')
SIDE_TAG_PAD = num('SIDE_TAG_PAD')
SIDE_TAG_GAP = num('SIDE_TAG_GAP')
SIDE_TOP_GAP = num('SIDE_TOP_GAP')
SIDE_BOTTOM_PAD = num('SIDE_BOTTOM_PAD')
SIDE_W_MAX = num('SIDE_W_MAX')
SIDE_W_MIN = num('SIDE_W_MIN')
SIDE_COL_GAP = num('SIDE_COL_GAP')
SIDE_ROW_GAP = num('SIDE_ROW_GAP')
SIDE_MAX = num('SIDE_MAX')
HUD_ROW_DY = num('HUD_ROW_DY')
HUD_STATUS_DY = num('HUD_STATUS_DY')
CHIP_H = num('CHIP_H')
CHIP_FONT = num('CHIP_FONT')
CHIP_PAD = num('CHIP_PAD')
CHIP_GAP = num('CHIP_GAP')
CHIP_EDGE_PAD = num('CHIP_EDGE_PAD')
STATUS_H = num('STATUS_H')
STATUS_FONT = num('STATUS_FONT')
STATUS_PAD = num('STATUS_PAD')
STATUS_DOT_R = num('STATUS_DOT_R')
STATUS_DOT_GAP = num('STATUS_DOT_GAP')
ANNOUNCE_FONT = num('ANNOUNCE_FONT')
ANNOUNCE_PAD_X = num('ANNOUNCE_PAD_X')
ANNOUNCE_PAD_Y = num('ANNOUNCE_PAD_Y')
ANNOUNCE_Y = num('ANNOUNCE_Y')
TAG_COUNT = 3      # 每侧画几张收牌, 看比例

# 内容单位 → 画布像素的缩放(render() 里设置; tile() 画缝隙时要用)
_PX = 1.0

FELT_FAR = (36, 72, 45)
FELT_NEAR = (19, 42, 26)
PANEL_FILL = (9, 24, 16, 150)
PANEL_EDGE = (212, 174, 96, 110)
TAG_AI_FILL, TAG_AI_EDGE, TAG_AI_TEXT = (26, 52, 78), (118, 178, 224), (206, 232, 250)
TAG_ME_FILL, TAG_ME_EDGE, TAG_ME_TEXT = (84, 62, 22), (230, 188, 96), (255, 236, 176)
CHIP_BG, CHIP_EDGE, CHIP_TEXT = (24, 58, 40), (214, 176, 96), (255, 236, 190)
STATUS_BG, STATUS_EDGE = (10, 28, 20), (214, 176, 96)
STATUS_YOU, STATUS_DOT_YOU = (255, 232, 168), (240, 192, 92)
TILE_FACE = (246, 242, 230)
TILE_BACK = [(196, 68, 58), (48, 96, 168), (52, 132, 78), (96, 84, 120)]


def text_w(s, font):
    w = 0.0
    for ch in s:
        w += font if ord(ch) >= 0x2e80 else font * 0.5
    return w


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def fit_side(tile_w, strip_w, tiles_top, side_bottom):
    """从牌库牌宽往下试, 取能装下 SIDE_MAX 张的最大值(与 _fitSideW 同口径)"""
    cap = min(SIDE_W_MAX, round(tile_w))
    w = cap
    while w >= SIDE_W_MIN:
        h = w * 4 / 3
        cols = max(1, int((strip_w + SIDE_COL_GAP) // (w + SIDE_COL_GAP)))
        rows = max(1, int((tiles_top - side_bottom + SIDE_ROW_GAP) // (h + SIDE_ROW_GAP)))
        if cols * rows >= SIDE_MAX:
            return w, cols, rows
        w -= 1
    return SIDE_W_MIN, 1, 1


def layout(half_h):
    k = clamp(half_h / TILE_REF_HALF_H, 1, TILE_SCALE_MAX)
    max_w = TILE_W_MAX * k
    by_w = (CONTENT_W - GRID_MARGIN_X * 2) / DRAW_COLS
    grid_max_h = max(140, half_h * 2 - GRID_TOP_OFFSET - GRID_BOTTOM_PAD)
    by_h = (grid_max_h / DRAW_ROWS) * 0.75
    tw = clamp(min(max_w, by_w, by_h), TILE_W_MIN, max_w)
    th = tw * 4 / 3
    grid_w, grid_h = DRAW_COLS * tw, DRAW_ROWS * th
    grid_cy = (half_h - GRID_TOP_OFFSET) - grid_h / 2

    panel_x0 = grid_w / 2 + SIDE_PAD
    tag_top = half_h - SIDE_TOP_GAP
    tag_cy = tag_top - SIDE_TAG_H / 2
    panel_top = tag_top - SIDE_TAG_H - SIDE_TAG_GAP
    tiles_top = panel_top - SIDE_INNER_PAD
    avail_w = (CONTENT_W / 2 - SIDE_EDGE_PAD) - panel_x0
    strip_w = avail_w - SIDE_INNER_PAD * 2
    side_w, cols, rows = fit_side(tw, strip_w, tiles_top, -half_h + SIDE_BOTTOM_PAD)
    # 面板按"装满 34 张所需大小"收缩: 满局(实测每局都是 34:34)时四边留白一致
    used_cols = min(cols, -(-SIDE_MAX // rows))
    panel_w = SIDE_INNER_PAD * 2 + used_cols * side_w + (used_cols - 1) * SIDE_COL_GAP
    panel_x1 = panel_x0 + panel_w
    cap_bottom = tiles_top - (rows - 1) * (side_w * 4 / 3 + SIDE_ROW_GAP) - side_w * 4 / 3
    panel_bottom = max(-half_h + SIDE_PANEL_BOTTOM_MIN, cap_bottom - SIDE_INNER_PAD)
    return dict(half_h=half_h, tw=tw, th=th, grid_w=grid_w, grid_h=grid_h, grid_cy=grid_cy,
                side_w=side_w, side_h=side_w * 4 / 3, tag_cy=tag_cy, tiles_top=tiles_top,
                max_cols=cols, per_col=rows, used_cols=used_cols,
                panel_x0=panel_x0, panel_x1=panel_x1, panel_top=panel_top, panel_bottom=panel_bottom)


def tile(d, cx, cy, w, h, back):
    """一张牌: 米白牌身 + 花色色块(只求看清布局, 不画真牌面)

    按 TILE_GAP 缩一圈 —— 游戏里牌节点就是比格位小这一圈, 相邻两张之间透出桌布绿线。
    """
    w = max(2, w - TILE_GAP * _PX)
    h = max(2, h - TILE_GAP * _PX)
    box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
    r = max(2, min(w, h) * 0.12)
    d.rounded_rectangle(box, radius=r, fill=TILE_FACE, outline=(120, 120, 110), width=1)
    d.rounded_rectangle([box[0] + w * 0.12, box[1] + h * 0.10, box[2] - w * 0.12, box[3] - h * 0.42],
                        radius=r * 0.7, fill=back)


def render(half_h, title, width=1180, announce=None):
    L = layout(half_h)
    pad = 46
    s = (width - pad * 2) / CONTENT_W
    global _PX
    _PX = s
    H = int((half_h * 2) * s) + pad * 2 + 40
    img = Image.new('RGBA', (width, H), (18, 18, 20, 255))
    d = ImageDraw.Draw(img, 'RGBA')
    cx, cy = width / 2, pad + 40 + half_h * s

    def X(x):
        return cx + x * s

    def Y(y):
        return cy - y * s

    # 毡布
    top_px, bot_px = Y(half_h), Y(-half_h)
    for i in range(72):
        t = i / 71
        col = tuple(round(FELT_FAR[c] + (FELT_NEAR[c] - FELT_FAR[c]) * t) for c in range(3))
        y0 = top_px + (bot_px - top_px) * i / 72
        y1 = top_px + (bot_px - top_px) * (i + 1) / 72
        d.rectangle([pad - 10, y0, width - pad + 10, y1 + 1], fill=col + (255,))

    # 侧栏面板(标签在面板上方)
    pw = (L['panel_x1'] - L['panel_x0']) * s
    for side in (1, -1):
        x_mid = side * (L['panel_x0'] + L['panel_x1']) / 2
        box = [X(x_mid) - pw / 2, Y(L['panel_top']), X(x_mid) + pw / 2, Y(L['panel_bottom'])]
        d.rounded_rectangle(box, radius=SIDE_PANEL_RADIUS * s, fill=PANEL_FILL, outline=PANEL_EDGE, width=2)
        ai = side < 0
        label = '电脑抽的' if ai else '你抽的'
        tw = (text_w(label, SIDE_TAG_FONT) + SIDE_TAG_PAD * 2)
        tg = [X(x_mid) - tw * s / 2, Y(L['tag_cy']) - SIDE_TAG_H * s / 2,
              X(x_mid) + tw * s / 2, Y(L['tag_cy']) + SIDE_TAG_H * s / 2]
        d.rounded_rectangle(tg, radius=SIDE_TAG_H * s / 2,
                            fill=(TAG_AI_FILL if ai else TAG_ME_FILL),
                            outline=(TAG_AI_EDGE if ai else TAG_ME_EDGE), width=2)
        d.text((X(x_mid), Y(L['tag_cy'])), label,
               font=ImageFont.truetype(FONT_PATH, max(9, int(SIDE_TAG_FONT * s))),
               fill=(TAG_AI_TEXT if ai else TAG_ME_TEXT), anchor='mm')

        for i in range(min(TAG_COUNT, L['per_col'] * L['max_cols'])):
            col, row = i // L['per_col'], i % L['per_col']
            x = side * (L['panel_x0'] + SIDE_INNER_PAD + L['side_w'] / 2
                        + col * (L['side_w'] + SIDE_COL_GAP))
            y = L['tiles_top'] - row * (L['side_h'] + SIDE_ROW_GAP) - L['side_h'] / 2
            tile(d, X(x), Y(y), L['side_w'] * s, L['side_h'] * s, TILE_BACK[i % 4])

    # 牌阵
    for r in range(DRAW_ROWS):
        for c in range(DRAW_COLS):
            x = -L['grid_w'] / 2 + L['tw'] / 2 + c * L['tw']
            y = L['grid_cy'] + L['grid_h'] / 2 - L['th'] / 2 - r * L['th']
            tile(d, X(x), Y(y), L['tw'] * s, L['th'] * s, TILE_BACK[(r + c) % 4])

    # 顶部第 1 行: 左按钮 + 右芯片
    for bx, bw_, label in ((-CONTENT_W / 2 + 12 + 105, 210, '返回主页面'),
                           (-CONTENT_W / 2 + 12 + 210 + 12 + 85, 170, '重新开始')):
        box = [X(bx) - bw_ * s / 2, Y(L['half_h'] - HUD_ROW_DY) - 28 * s,
               X(bx) + bw_ * s / 2, Y(L['half_h'] - HUD_ROW_DY) + 28 * s]
        d.rounded_rectangle(box, radius=28 * s, fill=(255, 255, 255, 12), outline=(240, 238, 228), width=2)
        d.text((X(bx), Y(L['half_h'] - HUD_ROW_DY)), label,
               font=ImageFont.truetype(FONT_PATH, max(9, int(22 * s))), fill=(255, 240, 190), anchor='mm')

    chips = ['你 0 分', '剩余 34 组', '电脑 0 分']
    widths = [text_w(c, CHIP_FONT) + CHIP_PAD * 2 for c in chips]
    cursor = CONTENT_W / 2 - CHIP_EDGE_PAD
    for c, w_ in zip(reversed(chips), reversed(widths)):
        mx = cursor - w_ / 2
        box = [X(mx) - w_ * s / 2, Y(L['half_h'] - HUD_ROW_DY) - CHIP_H * s / 2,
               X(mx) + w_ * s / 2, Y(L['half_h'] - HUD_ROW_DY) + CHIP_H * s / 2]
        d.rounded_rectangle(box, radius=10 * s, fill=CHIP_BG, outline=CHIP_EDGE, width=2)
        d.text((X(mx), Y(L['half_h'] - HUD_ROW_DY)), c,
               font=ImageFont.truetype(FONT_PATH, max(9, int(CHIP_FONT * s))), fill=CHIP_TEXT, anchor='mm')
        cursor -= w_ + CHIP_GAP

    # 顶部第 2 行: 状态胶囊(左圆点 + 文案)
    st = '轮到你 · 点两张相同的牌'
    stw = STATUS_PAD * 2 + STATUS_DOT_R * 2 + STATUS_DOT_GAP + text_w(st, STATUS_FONT)
    sy = Y(L['half_h'] - HUD_STATUS_DY)
    d.rounded_rectangle([X(0) - stw * s / 2, sy - STATUS_H * s / 2,
                         X(0) + stw * s / 2, sy + STATUS_H * s / 2],
                        radius=STATUS_H * s / 2, fill=STATUS_BG + (205,), outline=STATUS_EDGE + (150,), width=2)
    dx = -stw / 2 + STATUS_PAD + STATUS_DOT_R
    d.ellipse([X(dx) - STATUS_DOT_R * s, sy - STATUS_DOT_R * s,
               X(dx) + STATUS_DOT_R * s, sy + STATUS_DOT_R * s], fill=STATUS_DOT_YOU)
    d.text((X(-stw / 2 + STATUS_PAD + STATUS_DOT_R * 2 + STATUS_DOT_GAP + text_w(st, STATUS_FONT) / 2), sy), st,
           font=ImageFont.truetype(FONT_PATH, max(9, int(STATUS_FONT * s))), fill=STATUS_YOU, anchor='mm')

    d.text((cx, pad + 6), title, font=ImageFont.truetype(FONT_PATH, max(10, int(26 * s))),
           fill=(255, 236, 190), anchor='ma')

    # 开局宣告(可选): 居中大字胶囊, 先手一方配色
    if announce:
        text, col, edge = announce
        aw = text_w(text, ANNOUNCE_FONT) + ANNOUNCE_PAD_X * 2
        ah = ANNOUNCE_FONT + ANNOUNCE_PAD_Y * 2
        ay = Y(ANNOUNCE_Y)
        d.rounded_rectangle([X(0) - aw * s / 2, ay - ah * s / 2,
                             X(0) + aw * s / 2, ay + ah * s / 2],
                            radius=ah * s / 2, fill=(8, 22, 15, 226), outline=edge, width=3)
        d.text((X(0), ay), text, font=ImageFont.truetype(FONT_PATH, max(10, int(ANNOUNCE_FONT * s))),
               fill=col, anchor='mm')

    print(f'{title}: 牌宽 {L["tw"]:.1f} / 收牌宽 {L["side_w"]:.0f} / 侧栏 {L["per_col"]}×{L["max_cols"]}'
          f' / 面板宽 {L["panel_x1"] - L["panel_x0"]:.0f} / 内边距 {SIDE_INNER_PAD:.0f}')
    return img


def main(announce=False):
    a = render(472, '抽牌 · 16:9 手机(halfH 472)',
               announce=('你先抽', STATUS_YOU, STATUS_DOT_YOU) if announce else None)
    b = render(630, '抽牌 · 4:3 平板(halfH 630)')
    out = Image.new('RGBA', (max(a.width, b.width), a.height + b.height + 16), (18, 18, 20, 255))
    out.paste(a, (0, 0))
    out.paste(b, (0, a.height + 16))
    path = os.path.join(ROOT, 'draw-announce-preview.png' if announce else 'draw-preview.png')
    out.convert('RGB').save(path)
    print('已出图:', path)


if __name__ == '__main__':
    import sys
    main('--announce' in sys.argv)
