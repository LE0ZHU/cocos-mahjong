# -*- coding: utf-8 -*-
"""
胡牌特效的静态分镜(不进引擎, 只核对构图)

2026-10-18: 全桌压暗 / 「自摸·吃胡」大字宣告 / 摘要行「你 3 番 · +12 分」三拍已删除,
现在只剩**和牌归位**一拍 —— 副本飞行 → 落位金环 → 交棒结算面板(面板自带遮罩和结论)。
所以这张图只画亮桌面上的几帧: 起点高亮 / 飞行中 / 落位。
2026-10-19: 自摸也走同一段归位 —— 刚摸到的那张先在**手牌里**被金框点亮, 再滑到手牌
最右的"和牌位"(真牌在滑, 不飞副本: 它一直看得见, 飞一张副本就成了两张一样的牌)。

常量 regex 解析自 HuEffect.ts, 不手抄 —— 改了常量重跑这张图即可对照。

用法: python tools/preview-hu-fx.py
输出: hu-fx-preview.png
"""
import os
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_PATH = 'C:/Windows/Fonts/msyh.ttc'
SRC = open(os.path.join(ROOT, 'assets/scripts/ui/HuEffect.ts'), encoding='utf-8').read()


def num(name):
    m = re.search(r'const ' + name + r'\s*=\s*([\d.]+)\s*(?:;|\*/)', SRC)
    if not m:
        raise SystemExit('HuEffect.ts 里找不到常量 ' + name)
    return float(m.group(1))


def color(name):
    m = re.search(r'const ' + name + r' = new Color\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)', SRC)
    if not m:
        raise SystemExit('HuEffect.ts 里找不到颜色 ' + name)
    return tuple(int(x) for x in m.groups())


CONTENT_W = 1680
HALF_H = 472.0
C_GOLD = color('C_GOLD')
T_LAND = num('T_LAND')
RING_LIFE = num('RING_LIFE')
T_BEAT = num('T_BEAT')
T_HL = num('T_HL')
T_FLY_DUR = num('T_FLY_DUR')
MAIN_SRC = open(os.path.join(ROOT, 'assets/scripts/Main.ts'), encoding='utf-8').read()
REVEAL_TAIL = float(re.search(r'HU_FX_REVEAL_TAIL = ([\d.]+)', MAIN_SRC).group(1))
T_DONE = num('T_DONE')


def text_width(text, font):
    return sum(font if ord(ch) >= 0x2e80 else font * 0.5 for ch in text)


