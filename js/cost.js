// 养成材料计算：基于一图流 v2 干员表（character_table_simple.v2.json）的成本字段，
// 参考一图流 operatorStatistical.js 的 getOperatorItemCost 实现，修正其精英化重复计费问题。
// 练度语义（本工具）：skill1/2/3 取值 1-10（8/9/10 为专一/二/三）；target 中 0 表示作业不涉及该技能。

// 作业 requirements.module 的模组类型编号 → 一图流 equip[].typeName2
// 全项目唯一来源，展示层（view.js）与缺口判定（compare.js）共用
export const MODULE_TYPE_NAMES = { 1: "X", 2: "Y", 3: "A", 4: "D", 5: "B" };

// 精英化龙门币（按星级；与一图流 operatorEliteCostTable 一致，游戏内基本不变）
// 值为 [精一龙门币, 精二龙门币]，1/2 星不可精英化
export const ELITE_GOLD_COST = {
    1: [0, 0],
    2: [0, 0],
    3: [10000, 0],
    4: [15000, 60000],
    5: [20000, 120000],
    6: [30000, 180000],
};

// 各精英阶段等级上限（与一图流 operatorMaxLevelTable 一致）
export const ELITE_MAX_LEVEL = {
    1: { elite0: 30, elite1: 0, elite2: 0 },
    2: { elite0: 30, elite1: 0, elite2: 0 },
    3: { elite0: 40, elite1: 55, elite2: 0 },
    4: { elite0: 45, elite1: 60, elite2: 70 },
    5: { elite0: 50, elite1: 70, elite2: 80 },
    6: { elite0: 50, elite1: 80, elite2: 90 },
};

// 一图流对个别干员的特判：无有效成本数据的干员直接跳过。
// 电弧全表成本缺失；机械师精英/技能数据齐全但模组 itemCost 三段全空（已向上游报告），
// 整体排除以避免材料区出现无材料的模组方向，上游修复后移除
const EXCLUDED_CHAR_IDS = new Set(["char_4195_radian", "char_4230_mcnist"]);

const addItem = (items, id, count) => {
    if (!id || !count) {
        return;
    }
    items[id] = (items[id] || 0) + count;
};

// 多名干员材料合计（对象合并）
export const aggregateMaterials = (materialMaps) => {
    const total = {};
    for (const items of materialMaps || []) {
        for (const [id, count] of Object.entries(items || {})) {
            addItem(total, id, Number(count) || 0);
        }
    }
    return total;
};

// 从 v2 干员表构建成本索引：elite[1]=精一材料、elite[2]=精二材料；
// allSkill[0..5]=升到 2..7 级；skills[i].skillLevelUpCost[0..2]=专一/二/三；
// mods.X[0..2]=模组 1/2/3 级（itemCost 原样，含龙门币与模组证章）
export const buildCostIndex = (characters) => {
    const index = {};
    for (const [charId, character] of Object.entries(characters || {})) {
        if (!character || typeof character !== "object") {
            continue;
        }
        const mods = {};
        for (const equip of Array.isArray(character.equip) ? character.equip : []) {
            if (equip?.typeName2 && Array.isArray(equip.itemCost)) {
                mods[equip.typeName2] = equip.itemCost;
            }
        }
        index[charId] = {
            rarity: Number(character.rarity) || 0,
            elite: Array.isArray(character.elite) ? character.elite : [],
            allSkill: Array.isArray(character.allSkill) ? character.allSkill : [],
            skills: (Array.isArray(character.skills) ? character.skills : []).map((skill) => ({
                skillId: skill?.skillId || "",
                skillLevelUpCost: Array.isArray(skill?.skillLevelUpCost) ? skill.skillLevelUpCost : [],
            })),
            mods,
        };
    }
    return index;
};

// v2 成本条目（{itemId: count} 或 [{id, count}]）统一累加进 items
const addCostList = (items, cost) => {
    if (!cost) {
        return;
    }
    if (Array.isArray(cost)) {
        for (const entry of cost) {
            if (entry?.id) {
                addItem(items, entry.id, Number(entry.count) || 0);
            }
        }
        return;
    }
    for (const [id, count] of Object.entries(cost)) {
        addItem(items, id, Number(count) || 0);
    }
};

// 当前模组等级：modules 元素 {name: "X"/"Y"/..., level, locked}
export const currentModuleLevel = (current, typeName) => {
    const module = (Array.isArray(current?.modules) ? current.modules : [])
        .find((item) => item?.name === typeName && !item.locked);
    return Number(module?.level) || 0;
};

// 精英化材料 + 精英化龙门币（从 current.elite+1 起算，避免一图流版本重复计入当前阶段材料的边界问题）
const addEvolveCost = (items, { costEntry, rarity, currentElite, targetElite }) => {
    const goldTable = ELITE_GOLD_COST[rarity] || [0, 0];
    for (let elite = currentElite + 1; elite <= targetElite; elite += 1) {
        addCostList(items, costEntry.elite[elite]);
        if (elite === 1) {
            addItem(items, "4001", goldTable[0]);
        } else if (elite === 2) {
            addItem(items, "4001", goldTable[1]);
        }
    }
};

