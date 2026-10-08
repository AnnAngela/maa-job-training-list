import { beforeEach, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

vi.mock("../js/maa.js", () => ({
    fetchAllAssignments: vi.fn(),
    fetchAssignmentsSnapshot: vi.fn(),
}));
vi.mock("../js/skland.js", async (importOriginal) => ({
    ...await importOriginal(),
    fetchBindingList: vi.fn(),
    getSklandOperatorData: vi.fn(),
    parseCredential: vi.fn(),
}));

import {
    buildMaaTrainingPlan,
    csvEscape,
    downloadFile,
    initApp,
    normalizeImportedOperators,
    SKLAND_CREDENTIAL_KEY,
} from "../js/app.js";
import { INTRO_REMIND_DAYS, SKLAND_COMMAND } from "../js/config.js";
import { fetchAllAssignments, fetchAssignmentsSnapshot } from "../js/maa.js";
import { LAST_VISIT_KEY } from "../js/notice.js";
import { fetchBindingList, getSklandOperatorData, parseCredential } from "../js/skland.js";
import realOperatorMeta from "../data/operator_meta.json";
import playerInfo from "./fixtures/skland-player-info.json";

const operatorMeta = {
    nameToCharId: { 阿米娅: "char_002_amiya", 陈: "char_chen", 凯尔希: "char_003_kalts" },
    operators: {
        char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] },
        char_chen: { name: "陈", rarity: 6, profession: "WARRIOR", skills: [] },
        char_003_kalts: { name: "凯尔希", rarity: 6, profession: "MEDIC", skills: [] },
    },
};
const skillSprite = { spriteUrl: "https://example.com/s.jpg", size: 128, entries: {} };

const makeFetchImpl = () => vi.fn((url) => {
    if (url.includes("operator_meta")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(operatorMeta) });
    }
    if (url.includes("skill_sprite")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(skillSprite) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
});

const buildDom = () => {
    document.body.innerHTML = [
        "<span id=\"status\"></span>",
        "<div id=\"error\" class=\"error is-hidden\"></div>",
        "<div id=\"summary\"></div>",
        "<div id=\"training-table\"></div>",
        "<button id=\"refresh-button\"></button>",
        "<form id=\"skland-form\"><input id=\"cred-input\" type=\"password\"></form>",
        "<code id=\"skland-command\"></code>",
        "<button id=\"copy-command-button\"></button>",
        "<div id=\"binding-list\"></div>",
        "<button id=\"import-button\"></button>",
        "<textarea id=\"import-input\"></textarea>",
        "<button id=\"export-json-button\"></button>",
        "<button id=\"export-csv-button\"></button>",
        "<button id=\"export-plan-button\"></button>",
        "<button id=\"sample-button\"></button>",
        "<input id=\"filter-input\" type=\"search\">",
        "<input id=\"only-pending-input\" type=\"checkbox\">",
        "<input id=\"only-missing-input\" type=\"checkbox\">",
        "<input id=\"require-module-input\" type=\"checkbox\">",
        "<input id=\"recent-toggle\" type=\"checkbox\">",
        "<input id=\"standard-toggle\" type=\"checkbox\">",
        "<dialog id=\"intro-dialog\"></dialog>",
        "<button id=\"intro-close-button\"></button>",
        "<dialog id=\"plan-copy-dialog\"><textarea id=\"plan-copy-textarea\" readonly></textarea><button id=\"plan-copy-close-button\"></button></dialog>",
        "<dialog id=\"plan-done-dialog\"><p id=\"plan-done-message\"></p><button id=\"plan-done-close-button\"></button></dialog>",
    ].join("");
};

beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    buildDom();
});

test("initApp bootstraps with live assignments", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.state.operatorMeta).toEqual(operatorMeta);
    expect(app.state.assignmentSource).toBe("live");
});

test("initApp falls back to snapshot when live fails", async () => {
    fetchAllAssignments.mockRejectedValue(new Error("network down"));
    fetchAssignmentsSnapshot.mockResolvedValue({ total: 0, assignments: [], generatedAt: "2024-01-01T00:00:00Z" });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.state.assignmentSource).toBe("snapshot");
});

test("initApp surfaces fatal load error", async () => {
    fetchAllAssignments.mockRejectedValue(new Error("network down"));
    fetchAssignmentsSnapshot.mockRejectedValue(new Error("snapshot down"));
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.state.status).toBe("加载失败");
    expect(app.state.error).toContain("snapshot down");
});

test("initApp surfaces static data request failure", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const fetchImpl = vi.fn((_url) => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    const app = await initApp({ fetchImpl });
    expect(app.state.status).toBe("加载失败");
    expect(app.state.error).toContain("请求失败");
});

test("initApp invokes live progress callback", async () => {
    fetchAllAssignments.mockImplementation((_fetchImpl, { onProgress }) => {
        onProgress({ page: 1, total: 3, hasNext: false });
        return Promise.resolve({ total: 3, assignments: [] });
    });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.state.status).toContain("已加载 3 份作业");
});

test("initApp rejects when a required element is missing", async () => {
    document.getElementById("summary").remove();
    await expect(initApp({ fetchImpl: makeFetchImpl() })).rejects.toThrow("missing element #summary");
});

