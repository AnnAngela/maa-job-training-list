import { createHash, createHmac } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  buildHeaders,
  chooseDefaultBinding,
  fetchBindingList,
  fetchPlayerInfo,
  formatSklandCharacters,
  getSign,
  getSklandOperatorData,
  hmacSha256Hex,
  parseCredential,
  SklandError,
} from "../js/skland.js";
import operatorMeta from "../data/operator_meta.json";
import playerInfo from "./fixtures/skland-player-info.json";

const jsonResponse = (data) => ({ json: async () => data });

function expectedSign(path, params, token, timestamp) {
  const headers = {
    platform: "3",
    timestamp,
    dId: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0",
    vName: "1.2.0",
  };
  const text = path + (params || "") + timestamp + JSON.stringify(headers);
  const hmac = createHmac("sha256", token).update(text).digest("hex");
  return createHash("md5").update(hmac).digest("hex");
}

test("parseCredential parses and validates", () => {
  expect(parseCredential(" cred , token ")).toEqual({ cred: "cred", token: "token" });
  expect(() => parseCredential("only-one")).toThrow(SklandError);
  expect(() => parseCredential(",token")).toThrow(SklandError);
  expect(() => parseCredential("")).toThrow(SklandError);
});

test("hmacSha256Hex throws without Web Crypto", async () => {
  await expect(hmacSha256Hex("message", "key", {})).rejects.toThrow("不支持 Web Crypto");
});

test("getSign matches node crypto and returns lowercase md5", async () => {
  const now = () => 1700000000000;
  const path = "/api/v1/game/player/binding";
  const params = "uid=123";
  const token = "secret-token";
  const { timestamp, sign } = await getSign(path, params, token, { cryptoImpl: globalThis.crypto, now });
  expect(timestamp).toBe(String(Math.floor((1700000000000 - 300) / 1000)));
  expect(sign).toBe(expectedSign(path, params, token, timestamp));
});

test("buildHeaders includes credential and signature", async () => {
  const headers = await buildHeaders("/api/v1/game/player/binding", "", "cred", "token", {
    cryptoImpl: globalThis.crypto,
    now: () => 1700000000000,
  });
  expect(headers.cred).toBe("cred");
  expect(headers.sign).toHaveLength(32);
  expect(headers.platform).toBe("3");
});

test("fetchBindingList extracts arknights binding list", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
    code: 0,
    data: { list: [{ appCode: "arknights", bindingList: [{ uid: "123", isOfficial: true, nickName: "博士", channelName: "官服" }] }] },
  }));
  const result = await fetchBindingList(fetchImpl, "cred", "token", { now: () => 1700000000000 });
  expect(result.arkBindingList).toHaveLength(1);
  expect(result.arkBindingList[0].uid).toBe("123");
});

test("fetchBindingList throws on skland error", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 10002, message: "用户未登录" }));
  await expect(fetchBindingList(fetchImpl, "cred", "token", { now: () => 1700000000000 })).rejects.toThrow("用户未登录");
  const noMessage = vi.fn().mockResolvedValue(jsonResponse({ code: 10002 }));
  await expect(fetchBindingList(noMessage, "cred", "token", { now: () => 1700000000000 })).rejects.toThrow("森空岛 CRED 错误或失效");
});

test("fetchBindingList defaults missing list and bindingList", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 0, data: { list: [{ appCode: "other", bindingList: "bad" }] } }));
  const result = await fetchBindingList(fetchImpl, "cred", "token", { now: () => 1700000000000 });
  expect(result.arkBindingList).toEqual([]);
  const noList = vi.fn().mockResolvedValue(jsonResponse({ code: 0, data: null }));
  const empty = await fetchBindingList(noList, "cred", "token", { now: () => 1700000000000 });
  expect(empty.list).toEqual([]);
  expect(empty.arkBindingList).toEqual([]);
});

test("chooseDefaultBinding picks official or first", () => {
  expect(chooseDefaultBinding([])).toBeNull();
  expect(chooseDefaultBinding("bad")).toBeNull();
  expect(chooseDefaultBinding([{ uid: "1", isOfficial: false }, { uid: "2", isOfficial: true }]).uid).toBe("2");
  expect(chooseDefaultBinding([{ uid: "1", isOfficial: false }]).uid).toBe("1");
});

