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
    COPY_RESET_DELAY_MS,
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
    nameToCharId: { 阿米娅: "char_002_amiya", 泡普卡: "char_low", 月见夜: "char_low2" },
    operators: {
        char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] },
        char_low: { name: "泡普卡", rarity: 3, profession: "GUARD", skills: [] },
        char_low2: { name: "月见夜", rarity: 3, profession: "CASTER", skills: [] },
    },
};
const skillSprite = { spriteUrl: "https://example.com/s.jpg", size: 128, entries: {} };

// 养成成本数据（仅构造分析所需最小结构）
const costCharacterTable = {
    char_002_amiya: {
        name: "阿米娅",
        rarity: 5,
        elite: [{}, { 30014: 4 }, { 30034: 3 }],
        allSkill: [{ 3301: 4 }, { 3301: 4 }, { 3302: 4 }, { 3302: 4 }, { 3302: 4 }, { 3303: 4 }],
        skills: [
            { skillId: "s1", skillLevelUpCost: [] },
            { skillId: "s2", skillLevelUpCost: [[{ id: "3303", count: 5 }]] },
            { skillId: "s3", skillLevelUpCost: [] },
        ],
        equip: [{ typeName2: "X", itemCost: [{ 4001: 10000 }] }],
    },
    // 3星干员：有精一无精二
    char_low: {
        name: "泡普卡",
        rarity: 3,
        elite: [{}, { 30014: 2 }],
        allSkill: [],
        skills: [],
        equip: [],
    },
    // 另一名3星干员：用于同分（同 score）排序按名比较
    char_low2: {
        name: "月见夜",
        rarity: 3,
        elite: [{}, { 30014: 2 }],
        allSkill: [],
        skills: [],
        equip: [],
    },
};
const itemInfo = [{ itemId: "30014", itemName: "全新装置", rarity: 4 }];
// 等级成本表：每级经验与龙门币均为 500，长度足够精二阶段使用
const levelCostTable = {
    elite0: Array.from({ length: 50 }, () => ({ exp: 500, gold: 500 })),
    elite1: Array.from({ length: 80 }, () => ({ exp: 500, gold: 500 })),
    elite2: Array.from({ length: 90 }, () => ({ exp: 500, gold: 500 })),
};

const makeFetchImpl = ({ serveCost = false } = {}) => vi.fn((url) => {
    if (url.includes("operator_meta")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(operatorMeta) });
    }
    if (url.includes("skill_sprite")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(skillSprite) });
    }
    if (serveCost && url.includes("character_table")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(costCharacterTable) });
    }
    if (serveCost && url.includes("item_info")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(itemInfo) });
    }
    if (serveCost && url.includes("level_cost")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(levelCostTable) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
});

// 建立一个已分析、含成本数据的应用：作业要求阿米娅精二90级，形成缺口；
// 经真实导入流程（handleImport）完成分析与渲染
const setupAnalyzedApp = async () => {
    fetchAllAssignments.mockResolvedValue({ total: 1, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl({ serveCost: true }) });
    app.state.assignments = [{
        id: 1,
        uploadTime: new Date().toISOString(),
        required: [{ name: "阿米娅", skill: 1, requirements: { elite: 2, level: 90 } }],
        groups: [],
    }];
    app.elements.importInput.value = JSON.stringify([
        { charId: "char_002_amiya", name: "阿米娅", elite: 0, level: 1, skill1: 1, skill2: 1, skill3: 1 },
    ]);
    app.handleImport();
    return app;
};

