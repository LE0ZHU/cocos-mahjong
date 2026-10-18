# -*- coding: utf-8 -*-
"""
把牌面素材加工成"圆角透明 PNG"(牌面完全按素材平铺, 圆角裁在图片上)。

背景: 牌面渲染为"素材图 1:1 铺满、无程序化牌身"(UIFactory.createTileNode + TileView),
因此素材本身的四角必须是"圆角 + 透明", 否则直角白角会直接压在深绿桌面上。

规则:
- 先按 3:4 居中裁掉多出来的边(素材偶尔差几个像素, 直接拉伸会让牌面轻微变形),
  再等比缩到 `--height`(默认 320, 见下面的取值理由), 最后裁圆角
- **圆角半径 = 短边 × 12%**(240×320 → 29px; 与 TileView.ts 的 TILE_RADIUS_RATIO 同源)。
  原始素材是纯白底的直角卡片, 圆角完全由这层 mask 决定, 想更圆只改这个比例
  (改完必须同步 TileView.ts 的 TILE_RADIUS_RATIO, 否则高光框与牌边不同心)。
- 抗锯齿: mask 以 8 倍超采样绘制后 LANCZOS 缩小
- meta 一律**保留**(uuid 不能变, 否则等于换了一张图), 只把里面的
  width/height/vertices 按新像素尺寸改一遍
- 源文件绝不删

【为什么缩到 320 高】真机上牌最高约 175 屏幕像素(手牌 122 内容 × 屏宽倍率),
320 是 1.8 倍超采样 —— 再大只是吃显存(RGBA 每张 300KB, 34 张约 10MB)看不清差别。
改这个值只影响清晰度与包体, 不影响任何排版算术。

用法:
  python tools/make-tile-faces.py --src "C:/Users/28337/Desktop/mahjong/paimian"
  python tools/make-tile-faces.py --src majiang_paimian --height 480
  python tools/make-tile-faces.py --out-dir temp/tile-faces-preview      # 试跑, 不写 assets
"""
import argparse
import json
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
FACES_DIR = ROOT / 'assets/resources/tiles'
RADIUS_RATIO = 0.12
SS = 8          # 超采样倍率(抗锯齿)
ASPECT = 3 / 4  # 宽 / 高
SUFFIXES = ('.png', '.jpg', '.jpeg')


def fit_aspect(img: Image.Image) -> Image.Image:
    """按 3:4 居中裁剪(只裁不补): 素材尺寸偶尔差几个像素, 直接拉伸会让牌面变形"""
    w, h = img.size
    if abs(w / h - ASPECT) < 1e-3:
        return img
    if w / h > ASPECT:          # 偏宽 → 裁左右
        nw = round(h * ASPECT)
        left = (w - nw) // 2
        return img.crop((left, 0, left + nw, h))
    nh = round(w / ASPECT)      # 偏高 → 裁上下
    top = (h - nh) // 2
    return img.crop((0, top, w, top + nh))


def round_corners(img: Image.Image) -> Image.Image:
    w, h = img.size
    r = max(3, round(min(w, h) * RADIUS_RATIO))
    mask = Image.new('L', (w * SS, h * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, w * SS - 1, h * SS - 1], radius=r * SS, fill=255)
    mask = mask.resize((w, h), Image.LANCZOS)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def sync_meta_size(meta_path: pathlib.Path, w: int, h: int) -> bool:
    """把 spriteFrame 子资源里的像素尺寸改成新图的(编辑器重新导入时也是这么算的)"""
    if not meta_path.exists():
        return False
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    sf = meta.get('subMetas', {}).get('f9941', {}).get('userData')
    if not sf:
        return False
    sf['width'] = w
    sf['height'] = h
    sf['rawWidth'] = w
    sf['rawHeight'] = h
    v = sf.get('vertices')
    if v:
        v['rawPosition'] = [-w / 2, -h / 2, 0, w / 2, -h / 2, 0, -w / 2, h / 2, 0, w / 2, h / 2, 0]
        v['uv'] = [0, h, w, h, 0, 0, w, 0]
        v['minPos'] = [-w / 2, -h / 2, 0]
        v['maxPos'] = [w / 2, h / 2, 0]
    with open(meta_path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')
    return True


def rewrite_meta(src_meta: pathlib.Path, out_path: pathlib.Path) -> None:
    """只有从来没生成过 PNG 时才从旧素材的 meta 改写一份(保留 uuid / hasAlpha / trimType)"""
    meta = json.loads(src_meta.read_text(encoding='utf-8'))
    meta['files'] = ['.png', '.json']
    meta['userData']['hasAlpha'] = True
    meta['subMetas']['f9941']['userData']['trimType'] = 'none'
    with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=None, help='源图目录(默认 assets/resources/tiles)')
    ap.add_argument('--out-dir', default=None, help='输出目录(默认 assets/resources/tiles)')
    ap.add_argument('--height', type=int, default=320, help='输出高度(像素), 0 = 不缩放')
    args = ap.parse_args()

    src_dir = pathlib.Path(args.src).resolve() if args.src else FACES_DIR
    out_dir = pathlib.Path(args.out_dir).resolve() if args.out_dir else FACES_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    # 只有"源就是目标目录"才删旧图 —— 从外部取源时那是原始素材, 绝不能删
    purge_src = src_dir == out_dir

    sources = sorted(p for p in src_dir.iterdir() if p.suffix.lower() in SUFFIXES)
    print(f'源 {src_dir}')
    print(f'共 {len(sources)} 张, 圆角 = 短边 × {RADIUS_RATIO:.1%}, 输出高 {args.height or "原尺寸"}')
    for src in sources:
        # 就地模式只做"旧的 jpg → png"迁移: 对已经加工过的 png 再裁一次圆角
        # 等于二次 mask(角上会发虚), 所以直接跳过
        if purge_src and src.suffix.lower() == '.png':
            continue
        img = Image.open(src)
        if args.height and img.size[1] != args.height:
            img = fit_aspect(img)
            w = max(1, round(args.height * ASPECT))
            img = img.resize((w, args.height), Image.LANCZOS)
        else:
            img = fit_aspect(img)

        png = out_dir / (src.stem + '.png')
        round_corners(img).save(png, optimize=True)

        png_meta = out_dir / (src.stem + '.png.meta')
        if not sync_meta_size(png_meta, img.size[0], img.size[1]):
            src_meta = src_dir / (src.name + '.meta')
            if src_meta.exists():
                rewrite_meta(src_meta, png_meta)
                sync_meta_size(png_meta, img.size[0], img.size[1])
            else:
                print(f'  ⚠️ 缺 meta, 需要在编辑器里重新导入: {png.name}.meta')

        if purge_src and src.suffix.lower() != '.png':
            src.unlink()
            try:
                (src_dir / (src.name + '.meta')).unlink()
            except OSError as e:
                print(f'  ⚠️ 旧 meta 删除失败, 请手工处理: {src.name}.meta ({e})')
        print(f'  {src.name} -> {png.name} {img.size[0]}x{img.size[1]}')

    if purge_src:
        # 自检: 一旦有残留, 同名不同后缀会让 resources.load 产生歧义
        leftovers = sorted(p.name for p in src_dir.iterdir()
                           if p.suffix.lower() in ('.jpg', '.jpeg'))
        if leftovers:
            print('⚠️⚠️ 仍有 jpg 残留, 必须手工删除:', leftovers)
    print('完成')


if __name__ == '__main__':
    main()