test("normalizeImportedOperators accepts array and wrapped operators", () => {
    const item = { name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 1 };
    const fromArray = normalizeImportedOperators([item], operatorMeta);
    expect(fromArray[0]).toMatchObject({ charId: "char_002_amiya", name: "阿米娅", elite: 2 });
    const wrapped = normalizeImportedOperators({ operators: [item] }, operatorMeta);
    expect(wrapped[0].name).toBe("阿米娅");
    const withModules = normalizeImportedOperators([{ ...item, modules: [{ id: "m1", name: "模组甲", level: 2 }] }], operatorMeta);
    expect(withModules[0].modules).toEqual([{ id: "m1", name: "模组甲", level: 2 }]);
    expect(() => normalizeImportedOperators({ bad: true }, operatorMeta)).toThrow("导入数据应为数组");
});

test("normalizeImportedOperators accepts raw Skland player/info payload", () => {
    const raw = {
        code: 0,
        message: "OK",
        data: {
            chars: [
                {
                    charId: "char_002_amiya",
                    evolvePhase: 2,
                    level: 60,
                    mainSkillLvl: 7,
                    skills: [
                        { id: "s1", specializeLevel: 0 },
                        { id: "s2", specializeLevel: 3 },
                        { id: "s3", specializeLevel: 2 },
                    ],
                    equip: [
                        { id: "m1", level: 1, locked: false },
                        { id: "m2", level: 3, locked: true },
                    ],
                },
            ],
        },
    };
    const rows = normalizeImportedOperators(raw, operatorMeta);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
        charId: "char_002_amiya",
        name: "阿米娅",
        elite: 2,
        level: 60,
        skill1: 7,
        skill2: 10,
        skill3: 9,
        maxModuleLevel: 1,
    });
});

test("normalizeImportedOperators accepts data.operators and bare chars wrappers", () => {
    const item = { name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 1 };
    const viaData = normalizeImportedOperators({ data: { operators: [item] } }, operatorMeta);
    expect(viaData[0].name).toBe("阿米娅");
    const rawChars = [
        {
            charId: "char_002_amiya",
            evolvePhase: 1,
            level: 40,
            mainSkillLvl: 5,
            skills: [{ id: "s1", specializeLevel: 1 }],
            equip: [],
        },
    ];
    const viaChars = normalizeImportedOperators({ chars: rawChars }, operatorMeta);
    expect(viaChars[0]).toMatchObject({ charId: "char_002_amiya", name: "阿米娅", elite: 1, level: 40, skill1: 6, maxModuleLevel: 0 });
});

test("normalizeImportedOperators imports the fixture player/info payload", () => {
    const rows = normalizeImportedOperators(playerInfo, realOperatorMeta);
    expect(rows).toHaveLength(playerInfo.data.chars.length);
    const amiya = rows.find((row) => row.charId === "char_002_amiya");
    // 证章不算模组，阿米娅的 Y 型未解锁 -> maxModuleLevel 0
    expect(amiya).toMatchObject({ name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 7, skill3: 7, maxModuleLevel: 0 });
    const kalts = rows.find((row) => row.charId === "char_003_kalts");
    expect(kalts).toMatchObject({ name: "凯尔希", skill3: 10, maxModuleLevel: 3 });
    const svash2 = rows.find((row) => row.charId === "char_1045_svash2");
    expect(svash2.maxModuleLevel).toBe(0);
    // 模组名用 typeName2：证章为空、Y 型为 "Y"（含未解锁）
    expect(amiya.modules).toContainEqual({ id: "uniequip_001_amiya", name: "", level: 1, locked: false });
    expect(amiya.modules).toContainEqual({ id: "uniequip_002_amiya", name: "Y", level: 1, locked: true });
});

test("normalizeImportedOperators fills every missing field", () => {
    const rows = normalizeImportedOperators([{ charId: "", name: "", rarity: 0, profession: "", elite: 0, level: 0, skill1: 0, skill2: 0, skill3: 0, maxModuleLevel: 0 }], operatorMeta);
    expect(rows[0]).toMatchObject({ charId: "", name: "", rarity: 0, profession: "", elite: 0, level: 0, skill1: 0, skill2: 0, skill3: 0, maxModuleLevel: 0 });
});

test("csvEscape quotes values with comma quote or newline", () => {
    expect(csvEscape("abc")).toBe("abc");
    expect(csvEscape("a,b")).toBe("\"a,b\"");
    expect(csvEscape("a\"b")).toBe("\"a\"\"b\"");
    expect(csvEscape("a\nb")).toBe("\"a\nb\"");
    expect(csvEscape(undefined)).toBe("");
});

test("downloadFile creates and clicks a blob link", () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("Blob", class Blob {
        constructor(parts, options) {
            this.parts = parts;
            this.options = options;
        }
    });
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
        const node = originalCreate(tag);
        if (tag === "a") {
            node.click = click;
        }
        return node;
    });
    downloadFile("a.json", "{}", "application/json");
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    createSpy.mockRestore();
    vi.unstubAllGlobals();
});

test("skland credential flow renders bindings", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    parseCredential.mockReturnValue({ cred: "cred", token: "token" });
    fetchBindingList.mockResolvedValue({ arkBindingList: [{ uid: "1", nickName: "博士", channelName: "官服", isOfficial: true }] });
    await app.handleSklandCredential({ preventDefault: vi.fn() });
    expect(app.state.bindingList).toHaveLength(1);
    expect(app.elements.bindingList.innerHTML).toContain("博士");
    // 粘贴提交后凭证写入 localStorage
    expect(JSON.parse(localStorage.getItem(SKLAND_CREDENTIAL_KEY))).toEqual({ cred: "cred", token: "token" });
});

