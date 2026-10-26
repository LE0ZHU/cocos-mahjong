# -*- coding: utf-8 -*-
"""
镜像"危险牌角标"与"流局听牌那一行"的几何, 输出 danger-preview.png。

对账对象:
  TileView.drawDangerDot()     危险角标 · 右上角实心圆点(画在牌身**之上**)
  SettlementPanel._buildSeatRow()  流局时右侧那格显示"听 X"(取代恒为 0 的得失分)

规则(2026-10-26 定稿):
- 圆点圆心贴右上角内缩 17%(按短边)、半径 10.5%(危险) / 7.5%(留意)、
  外圈再加 2.6% 深色描边 —— 牌面上可能压着红色图案(红中/一筒/九筒),
  没有深色外圈纯色块会糊成一片。
- 角标必须在牌面内(越界会被牌身裁掉), 且**不能**再画一个整圈:
  牌上已有"刚摸到=金框""建议打出=青框"两种整圈语言, 第三种整圈必然撞车。

改 TileView 里那几个比例后本脚本必须同步, 否则预览会骗人。
"""
import pathlib
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
TILES = ROOT / 'assets/resources/tiles'
FONT = 'C:/Windows/Fonts/msyh.ttc'
DESK = (36, 72, 45, 255)
PANEL_BG = (16, 32, 27, 255)
ROW_BG = (26, 46, 38, 255)
ROW_WIN = (38, 84, 60, 255)

# ---- 与 TileView.drawDangerDot 同一组比例 ----
INSET_RATIO = 0.17
R_RATIO = {1: 0.075, 2: 0.105}
RING_RATIO = 0.026
FILL = {1: (250, 194, 62, 255), 2: (226, 75, 74, 255)}

# ---- 与 SettlementPanel 同一组常量(内容坐标) ----
CARD_W = 1420
ROW_W = CARD_W - 80
ROW_HALF = ROW_W / 2
NAME_W, NAME_CX, NAME_FONT = 140, -ROW_HALF + 86, 30
HAND_TILES_X, HAND_TILE_W, MELD_TILE_W, MELD_GAP = -ROW_HALF + 180, 36, 26, 16
SCORE_CX, WAIT_FONT, WAIT_W = ROW_HALF - 110, 20, 200
ROW_H = 66

TILE_NAMES = ['1W', '2W', '3W', '4W', '5W', '6W', '7W', '8W', '9W',
              '1Tiao', '2Tiao', '3Tiao', '1Tong', 'HongZhong']


def font(size):
    return ImageFont.truetype(FONT, size)


def tile(scale, name='1W'):
    """牌身: 素材四角已圆角透明, 直接缩放"""
    p = TILES / f'{name}.png'
    return Image.open(p).convert('RGBA').resize((scale, scale * 4 // 3), Image.LANCZOS)


def dot(img, w, h, level):
    """在牌面 w×h 上画角标(与 drawDangerDot 同一套几何)"""
    short = min(w, h)
    inset = short * INSET_RATIO
    cx = w - inset      # PIL 坐标: 左上为原点
    cy = inset
    r = short * R_RATIO[level]
    ring = max(1.6, short * RING_RATIO)

    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - r - ring, cy - r - ring, cx + r + ring, cy + r + ring],
              fill=(26, 24, 20, 155))
    out = Image.alpha_composite(img, layer)

    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r], fill=FILL[level])
    out = Image.alpha_composite(out, layer)

    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    hr = r * 0.33
    hx, hy = cx - r * 0.3, cy - r * 0.3
    ImageDraw.Draw(layer).ellipse([hx - hr, hy - hr, hx + hr, hy + hr],
                                  fill=(255, 255, 255, 205))
    return Image.alpha_composite(out, layer)


def hand_strip(names, levels, scale, pad=6):
    """一排手牌(levels 与 names 等长, 0=不标)"""
    tw, th = scale, scale * 4 // 3
    img = Image.new('RGBA', (tw * len(names) + pad * 2, th + pad * 2), DESK)
    for i, (n, lv) in enumerate(zip(names, levels)):
        face = tile(scale, n)
        if lv:
            face = dot(face, tw, th, lv)
        img.paste(face, (pad + i * tw, pad), face)
    return img


