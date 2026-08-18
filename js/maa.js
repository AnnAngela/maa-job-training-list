import { ASSIGNMENT_SNAPSHOT_URL, DEFAULT_LIMIT, MAA_QUERY_BASE, UPLOADER_ID } from "./config.js";
import { normalizeOperSlot, parseJsonContent } from "./util.js";

export function buildQueryUrl(page, limit = DEFAULT_LIMIT) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    uploaderId: UPLOADER_ID,
    desc: "true",
    orderBy: "id",
  });
  return `${MAA_QUERY_BASE}?${params.toString()}`;
}

export function parseAssignmentRecord(item) {
  const content = parseJsonContent(item?.content);
  const doc = content?.doc || {};
  return {
    id: item?.id,
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
}

export async function fetchAssignmentsPage(fetchImpl, page) {
  const response = await fetchImpl(buildQueryUrl(page));
  if (!response.ok) {
    throw new Error(`MAA query failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  const data = payload?.data;
  if (!data || !Array.isArray(data.data)) {
    throw new Error("MAA query response has an unexpected shape");
  }
  return data;
}

export async function fetchAllAssignments(fetchImpl = fetch, { onProgress } = {}) {
  const assignments = [];
  let page = 1;
  let hasNext = true;

  while (hasNext && page <= 100) {
    const data = await fetchAssignmentsPage(fetchImpl, page);
    for (const item of data.data) {
      assignments.push(parseAssignmentRecord(item));
    }
    hasNext = Boolean(data.has_next);
    if (onProgress) {
      onProgress({ page, total: assignments.length, hasNext });
    }
    page += 1;
  }

  return { total: assignments.length, assignments };
}

export async function fetchAssignmentsSnapshot(fetchImpl = fetch) {
  const response = await fetchImpl(ASSIGNMENT_SNAPSHOT_URL);
  if (!response.ok) {
    throw new Error(`snapshot request failed with HTTP ${response.status}`);
  }
  return response.json();
}
