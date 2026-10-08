import { expect, test } from "vitest";
import {
    charIdForName,
    itemChipHtml,
    operatorAvatarHtml,
    operatorSkillIcon,
    rarityStars,
    renderBindingButtons,
    renderMaterialSection,
    renderSummary,
    renderTrainingTable,
    skillIconHtml,
    sortMaterialEntries,
    statusBadge,
} from "../js/view.js";

const operatorMeta = {
    nameToCharId: { 阿米娅: "char_002_amiya" },
    operators: {
        char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [{ skillId: "a", skillIcon: "sk_amiya_1", skillName: "战术咏唱" }] },
    },
};

const skillSprite = { spriteUrl: "https://example.com/sprite.jpg", size: 128, entries: { sk_amiya_1: { x: 0, y: 0 } } };

test("charIdForName returns charId or empty", () => {
    expect(charIdForName("阿米娅", operatorMeta)).toBe("char_002_amiya");
    expect(charIdForName("不存在", operatorMeta)).toBe("");
});

test("operatorAvatarHtml renders with and without charId", () => {
    expect(operatorAvatarHtml("阿米娅", "char_002_amiya")).toContain("https://prts.plus/assets/operator-avatars/webp32/char_002_amiya.webp");
    expect(operatorAvatarHtml("阿米娅", "char_002_amiya", { grayscale: true })).toContain("operator-avatar--grayscale");
    expect(operatorAvatarHtml("阿米娅", "")).not.toContain("<img");
    expect(operatorAvatarHtml(null, "char_002_amiya")).toContain("?");
    // 有 charId 时名字占位默认隐藏，仅当头像加载失败时显示
    expect(operatorAvatarHtml("阿米娅", "char_002_amiya")).toContain("avatar-fallback is-hidden");
    expect(operatorAvatarHtml("阿米娅", "char_002_amiya")).toContain("previousElementSibling.classList.remove('is-hidden')");
    expect(operatorAvatarHtml("阿米娅", "")).not.toContain("is-hidden");
});

test("skillIconHtml renders empty and sprite variants", () => {
    expect(skillIconHtml(skillSprite, "")).toContain("skill-icon--empty");
    expect(skillIconHtml(skillSprite, "missing")).toContain("skill-icon--empty");
    expect(skillIconHtml(skillSprite, "sk_amiya_1")).toContain("background-position:-0px -0px");
});

test("operatorSkillIcon returns empty or icon", () => {
    expect(operatorSkillIcon(operatorMeta, skillSprite, "", 1)).toBe("");
    expect(operatorSkillIcon(operatorMeta, skillSprite, "char_002_amiya", 0)).toBe("");
    expect(operatorSkillIcon(operatorMeta, skillSprite, "char_002_amiya", 1)).toContain("skill-icon");
    const noSkills = operatorSkillIcon({ operators: { char_002_amiya: { name: "阿米娅", skills: [] } } }, skillSprite, "char_002_amiya", 1);
    expect(noSkills).toContain("技能1");
});

test("rarityStars clamps rarity", () => {
    expect(rarityStars(6)).toBe("★★★★★★");
    expect(rarityStars(0)).toBe("★");
});

test("statusBadge renders missing ready and pending", () => {
    expect(statusBadge({ user: null })).toContain("未拥有");
    expect(statusBadge({ user: {}, totalGap: 0 })).toContain("已达标");
    expect(statusBadge({ user: {}, totalGap: 1 })).toContain("待培养");
});

test("renderSummary renders cards", () => {
    const html = renderSummary({ totalAssignments: 5, readyCount: 2, notReadyCount: 3, involvedOperators: 4, missingOperators: 1 });
    expect(html).toContain("作业总数");
    expect(html).toContain(">5<");
});

test("renderBindingButtons renders empty and list", () => {
    expect(renderBindingButtons([])).toContain("未找到绑定的明日方舟账号");
    expect(renderBindingButtons([{ uid: "1", nickName: "博士", channelName: "官服" }])).toContain("data-uid=\"1\"");
    expect(renderBindingButtons([{}])).toContain("data-uid=\"\"");
});

// 材料信息表：稀有度用于排序与 chip 边框色
const itemInfoMap = {
    30014: { itemId: "30014", itemName: "全新装置", rarity: 4 },
    30034: { itemId: "30034", itemName: "改量装置", rarity: 4 },
    3303: { itemId: "3303", itemName: "技巧概要·卷3", rarity: 3 },
    4001: { itemId: "4001", itemName: "龙门币", rarity: 2 },
};

