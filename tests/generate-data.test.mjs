import { expect, test, vi } from "vitest";
import {
  buildOperatorMeta,
  fetchAllAssignments,
  generateAll,
  normalizeAssignment,
  parseSkillSpriteCss,
} from "../scripts/generate-data.mjs";

const textResponse = (text, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => text });
const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test("normalizeAssignment normalizes slots and groups", () => {
  const item = {
    id: 9,
    upload_time: "2024-01-01",
    views: 12,
    hot_score: 3.5,
    content: JSON.stringify({
      stage_name: "1-7",
      doc: { title: "标题" },
      opers: [{ name: "阿米娅", skill: 2 }],
      groups: [{ name: "组", opers: [{ name: "塞雷娅", skill: 1, requirements: { level: 60 } }] }],
    }),
  };
  const assignment = normalizeAssignment(item);
  expect(assignment).toMatchObject({ id: 9, title: "标题", stageName: "1-7" });
  expect(assignment.required[0].skill).toBe(2);
  expect(assignment.groups[0].opers[0].requirements).toEqual({ level: 60 });
});

test("normalizeAssignment handles invalid content and missing arrays", () => {
  const assignment = normalizeAssignment({ id: 1, content: "bad-json" });
  expect(assignment.title).toBe("");
  expect(assignment.required).toEqual([]);
  expect(assignment.groups).toEqual([]);
});

test("normalizeAssignment fills invalid slot fields and group defaults", () => {
  const item = {
    id: 4,
    content: JSON.stringify({
      stage_name: "4-1",
      opers: [{ skill: "x", skill_usage: "x", skill_times: "x" }, { skill: 1, skill_usage: 2, skill_times: 3 }],
      groups: [{ name: null, opers: "bad" }],
    }),
  };
  const assignment = normalizeAssignment(item);
  expect(assignment.required[0]).toMatchObject({ name: "", skill: 0, skill_usage: 0, skill_times: 1, requirements: {} });
  expect(assignment.required[1]).toMatchObject({ name: "", skill: 1, skill_usage: 2, skill_times: 3, requirements: {} });
  expect(assignment.groups[0]).toMatchObject({ name: "", opers: [] });
});

test("buildOperatorMeta builds operators and name index", () => {
  const characters = {
    char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [{ skillId: "a", skillIcon: "b", skillName: "c" }] },
    char_bad: null,
    char_no_name: { name: "", rarity: 0, profession: "", skills: "bad" },
  };
  const meta = buildOperatorMeta(characters);
  expect(meta.operators.char_002_amiya.name).toBe("阿米娅");
  expect(meta.nameToCharId.阿米娅).toBe("char_002_amiya");
  expect(meta.operators.char_bad).toBeUndefined();
  expect(meta.operators.char_no_name.skills).toEqual([]);
  expect(meta.nameToCharId[""]).toBeUndefined();
  const emptySkills = buildOperatorMeta({ char_x: { name: "X", rarity: 1, profession: "P", skills: [{}, { skillId: "", skillIcon: "", skillName: "" }] } });
  expect(emptySkills.operators.char_x.skills).toEqual([{ skillId: "", skillIcon: "", skillName: "" }, { skillId: "", skillIcon: "", skillName: "" }]);
});

test("parseSkillSpriteCss parses sprite url and entries", () => {
  const css = [
    ".bg-skill_icon_sk_a {",
    "  background-image: url(\"https://example.com/s.jpg\");",
    "  background-position: -0px -256px;",
    "}",
    ".bg-skill_icon_sk_b {",
    "  background-position: -128px -384px;",
    "}",
  ].join("\n");
  const sprite = parseSkillSpriteCss(css);
  expect(sprite.spriteUrl).toBe("https://example.com/s.jpg");
  expect(sprite.size).toBe(128);
  expect(sprite.entries.sk_a).toEqual({ x: 0, y: 256 });
  expect(sprite.entries.sk_b).toEqual({ x: 128, y: 384 });
});

test("parseSkillSpriteCss skips blocks without close or position", () => {
  const sprite = parseSkillSpriteCss(".bg-skill_icon_open {\n  background-position: -0px -0px;\n");
  expect(sprite.spriteUrl).toBe("");
  expect(sprite.entries).toEqual({});
  const noPosition = parseSkillSpriteCss(".bg-skill_icon_nopos {\n  width: 128px;\n}");
  expect(noPosition.entries).toEqual({});
});

test("fetchAllAssignments throws on HTTP error and bad shape", async () => {
  const badFetch = vi.fn().mockResolvedValue(jsonResponse({}, 500));
  await expect(fetchAllAssignments(badFetch)).rejects.toThrow("HTTP 500");
  const badShape = vi.fn().mockResolvedValue(jsonResponse({ data: null }, 200));
  await expect(fetchAllAssignments(badShape)).rejects.toThrow("unexpected shape");
});

test("fetchAllAssignments paginates", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ data: { has_next: true, data: [{ id: 1, content: JSON.stringify({ doc: { title: "A" } }) }] } }, 200))
    .mockResolvedValueOnce(jsonResponse({ data: { has_next: false, data: [{ id: 2, content: JSON.stringify({ doc: { title: "B" } }) }] } }, 200));
  const result = await fetchAllAssignments(fetchImpl);
  expect(result.total).toBe(2);
  expect(result.assignments[0].title).toBe("A");
});

test("generateAll writes generated data files", async () => {
  const fetchImpl = vi.fn((url) => {
    if (url.includes("character_table")) {
      return Promise.resolve(jsonResponse({ char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] } }, 200));
    }
    if (url.includes("sprite_skill")) {
      return Promise.resolve(textResponse(".bg-skill_icon_sk {\nbackground-image: url(\"https://example.com/s.jpg\");\nbackground-position: -0px -0px;\n}", 200));
    }
    return Promise.resolve(jsonResponse({ data: { has_next: false, data: [{ id: 1, content: JSON.stringify({ doc: { title: "A" } }) }] } }, 200));
  });
  const writeFileImpl = vi.fn().mockResolvedValue(undefined);
  const result = await generateAll({ fetchImpl, writeFileImpl, now: new Date("2024-01-01T00:00:00Z") });
  expect(result.assignmentData.total).toBe(1);
  expect(writeFileImpl).toHaveBeenCalledTimes(3);
});

test("generateAll throws on character or css request failure", async () => {
  const maaOk = jsonResponse({ data: { has_next: false, data: [{ id: 1, content: JSON.stringify({ doc: { title: "A" } }) }] } }, 200);
  const charFail = vi.fn((url) => url.includes("character_table")
    ? Promise.resolve(jsonResponse({}, 500))
    : Promise.resolve(url.includes("sprite_skill") ? textResponse("css", 200) : maaOk));
  await expect(generateAll({ fetchImpl: charFail, writeFileImpl: vi.fn(), now: new Date("2024-01-01T00:00:00Z") })).rejects.toThrow("character table request failed");
  const cssFail = vi.fn((url) => {
    if (url.includes("character_table")) return Promise.resolve(jsonResponse({ char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] } }, 200));
    if (url.includes("sprite_skill")) return Promise.resolve(textResponse("bad", 500));
    return Promise.resolve(maaOk);
  });
  await expect(generateAll({ fetchImpl: cssFail, writeFileImpl: vi.fn(), now: new Date("2024-01-01T00:00:00Z") })).rejects.toThrow("skill sprite css request failed");
});