test("bootstrap restores saved skland credential", async () => {
    localStorage.setItem(SKLAND_CREDENTIAL_KEY, JSON.stringify({ cred: "saved-cred", token: "saved-token" }));
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    fetchBindingList.mockResolvedValue({ arkBindingList: [{ uid: "9", nickName: "博士", channelName: "官服", isOfficial: true }] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.state.cred).toBe("saved-cred");
    expect(app.state.token).toBe("saved-token");
    expect(app.elements.credInput.value).toBe("saved-cred");
    expect(fetchBindingList).toHaveBeenCalled();
    expect(app.state.bindingList).toHaveLength(1);
});

test("bootstrap ignores corrupt saved credential", async () => {
    localStorage.setItem(SKLAND_CREDENTIAL_KEY, "{not-json");
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.state.cred).toBe("");
    expect(fetchBindingList).not.toHaveBeenCalled();
    // 字段缺失（只有 cred 没有 token）同样忽略
    localStorage.setItem(SKLAND_CREDENTIAL_KEY, JSON.stringify({ cred: "c" }));
    const again = await initApp({ fetchImpl: makeFetchImpl() });
    expect(again.state.cred).toBe("");
    expect(fetchBindingList).not.toHaveBeenCalled();
});

test("bootstrap surfaces saved credential restore failure", async () => {
    localStorage.setItem(SKLAND_CREDENTIAL_KEY, JSON.stringify({ cred: "c", token: "t" }));
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    fetchBindingList.mockRejectedValue(new Error("cred 失效"));
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.state.cred).toBe("c");
    expect(app.state.error).toContain("自动恢复凭证失败");
    expect(app.state.bindingList).toHaveLength(0);
});

test("skland credential flow shows error", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    parseCredential.mockImplementation(() => {
        throw new Error("格式错误");
    });
    await app.handleSklandCredential({ preventDefault: vi.fn() });
    expect(app.state.error).toBe("格式错误");
});

test("binding select reads operator data and runs analysis", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.cred = "cred";
    app.state.token = "token";
    app.state.assignments = [{ id: 1, uploadTime: new Date().toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 90 } }], groups: [] }];
    getSklandOperatorData.mockResolvedValue({ operators: [{ charId: "char_002_amiya", name: "阿米娅", rarity: 5, profession: "CASTER", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 1 }] });
    await app.handleBindingSelect("1");
    expect(app.state.userOperators).toHaveLength(1);
    expect(app.state.result).not.toBeNull();
});

test("binding select requires credential", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    await app.handleBindingSelect("1");
    expect(app.state.error).toContain("请先输入森空岛凭证");
});

test("binding select shows error on skland failure", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.cred = "cred";
    app.state.token = "token";
    getSklandOperatorData.mockRejectedValue(new Error("读取失败"));
    await app.handleBindingSelect("1");
    expect(app.state.error).toBe("读取失败");
});

test("manual import runs analysis", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.assignments = [{ id: 1, uploadTime: new Date().toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 90 } }], groups: [] }];
    app.elements.importInput.value = JSON.stringify([{ name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10 }]);
    app.handleImport();
    expect(app.state.userOperators).toHaveLength(1);
    expect(app.state.result).not.toBeNull();
});

test("manual import shows error for invalid json", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.elements.importInput.value = "not-json";
    app.handleImport();
    expect(app.state.error).toBeTruthy();
});

test("sample data loads and analyzes", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.assignments = [{ id: 1, uploadTime: new Date().toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 90 } }], groups: [] }];
    app.loadSampleData();
    expect(app.state.userOperators).toHaveLength(2);
    expect(app.state.result).not.toBeNull();
});

test("recent toggle filters assignments to the last 6 months", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.elements.recentToggle.checked).toBe(false);
    const now = Date.now();
    const recent = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(now - 220 * 24 * 60 * 60 * 1000).toISOString();
    app.state.assignments = [
        { id: 1, uploadTime: recent, required: [{ name: "阿米娅", skill: 1, requirements: { level: 90 } }], groups: [] },
        { id: 2, uploadTime: old, required: [{ name: "阿米娅", skill: 1, requirements: { level: 90 } }], groups: [] },
        { id: 3, uploadTime: "", required: [{ name: "阿米娅", skill: 1, requirements: { level: 90 } }], groups: [] },
    ];
    app.loadSampleData();
    expect(app.state.result.summary.totalAssignments).toBe(3);
    app.elements.recentToggle.checked = true;
    app.elements.recentToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.recentOnly).toBe(true);
    expect(app.elements.recentToggle.checked).toBe(true);
    expect(app.state.result.summary.totalAssignments).toBe(1);
    app.elements.recentToggle.checked = false;
    app.elements.recentToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.recentOnly).toBe(false);
    expect(app.state.result.summary.totalAssignments).toBe(3);
});

