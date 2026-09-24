import { expect, test, vi } from "vitest";

import { INTRO_REMIND_DAYS } from "../js/config.js";
import {
    LAST_VISIT_KEY,
    closeDialog,
    openDialog,
    readLastVisit,
    shouldShowIntro,
    writeLastVisit,
} from "../js/notice.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

const makeStorage = (entries = {}) => {
    const map = new Map(Object.entries(entries));
    return {
        getItem: (key) => map.has(key) ? map.get(key) : null,
        setItem: (key, value) => {
            map.set(key, String(value));
        },
    };
};

const makeDialog = () => {
    document.body.innerHTML = "<dialog id=\"dialog\"></dialog>";
    return document.getElementById("dialog");
};

test("readLastVisit returns null when nothing is stored", () => {
    expect(readLastVisit(makeStorage())).toBeNull();
});

test("readLastVisit parses a stored timestamp", () => {
    expect(readLastVisit(makeStorage({ [LAST_VISIT_KEY]: String(NOW) }))).toBe(NOW);
});

test("readLastVisit treats unparsable values as missing", () => {
    expect(readLastVisit(makeStorage({ [LAST_VISIT_KEY]: "not-a-number" }))).toBeNull();
});

test("readLastVisit tolerates unavailable storage", () => {
    const storage = {
        getItem: () => {
            throw new Error("denied");
        },
    };
    expect(readLastVisit(storage)).toBeNull();
});

test("writeLastVisit stores the timestamp as a string", () => {
    const storage = makeStorage();
    writeLastVisit(storage, NOW);
    expect(storage.getItem(LAST_VISIT_KEY)).toBe(String(NOW));
});

test("writeLastVisit swallows storage failures", () => {
    const storage = {
        setItem: () => {
            throw new Error("quota exceeded");
        },
    };
    expect(() => writeLastVisit(storage, NOW)).not.toThrow();
});

test("shouldShowIntro only fires for a first visit or after the remind window", () => {
    expect(shouldShowIntro(null, NOW)).toBe(true);
    expect(shouldShowIntro(NOW - 29 * DAY_MS, NOW)).toBe(false);
    // 边界：恰好 INTRO_REMIND_DAYS 天不提示，超过才提示
    expect(shouldShowIntro(NOW - INTRO_REMIND_DAYS * DAY_MS, NOW)).toBe(false);
    expect(shouldShowIntro(NOW - (INTRO_REMIND_DAYS * DAY_MS + 1), NOW)).toBe(true);
});

test("openDialog prefers the native modal API", () => {
    const dialog = makeDialog();
    const showModal = vi.fn();
    dialog.showModal = showModal;
    openDialog(dialog);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute("open")).toBe(false);
});

test("openDialog falls back to the open attribute without showModal", () => {
    const dialog = makeDialog();
    openDialog(dialog);
    expect(dialog.hasAttribute("open")).toBe(true);
});

test("closeDialog prefers the native close API", () => {
    const dialog = makeDialog();
    dialog.setAttribute("open", "");
    const close = vi.fn();
    dialog.close = close;
    closeDialog(dialog);
    expect(close).toHaveBeenCalledTimes(1);
});

test("closeDialog falls back to removing the open attribute", () => {
    const dialog = makeDialog();
    dialog.setAttribute("open", "");
    closeDialog(dialog);
    expect(dialog.hasAttribute("open")).toBe(false);
});
