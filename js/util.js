import { AVATAR_BASE, PRIORITY_TIERS } from "./config.js";

export const parseJsonContent = (content) => {
    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
};

export const normalizeOperSlot = (oper) => ({
    name: oper?.name || "",
    skill: Number.isInteger(oper?.skill) ? oper.skill : 0,
    skill_usage: Number.isInteger(oper?.skill_usage) ? oper.skill_usage : 0,
    skill_times: Number.isInteger(oper?.skill_times) ? oper.skill_times : 1,
    requirements: oper?.requirements || {},
});

export const operatorAvatarUrl = (charId) => `${AVATAR_BASE}/${charId}.png`;

export const skillSpriteStyle = (skillSprite, skillIcon, size = 24) => {
    const entry = skillSprite?.entries?.[skillIcon];
    if (!entry) {
        return "";
    }
    const scale = size / (skillSprite.size || 128);
    const offsetX = entry.x * scale;
    const offsetY = entry.y * scale;
    return `width:${size}px;height:${size}px;background-image:url("${skillSprite.spriteUrl}");background-size:${size * 16}px ${size * 16}px;background-position:-${offsetX}px -${offsetY}px;`;
};

export const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const skillLevelLabel = (level) => {
    if (level >= 10) {
        return "专三";
    }
    if (level === 9) {
        return "专二";
    }
    if (level === 8) {
        return "专一";
    }
    if (level === 7) {
        return "7级";
    }
    return `${level}级`;
};

export const scoreTier = (score) => {
    if (score >= PRIORITY_TIERS.extreme) {
        return "极高";
    }
    if (score >= PRIORITY_TIERS.high) {
        return "高";
    }
    if (score >= PRIORITY_TIERS.medium) {
        return "中";
    }
    return "低";
};

export const formatNumber = (value) => Number(value || 0).toLocaleString("zh-CN");