test("recent toggle re-sorts rows by unsatisfiedCore desc", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    const now = Date.now();
    const days = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
    const need = (name) => [{ name, skill: 1, requirements: { level: 99 } }];
    app.state.assignments = [
        { id: 1, uploadTime: days(10), required: need("阿米娅"), groups: [] },
        { id: 2, uploadTime: days(20), required: need("阿米娅"), groups: [] },
        { id: 3, uploadTime: days(30), required: need("凯尔希"), groups: [] },
        { id: 4, uploadTime: days(220), required: need("凯尔希"), groups: [] },
        { id: 5, uploadTime: days(230), required: need("凯尔希"), groups: [] },
        { id: 6, uploadTime: days(240), required: need("凯尔希"), groups: [] },
    ];
    app.loadSampleData();
    // 全部作业：凯尔希未满足 4 > 阿米娅 2
    let html = app.elements.trainingTable.innerHTML;
    expect(html.indexOf("凯尔希")).toBeLessThan(html.indexOf("阿米娅"));
    // 勾选窗口切换后应重新按未满足必带作业降序
    app.elements.recentToggle.checked = true;
    app.elements.recentToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.recentOnly).toBe(true);
    // 仅近6个月：阿米娅未满足 2 > 凯尔希 1
    html = app.elements.trainingTable.innerHTML;
    expect(html.indexOf("阿米娅")).toBeLessThan(html.indexOf("凯尔希"));
});

test("standard mode toggle overrides requirements with max training", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.elements.standardToggle.checked).toBe(false);
    const now = Date.now();
    app.state.assignments = [
        { id: 1, uploadTime: new Date(now - 1000).toISOString(), required: [{ name: "阿米娅", skill: 2, requirements: { level: 60, skill_level: 7, module: 1 } }], groups: [] },
    ];
    app.loadSampleData();
    let amiya = app.state.result.rows.find((row) => row.name === "阿米娅");
    // module 1 = X 型，普通模式无等级要求
    expect(amiya.target).toMatchObject({ elite: 2, level: 60, skill2: 7, module: 1, moduleLevel: 0 });
    app.elements.standardToggle.checked = true;
    app.elements.standardToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.standardMode).toBe(true);
    expect(app.elements.standardToggle.checked).toBe(true);
    // 5★阿米娅 -> 精2 80级；用到的技能2专三；X 型模组三级
    amiya = app.state.result.rows.find((row) => row.name === "阿米娅");
    expect(amiya.target).toMatchObject({ elite: 2, level: 80, skill2: 10, module: 1, moduleLevel: 3 });
    app.elements.standardToggle.checked = false;
    app.elements.standardToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.standardMode).toBe(false);
    amiya = app.state.result.rows.find((row) => row.name === "阿米娅");
    expect(amiya.target).toMatchObject({ level: 60, skill2: 7, module: 1, moduleLevel: 0 });
});

test("rows are always sorted by unsatisfiedCore desc", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    const makeRow = (name, unsatisfiedCore, score) => ({ name, unsatisfiedCore, score, coreGain: 0, groupGain: 0, totalGap: 0 });
    app.state.result = {
        summary: { totalAssignments: 0, readyCount: 0, notReadyCount: 0, involvedOperators: 0, ownedOperators: 0, missingOperators: 0 },
        assignmentResults: [],
        rows: [makeRow("塞雷娅", 2, 100), makeRow("阿米娅", 5, 1), makeRow("凯尔希", 5, 1)],
    };
    app.elements.filterInput.value = "";
    app.elements.filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    const html = app.elements.trainingTable.innerHTML;
    // 未满足必带作业 5 的在前、2 的在后；同分时按干员名
    expect(html.indexOf("阿米娅")).toBeLessThan(html.indexOf("凯尔希"));
    expect(html.indexOf("凯尔希")).toBeLessThan(html.indexOf("塞雷娅"));
});

test("export handlers show error when result is empty", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.handleExportJson();
    expect(app.state.error).toContain("暂无结果可导出");
    app.handleExportCsv();
    expect(app.state.error).toContain("暂无结果可导出");
});

test("export handlers download when result exists", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.result = {
        summary: { totalAssignments: 0, readyCount: 0, notReadyCount: 0, involvedOperators: 0, ownedOperators: 0, missingOperators: 0 },
        assignmentResults: [],
        rows: [
            { name: "阿米娅", user: { elite: 2 }, score: 100, coreGain: 1, groupGain: 0, unsatisfiedCore: 1, totalGap: 5 },
            { name: "凯尔希", user: null, score: 50, coreGain: 0, groupGain: 1, unsatisfiedCore: 0, totalGap: 1000 },
            { name: "塞雷娅", user: { elite: 2 }, score: 10, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, totalGap: 0 },
        ],
    };
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const blobs = [];
    vi.stubGlobal("Blob", class Blob {
        constructor(parts, options) {
            this.parts = parts;
            this.options = options;
            blobs.push(this);
        }
    });
    app.handleExportJson();
    app.handleExportCsv();
    vi.unstubAllGlobals();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    // CSV 状态列与页面徽章一致：totalGap 为 0 的已拥有干员导出为「已达标」
    const csv = blobs[1].parts.join("");
    expect(csv).toContain("待培养");
    expect(csv).toContain("未拥有");
    expect(csv).toContain("已达标");
});

// ── 导出培养计划（MAA「干员培养」剪贴板格式）──

