import { escapeHtml, formatNumber, operatorAvatarUrl, scoreTier, skillLevelLabel, skillSpriteStyle } from "./util.js";

// requirements.module 是模组类型编号（见 ZOOT-Plus copilot.schema：1=X, 2=Y, 3=A, 4=D）
const MODULE_TYPE_NAMES = { 1: "X", 2: "Y", 3: "A", 4: "D", 5: "B" };

export function charIdForName(name, operatorMeta) {
  const charId = operatorMeta?.nameToCharId?.[name];
  return charId || "";
}

export function operatorAvatarHtml(name, charId, { size = 32, grayscale = false } = {}) {
  const fallback = escapeHtml((name || "?").slice(0, 1));
  const className = grayscale ? "operator-avatar operator-avatar--grayscale" : "operator-avatar";
  if (!charId) {
    return `<span class="avatar-wrap"><span class="avatar-fallback">${fallback}</span></span>`;
  }
  return `<span class="avatar-wrap"><span class="avatar-fallback is-hidden">${fallback}</span><img class="${className}" width="${size}" height="${size}" src="${escapeHtml(operatorAvatarUrl(charId))}" alt="${escapeHtml(name || "")}" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('is-hidden');this.previousElementSibling.classList.remove('is-hidden')"></span>`;
}

export function skillIconHtml(skillSprite, skillIcon, { size = 22, title = "" } = {}) {
  const safeTitle = escapeHtml(title);
  if (!skillIcon) {
    return `<span class="skill-icon skill-icon--empty" title="${safeTitle}">技</span>`;
  }
  const style = skillSpriteStyle(skillSprite, skillIcon, size);
  if (!style) {
    return `<span class="skill-icon skill-icon--empty" title="${safeTitle}">技</span>`;
  }
  return `<span class="skill-icon" style="${style}" title="${safeTitle}"></span>`;
}

export function operatorSkillIcon(operatorMeta, skillSprite, charId, skillIndex, { size = 20 } = {}) {
  if (!charId || !skillIndex) return "";
  const skills = operatorMeta?.operators?.[charId]?.skills;
  const skill = skills?.[skillIndex - 1];
  return skillIconHtml(skillSprite, skill?.skillIcon, { size, title: skill?.skillName || `技能${skillIndex}` });
}

export function rarityStars(rarity) {
  return "★".repeat(Math.min(6, Math.max(1, Number(rarity) || 1)));
}

export function statusBadge(row) {
  if (!row.user) {
    return `<span class="badge badge--missing">未拥有</span>`;
  }
  if (row.totalGap === 0) {
    return `<span class="badge badge--ready">已达标</span>`;
  }
  return `<span class="badge badge--pending">待培养</span>`;
}

export function renderSummary(summary) {
  const cards = [
    { label: "作业总数", value: summary.totalAssignments },
    { label: "当前可抄", value: summary.readyCount },
    { label: "暂不可抄", value: summary.notReadyCount },
    { label: "涉及干员", value: summary.involvedOperators },
    { label: "未拥有", value: summary.missingOperators },
  ];
  return `<div class="summary-grid">${cards.map((card) => `<div class="summary-card"><div class="summary-value">${formatNumber(card.value)}</div><div class="summary-label">${escapeHtml(card.label)}</div></div>`).join("")}</div>`;
}

export function renderBindingButtons(bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    return `<p class="hint">未找到绑定的明日方舟账号</p>`;
  }
  return `<div class="binding-list">${bindings.map((binding) => `<button type="button" class="binding-button" data-uid="${escapeHtml(binding.uid || "")}"><span class="binding-name">${escapeHtml(binding.nickName || "")}</span><span class="binding-meta">${escapeHtml(binding.channelName || "")} · ${escapeHtml(binding.uid || "")}</span></button>`).join("")}</div>`;
}

export function renderTrainingTable(rows, { operatorMeta }) {
  if (rows.length === 0) {
    return `<div class="empty-state">暂无培养需求，先去获取干员数据或刷新作业。</div>`;
  }
  const body = rows.map((row) => {
    const charId = row.user?.charId || charIdForName(row.name, operatorMeta);
    const meta = operatorMeta?.operators?.[charId];
    const current = row.user ? formatCurrent(row.user) : "—";
    const target = formatTarget(row.target || {}, row.user);
    const avatar = operatorAvatarHtml(row.name, charId, { size: 34, grayscale: !row.user });
    return `<tr><td class="priority-cell"><span class="tier tier--${escapeHtml(scoreTier(row.score))}">${escapeHtml(scoreTier(row.score))}</span></td><td class="operator-cell"><div class="operator-cell-inner">${avatar}<span class="operator-name">${escapeHtml(row.name)}</span><span class="operator-meta">${escapeHtml(meta?.profession || "")} ${escapeHtml(rarityStars(meta?.rarity))}</span></div></td><td class="progress-cell">${current}</td><td class="progress-cell">${target}</td><td>${formatNumber(row.unsatisfiedCore)}</td><td>${statusBadge(row)}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>优先级</th><th>干员</th><th>当前</th><th>目标</th><th>未满足必带作业</th><th>状态</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function skillTriplet(user) {
  return [1, 2, 3].map((index) => Number(user?.[`skill${index}`]) || 0);
}

function formatCurrent(user) {
  const parts = [`精${Number(user.elite) || 0} ${Number(user.level) || 0}级`];
  const skills = skillTriplet(user);
  if (skills.some((value) => value > 0)) {
    parts.push(`技能 ${skills.join("/")}`);
  }
  const modules = Array.isArray(user.modules)
    ? user.modules.filter((module) => module.name && !module.locked && Number(module.level) > 0)
    : [];
  if (modules.length > 0) {
    parts.push(modules.map((module) => `模组 ${escapeHtml(module.name)} ${module.level}级`).join(" · "));
  } else {
    const moduleLevel = Number(user.maxModuleLevel) || 0;
    if (moduleLevel > 0) {
      parts.push(`模组 ${moduleLevel}级`);
    }
  }
  return parts.join(" · ");
}

function formatTarget(target, user) {
  const parts = [];
  const elite = Number(target.elite) || 0;
  const level = Number(target.level) || 0;
  if (elite > 0) {
    parts.push(requirementText(`精${elite}`, !user || Number(user.elite) < elite));
  }
  if (level > 0) {
    parts.push(requirementText(`${level}级`, !user || Number(user.level) < level));
  }
  for (let index = 1; index <= 3; index += 1) {
    const required = Number(target[`skill${index}`]) || 0;
    if (required <= 0) continue; // 所有作业都不涉及该技能，不在目标列显示
    const current = Number(user?.[`skill${index}`]) || 0;
    const text = `技能${index} ${skillLevelLabel(required)}`;
    parts.push(requirementText(text, !user || current < required));
  }
  const moduleType = Number(target.module);
  if (moduleType > 0) {
    const typeName = MODULE_TYPE_NAMES[moduleType];
    if (typeName) {
      const level = Number(target.moduleLevel) || 0;
      const label = level > 0 ? `模组 ${typeName} ${level}级` : `模组 ${typeName}`;
      const module = user?.modules?.find((item) => item.name === typeName && !item.locked);
      const currentLevel = Number(module?.level) || 0;
      const unmet = !user || (level > 0 ? currentLevel < level : currentLevel < 1);
      parts.push(requirementText(label, unmet));
    }
  }
  return parts.length ? parts.join(" · ") : "—";
}

function requirementText(text, unmet) {
  return unmet ? `<span class="req-unmet">${text}</span>` : text;
}
