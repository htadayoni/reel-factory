import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { renderJob, validateRequest } from "./pipeline.js";

const JOBS_DIR = path.join(config.dataDir, "jobs");
const jobs = new Map();
const queue = [];
let active = 0;

const jobDir = (id) => path.join(JOBS_DIR, id);
const fileUrl = (id, name) => `${config.publicBaseUrl}/files/${id}/${name}`;
const libUrl = (rel) => rel && `${config.publicBaseUrl}/library/${rel.split("/").map(encodeURIComponent).join("/")}`;

async function save(job) {
  await fs.mkdir(jobDir(job.id), { recursive: true });
  await fs.writeFile(path.join(jobDir(job.id), "job.json"), JSON.stringify(job, null, 2));
}

/** What API clients (and callbacks) see. */
export function publicJob(job) {
  return {
    id: job.id,
    status: job.status, // queued | running | done | failed
    stage: job.stage,
    template: job.template,
    layout: job.layout,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    queuePosition: job.status === "queued" ? queue.indexOf(job.id) + 1 : undefined,
    // Published videos get a permanent library URL; others a job URL that expires with RETENTION_HOURS
    videoUrl: job.result ? libUrl(job.result.published?.video) || fileUrl(job.id, job.result.files.video) : undefined,
    thumbnailUrl: job.result ? libUrl(job.result.published?.thumbnail) || fileUrl(job.id, job.result.files.thumbnail) : undefined,
    images: job.result?.images,
    duration: job.result?.duration,
    renderSeconds: job.result?.renderSeconds,
    error: job.error,
    meta: job.meta,
  };
}

/** Validate and enqueue. Throws ValidationError for bad input. */
export async function createJob(body) {
  const req = validateRequest(body);
  const job = {
    id: crypto.randomUUID(),
    status: "queued",
    stage: "queued",
    template: req.template,
    layout: req.layout,
    createdAt: new Date().toISOString(),
    callbackUrl: req.callbackUrl,
    meta: req.meta,
    request: body,
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  await save(job);
  pump();
  return job;
}

export function getJob(id) {
  return jobs.get(id);
}

/** Resolves when the job finishes (used by ?wait=true). */
export function waitForJob(id, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const job = jobs.get(id);
      if (!job || job.status === "done" || job.status === "failed" || Date.now() - started > timeoutMs) return resolve(job);
      setTimeout(tick, 500);
    };
    tick();
  });
}

function pump() {
  while (active < config.concurrency && queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job) continue;
    active++;
    runJob(job).finally(() => {
      active--;
      pump();
    });
  }
}

async function runJob(job) {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  await save(job);
  const log = (msg) => console.log(`[job ${job.id.slice(0, 8)}] ${msg}`);
  try {
    const req = validateRequest(job.request);
    const result = await renderJob(req, {
      workDir: path.join(jobDir(job.id), "work"),
      outDir: path.join(jobDir(job.id), "out"),
      keepWork: process.env.KEEP_WORK === "1",
      onStage: (stage) => {
        job.stage = stage;
        log(stage);
        save(job).catch(() => {});
      },
    });
    job.result = result;
    job.status = "done";
    job.stage = "done";
    log(`done in ${result.renderSeconds.toFixed(1)}s render, video ${result.duration}s`);
  } catch (err) {
    job.status = "failed";
    job.error = err.message;
    log(`failed: ${err.message}`);
  }
  job.finishedAt = new Date().toISOString();
  await save(job);
  if (job.callbackUrl) await sendCallback(job);
}

async function sendCallback(job) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(job.callbackUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(publicJob(job)),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return;
      console.warn(`[job ${job.id.slice(0, 8)}] callback HTTP ${res.status} (attempt ${attempt})`);
    } catch (err) {
      console.warn(`[job ${job.id.slice(0, 8)}] callback failed: ${err.message} (attempt ${attempt})`);
    }
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
}

export function jobFile(id, name) {
  const job = jobs.get(id);
  if (!job?.result) return null;
  if (!Object.values(job.result.files).includes(name)) return null;
  return path.join(jobDir(id), "out", name);
}

/** Load jobs from disk at startup; re-queue the ones that never started. */
export async function restoreJobs() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  for (const id of await fs.readdir(JOBS_DIR)) {
    const file = path.join(jobDir(id), "job.json");
    if (!fsSync.existsSync(file)) continue;
    const job = JSON.parse(await fs.readFile(file, "utf8"));
    if (job.status === "running") {
      job.status = "failed";
      job.error = "Interrupted by a server restart";
      job.finishedAt = new Date().toISOString();
      await save(job);
    }
    jobs.set(job.id, job);
    if (job.status === "queued") queue.push(job.id);
  }
  pump();
}

/** Delete finished jobs older than RETENTION_HOURS. */
export async function cleanupOldJobs() {
  if (!config.retentionHours) return;
  const cutoff = Date.now() - config.retentionHours * 3600 * 1000;
  for (const job of jobs.values()) {
    if (!job.finishedAt || new Date(job.finishedAt).getTime() > cutoff) continue;
    await fs.rm(jobDir(job.id), { recursive: true, force: true });
    jobs.delete(job.id);
  }
}