def frame(flight=None, ghost=True, subdued=False, start_ring=False, tsumo=False):
    """画一帧亮桌面: 毡布 + 象征性牌河/手牌 + (可选的)飞行副本 / 落位金环

    flight: 飞行进度 0~1; ghost: 沿途残影; start_ring: 起点(弃牌河那一格)的高亮金框。
    tsumo: 自摸那一帧 —— 起点改到**手牌行**(刚摸到的那张紧贴着手牌), 终点是手牌最右
           的和牌位; 滑的是真牌本身, 所以不画残影(画了就成了两张一样的牌)。
    **没有闪光**: 2026-10-18 用户反馈那块实心金色矩形太突兀 —— 强调只留描边金环。
    2026-10-19: 和牌不再"直接塞进赢家手牌" —— 它先留在弃牌河里(start_ring 那一帧),
    高亮后才飞向赢家手牌的空槽。
    """
    w, h = 1180, 700
    scale = w / CONTENT_W
    felt = (26, 96, 62)
    img = Image.new('RGB', (w, h), felt)
    d = ImageDraw.Draw(img, 'RGBA')
    cy = h / 2
    d.ellipse([w / 2 - 90, cy - 90, w / 2 + 90, cy + 90], outline=(214, 176, 96, 130), width=3)
    for k in range(9):
        x = w / 2 + (k - 4) * 74
        d.rounded_rectangle([x - 27, h - 120, x + 27, h - 30], radius=6, fill=(250, 247, 240, 255))
        d.rounded_rectangle([x - 24, 26, x + 24, 104], radius=6, fill=(244, 240, 232, 235))

    # 和牌归位: 副本从牌河末格飞向手牌落位(沿途转正 + 越飞越大)
    start = (w * 0.5 + 330 * scale, h * 0.30)
    end = (w / 2 + 150 * scale, h - 150)
    if tsumo:
        # 自摸: 起点 = 手牌里刚摸到的那张(紧贴手牌), 终点 = 手牌最右单列的和牌位
        start = (w / 2 - 110 * scale, h - 150)
        end = (w / 2 + 150 * scale, h - 150)
        ghost = False
    ew, eh = 62 * scale, 82 * scale
    lw = max(2, int((4 if subdued else 6) * scale))
    gold = (C_GOLD[0], C_GOLD[1], C_GOLD[2], 235)
    # 起点高亮: 和牌此刻还躺在弃牌河那一格, 先给它套上金框
    if start_ring:
        sx, sy = start
        sw, sh = 52 * scale, 69 * scale
        d.rounded_rectangle([sx - sw / 2 - 7, sy - sh / 2 - 7, sx + sw / 2 + 7, sy + sh / 2 + 7],
                            radius=10 * scale, outline=gold, width=lw)
    if flight is not None:
        def lerp(t):
            return (start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)

        ex, ey = end
        # 落位金环(描边, 由大收到牌面大小再淡出 RING_LIFE) + 飞行副本的金边框
        d.rounded_rectangle([ex - ew / 2 - 7, ey - eh / 2 - 7, ex + ew / 2 + 7, ey + eh / 2 + 7],
                            radius=10 * scale, outline=gold, width=lw)
        for t, alpha in ((flight - 0.22, 60), (flight - 0.11, 120), (flight, 255)):
            if t < 0 or (not ghost and alpha < 255):
                continue
            fx_, fy_ = lerp(t)
            ang = (1 - t) * 40
            grow = 1 + 0.25 * (1 - t)
            tw_, th_ = 52 * scale * grow, 69 * scale * grow
            ghost_img = Image.new('RGBA', (int(tw_ * 2), int(th_ * 2)), (0, 0, 0, 0))
            gd = ImageDraw.Draw(ghost_img)
            gd.rounded_rectangle([tw_ / 2 - tw_ / 2, th_ / 2 - th_ / 2, tw_ / 2 + tw_ / 2, th_ / 2 + th_ / 2],
                                 radius=7 * scale, fill=(250, 247, 240, alpha),
                                 outline=(70, 60, 40, alpha), width=2)
            if alpha == 255:   # 本体自带金边框(用户认领的视觉锚点)
                gd.rounded_rectangle([tw_ / 2 - tw_ / 2 - 3, th_ / 2 - th_ / 2 - 3,
                                      tw_ / 2 + tw_ / 2 + 3, th_ / 2 + th_ / 2 + 3],
                                     radius=9 * scale, outline=(C_GOLD[0], C_GOLD[1], C_GOLD[2], 235),
                                     width=max(2, int(4 * scale)))
            rot = ghost_img.rotate(ang, expand=True)
            img.paste(rot, (int(fx_ - rot.width / 2), int(fy_ - rot.height / 2)), rot)
    return img


def main():
    # 时间从**点胡**起算: 翻面 ~%.2fs | 起点高亮 %.2f | 飞行 %.2f | 落位金环 %.2f + 留一眼 %.2f | 交棒 → 面板
    cases = [
        ('%.2fs 起点高亮: 和牌还躺在弃牌河那一格(金框), 赢家手牌留着空槽 —— 它不"直接塞进手里"'
         % REVEAL_TAIL,
         dict(start_ring=True)),
        ('%.2f~%.2fs 副本飞行中(亮桌面, 全程不压暗 —— 压暗那拍已删除)'
         % (REVEAL_TAIL + T_HL, REVEAL_TAIL + T_LAND),
         dict(flight=0.45)),
        ('%.2fs 落位: 填进赢家手牌那个空槽 + 描边金环 %.2fs(闪光已删) + 留一眼 %.2fs → %.2fs 交棒结算面板'
         % (REVEAL_TAIL + T_LAND, RING_LIFE, T_BEAT, REVEAL_TAIL + T_DONE),
         dict(flight=1.0, ghost=False)),
        ('自摸: %.2fs 刚摸到的那张在手牌里被金框点亮 → %.2f~%.2fs 真牌自己滑到手牌最右的'
         '和牌位(不飞副本) → 同一时刻落位金环'
         % (REVEAL_TAIL, REVEAL_TAIL + T_HL, REVEAL_TAIL + T_LAND),
         dict(flight=0.55, tsumo=True, start_ring=True)),
    ]
    pad, label_h = 12, 30
    imgs = [(t, frame(**kw)) for t, kw in cases]
    out = Image.new('RGB', (1180 + pad * 2, sum(im.height + label_h for _, im in imgs) + pad),
                    (18, 20, 24))
    d = ImageDraw.Draw(out)
    y = pad
    f_label = ImageFont.truetype(FONT_PATH, 18)
    for title, im in imgs:
        d.text((pad, y + 3), title, font=f_label, fill=(232, 236, 240))
        y += label_h
        out.paste(im, (pad, y))
        y += im.height
    path = os.path.join(ROOT, 'hu-fx-preview.png')
    out.save(path)
    print('已出图:', path)


if __name__ == '__main__':
    main()