const buildDom = () => {
    document.body.innerHTML = [
        "<span id=\"status\"></span>",
        "<div id=\"error\" class=\"error is-hidden\"></div>",
        "<div id=\"summary\"></div>",
        "<div id=\"material-detail\"></div>",
        "<h2 id=\"material-title\"></h2>",
        "<div id=\"material-filters\"></div>",
        "<button id=\"material-select-all\"></button>",
        "<button id=\"material-clear\"></button>",
        "<div id=\"training-table\"></div>",
        "<h2 id=\"training-title\"></h2>",
        "<button id=\"refresh-button\"></button>",
        "<form id=\"skland-form\"><input id=\"cred-input\" type=\"password\"></form>",
        "<code id=\"skland-command\"></code>",
        "<button id=\"copy-command-button\"></button>",
        "<div id=\"binding-list\"></div>",
        "<button id=\"import-button\"></button>",
        "<textarea id=\"import-input\"></textarea>",
        "<button id=\"upload-file-button\"></button>",
        "<input id=\"import-file-input\" type=\"file\">",
        "<button id=\"export-json-button\"></button>",
        "<button id=\"export-csv-button\"></button>",
        "<button id=\"sample-button\"></button>",
        "<input id=\"filter-input\" type=\"search\">",
        "<input id=\"only-pending-input\" type=\"checkbox\">",
        "<input id=\"only-missing-input\" type=\"checkbox\">",
        "<input id=\"require-module-input\" type=\"checkbox\">",
        "<input id=\"recent-toggle\" type=\"checkbox\">",
        "<input id=\"standard-toggle\" type=\"checkbox\">",
        "<dialog id=\"intro-dialog\"></dialog>",
        "<button id=\"intro-close-button\"></button>",
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

test("normalizeImportedOperators reads nested user of exported result rows", () => {
    const row = {
        name: "阿斯卡纶",
        user: {
            charId: "char_4132_ascln",
            name: "阿斯卡纶",
            rarity: 6,
            profession: "SPECIAL",
            elite: 2,
            level: 90,
            skill1: 10,
            skill2: 7,
            skill3: 7,
            modules: [{ id: "uniequip_001_ascln", name: "", level: 1, locked: false }],
            maxModuleLevel: 0,
        },
        score: 16540,
        totalGap: 135,
    };
    const result = normalizeImportedOperators([row], operatorMeta);
    expect(result[0]).toMatchObject({
        charId: "char_4132_ascln",
        name: "阿斯卡纶",
        elite: 2,
        level: 90,
        skill1: 10,
        skill2: 7,
        skill3: 7,
    });
    expect(result[0].modules).toEqual(row.user.modules);
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

test("file input change imports selected file", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    const content = JSON.stringify([{ name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10 }]);
    const file = new File([content], "operators.json", { type: "application/json" });
    Reflect.defineProperty(app.elements.importFileInput, "files", { configurable: true, value: [file] });
    app.elements.importFileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(app.state.userOperators).toHaveLength(1));
    expect(app.elements.importInput.value).toBe(content);
});

test("file input change without files is ignored", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    Reflect.defineProperty(app.elements.importFileInput, "files", { configurable: true, value: undefined });
    expect(() => app.elements.importFileInput.dispatchEvent(new Event("change", { bubbles: true }))).not.toThrow();
});

test("invalid selected file shows error", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    const file = new File(["not-json"], "operators.json", { type: "application/json" });
    Reflect.defineProperty(app.elements.importFileInput, "files", { configurable: true, value: [file] });
    app.elements.importFileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(app.state.error).toBeTruthy());
});

test("upload file button triggers file input click", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    const clickSpy = vi.spyOn(app.elements.importFileInput, "click");
    app.elements.uploadFileButton.dispatchEvent(new Event("click", { bubbles: true }));
    expect(clickSpy).toHaveBeenCalledOnce();
});

test("text area dragover and dragleave toggle highlight", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    const dragOverEvent = new Event("dragover", { bubbles: true, cancelable: true });
    app.elements.importInput.dispatchEvent(dragOverEvent);
    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(app.elements.importInput.classList.contains("is-dragover")).toBe(true);
    app.elements.importInput.dispatchEvent(new Event("dragleave", { bubbles: true }));
    expect(app.elements.importInput.classList.contains("is-dragover")).toBe(false);
});

test("text area drop without data is ignored", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    expect(() => app.elements.importInput.dispatchEvent(new Event("drop", { bubbles: true }))).not.toThrow();
});

