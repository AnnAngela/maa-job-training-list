import {
    CHARACTER_TABLE_URL,
    ITEM_INFO_URL,
    LEVEL_COST_TABLE_URL,
    OPERATOR_META_URL,
    RECENT_WINDOW_DAYS,
    SKILL_SPRITE_URL,
    SKLAND_COMMAND,
} from "./config.js";
import { attachMaterials, buildCostIndex } from "./cost.js";
import { computeTrainingList, standardizeAssignments } from "./compare.js";
import { fetchAssignmentsDelta, fetchAssignmentsSnapshot } from "./maa.js";
import { closeDialog, openDialog, readLastVisit, shouldShowIntro, writeLastVisit } from "./notice.js";
import { fetchBindingList, formatSklandCharacters, getSklandOperatorData, parseCredential } from "./skland.js";
import { renderBindingButtons, renderMaterialSection, renderSummary, renderTrainingTable } from "./view.js";
import { scoreTier } from "./util.js";

// item_info.json 缺失的模组升级证章（会被一图流材料过滤逻辑丢弃，这里补齐名称与稀有度用于展示）
// 键名来自游戏材料 id，非驼峰命名
/* eslint-disable camelcase */
const ITEM_INFO_PATCH = {
    mod_update_token_1: { itemId: "mod_update_token_1", itemName: "数据增补条", rarity: 4 },
    mod_update_token_2: { itemId: "mod_update_token_2", itemName: "数据增补仪", rarity: 5 },
};
/* eslint-enable camelcase */

// 复制按钮「已复制」状态的保持时长
export const COPY_RESET_DELAY_MS = 2000;

const createState = () => ({
    operatorMeta: null,
    skillSprite: null,
    costIndex: null,
    itemInfoMap: null,
    levelCostTable: null,
    assignments: [],
    assignmentSource: "",
    generatedAt: "",
    userOperators: [],
    result: null,
    // 养成材料计算的勾选集合（row.name）；null 表示尚未初始化（首次分析后默认全选）
    materialSelection: null,
    // 材料总计卡片中各养成方向是否计入合计
    directionTotals: { evolve: true, mastery: true, module: true },
    cred: "",
    token: "",
    bindingList: [],
    status: "就绪",
    error: "",
    filterText: "",
    onlyPending: false,
    onlyMissing: false,
    requireModule: true,
    recentOnly: false,
    standardMode: false,
});

const requireElement = (doc, id) => {
    const node = doc.getElementById(id);
    if (!node) {
        throw new Error(`missing element #${id}`);
    }
    return node;
};

const collectElements = (doc) => ({
    status: requireElement(doc, "status"),
    error: requireElement(doc, "error"),
    summary: requireElement(doc, "summary"),
    materialDetail: requireElement(doc, "material-detail"),
    materialTitle: requireElement(doc, "material-title"),
    materialFilters: requireElement(doc, "material-filters"),
    materialSelectAll: requireElement(doc, "material-select-all"),
    materialClear: requireElement(doc, "material-clear"),
    trainingTable: requireElement(doc, "training-table"),
    trainingTitle: requireElement(doc, "training-title"),
    refreshButton: requireElement(doc, "refresh-button"),
    sklandForm: requireElement(doc, "skland-form"),
    credInput: requireElement(doc, "cred-input"),
    sklandCommand: requireElement(doc, "skland-command"),
    copyCommandButton: requireElement(doc, "copy-command-button"),
    bindingList: requireElement(doc, "binding-list"),
    importButton: requireElement(doc, "import-button"),
    importInput: requireElement(doc, "import-input"),
    importFileInput: requireElement(doc, "import-file-input"),
    uploadFileButton: requireElement(doc, "upload-file-button"),
    exportJsonButton: requireElement(doc, "export-json-button"),
    exportCsvButton: requireElement(doc, "export-csv-button"),
    exportPlanButton: requireElement(doc, "export-plan-button"),
    planCopyDialog: requireElement(doc, "plan-copy-dialog"),
    planCopyTextarea: requireElement(doc, "plan-copy-textarea"),
    planCopyCloseButton: requireElement(doc, "plan-copy-close-button"),
    planDoneDialog: requireElement(doc, "plan-done-dialog"),
    planDoneMessage: requireElement(doc, "plan-done-message"),
    planDoneCloseButton: requireElement(doc, "plan-done-close-button"),
    sampleButton: requireElement(doc, "sample-button"),
    filterInput: requireElement(doc, "filter-input"),
    onlyPendingInput: requireElement(doc, "only-pending-input"),
    onlyMissingInput: requireElement(doc, "only-missing-input"),
    requireModuleInput: requireElement(doc, "require-module-input"),
    recentToggle: requireElement(doc, "recent-toggle"),
    standardToggle: requireElement(doc, "standard-toggle"),
    introDialog: requireElement(doc, "intro-dialog"),
    introCloseButton: requireElement(doc, "intro-close-button"),
});

