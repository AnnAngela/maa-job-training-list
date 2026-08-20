import { expect, test } from "vitest";
import {
  buildDemand,
  buildUserLookup,
  computeTrainingList,
  evaluateAssignment,
  evaluateSlot,
  gapWeight,
  normalizeSlotRequirements,
  skillLevelFor,
  standardSlotRequirements,
  standardizeAssignments,
} from "../js/compare.js";

const operatorMeta = {
  nameToCharId: { 阿米娅: "char_002_amiya", 凯尔希: "char_003_kalts", 塞雷娅: "char_202_demkni" },
  operators: {
    char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] },
    char_003_kalts: { name: "凯尔希", rarity: 6, profession: "MEDIC", skills: [] },
    char_202_demkni: { name: "塞雷娅", rarity: 6, profession: "TANK", skills: [] },
  },
};

const amiya = { charId: "char_002_amiya", name: "阿米娅", rarity: 5, profession: "CASTER", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 1 };
const kalts = { charId: "char_003_kalts", name: "凯尔希", rarity: 6, profession: "MEDIC", elite: 2, level: 90, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 3 };

test("normalizeSlotRequirements infers elite from skill and skill_level", () => {
  expect(normalizeSlotRequirements({ skill: 0 })).toEqual({ elite: 0, level: 0, skillLevel: 0, module: -1, moduleLevel: 0 });
  expect(normalizeSlotRequirements({ skill: 2 })).toMatchObject({ elite: 1 });
  expect(normalizeSlotRequirements({ skill: 3 })).toMatchObject({ elite: 2 });
  expect(normalizeSlotRequirements({ skill: 1, requirements: { skill_level: 8 } })).toMatchObject({ elite: 2 });
  expect(normalizeSlotRequirements({ skill: 1, requirements: { skill_level: 5 } })).toMatchObject({ elite: 1 });
  expect(normalizeSlotRequirements({ skill: 1, requirements: { module: 1 } })).toMatchObject({ elite: 2 });
  expect(normalizeSlotRequirements({ skill: 0, requirements: { skill_level: 10 } })).toMatchObject({ skillLevel: 0 });
});

test("skillLevelFor reads the matching skill slot", () => {
  expect(skillLevelFor(1, amiya)).toBe(7);
  expect(skillLevelFor(2, amiya)).toBe(10);
  expect(skillLevelFor(3, amiya)).toBe(10);
  expect(skillLevelFor(0, amiya)).toBe(0);
  expect(skillLevelFor(1, null)).toBe(0);
  expect(skillLevelFor(2, {})).toBe(0);
  expect(skillLevelFor(3, undefined)).toBe(0);
});

test("evaluateSlot reports missing, gaps, and satisfied", () => {
  expect(evaluateSlot({ name: "阿米娅", skill: 2, requirements: { level: 90 } }, null)).toMatchObject({ owned: false, satisfied: false });
  expect(evaluateSlot({ name: "阿米娅", skill: 2, requirements: { level: 90 } }, amiya).gaps).toContainEqual({ type: "level", required: 90, current: 60 });
  expect(evaluateSlot({ name: "阿米娅", skill: 3, requirements: { skill_level: 10 } }, amiya).satisfied).toBe(true);
  expect(evaluateSlot({ name: "阿米娅", skill: 1, requirements: { elite: 2 } }, amiya).satisfied).toBe(true);
  expect(evaluateSlot({ name: "阿米娅", skill: 1, requirements: { elite: 3 } }, amiya).gaps).toContainEqual({ type: "elite", required: 3, current: 2 });
  expect(evaluateSlot({ name: "阿米娅", skill: 1, requirements: { skill_level: 10 } }, amiya).gaps).toContainEqual({ type: "skill_level", skill: 1, required: 10, current: 7 });
});

test("evaluateSlot handles module fallback", () => {
  const moduleGap = evaluateSlot({ name: "阿米娅", skill: 1, requirements: { module: 1 } }, { ...amiya, maxModuleLevel: 0 }, { requireModule: true });
  expect(moduleGap.gaps).toContainEqual({ type: "module", required: 1, current: 0 });
});

test("evaluateSlot handles module requirement toggle", () => {
  const slotModule = { name: "阿米娅", skill: 1, requirements: { module: 1 } };
  expect(evaluateSlot(slotModule, amiya, { requireModule: true }).satisfied).toBe(true);
  expect(evaluateSlot(slotModule, { ...amiya, maxModuleLevel: 0 }, { requireModule: true }).satisfied).toBe(false);
  const slotNoModule = { name: "阿米娅", skill: 1, requirements: { module: 0 } };
  expect(evaluateSlot(slotNoModule, { ...amiya, maxModuleLevel: 0 }, { requireModule: true }).satisfied).toBe(true);
  expect(evaluateSlot(slotNoModule, amiya, { requireModule: true }).satisfied).toBe(false);
});

