import {
    OPERATOR_META_URL,
    RECENT_WINDOW_DAYS,
    SKILL_SPRITE_URL,
    SKLAND_COMMAND,
} from "./config.js";
import { computeTrainingList, standardizeAssignments } from "./compare.js";
import { fetchAllAssignments, fetchAssignmentsSnapshot } from "./maa.js";
import { closeDialog, openDialog, readLastVisit, shouldShowIntro, writeLastVisit } from "./notice.js";
import { fetchBindingList, formatSklandCharacters, getSklandOperatorData, parseCredential } from "./skland.js";
import { renderBindingButtons, renderSummary, renderTrainingTable } from "./view.js";

const createState = () => ({
    operatorMeta: null,
    skillSprite: null,
    assignments: [],
    assignmentSource: "",
    generatedAt: "",
    userOperators: [],
    result: null,
    cred: "",
    token: "",
    bindingList: [],
    status: "就绪",
    error: "",
    filterText: "",
    onlyPending: false,
    onlyMissing: false,
    requireModule: false,
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
    trainingTable: requireElement(doc, "training-table"),
    refreshButton: requireElement(doc, "refresh-button"),
    sklandForm: requireElement(doc, "skland-form"),
    credInput: requireElement(doc, "cred-input"),
    sklandCommand: requireElement(doc, "skland-command"),
    copyCommandButton: requireElement(doc, "copy-command-button"),
    bindingList: requireElement(doc, "binding-list"),
    importButton: requireElement(doc, "import-button"),
    importInput: requireElement(doc, "import-input"),
    exportJsonButton: requireElement(doc, "export-json-button"),
    exportCsvButton: requireElement(doc, "export-csv-button"),
    exportPlanButton: requireElement(doc, "export-plan-button"),
    planCopyDialog: requireElement(doc, "plan-copy-dialog"),
    planCopyTextarea: requireElement(doc, "plan-copy-textarea"),
    planCopyCloseButton: requireElement(doc, "plan-copy-close-button"),
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
    return list.map((item) => {
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
 * level 是 MAA 当前不解析的预留字段，恒带上。未拥有干员 MAA 无法培养，与阿米娅形态一并跳过。
 */
export const buildMaaTrainingPlan = (rows, operatorMeta) => {
    const plans = [];
    let skippedUnowned = 0;
    let skippedUnsupported = 0;
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
        plans.push({
            ...profession ? { role: profession.charAt(0) + profession.slice(1).toLowerCase() } : {},
            name: row.name,
            elite: Number(target.elite) || 0,
            level: Number(target.level) || 0,
            skill_level: Math.min(7, Math.max(...skills)),
            skill_mastery: skills.map((value) => Math.max(0, value - 7)),
        });
    }
    return { plans, skippedUnowned, skippedUnsupported };
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

    const handleCopyCommand = async () => {
        clearError();
        try {
            await navigator.clipboard.writeText(SKLAND_COMMAND);
            setStatus("命令已复制");
        } catch {
            setError("复制失败，请手动复制下方命令");
        }
    };

    const filterRows = () => {
        let rows = state.result?.rows || [];
        if (state.filterText) {
            rows = rows.filter((row) => row.name.includes(state.filterText));
        }
        if (state.onlyMissing) {
            rows = rows.filter((row) => !row.user);
        }
        if (state.onlyPending) {
            rows = rows.filter((row) => row.user && row.totalGap > 0);
        }
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
    };

    const render = () => {
        elements.status.textContent = state.status || "就绪";
        elements.error.textContent = state.error;
        elements.error.classList.toggle("is-hidden", !state.error);
        if (state.result) {
            elements.summary.innerHTML = renderSummary(state.result.summary);
            elements.trainingTable.innerHTML = renderTrainingTable(filterRows(), {
                operatorMeta: state.operatorMeta,
                skillSprite: state.skillSprite,
            });
        } else {
            elements.summary.innerHTML = "<div class=\"empty-state\">请先导入干员数据</div>";
            elements.trainingTable.innerHTML = "<div class=\"empty-state\">暂无培养清单</div>";
        }
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
    };

    const refreshAssignments = async (useLive) => {
        let data = null;
        if (useLive) {
            setStatus("正在从作业站实时拉取作业...");
            try {
                const live = await fetchAllAssignments(deps.fetchImpl, {
                    onProgress: ({ page, total }) => setStatus(`正在拉取第 ${page} 页，已获取 ${total} 份作业`),
                });
                data = {
                    assignments: live.assignments,
                    total: live.total,
                    source: "live",
                    generatedAt: new Date().toISOString(),
                };
            } catch (error) {
                setError(`实时拉取失败，尝试使用快照：${error.message}`);
            }
        }
        if (!data) {
            setStatus("正在加载作业快照...");
            const snapshot = await fetchAssignmentsSnapshot(deps.fetchImpl);
            data = {
                assignments: snapshot.assignments,
                total: snapshot.total,
                source: "snapshot",
                generatedAt: snapshot.generatedAt,
            };
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

    const handleImport = () => {
        clearError();
        try {
            const raw = JSON.parse(elements.importInput.value);
            state.userOperators = normalizeImportedOperators(raw, state.operatorMeta);
            runAnalysis();
            render();
            setStatus(`已导入 ${state.userOperators.length} 名干员`);
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
        const { plans, skippedUnowned, skippedUnsupported } = buildMaaTrainingPlan(rows, state.operatorMeta);
        if (plans.length === 0) {
            setError(rows.length === 0
                ? "当前筛选下没有可导出的培养计划"
                : "当前筛选下的干员均无法由 MAA 培养（未拥有或阿米娅形态）");
            return;
        }
        const text = JSON.stringify(plans);
        const skippedParts = [
            skippedUnowned > 0 ? `${skippedUnowned} 名未拥有` : "",
            skippedUnsupported > 0 ? `${skippedUnsupported} 名阿米娅形态` : "",
        ].filter((part) => !!part);
        const skippedNote = skippedParts.length ? `（已跳过 ${skippedParts.join("、")}）` : "";
        try {
            await navigator.clipboard.writeText(text);
            setStatus(`已复制 ${plans.length} 名干员的培养计划，请在 MAA「干员培养」中点击「从剪贴板读取」${skippedNote}`);
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
        elements.exportJsonButton.addEventListener("click", handleExportJson);
        elements.exportCsvButton.addEventListener("click", handleExportCsv);
        elements.exportPlanButton.addEventListener("click", handleExportPlan);
        elements.planCopyCloseButton.addEventListener("click", () => {
            closeDialog(elements.planCopyDialog);
        });
        elements.copyCommandButton.addEventListener("click", handleCopyCommand);
        elements.sampleButton.addEventListener("click", loadSampleData);
        elements.filterInput.addEventListener("input", (event) => {
            state.filterText = event.target.value;
            render();
        });
        elements.onlyPendingInput.addEventListener("change", (event) => {
            state.onlyPending = event.target.checked;
            render();
        });
        elements.onlyMissingInput.addEventListener("change", (event) => {
            state.onlyMissing = event.target.checked;
            render();
        });
        elements.requireModuleInput.addEventListener("change", (event) => {
            state.requireModule = event.target.checked;
            if (state.userOperators.length) {
                runAnalysis();
            }
            render();
        });
        elements.recentToggle.addEventListener("change", () => {
            state.recentOnly = elements.recentToggle.checked;
            // 切换时间窗口后重新计算并固定按“未满足必带作业”降序排列
            runAnalysis();
            render();
        });
        elements.standardToggle.addEventListener("change", () => {
            state.standardMode = elements.standardToggle.checked;
            runAnalysis();
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
