import { generateAll } from "./generate-data.js";

try {
    const { generatedAt, assignmentData } = await generateAll();
    console.log(`generated data at ${generatedAt}; assignments=${assignmentData.total}`);
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
