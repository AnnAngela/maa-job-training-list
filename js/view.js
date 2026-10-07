import { MODULE_TYPE_NAMES, aggregateMaterials } from "./cost.js";
import { escapeHtml, formatCount, formatNumber, operatorAvatarUrl, scoreTier, skillLevelLabel, skillSpriteStyle } from "./util.js";

const skillTriplet = (user) => [1, 2, 3].map((index) => Number(user?.[`skill${index}`]) || 0);

const requirementText = (text, unmet) => unmet ? `<span class="req-unmet">${text}</span>` : text;

const formatCurrent = (user) => {
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
};

const formatTarget = (target, user) => {
    const parts = [];
    const elite = Number(target.elite) || 0;
    const level = Number(target.level) || 0;
    if (elite > 0) {
        // 精英化阶段优先：用户阶段更低时高亮
        parts.push(requirementText(`精${elite}`, !user || Number(user.elite) < elite));
    }
    if (level > 0) {
        // 精英化阶段优先于等级：用户阶段更高时（如精2 40级对目标精1 60级），等级视为已满足
        const sameStageBelow = !!user && Number(user.elite) <= elite && Number(user.level) < level;
        parts.push(requirementText(`${level}级`, !user || sameStageBelow));
    }
    for (let index = 1; index <= 3; index += 1) {
        const required = Number(target[`skill${index}`]) || 0;
        // 所有作业都不涉及该技能，不在目标列显示
        if (required <= 0) {
            continue;
        }
        const current = Number(user?.[`skill${index}`]) || 0;
        const text = `技能${index} ${skillLevelLabel(required)}`;
        parts.push(requirementText(text, !user || current < required));
    }
    // 模组要求按类型对展示：每对一个类型及其等级，未满足判定与 evaluateSlot 一致
    const modulePairs = (Array.isArray(target.modulePairs) && target.modulePairs.length
        ? target.modulePairs
        : [{ type: Number(target.module), level: Number(target.moduleLevel) || 0 }])
        .filter((pair) => Number(pair?.type) > 0);
    for (const pair of modulePairs) {
        const typeName = MODULE_TYPE_NAMES[Number(pair.type)];
        if (!typeName) {
            continue;
        }
        const targetLevel = Number(pair.level) || 0;
        const label = targetLevel > 0 ? `模组 ${typeName} ${targetLevel}级` : `模组 ${typeName}`;
        const module = user?.modules?.find((item) => item.name === typeName && !item.locked);
        const currentLevel = Number(module?.level) || 0;
        const unmet = !user || currentLevel < Math.max(targetLevel, 1);
        parts.push(requirementText(label, unmet));
    }
    return parts.length ? parts.join(" · ") : "—";
};

export const charIdForName = (name, operatorMeta) => {
    const charId = operatorMeta?.nameToCharId?.[name];
    return charId || "";
};

export const operatorAvatarHtml = (name, charId, { size = 32, grayscale = false } = {}) => {
    const fallback = escapeHtml((name || "?").slice(0, 1));
    const className = grayscale ? "operator-avatar operator-avatar--grayscale" : "operator-avatar";
    if (!charId) {
        return `<span class="avatar-wrap"><span class="avatar-fallback">${fallback}</span></span>`;
    }
    return `<span class="avatar-wrap"><span class="avatar-fallback is-hidden">${fallback}</span><img class="${className}" width="${size}" height="${size}" src="${escapeHtml(operatorAvatarUrl(charId))}" alt="${escapeHtml(name || "")}" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('is-hidden');this.previousElementSibling.classList.remove('is-hidden')"></span>`;
};

export const skillIconHtml = (skillSprite, skillIcon, { size = 22, title = "" } = {}) => {
    const safeTitle = escapeHtml(title);
    if (!skillIcon) {
        return `<span class="skill-icon skill-icon--empty" title="${safeTitle}">技</span>`;
    }
    const style = skillSpriteStyle(skillSprite, skillIcon, size);
    if (!style) {
        return `<span class="skill-icon skill-icon--empty" title="${safeTitle}">技</span>`;
    }
    return `<span class="skill-icon" style="${style}" title="${safeTitle}"></span>`;
};

export const operatorSkillIcon = (operatorMeta, skillSprite, charId, skillIndex, { size = 20 } = {}) => {
    if (!charId || !skillIndex) {
        return "";
    }
    const skills = operatorMeta?.operators?.[charId]?.skills;
    const skill = skills?.[skillIndex - 1];
    return skillIconHtml(skillSprite, skill?.skillIcon, { size, title: skill?.skillName || `技能${skillIndex}` });
};

