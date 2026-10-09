import { expect, test, vi } from "vitest";
import {
    buildQueryUrl,
    fetchAssignmentsDelta,
    fetchAssignmentsPage,
    fetchAssignmentsSnapshot,
    parseAssignmentRecord,
} from "../js/maa.js";

const jsonResponse = (data, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
});

test("buildQueryUrl includes required params", () => {
    const url = buildQueryUrl(2, 50);
    expect(url).toContain("page=2");
    expect(url).toContain("limit=50");
    expect(url).toContain("uploaderId=7661");
    expect(url).toContain("desc=true");
    expect(url).toContain("orderBy=id");
});

test("parseAssignmentRecord parses content and defaults", () => {
    const record = parseAssignmentRecord({
        id: 1,
        upload_time: "2024-01-01",
        views: 10,
        hot_score: 2.5,
        content: JSON.stringify({
            stage_name: "1-7",
            doc: { title: "标题" },
            opers: [{ name: "阿米娅", skill: 1 }],
            groups: [{ name: "奶盾", opers: [{ name: "塞雷娅" }] }],
        }),
    });
    expect(record).toMatchObject({ id: 1, title: "标题", stageName: "1-7", views: 10, hotScore: 2.5 });
    expect(record.required[0]).toMatchObject({ name: "阿米娅", skill: 1 });
    expect(record.groups[0].opers[0]).toMatchObject({ name: "塞雷娅" });
});

test("parseAssignmentRecord handles invalid content", () => {
    const record = parseAssignmentRecord({ id: 2, content: "bad-json" });
    expect(record.title).toBe("");
    expect(record.required).toEqual([]);
    expect(record.groups).toEqual([]);
});

test("parseAssignmentRecord falls back to stage name and defaults group fields", () => {
    const record = parseAssignmentRecord({
        id: 3,
        content: JSON.stringify({ stage_name: "3-1", groups: [{ opers: null }] }),
    });
    expect(record.title).toBe("3-1");
    expect(record.groups[0]).toMatchObject({ name: "", opers: [] });
});

test("fetchAssignmentsPage throws on HTTP error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    await expect(fetchAssignmentsPage(fetchImpl, 1)).rejects.toThrow("HTTP 500");
});

test("fetchAssignmentsPage throws on bad shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: null }, 200));
    await expect(fetchAssignmentsPage(fetchImpl, 1)).rejects.toThrow("unexpected shape");
});

test("fetchAssignmentsDelta paginates fully without a baseline and reports progress", async () => {
    const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ data: { has_next: true, data: [{ id: 2, content: JSON.stringify({ doc: { title: "B" } }) }] } }, 200))
        .mockResolvedValueOnce(jsonResponse({ data: { has_next: false, data: [{ id: 1, content: JSON.stringify({ doc: { title: "A" } }) }] } }, 200));
    const onProgress = vi.fn();
    const result = await fetchAssignmentsDelta(fetchImpl, { onProgress });
    expect(result.total).toBe(2);
    expect(result.assignments[0].title).toBe("B");
    expect(result.assignments[1].title).toBe("A");
    expect(onProgress).toHaveBeenCalledTimes(2);
});

test("fetchAssignmentsDelta stops within the first page at the baseline id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
        data: {
            has_next: true,
            data: [
                { id: 5, content: JSON.stringify({ doc: { title: "新" } }) },
                { id: 3, content: JSON.stringify({ doc: { title: "旧-同id" } }) },
                { id: 1, content: JSON.stringify({ doc: { title: "更旧" } }) },
            ],
        },
    }, 200));
    const result = await fetchAssignmentsDelta(fetchImpl, { knownMaxId: 3 });
    expect(result.total).toBe(1);
    expect(result.assignments[0].id).toBe(5);
    // has_next 为 true 也必须在命中基线 id 的页停止，不得再翻页
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("fetchAssignmentsDelta spans pages until it reaches the baseline id", async () => {
    const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ data: { has_next: true, data: [
            { id: 5, content: JSON.stringify({ doc: { title: "新1" } }) },
            { id: 4, content: JSON.stringify({ doc: { title: "新2" } }) },
        ] } }, 200))
        .mockResolvedValueOnce(jsonResponse({ data: { has_next: true, data: [
            { id: 3, content: JSON.stringify({ doc: { title: "旧" } }) },
        ] } }, 200));
    const result = await fetchAssignmentsDelta(fetchImpl, { knownMaxId: 3 });
    expect(result.assignments.map((item) => item.id)).toEqual([5, 4]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test("fetchAssignmentsDelta returns an empty delta when already up to date", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
        data: { has_next: true, data: [{ id: 3, content: JSON.stringify({ doc: { title: "旧" } }) }] },
    }, 200));
    const result = await fetchAssignmentsDelta(fetchImpl, { knownMaxId: 3 });
    expect(result.total).toBe(0);
    expect(result.assignments).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("fetchAssignmentsSnapshot returns parsed snapshot", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ total: 3, assignments: [] }, 200));
    await expect(fetchAssignmentsSnapshot(fetchImpl)).resolves.toEqual({ total: 3, assignments: [] });
});

test("fetchAssignmentsSnapshot throws on HTTP error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    await expect(fetchAssignmentsSnapshot(fetchImpl)).rejects.toThrow("HTTP 404");
});
