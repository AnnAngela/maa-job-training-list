import { YITULIU_OPERATOR_INFO_URL } from "./config.js";

export class YituliuError extends Error {
    constructor(message, code = 0) {
        super(message);
        this.name = "YituliuError";
        this.code = code;
    }
}

// 只做非空校验：Token 有效性由服务端业务码（20027）判定，硬编码 32 位 hex 格式会误拒未来的格式变化
export const parseYituliuToken = (input) => {
    const cleaned = String(input || "").trim();
    if (!cleaned) {
        throw new YituliuError("请先输入一图流个人中心生成的只读 Token");
    }
    return cleaned;
};

const TOKEN_ERROR_MESSAGES = {
    20010: "Token 权限不足：请在一图流个人中心生成「只读」Token",
    20027: "一图流 Token 无效或已删除，请重新生成",
};

// 读取的练度是用户主动导入一图流的快照（取最近导入的游戏账号），非实时数据
export const fetchYituliuOperatorInfo = async (fetchImpl, token) => {
    const response = await fetchImpl(YITULIU_OPERATOR_INFO_URL, {
        headers: { Authorization: token },
    });
    if (!response.ok) {
        throw new YituliuError(`请求一图流失败 (${response.status})`);
    }
    const payload = await response.json();
    if (payload.code !== 200) {
        // 错误文案字段是 msg：BackEndV3 的接口文档示例误写为 message，以源码与实测为准
        throw new YituliuError(TOKEN_ERROR_MESSAGES[payload.code] || payload.msg || "读取一图流练度失败", payload.code);
    }
    return Array.isArray(payload.data) ? payload.data : [];
};

// 从一图流 v2 干员表构建 uniequip id → { typeName2 } 映射，为一图流练度补模组显示名。
// 其响应的 equips[] 只有 id/type/level；typeName2 与森空岛响应的 equipmentInfoMap 同源同义
export const buildEquipmentInfoMap = (characters) => {
    const map = {};
    for (const character of Object.values(characters || {})) {
        for (const equip of Array.isArray(character?.equip) ? character.equip : []) {
            if (equip?.uniEquipId) {
                map[equip.uniEquipId] = { typeName2: equip.typeName2 || "" };
            }
        }
    }
    return map;
};

// 技能槽位只认 skchr_<干员>_<槽位> 形态：阿米娅的 skills[] 混有公共技能（skcom_magic_rage[3]），
// 不能按数组下标或「结尾数字」笼统解析
const masteryBySlot = (skills) => {
    const mastery = {};
    for (const skill of Array.isArray(skills) ? skills : []) {
        const slot = /^skchr_.+_(\d)$/.exec(String(skill?.id || ""))?.[1];
        const level = +skill?.level || 0;
        if (slot && level > 0) {
            mastery[+slot] = level;
        }
    }
    return mastery;
};

// 一图流 open-api 的练度元素 → 内部干员格式（与 formatSklandCharacters 同一契约）。
// 不能复用 formatSklandCharacters：其 skill.level 兼容路径会把一图流 0-3 的专精值误当完整技能等级。
// 实测 equips[] 仅含真模组分支（无初始证章），不需要森空岛侧的真模组过滤
export const formatYituliuCharacters = (list, operatorMeta, equipmentInfo = {}) => {
    const operators = [];
    for (const char of Array.isArray(list) ? list : []) {
        const charId = char?.id;
        const meta = operatorMeta?.operators?.[charId];
        if (!meta) {
            continue;
        }
        const mastery = masteryBySlot(char?.skills);
        const baseSkillLevel = +char?.mainSkillLevel || 0;
        const equips = Array.isArray(char?.equips) ? char.equips : [];
        const modules = equips.map((equip) => ({
            id: equip.id,
            name: equipmentInfo?.[equip.id]?.typeName2 || "",
            level: +equip?.level || 0,
            locked: false,
        }));
        operators.push({
            charId,
            name: meta.name,
            rarity: meta.rarity,
            profession: meta.profession,
            elite: +char?.evolvePhase || 0,
            level: +char?.level || 0,
            skill1: baseSkillLevel + (mastery[1] || 0),
            skill2: baseSkillLevel + (mastery[2] || 0),
            skill3: baseSkillLevel + (mastery[3] || 0),
            modules,
            maxModuleLevel: modules.length ? Math.max(...modules.map((module) => module.level)) : 0,
        });
    }
    return operators;
};

export const getYituliuOperatorData = async (fetchImpl, token, operatorMeta, equipmentInfo = {}) => {
    const list = await fetchYituliuOperatorInfo(fetchImpl, token);
    return { operators: formatYituliuCharacters(list, operatorMeta, equipmentInfo) };
};
