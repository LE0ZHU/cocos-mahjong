# -*- coding: utf-8 -*-
"""
镜像"牌面金/青边框"的几何, 输出 tile-highlight-preview.png。

对账对象(全部按"贴着牌边画一圈"处理, 参数是同一套):
  TileView.drawDrawnMark()    刚摸到 · 金框(画在牌身**之下**)
  TileView.drawHintMark()     AI 建议 · 青框(画在牌身**之上**)
  TileView.drawDragGlow()     拖牌甩出 · 金框(画在牌身**之下**)
  Main.addClaimedRing()       副露触发牌 · 金边(画在牌身**之下**)
  SettlementPanel WinRing     胡牌那张 · 金边(画在牌身**之下**)

规则(2026-10-17 定稿):
- 圆角 = 短边 × 12%, 与牌面素材的裁剪比例(tools/make-tile-faces.py 的
  RADIUS_RATIO)一致。两者不同心时, 弧线会在角的"肩部"离牌边而去, 露出一道桌布色的缝。
- 画在牌身**之下**的圈, 路径必须按线宽一半外扩(亮金 +1 / 柔光 +2.5),
  让整个描边落在牌边之外, 内侧 0.5 藏在牌下 —— 否则内侧半个线宽被牌面盖掉,
  直边上只剩一条细线、角上被吃掉更多, 看起来就是"框断开、有缝"。

Cocos 的 Graphics.stroke() 以路径为中心向两侧各扩 lineWidth/2, 这里用
"外轮廓减内轮廓"复刻同一语义; 上下叠放顺序也照源码来。

改上面任一处后本脚本必须同步, 否则预览会骗人。
"""
import pathlib
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_PNG = ROOT / 'assets/resources/tiles/1W.png'
FONT = 'C:/Windows/Fonts/msyh.ttc'
DESK = (36, 72, 45, 255)      # 牌桌毡布(远端色), 用来看牌外有没有缝

def _radius_ratio() -> float:
    """直接从 TileView.ts 读圆角比例, 避免预览与源码漂移"""
    src = (ROOT / 'assets/scripts/ui/TileView.ts').read_text(encoding='utf-8')
    m = re.search(r'TILE_RADIUS_RATIO\s*=\s*([\d.]+)', src)
    if not m:
        raise SystemExit('TileView.ts 里找不到 TILE_RADIUS_RATIO')
    return float(m.group(1))


TILE_RADIUS_RATIO = _radius_ratio()   # 与 make-tile-faces.py 的 RADIUS_RATIO 必须相同
SS = 3                        # 掩膜超采样倍率
MARGIN = 10                   # 牌外留白(牌宽单位)


def rrect_mask(size, box, radius, ss=SS):
    """在 ss 倍画布上画填充圆角矩形, 再缩回目标尺寸(抗锯齿)"""
    w, h = size
    m = Image.new('L', (w * ss, h * ss), 0)
    x0, y0, x1, y1 = [v * ss for v in box]
    ImageDraw.Draw(m).rounded_rectangle(
        [x0, y0, x1, y1], radius=max(0.0, radius * ss), fill=255)
    return m.resize((w, h), Image.LANCZOS)