const planRow = (name, { user, target, unsatisfiedCore = 0, score = 0, totalGap = 0 } = {}) => ({
    name,
    user,
    target,
    unsatisfiedCore,
    score,
    totalGap,
    coreGain: 0,
    groupGain: 0,
});

const planResult = (rows) => ({
    summary: { totalAssignments: 0, readyCount: 0, notReadyCount: 0, involvedOperators: rows.length, ownedOperators: 0, missingOperators: 0 },
    assignmentResults: [],
    rows,
});

const stubClipboard = (value) => {
    const original = navigator.clipboard;
    Reflect.defineProperty(navigator, "clipboard", { configurable: true, value });
    return () => Reflect.defineProperty(navigator, "clipboard", { configurable: true, value: original });
};

const chenTarget = { elite: 2, level: 60, skill1: 7, skill2: 0, skill3: 10 };

test("buildMaaTrainingPlan maps target requirements to MAA plan fields", () => {
    const rows = [planRow("陈", {
        user: { charId: "char_chen", name: "陈", profession: "WARRIOR" },
        target: chenTarget,
    })];
    const { plans, skippedUnowned, skippedUnsupported } = buildMaaTrainingPlan(rows, operatorMeta);
    expect(plans).toHaveLength(1);
    // 键序即剪贴板 JSON 的字段顺序，与 MAA 文档示例保持一致
    expect(Object.keys(plans[0])).toEqual(["role", "name", "elite", "level", "skill_level", "skill_mastery"]);
    expect(plans[0]).toEqual({ role: "Warrior", name: "陈", elite: 2, level: 60, skill_level: 7, skill_mastery: [0, 0, 3] });
    expect(skippedUnowned).toBe(0);
    expect(skippedUnsupported).toBe(0);
});

test("buildMaaTrainingPlan converts mastery ranks and keeps the reserved level field", () => {
    const rows = [planRow("陈", {
        user: { charId: "char_chen", name: "陈", profession: "WARRIOR" },
        target: { elite: 2, level: 0, skill1: 8, skill2: 9 },
    })];
    const { plans } = buildMaaTrainingPlan(rows, operatorMeta);
    // 内部技能值 8/9/10 表示专一/二/三：公共等级封顶 7，专精 = 值 - 7；level 是 MAA 预留字段，恒带上
    expect(plans[0].level).toBe(0);
    expect(plans[0].skill_level).toBe(7);
    expect(plans[0].skill_mastery).toEqual([1, 2, 0]);
});

test("buildMaaTrainingPlan maps every profession to its MAA role", () => {
    const professions = {
        WARRIOR: "Warrior",
        PIONEER: "Pioneer",
        TANK: "Tank",
        MEDIC: "Medic",
        SUPPORT: "Support",
        CASTER: "Caster",
        SNIPER: "Sniper",
        SPECIAL: "Special",
    };
    const rows = Object.entries(professions).map(([profession], index) => planRow(`干员${index}`, {
        user: { charId: `char_${profession}`, profession },
        target: { elite: 2, level: 60, skill1: 7, skill2: 0, skill3: 0 },
    }));
    const { plans } = buildMaaTrainingPlan(rows, { nameToCharId: {}, operators: {} });
    expect(plans.map((plan) => plan.role)).toEqual(Object.values(professions));
});

test("buildMaaTrainingPlan falls back to the user profile and omits role when unknown", () => {
    const rows = [
        // 无精英化要求的目标：elite 回退为 0（level/skill 语义相同）
        planRow("神秘干员", { user: { name: "神秘干员", charId: "char_unknown", profession: "MEDIC" }, target: { level: 55, skill1: 4, skill2: 0, skill3: 0 } }),
        planRow("无职干员", { user: { name: "无职干员" }, target: { elite: 1, level: 55, skill1: 4, skill2: 0, skill3: 0 } }),
    ];
    const { plans } = buildMaaTrainingPlan(rows, undefined);
    expect(plans[0].role).toBe("Medic");
    expect(plans[0].elite).toBe(0);
    expect(Object.keys(plans[1])).toEqual(["name", "elite", "level", "skill_level", "skill_mastery"]);
});

test("buildMaaTrainingPlan skips unowned operators and amiya forms", () => {
    const target = { elite: 2, level: 60, skill1: 7, skill2: 0, skill3: 0 };
    const rows = [
        planRow("银灰", { user: null, target }),
        planRow("阿米娅", { user: { charId: "char_002_amiya", profession: "CASTER" }, target }),
        planRow("阿米娅（近卫）", { user: { charId: "char_1001_amiya2", profession: "WARRIOR" }, target }),
        planRow("凯尔希", { user: { charId: "char_003_kalts", profession: "MEDIC" }, target }),
    ];
    const { plans, skippedUnowned, skippedUnsupported } = buildMaaTrainingPlan(rows, operatorMeta);
    expect(plans.map((plan) => plan.name)).toEqual(["凯尔希"]);
    expect(skippedUnowned).toBe(1);
    expect(skippedUnsupported).toBe(2);
});