test("text area drop imports dragged file", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    const content = JSON.stringify([{ name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10 }]);
    const file = new File([content], "operators.json", { type: "application/json" });
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Reflect.defineProperty(dropEvent, "dataTransfer", { configurable: true, value: { files: [file] } });
    app.elements.importInput.dispatchEvent(dropEvent);
    expect(dropEvent.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(app.state.userOperators).toHaveLength(1));
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
    const need = (name) => [{ name, skill: 1, requirements: { elite: 2, level: 99 } }];
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
    // CSV 状态列与页面徽章一致：三行分别为待培养、未拥有、已达标
    const csv = blobs[1].parts.join("");
    expect(csv).toContain("待培养");
    expect(csv).toContain("未拥有");
    expect(csv).toContain("已达标");
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
    vi.useFakeTimers();
    await app.handleCopyCommand();
    expect(app.state.status).toBe("命令已复制");
    expect(app.elements.copyCommandButton.textContent).toBe("已复制");
    vi.advanceTimersByTime(COPY_RESET_DELAY_MS);
    expect(app.elements.copyCommandButton.textContent).toBe("复制命令");
    vi.useRealTimers();
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

test("养成成本数据加载成功：成本索引、信息表（含补丁）与升级表就绪", async () => {
    const app = await setupAnalyzedApp();
    expect(app.state.costIndex).not.toBeNull();
    expect(app.state.levelCostTable).toEqual(levelCostTable);
    // itemInfoMap 由上游条目与本站补丁合并：补丁含两条证章
    expect(app.state.itemInfoMap["30014"].itemName).toBe("全新装置");
    expect(app.state.itemInfoMap.mod_update_token_1.itemName).toBe("数据增补条");
    expect(app.state.itemInfoMap.mod_update_token_2.itemName).toBe("数据增补仪");
    // 默认全选：材料区标题含 1 名干员
    expect(app.elements.materialTitle.textContent).toContain("1");
});

test("清单行首复选框：取消勾选与重新勾选更新材料区", async () => {
    const app = await setupAnalyzedApp();
    const checkbox = app.elements.trainingTable.querySelector(".material-select");
    expect(checkbox.dataset.name).toBe("阿米娅");
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.materialSelection.has("阿米娅")).toBe(false);
    expect(app.elements.materialTitle.textContent).toContain("0");
    // render 已重建表格，需重新查询当前复选框节点
    const rechecked = app.elements.trainingTable.querySelector(".material-select");
    rechecked.checked = true;
    rechecked.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.materialSelection.has("阿米娅")).toBe(true);
    expect(app.elements.materialTitle.textContent).toContain("1");
});

test("勾选集合未初始化时清单复选框 change 直接忽略", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl() });
    app.state.materialSelection = null;
    app.elements.trainingTable.innerHTML = "<input type=\"checkbox\" class=\"material-select\" data-name=\"阿米娅\">";
    expect(() => app.elements.trainingTable.dispatchEvent(new Event("change", { bubbles: true }))).not.toThrow();
});

test("星级与优先级筛选按行匹配，不命中的行被隐藏", async () => {
    const app = await setupAnalyzedApp();
    // material-filters 注入勾选项：6星与极高优先级
    app.elements.materialFilters.innerHTML = [
        "<input type=\"checkbox\" data-rarity=\"6\" checked>",
        "<input type=\"checkbox\" data-tier=\"极高\" checked>",
    ].join("");
    app.elements.filterInput.value = "";
    app.elements.filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    // 阿米娅 5星：不满足 6 星筛选 -> 清单为空
    expect(app.elements.trainingTable.innerHTML).toContain("暂无培养需求");
    // 等值命中：5星
    app.elements.materialFilters.innerHTML = "<input type=\"checkbox\" data-rarity=\"5\" checked>";
    app.elements.filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(app.elements.trainingTable.innerHTML).toContain("阿米娅");
    // 聚合分支「3星及以下」：5星不命中
    app.elements.materialFilters.innerHTML = "<input type=\"checkbox\" data-rarity=\"3\" checked>";
    app.elements.filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(app.elements.trainingTable.innerHTML).toContain("暂无培养需求");
    // 加入3星干员泡普卡后命中聚合分支
    app.state.assignments = [{
        id: 2,
        uploadTime: new Date().toISOString(),
        required: [{ name: "泡普卡", skill: 1, requirements: { elite: 1 } }],
        groups: [],
    }];
    app.elements.importInput.value = JSON.stringify([
        { charId: "char_002_amiya", name: "阿米娅", elite: 0, level: 1, skill1: 1 },
        { charId: "char_low", name: "泡普卡", elite: 0, level: 1, skill1: 1 },
    ]);
    app.handleImport();
    expect(app.elements.trainingTable.innerHTML).toContain("泡普卡");
    expect(app.elements.trainingTable.innerHTML).not.toContain("阿米娅");
});

