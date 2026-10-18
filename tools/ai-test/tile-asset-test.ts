/**
 * 牌面图片资源自检(2026-10-18: 换成高清素材后加)
 *
 * 锁住四条 —— 它们任何一条破了, 真机上都会表现成"糊 / 白角 / 拉伸 / 加载不到",
 * 而且都不会报错, 只会难看:
 *  A 34 张牌面齐全, 且没有同名 jpg 残留(resources.load 按名加载, 同名会歧义)
 *  B 每张都是 3:4、240×320(与 tools/make-tile-faces.py 的 --height 一致)
 *  C 带 alpha(圆角透明靠它), 四角 alpha = 0、中心 alpha = 255
 *  D *.png.meta 里的子资源尺寸/顶点与真实像素一致(uuid 不能变, 否则等于换图)
 *
 * 用法: tsc 编译后 node 跑(见 tools/ai-test/README 的通用跑法)
 */
declare const require: (m: string) => any;
declare const __dirname: string;
declare const Buffer: any;
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function findRoot(): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(dir, 'assets', 'resources', 'tiles'))) return dir;
        dir = path.dirname(dir);
    }
    throw new Error('找不到项目根目录');
}

const ROOT = findRoot();
const TILE_DIR = path.join(ROOT, 'assets', 'resources', 'tiles');

/** 期望的 34 个文件名(与 assets/scripts/ui/TileImage.ts 的 ALL_NAMES 同源) */
const NAMES: string[] = (() => {
    const n: string[] = [];
    for (let i = 1; i <= 9; i++) n.push(`${i}W`, `${i}Tiao`, `${i}Tong`);
    n.push('DongFeng', 'NanFeng', 'XiFeng', 'BeiFeng');
    n.push('HongZhong', 'FaCai', 'BaiPi');
    return n;
})();

const EXPECT_H = 320;
const EXPECT_W = 240;

let fails = 0;
function check(ok: boolean, msg: string, detail = ''): void {
    if (ok) {
        console.log(`  ✓ ${msg}${detail ? '  (' + detail + ')' : ''}`);
    } else {
        fails++;
        console.log(`  ✗ ${msg}${detail ? '  (' + detail + ')' : ''}`);
    }
}

/** 读 PNG 头: 宽高 / 位深 / 颜色类型(type 6 = RGBA) */
function readPngHeader(file: string): { w: number; h: number; depth: number; color: number } {
    const buf: any = fs.readFileSync(file);
    const sigOk = buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!sigOk) throw new Error('不是 PNG: ' + file);
    return {
        w: buf.readUInt32BE(16),
        h: buf.readUInt32BE(20),
        depth: buf.readUInt8(24),
        color: buf.readUInt8(25),
    };
}

/**
 * 解 PNG 像素(只支持 8bit RGBA, 足够覆盖牌面素材)。
 * 不引第三方库: zlib 是 node 内置, 剩下就是按规范还原 5 种行过滤器。
 */
function readPngPixels(file: string): { w: number; h: number; data: any } {
    const buf: any = fs.readFileSync(file);
    let off = 8;
    let w = 0;
    let h = 0;
    let depth = 0;
    let color = 0;
    const idat: any[] = [];
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.slice(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            w = data.readUInt32BE(0);
            h = data.readUInt32BE(4);
            depth = data.readUInt8(8);
            color = data.readUInt8(9);
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        off += 12 + len;
    }
    if (depth !== 8 || color !== 6) throw new Error('只支持 8bit RGBA: ' + file);
    const raw: any = zlib.inflateSync(Buffer.concat(idat));
    const bpp = 4;
    const stride = w * bpp;
    const out = Buffer.alloc(h * stride);
    let pos = 0;
    for (let y = 0; y < h; y++) {
        const filter = raw[pos++];
        const rowStart = y * stride;
        for (let x = 0; x < stride; x++) {
            const cur = raw[pos + x];
            const a = x >= bpp ? out[rowStart + x - bpp] : 0;
            const b = y > 0 ? out[rowStart - stride + x] : 0;
            const c = y > 0 && x >= bpp ? out[rowStart - stride + x - bpp] : 0;
            let v: number;
            if (filter === 0) v = cur;
            else if (filter === 1) v = cur + a;
            else if (filter === 2) v = cur + b;
            else if (filter === 3) v = cur + ((a + b) >> 1);
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                v = cur + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
            } else {
                throw new Error('未知 PNG 行过滤器 ' + filter + ': ' + file);
            }
            out[rowStart + x] = v & 0xff;
        }
        pos += stride;
    }
    return { w, h, data: out };
}

