# -*- coding: utf-8 -*-
"""
胡牌特效的静态分镜(不进引擎, 只核对"构图/字号/配色/压暗程度")

四档状态并排: 自摸(玩家, 全量) / 吃胡(AI 胡, 收着演) / 一炮多响 / 流局。
常量全部 regex 解析自 HuEffect.ts, 不手抄 —— 改了常量重跑这张图即可对照。

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
STAMP_FONT = int(num('STAMP_FONT'))
STAMP_SUB_FONT = int(num('STAMP_SUB_FONT'))
STAMP_PAD_X = num('STAMP_PAD_X')
STAMP_H = num('STAMP_H')
SUMMARY_H = num('SUMMARY_H')
SUMMARY_FONT = int(num('SUMMARY_FONT'))
SUMMARY_PAD_X = num('SUMMARY_PAD_X')
DIM_FULL = num('DIM_FULL')
DIM_SUB = num('DIM_SUB')
DIM_DRAW = num('DIM_DRAW')
SUB_SCALE = num('SUB_SCALE')

C_TSUMO = color('C_TSUMO')
C_RON = color('C_RON')
C_MULTI = color('C_MULTI')
C_DRAW = color('C_DRAW')
C_GOLD = color('C_GOLD')
C_TEXT_DIM = color('C_TEXT_DIM')


def text_width(text, font):
    return sum(font if ord(ch) >= 0x2e80 else font * 0.5 for ch in text)


def frame(dim, stamp_main, stamp_sub, theme, summary, subdued, flight=None, ghost=True, flash=False):
    """画一帧: 毡布底 + 压暗 + 大字印章 + 摘要胶囊

    flight: 飞行进度 0~1(第 1 拍); ghost: 是否画沿途残影; flash: 落位闪光(第 1 拍尾)
    """
    w, h = 1180, 700
    scale = w / CONTENT_W
    felt = (26, 96, 62)
    # 底图用 RGB + Draw('RGBA'): 半透明色才会真正混合(RGBA 底图上 draw 会直接替换像素)
    img = Image.new('RGB', (w, h), felt)
    # 象征性的牌桌元素(手牌两排 + 中央转盘), 让压暗程度有参照
    d = ImageDraw.Draw(img, 'RGBA')
    cy = h / 2
    d.ellipse([w / 2 - 90, cy - 90, w / 2 + 90, cy + 90], outline=(214, 176, 96, 130), width=3)
    for k in range(9):
        x = w / 2 + (k - 4) * 74
        d.rounded_rectangle([x - 27, h - 120, x + 27, h - 30], radius=6, fill=(250, 247, 240, 255))
        d.rounded_rectangle([x - 24, 26, x + 24, 104], radius=6, fill=(244, 240, 232, 235))
    # 压暗层
    dim_a = int(dim / 255 * 255)
    d.rectangle([0, 0, w, h], fill=(0, 0, 0, dim_a))

    def px(x, y):
        return (w / 2 + x * scale, h / 2 - y * scale)

    # 第 0 拍: 和牌副本飞行中(示意: 从牌河末格飞向手牌落位, 沿途转正)
    if flight is not None:
        start = (w * 0.5 + 330 * scale, h * 0.30)
        end = (w / 2 + 150 * scale, h - 150)
        def lerp(t):
            return (start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)
        # 落位处的"闪光"(flashBurst: 比牌大一圈的金色方块, 0.05s 淡入后 0.6s 淡出)
        if flash:
            ex, ey = end
            ew, eh = 62 * scale, 82 * scale
            d.rounded_rectangle([ex - ew * 0.62, ey - eh * 0.62, ex + ew * 0.62, ey + eh * 0.62],
                                radius=12 * scale, fill=(255, 214, 120, 120))
            d.ellipse([ex - ew * 1.05, ey - eh * 0.95, ex + ew * 1.05, ey + eh * 0.95],
                      outline=(255, 214, 120, 90), width=max(2, int(3 * scale)))
        # 落位金环(RING_LIFE=0.3s, 一闪即收 —— 明显短于闪光)
        ex, ey = end
        ew, eh = 62 * scale, 82 * scale
        d.rounded_rectangle([ex - ew / 2 - 7, ey - eh / 2 - 7, ex + ew / 2 + 7, ey + eh / 2 + 7],
                            radius=10 * scale, outline=(255, 214, 120, 235), width=max(2, int(5 * scale)))
        # 残影 + 本体(从斜到正, 越飞越大)
        for t, alpha in ((flight - 0.22, 60), (flight - 0.11, 120), (flight, 255)):
            if t < 0 or (not ghost and alpha < 255):   # 落位帧只留本体, 不留沿途残影
                continue
            fx_, fy_ = lerp(t)
            ang = (1 - t) * 40
            grow = 1 + 0.3 * (1 - t)
            tw_, th_ = 52 * scale * grow, 69 * scale * grow
            ghost = Image.new('RGBA', (int(tw_ * 2), int(th_ * 2)), (0, 0, 0, 0))
            gd = ImageDraw.Draw(ghost)
            gd.rounded_rectangle([tw_ / 2 - tw_ / 2, th_ / 2 - th_ / 2, tw_ / 2 + tw_ / 2, th_ / 2 + th_ / 2],
                                 radius=7 * scale, fill=(250, 247, 240, alpha),
                                 outline=(70, 60, 40, alpha), width=2)
            rot = ghost.rotate(ang, expand=True)
            img.paste(rot, (int(fx_ - rot.width / 2), int(fy_ - rot.height / 2)), rot)
        d2 = ImageDraw.Draw(img, 'RGBA')

    # 大字印章(第 0 拍的帧还没有大字/摘要)
    k = SUB_SCALE if subdued else 1.0
    main_w = text_width(stamp_main, STAMP_FONT) if stamp_main else 1
    sub_w = text_width(stamp_sub, STAMP_SUB_FONT) if stamp_sub else 0
    box_w = (max(main_w, sub_w) + STAMP_PAD_X * 2) * scale * k
    box_h = STAMP_H * scale * k
    stamp_y = HALF_H * 0.1
    cx, cy2 = px(0, stamp_y)
    if not stamp_main:
        return img.convert('RGB')
    d.rounded_rectangle([cx - box_w / 2, cy2 - box_h / 2, cx + box_w / 2, cy2 + box_h / 2],
                        radius=26 * scale * k, fill=(16, 13, 9, 208))
    d.rounded_rectangle([cx - box_w / 2, cy2 - box_h / 2, cx + box_w / 2, cy2 + box_h / 2],
                        radius=26 * scale * k, outline=(theme[0], theme[1], theme[2], 235), width=max(2, int(6 * scale * k)))
    d.rounded_rectangle([cx - box_w / 2 + 7, cy2 - box_h / 2 + 7, cx + box_w / 2 - 7, cy2 + box_h / 2 - 7],
                        radius=18 * scale * k, outline=(255, 255, 255, 70), width=1)
    f_main = ImageFont.truetype(FONT_PATH, max(8, int(STAMP_FONT * scale * k)))
    off = (box_h * 0.16) if stamp_sub else 0
    d.text((cx, cy2 - off), stamp_main, font=f_main, fill=(theme[0], theme[1], theme[2], 255), anchor='mm')
    if stamp_sub:
        f_sub = ImageFont.truetype(FONT_PATH, max(8, int(STAMP_SUB_FONT * scale * k)))
        d.text((cx, cy2 + box_h * 0.28), stamp_sub, font=f_sub,
               fill=(C_TEXT_DIM[0], C_TEXT_DIM[1], C_TEXT_DIM[2], 226), anchor='mm')

    if not stamp_main:
        return img.convert('RGB')
    # 摘要胶囊
    sum_w = (text_width(summary, SUMMARY_FONT) + SUMMARY_PAD_X * 2) * scale
    sum_h = SUMMARY_H * scale
    sx, sy = px(0, stamp_y - STAMP_H / 2 - 54)
    d.rounded_rectangle([sx - sum_w / 2, sy - sum_h / 2, sx + sum_w / 2, sy + sum_h / 2],
                        radius=sum_h / 2, fill=(12, 10, 8, 188))
    d.rounded_rectangle([sx - sum_w / 2, sy - sum_h / 2, sx + sum_w / 2, sy + sum_h / 2],
                        radius=sum_h / 2, outline=(theme[0], theme[1], theme[2], 150), width=2)
    f_sum = ImageFont.truetype(FONT_PATH, max(8, int(SUMMARY_FONT * scale)))
    d.text((sx, sy), summary, font=f_sum, fill=(255, 255, 255, 255), anchor='mm')
    return img.convert('RGB')


def main():
    # 方案二(完全串行 / 零重叠): 时间从**点胡**起算, 每一拍连余韵播完 + 留一眼才进下一拍
    # 0.00 翻面 ~1.15s | 1.15 起飞 | 1.85 落位(金环 0.3 + 闪光 0.65) | 3.00 压暗 | 3.60 大字 | 4.60 摘要 | 5.15 交棒 ≈5.65s 就位
    cases = [
        ('0.00~1.15s 翻面后 · 副本飞行中(1.15~1.85s, 亮桌面不压暗)', 0, '', '', C_TSUMO, '', False, 0.45, True, False),
        ('1.85s 落位 · 金环 0.3s + 闪光 0.65s(到 2.50s 之前都不压暗)', 0, '', '', C_TSUMO, '', False, 1.0, False, True),
        ('2.50~3.00s 留一眼 · 再看 3.00~3.60s 压暗+停一眼(此时还没有大字)', DIM_FULL, '', '', C_TSUMO, '', False, None, True, False),
        ('3.60s 自摸 · 玩家(全量)', DIM_FULL, '自摸', '', C_TSUMO, '你 3 番 · +12 分', False, None, True, False),
        ('吃胡 · AI 胡(收着演, 大字 0.72 倍)', DIM_SUB, '吃胡', '老陈点炮', C_RON, '小雨 2 番 · -4 分', True, None, True, False),
        ('一炮多响', DIM_FULL, '一炮多响', '你、老陈 同时胡 五萬', C_MULTI, '2家 4 番 · -8 分', False, None, True, False),
        ('流局(不等飞行/闪光, 压暗 0.3s 就起)', DIM_DRAW, '流局', '', C_DRAW, '牌墙已空, 无人胡牌', False, None, True, False),
    ]
    pad, label_h = 12, 30
    imgs = [(t, frame(*rest)) for t, *rest in cases]
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