export const rarityStars = (rarity) => "★".repeat(Math.min(6, Math.max(1, Number(rarity) || 1)));

// 材料图标 chip：DOM 结构复刻一图流 item-sprite + .bg-{itemId} 雪碧图模式（sprite_item.css 直链）
export const itemChipHtml = (itemId, count, itemInfoMap) => {
    const info = itemInfoMap?.[itemId];
    const title = info?.itemName || itemId;
    const rarity = Math.min(5, Math.max(1, Number(info?.rarity) || 1));
    return `<span class="item-chip item-chip--r${rarity}" title="${escapeHtml(title)}"><span class="item-sprite"><span class="bg-${escapeHtml(itemId)}"></span></span><span class="item-count">${formatCount(count)}</span></span>`;
};

const rarityOfItem = (itemId, itemInfoMap) => Number(itemInfoMap?.[itemId]?.rarity) || 0;

// 材料条目排序：稀有度降序，同稀有度按 itemId
export const sortMaterialEntries = (items, itemInfoMap) => Object.entries(items || {})
    .sort((a, b) => rarityOfItem(b[0], itemInfoMap) - rarityOfItem(a[0], itemInfoMap) || a[0].localeCompare(b[0]));

// 材料 chips 列表；无材料时显示占位文案
const materialChipsHtml = (items, itemInfoMap) => {
    const chips = sortMaterialEntries(items, itemInfoMap)
        .map(([itemId, count]) => itemChipHtml(itemId, count, itemInfoMap)).join("");
    return chips || "<span class=\"hint\">无缺口</span>";
};

// 养成方向的分组顺序与展示名（与 cost.js 的 breakdown 键对应）
const COST_GROUP_LABELS = [
    ["evolve", "精英/等级"],
    ["mastery", "专精"],
    ["module", "模组"],
];

const materialOperatorCard = (row, itemInfoMap) => {
    const breakdown = row.costBreakdown;
    const groups = COST_GROUP_LABELS.map(([key, label]) => {
        const group = breakdown?.[key];
        const notes = group?.notes?.length ? group.notes.join(" · ") : "—";
        // 未计入的方向：材料区显示「未计入」，不显示「无缺口」
        const listHtml = group?.excluded
            ? "<span class=\"hint\">未计入</span>"
            : materialChipsHtml(group?.items, itemInfoMap);
        return `<div class="cost-group"><span class="cost-group-label">${label}</span><span class="cost-group-notes">${escapeHtml(notes)}</span><div class="materials-list">${listHtml}</div></div>`;
    }).join("");
    const totalChips = sortMaterialEntries(breakdown?.total, itemInfoMap)
        .map(([itemId, count]) => itemChipHtml(itemId, count, itemInfoMap)).join("");
    return `<div class="material-operator"><div class="material-operator-head"><span class="operator-name">${escapeHtml(row.name)}</span><span class="tier tier--${escapeHtml(scoreTier(row.score))}">${escapeHtml(scoreTier(row.score))}</span></div><div class="cost-groups">${groups}<div class="cost-group cost-group--total"><span class="cost-group-label">总计</span><div class="materials-list">${totalChips}</div></div></div></div>`;
};

// 单方向多名干员的材料合计
const directionItems = (rows, key) => aggregateMaterials(rows.map((row) => row.costBreakdown?.[key]?.items));

// 总计卡片：置顶展示，样式与单个干员卡片一致；每个方向左侧复选框控制该方向是否计入底部合计
const materialTotalCard = (rows, itemInfoMap, directionTotals) => {
    const groups = COST_GROUP_LABELS.map(([key, label]) => {
        const checked = directionTotals?.[key] ? " checked" : "";
        return `<div class="cost-group"><input type="checkbox" class="direction-total-select" data-direction="${key}" aria-label="计入${escapeHtml(label)}"${checked}><span class="cost-group-label">${label}</span><div class="materials-list">${materialChipsHtml(directionItems(rows, key), itemInfoMap)}</div></div>`;
    }).join("");
    const selectedKeys = COST_GROUP_LABELS.filter(([key]) => directionTotals?.[key]).map(([key]) => key);
    const totalHtml = selectedKeys.length
        ? materialChipsHtml(aggregateMaterials(selectedKeys.map((key) => directionItems(rows, key))), itemInfoMap)
        : "<span class=\"hint\">未选择养成方向</span>";
    return `<div class="material-operator material-operator--total"><div class="material-operator-head"><span class="operator-name">养成材料总计（${rows.length}名干员）</span></div>${groups}<div class="cost-group cost-group--total"><span class="cost-group-label">总计</span><div class="materials-list">${totalHtml}</div></div></div>`;
};