test("buildUserLookup falls back through name and charId", () => {
  const lookup = buildUserLookup([amiya, kalts], operatorMeta);
  expect(lookup("阿米娅")).toBe(amiya);
  expect(lookup("char_002_amiya")).toBe(amiya);
  expect(lookup("不存在")).toBeNull();
});

test("evaluateAssignment requires all core and any group member", () => {
  const assignment = {
    id: 1,
    required: [{ name: "阿米娅", skill: 2, requirements: { level: 60 } }],
    groups: [{ name: "奶盾", opers: [{ name: "塞雷娅", skill: 1 }, { name: "凯尔希", skill: 1 }] }],
  };
  const lookup = buildUserLookup([amiya, kalts], operatorMeta);
  const result = evaluateAssignment(assignment, lookup, {});
  expect(result.ready).toBe(true);
});

test("evaluateAssignment marks group unsatisfied when no member matches", () => {
  const assignment = {
    id: 2,
    required: [{ name: "阿米娅", skill: 2, requirements: { level: 60 } }],
    groups: [{ name: "奶盾", opers: [{ name: "塞雷娅", skill: 1 }] }],
  };
  const result = evaluateAssignment(assignment, buildUserLookup([amiya], operatorMeta), {});
  expect(result.ready).toBe(false);
  expect(result.groupResults[0].satisfied).toBe(false);
});

test("evaluateAssignment treats no named requirement as ready", () => {
  const result = evaluateAssignment({ id: 3, required: [], groups: [] }, () => null, {});
  expect(result.ready).toBe(true);
  expect(result.hasNamedRequirements).toBe(false);
});

test("evaluateAssignment defaults missing required and group fields", () => {
  const result = evaluateAssignment({ id: 4, required: null, groups: [{ name: "", opers: null }] }, () => null, {});
  expect(result.ready).toBe(false);
  expect(result.hasNamedRequirements).toBe(true);
  expect(result.groupResults[0].satisfied).toBe(false);
  const noGroups = evaluateAssignment({ id: 5, required: [], groups: null }, () => null, {});
  expect(noGroups.ready).toBe(true);
  expect(noGroups.hasNamedRequirements).toBe(false);
});

test("buildDemand counts core, group, and recent demand", () => {
  const assignments = [
    { id: 1, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅" }], groups: [{ opers: [{ name: "塞雷娅" }] }] },
    { id: 2, uploadTime: "2020-01-01", required: [{ name: "阿米娅" }], groups: [] },
  ];
  const demand = buildDemand(assignments, { recentDays: 90, now: Date.now() });
  expect(demand.get("阿米娅")).toMatchObject({ coreDemand: 2, recentCoreDemand: 1 });
  expect(demand.get("塞雷娅")).toMatchObject({ groupDemand: 1 });
});

test("buildDemand defaults options and missing arrays", () => {
  const demand = buildDemand([{ id: 1, uploadTime: "", required: [{ name: "阿米娅" }], groups: [{ opers: null }] }], undefined);
  expect(demand.get("阿米娅").coreDemand).toBe(1);
  expect(demand.get("阿米娅").recentCoreDemand).toBe(0);
});

test("buildDemand ignores empty names and merges duplicate appearances", () => {
  const assignments = [
    { id: 1, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "" }], groups: [{ opers: [{ name: "阿米娅" }] }] },
    { id: 2, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅" }], groups: [{ opers: [{ name: "阿米娅" }] }] },
  ];
  const demand = buildDemand(assignments, { recentDays: 90, now: Date.now() });
  expect(demand.has("")).toBe(false);
  const record = demand.get("阿米娅");
  expect(record.assignments.get(2)).toEqual({ core: true, group: true });
  expect(record.coreDemand).toBe(1);
  expect(record.groupDemand).toBe(2);
});

test("gapWeight returns weight per gap type", () => {
  expect(gapWeight({ type: "missing" })).toBe(1000);
  expect(gapWeight({ type: "elite" })).toBe(200);
  expect(gapWeight({ type: "level" })).toBe(20);
  expect(gapWeight({ type: "skill_level" })).toBe(10);
  expect(gapWeight({ type: "module" })).toBe(5);
  expect(gapWeight({ type: "unknown" })).toBe(1);
});

