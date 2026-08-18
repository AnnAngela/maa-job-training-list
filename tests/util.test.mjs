import { expect, test } from "vitest";
import {
  escapeHtml,
  formatNumber,
  normalizeOperSlot,
  operatorAvatarUrl,
  parseJsonContent,
  scoreTier,
  skillLevelLabel,
  skillSpriteStyle,
} from "../js/util.js";

test("parseJsonContent returns parsed object or null", () => {
  expect(parseJsonContent("{\"a\":1}")).toEqual({ a: 1 });
  expect(parseJsonContent("not-json")).toBeNull();
});

test("normalizeOperSlot fills defaults", () => {
  expect(normalizeOperSlot({ name: "阿米娅", skill: 2, skill_usage: 1, skill_times: 2, requirements: { level: 60 } })).toEqual({
    name: "阿米娅",
    skill: 2,
    skill_usage: 1,
    skill_times: 2,
    requirements: { level: 60 },
  });
  expect(normalizeOperSlot({})).toEqual({
    name: "",
    skill: 0,
    skill_usage: 0,
    skill_times: 1,
    requirements: {},
  });
});

test("operatorAvatarUrl builds avatar URL", () => {
  expect(operatorAvatarUrl("char_002_amiya")).toBe("https://cos.yituliu.cn/image2/avatar/char_002_amiya.png");
});

test("skillSpriteStyle returns empty for missing entry", () => {
  expect(skillSpriteStyle({ entries: {} }, "missing")).toBe("");
  expect(skillSpriteStyle(undefined, "missing")).toBe("");
});

test("skillSpriteStyle returns positioned sprite style", () => {
  const style = skillSpriteStyle(
    { spriteUrl: "https://example.com/sprite.jpg", size: 128, entries: { sk: { x: 128, y: 256 } } },
    "sk",
    32,
  );
  expect(style).toContain("width:32px;height:32px");
  expect(style).toContain("background-position:-32px -64px");
  expect(style).toContain("background-size:512px 512px");
  const defaultSize = skillSpriteStyle({ spriteUrl: "https://example.com/sprite.jpg", entries: { sk: { x: 0, y: 0 } } }, "sk", 24);
  expect(defaultSize).toContain("background-size:384px 384px");
});

test("escapeHtml escapes html characters", () => {
  expect(escapeHtml("<a b=\"&\">'x'")).toBe("&lt;a b=&quot;&amp;&quot;&gt;&#39;x&#39;");
  expect(escapeHtml(undefined)).toBe("");
});

test("skillLevelLabel maps mastery levels", () => {
  expect(skillLevelLabel(10)).toBe("专三");
  expect(skillLevelLabel(9)).toBe("专二");
  expect(skillLevelLabel(8)).toBe("专一");
  expect(skillLevelLabel(7)).toBe("7级");
  expect(skillLevelLabel(3)).toBe("3级");
});

test("scoreTier maps score buckets", () => {
  expect(scoreTier(5000)).toBe("极高");
  expect(scoreTier(1000)).toBe("高");
  expect(scoreTier(100)).toBe("中");
  expect(scoreTier(0)).toBe("低");
});

test("formatNumber formats numbers", () => {
  expect(formatNumber(1234)).toBe("1,234");
  expect(formatNumber(0)).toBe("0");
});