console.log('\n[1] 34 张牌面齐全, 无同名 jpg 残留');
{
    const files: string[] = fs.readdirSync(TILE_DIR);
    for (const name of NAMES) {
        check(files.indexOf(`${name}.png`) >= 0, `${name}.png 存在`);
        check(files.indexOf(`${name}.png.meta`) >= 0, `${name}.png.meta 存在`);
    }
    const jpgs = files.filter(f => /\.jpe?g(\.meta)?$/i.test(f));
    check(jpgs.length === 0, '没有 jpg / jpg.meta 残留(同名不同后缀会让 resources.load 歧义)',
        jpgs.join(', ') || '干净');
    const pngs = files.filter(f => f.toLowerCase().endsWith('.png'));
    check(pngs.length === NAMES.length, `png 数量 = ${NAMES.length}`, `实际 ${pngs.length}`);
}

console.log('\n[2] 尺寸 / 通道(3:4, 240×320, RGBA)');
{
    let badSize = 0, badColor = 0;
    for (const name of NAMES) {
        const h = readPngHeader(path.join(TILE_DIR, `${name}.png`));
        if (h.w !== EXPECT_W || h.h !== EXPECT_H) {
            badSize++;
            console.log(`    ${name}: ${h.w}×${h.h}`);
        }
        // Cocos 的 alpha 通道要求 RGBA(或灰度+alpha); 这里统一要求 6
        if (h.color !== 6) badColor++;
    }
    check(badSize === 0, `全部 ${EXPECT_W}×${EXPECT_H}(手牌 91 宽 / 真机约 175px 高, 1.8 倍超采样)`,
        badSize ? `${badSize} 张不符` : '34/34');
    check(badColor === 0, '全部带 alpha 通道(四角透明靠它)', badColor ? `${badColor} 张不符` : 'RGBA');
}

console.log('\n[3] 圆角: 四角透明、中心不透明');
{
    let bad = 0;
    for (const name of NAMES) {
        const px = readPngPixels(path.join(TILE_DIR, `${name}.png`));
        const a = (x: number, y: number): number => px.data[(y * px.w + x) * 4 + 3];
        const corners = [a(0, 0), a(px.w - 1, 0), a(0, px.h - 1), a(px.w - 1, px.h - 1)];
        const center = a(Math.floor(px.w / 2), Math.floor(px.h / 2));
        const ok = corners.every(v => v === 0) && center === 255;
        if (!ok) {
            bad++;
            console.log(`    ${name}: 角 ${corners.join('/')} 中心 ${center}`);
        }
    }
    check(bad === 0, '四角 alpha = 0 且中心 alpha = 255(圆角已裁在图片上)', bad ? `${bad} 张不符` : '34/34');
}

console.log('\n[4] meta 的 spriteFrame 尺寸与真实像素一致(uuid 不变)');
{
    let mismatch = 0, noAlpha = 0, trimmed = 0;
    for (const name of NAMES) {
        const png = path.join(TILE_DIR, `${name}.png`);
        const metaPath = `${png}.meta`;
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const sf = meta.subMetas && meta.subMetas.f9941 && meta.subMetas.f9941.userData;
        const h = readPngHeader(png);
        if (!sf || sf.width !== h.w || sf.height !== h.h) {
            mismatch++;
            console.log(`    ${name}: meta ${sf && sf.width}×${sf && sf.height} vs 实际 ${h.w}×${h.h}`);
        }
        if (!meta.userData || meta.userData.hasAlpha !== true) noAlpha++;
        if (!sf || sf.trimType !== 'none') trimmed++;
    }
    check(mismatch === 0, 'meta 的 width/height 与实际像素一致', mismatch ? `${mismatch} 张不符` : '34/34');
    check(noAlpha === 0, 'meta 里 hasAlpha = true', noAlpha ? `${noAlpha} 张不符` : '');
    check(trimmed === 0, 'trimType = none(不许自动裁边, 否则圆角会被裁掉)', trimmed ? `${trimmed} 张不符` : '');
}

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
