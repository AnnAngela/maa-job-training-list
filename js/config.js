export const MAA_QUERY_BASE = "https://prts.maa.plus/copilot/query";
// 默认作业作者（萨拉托加）；?uploaderId= 可在页面初始化时替换为其他单一作者（替换语义）
export const DEFAULT_UPLOADER_ID = "7661";

/**
 * 解析 URL 中的 uploaderId 参数。
 * 返回 { value, invalid }：参数缺省或空白时 value 为 null（用默认作者）；
 * 纯数字（容忍首尾空白）时 value 为该数字字符串；其余 invalid 为 true（回退默认并提示）。
 */
export const resolveUploaderId = (rawParam) => {
    if (rawParam === null || rawParam === undefined) {
        return { value: null, invalid: false };
    }
    const trimmed = String(rawParam).trim();
    if (trimmed === "") {
        return { value: null, invalid: false };
    }
    if (/^\d+$/.test(trimmed)) {
        return { value: trimmed, invalid: false };
    }
    return { value: null, invalid: true };
};
export const ASSIGNMENT_SNAPSHOT_URL = "./data/assignments.snapshot.json";
export const OPERATOR_META_URL = "./data/operator_meta.json";
export const SKILL_SPRITE_URL = "./data/skill_sprite.json";
// 养成成本数据：一图流 v2 干员表（含精英化/技能/专精/模组成本）与材料、升级成本表，原样镜像
export const CHARACTER_TABLE_URL = "./data/character_table_simple.v2.json";
export const ITEM_INFO_URL = "./data/item_info.json";
export const LEVEL_COST_TABLE_URL = "./data/level_cost_table.json";

export const SKLAND_BASE = "https://zonai.skland.com";
export const BINDING_PATH = "/api/v1/game/player/binding";
export const PLAYER_INFO_PATH = "/api/v1/game/player/info";

// 一图流头像 CDN（cos.yituliu.cn）已于 2025-11-01 停更，特限异格与后续新干员全部 404；
// 改用 PRTS 作业站静态资源，其 /assets/operator-avatars/webp32/ 覆盖全部在用干员（阿米娅近卫/医疗形态除外，页面不渲染）
export const AVATAR_BASE = "https://prts.plus/assets/operator-avatars/webp32";

export const SKLAND_LINK = "https://www.skland.com/index";
export const SKLAND_COMMAND = 'copy(localStorage.getItem("SK_OAUTH_CRED_KEY")+","+localStorage.getItem("SK_TOKEN_CACHE_KEY"))';

export const RECENT_DAYS = 90;
export const RECENT_WINDOW_DAYS = 180;
export const DEFAULT_LIMIT = 100;

// 首次访问或超过该天数未访问时，弹出两个清单开关的说明
export const INTRO_REMIND_DAYS = 30;

export const SCORE_WEIGHTS = {
    coreGain: 1000,
    groupGain: 100,
    unsatisfiedCore: 50,
    recentCoreDemand: 10,
    groupDemand: 1,
};

export const PRIORITY_TIERS = {
    extreme: 5000,
    high: 1000,
    medium: 100,
};

export const DEFAULT_OPTIONS = {
    requireModule: false,
    recentDays: RECENT_DAYS,
};
