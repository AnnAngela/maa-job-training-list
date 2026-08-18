import { writeFile } from "node:fs/promises";
export const MAA_QUERY_BASE = "https://prts.maa.plus/copilot/query";
export const UPLOADER_ID = "7661";
export const CHARACTER_TABLE_URL =
  "https://raw.githubusercontent.com/Arknights-yituliu/frontend-v2-plus/dev/src/static/json/operator/character_table_simple.v2.json";
export const SKILL_SPRITE_CSS_URL =
  "https://raw.githubusercontent.com/Arknights-yituliu/frontend-v2-plus/dev/src/assets/css/sprite/sprite_skill.css";

export function normalizeAssignment(item) {
  let content = {};
  try {
    content = JSON.parse(item.content);
  } catch {
    content = {};
  }
  const doc = content.doc || {};
  const slot = (oper) => ({
    name: oper.name || "",
    skill: Number.isInteger(oper.skill) ? oper.skill : 0,
    skill_usage: Number.isInteger(oper.skill_usage) ? oper.skill_usage : 0,
    skill_times: Number.isInteger(oper.skill_times) ? oper.skill_times : 1,
    requirements: oper.requirements || {},
  });

  return {
    id: item.id,
    uploadTime: item.upload_time || "",
    views: item.views || 0,
    hotScore: item.hot_score || 0,
    title: doc.title || content.stage_name || "",
    stageName: content.stage_name || "",
    required: Array.isArray(content.opers) ? content.opers.map(slot) : [],
    groups: Array.isArray(content.groups)
      ? content.groups.map((group) => ({
          name: group.name || "",
          opers: Array.isArray(group.opers) ? group.opers.map(slot) : [],
        }))
      : [],
  };
}

export async function fetchAllAssignments(fetchImpl = fetch) {
  const assignments = [];
  let page = 1;
  let hasNext = true;

  while (hasNext && page <= 100) {
    const params = new URLSearchParams({
      page: String(page),
      limit: "100",
      uploaderId: UPLOADER_ID,
      desc: "true",
      orderBy: "id",
    });
    const response = await fetchImpl(`${MAA_QUERY_BASE}?${params}`);
    if (!response.ok) {
      throw new Error(`MAA query failed with HTTP ${response.status}`);
    }
    const payload = await response.json();
    const data = payload?.data;
    if (!data || !Array.isArray(data.data)) {
      throw new Error("MAA query response has an unexpected shape");
    }
    for (const item of data.data) {
      assignments.push(normalizeAssignment(item));
    }
    hasNext = Boolean(data.has_next);
    page += 1;
  }

  return { total: assignments.length, assignments };
}

export function buildOperatorMeta(characters) {
  const operators = {};
  const nameToCharId = {};

  for (const [charId, character] of Object.entries(characters)) {
    if (!character || typeof character !== "object") continue;
    const skills = Array.isArray(character.skills)
      ? character.skills.map((skill) => ({
          skillId: skill.skillId || "",
          skillIcon: skill.skillIcon || "",
          skillName: skill.skillName || "",
        }))
      : [];
    const meta = {
      name: character.name || "",
      rarity: character.rarity || 0,
      profession: character.profession || "",
      skills,
    };
    operators[charId] = meta;
    if (meta.name) {
      nameToCharId[meta.name] = charId;
    }
  }

  return { operators, nameToCharId };
}

export function parseSkillSpriteCss(css) {
  const urlMatch = css.match(/background-image:\s*url\("([^"]+)"\)/);
  const spriteUrl = urlMatch?.[1] || "";
  const entries = {};
  const classPattern = /\.bg-skill_icon_([A-Za-z0-9_]+)\s*\{/g;
  let classMatch;
  while ((classMatch = classPattern.exec(css))) {
    const blockStart = classPattern.lastIndex;
    const blockEnd = css.indexOf("}", blockStart);
    if (blockEnd === -1) continue;
    const block = css.slice(blockStart, blockEnd);
    const positionMatch = block.match(/background-position:\s*(-?\d+)px\s+(-?\d+)px/);
    if (positionMatch) {
      entries[classMatch[1]] = {
        x: Math.abs(Number(positionMatch[1])),
        y: Math.abs(Number(positionMatch[2])),
      };
    }
  }
  return { spriteUrl, size: 128, entries };
}

export async function generateAll({
  fetchImpl = fetch,
  writeFileImpl = writeFile,
  now = new Date(),
} = {}) {
  const [charactersResponse, cssResponse, assignmentData] = await Promise.all([
    fetchImpl(CHARACTER_TABLE_URL),
    fetchImpl(SKILL_SPRITE_CSS_URL),
    fetchAllAssignments(fetchImpl),
  ]);

  if (!charactersResponse.ok) {
    throw new Error(`character table request failed with HTTP ${charactersResponse.status}`);
  }
  if (!cssResponse.ok) {
    throw new Error(`skill sprite css request failed with HTTP ${cssResponse.status}`);
  }

  const characters = await charactersResponse.json();
  const css = await cssResponse.text();
  const generatedAt = now.toISOString();
  const operatorMeta = buildOperatorMeta(characters);
  const skillSprite = parseSkillSpriteCss(css);

  await writeFileImpl(
    new URL("../data/operator_meta.json", import.meta.url),
    `${JSON.stringify({ generatedAt, ...operatorMeta }, null, 2)}\n`,
  );
  await writeFileImpl(
    new URL("../data/skill_sprite.json", import.meta.url),
    `${JSON.stringify({ generatedAt, ...skillSprite }, null, 2)}\n`,
  );
  await writeFileImpl(
    new URL("../data/assignments.snapshot.json", import.meta.url),
    `${JSON.stringify({ generatedAt, ...assignmentData }, null, 2)}\n`,
  );

  return { generatedAt, operatorMeta, skillSprite, assignmentData };
}
