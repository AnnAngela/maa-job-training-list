import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GENERATED_FILES, isDataEquivalent } from "./generate-data.mjs";

// 用法：node scripts/run-check-data-changed.mjs <生成前目录> <生成后目录>
// 仅易变字段（generatedAt/views/hotScore）变化时视为无实质变化；结果写入 GITHUB_OUTPUT 供 workflow 决定是否提交
const [beforeDir, afterDir] = process.argv.slice(2);

const changedFiles = [];
for (const file of GENERATED_FILES) {
  const [before, after] = await Promise.all([
    readFile(join(beforeDir, file), "utf8"),
    readFile(join(afterDir, file), "utf8"),
  ]);
  const equivalent = isDataEquivalent(JSON.parse(before), JSON.parse(after));
  console.log(`${file}: ${equivalent ? "unchanged (only volatile fields)" : "substantive change"}`);
  if (!equivalent) {
    changedFiles.push(file);
  }
}

const summary = `changed=${changedFiles.length > 0}\nchanged_files=${changedFiles.join(",")}\n`;
console.log(summary.trim());
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, summary);
}