test("fetchPlayerInfo returns data or throws", async () => {
  const ok = vi.fn().mockResolvedValue(jsonResponse({ code: 0, data: { chars: [] } }));
  await expect(fetchPlayerInfo(ok, "123", "cred", "token", { now: () => 1700000000000 })).resolves.toEqual({ chars: [] });
  const empty = vi.fn().mockResolvedValue(jsonResponse({ code: 0 }));
  await expect(fetchPlayerInfo(empty, "123", "cred", "token", { now: () => 1700000000000 })).resolves.toEqual({});
  const bad = vi.fn().mockResolvedValue(jsonResponse({ code: 1, message: "读取失败" }));
  await expect(fetchPlayerInfo(bad, "123", "cred", "token", { now: () => 1700000000000 })).rejects.toThrow("读取失败");
  const noMessage = vi.fn().mockResolvedValue(jsonResponse({ code: 1 }));
  await expect(fetchPlayerInfo(noMessage, "123", "cred", "token", { now: () => 1700000000000 })).rejects.toThrow("读取森空岛数据失败");
});

test("formatSklandCharacters maps real Skland char data to operators", () => {
  const operatorMeta = {
    operators: {
      char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] },
      char_003_kalts: { name: "凯尔希", rarity: 6, profession: "MEDIC", skills: [] },
    },
  };
  const chars = [
    {
      charId: "char_002_amiya",
      evolvePhase: 2,
      level: 60,
      mainSkillLvl: 7,
      skills: [
        { id: "skcom_magic_rage[3]", specializeLevel: 0 },
        { id: "skchr_amiya_2", specializeLevel: 3 },
        { id: "skchr_amiya_3", specializeLevel: 2 },
      ],
      equip: [
        { id: "uniequip_001_amiya", level: 1, locked: false },
        { id: "uniequip_002_amiya", level: 3, locked: true },
      ],
    },
    { charId: "char_missing", evolvePhase: 0, level: 1, mainSkillLvl: 1, skills: [], equip: [] },
  ];
  const operators = formatSklandCharacters(chars, operatorMeta, {
    uniequip_001_amiya: { id: "uniequip_001_amiya", name: "阿米娅证章" },
    uniequip_002_amiya: { id: "uniequip_002_amiya", name: "DWDB-221E", typeName2: "Y" },
  });
  expect(operators).toHaveLength(1);
  // 初始证章（无 typeName2）不算模组，阿米娅未解锁 Y 型 -> maxModuleLevel 0
  expect(operators[0]).toMatchObject({ charId: "char_002_amiya", name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 9, maxModuleLevel: 0 });
  // 模组名用 typeName2，证章名称为空
  expect(operators[0].modules).toEqual([
    { id: "uniequip_001_amiya", name: "", level: 1, locked: false },
    { id: "uniequip_002_amiya", name: "Y", level: 3, locked: true },
  ]);
});

test("formatSklandCharacters accepts legacy id/skills[].level/equips shape", () => {
  const operatorMeta = {
    operators: { char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] } },
  };
  const operators = formatSklandCharacters(
    [{ id: "char_002_amiya", evolvePhase: 2, level: 60, skills: [{ level: 7 }, { level: 10 }], equips: [{ level: 1 }] }],
    operatorMeta,
  );
  expect(operators[0]).toMatchObject({ charId: "char_002_amiya", name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 10, maxModuleLevel: 1 });
});

test("formatSklandCharacters handles non-array chars and empty arrays", () => {
  expect(formatSklandCharacters(null, { operators: {} })).toEqual([]);
  expect(formatSklandCharacters([{ id: "char_002_amiya", skills: [], equips: [] }], { operators: { char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] } } })[0]).toMatchObject({ maxModuleLevel: 0 });
  const fallback = formatSklandCharacters([{ id: "char_002_amiya", skills: null, equips: null }], { operators: { char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] } } })[0];
  expect(fallback).toMatchObject({ elite: 0, level: 0, skill1: 0, skill2: 0, skill3: 0, maxModuleLevel: 0 });
  const zeroEquip = formatSklandCharacters([{ id: "char_002_amiya", skills: [], equips: [{ level: 0 }] }], { operators: { char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] } } })[0];
  expect(zeroEquip.maxModuleLevel).toBe(0);
  const zeroLegacyLevel = formatSklandCharacters([{ id: "char_002_amiya", mainSkillLvl: 7, skills: [{ level: 0 }], equips: [] }], { operators: { char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] } } })[0];
  expect(zeroLegacyLevel.skill1).toBe(7);
});