test("computeTrainingList summarizes and prioritizes", () => {
  const assignments = [
    { id: 1, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅", skill: 2, requirements: { level: 90, skill_level: 10 } }], groups: [] },
    { id: 2, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "凯尔希", skill: 2, requirements: { level: 90, skill_level: 10 } }], groups: [] },
  ];
  const result = computeTrainingList({ assignments, userOperators: [amiya], operatorMeta, options: {} });
  expect(result.summary.totalAssignments).toBe(2);
  expect(result.summary.readyCount).toBe(0);
  expect(result.summary.missingOperators).toBe(1);
  expect(result.rows.length).toBe(2);
  expect(result.rows[0].name).toBe("阿米娅");
  expect(result.rows[0].user).toBe(amiya);
});

test("computeTrainingList computes per-skill and module target maxima", () => {
  const assignments = [
    { id: 1, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅", skill: 2, requirements: { level: 60, skill_level: 7 } }], groups: [] },
    { id: 2, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅", skill: 3, requirements: { level: 90, skill_level: 10, module: 2 } }, { name: "阿米娅", skill: 1, requirements: { skill_level: 5 } }], groups: [] },
  ];
  const result = computeTrainingList({ assignments, userOperators: [], operatorMeta, options: {} });
  const amiyaRow = result.rows.find((row) => row.name === "阿米娅");
  expect(amiyaRow.target).toMatchObject({ elite: 2, level: 90, skill1: 5, skill2: 7, skill3: 10, module: 2 });
});

test("computeTrainingList keeps out-of-range skill slots out of target skills", () => {
  const assignments = [
    { id: 1, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅", skill: 4, requirements: { skill_level: 8 } }], groups: [{ name: "组", opers: [{ name: "阿米娅", skill: 0, requirements: { level: 50 } }] }] },
    { id: 2, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [], groups: [{ name: "组2", opers: [{ name: "阿米娅", skill: 4, requirements: { skill_level: 9 } }] }] },
  ];
  const result = computeTrainingList({ assignments, userOperators: [], operatorMeta, options: {} });
  const amiyaRow = result.rows.find((row) => row.name === "阿米娅");
  expect(amiyaRow.target).toMatchObject({ elite: 3, level: 50, skill1: 0, skill2: 0, skill3: 0 });
});

test("computeTrainingList handles group gains and other required operators", () => {
  const assignments = [
    {
      id: 1,
      uploadTime: new Date(Date.now() - 1000).toISOString(),
      required: [{ name: "阿米娅", skill: 1, requirements: { level: 90 } }],
      groups: [{ name: "输出", opers: [{ name: "塞雷娅", skill: 1, requirements: { skill_level: 7 } }] }],
    },
    {
      id: 2,
      uploadTime: new Date(Date.now() - 1000).toISOString(),
      required: [{ name: "阿米娅", skill: 1, requirements: { level: 60 } }, { name: "凯尔希", skill: 1, requirements: { level: 90 } }],
      groups: [],
    },
  ];
  const result = computeTrainingList({ assignments, userOperators: [amiya], operatorMeta, options: {} });
  const saria = result.rows.find((row) => row.name === "塞雷娅");
  expect(saria).toBeTruthy();
  expect(saria.groupGain).toBeGreaterThanOrEqual(0);
  expect(result.rows.some((row) => row.name === "凯尔希")).toBe(true);
});

test("standardSlotRequirements overrides with rarity max and mastery", () => {
  // 阿米娅 5★ -> 精2 80级；技能专三；模组类型保留、等级统一三级
  expect(standardSlotRequirements({ name: "阿米娅", skill: 2, requirements: { level: 60, skill_level: 7, module: 1 } }, operatorMeta)).toEqual({ elite: 2, level: 80, skill_level: 10, module: 1, module_level: 3 });
  // 凯尔希 6★ -> 精2 90级；module 2 = Y 型
  expect(standardSlotRequirements({ name: "凯尔希", skill: 3, requirements: { module: 2 } }, operatorMeta)).toEqual({ elite: 2, level: 90, skill_level: 10, module: 2, module_level: 3 });
  // 未指定技能 -> 不要求技能等级；无模组要求保持不变
  expect(standardSlotRequirements({ name: "阿米娅", skill: 0, requirements: { level: 60 } }, operatorMeta)).toEqual({ elite: 2, level: 80, skill_level: 0, module: -1, module_level: 0 });
  // module 4 = D 型，标准模式要求三级
  expect(standardSlotRequirements({ name: "阿米娅", skill: 1, requirements: { module: 4 } }, operatorMeta)).toEqual({ elite: 2, level: 80, skill_level: 10, module: 4, module_level: 3 });
  // 未收录干员按 6★ 标准
  expect(standardSlotRequirements({ name: "不存在", skill: 1, requirements: {} }, operatorMeta)).toEqual({ elite: 2, level: 90, skill_level: 10, module: -1, module_level: 0 });
});

test("standardizeAssignments rewrites required and group slots", () => {
  const assignments = [{
    id: 1,
    uploadTime: new Date(Date.now() - 1000).toISOString(),
    required: [{ name: "阿米娅", skill: 2, requirements: { level: 60, skill_level: 7, module: 1 } }],
    groups: [{ name: "组", opers: [{ name: "凯尔希", skill: 1, requirements: { level: 90 } }] }],
  }, {
    id: 2,
    uploadTime: new Date(Date.now() - 1000).toISOString(),
    required: undefined,
    groups: [{ name: "组2", opers: undefined }, { name: "组3" }],
  }, {
    id: 3,
    uploadTime: new Date(Date.now() - 1000).toISOString(),
    required: [],
    groups: undefined,
  }];
  const [out, sparse, noGroups] = standardizeAssignments(assignments, operatorMeta);
  expect(out.id).toBe(1);
  expect(out.required[0].requirements).toEqual({ elite: 2, level: 80, skill_level: 10, module: 1, module_level: 3 });
  expect(out.groups[0].opers[0].requirements).toEqual({ elite: 2, level: 90, skill_level: 10, module: -1, module_level: 0 });
  expect(sparse.required).toEqual([]);
  expect(sparse.groups[0].opers).toEqual([]);
  expect(sparse.groups[1].opers).toEqual([]);
  expect(noGroups.groups).toEqual([]);
  expect(standardizeAssignments(null, operatorMeta)).toEqual([]);
});

test("computeTrainingList sorts rows by unsatisfiedCore desc", () => {
  const assignments = [
    { id: 1, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 99 } }], groups: [] },
    { id: 2, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 99 } }], groups: [] },
    { id: 3, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "凯尔希", skill: 1, requirements: { level: 99 } }], groups: [] },
  ];
  const result = computeTrainingList({ assignments, userOperators: [], operatorMeta, options: {} });
  expect(result.rows[0].name).toBe("阿米娅");
  expect(result.rows[0].unsatisfiedCore).toBe(2);
  expect(result.rows.map((row) => row.unsatisfiedCore)).toEqual([2, 1]);
});

