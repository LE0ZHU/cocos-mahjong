# -*- coding: utf-8 -*-
"""
把牌面素材加工成"圆角透明 PNG"(牌面完全按素材平铺, 圆角裁在图片上, 尺寸不变)。

背景: 牌面渲染为"素材图 1:1 铺满、无程序化牌身"(UIFactory.createTileNode + TileView),
因此素材本身的四角必须是"圆角 + 透明", 否则直角白角会直接压在深绿桌面上。

规则:
- 尺寸不变、不补边; 圆角外直接透明(直通 alpha, 与引擎混合方式匹配)
- **圆角半径 = 短边 × 12%**(75×100 → 9px; 手牌 63 宽时约 7.6px)。
  原始素材是纯白底的直角卡片, 圆角完全由这层 mask 决定, 想更圆只改这个比例
  (改完必须同步 TileView.ts 的 TILE_RADIUS_RATIO, 否则高光框与牌边不同心)。
- 抗锯齿: mask 以 8 倍超采样绘制后 LANCZOS 缩小
- meta 一律**保留**: 已有的 `*.png.meta` 原样不动(uuid / hasAlpha / trimType 都对),
  只有从来没生成过 PNG 时才从旧的 `*.jpg.meta` 改写一份
- 就地转换时删除同目录的旧 `.jpg` 与 `.jpg.meta`
  (同名不同后缀会让 resources.load 产生歧义); 从别处取源(--src)时绝不删源文件

用法:
  python tools/make-tile-faces.py                          # 就地加工 assets/resources/tiles 里的 jpg
  python tools/make-tile-faces.py --src majiang_paimian    # 从原始 jpg 重新生成, 写进 assets/resources/tiles
  python tools/make-tile-faces.py --out-dir temp/tile-faces-preview   # 试跑, 不动源目录
"""
import argparse
import json
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
FACES_DIR = ROOT / 'assets/resources/tiles'
RADIUS_RATIO = 0.12
SS = 8   # 超采样倍率(抗锯齿)


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


def rewrite_meta(jpg_meta: pathlib.Path, out_path: pathlib.Path) -> None:
    meta = json.loads(jpg_meta.read_text(encoding='utf-8'))
    meta['files'] = ['.png', '.json']
    meta['userData']['hasAlpha'] = True
    meta['subMetas']['f9941']['userData']['trimType'] = 'none'
    with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=None, help='源 jpg 目录(默认 assets/resources/tiles)')
    ap.add_argument('--out-dir', default=None, help='输出目录(默认 assets/resources/tiles)')
    args = ap.parse_args()

    src_dir = pathlib.Path(args.src).resolve() if args.src else FACES_DIR
    out_dir = pathlib.Path(args.out_dir).resolve() if args.out_dir else FACES_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    # 只有"源就是目标目录"才删旧 jpg —— 从 majiang_paimian 取源时那是原始素材, 绝不能删
    purge_jpg = src_dir == out_dir

    jpgs = sorted(src_dir.glob('*.jpg'))
    print(f'源 {src_dir}')
    print(f'共 {len(jpgs)} 张, 圆角 = 短边 × {RADIUS_RATIO:.1%}')
    for jpg in jpgs:
        img = Image.open(jpg)
        png = out_dir / (jpg.stem + '.png')
        round_corners(img).save(png, optimize=True)

        png_meta = out_dir / (jpg.stem + '.png.meta')
        if not png_meta.exists():
            jpg_meta = src_dir / (jpg.name + '.meta')
            if jpg_meta.exists():
                rewrite_meta(jpg_meta, png_meta)
            else:
                print(f'  ⚠️ 缺 meta, 需要手工补: {png.name}.meta')

        if purge_jpg:
            jpg.unlink()
            try:
                (src_dir / (jpg.name + '.meta')).unlink()
            except OSError as e:
                print(f'  ⚠️ 旧 meta 删除失败, 请手工处理: {jpg.name}.meta ({e})')
        print(f'  {jpg.name} -> {png.name}')

    if purge_jpg:
        # 自检: 一旦有残留, 同名不同后缀会让 resources.load 产生歧义
        leftovers = sorted(
            p.name for p in list(src_dir.glob('*.jpg')) + list(src_dir.glob('*.jpg.meta')))
        if leftovers:
            print('⚠️⚠️ 仍有 jpg 残留, 必须手工删除:', leftovers)
    print('完成')


if __name__ == '__main__':
    main()
