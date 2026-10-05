import { expect, test } from "vitest";
import {
    ELITE_GOLD_COST,
    aggregateMaterials,
    attachMaterials,
    buildCostIndex,
    computeCostBreakdown,
    currentModuleLevel,
} from "../js/cost.js";
import { formatCount } from "../js/util.js";

// 阿米娅成本数据（提取自一图流 character_table_simple.v2.json 真实数据）
const AMIYA = {
    rarity: 5,
    elite: [{}, { 3251: 3, 30042: 4, 30062: 4 }, { 3253: 3, 30014: 10, 30073: 10 }],
    allSkill: [
        { 3301: 4 },
        { 3301: 4, 30061: 4 },
        { 3302: 6, 30012: 4 },
        { 3302: 6, 30022: 5 },
        { 3302: 6, 30053: 4 },
        { 3303: 6, 30023: 3, 30063: 2 },
    ],
    skills: [
        {
            skillId: "skcom_magic_rage[3]",
            skillLevelUpCost: [
                [{ id: "3303", count: 5 }, { id: "30074", count: 3 }, { id: "30053", count: 5 }],
                [{ id: "3303", count: 6 }, { id: "30094", count: 3 }, { id: "30074", count: 6 }],
                [{ id: "3303", count: 10 }, { id: "30135", count: 4 }, { id: "30014", count: 5 }],
            ],
        },
        {
            skillId: "skchr_amiya_2",
            skillLevelUpCost: [
                [{ id: "3303", count: 5 }, { id: "30084", count: 3 }, { id: "30063", count: 2 }],
                [{ id: "3303", count: 6 }, { id: "30104", count: 3 }, { id: "30084", count: 5 }],
                [{ id: "3303", count: 10 }, { id: "30115", count: 4 }, { id: "30074", count: 5 }],
            ],
        },
        {
            skillId: "skchr_amiya_3",
            skillLevelUpCost: [
                [{ id: "3303", count: 5 }, { id: "30094", count: 3 }, { id: "30073", count: 4 }],
                [{ id: "3303", count: 6 }, { id: "30014", count: 3 }, { id: "30094", count: 6 }],
                [{ id: "3303", count: 10 }, { id: "30125", count: 4 }, { id: "30034", count: 4 }],
            ],
        },
    ],
    equip: [
        {
            typeName2: "Y",
            itemCost: [
                { 4001: 40000, 30034: 3, mod_unlock_token: 2 },
                { 4001: 50000, 30054: 4, mod_unlock_token: 2, mod_update_token_1: 20 },
                { 4001: 60000, 30044: 5, mod_unlock_token: 2, mod_update_token_2: 8 },
            ],
        },
    ],
};

const index = buildCostIndex({ char_002_amiya: AMIYA });
const costEntry = index.char_002_amiya;

const compute = (current, target, levelCostTable, requireModule) => computeCostBreakdown({
    charId: "char_002_amiya",
    costEntry,
    rarity: costEntry.rarity,
    current,
    target,
    levelCostTable,
    requireModule,
});

test("buildCostIndex 构建成本索引", () => {
    expect(costEntry.rarity).toBe(5);
    expect(costEntry.elite).toHaveLength(3);
    expect(costEntry.allSkill).toHaveLength(6);
    expect(costEntry.skills).toHaveLength(3);
    expect(costEntry.skills[1].skillId).toBe("skchr_amiya_2");
    expect(costEntry.mods.Y).toHaveLength(3);
});

test("精英化精0到精2：材料与龙门币，且不重复计入当前阶段材料", () => {
    const { evolve, total } = compute({ elite: 0, level: 1 }, { elite: 2, level: 0 });
    expect(evolve.notes).toContain("精零1 → 精二");
    expect(total["3251"]).toBe(3);
    expect(total["3253"]).toBe(3);
    expect(total["30014"]).toBe(10);
    expect(total["30073"]).toBe(10);
    // 龙门币 = 精一 20000 + 精二 120000
    expect(total["4001"]).toBe(ELITE_GOLD_COST[5][0] + ELITE_GOLD_COST[5][1]);
});

test("精英化精1到精2：不重复计算精一材料（一图流原实现的边界问题）", () => {
    const { total } = compute({ elite: 1, level: 60 }, { elite: 2, level: 0 });
    expect(total["3251"]).toBeUndefined();
    expect(total["3253"]).toBe(3);
    expect(total["4001"]).toBe(ELITE_GOLD_COST[5][1]);
});

test("目标不超过当前时无材料缺口", () => {
    const current = { elite: 2, level: 90, skill1: 10, skill2: 10, skill3: 10 };
    const target = { elite: 2, level: 80, skill1: 10, skill2: 10, skill3: 10 };
    const { total } = compute(current, target);
    expect(total).toEqual({});
});

test("技能1从6升到7：取 allSkill 第6项，归入专精组", () => {
    const { mastery, total } = compute({ elite: 2, level: 60, skill1: 6 }, { elite: 2, level: 0, skill1: 7 });
    expect(mastery.notes).toEqual(["6/0/0 → 7/0/0"]);
    expect(total).toEqual({ 3303: 6, 30023: 3, 30063: 2 });
});

test("技能2从7专精到10：三段专精成本合并", () => {
    const { mastery, total } = compute({ elite: 2, level: 60, skill2: 7 }, { elite: 2, level: 0, skill2: 10 });
    expect(mastery.notes).toEqual(["0/7/0 → 0/10/0"]);
    expect(total).toEqual({
        // M1+M2+M3 的技巧概要·卷3：5+6+10
        3303: 21,
        30084: 8,
        30063: 2,
        30104: 3,
        30115: 4,
        30074: 5,
    });
});

