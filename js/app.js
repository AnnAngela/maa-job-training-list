import {
  OPERATOR_META_URL,
  RECENT_WINDOW_DAYS,
  SKILL_SPRITE_URL,
  SKLAND_COMMAND,
} from "./config.js";
import { computeTrainingList } from "./compare.js";
import { fetchAllAssignments, fetchAssignmentsSnapshot } from "./maa.js";
import { fetchBindingList, formatSklandCharacters, getSklandOperatorData, parseCredential } from "./skland.js";
import { escapeHtml } from "./util.js";
import { renderBindingButtons, renderSummary, renderTrainingTable } from "./view.js";

function createState() {
  return {
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
    sortBy: "priority",
  };
}

function requireElement(doc, id) {
  const node = doc.getElementById(id);
  if (!node) {
    throw new Error(`missing element #${id}`);
  }
  return node;
}

function collectElements(doc) {
  return {
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
    sampleButton: requireElement(doc, "sample-button"),
    filterInput: requireElement(doc, "filter-input"),
    onlyPendingInput: requireElement(doc, "only-pending-input"),
    onlyMissingInput: requireElement(doc, "only-missing-input"),
    requireModuleInput: requireElement(doc, "require-module-input"),
    sortSelect: requireElement(doc, "sort-select"),
    recentToggle: requireElement(doc, "recent-toggle"),
  };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`请求失败 (${response.status}): ${url}`);
  }
  return response.json();
}

export function normalizeImportedOperators(raw, operatorMeta) {
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
    first &&
      (Object.hasOwn(first, "evolvePhase") ||
        Object.hasOwn(first, "mainSkillLvl") ||
        Object.hasOwn(first, "equip") ||
        Object.hasOwn(first, "potentialRank")),
  );
  if (isRawSkland) {
    return formatSklandCharacters(list, operatorMeta);
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
      maxModuleLevel: Number(item.maxModuleLevel) || 0,
    };
  });
}