// 含完整成本分组的材料行
const materialRow = {
    name: "阿米娅",
    score: 6000,
    costBreakdown: {
        evolve: { items: { 30014: 5, 4001: 10000 }, notes: ["精零1 → 精一50"] },
        mastery: { items: { 3303: 6 }, notes: ["6/0/0 → 7/0/0"] },
        module: { items: { 30034: 3 }, notes: ["无模组 → 模组X"], excluded: false },
        total: { 30014: 5, 4001: 10000, 3303: 6, 30034: 3 },
    },
};

const allDirectionTotals = { evolve: true, mastery: true, module: true };

test("itemChipHtml renders rarity chip and falls back to itemId", () => {
    const chip = itemChipHtml("30014", 5, itemInfoMap);
    expect(chip).toContain("item-chip--r4");
    expect(chip).toContain("title=\"全新装置\"");
    expect(chip).toContain("bg-30014");
    expect(chip).toContain(">5<");
    // 未知材料：标题回退为 itemId，稀有度钳制为 1
    const unknown = itemChipHtml("99999", 2, itemInfoMap);
    expect(unknown).toContain("title=\"99999\"");
    expect(unknown).toContain("item-chip--r1");
    // 无信息表时同样回退
    expect(itemChipHtml("30014", 1, null)).toContain("item-chip--r1");
});

test("sortMaterialEntries sorts by rarity desc then itemId", () => {
    const sorted = sortMaterialEntries({ 3303: 6, 30014: 5, 4001: 100 }, itemInfoMap);
    expect(sorted.map(([id]) => id)).toEqual(["30014", "3303", "4001"]);
    const tie = sortMaterialEntries({ 3005: 1, 3001: 1 }, {
        3005: { rarity: 4 },
        3001: { rarity: 4 },
    });
    expect(tie.map(([id]) => id)).toEqual(["3001", "3005"]);
    // 空输入与无信息表（稀有度一律 0，按 itemId 排序）
    expect(sortMaterialEntries(null, itemInfoMap)).toEqual([]);
    expect(sortMaterialEntries({ 3005: 1, 3001: 1 }, {})).toEqual([["3001", 1], ["3005", 1]]);
});

test("renderMaterialSection renders empty state", () => {
    expect(renderMaterialSection([], { itemInfoMap, directionTotals: allDirectionTotals })).toContain("未勾选任何可计算的干员");
});

test("renderMaterialSection renders total card and operator cards", () => {
    const html = renderMaterialSection([materialRow], { itemInfoMap, directionTotals: allDirectionTotals });
    // 总计卡片：三个方向复选框均勾选，底部为方向合计
    expect(html).toContain("养成材料总计（1名干员）");
    // 三个方向复选框均勾选；属性按 class、data-direction、aria-label、checked 顺序输出
    expect(html).toContain('data-direction="evolve" aria-label="计入精英/等级" checked');
    expect(html).toContain('data-direction="module" aria-label="计入模组" checked');
    // 单个干员卡片：名称、分层标签、练度说明、材料 chip
    expect(html).toContain("精零1 → 精一50");
    expect(html).toContain("6/0/0 → 7/0/0");
    expect(html).toContain("无模组 → 模组X");
    expect(html).toContain("bg-30014");
});

test("renderMaterialSection shows placeholder when no direction is selected", () => {
    const html = renderMaterialSection([materialRow], { itemInfoMap, directionTotals: { evolve: false, mastery: false, module: false } });
    expect(html).toContain("未选择养成方向");
    // 方向复选框全部不勾选
    expect(html).not.toContain("direction-total-select\" checked");
});

test("renderMaterialSection marks excluded direction and empty list", () => {
    const row = {
        name: "阿米娅",
        score: 0,
        costBreakdown: {
            evolve: { items: {}, notes: [] },
            mastery: { items: {}, notes: [] },
            // 未计入的模组方向
            module: { items: {}, notes: [], excluded: true },
            total: {},
        },
    };
    const html = renderMaterialSection([row], { itemInfoMap, directionTotals: allDirectionTotals });
    expect(html).toContain("未计入");
    // 无材料方向显示「无缺口」
    expect(html).toContain("无缺口");
});

