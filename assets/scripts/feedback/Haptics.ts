import { sys } from 'cc';

/**
 * 触觉反馈(震动)
 *
 * 【为什么有这个模块】横屏麻将整局手机握在手里, 碰/杠/胡这几个"重大事件"
 * 光有声音不够 —— 牌桌上视线常停在手牌区, 一次短震比音效更直接(成本也低)。
 *
 * 【各平台口径】
 *  - 原生(Android): 引擎 C++ `cc::Device::vibrate(float seconds)` 的 JS 绑定,
 *    时长单位是**秒**。参数最终落到 Android 的
 *    `Vibrator.vibrate(VibrationEffect.createOneShot(duration*1000, DEFAULT_AMPLITUDE))`。
 *    需要在 AndroidManifest 里声明 `android.permission.VIBRATE`
 *    (引擎的 Java 侧把 SecurityException 吞掉了 —— 不声明不会崩, 但也不会震)。
 *    iOS 上引擎的 Vibrator 是空实现(3.8 现状), 调用无效果, 这里照常调用不特判。
 *  - Web / 编辑器预览: 标准 `navigator.vibrate(ms)`, 时长单位是**毫秒**;
 *    iOS Safari 不支持(vibrate 不存在) → 跳过, 不弹错。
 *
 * 【为什么两个名字都试】引擎把 `cc::Device` 绑定到 jSB 命名空间上, 历史上
 * 既有 `jsb.Device`(大写, 社区实测在 3.x 上可用) 又有 `jsb.device`(小写,
 * 引擎自己的适配层用它取 getDevicePixelRatio)。版本间不保证哪个带 vibrate,
 * 所以按名字**逐个探测**, 谁有 vibrate 用谁; 都没有就静默跳过 ——
 * 震动只是锦上添花, 任何平台上取不到都不该让牌局出错。
 *
 * 类型声明里没有 vibrate(temp/declarations/jsb.d.ts 只声明了 device 的部分方法),
 * 所以这里做运行期探测, 而不是直接写 `jsb.Device.vibrate(...)`。
 */

/** 碰/杠: 短促一下, 只做"收到"的确认, 不抢注意力(毫秒) */
const MS_MELD = 30;
/** 胡牌: 比副露重一点(局面到此结束), 但也别拖泥带水(毫秒) */
const MS_HU = 60;

/** 原生 jsb 上带 vibrate 的 Device 对象(取不到返回 null, 不抛错) */
function nativeDevice(): { vibrate: (seconds: number) => void } | null {
    // jsb 只在原生平台存在: 直接用 typeof 判存在, Web 上引用未定义标识符不会抛错
    if (typeof jsb === 'undefined') return null;
    const bag = jsb as unknown as Record<string, { vibrate?: unknown } | undefined>;
    for (const name of ['Device', 'device']) {
        const d = bag[name];
        if (d && typeof d.vibrate === 'function') {
            return d as unknown as { vibrate: (seconds: number) => void };
        }
    }
    return null;
}

/**
 * 震一次(毫秒) —— 不支持的平台静默跳过
 *
 * 全程 try/catch: 震动是附加反馈, 某些机型/权限缺失会抛异常(或 WebView 里
 * navigator.vibrate 被策略拦截), 绝不能让它影响牌局流程。
 */
function vibrateMs(ms: number): void {
    try {
        if (sys.isNative) {
            // 原生接口时长单位是秒(见文件头说明), 这里统一用毫秒定义、调用时换算
            nativeDevice()?.vibrate(ms / 1000);
            return;
        }
        // Web / 小游戏: navigator.vibrate(ms); 不支持时(macOS Safari、桌面 Firefox)直接跳过
        const nav = (globalThis as unknown as {
            navigator?: { vibrate?: (pattern: number | number[]) => boolean };
        }).navigator;
        if (nav && typeof nav.vibrate === 'function') nav.vibrate(ms);
    } catch (e) {
        console.warn('[震动] 调用失败(已忽略)', e);
    }
}

/**
 * 碰/杠时的震动
 *
 * 自家与 AI 的副露都震 —— 与"吃碰杠"的语音播报同一口径(见 Main 的 onMeld):
 * AI 副露同样改变局面, 一声"碰"配一下轻震, 视线不在牌桌上也知道发生了什么。
 */
export function vibrateMeld(): void {
    vibrateMs(MS_MELD);
}

/** 胡牌时的震动(任意一家胡; 挂在结算回调上, 流局不震 —— 同硬约束 11b 的口径) */
export function vibrateHu(): void {
    vibrateMs(MS_HU);
}