export function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function createApp(deps, elements) {
  const state = createState();

  function setStatus(text) {
    state.status = text;
    elements.status.textContent = text;
  }

  function setError(text) {
    state.error = text;
    elements.error.textContent = text;
    elements.error.classList.toggle("is-hidden", !text);
  }

  function clearError() {
    setError("");
  }

  async function handleCopyCommand() {
    clearError();
    try {
      await navigator.clipboard.writeText(SKLAND_COMMAND);
      setStatus("命令已复制");
    } catch (error) {
      setError("复制失败，请手动复制下方命令");
    }
  }

  function filterRows() {
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
    if (state.sortBy === "coreGain") {
      sorted.sort((a, b) => b.coreGain - a.coreGain || b.score - a.score);
    } else if (state.sortBy === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    } else {
      sorted.sort((a, b) => b.score - a.score || a.totalGap - b.totalGap);
    }
    return sorted;
  }

  function runAnalysis() {
    if (!state.operatorMeta || state.assignments.length === 0) {
      state.result = null;
      return;
    }
    const assignments = state.recentOnly
      ? state.assignments.filter((assignment) => {
          const time = Date.parse(assignment.uploadTime || "");
          return Number.isFinite(time) && time >= Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        })
      : state.assignments;
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
  }

  function updateRecentToggle() {
    elements.recentToggle.textContent = state.recentOnly ? "仅近6个月作业" : "全部作业";
    elements.recentToggle.classList.toggle("button--active", state.recentOnly);
  }

  function render() {
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
      elements.summary.innerHTML = `<div class="empty-state">请先导入干员数据</div>`;
      elements.trainingTable.innerHTML = `<div class="empty-state">暂无培养清单</div>`;
    }
  }

  async function loadStaticData() {
    const [operatorMeta, skillSprite] = await Promise.all([
      fetchJson(deps.fetchImpl, OPERATOR_META_URL),
      fetchJson(deps.fetchImpl, SKILL_SPRITE_URL),
    ]);
    state.operatorMeta = operatorMeta;
    state.skillSprite = skillSprite;
  }

  async function refreshAssignments(useLive) {
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
    if (state.userOperators.length) runAnalysis();
    render();
  }

  async function handleSklandCredential(event) {
    event.preventDefault();
    clearError();
    try {
      const { cred, token } = parseCredential(elements.credInput.value);
      state.cred = cred;
      state.token = token;
      setStatus("正在获取森空岛账号列表...");
      const binding = await fetchBindingList(deps.fetchImpl, cred, token, { cryptoImpl: deps.cryptoImpl });
      state.bindingList = binding.arkBindingList;
      elements.bindingList.innerHTML = renderBindingButtons(state.bindingList);
      setStatus(`找到 ${state.bindingList.length} 个绑定账号`);
    } catch (error) {
      setError(error.message);
      setStatus("获取账号列表失败");
    }
  }

  async function handleBindingSelect(uid) {
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
      state.userOperators = data.operators;
      runAnalysis();
      render();
      setStatus(`已读取 ${data.operators.length} 名干员`);
    } catch (error) {
      setError(error.message);
      setStatus("读取干员练度失败");
    }
  }

  function handleImport() {
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
  }

  function loadSampleData() {
    clearError();
    state.userOperators = [
      { charId: "char_002_amiya", name: "阿米娅", rarity: 5, profession: "CASTER", elite: 2, level: 60, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 1 },
      { charId: "char_003_kalts", name: "凯尔希", rarity: 6, profession: "MEDIC", elite: 2, level: 90, skill1: 7, skill2: 10, skill3: 10, maxModuleLevel: 3 },
    ];
    runAnalysis();
    render();
    setStatus("已加载示例数据");
  }

  function handleExportJson() {
    if (!state.result) {
      setError("暂无结果可导出");
      return;
    }
    downloadFile("maa-training-list.json", JSON.stringify(state.result.rows, null, 2), "application/json");
  }

  function handleExportCsv() {
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
      row.user ? "待培养" : "未拥有",
    ]);
    const csv = [header, ...body].map((row) => row.map(csvEscape).join(",")).join("\n");
    downloadFile("maa-training-list.csv", csv, "text/csv");
  }

  function bindEvents() {
    elements.refreshButton.addEventListener("click", () => refreshAssignments(true));
    elements.sklandForm.addEventListener("submit", handleSklandCredential);
    elements.bindingList.addEventListener("click", (event) => {
      const button = event.target.closest(".binding-button");
      if (button) handleBindingSelect(button.dataset.uid);
    });
    elements.importButton.addEventListener("click", handleImport);
    elements.exportJsonButton.addEventListener("click", handleExportJson);
    elements.exportCsvButton.addEventListener("click", handleExportCsv);
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
      if (state.userOperators.length) runAnalysis();
      render();
    });
    elements.sortSelect.addEventListener("change", (event) => {
      state.sortBy = event.target.value;
      render();
    });
    elements.recentToggle.addEventListener("click", () => {
      state.recentOnly = !state.recentOnly;
      updateRecentToggle();
      runAnalysis();
      render();
    });
  }

  updateRecentToggle();
  bindEvents();

  async function bootstrap() {
    try {
      setStatus("正在加载基础数据...");
      await loadStaticData();
      await refreshAssignments(true);
    } catch (error) {
      setError(error.message);
      setStatus("加载失败");
    }
  }

  return {
    state,
    elements,
    bootstrap,
    refreshAssignments,
    handleSklandCredential,
    handleBindingSelect,
    handleImport,
    loadSampleData,
    handleExportJson,
    handleExportCsv,
    handleCopyCommand,
  };
}

export async function initApp({
  document: doc = globalThis.document,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
} = {}) {
  const elements = collectElements(doc);
  elements.sklandCommand.textContent = SKLAND_COMMAND;
  const app = createApp({ document: doc, fetchImpl, cryptoImpl }, elements);
  await app.bootstrap();
  return app;
}