test("技能从6直接专三：自动补齐升7与专精材料", () => {
    const { total } = compute({ elite: 2, level: 60, skill3: 6 }, { elite: 2, level: 0, skill3: 10 });
    // 升7：3303×6+30023×3+30063×2；专精：3303×(5+6+10)+30094×3+30073×4+30014×3+30094×6+30125×4+30034×4
    expect(total["3303"]).toBe(6 + 21);
    expect(total["30023"]).toBe(3);
    expect(total["30063"]).toBe(2);
    expect(total["30094"]).toBe(9);
    expect(total["30125"]).toBe(4);
    expect(total["30034"]).toBe(4);
});

test("模组从0级到3级：三段成本合并（含模组证章与龙门币）", () => {
    const current = { elite: 2, level: 60, modules: [] };
    const target = { elite: 2, level: 0, module: 2, moduleLevel: 3 };
    const { module, total } = compute(current, target);
    // 无已解锁模组时说明显示「无模组 → 目标」
    expect(module.notes).toEqual(["无模组 → 模组Y"]);
    expect(total["4001"]).toBe(40000 + 50000 + 60000);
    expect(total.mod_unlock_token).toBe(6);
    expect(total.mod_update_token_1).toBe(20);
    expect(total.mod_update_token_2).toBe(8);
    expect(total["30034"]).toBe(3);
    expect(total["30054"]).toBe(4);
    expect(total["30044"]).toBe(5);
});

test("模组从1级到2级：只计一级差", () => {
    const current = { elite: 2, level: 60, modules: [{ name: "Y", level: 1, locked: false }] };
    const target = { elite: 2, level: 0, module: 2, moduleLevel: 2 };
    const { total } = compute(current, target);
    expect(total["4001"]).toBe(50000);
    expect(total.mod_update_token_1).toBe(20);
});

test("模组开关关闭：保留占位并标记未计入，不产出材料", () => {
    const current = { elite: 2, level: 60, modules: [] };
    const target = { elite: 2, level: 0, module: 2, moduleLevel: 3 };
    const { module, total } = compute(current, target, undefined, false);
    expect(module.excluded).toBe(true);
    expect(module.items).toEqual({});
    expect(module.notes).toEqual([]);
    expect(total.mod_unlock_token).toBeUndefined();
    expect(total.mod_update_token_1).toBeUndefined();
    expect(total["4001"]).toBeUndefined();
});

test("currentModuleLevel 读取未锁定模组等级", () => {
    expect(currentModuleLevel({ modules: [{ name: "Y", level: 2, locked: false }] }, "Y")).toBe(2);
    expect(currentModuleLevel({ modules: [{ name: "Y", level: 2, locked: true }] }, "Y")).toBe(0);
    expect(currentModuleLevel({ modules: [] }, "Y")).toBe(0);
});

test("等级消耗：按每级 gold/exp 累加，经验折算为中级作战记录", () => {
    // 5星精2 上限 80：70→80 需要等级 70..79 的每级成本（数组索引 0 对应 1 级）
    const elite2 = Array.from({ length: 80 }, () => ({ exp: 1000, gold: 200 }));
    const levelCostTable = { elite0: [], elite1: [], elite2 };
    const { evolve, total } = compute({ elite: 2, level: 70 }, { elite: 2, level: 80 }, levelCostTable);
    expect(evolve.notes).toEqual(["精二70 → 精二80"]);
    expect(total["4001"]).toBe(2000);
    expect(total["2003"]).toBe(10);
});

test("等级消耗跨精英阶段：上一阶段补满后进入下一阶段", () => {
    const levelCostTable = {
        elite1: Array.from({ length: 70 }, () => ({ exp: 500, gold: 100 })),
        elite2: Array.from({ length: 90 }, () => ({ exp: 1000, gold: 200 })),
    };
    // 5星精1 70级 → 精2 72级：精1 阶段 70<80 已满级无消耗，精2 阶段 1..71；
    // 同时跨过精二，龙门币含精英二 120000
    const { evolve, total } = compute({ elite: 1, level: 70 }, { elite: 2, level: 72 }, levelCostTable);
    expect(evolve.notes).toEqual(["精一70 → 精二72"]);
    expect(total["4001"]).toBe(ELITE_GOLD_COST[5][1] + 71 * 200);
    expect(total["2003"]).toBe(71);
});

test("aggregateMaterials 合并多名干员材料", () => {
    const total = aggregateMaterials([
        { 3303: 21, 4001: 120000 },
        { 3303: 5, 4001: 60000 },
        null,
    ]);
    expect(total).toEqual({ 3303: 26, 4001: 180000 });
});

test("attachMaterials 挂载成本分组并跳过未拥有与缺数据行", () => {
    const rows = [
        { name: "阿米娅", user: { charId: "char_002_amiya", elite: 1, level: 60, skill1: 7 }, target: { elite: 2, level: 0, skill1: 10 } },
        { name: "未拥有干员", user: null, target: { elite: 2, level: 0 } },
        { name: "陌生人", user: { elite: 1, level: 1 }, target: { elite: 2, level: 0 } },
    ];
    attachMaterials(rows, {
        costIndex: index,
        levelCostTable: null,
        charIdOf: (row) => row.user?.charId ? "char_002_amiya" : "",
    });
    expect(rows[0].costBreakdown.total["3253"]).toBe(3);
    expect(rows[0].costBreakdown.total["3303"]).toBe(21);
    expect(rows[0].costBreakdown.mastery.notes).toEqual(["7/0/0 → 10/0/0"]);
    expect(rows[1].costBreakdown).toBeNull();
    expect(rows[2].costBreakdown).toBeNull();
});

test("formatCount 万单位显示", () => {
    expect(formatCount(180000)).toBe("18万");
    expect(formatCount(125000)).toBe("12.5万");
    expect(formatCount(8000)).toBe("8,000");
});
