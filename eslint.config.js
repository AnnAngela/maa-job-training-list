import { configs } from "@annangela/eslint-config";
import globals from "globals";
import { readFile } from "node:fs/promises";

// 用异步 readFile 读 package.json：`with { type: "json" }` 需要 ES2025 语法，
// 而共享配置的 base 把 ecmaVersion 钉在 2024，直接 import 会解析失败
const packageJson = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));

/**
 * 待检查的文件范围：
 * - js/、lib/ 是浏览器侧 ES 模块（index.html 以 `<script type="module">` 加载，lib/md5.js 被 js/skland.js 引用）
 * - scripts/ 是 Node 侧脚本，根目录配置文件同理；tests/ 跑在 Vitest + jsdom 下，因此两者都要给 Node 规则
 */
const browserSpec = {
    files: [
        "js/**/*.js",
        "lib/**/*.js",
    ],
};
const nodeSpec = {
    files: [
        "scripts/**/*.js",
        "tests/**/*.mjs",
        "*.{js,mjs,cjs}",
    ],
};

/**
 * @type { import("eslint").Linter.Config["ignores"] }
 */
const ignores = [
    "**/node_modules/**",
    // 点目录（.github/、.cache/ 等）不参与检查；Moegirl 侧需要检查 .husky/*.mjs 时是显式反忽略的
    "**/.*/**",
    "coverage/**",
    "site/**",
];

/**
 * @type { import("eslint").Linter.Config[] }
 */
const config = [
    // 全局忽略必须单独成项：与其它键写在同一对象里时只对该对象生效，不会成为全仓忽略
    { ignores },
    // base
    {
        ...configs.base,
        ignores,
    },
    {
        ...configs.browser,
        ...browserSpec,
        languageOptions: {
            ...configs.browser.languageOptions,
            // 共享配置的 browser 预设是 `sourceType: "script"`（Moegirl 的 src 是传统脚本），
            // 本站点全部按 ES 模块加载，不改会直接把 import/export 判成解析错误
            sourceType: "module",
            parserOptions: {
                ...configs.browser.languageOptions.parserOptions,
                sourceType: "module",
            },
        },
        rules: {
            // 误报：该规则假设 await 期间对象可能被整体替换，而 state 与 elements 都是 createApp 内
            // 一次创建、之后只改属性的 const 单例，不存在换绑可能；各事件处理器共用同一批对象，
            // 「后写覆盖先写」正是预期语义（如连续点击两个账号按钮）
            "require-atomic-updates": "off",
        },
    },
    {
        ...configs.node,
        ...nodeSpec,
    },
    {
        ignores,
        rules: {
            // 作业站与一图流的接口字段是 snake_case，解析响应时无法改名，属于外部契约而非本地命名疏漏
            // （Moegirl 侧同样为 GitHub API 的 pull_number 等字段开了口子）
            camelcase: [
                "error",
                {
                    allow: [
                        "skill_level",
                        "module_level",
                        "skill_usage",
                        "skill_times",
                        "upload_time",
                        "hot_score",
                        "has_next",
                        "stage_name",
                    ],
                },
            ],
        },
    },
    {
        // lib/md5.js 是位运算密集的 MD5 实现，括号承担分组可读性（`0xc0 | (code >> 6)` 去掉括号后
        // 变成 `0xc0 | code >> 6`，语义不变但几乎无法校对），因此只在文件内关掉括号检查
        files: [
            "lib/md5.js",
        ],
        rules: {
            "@stylistic/no-extra-parens": "off",
        },
    },
    {
        ...nodeSpec,
        rules: {
            // 运行在可信环境：这些校验面向不可信输入，对构建与数据生成脚本是噪音（同 Moegirl 的 node 段）
            "security/detect-unsafe-regex": "off",
            "security/detect-object-injection": "off",
            "security/detect-non-literal-fs-filename": "off",
            "security/detect-non-literal-regexp": "off",
            "security/detect-child-process": "off",
            "n/no-extraneous-import": "off",
            "n/no-process-exit": "off",

            // Node 版本取 package.json 的 engines.node，避免断言一个和实际运行环境无关的版本
            "n/no-unsupported-features/es-builtins": ["error", { version: packageJson.engines.node }],
            "n/no-unsupported-features/node-builtins": ["error", { version: packageJson.engines.node }],
            "n/no-unsupported-features/es-syntax": ["error", { version: packageJson.engines.node }],
        },
    },
    {
        files: [
            "tests/**/*.mjs",
        ],
        languageOptions: {
            // 测试跑在 jsdom 里，document / localStorage / navigator / DOMParser 等由 jsdom 提供
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            // 测试夹具的对象键是游戏侧数据 ID（char_002_amiya 等 charId、uniequip_* 模组 ID、sk_* 技能 ID），
            // 必须与接口返回一致，不能改成驼峰；键名由测试断言兜底，这里不再逐个维护白名单
            camelcase: [
                "error",
                { properties: "never" },
            ],
            // 浏览器环境里 localStorage / navigator / crypto 是 jsdom 提供的全局，
            // 与 Node 是否把它们标为实验特性无关，按 Node 版本报错属于误报
            "n/no-unsupported-features/node-builtins": [
                "error",
                {
                    version: packageJson.engines.node,
                    ignores: [
                        "localStorage",
                        "navigator",
                        "crypto",
                    ],
                },
            ],
        },
    },
];
export default config;
