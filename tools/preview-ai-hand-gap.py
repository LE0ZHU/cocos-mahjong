"""
三家手牌"缝隙"放大对照(改前 / 改后)

缝隙是绝对值(UIFactory.TILE_GAP), 而三家手牌的格位只有 32~34 宽, 真机上 1 屏幕像素
的差别很难在整桌预览里看出来 —— 这里按**真实牌宽 × 放大倍数**并排画出两种缝,
用来肉眼判断"哪一档更像一整排牌"。

用法: python tools/preview-ai-hand-gap.py [--zoom 6]
输出: ai-hand-gap-preview.png
"""
import argparse
import os
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_PATH = 'C:/Windows/Fonts/msyh.ttc'


def read_const(path, name):
    src = open(path, encoding='utf-8').read()
    m = re.search(r'export const ' + name + r'\s*=\s*([\d.]+);', src)
    if not m:
        raise SystemExit(f'UIFactory 里找不到 {name}')
    return float(m.group(1))


def read_main_const(name):
    src = open(os.path.join(ROOT, 'assets/scripts/Main.ts'), encoding='utf-8').read()
    m = re.search(r'(?:private readonly |const )' + name + r'\s*=\s*([\d.]+);', src)
    if not m:
        raise SystemExit(f'Main.ts 里找不到 {name}')
    return float(m.group(1))


GAP = read_const(os.path.join(ROOT, 'assets/scripts/ui/UIFactory.ts'), 'TILE_GAP')
GAP_THIN = read_const(os.path.join(ROOT, 'assets/scripts/ui/UIFactory.ts'), 'TILE_GAP_THIN')
BASE_W = read_main_const('BASE_TILE_W')
BASE_TOP = read_main_const('BASE_TOP_TILE_W')
BASE_SIDE = read_main_const('BASE_SIDE_TILE_W')
OTHERS = read_main_const('OTHERS_SCALE')
RATIO = 4 / 3

TILE_COUNT = 6
COL_BG = (26, 92, 58)          # 桌布绿, 缝隙透出来的就是它
BACK_FILL = (60, 90, 160)
BACK_EDGE = (36, 58, 108)
INK = (240, 240, 240)
SUB = (168, 178, 186)


def draw_back(d, x, y, w, h, r, zoom):
    d.rounded_rectangle([x, y, x + w * zoom, y + h * zoom], radius=r * zoom,
                        fill=BACK_FILL, outline=BACK_EDGE, width=max(1, int(zoom / 2)))


def strip(cell, gap, zoom, width=None):
    """按真实几何画一排牌背: 格位宽 = cell, 牌面 = cell - gap, 间距 = 格位"""
    h = cell * RATIO
    pad = 14 * zoom
    if width is None:
        # 首张左缘 = gap/2, 末张右缘 = n*cell - gap/2
        width = int((TILE_COUNT * cell - gap / 2) * zoom + pad * 2 + 1)
    hh = int(h * zoom + pad * 2)
    img = Image.new('RGB', (width, hh), COL_BG)
    d = ImageDraw.Draw(img)
    for i in range(TILE_COUNT):
        cx = pad + (cell / 2 + i * cell) * zoom
        fw = (cell - gap) * zoom
        fh = (h - gap) * zoom
        draw_back(d, cx - fw / 2, pad + (h * zoom - fh) / 2, fw, fh, 4, zoom)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zoom', type=float, default=6.0, help='放大倍数(默认 6)')
    ap.add_argument('--half-h', type=float, default=472.0, help='可见半高(默认 472=16:9 手机)')
    args = ap.parse_args()
    zoom = args.zoom

    # 平板/超宽屏 k=1.3 时牌会变大, 这里取 16:9 手机的 k=1
    # 旧实现里牌背 Graphics 又比节点内缩 2px, 实际缝隙 = gap + 2 —— 这才是"看着最宽"的原因
    LEGACY_INSET = 2
    groups = [
        ('上家手牌(格位 %.1f 宽)' % (BASE_TOP * OTHERS), BASE_TOP * OTHERS),
        ('左右家手牌(格位 %.1f 宽)' % (BASE_SIDE * OTHERS), BASE_SIDE * OTHERS),
    ]
    label_h = 34
    rows = []
    for title, cell in groups:
        for gap, tag, color in ((GAP + LEGACY_INSET, '改前', (255, 170, 150)),
                                (GAP_THIN, '改后', (150, 235, 170))):
            rows.append((title, tag, gap, color, strip(cell, gap, zoom)))

    width = max(r[4].width for r in rows) + 20
    height = sum(r[4].height + label_h for r in rows) + 20
    out = Image.new('RGB', (width, height), (18, 20, 24))
    d = ImageDraw.Draw(out)
    f_big = ImageFont.truetype(FONT_PATH, 20)
    f_small = ImageFont.truetype(FONT_PATH, 17)
    y = 10
    for title, tag, gap, color, im in rows:
        d.text((14, y + 4), f'{title} · {tag}: 缝 {gap:g}(内容坐标, 放大 {zoom:g}×)',
               font=f_small, fill=color)
        y += label_h
        out.paste(im, (10, y))
        y += im.height
    path = os.path.join(ROOT, 'ai-hand-gap-preview.png')
    out.save(path)
    print(f'已出图: {path}  牌背 {BASE_TOP * OTHERS:.1f}/{BASE_SIDE * OTHERS:.1f} 宽, '
          f'缝 {GAP:g} → {GAP_THIN:g}')


if __name__ == '__main__':
    main()
