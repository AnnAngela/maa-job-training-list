import { ASSIGNMENT_SNAPSHOT_URL, DEFAULT_LIMIT, DEFAULT_UPLOADER_ID, MAA_QUERY_BASE } from "./config.js";
import { normalizeOperSlot, parseJsonContent } from "./util.js";

export const buildQueryUrl = (page, limit = DEFAULT_LIMIT, uploaderId = DEFAULT_UPLOADER_ID) => {
    const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        uploaderId,
        desc: "true",
        orderBy: "id",
    });
    return `${MAA_QUERY_BASE}?${params.toString()}`;
};

export const parseAssignmentRecord = (item) => {
    const content = parseJsonContent(item?.content);
    const doc = content?.doc || {};
    return {
        id: item?.id,
        uploaderId: item?.uploader_id || "",
        uploader: item?.uploader || "",
        uploadTime: item?.upload_time || "",
        views: item?.views || 0,
        hotScore: item?.hot_score || 0,
        title: doc.title || content?.stage_name || "",
        stageName: content?.stage_name || "",
        required: Array.isArray(content?.opers) ? content.opers.map(normalizeOperSlot) : [],
        groups: Array.isArray(content?.groups)
            ? content.groups.map((group) => ({
                name: group?.name || "",
                opers: Array.isArray(group?.opers) ? group.opers.map(normalizeOperSlot) : [],
            }))
            : [],
    };
};

export const fetchAssignmentsPage = async (fetchImpl, page, uploaderId) => {
    const response = await fetchImpl(buildQueryUrl(page, DEFAULT_LIMIT, uploaderId));
    if (!response.ok) {
        throw new Error(`MAA query failed with HTTP ${response.status}`);
    }
    const payload = await response.json();
    const data = payload?.data;
    if (!data || !Array.isArray(data.data)) {
        throw new Error("MAA query response has an unexpected shape");
    }
    return data;
};

// 增量拉取：作业站 id 全站自增、接口按 id 降序返回，且新上传的作业 id 必然大于
// 基线（GHA 每日全量生成的快照）中的最大 id——因此从第 1 页翻起，命中首个
// id <= knownMaxId 的条目即可停（同 id 即旧条目），其后整页整页都是已知数据。
// 不传 knownMaxId 时无截断点，自动退化为全量翻页（覆盖快照缺失的兜底场景，
// 以及 ?uploaderId= 指定其他作者时的替换语义——其没有快照基线）；
// 若基线最大 id 的作业被上游删除导致截断条件始终不满足，同样走完全部页，行为自愈。
export const fetchAssignmentsDelta = async (fetchImpl = fetch, { knownMaxId, onProgress, uploaderId } = {}) => {
    const assignments = [];
    let uploaderName = "";
    let page = 1;
    let hasNext = true;

    while (hasNext && page <= 100) {
        const data = await fetchAssignmentsPage(fetchImpl, page, uploaderId);
        // 作者名取自原始条目，且必须在截断判断之前提取：快照已最新时 0 条新纪录、
        // 全部条目被 knownMaxId 跳过，但默认作者改名后的新名字仍要能拿到
        if (!uploaderName) {
            uploaderName = data.data.find((item) => item.uploader)?.uploader || "";
        }
        let reachedBaseline = false;
        for (const item of data.data) {
            if (knownMaxId !== undefined && item.id <= knownMaxId) {
                reachedBaseline = true;
                break;
            }
            assignments.push(parseAssignmentRecord(item));
        }
        if (reachedBaseline) {
            break;
        }
        hasNext = Boolean(data.has_next);
        if (onProgress) {
            onProgress({ page, total: assignments.length, hasNext });
        }
        page += 1;
    }

    return { total: assignments.length, uploaderName, assignments };
};

export const fetchAssignmentsSnapshot = async (fetchImpl = fetch) => {
    const response = await fetchImpl(ASSIGNMENT_SNAPSHOT_URL);
    if (!response.ok) {
        throw new Error(`snapshot request failed with HTTP ${response.status}`);
    }
    return response.json();
};
