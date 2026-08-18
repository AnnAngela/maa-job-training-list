import { AVATAR_BASE, PRIORITY_TIERS } from "./config.js";

export function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function normalizeOperSlot(oper) {
  return {
    name: oper?.name || "",
    skill: Number.isInteger(oper?.skill) ? oper.skill : 0,
    skill_usage: Number.isInteger(oper?.skill_usage) ? oper.skill_usage : 0,
    skill_times: Number.isInteger(oper?.skill_times) ? oper.skill_times : 1,
    requirements: oper?.requirements || {},
  };
}

export function operatorAvatarUrl(charId) {
  return `${AVATAR_BASE}/${charId}.png`;
}

export function skillSpriteStyle(skillSprite, skillIcon, size = 24) {
  const entry = skillSprite?.entries?.[skillIcon];
  if (!entry) return "";
  const scale = size / (skillSprite.size || 128);
  const offsetX = entry.x * scale;
  const offsetY = entry.y * scale;
  return `width:${size}px;height:${size}px;background-image:url("${skillSprite.spriteUrl}");background-size:${size * 16}px ${size * 16}px;background-position:-${offsetX}px -${offsetY}px;`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function skillLevelLabel(level) {
  if (level >= 10) return "专三";
  if (level === 9) return "专二";
  if (level === 8) return "专一";
  if (level === 7) return "7级";
  return `${level}级`;
}

export function scoreTier(score) {
  if (score >= PRIORITY_TIERS.extreme) return "极高";
  if (score >= PRIORITY_TIERS.high) return "高";
  if (score >= PRIORITY_TIERS.medium) return "中";
  return "低";
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}