test("renderTrainingTable renders empty state and rows", () => {
    expect(renderTrainingTable([], { operatorMeta, skillSprite })).toContain("暂无培养需求");
    const rows = [{
        name: "阿米娅",
        user: { charId: "char_002_amiya", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 1 },
        target: { elite: 2, level: 90, skill1: 7, skill2: 10, skill3: 10, module: 3 },
        coreGain: 2,
        groupGain: 1,
        unsatisfiedCore: 3,
        score: 6000,
        totalGap: 20,
    }];
    const html = renderTrainingTable(rows, { operatorMeta, skillSprite });
    expect(html).toContain("阿米娅");
    expect(html).toContain("极高");
    expect(html).toContain("精2 60级");
    expect(html).toContain("技能 7/10/10");
    expect(html).toContain("模组 1");
    expect(html).toContain("技能1 7级");
    expect(html).toContain("技能2 专三");
    expect(html).toContain("技能3 专三");
    expect(html).toContain('<span class="req-unmet">90级</span>');
    // module 3 = A 型；用户没有该模组 -> 警告
    expect(html).toContain('<span class="req-unmet">模组 A</span>');
    const sparseRows = [{ name: "阿米娅", user: { elite: 0, level: 0 }, target: undefined, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 1 }];
    const sparseHtml = renderTrainingTable(sparseRows, { operatorMeta, skillSprite });
    expect(sparseHtml).toContain("char_002_amiya");
    expect(sparseHtml).toContain("精0 0级");
    expect(sparseHtml).toContain("—");
    expect(sparseHtml).toContain("待培养");
    const partialSkills = renderTrainingTable([{ name: "阿米娅", user: { charId: "char_002_amiya", elite: 2, level: 60, skill1: 7, skill2: 5, skill3: 10, maxModuleLevel: 0 }, target: { elite: 2, level: 60, skill1: 0, skill2: 7, skill3: 0, module: -1 }, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 0 }], { operatorMeta, skillSprite });
    expect(partialSkills).toContain("技能2 7级");
    expect(partialSkills).not.toContain("技能1");
    expect(partialSkills).not.toContain("技能3");
    expect(partialSkills).toContain('<span class="req-unmet">技能2 7级</span>');
    expect(partialSkills).not.toContain("模组");
    const missingRow = renderTrainingTable([{ name: "阿米娅", user: null, target: { elite: 2, level: 90, levelPairs: [{ elite: 2, level: 90 }], skill1: 0, skill2: 7, skill3: 0, module: 1, modulePairs: [{ type: 1, level: 0 }] }, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 0 }], { operatorMeta, skillSprite });
    expect(missingRow).toContain(">—<");
    expect(missingRow).toContain('<span class="req-unmet">精2</span>');
    expect(missingRow).toContain('<span class="req-unmet">90级</span>');
    expect(missingRow).toContain('<span class="req-unmet">技能2 7级</span>');
    expect(missingRow).toContain('<span class="req-unmet">模组 X</span>');
    const satisfiedModule = renderTrainingTable([{ name: "阿米娅", user: { charId: "char_002_amiya", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 3, modules: [{ id: "uniequip_001_amiya", name: "X", level: 1, locked: false }] }, target: { elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, module: 1 }, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 0 }], { operatorMeta, skillSprite });
    expect(satisfiedModule).toContain("模组 X");
    expect(satisfiedModule).not.toContain("req-unmet");
    const zeroModuleUser = renderTrainingTable([{ name: "阿米娅", user: { charId: "char_002_amiya", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 0 }, target: { elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, module: 1 }, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 0 }], { operatorMeta, skillSprite });
    expect(zeroModuleUser).toContain('<span class="req-unmet">模组 X</span>');
    // 多模组：当前列只显示有 typeName2 且已解锁的模组（证章不显示）
    const multiModule = renderTrainingTable([{ name: "阿米娅", user: { charId: "char_002_amiya", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 3, modules: [{ id: "uniequip_001_amiya", name: "", level: 1, locked: false }, { id: "uniequip_002_amiya", name: "X", level: 2, locked: false }, { id: "uniequip_003_amiya", name: "Y", level: 3, locked: false }] }, target: { elite: 2, level: 60, skill1: 0, skill2: 0, skill3: 0, module: -1 }, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 0 }], { operatorMeta, skillSprite });
    expect(multiModule).toContain("模组 X 2级");
    expect(multiModule).toContain("模组 Y 3级");
    expect(multiModule).not.toContain("模组  1级");
    // module 4 = D 型；用户没有 D 型 -> 警告
    const anyModule = renderTrainingTable([{ name: "阿米娅", user: { charId: "char_002_amiya", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 1 }, target: { elite: 2, level: 60, skill1: 0, skill2: 0, skill3: 0, module: 4 }, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 0 }], { operatorMeta, skillSprite });
    expect(anyModule).toContain('<span class="req-unmet">模组 D</span>');
    // 目标列显示模组类型，标准模式带等级
    const namedModule = renderTrainingTable([{ name: "阿米娅", user: { charId: "char_002_amiya", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 1, modules: [{ id: "uniequip_001_amiya", name: "", level: 1, locked: false }, { id: "uniequip_002_amiya", name: "Y", level: 1, locked: false }] }, target: { elite: 2, level: 60, skill1: 0, skill2: 0, skill3: 0, module: 2, moduleLevel: 3 }, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 0 }], { operatorMeta, skillSprite });
    expect(namedModule).toContain('<span class="req-unmet">模组 Y 3级</span>');
    // 未知模组编号：目标列不显示模组部分
    const unknownModule = renderTrainingTable([{ name: "阿米娅", user: { charId: "char_002_amiya", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 0, modules: [] }, target: { elite: 2, level: 60, skill1: 0, skill2: 0, skill3: 0, module: 9 }, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 0 }], { operatorMeta, skillSprite });
    expect(unknownModule).not.toContain("模组");
});

