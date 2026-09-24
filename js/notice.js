import { INTRO_REMIND_DAYS } from "./config.js";

export const LAST_VISIT_KEY = "maa-training-list.last-visit";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 读取上次访问时间戳；存储不可用或没有合法记录时返回 null（按首次访问处理）。 */
export const readLastVisit = (storage) => {
    try {
        const raw = storage.getItem(LAST_VISIT_KEY);
        if (!raw) {
            return null;
        }
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    } catch {
    // localStorage 不可用（隐私模式、禁用 Cookie）时按首次访问处理
        return null;
    }
};

/** 记录本次访问时间；写入失败时静默忽略，提示功能不应阻断页面主流程。 */
export const writeLastVisit = (storage, now) => {
    try {
        storage.setItem(LAST_VISIT_KEY, String(now));
    } catch {
    // 同 readLastVisit：存储不可用不影响分析功能
    }
};

export const shouldShowIntro = (lastVisit, now) => lastVisit === null || now - lastVisit > INTRO_REMIND_DAYS * DAY_MS;

// jsdom 只实现了 <dialog> 的 open 属性反射（没有 showModal/show/close，见 tests/notice.test.mjs），
// 因此保留属性回退分支；真实浏览器走原生模态，可拿到 ::backdrop、焦点陷阱与 ESC 关闭
export const openDialog = (dialog) => {
    if (typeof dialog.showModal === "function") {
        dialog.showModal();
        return;
    }
    dialog.setAttribute("open", "");
};

export const closeDialog = (dialog) => {
    if (typeof dialog.close === "function") {
        dialog.close();
        return;
    }
    dialog.removeAttribute("open");
};
