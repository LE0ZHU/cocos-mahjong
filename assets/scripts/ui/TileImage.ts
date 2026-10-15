import { resources, SpriteFrame } from 'cc';
import { Tile } from '../core/Tile';
import { TileSuit } from '../core/TileDefine';

/**
 * 牌面图片资源管理
 * 图片位于 assets/resources/tiles,运行时通过 resources.load 预加载为 SpriteFrame
 * 文件命名规则:
 *  万子  1~9W      (一萬~九萬)
 *  条子  1~9Tiao   (一条~九条)
 *  筒子  1~9Tong   (一筒~九筒)
 *  风牌  DongFeng / NanFeng / XiFeng / BeiFeng (东南西北)
 *  箭牌  HongZhong / FaCai / BaiPi            (中发白)
 */

/** 资源子目录 */
const TILE_DIR = 'tiles';

/** 加载完成的牌面缓存: 文件名 → SpriteFrame */
const cache = new Map<string, SpriteFrame>();

/** 全部牌面文件名 */
const ALL_NAMES: string[] = (() => {
    const names: string[] = [];
    for (let n = 1; n <= 9; n++) {
        names.push(`${n}W`, `${n}Tiao`, `${n}Tong`);
    }
    names.push('DongFeng', 'NanFeng', 'XiFeng', 'BeiFeng');
    names.push('HongZhong', 'FaCai', 'BaiPi');
    return names;
})();

/** 牌 → 对应的牌面图片文件名 */
export function getTileImageName(tile: Tile): string {
    switch (tile.suit) {
        case TileSuit.WAN:
            return `${tile.rank}W`;
        case TileSuit.TIAO:
            return `${tile.rank}Tiao`;
        case TileSuit.TONG:
            return `${tile.rank}Tong`;
        case TileSuit.FENG:
            return ['DongFeng', 'NanFeng', 'XiFeng', 'BeiFeng'][tile.rank - 1] ?? '';
        case TileSuit.JIAN:
            return ['HongZhong', 'FaCai', 'BaiPi'][tile.rank - 1] ?? '';
        default:
            return '';
    }
}

/** 取已加载的牌面 SpriteFrame(未加载则返回 null,交由原有矢量绘制兜底) */
export function getTileSpriteFrame(tile: Tile): SpriteFrame | null {
    return cache.get(getTileImageName(tile)) ?? null;
}

/** 预加载全部牌面图片,全部完成后回调 onReady */
export function preloadTileImages(onReady?: () => void): void {
    let pending = ALL_NAMES.length;
    for (const name of ALL_NAMES) {
        if (cache.has(name)) {
            pending--;
            continue;
        }
        resources.load(`${TILE_DIR}/${name}/spriteFrame`, SpriteFrame, (err, sf) => {
            if (!err && sf) {
                cache.set(name, sf);
            } else if (err) {
                console.warn(`[TileImage] 加载牌面失败: ${name}`, err);
            }
            pending--;
            if (pending === 0) onReady?.();
        });
    }
    if (pending === 0) onReady?.();
}
