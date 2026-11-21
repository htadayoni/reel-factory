import { spawn } from "node:child_process";
import { config } from "../config.js";

/** Run a command, resolve with { stdout, stderr }; reject with a readable error on non-zero exit. */
export function run(cmd, args, { cwd, input, timeoutMs = 10 * 60 * 1000, env, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    const collect = (chunk, which) => {
      const s = chunk.toString();
      if (which === "out") stdout += s;
      else stderr += s;
      if (onLine) s.split(/\r?\n/).filter(Boolean).forEach((l) => onLine(l));
    };
    child.stdout.on("data", (c) => collect(c, "out"));
    child.stderr.on("data", (c) => collect(c, "err"));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start ${cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const tail = (stderr || stdout).trim().split("\n").slice(-15).join("\n");
      reject(new Error(`${cmd} exited with code ${code}\n${tail}`));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** Media duration in seconds. */
export async function probeDuration(file) {
  const { stdout } = await run(config.ffprobeBin, [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`Could not read duration of ${file}`);
  return d;
}
