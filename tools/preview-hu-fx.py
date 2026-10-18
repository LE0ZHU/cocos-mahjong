# -*- coding: utf-8 -*-
"""
胡牌特效的静态分镜(不进引擎, 只核对构图)

2026-10-18: 全桌压暗 / 「自摸·吃胡」大字宣告 / 摘要行「你 3 番 · +12 分」三拍已删除,
现在只剩**和牌归位**一拍 —— 副本飞行 → 落位金环 + 闪光 → 交棒结算面板(面板自带遮罩和结论)。
所以这张图只画亮桌面上的两帧: 飞行中 / 落位。

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
FLASH_LIFE = num('FLASH_DUR') + 0.05
MAIN_SRC = open(os.path.join(ROOT, 'assets/scripts/Main.ts'), encoding='utf-8').read()
REVEAL_TAIL = float(re.search(r'HU_FX_REVEAL_TAIL = ([\d.]+)', MAIN_SRC).group(1))
T_DONE = num('T_DONE')


def text_width(text, font):
    return sum(font if ord(ch) >= 0x2e80 else font * 0.5 for ch in text)


def frame(flight=None, ghost=True, flash=False, subdued=False):
    """画一帧亮桌面: 毡布 + 象征性牌河/手牌 + (可选的)飞行副本 / 落位金环 / 闪光

    flight: 飞行进度 0~1; ghost: 沿途残影; flash: 落位闪光
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
    if flight is not None:
        start = (w * 0.5 + 330 * scale, h * 0.30)
        end = (w / 2 + 150 * scale, h - 150)

        def lerp(t):
            return (start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)

        ex, ey = end
        ew, eh = 62 * scale, 82 * scale
        # 闪光(flashBurst: 比牌大一圈的金色块 + 外扩光晕)
        if flash:
            d.rounded_rectangle([ex - ew * 0.62, ey - eh * 0.62, ex + ew * 0.62, ey + eh * 0.62],
                                radius=12 * scale, fill=(255, 214, 120, 120))
            d.ellipse([ex - ew * 1.05, ey - eh * 0.95, ex + ew * 1.05, ey + eh * 0.95],
                      outline=(255, 214, 120, 90), width=max(2, int(3 * scale)))
        # 落位金环(RING_LIFE, 一闪即收) + 副露金边框
        lw = max(2, int((4 if subdued else 6) * scale))
        d.rounded_rectangle([ex - ew / 2 - 7, ey - eh / 2 - 7, ex + ew / 2 + 7, ey + eh / 2 + 7],
                            radius=10 * scale, outline=(C_GOLD[0], C_GOLD[1], C_GOLD[2], 235), width=lw)
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
    # 时间从**点胡**起算: 翻面 ~%.2fs | 起飞 %.2f | 落位 %.2f(金环 %.2f + 闪光 %.2f) | 交棒 %.2f → 面板 ≈%.2fs 就位
    cases = [
        ('%.2f~%.2fs 副本飞行中(亮桌面, 全程不压暗 —— 压暗那拍已删除)' % (REVEAL_TAIL, REVEAL_TAIL + T_LAND),
         dict(flight=0.45)),
        ('%.2fs 落位: 金环 %.2fs + 闪光 %.2fs → %.2fs 交棒结算面板(遮罩与结论都由面板负责)'
         % (REVEAL_TAIL + T_LAND, RING_LIFE, FLASH_LIFE, REVEAL_TAIL + T_DONE),
         dict(flight=1.0, ghost=False, flash=True)),
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
