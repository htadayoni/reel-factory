import path from "node:path";
import express from "express";
import { ROOT, config } from "./config.js";
import { loadTemplates, describeTemplates } from "./templates/registry.js";
import { createJob, getJob, publicJob, waitForJob, jobFile, restoreJobs, cleanupOldJobs } from "./jobs.js";
import { validateRequest, ValidationError } from "./pipeline.js";
import { listProviders } from "./tts/index.js";
import { listSfx } from "./lib/sfx.js";
import { listImages, getImage, ensureImage, deleteImage, listStyles } from "./images/library.js";

await loadTemplates();
await restoreJobs();
setInterval(() => cleanupOldJobs().catch((e) => console.error("cleanup:", e.message)), 3600 * 1000);

const app = express();
app.use(express.json({ limit: "5mb" }));

function requireKey(req, res, next) {
  if (!config.apiKey || req.get("x-api-key") === config.apiKey) return next();
  res.status(401).json({ error: "Missing or wrong X-API-Key header" });
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// Rendered files: job IDs are random UUIDs, so links work without the API key (Instagram/n8n can fetch them).
app.get("/files/:id/:name", (req, res) => {
  const file = jobFile(req.params.id, req.params.name);
  if (!file) return res.status(404).json({ error: "Not found" });
  res.sendFile(file);
});

// Image library files and published videos (public: they end up on social media anyway)
app.use("/library", express.static(config.libraryDir, { index: false, dotfiles: "ignore" }));

// Sample images for local testing (disable with SERVE_SAMPLES=0)
if (process.env.SERVE_SAMPLES !== "0") app.use("/samples", express.static(path.join(ROOT, "samples")));

app.get("/templates", requireKey, (_req, res) => {
  res.json({ templates: describeTemplates(), ttsProviders: listProviders(), soundEffects: listSfx() });
});

app.get("/templates/:id", requireKey, (req, res) => {
  const t = describeTemplates().find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Unknown template" });
  res.json(t);
});

// Check a request without rendering it
app.post("/validate", requireKey, (req, res) => {
  try {
    const v = validateRequest(req.body);
    res.json({ ok: true, template: v.template, layout: v.layout, items: v.data.items?.length });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ ok: false, error: err.message });
    throw err;
  }
});

// Start a render. Returns 202 + job; add ?wait=true to hold the request until the video is ready.
app.post("/render", requireKey, async (req, res) => {
  let job;
  try {
    job = await createJob(req.body);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
  if (req.query.wait === "true") {
    const timeoutMs = Math.min(Number(req.query.timeout || 900), 3600) * 1000;
    const done = await waitForJob(job.id, timeoutMs);
    const status = done.status === "done" ? 200 : done.status === "failed" ? 500 : 202;
    return res.status(status).json(publicJob(done));
  }
  res.status(202).json({ ...publicJob(job), statusUrl: `${config.publicBaseUrl}/jobs/${job.id}` });
});

// Image library: list, look up, generate/import, delete
app.get("/images", requireKey, async (_req, res) => {
  res.json({ styles: listStyles(), images: await listImages() });
});

app.get("/images/:key", requireKey, async (req, res) => {
  const img = await getImage(req.params.key, req.query.style || undefined);
  if (!img) return res.status(404).json({ error: "Not in library" });
  res.json(img);
});

// Body: { key, style?, subject?, prompt?, url?, force? } — returns the existing image unless force/url
app.post("/images", requireKey, async (req, res) => {
  if (!req.body?.key) return res.status(400).json({ error: "key is required" });
  try {
    res.json(await ensureImage(req.body));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.delete("/images/:key", requireKey, async (req, res) => {
  const ok = await deleteImage(req.params.key, req.query.style || undefined);
  res.status(ok ? 200 : 404).json({ deleted: ok });
});

app.get("/jobs/:id", requireKey, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Unknown job" });
  res.json(publicJob(job));
});

app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Body is not valid JSON" });
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`reel-factory listening on :${config.port} (public URL ${config.publicBaseUrl})`);
  if (!config.apiKey) console.log("Warning: API_KEY is not set, the API is open");
});
