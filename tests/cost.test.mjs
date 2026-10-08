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

test("共享基础等级成本：多技能同目标时 allSkill 仅累计一次", () => {
    // 技能1、技能2 都从 1 升到 7：allSkill 是共享成本，不随技能数翻倍
    const { total } = compute(
        { elite: 2, level: 60, skill1: 1, skill2: 1, skill3: 1 },
        { elite: 2, level: 0, skill1: 7, skill2: 7 },
    );
    // 升到 7 级的 allSkill 第6项：3303×6 仅一次（非 12）
    expect(total["3303"]).toBe(6);
    expect(total["30023"]).toBe(3);
    expect(total["30063"]).toBe(2);
});

test("专精成本从当前等级下一段起算：专二升专三不计前两段", () => {
    // 技能2 已专二（9），目标专三（10）：仅 M3
    const { total } = compute(
        { elite: 2, level: 60, skill1: 1, skill2: 9, skill3: 1 },
        { elite: 2, level: 0, skill2: 10 },
    );
    // 仅 M3 的 3303×10（非三段合计 21）
    expect(total["3303"]).toBe(10);
    expect(total).not.toHaveProperty("30084");
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

test("buildCostIndex 跳过空干员与无类型模组", () => {
    const built = buildCostIndex({
        char_bad: null,
        char_weird: { rarity: 4, elite: "bad", allSkill: null, skills: "bad", equip: [null, { typeName2: "", itemCost: [] }, { typeName2: "X" }] },
    });
    expect(built.char_bad).toBeUndefined();
    const entry = built.char_weird;
    expect(entry.rarity).toBe(4);
    expect(entry.elite).toEqual([]);
    expect(entry.allSkill).toEqual([]);
    expect(entry.skills).toEqual([]);
    // 无 typeName2 或 itemCost 非数组的装备均不收录
    expect(entry.mods).toEqual({});
});

test("成本条目的空 id、零数量、空成本段与等级表空洞被忽略", () => {
    // 2星干员精英0→精英1：精一材料为 null（addCostList 早退）；
    // 精英龙门币为 0（addItem 的零数量分支）
    const cheapEntry = buildCostIndex({
        char_cheap: { rarity: 2, elite: [{}, null], allSkill: [], skills: [], equip: [] },
    }).char_cheap;
    const cheap = computeCostBreakdown({
        charId: "char_cheap",
        costEntry: cheapEntry,
        rarity: 2,
        current: { elite: 0, level: 1 },
        target: { elite: 1, level: 0 },
        levelCostTable: { elite0: [], elite1: [] },
    });
    expect(cheap.total).toEqual({});
    // 精英材料对象含空字符串键：addItem 的空 id 分支
    const blankEntry = buildCostIndex({
        char_blank: { rarity: 6, elite: [{}, { "": 5 }], allSkill: [], skills: [], equip: [] },
    }).char_blank;
    const blank = computeCostBreakdown({
        charId: "char_blank",
        costEntry: blankEntry,
        rarity: 6,
        current: { elite: 0, level: 1 },
        target: { elite: 1, level: 0 },
        levelCostTable: { elite0: [], elite1: [] },
    });
    expect(blank.total[""]).toBeUndefined();
    expect(blank.total["4001"]).toBe(ELITE_GOLD_COST[6][0]);
    // 等级表空洞：缺级条目跳过，只统计有效成本
    const sparseTable = { elite2: [null, { exp: 0, gold: 0 }, { exp: 1000, gold: 200 }] };
    const sparse = compute({ elite: 2, level: 1 }, { elite: 2, level: 3 }, sparseTable);
    expect(sparse.total["2003"]).toBe(1);
    expect(sparse.total["4001"]).toBe(200);
});

test("不存在的精英阶段跳过，且排除干员返回空分组", () => {
    // 4星无精二阶段：目标精英只到 1 时，精二轨道 maxLevel 0 -> continue
    const fourStar = buildCostIndex({ char_x: { ...AMIYA, rarity: 4 } }).char_x;
    const result = computeCostBreakdown({
        charId: "char_x",
        costEntry: fourStar,
        rarity: 4,
        current: { elite: 0, level: 1 },
        target: { elite: 1, level: 0 },
        levelCostTable: { elite0: [], elite1: [] },
    });
    expect(result.evolve.notes.join(" ")).toContain("精零");
    // 排除名单中的干员：直接返回空分组，两个分支
    for (const charId of ["char_4195_radian", "char_4230_mcnist"]) {
        const excluded = computeCostBreakdown({
            charId,
            costEntry,
            rarity: 6,
            current: { elite: 0, level: 1 },
            target: { elite: 2, level: 90 },
        });
        expect(excluded.total).toEqual({});
        expect(excluded.evolve.items).toEqual({});
    }
    // costEntry 缺失同样走提前返回
    expect(computeCostBreakdown({ charId: "char_x", costEntry: null, rarity: 0, current: {}, target: {} }).total).toEqual({});
});

test("无可成对要求时使用聚合精英等级，空集合排序得到 undefined", () => {
    // 目标不带 levelPairs 时回退为 {elite, level} 单对
    const { evolve } = compute({ elite: 1, level: 60 }, { elite: 2, level: 80 });
    expect(evolve.notes.join(" ")).toContain("精一60 → 精二80");
    // 所有要求对均已满足：unmetPair 为空集合的排序结果
    const done = compute(
        { elite: 2, level: 80 },
        { elite: 2, level: 80, levelPairs: [{ elite: 2, level: 80 }] },
    );
    expect(done.evolve.notes).toEqual([]);
});

test("aggregateMaterials 兼容空入参与空材料元素", () => {
    // materialMaps 缺省 -> []；元素 null -> {}
    expect(aggregateMaterials(null)).toEqual({});
    expect(aggregateMaterials([null, { 3303: 2 }, undefined])).toEqual({ 3303: 2 });
});

test("buildCostIndex 忽略非对象干员与空技能条目", () => {
    const built = buildCostIndex({
        c_num: 42,
        c_skill: { rarity: 5, elite: [], allSkill: [], skills: [null, {}], equip: [] },
    });
    // 非对象干员跳过；空技能条目补默认字段
    expect(built.c_num).toBeUndefined();
    expect(built.c_skill.skills).toEqual([
        { skillId: "", skillLevelUpCost: [] },
        { skillId: "", skillLevelUpCost: [] },
    ]);
});

test("专精成本数组忽略无 id 与零数量条目", () => {
    const customEntry = buildCostIndex({
        c: {
            rarity: 6,
            elite: [],
            allSkill: [],
            skills: [{
                skillId: "s",
                skillLevelUpCost: [[{ count: 5 }, { id: "x", count: 0 }, { id: "y", count: 2 }]],
            }],
            equip: [],
        },
    }).c;
    const { total } = computeCostBreakdown({
        charId: "c",
        costEntry: customEntry,
        rarity: 6,
        current: { elite: 2, level: 60, skill1: 7 },
        target: { elite: 2, level: 0, skill1: 8 },
    });
    expect(total).toEqual({ y: 2 });
});

test("currentModuleLevel 兼容非数组、空条目与锁定模组", () => {
    expect(currentModuleLevel(null, "X")).toBe(0);
    expect(currentModuleLevel({ modules: null }, "X")).toBe(0);
    expect(currentModuleLevel({
        modules: [null, {}, { name: "Y" }, { name: "X", level: 2, locked: true }],
    }, "X")).toBe(0);
});

test("精英三阶与未知稀有度：高阶材料取数、龙门币按零", () => {
    // rarity 7：ELITE_GOLD_COST / ELITE_MAX_LEVEL 均无此档
    const { evolve, total } = computeCostBreakdown({
        charId: "char_002_amiya",
        costEntry,
        rarity: 7,
        current: { elite: 0, level: 1 },
        target: { elite: 3, level: 0 },
    });
    expect(evolve.notes).toEqual(["精零1 → 精3"]);
    // 精英一、二材料计入；龙门币零；精英三材料段不存在
    expect(total["3251"]).toBe(3);
    expect(total["3253"]).toBe(3);
    expect(total["4001"]).toBeUndefined();
});

test("技能目标低于七级且当前为零：补低级材料", () => {
    const { mastery, total } = compute(
        { elite: 2, level: 60, skill1: 0 },
        { elite: 2, level: 0, skill1: 5 },
    );
    expect(mastery.notes).toEqual(["0/0/0 → 5/0/0"]);
    // allSkill 前四段：3301 各 4
    expect(total["3301"]).toBe(8);
    expect(total["3302"]).toBe(12);
});

test("技能条目缺专精成本段时跳过", () => {
    const noMastery = buildCostIndex({
        c: { rarity: 6, elite: [], allSkill: [], skills: [{ skillId: "s" }], equip: [] },
    }).c;
    const { total } = computeCostBreakdown({
        charId: "c",
        costEntry: noMastery,
        rarity: 6,
        current: { elite: 2, level: 60, skill1: 7 },
        target: { elite: 2, level: 0, skill1: 10 },
    });
    expect(total).toEqual({});
});

test("等级表缺精英阶段键时不计升级成本", () => {
    const { total } = compute({ elite: 2, level: 60 }, { elite: 2, level: 65 }, {});
    expect(total).toEqual({});
});

test("current 或 target 缺省按零处理，非数练度按零处理", () => {
    const fromNull = computeCostBreakdown({
        charId: "char_002_amiya",
        costEntry,
        rarity: 5,
        current: null,
        target: { elite: 2, level: 90 },
    });
    // 等级 0 时省略数字，仅显示精英阶段
    expect(fromNull.evolve.notes.join("")).toContain("精零 → 精二90");
    const toNull = computeCostBreakdown({
        charId: "char_002_amiya",
        costEntry,
        rarity: 5,
        current: { elite: "x", level: "y" },
        target: null,
    });
    expect(toNull.evolve.notes).toEqual([]);
});

test("模组已解锁条目：证章、零级与锁定模组不进说明", () => {
    const current = {
        elite: 2,
        level: 60,
        modules: [
            null,
            { name: "", level: 1, locked: false },
            { name: "X", level: 2, locked: false },
            { name: "Y", level: 0, locked: false },
            { name: "Y", level: 3, locked: true },
        ],
    };
    const { module } = compute(current, { elite: 2, level: 0, module: 2, moduleLevel: 3 });
    // 只有未锁定且等级大于零的异名模组进入说明
    expect(module.notes).toEqual(["模组X 2级 → 模组Y"]);
});

test("attachMaterials 跳过零稀有度；模组未计入时保留分组", () => {
    const localIndex = buildCostIndex({
        char_zero: { rarity: 0, elite: [], allSkill: [], skills: [], equip: [] },
    });
    const zeroRow = { name: "零稀有", user: { charId: "char_zero" }, target: {} };
    attachMaterials([zeroRow], {
        costIndex: localIndex,
        levelCostTable: null,
        charIdOf: (row) => row.user.charId,
    });
    expect(zeroRow.costBreakdown).toBeNull();

    // 未拥有干员从零练度起算；模组开关关闭 -> excluded 占位保留
    const excludedRow = { name: "阿米娅", user: null, target: { module: 2 } };
    attachMaterials([excludedRow], {
        costIndex: index,
        levelCostTable: null,
        charIdOf: () => "char_002_amiya",
        requireModule: false,
    });
    expect(excludedRow.costBreakdown).not.toBeNull();
    expect(excludedRow.costBreakdown.module.excluded).toBe(true);
});

test("非数数量与空入参：各层默认值分支", () => {
    // aggregateMaterials：非数 count -> 0，addItem 丢弃零数量条目
    expect(aggregateMaterials([{ x: "abc" }])).toEqual({});
    // buildCostIndex：characters 缺省、equip 非数组、各字段非数组
    const built = buildCostIndex({
        c: { rarity: "x", elite: "x", allSkill: "x", skills: "x", equip: "x" },
    });
    const entry = built.c;
    expect(entry.rarity).toBe(0);
    expect(entry.elite).toEqual([]);
    expect(entry.allSkill).toEqual([]);
    expect(entry.skills).toEqual([]);
    // equip 非数组 -> mods 空；mods 收集的两个拒绝分支（无 typeName2、itemCost 非数组）
    const withEquip = buildCostIndex({
        c: {
            rarity: 5,
            elite: [],
            allSkill: [],
            skills: [],
            equip: [{}, { typeName2: "X" }, { typeName2: "Y", itemCost: "x" }],
        },
    });
    expect(withEquip.c.mods).toEqual({});
});

test("addCostList 对象路径：零数量与非数条目忽略", () => {
    const objectEntry = buildCostIndex({
        c: {
            rarity: 6,
            elite: [{}, { x: 0, y: 2 }],
            allSkill: [],
            skills: [],
            equip: [],
        },
    }).c;
    const { total } = computeCostBreakdown({
        charId: "c",
        costEntry: objectEntry,
        rarity: 6,
        current: { elite: 0, level: 1 },
        target: { elite: 1, level: 0 },
    });
    // x 数量 0 忽略，仅 y
    expect(total).toEqual({ y: 2, 4001: 30000 });
    // 数组路径零/非数 count
    const arrayEntry = buildCostIndex({
        c2: {
            rarity: 6,
            elite: [{}, [{ id: "a", count: 0 }, { id: "b", count: "bad" }, { id: "c", count: 3 }]],
            allSkill: [],
            skills: [],
            equip: [],
        },
    }).c2;
    const arrayResult = computeCostBreakdown({
        charId: "c2",
        costEntry: arrayEntry,
        rarity: 6,
        current: { elite: 0, level: 1 },
        target: { elite: 1, level: 0 },
    });
    expect(arrayResult.total).toEqual({ c: 3, 4001: 30000 });
});

test("要求对排序：同精英阶段不同等级实际比较；精英非数按零", () => {
    // 两对 elite 相同（1）等级不同，且乱序
    const { evolve } = compute(
        { elite: 0, level: 1 },
        { elite: 1, level: 55, levelPairs: [{ elite: 1, level: 40 }, { elite: 1, level: 55 }] },
    );
    expect(evolve.notes).toEqual(["精零1 → 精一55"]);
    // 要求对精英字段非数：按 0，不产生缺口
    const nonNum = compute(
        { elite: 0, level: 1 },
        { elite: 0, level: 0, levelPairs: [{ elite: "x", level: 0 }] },
    );
    expect(nonNum.evolve.notes).toEqual([]);
});

test("charId 缺省按空串、模组等级非数、无缺口且无占位时分组为 null", () => {
    // charId 缺省且在排除名单中：走 charId || ""
    const excluded = computeCostBreakdown({
        charId: undefined,
        costEntry,
        rarity: 6,
        current: {},
        target: {},
    });
    // "" 不在排除名单，继续执行但无缺口 -> 这里仅验证不抛错
    expect(excluded.total).toEqual({});

    // attachMaterials：rows 缺省；costEntry 有效但无材料、无占位 -> null
    expect(() => attachMaterials(undefined, {
        costIndex: index,
        levelCostTable: null,
        charIdOf: () => "char_002_amiya",
    })).not.toThrow();
    const fullRow = [{
        name: "已满",
        user: { charId: "char_002_amiya", elite: 2, level: 90, skill1: 10, skill2: 10, skill3: 10 },
        target: { elite: 2, level: 90, skill1: 10, skill2: 10, skill3: 10 },
    }];
    attachMaterials(fullRow, {
        costIndex: index,
        levelCostTable: null,
        charIdOf: (row) => row.user?.charId || "",
    });
    expect(fullRow[0].costBreakdown).toBeNull();
});

test("仅等级要求（精英0）的要求对：elite 零值走默认分支", () => {
    const { evolve } = compute(
        { elite: 0, level: 1 },
        { elite: 0, level: 50, levelPairs: [{ elite: 0, level: 50 }] },
    );
    expect(evolve.notes).toEqual(["精零1 → 精零50"]);
});

test("truthy 非对象干员被跳过", () => {
    const built = buildCostIndex({ c_str: "not-object", c_num: 42 });
    expect(built.c_str).toBeUndefined();
    expect(built.c_num).toBeUndefined();
});

test("buildCostIndex 无入参或 null：遍历空对象，返回空索引", () => {
    expect(buildCostIndex()).toEqual({});
    expect(buildCostIndex(null)).toEqual({});
});

test("模组目标等级非数按零：仅要求解锁", () => {
    const current = { elite: 2, level: 60, modules: [] };
    const target = { elite: 2, level: 0, module: 2, moduleLevel: "x" };
    const { module } = compute(current, target);
    // max(NaN||0, 1) = 1：只计解锁段
    expect(module.notes).toEqual(["无模组 → 模组Y"]);
});

test("要求的模组类型在成本表缺失：非数组 costs 跳过", () => {
    // AMIYA 只有 Y 型；作业要求 X（typeName X 在 mods 中不存在）
    const { module, total } = compute(
        { elite: 2, level: 60, modules: [] },
        { elite: 2, level: 0, module: 1 },
    );
    expect(module.items).toEqual({});
    expect(module.notes).toEqual([]);
    expect(total).not.toHaveProperty("4001");
});

test("模组要求对含未知类型编号或缺字段：过滤后只计算已知类型", () => {
    // type 9 无对应类型名；缺 type 字段时编号兜底为 0；两者均过滤，Y 型正常计算
    const { module } = compute(
        { elite: 2, level: 60, modules: [] },
        { modulePairs: [{ type: 9, level: 2 }, { level: 2 }, { type: 2, level: 3 }] },
    );
    expect(module.notes).toEqual(["无模组 → 模组Y"]);
});

test("模组已达标：升级循环不执行，仅保留说明", () => {
    const current = { elite: 2, level: 60, modules: null, mods: null };
    // current.modules 非数组 -> 258 分支；说明 owned 取 []
    const withNullModules = compute(current, { elite: 2, level: 0, module: 2, moduleLevel: 3 });
    expect(withNullModules.module.notes).toEqual(["无模组 → 模组Y"]);

    // 已拥有 Y 型 3 级，目标 3 级：fromLevel 3，循环零次；说明仍生成
    const owned = {
        elite: 2,
        level: 60,
        modules: [{ name: "Y", level: 3, locked: false }],
    };
    const { module } = compute(owned, { elite: 2, level: 0, module: 2, moduleLevel: 3 });
    expect(module.notes).toEqual(["模组Y 3级 → 模组Y"]);
    expect(module.items).toEqual({});
});

test("多个未满足要求对：排序比较实际执行，取最强要求对", () => {
    // 两对均未满足，且乱序给出：精一55 与 精二90
    const target = {
        elite: 2,
        level: 90,
        levelPairs: [{ elite: 1, level: 55 }, { elite: 2, level: 90 }],
    };
    const { evolve } = compute({ elite: 0, level: 1 }, target);
    // 排序后取最强的精二90，而非先出现的精一55
    expect(evolve.notes).toEqual(["精零1 → 精二90"]);
});

test("formatCount 万单位显示", () => {
    expect(formatCount(180000)).toBe("18万");
    expect(formatCount(125000)).toBe("12.5万");
    expect(formatCount(8000)).toBe("8,000");
});
