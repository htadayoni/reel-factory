import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../config.js";
import { z } from "../schemas.js";

const TEMPLATES_DIR = path.join(ROOT, "templates");
const templates = new Map();

/**
 * Load every templates/<id>/template.js. A template module default-exports:
 *   { id, name, description, size, layouts, defaultLayout, schema (zod), example,
 *     collect(data, ctx) -> { assets: {key: url}, speech: {key: text} },
 *     build(ctx) -> { html, duration, files: [{from,to}], audio: [{speech|sfx, at, volume?}], thumbnailAt } }
 */
export async function loadTemplates() {
  templates.clear();
  for (const dir of fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = path.join(TEMPLATES_DIR, dir.name, "template.js");
    if (!fs.existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file).href)).default;
    for (const key of ["id", "schema", "layouts", "collect", "build"]) {
      if (!mod?.[key]) throw new Error(`Template ${dir.name} is missing "${key}"`);
    }
    templates.set(mod.id, { ...mod, dir: path.join(TEMPLATES_DIR, dir.name) });
  }
  return templates;
}

export function getTemplate(id) {
  return templates.get(id);
}

export function describeTemplates() {
  return [...templates.values()].map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    size: t.size,
    defaultLayout: t.defaultLayout,
    layouts: Object.fromEntries(Object.entries(t.layouts).map(([k, v]) => [k, v.label || k])),
    dataSchema: z.toJSONSchema(t.schema, { io: "input", unrepresentable: "any" }),
    example: t.example,
  }));
}
