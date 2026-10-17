/**
 * 玩家侧"宣告听牌(立直)"的提醒与兜底 —— 接线验证
 *
 * 背景: AI 是**一摸到听牌就自动宣告**的(白拿 +1 番), 玩家却只能自己点按钮,
 * 而 2^番 计分下这 1 番 = 分数直接翻倍。三件事缺一不可, 少一件玩家就会莫名其妙少一半分:
 *   1) 听牌那一刻按钮要**真的出现**(曾经晚一拍: 按钮在那次 `_refreshInfo` 之后才被点亮);
 *   2) 按钮要**显眼**(持续脉冲) + 提示文案要说清"+1 番";
 *   3) 玩家发呆超时 → 系统先替他宣告, 再打出刚摸的那张(见 timeout-test 第 9 组)。
 *
 * GameManager / Main 都依赖 cc 引擎, 这里用**源码结构检查**: 这类"接线漏一条"的
 * bug 靠跑不起来(也跑不动)的 UI 单测抓不到, 而字符串断言能。
 */
declare const require: (m: string) => any;
declare const __dirname: string;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');

function findFile(rel: string): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const p = path.join(dir, ...rel.split('/'));
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        dir = path.dirname(dir);
    }
    throw new Error(`找不到 ${rel}`);
}

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}

const main = fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8');
const gm = fs.readFileSync(findFile('assets/scripts/managers/GameManager.ts'), 'utf8');

console.log('\n=== 1. 听牌那一刻按钮必须出现 ===');
check(/onTenpaiChanged\s*=\s*\(seat\)\s*=>\s*\{[\s\S]{0,200}_refreshRiichiButton\(\)/.test(main),
    'onTenpaiChanged 里刷新了「听牌」按钮(否则按钮晚一拍, 玩家会错过宣告时机)');
check(/if \(seat === 0\)[\s\S]{0,80}_refreshRiichiButton/.test(main),
    '只对玩家座位刷新(别家听牌不该点亮玩家的按钮)');

console.log('\n=== 2. 提示必须说清"点听牌 +1 番" ===');
check(/private _showTenpai\([\s\S]{0,600}canRiichi/.test(main), '_showTenpai 里判断了 canRiichi');
check(/private _showTenpai\([\s\S]{0,600}点「听牌」\+1 番/.test(main), '文案里点明"点「听牌」+1 番"');
check(/canRiichi[\s\S]{0,120}\?\s*' · 点/.test(main), '只有"还能宣告"时才加这句(宣告过/有副露就不打扰)');

console.log('\n=== 3. 按钮要持续脉冲(不是亮一下就完) ===');
check(/update\(dt: number\): void \{[\s\S]{0,400}_updateRiichiPulse\(dt\)/.test(main),
    'update() 每帧驱动脉冲');
check(/private _updateRiichiPulse\([\s\S]{0,900}setScale/.test(main), '脉冲真的改了按钮缩放');
check(/if \(!btn\.active\)[\s\S]{0,200}setScale\(1, 1, 1\)/.test(main),
    '按钮隐藏时把缩放复位(否则下次亮出来是歪的尺寸)');

console.log('\n=== 4. 按钮显示条件与宣告条件同源 ===');
check(/private _refreshRiichiButton\([\s\S]{0,300}canRiichi/.test(main),
    '按钮显隐直接读 GameManager.canRiichi(不在 UI 里另写一套条件)');
check(/get canRiichi\(\): boolean \{[\s\S]{0,700}melds\.length > 0\) return false/.test(gm),
    'canRiichi 要求门清(与 AI 自动宣告同一条件)');
check(/get canRiichi\(\): boolean \{[\s\S]{0,700}this\._player\.tenpai/.test(gm),
    'canRiichi 要求真的听牌');

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