test("buildMaaTrainingPlan clamps baseline skill levels to unset", () => {
    // 技能 1 级是游戏基线（无培养意义）；MaaCore 校验 skill_level 只接受 2-7，
    // 输出 1 会让整份计划在 set_params 处被拒，故按未设置（0）导出
    const baseline = [planRow("陈", {
        user: { charId: "char_chen", name: "陈", profession: "WARRIOR" },
        target: { elite: 1, level: 55, skill1: 1, skill2: 0, skill3: 0 },
    })];
    expect(buildMaaTrainingPlan(baseline, operatorMeta).plans[0].skill_level).toBe(0);
    // 其余技能要求超过基线时取最大值，基线要求不影响结果
    const mixed = [planRow("陈", {
        user: { charId: "char_chen", name: "陈", profession: "WARRIOR" },
        target: { elite: 2, level: 60, skill1: 1, skill2: 0, skill3: 10 },
    })];
    const mixedPlan = buildMaaTrainingPlan(mixed, operatorMeta).plans[0];
    expect(mixedPlan.skill_level).toBe(7);
    expect(mixedPlan.skill_mastery).toEqual([0, 0, 3]);
});

test("buildMaaTrainingPlan keeps rows the user already satisfies", () => {
    const rows = [planRow("陈", {
        user: { charId: "char_chen", name: "陈", profession: "WARRIOR", elite: 2, level: 90, skill1: 10, skill2: 10, skill3: 10 },
        target: { elite: 2, level: 60, skill1: 7, skill2: 0, skill3: 0 },
    })];
    expect(buildMaaTrainingPlan(rows, operatorMeta).plans).toHaveLength(1);
});

test("buildMaaTrainingPlan returns empty plans for missing rows", () => {
    expect(buildMaaTrainingPlan(undefined, operatorMeta)).toEqual({ plans: [], skippedUnowned: 0, skippedUnsupported: 0 });
});

test("export plan shows error when result is empty", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    await app.handleExportPlan();
    expect(app.state.error).toContain("暂无结果可导出");
});

test("export plan copies owned rows of the current view to the clipboard", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.result = planResult([
        planRow("陈", { user: { charId: "char_chen", profession: "WARRIOR" }, target: chenTarget, unsatisfiedCore: 1, score: 100, totalGap: 10 }),
        planRow("阿米娅", { user: { charId: "char_002_amiya", profession: "CASTER" }, target: chenTarget, score: 50, totalGap: 20 }),
        planRow("凯尔希", { user: null, target: chenTarget, score: 30, totalGap: 1000 }),
    ]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restore = stubClipboard({ writeText });
    await app.handleExportPlan();
    restore();
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual([
        { role: "Warrior", name: "陈", elite: 2, level: 60, skill_level: 7, skill_mastery: [0, 0, 3] },
    ]);
    // 复制成功的提示以对话框呈现（状态栏区域窄且易被忽略）
    expect(app.elements.planDoneDialog.hasAttribute("open")).toBe(true);
    expect(app.elements.planDoneMessage.textContent).toContain("已复制 1 名干员的培养计划");
    // 阿米娅形态 MAA 不支持、凯尔希未拥有，都要在提示里交代
    expect(app.elements.planDoneMessage.textContent).toContain("已跳过 1 名未拥有、1 名阿米娅形态");
    app.elements.planDoneCloseButton.dispatchEvent(new Event("click", { bubbles: true }));
    expect(app.elements.planDoneDialog.hasAttribute("open")).toBe(false);
});

test("export plan follows the search filter", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.result = planResult([
        planRow("陈", { user: { charId: "char_chen", profession: "WARRIOR" }, target: chenTarget, totalGap: 10 }),
        planRow("凯尔希", { user: null, target: chenTarget, totalGap: 1000 }),
    ]);
    app.elements.filterInput.value = "陈";
    app.elements.filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restore = stubClipboard({ writeText });
    await app.handleExportPlan();
    restore();
    const parsed = JSON.parse(writeText.mock.calls[0][0]);
    expect(parsed.map((plan) => plan.name)).toEqual(["陈"]);
    // 被筛掉的干员不应出现在跳过说明里
    expect(app.elements.planDoneMessage.textContent).not.toContain("已跳过");
});

test("export plan reports when nothing is exportable", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restore = stubClipboard({ writeText });
    // 只看待培养：唯一已拥有干员已达标，筛选后行集为空
    app.state.result = planResult([planRow("陈", {
        user: { charId: "char_chen", profession: "WARRIOR" },
        target: { elite: 2, level: 60, skill1: 7, skill2: 0, skill3: 0 },
        totalGap: 0,
    })]);
    app.elements.onlyPendingInput.checked = true;
    app.elements.onlyPendingInput.dispatchEvent(new Event("change", { bubbles: true }));
    await app.handleExportPlan();
    expect(app.state.error).toContain("当前筛选下没有可导出的培养计划");
    expect(writeText).not.toHaveBeenCalled();
    // 只看未拥有：行都在但 MAA 都无法培养
    app.state.result = planResult([planRow("凯尔希", { user: null, target: chenTarget, totalGap: 1000 })]);
    app.elements.onlyPendingInput.checked = false;
    app.elements.onlyPendingInput.dispatchEvent(new Event("change", { bubbles: true }));
    app.elements.onlyMissingInput.checked = true;
    app.elements.onlyMissingInput.dispatchEvent(new Event("change", { bubbles: true }));
    await app.handleExportPlan();
    expect(app.state.error).toContain("无法由 MAA 培养");
    expect(writeText).not.toHaveBeenCalled();
    restore();
});

