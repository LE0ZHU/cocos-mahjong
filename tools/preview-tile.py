# -*- coding: utf-8 -*-
"""
镜像"牌面 = 素材图 1:1 铺满"的渲染, 输出 tile-face-preview.png。

当前设计(2026-10-16 定稿):
- 牌面 = tiles/*.png(由 tools/make-tile-faces.py 从高清原图加工: 缩到 240×320、
  圆角裁在图片上、四角透明), 铺满整张牌(width × height), 无任何程序化牌身装饰;
- 有图片时 TileView 隐藏 Bg(牌身); Bg 只在图片缺失时作为矢量兜底显示;
- 圆角半径 = 素材短边 × 12%(320 → 38px), 显示时随牌等比缩放。

⚠️ 改 UIFactory.createTileNode / TileView._applyDisplay / make-tile-faces.py 后,
本脚本必须同步, 否则预览会骗人。仅用于对照, 非引擎截图。
"""
from PIL import Image, ImageDraw, ImageFont

FONT = "C:/Windows/Fonts/msyh.ttc"
SRC_PNG = "assets/resources/tiles/1W.png"    # 加工后的素材(圆角透明)
DESK = (36, 72, 45)                          # 桌面毡布远端色, 用来看圆角透出的底色

# 两个有代表性的牌尺寸: 自家手牌 / 亮牌(结算面板)
TILES = [
    ("自家手牌 91×122", 91, 122, 4),
    ("亮牌/结算 100×133", 100, 133, 4),
]


def cell_canvas(w, h, s):
    img = Image.new('RGBA', (w * s + 60, h * s + 70), DESK)
    return img, s


def paste_tile(w, h, s):
    """按牌的显示尺寸把素材等比铺满(素材 240×320, 3:4; 牌同为 3:4 无变形)"""
    img = Image.new('RGBA', (w * s + 60, h * s + 70), DESK)
    face = Image.open(SRC_PNG).convert('RGBA').resize((w * s, h * s), Image.LANCZOS)
    img.paste(face, (30, 40), face)
    return img


def render_source():
    """素材原图(加工后的圆角 PNG), 按实际像素尺寸放大 3x 展示(读文件, 不写死尺寸)"""
    s = 3
    face = Image.open(SRC_PNG).convert('RGBA')
    w, h = face.size
    img = Image.new('RGBA', (w * s + 60, h * s + 70), (44, 48, 55, 255))
    face = face.resize((w * s, h * s), Image.LANCZOS)
    img.paste(face, (30, 40), face)
    return img


def main():
    f_title = ImageFont.truetype(FONT, 20)
    cols = [("素材 tiles/1W.png (圆角已裁在图上)", render_source())]
    for label, w, h, s in TILES:
        cols.append((f"{label} · 贴桌面", paste_tile(w, h, s)))

    gap = 14
    total_w = sum(c.width for _, c in cols) + gap * (len(cols) + 1)
    total_h = max(c.height for _, c in cols) + 40 + gap * 2
    canvas = Image.new('RGB', (total_w, total_h), (22, 24, 28))
    d = ImageDraw.Draw(canvas)
    x = gap
    for title, img in cols:
        d.text((x, gap - 2), title, font=f_title, fill=(232, 236, 240))
        canvas.paste(img.convert('RGB'), (x, gap + 34))
        x += img.width + gap
    canvas.save("tile-face-preview.png")
    print("saved tile-face-preview.png", canvas.size)


if __name__ == "__main__":
    main()
