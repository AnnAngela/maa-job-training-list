import { DEFAULT_OPTIONS, SCORE_WEIGHTS } from "./config.js";

// 标准练度模式：精2满级（按稀有度 1-6★ 对应的最高等级），用到的技能专三、用到的模组三级
export const STANDARD_MAX = {
  1: { elite: 0, level: 30 },
  2: { elite: 0, level: 45 },
  3: { elite: 1, level: 55 },
  4: { elite: 2, level: 70 },
  5: { elite: 2, level: 80 },
  6: { elite: 2, level: 90 },
};

export function standardSlotRequirements(slot, operatorMeta) {
  const charId = operatorMeta?.nameToCharId?.[slot?.name];
  const rarity = operatorMeta?.operators?.[charId]?.rarity;
  const max = STANDARD_MAX[rarity] || STANDARD_MAX[6];
  const rawModule = slot?.requirements?.module;
  const module = rawModule === undefined || rawModule === null ? -1 : Number(rawModule);
  return {
    elite: max.elite,
    level: max.level,
    skill_level: Number(slot?.skill) >= 1 ? 10 : 0,
    module: module > 0 ? 3 : module,
  };
}

export function standardizeAssignments(assignments, operatorMeta) {
  return (assignments || []).map((assignment) => ({
    ...assignment,
    required: (assignment.required || []).map((slot) => ({
      ...slot,
      requirements: standardSlotRequirements(slot, operatorMeta),
    })),
    groups: (assignment.groups || []).map((group) => ({
      ...group,
      opers: (group.opers || []).map((slot) => ({
        ...slot,
        requirements: standardSlotRequirements(slot, operatorMeta),
      })),
    })),
  }));
}

export function normalizeSlotRequirements(slot) {
  const req = slot?.requirements || {};
  const explicitElite = Number(req.elite) || 0;
  const skill = Number(slot?.skill) || 0;
  const skillLevel = Number(req.skill_level) || 0;
  const module = req.module === undefined ? -1 : Number(req.module);
  let elite = explicitElite;
  if (skill >= 1) {
    elite = Math.max(elite, skill - 1);
  }
  if (skillLevel > 7 || module > 0) {
    elite = Math.max(elite, 2);
  } else if (skillLevel > 4) {
    elite = Math.max(elite, 1);
  }
  return {
    elite,
    level: Number(req.level) || 0,
    skillLevel: skill >= 1 ? skillLevel : 0,
    module,
  };
}

export function skillLevelFor(skillIndex, user) {
  if (skillIndex === 1) return Number(user?.skill1) || 0;
  if (skillIndex === 2) return Number(user?.skill2) || 0;
  if (skillIndex === 3) return Number(user?.skill3) || 0;
  return 0;
}

export function evaluateSlot(slot, user, options = {}) {
  const req = normalizeSlotRequirements(slot);
  if (!user) {
    return { satisfied: false, owned: false, gaps: [{ type: "missing" }] };
  }
  const gaps = [];
  if (Number(user.elite) < req.elite) {
    gaps.push({ type: "elite", required: req.elite, current: Number(user.elite) });
  }
  if (Number(user.level) < req.level) {
    gaps.push({ type: "level", required: req.level, current: Number(user.level) });
  }
  if (req.skillLevel > 0) {
    const skillIndex = Number(slot.skill);
    const current = skillLevelFor(skillIndex, user);
    if (current < req.skillLevel) {
      gaps.push({ type: "skill_level", skill: skillIndex, required: req.skillLevel, current });
    }
  }
  if (options.requireModule) {
    if (req.module > 0) {
      if (Number(user.maxModuleLevel) < 1) {
        gaps.push({ type: "module", required: 1, current: Number(user.maxModuleLevel) || 0 });
      }
    } else if (req.module === 0) {
      if (Number(user.maxModuleLevel) > 0) {
        gaps.push({ type: "module", required: 0, current: Number(user.maxModuleLevel) });
      }
    }
  }
  return { satisfied: gaps.length === 0, owned: true, gaps };
}

export function buildUserLookup(userOperators, operatorMeta) {
  const byName = new Map();
  const byCharId = new Map();
  for (const operator of userOperators) {
    byName.set(operator.name, operator);
    byCharId.set(operator.charId, operator);
  }
  return (name) => byName.get(name) || byCharId.get(name) || byCharId.get(operatorMeta?.nameToCharId?.[name]) || null;
}

export function evaluateAssignment(assignment, userLookup, options = {}) {
  const required = Array.isArray(assignment?.required) ? assignment.required : [];
  const groups = Array.isArray(assignment?.groups) ? assignment.groups : [];
  const requiredResults = required.map((slot) => ({
    slot,
    result: evaluateSlot(slot, userLookup(slot.name), options),
  }));
  const groupResults = groups.map((group) => {
    const opers = Array.isArray(group?.opers) ? group.opers : [];
    const results = opers.map((slot) => ({
      slot,
      result: evaluateSlot(slot, userLookup(slot.name), options),
    }));
    return {
      name: group?.name || "",
      satisfied: results.some((item) => item.result.satisfied),
      results,
    };
  });
  const hasNamedRequirements = required.length > 0 || groups.length > 0;
  const ready = hasNamedRequirements
    ? requiredResults.every((item) => item.result.satisfied) && groupResults.every((item) => item.satisfied)
    : true;
  return { ready, hasNamedRequirements, requiredResults, groupResults };
}