def settle_row(waiting, name='老陈', scale=0.9):
    """结算面板一行(流局态): 座位名 + 小牌 + 右侧"听 X" """
    wpx, hpx = int(ROW_W * scale), int(ROW_H * scale)
    img = Image.new('RGBA', (wpx, hpx), ROW_BG)
    d = ImageDraw.Draw(img)

    def X(v):
        return (v + ROW_HALF) * scale

    def Y(v):
        return hpx / 2 - v * scale

    # 座位名块
    nw = NAME_W * scale
    d.rounded_rectangle([X(NAME_CX) - nw / 2, Y(19), X(NAME_CX) + nw / 2, Y(-19)],
                        radius=9 * scale, fill=(186, 124, 40, 235) if waiting else (0, 0, 0, 110))
    label = f'{name} 听' if waiting else name
    d.text((X(NAME_CX), Y(0)), label, font=font(int(NAME_FONT * scale)),
           fill=(240, 242, 228), anchor='mm')

    # 手牌(13 张)
    names = TILE_NAMES[:13]
    tw = HAND_TILE_W * scale
    th = tw * 4 / 3
    x = X(HAND_TILES_X)
    for n in names:
        face = tile(int(tw), n)
        img.paste(face, (int(x), int(hpx / 2 - th / 2)), face)
        x += tw

    # 右侧: 流局时显示听牌(取代得失分)
    if waiting:
        d.text((X(SCORE_CX), Y(16)), waiting, font=font(int(WAIT_FONT * scale)),
               fill=(250, 208, 118), anchor='mm')
    else:
        d.text((X(SCORE_CX), Y(16)), '未听', font=font(int(WAIT_FONT * scale)),
               fill=(170, 184, 170), anchor='mm')
    d.text((X(SCORE_CX), Y(-17)), '累计 +12', font=font(int(20 * scale)),
           fill=(170, 184, 170), anchor='mm')
    return img


def main():
    f_title = font(20)
    f_note = font(17)

    # A. 手牌行: 真实的混排观感(两张危险 + 三张留意)
    strip = hand_strip(TILE_NAMES[:9], [0, 0, 1, 0, 2, 0, 1, 0, 0], 90)

    # B. 放大对比
    zoom = 3
    cells = [('不标 · 安全', hand_strip(['3W'], [0], 90 * zoom)),
             ('留意 · 琥珀', hand_strip(['5W'], [1], 90 * zoom)),
             ('危险 · 红', hand_strip(['5W'], [2], 90 * zoom))]
    gap = 18
    b = Image.new('RGBA', (sum(c.width for _, c in cells) + gap * (len(cells) + 1),
                           max(c.height for _, c in cells) + 40), (22, 24, 28, 255))
    db = ImageDraw.Draw(b)
    x = gap
    for title, c in cells:
        db.text((x, 6), title, font=f_note, fill=(210, 216, 220))
        b.paste(c, (x, 34), c)
        x += c.width + gap

    # C. 流局结算行对比
    r1 = settle_row('听 3/6萬 · 1/4條')
    r2 = settle_row('', '小雨')
    c = Image.new('RGBA', (r1.width, r1.height * 2 + 46), (22, 24, 28, 255))
    dc = ImageDraw.Draw(c)
    dc.text((10, 4), '流局 · 右侧那格改显示听什么(得分为 0, 本来没有信息量)', font=f_note, fill=(210, 216, 220))
    c.paste(r1, (0, 30), r1)
    c.paste(r2, (0, 30 + r1.height + 6), r2)

    width = max(strip.width, b.width, c.width)
    out = Image.new('RGB', (width, 40 + strip.height + 20 + b.height + 20 + c.height + 20),
                    (22, 24, 28))
    d = ImageDraw.Draw(out)
    d.text((12, 10), 'A · 手牌上的危险角标(9 张里 1 张危险 + 2 张留意)', font=f_title, fill=(232, 236, 240))
    out.paste(strip.convert('RGB'), (0, 40))
    y = 40 + strip.height + 16
    d.text((12, y), 'B · 三档放大对比(圆点固定贴右上角, 不占牌面中心)', font=f_title, fill=(232, 236, 240))
    out.paste(b.convert('RGB'), (0, y + 28))
    y += 28 + b.height + 16
    out.paste(c.convert('RGB'), (0, y))

    path = ROOT / 'danger-preview.png'
    out.save(path)
    print('saved danger-preview.png', out.size)


if __name__ == '__main__':
    main()
