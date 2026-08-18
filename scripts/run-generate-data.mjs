import { generateAll } from "./generate-data.mjs";

generateAll()
  .then(({ generatedAt, assignmentData }) => {
    console.log(`generated data at ${generatedAt}; assignments=${assignmentData.total}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