// 养成材料计算明细：rows 为已勾选且可计算的行，总计卡片置顶
export const renderMaterialSection = (rows, { itemInfoMap, directionTotals }) => {
    if (rows.length === 0) {
        return "<div class=\"empty-state\">未勾选任何可计算的干员。在上方清单勾选行首复选框，或使用「全部计入」。</div>";
    }
    const cards = rows.map((row) => materialOperatorCard(row, itemInfoMap)).join("");
    return `${materialTotalCard(rows, itemInfoMap, directionTotals)}<div class="material-operators">${cards}</div>`;
};

export const statusBadge = (row) => {
    if (!row.user) {
        return "<span class=\"badge badge--missing\">未拥有</span>";
    }
    if (row.totalGap === 0) {
        return "<span class=\"badge badge--ready\">已达标</span>";
    }
    return "<span class=\"badge badge--pending\">待培养</span>";
};

export const renderSummary = (summary) => {
    const cards = [
        { label: "作业总数", value: summary.totalAssignments },
        { label: "当前可抄", value: summary.readyCount },
        { label: "暂不可抄", value: summary.notReadyCount },
        { label: "涉及干员", value: summary.involvedOperators },
        { label: "未拥有", value: summary.missingOperators },
    ];
    return `<div class="summary-grid">${cards.map((card) => `<div class="summary-card"><div class="summary-value">${formatNumber(card.value)}</div><div class="summary-label">${escapeHtml(card.label)}</div></div>`).join("")}</div>`;
};

export const renderBindingButtons = (bindings) => {
    if (!Array.isArray(bindings) || bindings.length === 0) {
        return "<p class=\"hint\">未找到绑定的明日方舟账号</p>";
    }
    return `<div class="binding-list">${bindings.map((binding) => `<button type="button" class="binding-button" data-uid="${escapeHtml(binding.uid || "")}"><span class="binding-name">${escapeHtml(binding.nickName || "")}</span><span class="binding-meta">${escapeHtml(binding.channelName || "")} · ${escapeHtml(binding.uid || "")}</span></button>`).join("")}</div>`;
};

export const renderTrainingTable = (rows, { operatorMeta, materialSelection } = {}) => {
    if (rows.length === 0) {
        return "<div class=\"empty-state\">暂无培养需求，先去获取干员数据或刷新作业。</div>";
    }
    const body = rows.map((row) => {
        const charId = row.user?.charId || charIdForName(row.name, operatorMeta);
        const meta = operatorMeta?.operators?.[charId];
        const current = row.user ? formatCurrent(row.user) : "—";
        const target = formatTarget(row.target || {}, row.user);
        const avatar = operatorAvatarHtml(row.name, charId, { size: 34, grayscale: !row.user });
        const checked = row.costBreakdown && materialSelection?.has(row.name) ? " checked" : "";
        let checkbox = "";
        if (row.costBreakdown !== undefined) {
            // 无缺口行（costBreakdown 为 null）勾选后也会被过滤，直接禁用
            const disabled = row.costBreakdown === null ? " disabled" : "";
            checkbox = `<input type="checkbox" class="material-select" data-name="${escapeHtml(row.name)}"${checked}${disabled}>`;
        }
        return `<tr><td class="select-cell">${checkbox}</td><td class="priority-cell"><span class="tier tier--${escapeHtml(scoreTier(row.score))}">${escapeHtml(scoreTier(row.score))}</span></td><td class="operator-cell"><div class="operator-cell-inner">${avatar}<span class="operator-name">${escapeHtml(row.name)}</span><span class="operator-meta">${escapeHtml(meta?.profession || "")} ${escapeHtml(rarityStars(meta?.rarity))}</span></div></td><td class="progress-cell">${current}</td><td class="progress-cell">${target}</td><td>${formatNumber(row.unsatisfiedCore)}</td><td class="status-cell">${statusBadge(row)}</td></tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>计入</th><th>优先级</th><th>干员</th><th>当前</th><th>目标</th><th>未满足必带作业</th><th>状态</th></tr></thead><tbody>${body}</tbody></table></div>`;
};
