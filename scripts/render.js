#!/usr/bin/env node
// Render a request JSON file without the HTTP server.
// Usage: node scripts/render.js examples/vocab-quiz.local.json [--out renders/name] [--keep]
import fs from "node:fs/promises";
import path from "node:path";
import { loadTemplates } from "../src/templates/registry.js";
import { validateRequest, renderJob } from "../src/pipeline.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: node scripts/render.js <request.json> [--out dir] [--keep]");
  process.exit(1);
}
const outIdx = args.indexOf("--out");
const name = path.basename(file, ".json");
const outDir = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.join("renders", name));

await loadTemplates();
const body = JSON.parse(await fs.readFile(file, "utf8"));
const req = validateRequest(body);
const t0 = Date.now();
const result = await renderJob(req, {
  workDir: outDir,
  outDir,
  keepWork: args.includes("--keep"),
  onStage: (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`),
});
console.log(`Done: ${path.join(outDir, result.files.video)} (${result.duration}s video, render ${result.renderSeconds.toFixed(1)}s)`);