export function buildDemand(assignments, options = {}) {
  const recentDays = options.recentDays ?? DEFAULT_OPTIONS.recentDays;
  const now = options.now ?? Date.now();
  const cutoff = now - recentDays * 24 * 60 * 60 * 1000;
  const demand = new Map();

  function touch(name, type, recent, assignmentId) {
    if (!name) return;
    let record = demand.get(name);
    if (!record) {
      record = {
        name,
        coreDemand: 0,
        groupDemand: 0,
        recentCoreDemand: 0,
        assignments: new Map(),
      };
      demand.set(name, record);
    }
    if (type === "core") {
      record.coreDemand += 1;
      if (recent) record.recentCoreDemand += 1;
    } else {
      record.groupDemand += 1;
    }
    const appearance = record.assignments.get(assignmentId) || { core: false, group: false };
    if (type === "core") appearance.core = true;
    else appearance.group = true;
    record.assignments.set(assignmentId, appearance);
  }

  for (const assignment of assignments) {
    const recent = Boolean(assignment.uploadTime) && Date.parse(assignment.uploadTime) >= cutoff;
    for (const slot of assignment.required || []) {
      touch(slot.name, "core", recent, assignment.id);
    }
    for (const group of assignment.groups || []) {
      for (const slot of group.opers || []) {
        touch(slot.name, "group", recent, assignment.id);
      }
    }
  }
  return demand;
}

export function gapWeight(gap) {
  switch (gap.type) {
    case "missing": return 1000;
    case "elite": return 200;
    case "level": return 20;
    case "skill_level": return 10;
    case "module": return 5;
    default: return 1;
  }
}

export function computeTrainingList({ assignments, userOperators, operatorMeta, options = {} }) {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const weights = { ...SCORE_WEIGHTS, ...(options.weights || {}) };
  const userLookup = buildUserLookup(userOperators, operatorMeta);
  const demandByName = buildDemand(assignments, mergedOptions);
  const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const baseResults = assignments.map((assignment) => ({
    assignment,
    result: evaluateAssignment(assignment, userLookup, mergedOptions),
  }));
  const perfectUser = {
    elite: 2,
    level: 99,
    skill1: 10,
    skill2: 10,
    skill3: 10,
    maxModuleLevel: 3,
  };

  const rows = [];
  for (const [name, demand] of demandByName) {
    const user = userLookup(name);
    let unsatisfiedCore = 0;
    let coreGain = 0;
    let groupGain = 0;
    let totalGap = 0;
    const target = { elite: 0, level: 0, skill1: 0, skill2: 0, skill3: 0, module: -1 };

    for (const [assignmentId, appearance] of demand.assignments) {
      const base = baseResults.find((item) => item.assignment.id === assignmentId);
      const assignment = assignmentById.get(assignmentId);

      // 目标列取所有涉及该干员的作业的最高要求（不因当前已达标而跳过）
      for (const slot of assignment.required || []) {
        if (slot.name !== name) continue;
        const req = normalizeSlotRequirements(slot);
        target.elite = Math.max(target.elite, req.elite);
        target.level = Math.max(target.level, req.level);
        if (req.skillLevel > 0 && slot.skill >= 1 && slot.skill <= 3) {
          target[`skill${slot.skill}`] = Math.max(target[`skill${slot.skill}`], req.skillLevel);
        }
        if (req.module > target.module) target.module = req.module;
      }
      for (const group of assignment.groups || []) {
        for (const slot of group.opers || []) {
          if (slot.name !== name) continue;
          const req = normalizeSlotRequirements(slot);
          target.elite = Math.max(target.elite, req.elite);
          target.level = Math.max(target.level, req.level);
          if (req.skillLevel > 0 && slot.skill >= 1 && slot.skill <= 3) {
            target[`skill${slot.skill}`] = Math.max(target[`skill${slot.skill}`], req.skillLevel);
          }
          if (req.module > target.module) target.module = req.module;
        }
      }

      if (base?.result.ready) continue;

      if (appearance.core) {
        const isUnmet = base.result.requiredResults.some(
          (item) => item.slot.name === name && !item.result.satisfied,
        );
        if (isUnmet) unsatisfiedCore += 1;
      }

      const simulated = evaluateAssignment(
        assignment,
        (slotName) => (slotName === name ? perfectUser : userLookup(slotName)),
        mergedOptions,
      );
      if (simulated.ready) {
        if (appearance.core) coreGain += 1;
        else groupGain += 1;
      }

      const currentResult = evaluateAssignment(assignment, userLookup, mergedOptions);
      for (const item of currentResult.requiredResults) {
        if (item.slot.name !== name) continue;
        for (const gap of item.result.gaps) totalGap += gapWeight(gap);
      }
      for (const group of currentResult.groupResults) {
        for (const item of group.results) {
          if (item.slot.name !== name) continue;
          for (const gap of item.result.gaps) totalGap += gapWeight(gap);
        }
      }
    }

    const score =
      coreGain * weights.coreGain +
      groupGain * weights.groupGain +
      unsatisfiedCore * weights.unsatisfiedCore +
      demand.recentCoreDemand * weights.recentCoreDemand +
      demand.groupDemand * weights.groupDemand;

    rows.push({
      name,
      user,
      score,
      coreGain,
      groupGain,
      unsatisfiedCore,
      recentCoreDemand: demand.recentCoreDemand,
      groupDemand: demand.groupDemand,
      totalGap,
      target,
    });
  }

  rows.sort((a, b) => b.unsatisfiedCore - a.unsatisfiedCore || b.score - a.score || a.totalGap - b.totalGap || a.name.localeCompare(b.name, "zh-CN"));

  const readyCount = baseResults.filter((item) => item.result.ready).length;
  const involved = rows.length;
  const owned = rows.filter((row) => row.user).length;
  return {
    summary: {
      totalAssignments: assignments.length,
      readyCount,
      notReadyCount: assignments.length - readyCount,
      involvedOperators: involved,
      ownedOperators: owned,
      missingOperators: involved - owned,
    },
    rows,
    assignmentResults: baseResults,
  };
}