test("养成优先级筛选：不匹配的干员被隐藏", async () => {
    const app = await setupAnalyzedApp();
    // 阿米娅 score 1060 落入「高」档；筛选「低」-> 无命中
    app.elements.materialFilters.innerHTML = "<input type=\"checkbox\" data-tier=\"低\" checked>";
    app.elements.filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(app.elements.trainingTable.innerHTML).toContain("暂无培养需求");
    // 匹配实际档位（score 1060 落入「高」档）-> 命中
    app.elements.materialFilters.innerHTML = "<input type=\"checkbox\" data-tier=\"高\" checked>";
    app.elements.filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(app.elements.trainingTable.innerHTML).toContain("阿米娅");
});

test("未拥有且无法解析 charId 的干员：三级回退均落空，材料行为空", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 1, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl({ serveCost: true }) });
    // 未知名称的未拥有干员：user.charId、nameToCharId 均无 -> attachMaterials 收到空 charId
    app.state.assignments = [{
        id: 1,
        uploadTime: new Date().toISOString(),
        required: [{ name: "不存在的干员", skill: 1, requirements: { elite: 2, level: 90 } }],
        groups: [],
    }];
    app.elements.importInput.value = JSON.stringify([
        { name: "不存在的干员", elite: 2, level: 90, skill1: 7 },
    ]);
    // 名称在 meta 中查不到 charId，但导入本身不报错
    expect(() => app.handleImport()).not.toThrow();
    const row = app.state.result.rows[0];
    expect(row.costBreakdown).toBeNull();
    // 行复选框：costBreakdown === undefined 才不渲染；此处为 null 仍渲染复选框
    expect(app.elements.trainingTable.innerHTML).toContain("material-select");
});

test("材料行同分按干员名排序：排序比较实际执行", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 1, assignments: [] });
    const app = await initApp({ fetchImpl: makeFetchImpl({ serveCost: true }) });
    // 两名3星干员在同一份作业中要求相同（精一），聚合后分数一致
    app.state.assignments = [{
        id: 1,
        uploadTime: new Date().toISOString(),
        required: [
            { name: "泡普卡", skill: 1, requirements: { elite: 1 } },
            { name: "月见夜", skill: 1, requirements: { elite: 1 } },
        ],
        groups: [],
    }];
    app.elements.importInput.value = JSON.stringify([
        { charId: "char_low", name: "泡普卡", elite: 0, level: 1, skill1: 1 },
        { charId: "char_low2", name: "月见夜", elite: 0, level: 1, skill1: 1 },
    ]);
    app.handleImport();
    const rows = app.state.result.rows;
    const pao = rows.find((row) => row.name === "泡普卡");
    const yue = rows.find((row) => row.name === "月见夜");
    // 要求完全一致，分数相同；selectedMaterialRows 按名升序
    expect(pao.score).toBe(yue.score);
    const html = app.elements.materialDetail.innerHTML;
    // 拼音 p 在 y 之前
    expect(html.indexOf("泡普卡")).toBeLessThan(html.indexOf("月见夜"));
});

test("材料区方向复选框控制方向合计", async () => {
    const app = await setupAnalyzedApp();
    const directionInput = app.elements.materialDetail.querySelector(".direction-total-select");
    expect(directionInput.dataset.direction).toBe("evolve");
    directionInput.checked = false;
    directionInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.state.directionTotals.evolve).toBe(false);
    // 无关 change 目标忽略
    app.elements.materialDetail.dispatchEvent(new Event("change", { bubbles: true }));
});

test("筛选区变化剪枝勾选并重渲", async () => {
    const app = await setupAnalyzedApp();
    expect(() => app.elements.materialFilters.dispatchEvent(new Event("change", { bubbles: true }))).not.toThrow();
});

test("全部计入在无结果时直接返回，有结果时勾选当前筛选行", async () => {
    fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
    const empty = await initApp({ fetchImpl: makeFetchImpl() });
    empty.elements.materialSelectAll.dispatchEvent(new Event("click", { bubbles: true }));
    expect(empty.state.materialSelection).toBeNull();

    const app = await setupAnalyzedApp();
    // 先清空，再全部计入
    app.elements.materialClear.dispatchEvent(new Event("click", { bubbles: true }));
    expect(app.state.materialSelection.size).toBe(0);
    app.elements.materialSelectAll.dispatchEvent(new Event("click", { bubbles: true }));
    expect(app.state.materialSelection.has("阿米娅")).toBe(true);
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
});