export const SKLAND_CREDENTIAL_KEY = "maa-training-list.skland-credential";

const saveCredential = (cred, token) => {
    try {
        localStorage.setItem(SKLAND_CREDENTIAL_KEY, JSON.stringify({ cred, token }));
    } catch {
    // localStorage 不可用时静默失败，凭证仅保留在内存
    }
};

const loadCredential = () => {
    try {
        const raw = localStorage.getItem(SKLAND_CREDENTIAL_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        return parsed && parsed.cred && parsed.token ? { cred: parsed.cred, token: parsed.token } : null;
    } catch {
        return null;
    }
};

const fetchJson = async (fetchImpl, url) => {
    const response = await fetchImpl(url);
    if (!response.ok) {
        throw new Error(`请求失败 (${response.status}): ${url}`);
    }
    return response.json();
};

export const normalizeImportedOperators = (raw, operatorMeta) => {
    let list;
    if (Array.isArray(raw)) {
        list = raw;
    } else if (Array.isArray(raw?.operators)) {
        list = raw.operators;
    } else if (Array.isArray(raw?.data?.operators)) {
        list = raw.data.operators;
    } else if (Array.isArray(raw?.chars)) {
        list = raw.chars;
    } else if (Array.isArray(raw?.data?.chars)) {
        list = raw.data.chars;
    }
    if (!Array.isArray(list)) {
        throw new Error("导入数据应为数组、包含 operators 数组的对象，或森空岛 player/info 原始响应");
    }
    const first = list[0];
    const isRawSkland = Boolean(
        first
        && (Object.hasOwn(first, "evolvePhase")
            || Object.hasOwn(first, "mainSkillLvl")
            || Object.hasOwn(first, "equip")
            || Object.hasOwn(first, "potentialRank")),
    );
    if (isRawSkland) {
        const equipmentInfo = raw?.data?.equipmentInfoMap || raw?.equipmentInfoMap || {};
        return formatSklandCharacters(list, operatorMeta, equipmentInfo);
    }
    return list.map((rawItem) => {
        // 兼容本页导出的结果行：练度数据嵌套在 user 字段中
        const item = rawItem?.user && typeof rawItem.user === "object" ? rawItem.user : rawItem;
        const charId = item.charId || operatorMeta?.nameToCharId?.[item.name] || "";
        const meta = operatorMeta?.operators?.[charId];
        return {
            charId,
            name: item.name || meta?.name || "",
            rarity: item.rarity || meta?.rarity || 0,
            profession: item.profession || meta?.profession || "",
            elite: Number(item.elite) || 0,
            level: Number(item.level) || 0,
            skill1: Number(item.skill1) || 0,
            skill2: Number(item.skill2) || 0,
            skill3: Number(item.skill3) || 0,
            modules: Array.isArray(item.modules) ? item.modules : undefined,
            maxModuleLevel: Number(item.maxModuleLevel) || 0,
        };
    });
};

export const csvEscape = (value) => {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
        return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
};

export const downloadFile = (filename, content, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
};

// MAA「干员培养」未支持阿米娅三形态的培养流程（其选择器已屏蔽），导出计划时跳过并计数
const MAA_UNSUPPORTED_CHAR_IDS = new Set(["char_002_amiya", "char_1001_amiya2", "char_1037_amiya3"]);

/**
 * 把培养清单行转成 MAA「干员培养-从剪贴板读取」的导入格式（行需来自 filterRows，自带 target）。
 * 内部技能值 8/9/10 表示专一/二/三：公共技能等级封顶 7（专精前置），skill_mastery = 值 - 7；
 * level 是 MAA 当前不解析的预留字段，恒带上。未拥有干员 MAA 无法培养、阿米娅三形态不支持、
 * 精英化与技能皆无可练的行（如已满级的 1-2★ 干员），一并跳过并计数。
 */
export const buildMaaTrainingPlan = (rows, operatorMeta) => {
    const plans = [];
    let skippedUnowned = 0;
    let skippedUnsupported = 0;
    let skippedNoGoal = 0;
    for (const row of rows || []) {
        const charId = operatorMeta?.nameToCharId?.[row.name] || row.user?.charId || "";
        if (MAA_UNSUPPORTED_CHAR_IDS.has(charId)) {
            skippedUnsupported += 1;
            continue;
        }
        if (!row.user) {
            skippedUnowned += 1;
            continue;
        }
        // role 为职业枚举首字母大写（WARRIOR→Warrior），与 MAA OperatorRole 一一对应；
        // 查不到时省略该键，MAA 解析端会按干员名反查补齐
        const profession = operatorMeta?.operators?.[charId]?.profession || row.user.profession || "";
        const target = row.target;
        const skills = [1, 2, 3].map((index) => Number(target[`skill${index}`]) || 0);
        // MaaCore 的 check_json 只接受 skill_level 2-7，且一条非法值会使整份任务创建失败；
        // 技能 1 级是游戏基线（无培养意义），此时按未设置导出 0（MAA 序列化端会省略该字段）
        const commonLevel = Math.min(7, Math.max(...skills));
        // MAA 可表达的培养目标只有精英化（1-2）与技能（2-7/专精）：两者皆无时导出空条目
        // 没有培养意义，还会在 MAA 里呈现为「推荐培养但无具体目标」的卡片
        if ((Number(target.elite) || 0) < 1 && commonLevel < 2) {
            skippedNoGoal += 1;
            continue;
        }
        plans.push({
            ...profession ? { role: profession.charAt(0) + profession.slice(1).toLowerCase() } : {},
            name: row.name,
            elite: Number(target.elite) || 0,
            level: Number(target.level) || 0,
            skill_level: commonLevel > 1 ? commonLevel : 0,
            skill_mastery: skills.map((value) => Math.max(0, value - 7)),
        });
    }
    return { plans, skippedUnowned, skippedUnsupported, skippedNoGoal };
};

const createApp = (deps, elements) => {
    const state = createState();

    const setStatus = (text) => {
        state.status = text;
        elements.status.textContent = text;
    };

    const setError = (text) => {
        state.error = text;
        elements.error.textContent = text;
        elements.error.classList.toggle("is-hidden", !text);
    };

    const clearError = () => {
        setError("");
    };

    // 复制成功后按钮短暂显示「已复制」，到时恢复原文
    const handleCopyCommand = async () => {
        clearError();
        try {
            await navigator.clipboard.writeText(SKLAND_COMMAND);
            setStatus("命令已复制");
            elements.copyCommandButton.textContent = "已复制";
            setTimeout(() => {
                elements.copyCommandButton.textContent = "复制命令";
            }, COPY_RESET_DELAY_MS);
        } catch {
            setError("复制失败，请手动复制下方命令");
        }
    };

    // 干员星级：优先用森空岛数据，未拥有时查元数据
    const rowRarity = (row) => {
        if (row.user?.rarity) {
            return Number(row.user.rarity);
        }
        const charId = row.user?.charId || state.operatorMeta?.nameToCharId?.[row.name];
        return Number(state.operatorMeta?.operators?.[charId]?.rarity) || 0;
    };

    // 读取筛选区激活的星级与养成优先级
    const activeMaterialFilters = () => {
        const rarities = new Set();
        const tiers = new Set();
        for (const input of elements.materialFilters.querySelectorAll("input:checked")) {
            if (input.dataset.rarity) {
                rarities.add(Number(input.dataset.rarity));
            }
            if (input.dataset.tier) {
                tiers.add(input.dataset.tier);
            }
        }
        return { rarities, tiers };
    };

    // 单行是否命中星级/养成优先级筛选
    const rowMatchesMaterialFilters = (row, { rarities, tiers }) => {
        const rarity = rowRarity(row);
        if (rarities.size > 0) {
            // 「3星及以下」按 rarity <= 3 匹配
            const hit = [...rarities].some((value) => value === 3 ? rarity <= 3 : rarity === value);
            if (!hit) {
                return false;
            }
        }
        if (tiers.size > 0 && !tiers.has(scoreTier(row.score))) {
            return false;
        }
        return true;
    };

    const filterRows = () => {
        let rows = state.result?.rows || [];
        const filters = activeMaterialFilters();
        if (state.filterText) {
            rows = rows.filter((row) => row.name.includes(state.filterText));
        }
        if (state.onlyMissing) {
            rows = rows.filter((row) => !row.user);
        }
        if (state.onlyPending) {
            rows = rows.filter((row) => row.user && row.totalGap > 0);
        }
        rows = rows.filter((row) => rowMatchesMaterialFilters(row, filters));
        const sorted = [...rows];
        // 固定按“未满足必带作业”降序排列
        sorted.sort((a, b) => b.unsatisfiedCore - a.unsatisfiedCore || b.score - a.score || a.totalGap - b.totalGap || a.name.localeCompare(b.name, "zh-CN"));
        return sorted;
    };

    const runAnalysis = () => {
        if (!state.operatorMeta || state.assignments.length === 0) {
            state.result = null;
            return;
        }
        let assignments = state.recentOnly
            ? state.assignments.filter((assignment) => {
                const time = Date.parse(assignment.uploadTime || "");
                return Number.isFinite(time) && time >= Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
            })
            : state.assignments;
        // 标准练度模式：不看作业自设要求，统一精2满级（按稀有度）、用到的技能专三、用到的模组三级
        if (state.standardMode) {
            assignments = standardizeAssignments(assignments, state.operatorMeta);
        }
        const options = { requireModule: state.requireModule };
        if (state.recentOnly) {
            options.recentDays = RECENT_WINDOW_DAYS;
        }
        state.result = computeTrainingList({
            assignments,
            userOperators: state.userOperators,
            operatorMeta: state.operatorMeta,
            options,
        });
        // 附带养成成本分组；成本数据缺失时保留 rows 原样（材料区显示不可用）
        if (state.costIndex) {
            attachMaterials(state.result.rows, {
                costIndex: state.costIndex,
                levelCostTable: state.levelCostTable,
                charIdOf: (row) => row.user?.charId || state.operatorMeta?.nameToCharId?.[row.name] || "",
                requireModule: state.requireModule,
            });
        }
        // 勾选集合：首次分析默认全选；行集合变化后保留交集
        const names = state.result.rows.map((row) => row.name);
        state.materialSelection = state.materialSelection === null
            ? new Set(names)
            : new Set(names.filter((name) => state.materialSelection.has(name)));
    };

    // 参与材料计算的行：勾选且具备成本数据（勾选集合已随筛选剪枝，始终为可见行的子集）
    const selectedMaterialRows = () => (state.result?.rows || [])
        .filter((row) => state.materialSelection?.has(row.name) && row.costBreakdown)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"));

    const render = () => {
        elements.status.textContent = state.status || "就绪";
        elements.error.textContent = state.error;
        elements.error.classList.toggle("is-hidden", !state.error);
        if (state.result) {
            elements.summary.innerHTML = renderSummary(state.result.summary);
            const materialRows = selectedMaterialRows();
            elements.materialTitle.textContent = `养成材料计算（${materialRows.length}名干员）`;
            elements.materialDetail.innerHTML = renderMaterialSection(materialRows, {
                itemInfoMap: state.itemInfoMap,
                directionTotals: state.directionTotals,
            });
            // 清单标题实时显示筛选后的干员数量
            elements.trainingTitle.textContent = `培养优先级清单（${filterRows().length} 名干员）`;
            elements.trainingTable.innerHTML = renderTrainingTable(filterRows(), {
                operatorMeta: state.operatorMeta,
                materialSelection: state.materialSelection,
            });
        } else {
            elements.summary.innerHTML = "<div class=\"empty-state\">请先导入干员数据</div>";
            elements.materialDetail.innerHTML = "";
            elements.trainingTitle.textContent = "培养优先级清单";
            elements.trainingTable.innerHTML = "<div class=\"empty-state\">暂无培养清单</div>";
        }
    };

    // 筛选/搜索变化后调用：取消已从清单中消失的干员的勾选，保持勾选集合为可见行的子集
    const pruneSelection = () => {
        if (!state.materialSelection) {
            return;
        }
        const visible = new Set(filterRows().map((row) => row.name));
        state.materialSelection = new Set([...state.materialSelection].filter((name) => visible.has(name)));
    };

    // 首次访问或超过 INTRO_REMIND_DAYS 天未访问时，提示两个清单开关的含义与位置；
    // 每次访问都刷新时间戳（含未弹窗的访问），因此「连续 30 天未访问」按页面打开时间计算
    const maybeShowIntro = () => {
        const now = Date.now();
        if (shouldShowIntro(readLastVisit(globalThis.localStorage), now)) {
            openDialog(elements.introDialog);
        }
        writeLastVisit(globalThis.localStorage, now);
    };

    const loadStaticData = async () => {
        const [operatorMeta, skillSprite] = await Promise.all([
            fetchJson(deps.fetchImpl, OPERATOR_META_URL),
            fetchJson(deps.fetchImpl, SKILL_SPRITE_URL),
        ]);
        state.operatorMeta = operatorMeta;
        state.skillSprite = skillSprite;
        // 养成成本数据独立加载：失败仅材料列不可用，不影响练度清单主功能
        try {
            const [characters, itemInfo, levelCostTable] = await Promise.all([
                fetchJson(deps.fetchImpl, CHARACTER_TABLE_URL),
                fetchJson(deps.fetchImpl, ITEM_INFO_URL),
                fetchJson(deps.fetchImpl, LEVEL_COST_TABLE_URL),
            ]);
            state.costIndex = buildCostIndex(characters);
            state.itemInfoMap = Object.fromEntries(itemInfo.map((item) => [item.itemId, item]));
            Object.assign(state.itemInfoMap, ITEM_INFO_PATCH);
            state.levelCostTable = levelCostTable;
        } catch {
            setStatus("养成成本数据加载失败，材料缺口不可用");
        }
    };

    const refreshAssignments = async (useLive) => {
        // 快照（GHA 每日全量生成并提交）永远是基线：既直接用于展示，又为增量拉取提供 id 截断点
        let snapshot = null;
        try {
            setStatus("正在加载作业快照...");
            snapshot = await fetchAssignmentsSnapshot(deps.fetchImpl);
        } catch (error) {
            // 仅快照模式下快照失败即致命；live 模式继续走无基线全量拉取
            if (!useLive) {
                throw error;
            }
            setError(`快照加载失败，改为全量拉取：${error.message}`);
        }

        let data = {
            assignments: snapshot ? snapshot.assignments : [],
            total: snapshot ? snapshot.assignments.length : 0,
            source: "snapshot",
            generatedAt: snapshot ? snapshot.generatedAt : "",
        };

        if (useLive) {
            setStatus("正在从作业站拉取新增作业...");
            try {
                // 基线最大 id 之后的才是新作业；无基线时传 undefined，fetchAssignmentsDelta 退化为全量翻页
                const knownMaxId = data.assignments.length
                    ? Math.max(...data.assignments.map((assignment) => assignment.id))
                    : undefined;
                const delta = await fetchAssignmentsDelta(deps.fetchImpl, {
                    knownMaxId,
                    onProgress: ({ page, total }) => setStatus(`正在拉取第 ${page} 页，已新增 ${total} 份作业`),
                });
                data = {
                    assignments: [...delta.assignments, ...data.assignments],
                    total: delta.assignments.length + data.assignments.length,
                    source: "live",
                    generatedAt: new Date().toISOString(),
                };
            } catch (error) {
                // 快照与增量双双失败才致命（与旧全量路径一致，由 bootstrap 报「加载失败」）；
                // 仅增量失败则退回快照展示
                if (!snapshot) {
                    throw error;
                }
                setError(`增量拉取失败，使用快照：${error.message}`);
            }
        }
        state.assignments = data.assignments;
        state.assignmentSource = data.source;
        state.generatedAt = data.generatedAt;
        setError("");
        setStatus(`已加载 ${data.total} 份作业（${data.source === "live" ? "实时" : "快照"}）`);
        if (state.userOperators.length) {
            runAnalysis();
        }
        render();
    };

    const handleSklandCredential = async (event) => {
        event.preventDefault();
        clearError();
        try {
            const { cred, token } = parseCredential(elements.credInput.value);
            state.cred = cred;
            state.token = token;
            saveCredential(cred, token);
            setStatus("正在获取森空岛账号列表...");
            const binding = await fetchBindingList(deps.fetchImpl, cred, token, { cryptoImpl: deps.cryptoImpl });
            const bindingList = binding.arkBindingList;
            state.bindingList = bindingList;
            elements.bindingList.innerHTML = renderBindingButtons(bindingList);
            setStatus(`找到 ${bindingList.length} 个绑定账号`);
        } catch (error) {
            setError(error.message);
            setStatus("获取账号列表失败");
        }
    };

    const handleBindingSelect = async (uid) => {
        if (!state.cred || !state.token) {
            setError("请先输入森空岛凭证");
            return;
        }
        setStatus("正在读取干员练度...");
        try {
            const data = await getSklandOperatorData(deps.fetchImpl, state.cred, state.token, state.operatorMeta, {
                uid,
                cryptoImpl: deps.cryptoImpl,
            });
            const { operators } = data;
            state.userOperators = operators;
            runAnalysis();
            render();
            setStatus(`已读取 ${operators.length} 名干员`);
        } catch (error) {
            setError(error.message);
            setStatus("读取干员练度失败");
        }
    };

    const importFromText = (text) => {
        clearError();
        const raw = JSON.parse(text);
        state.userOperators = normalizeImportedOperators(raw, state.operatorMeta);
        runAnalysis();
        render();
        setStatus(`已导入 ${state.userOperators.length} 名干员`);
    };

    const handleImport = () => {
        try {
            importFromText(elements.importInput.value);
        } catch (error) {
            setError(error.message);
        }
    };

    // 读取文件内容并回填文本框，便于查看与再次手动导入
    const handleImportFile = async (file) => {
        if (!file) {
            return;
        }
        try {
            const text = await file.text();
            elements.importInput.value = text;
            importFromText(text);
        } catch (error) {
            setError(error.message);
        }
    };

    const loadSampleData = () => {
        clearError();
        state.userOperators = [
            { charId: "char_002_amiya", name: "阿米娅", rarity: 5, profession: "CASTER", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 1 },
            { charId: "char_003_kalts", name: "凯尔希", rarity: 6, profession: "MEDIC", elite: 2, level: 90, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 3 },
        ];
        runAnalysis();
        render();
        setStatus("已加载示例数据");
    };

    const handleExportJson = () => {
        if (!state.result) {
            setError("暂无结果可导出");
            return;
        }
        downloadFile("maa-training-list.json", JSON.stringify(state.result.rows, null, 2), "application/json");
    };

    const handleExportCsv = () => {
        if (!state.result) {
            setError("暂无结果可导出");
            return;
        }
        const header = ["干员", "优先级", "新增可抄必带", "新增可抄组内", "未满足必带作业", "状态"];
        const body = state.result.rows.map((row) => [
            row.name,
            row.score,
            row.coreGain,
            row.groupGain,
            row.unsatisfiedCore,
            // 状态与页面徽章保持一致：已拥有且 totalGap 为 0 是「已达标」
            !row.user ? "未拥有" : row.totalGap === 0 ? "已达标" : "待培养",
        ]);
        const csv = [header, ...body].map((row) => row.map(csvEscape).join(",")).join("\n");
        downloadFile("maa-training-list.csv", csv, "text/csv");
    };

    // 导出当前筛选视图为 MAA 培养计划并写剪贴板；被拒/不可用时弹只读 textarea 全选兜底
    const handleExportPlan = async () => {
        clearError();
        if (!state.result) {
            setError("暂无结果可导出");
            return;
        }
        const rows = filterRows();
        const { plans, skippedUnowned, skippedUnsupported, skippedNoGoal } = buildMaaTrainingPlan(rows, state.operatorMeta);
        if (plans.length === 0) {
            setError(rows.length === 0
                ? "当前筛选下没有可导出的培养计划"
                : "当前筛选下的干员均无法由 MAA 培养（未拥有、阿米娅形态或无可培养目标）");
            return;
        }
        const text = JSON.stringify(plans);
        const skippedParts = [
            skippedUnowned > 0 ? `${skippedUnowned} 名未拥有` : "",
            skippedUnsupported > 0 ? `${skippedUnsupported} 名阿米娅形态` : "",
            skippedNoGoal > 0 ? `${skippedNoGoal} 名无可培养目标` : "",
        ].filter((part) => !!part);
        const skippedNote = skippedParts.length ? `（已跳过 ${skippedParts.join("、")}）` : "";
        try {
            await navigator.clipboard.writeText(text);
            // 结果提示较长（数量、跳过说明、MAA 操作引导），状态栏放不下且易被忽略，用对话框呈现
            elements.planDoneMessage.textContent = `已复制 ${plans.length} 名干员的培养计划，请在 MAA「干员培养」中点击「从剪贴板读取」${skippedNote}`;
            openDialog(elements.planDoneDialog);
        } catch {
            // 剪贴板被拒或 API 不可用（如 http 非安全上下文）：弹窗兜底，textarea 打开即全选
            elements.planCopyTextarea.value = text;
            openDialog(elements.planCopyDialog);
            elements.planCopyTextarea.focus();
            elements.planCopyTextarea.select();
            setStatus(`复制失败，请在弹窗中手动复制${skippedNote}`);
        }
    };

    const bindEvents = () => {
        elements.refreshButton.addEventListener("click", () => refreshAssignments(true));
        elements.sklandForm.addEventListener("submit", handleSklandCredential);
        elements.bindingList.addEventListener("click", (event) => {
            const button = event.target.closest(".binding-button");
            if (button) {
                handleBindingSelect(button.dataset.uid);
            }
        });
        elements.importButton.addEventListener("click", handleImport);
        // 上传按钮触发系统文件选择
        elements.uploadFileButton.addEventListener("click", () => {
            elements.importFileInput.click();
        });
        elements.importFileInput.addEventListener("change", (event) => {
            const file = event.target.files?.[0];
            // 清空 value，保证选择同一文件也能再次触发 change
            event.target.value = "";
            handleImportFile(file);
        });
        // 拖拽到文本框时阻止浏览器默认打开文件，并切换高亮样式
        elements.importInput.addEventListener("dragover", (event) => {
            event.preventDefault();
            elements.importInput.classList.add("is-dragover");
        });
        elements.importInput.addEventListener("dragleave", () => {
            elements.importInput.classList.remove("is-dragover");
        });
        elements.importInput.addEventListener("drop", (event) => {
            event.preventDefault();
            elements.importInput.classList.remove("is-dragover");
            handleImportFile(event.dataTransfer?.files?.[0]);
        });
        elements.exportJsonButton.addEventListener("click", handleExportJson);
        elements.exportCsvButton.addEventListener("click", handleExportCsv);
        elements.exportPlanButton.addEventListener("click", handleExportPlan);
        elements.planCopyCloseButton.addEventListener("click", () => {
            closeDialog(elements.planCopyDialog);
        });
        elements.planDoneCloseButton.addEventListener("click", () => {
            closeDialog(elements.planDoneDialog);
        });
        elements.copyCommandButton.addEventListener("click", handleCopyCommand);
        elements.sampleButton.addEventListener("click", loadSampleData);
        // 清单行首复选框：切换干员是否计入材料计算
        elements.trainingTable.addEventListener("change", (event) => {
            const input = event.target.closest(".material-select");
            if (!input || !state.materialSelection) {
                return;
            }
            if (input.checked) {
                state.materialSelection.add(input.dataset.name);
            } else {
                state.materialSelection.delete(input.dataset.name);
            }
            render();
        });
        // 材料总计卡片的方向复选框：控制计入合计的养成方向
        elements.materialDetail.addEventListener("change", (event) => {
            const input = event.target.closest(".direction-total-select");
            if (!input) {
                return;
            }
            state.directionTotals[input.dataset.direction] = input.checked;
            render();
        });
        // 星级/优先级筛选变化：剪枝勾选集合后重渲（不影响其余勾选状态）
        elements.materialFilters.addEventListener("change", () => {
            pruneSelection();
            render();
        });
        elements.materialSelectAll.addEventListener("click", () => {
            if (!state.result) {
                return;
            }
            // 仅勾选当前筛选命中的行，与隐藏行无法手动勾选保持一致
            state.materialSelection = new Set(filterRows().map((row) => row.name));
            render();
        });
        elements.materialClear.addEventListener("click", () => {
            state.materialSelection = new Set();
            render();
        });
        elements.filterInput.addEventListener("input", (event) => {
            state.filterText = event.target.value;
            pruneSelection();
            render();
        });
        elements.onlyPendingInput.addEventListener("change", (event) => {
            state.onlyPending = event.target.checked;
            pruneSelection();
            render();
        });
        elements.onlyMissingInput.addEventListener("change", (event) => {
            state.onlyMissing = event.target.checked;
            pruneSelection();
            render();
        });
        elements.requireModuleInput.addEventListener("change", (event) => {
            state.requireModule = event.target.checked;
            if (state.userOperators.length) {
                runAnalysis();
            }
            pruneSelection();
            render();
        });
        elements.recentToggle.addEventListener("change", () => {
            state.recentOnly = elements.recentToggle.checked;
            // 切换时间窗口后重新计算并固定按“未满足必带作业”降序排列
            runAnalysis();
            pruneSelection();
            render();
        });
        elements.standardToggle.addEventListener("change", () => {
            state.standardMode = elements.standardToggle.checked;
            runAnalysis();
            pruneSelection();
            render();
        });
        elements.introCloseButton.addEventListener("click", () => {
            closeDialog(elements.introDialog);
        });
    };

    bindEvents();

    const restoreCredential = async () => {
        const saved = loadCredential();
        if (!saved) {
            return;
        }
        state.cred = saved.cred;
        state.token = saved.token;
        elements.credInput.value = saved.cred;
        try {
            setStatus("正在读取已保存的森空岛账号...");
            const binding = await fetchBindingList(deps.fetchImpl, saved.cred, saved.token, { cryptoImpl: deps.cryptoImpl });
            state.bindingList = binding.arkBindingList;
            elements.bindingList.innerHTML = renderBindingButtons(state.bindingList);
            setStatus("已恢复已保存的森空岛账号");
        } catch (error) {
            setError(`自动恢复凭证失败：${error.message}`);
        }
    };

    const bootstrap = async () => {
        try {
            setStatus("正在加载基础数据...");
            await loadStaticData();
            await refreshAssignments(true);
            await restoreCredential();
        } catch (error) {
            setError(error.message);
            setStatus("加载失败");
        }
    };

    return {
        state,
        elements,
        bootstrap,
        maybeShowIntro,
        refreshAssignments,
        handleSklandCredential,
        handleBindingSelect,
        handleImport,
        loadSampleData,
        handleExportJson,
        handleExportCsv,
        handleExportPlan,
        handleCopyCommand,
    };
};

export const initApp = async ({
    document: doc = globalThis.document,
    fetchImpl = globalThis.fetch,
    cryptoImpl = globalThis.crypto,
} = {}) => {
    const elements = collectElements(doc);
    elements.sklandCommand.textContent = SKLAND_COMMAND;
    const app = createApp({ document: doc, fetchImpl, cryptoImpl }, elements);
    // 先弹提示再加载数据：数据加载失败也不影响开关说明的展示
    app.maybeShowIntro();
    await app.bootstrap();
    return app;
};