def _layer(size, mask, color):
    layer = Image.new('RGBA', size, color)
    layer.putalpha(mask.point(lambda v: v * color[3] // 255))
    return layer


def fill(img, cx, cy, w, h, r, color):
    size = img.size
    m = rrect_mask(size, (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), r)
    return Image.alpha_composite(img, _layer(size, m, color))


def stroke(img, cx, cy, w, h, r, line_w, color):
    """以 (cx,cy) 为中心、w×h / 半径 r 为路径, 描 line_w 宽的边(Cocos 语义: 居中)"""
    size = img.size
    half = line_w / 2.0
    outer = rrect_mask(size, (cx - w / 2 - half, cy - h / 2 - half,
                              cx + w / 2 + half, cy + h / 2 + half), r + half)
    iw, ih = w - line_w, h - line_w
    if iw > 0.5 and ih > 0.5:
        inner = rrect_mask(size, (cx - iw / 2, cy - ih / 2,
                                  cx + iw / 2, cy + ih / 2), r - half)
        outer = Image.composite(Image.new('L', size, 0), outer, inner)
    return Image.alpha_composite(img, _layer(size, outer, color))


def canvas(w, h, zoom):
    m = MARGIN * zoom
    img = Image.new('RGBA', (w * zoom + m * 2, h * zoom + m * 2), DESK)
    return img, img.width / 2.0, img.height / 2.0


def face_layer(w, h, zoom):
    """牌面素材按牌尺寸铺满(四角已圆角透明), 居中"""
    m = MARGIN * zoom
    sheet = Image.new('RGBA', (w * zoom + m * 2, h * zoom + m * 2), (0, 0, 0, 0))
    face = Image.open(SRC_PNG).convert('RGBA').resize((w * zoom, h * zoom), Image.LANCZOS)
    sheet.paste(face, (m, m))
    return sheet


def tile_radius(w, h):
    return min(w, h) * TILE_RADIUS_RATIO


def render(kind, w, h, zoom):
    img, cx, cy = canvas(w, h, zoom)
    W, H = w * zoom, h * zoom
    r = tile_radius(W, H)

    def ring(line_w, grow, color):
        """grow = 路径外扩量; 线宽 line_w → 内侧落在 grow - line_w/2"""
        return stroke(img, cx, cy, W + 2 * grow * zoom, H + 2 * grow * zoom,
                      r + grow * zoom, line_w * zoom, color)

    def soft(color, line_w=6, grow=2.5):
        return ring(line_w, grow, color)

    def bright(color, line_w=3):
        return ring(line_w, 1, color)

    if kind == 'drawn':
        img = fill(img, cx, cy, W + 10 * zoom, H + 10 * zoom, r + 5 * zoom, (255, 206, 96, 46))
        img = soft((255, 208, 110, 120))
        img = bright((255, 232, 150, 255))
    elif kind == 'glow':
        img = ring(7, 3, (255, 214, 120, 110))
        img = bright((255, 236, 168, 255))
    elif kind == 'claimed':
        img = ring(4, 1.5, (255, 214, 120, 110))
        img = ring(2, 0.5, (255, 232, 152, 235))

    img = Image.alpha_composite(img, face_layer(w, h, zoom))    # 牌身压在上面

    if kind == 'hint':
        img = soft((110, 226, 224, 120))
        img = bright((178, 244, 240, 255), 3)
    elif kind == 'win':
        img = bright((255, 206, 110, 220), 3)
    return img


def labelled(cells, path):
    f = ImageFont.truetype(FONT, 18)
    gap = 16
    pad_bottom = 14
    th = max(c.height for _, c in cells) + 26 + pad_bottom
    tw = sum(c.width for _, c in cells) + gap * (len(cells) + 1)
    out = Image.new('RGB', (tw, th), (22, 24, 28))
    d = ImageDraw.Draw(out)
    x = gap
    for title, img in cells:
        d.text((x, 5), title, font=f, fill=(232, 236, 240))
        out.paste(img.convert('RGB'), (x, 26))
        x += img.width + gap
    out.save(path)
    return out


def main():
    zoom = [('刚摸到 · 金框(牌下)', render('drawn', 63, 84, 7)),
            ('AI 提示 · 青框(牌上)', render('hint', 63, 84, 7)),
            ('拖牌甩出 · 金框(牌下)', render('glow', 63, 84, 7)),
            ('副露触发牌 · 金边 44 宽', render('claimed', 44, 59, 10)),
            ('胡牌那张 · 金边 100 宽', render('win', 100, 133, 4))]
    near = [('金框', render('drawn', 63, 84, 1)),
            ('青框', render('hint', 63, 84, 1)),
            ('副露', render('claimed', 44, 59, 1)),
            ('胡牌', render('win', 100, 133, 1))]

    top = labelled(zoom, ROOT / 'temp/hl-zoom.png')
    small = labelled(near, ROOT / 'temp/hl-1x.png')

    f = ImageFont.truetype(FONT, 18)
    out = Image.new('RGB', (max(top.width, small.width), top.height + small.height + 30), (22, 24, 28))
    ImageDraw.Draw(out).text((16, top.height + 4), '↓ 1:1 实际大小', font=f, fill=(150, 190, 160))
    out.paste(top, (0, 0))
    out.paste(small, (0, top.height + 30))
    out.save(ROOT / 'tile-highlight-preview.png')
    print('saved tile-highlight-preview.png', out.size)


if __name__ == '__main__':
    main()
