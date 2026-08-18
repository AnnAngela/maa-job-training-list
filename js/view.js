import { escapeHtml, formatNumber, operatorAvatarUrl, scoreTier, skillLevelLabel, skillSpriteStyle } from "./util.js";

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
  return `<span class="avatar-wrap"><span class="avatar-fallback">${fallback}</span><img class="${className}" width="${size}" height="${size}" src="${escapeHtml(operatorAvatarUrl(charId))}" alt="${escapeHtml(name || "")}" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('is-hidden')"></span>`;
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

export function renderTrainingTable(rows, { operatorMeta, skillSprite }) {
  if (rows.length === 0) {
    return `<div class="empty-state">暂无培养需求，先去获取干员数据或刷新作业。</div>`;
  }
  const body = rows.map((row) => {
    const charId = row.user?.charId || charIdForName(row.name, operatorMeta);
    const meta = operatorMeta?.operators?.[charId];
    const target = row.target || {};
    const current = row.user
      ? `精${row.user.elite || 0} ${row.user.level || 0}级`
      : "—";
    const targetText = `精${target.elite || 0} ${target.level || 0}级`;
    const skillText = target.skill
      ? `技能${target.skill} ${skillLevelLabel(target.skillLevel || 0)}`
      : "—";
    const avatar = operatorAvatarHtml(row.name, charId, { size: 34, grayscale: !row.user });
    const skillIcon = operatorSkillIcon(operatorMeta, skillSprite, charId, target.skill, { size: 20 });
    return `<tr><td class="priority-cell"><span class="tier tier--${escapeHtml(scoreTier(row.score))}">${escapeHtml(scoreTier(row.score))}</span></td><td class="operator-cell">${avatar}<span class="operator-name">${escapeHtml(row.name)}</span><span class="operator-meta">${escapeHtml(meta?.profession || "")} ${escapeHtml(rarityStars(meta?.rarity))}</span></td><td>${current}</td><td>${targetText}</td><td class="skill-cell">${skillIcon} ${escapeHtml(skillText)}</td><td>${formatNumber(row.coreGain)}</td><td>${formatNumber(row.groupGain)}</td><td>${formatNumber(row.unsatisfiedCore)}</td><td>${statusBadge(row)}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>优先级</th><th>干员</th><th>当前</th><th>目标</th><th>技能</th><th>新增可抄(必带)</th><th>新增可抄(组内)</th><th>未满足必带作业</th><th>状态</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderAssignmentTable(assignmentResults) {
  if (assignmentResults.length === 0) {
    return `<div class="empty-state">暂无作业数据</div>`;
  }
  const body = assignmentResults.map(({ assignment, result }) => {
    const readyClass = result.ready ? "status status--ready" : "status status--blocked";
    const missing = result.hasNamedRequirements && !result.ready ? buildMissingText(result) : "—";
    return `<tr><td class="${readyClass}">${result.ready ? "可抄" : "不可抄"}</td><td>${escapeHtml(assignment.title || assignment.stageName || "")}</td><td>${escapeHtml(assignment.stageName || "")}</td><td>${escapeHtml(missing)}</td><td><a href="https://prts.maa.plus/copilot/${escapeHtml(String(assignment.id))}" target="_blank" rel="noreferrer">打开</a></td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data-table data-table--assignments"><thead><tr><th>状态</th><th>作业</th><th>关卡</th><th>缺失项</th><th>链接</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function buildMissingText(result) {
  const parts = [];
  for (const item of result.requiredResults) {
    if (!item.result.satisfied) {
      parts.push(`${item.slot.name}(${gapText(item.result.gaps)})`);
    }
  }
  for (const group of result.groupResults) {
    if (!group.satisfied) {
      parts.push(`组「${group.name}」:${group.results.filter((item) => !item.result.satisfied).map((item) => item.slot.name).join("/")}`);
    }
  }
  return parts.join("；");
}

function gapText(gaps) {
  const labels = gaps.map((gap) => {
    if (gap.type === "missing") return "未拥有";
    if (gap.type === "elite") return `精${gap.required}`;
    if (gap.type === "level") return `${gap.required}级`;
    if (gap.type === "skill_level") return `技能${gap.skill} ${skillLevelLabel(gap.required)}`;
    return gap.type;
  });
  return labels.join("+");
}
