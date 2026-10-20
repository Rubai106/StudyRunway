import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const entryPoint = "next-auth/react";

try {
  const resolved = require.resolve(entryPoint);
  console.log(`Runtime dependency check passed: ${entryPoint} → ${resolved}`);
} catch (error) {
  console.error(`Runtime dependency check failed: cannot resolve ${entryPoint}.`);
  console.error(
    "Auth.js is declared in package.json; run npm ci from the project root, then restart npm run dev.",
  );
  if (error instanceof Error && error.message) {
    console.error(error.message);
  }
  process.exitCode = 1;
}
