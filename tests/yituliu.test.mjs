import { expect, test, vi } from "vitest";
import { YITULIU_OPERATOR_INFO_URL } from "../js/config.js";
import operatorMeta from "../data/operator_meta.json";
import {
    buildEquipmentInfoMap,
    fetchYituliuOperatorInfo,
    formatYituliuCharacters,
    getYituliuOperatorData,
    parseYituliuToken,
    YituliuError,
} from "../js/yituliu.js";
import yituliuInfo from "./fixtures/yituliu-operator-info.json";

const jsonResponse = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(data) });

test("parseYituliuToken trims and rejects empty input", () => {
    expect(parseYituliuToken("  abc ")).toBe("abc");
    expect(() => parseYituliuToken("   ")).toThrow(YituliuError);
    expect(() => parseYituliuToken("")).toThrow(YituliuError);
});

test("fetchYituliuOperatorInfo sends raw token and returns data", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(yituliuInfo)));
    const data = await fetchYituliuOperatorInfo(fetchImpl, "tok");
    expect(data).toBe(yituliuInfo.data);
    // 鉴权头携带 token 原文（无 Bearer 前缀），与 MAA 三方服务的调用方式一致
    expect(fetchImpl).toHaveBeenCalledWith(YITULIU_OPERATOR_INFO_URL, { headers: { Authorization: "tok" } });
});

test("fetchYituliuOperatorInfo maps business codes to friendly errors", async () => {
    // 20010：写权限 Token 读数据；20027：Token 无效或已删除（后端恒返回 HTTP 200，业务结果看 body）
    await expect(fetchYituliuOperatorInfo(vi.fn(() => jsonResponse({ code: 20010 })), "tok")).rejects.toThrow("只读");
    await expect(fetchYituliuOperatorInfo(vi.fn(() => jsonResponse({ code: 20027 })), "tok")).rejects.toThrow(YituliuError);
    await expect(fetchYituliuOperatorInfo(vi.fn(() => jsonResponse({ code: 1, msg: "后端异常" })), "tok")).rejects.toThrow("后端异常");
    // 未知业务码且无 msg 时用兜底文案
    const error = await fetchYituliuOperatorInfo(vi.fn(() => jsonResponse({ code: 1 })), "tok").catch((thrown) => thrown);
    expect(error).toBeInstanceOf(YituliuError);
    expect(error.message).toBe("读取一图流练度失败");
    expect(error.code).toBe(1);
});

test("fetchYituliuOperatorInfo rejects http errors and non-array data", async () => {
    await expect(fetchYituliuOperatorInfo(vi.fn(() => jsonResponse({}, false)), "tok")).rejects.toThrow("请求一图流失败");
    expect(await fetchYituliuOperatorInfo(vi.fn(() => jsonResponse({ code: 200, data: null })), "tok")).toEqual([]);
});

test("buildEquipmentInfoMap indexes uniequip ids", () => {
    const map = buildEquipmentInfoMap({
        charA: { equip: [{ uniEquipId: "uniequip_1", typeName2: "X" }, { typeName2: "Y" }, { uniEquipId: "uniequip_2" }] },
        charB: { equip: [] },
        charC: {},
    });
    // 无 uniEquipId 的条目跳过；无 typeName2 的（初始证章）保留空名，与森空岛 equipmentInfoMap 语义一致
    expect(map).toEqual({ uniequip_1: { typeName2: "X" }, uniequip_2: { typeName2: "" } });
    expect(buildEquipmentInfoMap(null)).toEqual({});
});

const equipmentInfo = {
    uniequip_002_amiya: { typeName2: "Y" },
    uniequip_002_kalts: { typeName2: "X" },
    uniequip_003_kalts: { typeName2: "Y" },
    uniequip_004_kalts: { typeName2: "A" },
};

test("formatYituliuCharacters maps the open-api payload", () => {
    const operators = formatYituliuCharacters(yituliuInfo.data, operatorMeta, equipmentInfo);
    expect(operators.map((item) => item.name)).toEqual(["阿米娅", "凯尔希", "芬"]);
    const [amiya, kalts, fang] = operators;
    // 公共技能（skcom_…）不参与专精；专精按 skchr_*_N 的 N 定槽位，与基础技能等级相加
    expect(amiya).toMatchObject({ name: "阿米娅", elite: 2, level: 60, skill1: 7, skill2: 7, skill3: 7, maxModuleLevel: 0 });
    expect(amiya.modules).toEqual([{ id: "uniequip_002_amiya", name: "Y", level: 0, locked: false }]);
    expect(kalts.skill3).toBe(10);
    expect(kalts.modules.map((module) => module.name)).toEqual(["X", "Y", "A"]);
    expect(kalts.maxModuleLevel).toBe(3);
    // 双技能干员：skill3 无对应专精条目，保持基础等级
    expect(fang).toMatchObject({ skill1: 4, skill2: 6, skill3: 4, modules: [], maxModuleLevel: 0 });
});

test("formatYituliuCharacters skips unknown ids and tolerates missing fields", () => {
    expect(formatYituliuCharacters([{ id: "char_999_nobody" }], operatorMeta)).toEqual([]);
    const [minimal] = formatYituliuCharacters([{ id: "char_002_amiya", skills: null, equips: null }], operatorMeta);
    expect(minimal.skill1).toBe(0);
    expect(minimal.modules).toEqual([]);
    expect(minimal.maxModuleLevel).toBe(0);
    // skills[] 中的空条目（无 id）直接忽略，不参与槽位解析
    const [nullSkill] = formatYituliuCharacters([{ id: "char_002_amiya", skills: [null, { level: 2 }] }], operatorMeta);
    expect(nullSkill.skill1).toBe(0);
    expect(formatYituliuCharacters(null, operatorMeta)).toEqual([]);
});

test("getYituliuOperatorData orchestrates fetch and format", async () => {
    const fetchImpl = vi.fn(() => jsonResponse(yituliuInfo));
    const { operators } = await getYituliuOperatorData(fetchImpl, "tok", operatorMeta, equipmentInfo);
    expect(operators).toHaveLength(3);
});
