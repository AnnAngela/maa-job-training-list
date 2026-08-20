import { expect, test } from "vitest";
import {
  charIdForName,
  operatorAvatarHtml,
  operatorSkillIcon,
  rarityStars,
  renderBindingButtons,
  renderSummary,
  renderTrainingTable,
  skillIconHtml,
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
  expect(operatorAvatarHtml("阿米娅", "char_002_amiya")).toContain("https://cos.yituliu.cn/image2/avatar/char_002_amiya.png");
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
  const missingRow = renderTrainingTable([{ name: "阿米娅", user: null, target: { elite: 2, level: 90, skill1: 0, skill2: 7, skill3: 0, module: 1 }, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 0 }], { operatorMeta, skillSprite });
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