// 技能 1-7 级升级材料（allSkill[0..5] 对应升到 2..7 级）
const addSkillLevelCost = (items, { costEntry, currentSkill, targetSkill }) => {
    const from = Math.max(currentSkill + 1, 2);
    const to = Math.min(targetSkill, 7);
    for (let level = from; level <= to; level += 1) {
        addCostList(items, costEntry.allSkill[level - 2]);
    }
};

// 专精材料（skillLevelUpCost[0..2] 对应 8/9/10 级）
const addMasteryCost = (items, { skillCost, targetSkill }) => {
    for (let level = 8; level <= targetSkill; level += 1) {
        addCostList(items, skillCost?.[level - 8]);
    }
};

// 等级消耗（龙门币 + 经验，经验按 1000 向上取整折算为中级作战记录数量）
// levelCostTable 形如 {elite0: [{exp, gold}, ...], elite1: ..., elite2: ...}
// 表语义：table[i] 为升到 i+1 级的成本（index 0 为升到 1 级的零成本占位），同 arknights-toolbox 的
// characterExp/characterUpgradeCost 右移一位；精英化后等级重置为 1
export const addLevelUpCost = (items, { rarity, currentElite, currentLevel, targetElite, targetLevel, levelCostTable }) => {
    if (!levelCostTable || !ELITE_MAX_LEVEL[rarity]) {
        return;
    }
    let goldTotal = 0;
    let expTotal = 0;
    for (let elite = currentElite; elite <= targetElite; elite += 1) {
        const maxLevel = ELITE_MAX_LEVEL[rarity]?.[`elite${elite}`] || 0;
        if (!maxLevel) {
            continue;
        }
        const start = elite === currentElite ? Math.max(1, currentLevel) : 1;
        const end = elite === targetElite ? Math.min(targetLevel, maxLevel) : maxLevel;
        const table = levelCostTable[`elite${elite}`] || [];
        for (let level = start; level < end; level += 1) {
            const cost = table[level];
            if (!cost) {
                continue;
            }
            goldTotal += Number(cost.gold) || 0;
            expTotal += Number(cost.exp) || 0;
        }
    }
    if (goldTotal > 0) {
        addItem(items, "4001", goldTotal);
    }
    if (expTotal > 0) {
        addItem(items, "2003", Math.ceil(expTotal / 1000));
    }
};

// 精英阶段中文名（notes 显示用）
const eliteName = (elite) => ["精零", "精一", "精二"][elite] || `精${elite}`;