test("computeTrainingList covers ready skips, group gain, and module fallbacks", () => {
  const assignments = [
    { id: 1, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 60, module: 1 } }], groups: [] },
    { id: 2, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 99, module: 1 } }], groups: [] },
    { id: 3, uploadTime: new Date(Date.now() - 1000).toISOString(), required: undefined, groups: [{ name: "组", opers: [{ name: "塞雷娅", skill: 1, requirements: { skill_level: 7, module: 1 } }] }] },
    { id: 4, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "阿米娅", skill: 1, requirements: { level: 99 } }], groups: [{}] },
    { id: 5, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "凯尔希", skill: 1, requirements: { level: 99 } }], groups: undefined },
    { id: 6, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "塞雷娅", skill: 1, requirements: { level: 99, skill_level: 10 } }], groups: [{ name: "组", opers: [{ name: "塞雷娅", skill: 1, requirements: { skill_level: 7 } }] }] },
  ];
  const result = computeTrainingList({ assignments, userOperators: [amiya], operatorMeta, options: {} });
  const saria = result.rows.find((row) => row.name === "塞雷娅");
  expect(saria.groupGain).toBeGreaterThanOrEqual(0);
  expect(result.rows.some((row) => row.name === "凯尔希")).toBe(true);
});

test("computeTrainingList tie-breaks by name", () => {
  const assignments = [
    { id: 1, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "b" }], groups: [] },
    { id: 2, uploadTime: new Date(Date.now() - 1000).toISOString(), required: [{ name: "a" }], groups: [] },
  ];
  const result = computeTrainingList({ assignments, userOperators: [], operatorMeta: { nameToCharId: {}, operators: {} }, options: {} });
  expect(result.rows[0].name).toBe("a");
  expect(result.rows[1].name).toBe("b");
});

test("computeTrainingList handles empty assignments", () => {
  const result = computeTrainingList({ assignments: [], userOperators: [], operatorMeta, options: {} });
  expect(result.rows).toEqual([]);
  expect(result.summary).toMatchObject({ totalAssignments: 0, readyCount: 0 });
});