test("export plan follows the recent window toggle", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    const now = Date.now();
    const days = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
    app.state.assignments = [
        { id: 1, uploadTime: days(30), required: [{ name: "凯尔希", skill: 1, requirements: { elite: 1 } }], groups: [] },
        { id: 2, uploadTime: days(220), required: [{ name: "陈", skill: 1, requirements: { elite: 1 } }], groups: [] },
    ];
    app.elements.importInput.value = JSON.stringify([
        { name: "陈", elite: 0, level: 30, skill1: 4, skill2: 0, skill3: 0 },
        { name: "凯尔希", elite: 0, level: 30, skill1: 4, skill2: 0, skill3: 0 },
    ]);
    app.handleImport();
    app.elements.recentToggle.checked = true;
    app.elements.recentToggle.dispatchEvent(new Event("change", { bubbles: true }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restore = stubClipboard({ writeText });
    await app.handleExportPlan();
    restore();
    // 220 天前的作业超出 180 天窗口，陈的目标不应再出现在导出里
    expect(JSON.parse(writeText.mock.calls[0][0]).map((plan) => plan.name)).toEqual(["凯尔希"]);
});

test("export plan matches the standard training mode", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.assignments = [
        { id: 1, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "凯尔希", skill: 1, requirements: {} }], groups: [] },
    ];
    app.elements.importInput.value = JSON.stringify([{ name: "凯尔希", elite: 0, level: 30, skill1: 4, skill2: 0, skill3: 0 }]);
    app.handleImport();
    app.elements.standardToggle.checked = true;
    app.elements.standardToggle.dispatchEvent(new Event("change", { bubbles: true }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restore = stubClipboard({ writeText });
    await app.handleExportPlan();
    restore();
    // 标准练度：6★ 精二 90 级，作业用到的技能 1 专三，公共等级封顶 7
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual([
        { role: "Medic", name: "凯尔希", elite: 2, level: 90, skill_level: 7, skill_mastery: [3, 0, 0] },
    ]);
});

test("export plan opens a manual-copy dialog when the clipboard rejects", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.result = planResult([planRow("陈", { user: { charId: "char_chen", profession: "WARRIOR" }, target: chenTarget, totalGap: 10 })]);
    const select = vi.fn();
    app.elements.planCopyTextarea.select = select;
    const restore = stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await app.handleExportPlan();
    restore();
    expect(app.elements.planCopyDialog.hasAttribute("open")).toBe(true);
    expect(JSON.parse(app.elements.planCopyTextarea.value)).toEqual([
        { role: "Warrior", name: "陈", elite: 2, level: 60, skill_level: 7, skill_mastery: [0, 0, 3] },
    ]);
    // 弹窗打开即全选，用户直接 Ctrl+C
    expect(select).toHaveBeenCalledTimes(1);
    expect(app.state.status).toContain("复制失败，请在弹窗中手动复制");
});

test("export plan falls back when the clipboard API is unavailable", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.result = planResult([planRow("陈", { user: { charId: "char_chen", profession: "WARRIOR" }, target: chenTarget, totalGap: 10 })]);
    const restore = stubClipboard(undefined);
    await app.handleExportPlan();
    restore();
    expect(app.elements.planCopyDialog.hasAttribute("open")).toBe(true);
    expect(app.elements.planCopyTextarea.value).not.toBe("");
});

test("plan copy dialog closes via its close button", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.result = planResult([planRow("陈", { user: { charId: "char_chen", profession: "WARRIOR" }, target: chenTarget, totalGap: 10 })]);
    app.elements.planCopyTextarea.select = vi.fn();
    const restore = stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await app.handleExportPlan();
    restore();
    expect(app.elements.planCopyDialog.hasAttribute("open")).toBe(true);
    app.elements.planCopyCloseButton.dispatchEvent(new Event("click", { bubbles: true }));
    expect(app.elements.planCopyDialog.hasAttribute("open")).toBe(false);
});

test("runAnalysis returns early when static data or assignments are missing", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.operatorMeta = null;
    app.state.assignments = [];
    app.loadSampleData();
    expect(app.state.result).toBeNull();
});

test("refreshAssignments reruns analysis when operators are loaded", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 1, assignments: [] });
    fetchAssignmentsSnapshot.mockResolvedValue({ total: 1, assignments: [{ id: 1, uploadTime: new Date().toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 90 } }], groups: [] }], generatedAt: "2024-01-01T00:00:00Z" });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.userOperators = [{ charId: "char_002_amiya", name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 1 }];
    await app.refreshAssignments(false);
    expect(app.state.result).not.toBeNull();
});

test("binding click delegation handles button and empty target", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.cred = "cred";
    app.state.token = "token";
    app.elements.bindingList.innerHTML = "<button class=\"binding-button\" data-uid=\"1\">博士</button><span>other</span>";
    getSklandOperatorData.mockResolvedValue({ operators: [] });
    const button = app.elements.bindingList.querySelector(".binding-button");
    button.dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    const other = app.elements.bindingList.querySelector("span");
    other.dispatchEvent(new Event("click", { bubbles: true }));
    expect(app.elements.bindingList.innerHTML).toContain("博士");
});

test("requireModule toggle does not rerun without operators", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.elements.requireModuleInput.checked = true;
    app.elements.requireModuleInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.requireModule).toBe(true);
});