// 计算单个干员从 current 到 target 的养成成本，按方向分组
// current: {elite, level, skill1, skill2, skill3, modules}
// target: {elite, level, skill1, skill2, skill3, module, moduleLevel, levelPairs, modulePairs}
// module/moduleLevel 为聚合字段（供展示）；modulePairs: [{type, level}] 为按类型记录的模组要求，材料计算以此为准
// requireModule: 与培养清单同一开关，关闭时跳过模组分组
// evolve 含精英化与等级提升（龙门币+作战记录）；mastery 含技能升级与专精；module 为模组
// 返回 {evolve, mastery, module, total}，每组 {items: {itemId: count}, notes: [当前值→目标值]}
export const computeCostBreakdown = ({ charId, costEntry, rarity, current, target, levelCostTable, requireModule = true }) => {
    const evolve = { items: {}, notes: [] };
    const mastery = { items: {}, notes: [] };
    const module = { items: {}, notes: [], excluded: false };
    if (!costEntry || EXCLUDED_CHAR_IDS.has(charId || "")) {
        return { evolve, mastery, module, total: {} };
    }
    const currentElite = Number(current?.elite) || 0;
    const currentLevel = Number(current?.level) || 0;
    // 等级/精英要求按成对作业要求计算，取干员尚未满足的最强要求对；
    // 聚合 target 的 elite/level 可能来自不同作业，直接比较会产生假缺口
    const levelPairs = Array.isArray(target?.levelPairs) && target.levelPairs.length
        ? target.levelPairs
        : [{ elite: Number(target?.elite) || 0, level: Number(target?.level) || 0 }];
    const unmetPair = levelPairs
        .filter((pair) => {
            // 干员不满足该对：精英阶更低，或同阶但等级更低
            const eliteShort = currentElite < pair.elite;
            const levelShort = currentElite === pair.elite && currentLevel < pair.level;
            return eliteShort || levelShort;
        })
        .sort((a, b) => b.elite - a.elite || b.level - a.level)[0];
    if (unmetPair) {
        const pairElite = Number(unmetPair.elite) || 0;
        const pairLevel = Number(unmetPair.level) || 0;
        if (pairElite > currentElite) {
            addEvolveCost(evolve.items, { costEntry, rarity, currentElite, targetElite: pairElite });
        }
        addLevelUpCost(evolve.items, {
            rarity,
            currentElite,
            currentLevel,
            targetElite: pairElite,
            targetLevel: pairLevel,
            levelCostTable,
        });
        // 精英与等级合并为一条说明：「精一70 → 精二90」；作业未写等级（0）时省略数字
        const noteText = (elite, level) => level > 0 ? `${eliteName(elite)}${level}` : eliteName(elite);
        evolve.notes.push(`${noteText(currentElite, currentLevel)} → ${noteText(pairElite, pairLevel)}`);
    }
    // 技能缺口合并为一条说明：「7/7/9 → 10/10/10」；目标 0 表示作业不涉及该技能，显示当前值
    const currentTriplet = [1, 2, 3].map((index) => Number(current?.[`skill${index}`]) || 0);
    const targetTriplet = [1, 2, 3].map((index) => {
        const value = Number(target?.[`skill${index}`]) || 0;
        return value > 0 ? value : currentTriplet[index - 1];
    });
    for (let skillIndex = 1; skillIndex <= 3; skillIndex += 1) {
        const currentSkill = currentTriplet[skillIndex - 1];
        const targetSkill = targetTriplet[skillIndex - 1];
        if (targetSkill <= currentSkill) {
            continue;
        }
        addSkillLevelCost(mastery.items, { costEntry, currentSkill, targetSkill });
        const skillCost = costEntry.skills[skillIndex - 1]?.skillLevelUpCost;
        if (skillCost?.length) {
            addMasteryCost(mastery.items, { skillCost, targetSkill });
        }
    }
    if (targetTriplet.some((value, index) => value > currentTriplet[index])) {
        mastery.notes.push(`${currentTriplet.join("/")} → ${targetTriplet.join("/")}`);
    }
    // 模组要求按"类型对"逐项计算（与 levelPairs 同构）：每对记录一个类型及其等级要求，
    // 避免跨作业聚合时高编号类型覆盖低编号类型、等级跨类型取大值
    let modulePairs = Array.isArray(target?.modulePairs) ? target.modulePairs : [];
    if (!modulePairs.length && Number(target?.module) > 0) {
        // 兼容直接构造的 target（无 modulePairs）：用 module/moduleLevel 合成单对
        modulePairs = [{ type: Number(target.module), level: Number(target.moduleLevel) || 0 }];
    }
    // 解析为一图流类型名，过滤未知类型编号
    const resolvedModulePairs = modulePairs
        .map((pair) => ({ typeName: MODULE_TYPE_NAMES[Number(pair?.type) || 0], level: Number(pair?.level) || 0 }))
        .filter((pair) => pair.typeName);
    // 开关关闭：只标记未计入（材料区显示「未计入」，说明列保持「—」），不产出材料
    if (!requireModule && resolvedModulePairs.length) {
        module.excluded = true;
    }
    if (requireModule) {
        // 已解锁模组说明起点（所有类型合并展示，终点按对区分）
        const owned = (Array.isArray(current?.modules) ? current.modules : [])
            .filter((item) => item?.name && !item.locked && Number(item.level) > 0)
            .map((item) => `模组${item.name} ${Number(item.level)}级`);
        for (const { typeName, level } of resolvedModulePairs) {
            const costs = costEntry.mods[typeName];
            if (!Array.isArray(costs)) {
                continue;
            }
            // 作业仅要求解锁模组（level 缺省为 0）时按 1 级计算成本
            const targetModuleLevel = Math.max(level, 1);
            const fromLevel = currentModuleLevel(current, typeName);
            for (let lvl = fromLevel + 1; lvl <= targetModuleLevel; lvl += 1) {
                addCostList(module.items, costs[lvl - 1]);
            }
            // 模组说明：「模组X 1级 → 模组Y」；无已解锁模组时显示「无模组 → 模组Y」
            const targetText = `模组${typeName}`;
            module.notes.push(owned.length ? `${owned.join("/")} → ${targetText}` : `无模组 → ${targetText}`);
        }
    }
    return {
        evolve,
        mastery,
        module,
        total: aggregateMaterials([evolve.items, mastery.items, module.items]),
    };
};

// 为培养清单各行附上成本分组（写入 row.costBreakdown；缺数据行、无缺口行为 null）
// 未拥有干员按零练度（精0 1级、技能 1/1/1、无模组）计算到目标的成本
// charIdOf(row) 返回干员 charId；requireModule 与清单缺口判定共用同一开关
export const attachMaterials = (rows, { costIndex, levelCostTable, charIdOf, requireModule = true }) => {
    for (const row of rows || []) {
        const charId = charIdOf(row);
        const costEntry = charId ? costIndex?.[charId] : null;
        const rarity = costEntry?.rarity || 0;
        if (!costEntry || rarity < 1) {
            row.costBreakdown = null;
            continue;
        }
        const current = row.user || { elite: 0, level: 1, skill1: 1, skill2: 1, skill3: 1, modules: [] };
        const breakdown = computeCostBreakdown({
            charId,
            costEntry,
            rarity,
            current,
            target: row.target,
            levelCostTable,
            requireModule,
        });
        // total 有材料，或存在未计入的模组占位时保留分组
        row.costBreakdown = Object.keys(breakdown.total).length || breakdown.module.excluded ? breakdown : null;
    }
};
