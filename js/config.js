export const MAA_QUERY_BASE = "https://prts.maa.plus/copilot/query";
export const UPLOADER_ID = "7661";
export const ASSIGNMENT_SNAPSHOT_URL = "./data/assignments.snapshot.json";
export const OPERATOR_META_URL = "./data/operator_meta.json";
export const SKILL_SPRITE_URL = "./data/skill_sprite.json";

export const SKLAND_BASE = "https://zonai.skland.com";
export const BINDING_PATH = "/api/v1/game/player/binding";
export const PLAYER_INFO_PATH = "/api/v1/game/player/info";

export const AVATAR_BASE = "https://cos.yituliu.cn/image2/avatar";

export const SKLAND_LINK = "https://www.skland.com/index";
export const SKLAND_COMMAND = 'copy(localStorage.getItem("SK_OAUTH_CRED_KEY")+","+localStorage.getItem("SK_TOKEN_CACHE_KEY"))';

export const RECENT_DAYS = 90;
export const DEFAULT_LIMIT = 100;

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