test("refresh button click triggers live refresh", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 1, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.elements.refreshButton.dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    expect(app.state.assignmentSource).toBe("live");
});

test("skland command is populated and copy succeeds", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.elements.sklandCommand.textContent).toBe(SKLAND_COMMAND);
    const originalClipboard = navigator.clipboard;
    Reflect.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await app.handleCopyCommand();
    expect(app.state.status).toBe("命令已复制");
    Reflect.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
});

test("copy command failure shows error", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    const originalClipboard = navigator.clipboard;
    Reflect.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await app.handleCopyCommand();
    expect(app.state.error).toContain("复制失败");
    Reflect.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
});

test("render handles missing rows and status fallback", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.status = "";
    app.state.result = {
        summary: { totalAssignments: 0, readyCount: 0, notReadyCount: 0, involvedOperators: 0, ownedOperators: 0, missingOperators: 0 },
        assignmentResults: undefined,
        rows: undefined,
    };
    app.elements.filterInput.value = "x";
    app.elements.filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(app.state.filterText).toBe("x");
});

test("filter and checkbox controls update state and render", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.assignments = [
        { id: 1, title: "阿米娅", stageName: "阿米娅", uploadTime: new Date().toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 90 } }], groups: [] },
        { id: 2, title: "凯尔希", stageName: "凯尔希", uploadTime: new Date().toISOString(), required: [{ name: "凯尔希", skill: 1, requirements: { level: 90 } }], groups: [] },
    ];
    app.loadSampleData();

    app.elements.filterInput.value = "阿米娅";
    app.elements.filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(app.state.filterText).toBe("阿米娅");

    app.elements.onlyPendingInput.checked = true;
    app.elements.onlyPendingInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.onlyPending).toBe(true);

    app.elements.onlyMissingInput.checked = true;
    app.elements.onlyMissingInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.onlyMissing).toBe(true);

    app.elements.requireModuleInput.checked = true;
    app.elements.requireModuleInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.requireModule).toBe(true);
});

test("first visit opens the intro dialog and records the visit", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.elements.introDialog.hasAttribute("open")).toBe(true);
    expect(Number(localStorage.getItem(LAST_VISIT_KEY))).toBeGreaterThan(0);
});

test("visit within the remind window keeps the intro dialog closed", async () => {
    const before = Date.now();
    localStorage.setItem(LAST_VISIT_KEY, String(before - 10 * 24 * 60 * 60 * 1000));
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.elements.introDialog.hasAttribute("open")).toBe(false);
    // 未弹窗也要刷新时间戳，从最近一次访问起算
    expect(Number(localStorage.getItem(LAST_VISIT_KEY))).toBeGreaterThanOrEqual(before);
});

test("visit older than the remind window opens the intro dialog again", async () => {
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now() - (INTRO_REMIND_DAYS + 1) * 24 * 60 * 60 * 1000));
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.elements.introDialog.hasAttribute("open")).toBe(true);
});

test("unparsable visit timestamp is treated as a first visit", async () => {
    localStorage.setItem(LAST_VISIT_KEY, "not-a-timestamp");
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.elements.introDialog.hasAttribute("open")).toBe(true);
});

test("intro dialog opens even when assignments fail to load", async () => {
    fetchAllAssignments.mockRejectedValue(new Error("network down"));
    fetchAssignmentsSnapshot.mockRejectedValue(new Error("snapshot down"));
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.elements.introDialog.hasAttribute("open")).toBe(true);
});

test("intro close button dismisses the dialog", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.elements.introCloseButton.dispatchEvent(new Event("click", { bubbles: true }));
    expect(app.elements.introDialog.hasAttribute("open")).toBe(false);
});

test("intro uses the native dialog API when available", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const showModal = vi.fn();
    const close = vi.fn();
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.elements.introDialog.showModal = showModal;
    app.elements.introDialog.close = close;
    localStorage.removeItem(LAST_VISIT_KEY);
    app.maybeShowIntro();
    app.elements.introCloseButton.dispatchEvent(new Event("click", { bubbles: true }));
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
});

// buildDom 是手写的，无法发现 index.html 与 app.js 的元素契约漂移；
// 这里直接加载真实页面，确保线上标记能满足 collectElements 的全部 id
test("index.html markup satisfies the app element contract", async () => {
    // import.meta.url 在 vitest 的 jsdom 环境下是 http 形式，用工作目录定位仓库里的 index.html
    const html = await readFile(resolve(process.cwd(), "index.html"), "utf8");
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(app.elements.introDialog).toBeInstanceOf(HTMLDialogElement);
    expect(app.elements.introDialog.hasAttribute("open")).toBe(true);
    expect(app.elements.introDialog.textContent).toContain("仅近6个月作业");
    expect(app.elements.introDialog.textContent).toContain("标准练度");
    expect(app.elements.introCloseButton.textContent).toContain("我知道了");
    // 导出培养计划按钮与手动复制兜底弹窗的标记契约
    expect(app.elements.exportPlanButton.textContent).toContain("导出培养计划");
    expect(app.elements.planCopyTextarea.readOnly).toBe(true);
    expect(app.elements.planCopyCloseButton.textContent).toContain("我知道了");
    expect(app.elements.planDoneDialog.textContent).toContain("培养计划已复制");
});