test("跨精英阶要求对：精英与等级分别按未满足对高亮", () => {
    // 用户精一60；两对要求：精一70 与 精二80。聚合显示精2/80级，两者均应高亮
    const rows = [{
        name: "阿米娅",
        user: { charId: "char_002_amiya", elite: 1, level: 60, skill1: 1, skill2: 1, skill3: 1, maxModuleLevel: 0 },
        target: {
            elite: 2,
            level: 80,
            levelPairs: [{ elite: 1, level: 70 }, { elite: 2, level: 80 }],
            module: -1,
            modulePairs: [],
        },
        coreGain: 0,
        groupGain: 0,
        unsatisfiedCore: 0,
        score: 0,
        totalGap: 0,
    }];
    const html = renderTrainingTable(rows, { operatorMeta, skillSprite });
    expect(html).toContain('<span class="req-unmet">精2</span>');
    expect(html).toContain('<span class="req-unmet">80级</span>');
});

test("含精零要求对：等级兜底分支与同阶等级高亮", () => {
    // 用户精零30；要求对：精零50、精零（无等级，不产生等级缺口）与 精一（无等级）。聚合显示精1/50级
    const rows = [{
        name: "阿米娅",
        user: { charId: "char_002_amiya", elite: 0, level: 30, skill1: 1, skill2: 1, skill3: 1, maxModuleLevel: 0 },
        target: {
            elite: 1,
            level: 50,
            levelPairs: [{ elite: 0, level: 50 }, { elite: 0 }, { elite: 1, level: 0 }],
            module: -1,
            modulePairs: [],
        },
        coreGain: 0,
        groupGain: 0,
        unsatisfiedCore: 0,
        score: 0,
        totalGap: 0,
    }];
    const html = renderTrainingTable(rows, { operatorMeta, skillSprite });
    expect(html).toContain('<span class="req-unmet">精1</span>');
    expect(html).toContain('<span class="req-unmet">50级</span>');
});

test("已达标行复选框禁用；缺成本数据行不渲染复选框", () => {
    const rows = [
        { name: "阿米娅", user: { charId: "char_002_amiya", elite: 2, level: 90 }, target: { elite: 2, level: 90 }, costBreakdown: null, score: 0, totalGap: 0, unsatisfiedCore: 0 },
        { name: "凯尔希", user: null, target: { elite: 2 }, costBreakdown: undefined, score: 0, totalGap: 0, unsatisfiedCore: 0 },
    ];
    const html = renderTrainingTable(rows, { operatorMeta, skillSprite, materialSelection: new Set(["阿米娅"]) });
    // 无缺口行复选框存在但禁用，带干员名的可访问名称，且不因默认勾选集合而选中
    expect(html).toContain('data-name="阿米娅" aria-label="计入 阿米娅 的养成材料" disabled');
    expect(html).not.toContain('data-name="凯尔希"');
});
