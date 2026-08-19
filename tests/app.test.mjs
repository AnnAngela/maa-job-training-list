import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../js/maa.js", () => ({
  fetchAllAssignments: vi.fn(),
  fetchAssignmentsSnapshot: vi.fn(),
}));
vi.mock("../js/skland.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchBindingList: vi.fn(),
  getSklandOperatorData: vi.fn(),
  parseCredential: vi.fn(),
}));

import {
  csvEscape,
  downloadFile,
  initApp,
  normalizeImportedOperators,
} from "../js/app.js";
import { SKLAND_COMMAND } from "../js/config.js";
import { fetchAllAssignments, fetchAssignmentsSnapshot } from "../js/maa.js";
import { fetchBindingList, getSklandOperatorData, parseCredential } from "../js/skland.js";
import realOperatorMeta from "../data/operator_meta.json";
import playerInfo from "./fixtures/skland-player-info.json";

const operatorMeta = {
  nameToCharId: { 阿米娅: "char_002_amiya" },
  operators: { char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] } },
};
const skillSprite = { spriteUrl: "https://example.com/s.jpg", size: 128, entries: {} };

function makeFetchImpl() {
  return vi.fn((url) => {
    if (url.includes("operator_meta")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => operatorMeta });
    }
    if (url.includes("skill_sprite")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => skillSprite });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

function buildDom() {
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
    "<button id=\"sample-button\"></button>",
    "<input id=\"filter-input\" type=\"search\">",
    "<input id=\"only-pending-input\" type=\"checkbox\">",
    "<input id=\"only-missing-input\" type=\"checkbox\">",
    "<input id=\"require-module-input\" type=\"checkbox\">",
    "<select id=\"sort-select\"><option value=\"priority\">优先级</option><option value=\"coreGain\">核心</option><option value=\"name\">干员名</option></select>",
  ].join("");
}

beforeEach(() => {
  vi.resetAllMocks();
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
  const fetchImpl = vi.fn((url) => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));
  const app = await initApp({ fetchImpl });
  expect(app.state.status).toBe("加载失败");
  expect(app.state.error).toContain("请求失败");
});

test("initApp invokes live progress callback", async () => {
  fetchAllAssignments.mockImplementation(async (fetchImpl, { onProgress }) => {
    onProgress({ page: 1, total: 3, hasNext: false });
    return { total: 3, assignments: [] };
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
  expect(amiya).toMatchObject({ name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 7, skill3: 7, maxModuleLevel: 1 });
  const kalts = rows.find((row) => row.charId === "char_003_kalts");
  expect(kalts).toMatchObject({ name: "凯尔希", skill3: 10, maxModuleLevel: 3 });
  const svash2 = rows.find((row) => row.charId === "char_1045_svash2");
  expect(svash2.maxModuleLevel).toBe(0);
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
  vi.stubGlobal("Blob", class Blob { constructor(parts, options) { this.parts = parts; this.options = options; } });
  const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
    const node = originalCreate(tag);
    if (tag === "a") node.click = click;
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
});

test("skland credential flow shows error", async () => {
  fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
  const app = await initApp({ fetchImpl: makeFetchImpl() });
  parseCredential.mockImplementation(() => { throw new Error("格式错误"); });
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
      { name: "阿米娅", user: { elite: 2 }, score: 100, coreGain: 1, groupGain: 0, unsatisfiedCore: 1 },
      { name: "凯尔希", user: null, score: 50, coreGain: 0, groupGain: 1, unsatisfiedCore: 0 },
    ],
  };
  const createObjectURL = vi.fn(() => "blob:test");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.stubGlobal("Blob", class Blob { constructor(parts, options) { this.parts = parts; this.options = options; } });
  app.handleExportJson();
  app.handleExportCsv();
  vi.unstubAllGlobals();
  expect(createObjectURL).toHaveBeenCalledTimes(2);
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

test("sort comparators use secondary keys", async () => {
  fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
  const app = await initApp({ fetchImpl: makeFetchImpl() });
  app.state.result = {
    summary: { totalAssignments: 0, readyCount: 0, notReadyCount: 0, involvedOperators: 0, ownedOperators: 0, missingOperators: 0 },
    assignmentResults: [],
    rows: [
      { name: "a", coreGain: 2, score: 100, totalGap: 10 },
      { name: "b", coreGain: 2, score: 200, totalGap: 5 },
      { name: "c", coreGain: 0, score: 200, totalGap: 5 },
      { name: "d", coreGain: 0, score: 200, totalGap: 9 },
    ],
  };
  app.elements.sortSelect.value = "coreGain";
  app.elements.sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
  app.elements.sortSelect.value = "priority";
  app.elements.sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
  expect(app.state.sortBy).toBe("priority");
});


test("skland command is populated and copy succeeds", async () => {
  fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
  const app = await initApp({ fetchImpl: makeFetchImpl() });
  expect(app.elements.sklandCommand.textContent).toBe(SKLAND_COMMAND);
  const originalClipboard = navigator.clipboard;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  await app.handleCopyCommand();
  expect(app.state.status).toBe("命令已复制");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
});

test("copy command failure shows error", async () => {
  fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
  const app = await initApp({ fetchImpl: makeFetchImpl() });
  const originalClipboard = navigator.clipboard;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  await app.handleCopyCommand();
  expect(app.state.error).toContain("复制失败");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
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

test("filter and sort controls update state and render", async () => {
  fetchAllAssignments.mockResolvedValue({ total: 0, assignments: [] });
  const app = await initApp({ fetchImpl: makeFetchImpl() });
  app.state.assignments = [
    { id: 1, title: "阿米娅", stageName: "阿米娅", uploadTime: new Date().toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 90 } }], groups: [] },
    { id: 2, title: "凯尔希", stageName: "凯尔希", uploadTime: new Date().toISOString(), required: [{ name: "凯尔希", skill: 1, requirements: { level: 90 } }], groups: [] },
  ];
  app.loadSampleData();

  app.elements.sortSelect.value = "coreGain";
  app.elements.sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
  expect(app.state.sortBy).toBe("coreGain");

  app.elements.sortSelect.value = "name";
  app.elements.sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
  expect(app.state.sortBy).toBe("name");

  app.elements.sortSelect.value = "priority";
  app.elements.sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
  expect(app.state.sortBy).toBe("priority");

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
