import { BINDING_PATH, PLAYER_INFO_PATH, SKLAND_BASE } from "./config.js";
import { md5Hex } from "../lib/md5.js";

export class SklandError extends Error {
  constructor(message, code = 0) {
    super(message);
    this.name = "SklandError";
    this.code = code;
  }
}

export function parseCredential(input) {
  const cleaned = String(input || "")
    .replace(/\s+/g, "")
    .replace(/["\u0027]/g, "");
  const parts = cleaned.split(",");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new SklandError("输入格式不正确，应为 cred,token");
  }
  return { cred: parts[0], token: parts[1] };
}

export async function hmacSha256Hex(message, key, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) {
    throw new SklandError("当前环境不支持 Web Crypto");
  }
  const encoder = new TextEncoder();
  const cryptoKey = await cryptoImpl.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoImpl.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function getSign(path, params = "", token, { cryptoImpl = globalThis.crypto, now = Date.now } = {}) {
  const timestamp = Math.floor((now() - 300) / 1000).toString();
  const headers = {
    platform: "3",
    timestamp,
    dId: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0",
    vName: "1.2.0",
  };
  const text = path + (params || "") + timestamp + JSON.stringify(headers);
  const signature = await hmacSha256Hex(text, token, cryptoImpl);
  return { timestamp, sign: md5Hex(signature) };
}

export async function buildHeaders(path, params, cred, token, options) {
  const { timestamp, sign } = await getSign(path, params, token, options);
  return {
    platform: "3",
    timestamp,
    dId: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0",
    vName: "1.2.0",
    cred,
    sign,
  };
}

export async function fetchBindingList(fetchImpl, cred, token, options = {}) {
  const headers = await buildHeaders(BINDING_PATH, "", cred, token, options);
  const response = await fetchImpl(`${SKLAND_BASE}${BINDING_PATH}`, { headers });
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new SklandError(payload.message || "森空岛 CRED 错误或失效", payload.code);
  }
  const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
  const ark = list.find((item) => item.appCode === "arknights") || {};
  return {
    list,
    arkBindingList: Array.isArray(ark.bindingList) ? ark.bindingList : [],
    payload,
  };
}

export function chooseDefaultBinding(bindingList) {
  if (!Array.isArray(bindingList) || bindingList.length === 0) {
    return null;
  }
  return bindingList.find((binding) => binding.isOfficial) || bindingList[0];
}

export async function fetchPlayerInfo(fetchImpl, uid, cred, token, options = {}) {
  const params = `uid=${encodeURIComponent(String(uid))}`;
  const headers = await buildHeaders(PLAYER_INFO_PATH, params, cred, token, options);
  const response = await fetchImpl(`${SKLAND_BASE}${PLAYER_INFO_PATH}?${params}`, { headers });
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new SklandError(payload.message || "读取森空岛数据失败", payload.code);
  }
  return payload.data || {};
}

export function formatSklandCharacters(chars, operatorMeta, equipmentInfo = {}) {
  const operators = [];
  const list = Array.isArray(chars) ? chars : [];
  for (const char of list) {
    const charId = char?.charId || char?.id;
    const meta = operatorMeta?.operators?.[charId];
    if (!meta) continue;
    const skills = Array.isArray(char?.skills) ? char.skills : [];
    // 森空岛实际字段：char.mainSkillLvl 为技能基础等级（1-7），
    // skills[i].specializeLevel 为专精等级（0-3），最终技能等级 = 基础 + 专精。
    const baseSkillLevel = Number(char?.mainSkillLvl) || 0;
    const skillLevelAt = (index) => {
      const skill = skills[index] || {};
      const explicit = skill.level;
      if (explicit !== undefined && explicit !== null && explicit !== "") {
        const legacy = Number(explicit);
        if (Number.isFinite(legacy) && legacy > 0) return legacy;
      }
      return baseSkillLevel + (Number(skill.specializeLevel) || 0);
    };
    const equips = Array.isArray(char?.equip)
      ? char.equip
      : Array.isArray(char?.equips)
        ? char.equips
        : [];
    // locked 表示该模组尚未解锁，不计入已拥有的模组等级
    // 模组显示名用 typeName2（X/Y/A/D…）；没有 typeName2 的是初始证章（无模组状态），不算模组
    const moduleInfoOf = (equip) => equipmentInfo?.[equip.id] || {};
    const isRealModule = (equip) => {
      const entry = equipmentInfo?.[equip.id];
      if (entry === undefined) return true; // 无 equipmentInfo 时按旧行为全部计入
      return Boolean(entry.typeName2); // 有 typeName2 才是真模组，初始证章不算
    };
    const unlockedEquips = equips.filter((equip) => !equip?.locked);
    const moduleLevels = unlockedEquips
      .filter(isRealModule)
      .map((equip) => Number(equip?.level) || 0);
    const modules = equips.map((equip) => ({
      id: equip.id,
      name: moduleInfoOf(equip).typeName2 || "",
      level: Number(equip.level) || 0,
      locked: Boolean(equip.locked),
    }));
    operators.push({
      charId,
      name: meta.name,
      rarity: meta.rarity,
      profession: meta.profession,
      elite: Number(char?.evolvePhase) || 0,
      level: Number(char?.level) || 0,
      skill1: skillLevelAt(0),
      skill2: skillLevelAt(1),
      skill3: skillLevelAt(2),
      modules,
      maxModuleLevel: moduleLevels.length ? Math.max(...moduleLevels) : 0,
    });
  }
  return operators;
}

export async function getSklandOperatorData(fetchImpl, cred, token, operatorMeta, { uid, ...options } = {}) {
  let selectedUid = uid;
  let bindingList = [];
  if (!selectedUid) {
    const binding = await fetchBindingList(fetchImpl, cred, token, options);
    bindingList = binding.arkBindingList;
    const chosen = chooseDefaultBinding(bindingList);
    if (!chosen) {
      throw new SklandError("未找到绑定的明日方舟账号");
    }
    selectedUid = chosen.uid;
  }
  const player = await fetchPlayerInfo(fetchImpl, selectedUid, cred, token, options);
  const operators = formatSklandCharacters(player.chars, operatorMeta, player.equipmentInfoMap);
  return { uid: selectedUid, operators, bindingList, player };
}
