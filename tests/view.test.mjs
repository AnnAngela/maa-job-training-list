import { expect, test } from "vitest";
import {
  charIdForName,
  operatorAvatarHtml,
  operatorSkillIcon,
  rarityStars,
  renderAssignmentTable,
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
  const rows = [{ name: "阿米娅", user: { charId: "char_002_amiya", elite: 2, level: 60 }, target: { elite: 2, level: 90, skill: 1, skillLevel: 7 }, coreGain: 2, groupGain: 1, unsatisfiedCore: 3, score: 6000, totalGap: 20 }];
  const html = renderTrainingTable(rows, { operatorMeta, skillSprite });
  expect(html).toContain("阿米娅");
  expect(html).toContain("极高");
  const sparseRows = [{ name: "阿米娅", user: { elite: 0, level: 0 }, target: undefined, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 1 }];
  const sparseHtml = renderTrainingTable(sparseRows, { operatorMeta, skillSprite });
  expect(sparseHtml).toContain("char_002_amiya");
  expect(sparseHtml).toContain("精0 0级");
  expect(sparseHtml).toContain("待培养");
  const zeroSkill = renderTrainingTable([{ name: "阿米娅", user: { charId: "char_002_amiya", elite: 2, level: 60 }, target: { elite: 2, level: 60, skill: 1, skillLevel: 0 }, coreGain: 0, groupGain: 0, unsatisfiedCore: 0, score: 0, totalGap: 0 }], { operatorMeta, skillSprite });
  expect(zeroSkill).toContain("技能1 0级");
});

test("renderAssignmentTable renders empty, ready, and blocked rows", () => {
  expect(renderAssignmentTable([])).toContain("暂无作业数据");
  const ready = [{ assignment: { id: 1, title: "A", stageName: "1-7" }, result: { ready: true, hasNamedRequirements: true, requiredResults: [], groupResults: [] } }];
  expect(renderAssignmentTable(ready)).toContain("可抄");
  const blocked = [{
    assignment: { id: 2, title: "B", stageName: "2-1" },
    result: {
      ready: false,
      hasNamedRequirements: true,
      requiredResults: [{ slot: { name: "阿米娅" }, result: { satisfied: false, gaps: [{ type: "missing" }] } }],
      groupResults: [{ name: "奶盾", satisfied: false, results: [{ slot: { name: "塞雷娅" }, result: { satisfied: false, gaps: [{ type: "level", required: 90, current: 1 }] } }] }],
    },
  }];
  const html = renderAssignmentTable(blocked);
  expect(html).toContain("不可抄");
  expect(html).toContain("阿米娅(未拥有)");
  expect(html).toContain("塞雷娅");
  const otherGaps = [{
    assignment: { id: 3, title: "C", stageName: "3-1" },
    result: {
      ready: false,
      hasNamedRequirements: true,
      requiredResults: [{ slot: { name: "阿米娅" }, result: { satisfied: false, gaps: [{ type: "elite", required: 2 }, { type: "skill_level", skill: 1, required: 10 }, { type: "weird" }] } }],
      groupResults: [],
    },
  }];
  const otherHtml = renderAssignmentTable(otherGaps);
  expect(otherHtml).toContain("精2");
  expect(otherHtml).toContain("技能1 专三");
  expect(otherHtml).toContain("weird");
  const satisfiedGroup = [{
    assignment: { id: 4, title: "D", stageName: "4-1" },
    result: {
      ready: false,
      hasNamedRequirements: true,
      requiredResults: [
        { slot: { name: "阿米娅" }, result: { satisfied: true, gaps: [] } },
        { slot: { name: "凯尔希" }, result: { satisfied: false, gaps: [{ type: "missing" }] } },
      ],
      groupResults: [{ name: "奶盾", satisfied: true, results: [{ slot: { name: "塞雷娅" }, result: { satisfied: true, gaps: [] } }] }],
    },
  }];
  expect(renderAssignmentTable(satisfiedGroup)).toContain("凯尔希(未拥有)");
});