test("formatSklandCharacters parses the fixture player/info payload", () => {
  const operators = formatSklandCharacters(playerInfo.data.chars, operatorMeta, playerInfo.data.equipmentInfoMap);
  expect(operators).toHaveLength(playerInfo.data.chars.length);
  const byId = new Map(operators.map((operator) => [operator.charId, operator]));
  expect(byId.get("char_002_amiya")).toMatchObject({ name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 7, skill3: 7, maxModuleLevel: 0 });
  expect(byId.get("char_003_kalts")).toMatchObject({ name: "凯尔希", elite: 2, level: 90, skill3: 10, maxModuleLevel: 3 });
  expect(byId.get("char_202_demkni")).toMatchObject({ name: "塞雷娅", skill1: 10, skill2: 10, skill3: 10, maxModuleLevel: 3 });
  expect(byId.get("char_4042_lumen")).toMatchObject({ maxModuleLevel: 2 });
  expect(byId.get("char_1045_svash2")).toMatchObject({ maxModuleLevel: 0 });
  for (const operator of operators) {
    expect(operator.skill1).toBeGreaterThanOrEqual(1);
    expect(operator.elite).toBeGreaterThanOrEqual(0);
    expect(operator.level).toBeGreaterThanOrEqual(1);
  }
  // 模组名用 typeName2：证章为空、Y 型为 "Y"
  const amiya = byId.get("char_002_amiya");
  expect(amiya.modules).toContainEqual({ id: "uniequip_001_amiya", name: "", level: 1, locked: false });
  expect(amiya.modules).toContainEqual({ id: "uniequip_002_amiya", name: "Y", level: 1, locked: true });
});

test("fixture chars keep the real Skland field names", () => {
  const [char] = playerInfo.data.chars;
  expect(typeof char.charId).toBe("string");
  expect(char).toHaveProperty("mainSkillLvl");
  expect(char).toHaveProperty("evolvePhase");
  expect(char.skills[0]).toHaveProperty("specializeLevel");
  expect(Array.isArray(char.equip)).toBe(true);
});

test("getSklandOperatorData parses the fixture payload end to end", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(playerInfo));
  const data = await getSklandOperatorData(fetchImpl, "cred", "token", operatorMeta, { uid: "123", now: () => 1700000000000 });
  expect(data.uid).toBe("123");
  expect(data.operators).toHaveLength(playerInfo.data.chars.length);
  // 走真实链路时也会带上 equipmentInfoMap 里的模组类型（typeName2）
  expect(data.operators.find((operator) => operator.charId === "char_002_amiya").modules[1].name).toBe("Y");
});

test("getSklandOperatorData supports uid and binding fallback", async () => {
  const operatorMeta = { operators: { char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] } } };
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ code: 0, data: { chars: [{ charId: "char_002_amiya", evolvePhase: 2, level: 60, mainSkillLvl: 7, skills: [{ id: "s1", specializeLevel: 0 }], equip: [] }] } }));
  const data = await getSklandOperatorData(fetchImpl, "cred", "token", operatorMeta, { uid: "123", now: () => 1700000000000 });
  expect(data.uid).toBe("123");
  expect(data.operators).toHaveLength(1);
});

test("getSklandOperatorData fetches binding when uid missing", async () => {
  const operatorMeta = { operators: { char_002_amiya: { name: "阿米娅", rarity: 5, profession: "CASTER", skills: [] } } };
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ code: 0, data: { list: [{ appCode: "arknights", bindingList: [{ uid: "456", isOfficial: true }] }] } }))
    .mockResolvedValueOnce(jsonResponse({ code: 0, data: { chars: [] } }));
  const data = await getSklandOperatorData(fetchImpl, "cred", "token", operatorMeta, { now: () => 1700000000000 });
  expect(data.uid).toBe("456");
});

test("getSklandOperatorData throws when no binding", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 0, data: { list: [{ appCode: "arknights", bindingList: [] }] } }));
  await expect(getSklandOperatorData(fetchImpl, "cred", "token", { operators: {} }, { now: () => 1700000000000 })).rejects.toThrow("未找到绑定的明日方舟账号");
});
