#!/usr/bin/env node
// Assembles the n8n workflow JSON from n8n/nodes/*.js (edit the JS, then run: node n8n/build-workflows.mjs).
//   n8n/sheet-to-reel.workflow.json          real workflow (Google Sheets)
//   n8n/test/sheet-to-reel.test.workflow.json same logic, Google Sheets replaced by fixtures + a capture URL
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const code = (name) => fs.readFileSync(path.join(DIR, "nodes", `${name}.js`), "utf8");

let n = 0;
const id = () => `9a3e5c10-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters, id: id(), name, type, typeVersion, position, ...extra,
});
const codeNode = (name, file, position, extra) =>
  node(name, "n8n-nodes-base.code", 2, position, { jsCode: code(file) }, extra);

const SHEETS_CRED = { googleSheetsOAuth2Api: { id: "4nxtAIdhOUZnz1b9", name: "Google Sheets account" } };
const API_CRED = { httpHeaderAuth: { id: "rfApiKeyLocal001", name: "Reel Factory API key" } };
const docId = { __rl: true, value: "={{ $('Config').first().json.spreadsheetId }}", mode: "id" };

const sheetsRead = (name, sheet, position, extra = {}) =>
  node(name, "n8n-nodes-base.googleSheets", 4.7, position, {
    operation: "read",
    documentId: docId,
    sheetName: { __rl: true, value: sheet, mode: "name" },
    options: {},
  }, { credentials: SHEETS_CRED, ...extra });

// Update the picked row: input items are { row_number, <Column>: value, ... }
const sheetsUpdate = (name, position) =>
  node(name, "n8n-nodes-base.googleSheets", 4.7, position, {
    operation: "update",
    documentId: docId,
    sheetName: { __rl: true, value: "={{ $('Pick next row').first().json.sheet }}", mode: "name" },
    columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: ["row_number"], schema: [] },
    options: { handlingExtraData: "ignoreIt" },
  }, { credentials: SHEETS_CRED });

const ifNode = (name, position, leftValue, operator, rightValue) =>
  node(name, "n8n-nodes-base.if", 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
      conditions: [{ id: id(), leftValue, rightValue, operator }],
      combinator: "and",
    },
    options: {},
  });

function workflow({ test }) {
  n = 0;
  const nodes = [
    node("Every hour", "n8n-nodes-base.scheduleTrigger", 1.2, [0, -200], { rule: { interval: [{ field: "hours" }] } }),
    node("Start (manual)", "n8n-nodes-base.manualTrigger", 1, [0, 0], {}),
    node("Render a row (webhook)", "n8n-nodes-base.webhook", 2, [0, 200], {
      httpMethod: "POST", path: test ? "reel-factory/sheet-render-test" : "reel-factory/sheet-render", responseMode: "onReceived", options: {},
    }, { webhookId: test ? "4d1f7a2b-8c3e-4f5a-9b6c-0d1e2f3a4b5d" : "4d1f7a2b-8c3e-4f5a-9b6c-0d1e2f3a4b5c" }),
    codeNode("Config", "config", [240, 0]),
  ];

  if (test) {
    const fx = JSON.parse(fs.readFileSync(path.join(DIR, "test", "fixtures.json"), "utf8"));
    const rows = (list) => JSON.stringify(list.map((r, i) => ({ row_number: i + 2, ...r })));
    nodes.push(
      node("Read Brand", "n8n-nodes-base.code", 2, [480, 0], { jsCode: `return ${rows(fx.Brand)}.map((json) => ({ json }));` }),
      node("Read Languages", "n8n-nodes-base.code", 2, [720, 0], { jsCode: `return ${rows(fx.Languages)}.map((json) => ({ json }));` }),
    );
    const tabs = Object.fromEntries(Object.entries(fx.Tabs).map(([k, v]) => [k, JSON.parse(rows(v))]));
    nodes.push(node("Read language tab", "n8n-nodes-base.code", 2, [1200, 0], {
      jsCode: `const tabs = ${JSON.stringify(tabs)};\nreturn $input.all().flatMap((item, i) => (tabs[item.json.Sheet] || []).map((json) => ({ json, pairedItem: { item: i } })));`,
    }));
    const capture = (name, position) => node(name, "n8n-nodes-base.httpRequest", 4.2, position, {
      method: "POST", url: "http://localhost:3095/sheet-update", sendBody: true, specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ sheet: $('Pick next row').first().json.sheet, ...$json }) }}", options: {},
    });
    nodes.push(capture("Mark rendering", [2160, 0]), capture("Save result", [3360, 0]));
  } else {
    nodes.push(
      sheetsRead("Read Brand", "Brand", [480, 0]),
      sheetsRead("Read Languages", "Languages", [720, 0], { executeOnce: true }),
      sheetsRead("Read language tab", "={{ $json.Sheet }}", [1200, 0]),
      sheetsUpdate("Mark rendering", [2160, 0]),
      sheetsUpdate("Save result", [3360, 0]),
    );
  }

  nodes.push(
    codeNode("Enabled languages", "enabled-languages", [960, 0]),
    codeNode("Pick next row", "pick-row", [1440, 0]),
    codeNode("Build render request", "build-request", [1680, 0]),
    codeNode("Row status", "status-update", [1920, 0]),
    ifNode("Built OK?", [2400, 0], "={{ $('Build render request').first().json.ok }}",
      { type: "boolean", operation: "true", singleValue: true }, ""),
    node("Start render", "n8n-nodes-base.httpRequest", 4.2, [2640, -100], {
      method: "POST",
      url: "={{ $('Build render request').first().json.renderer }}/render",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ ...$('Build render request').first().json.request, callbackUrl: $execution.resumeUrl }) }}",
      options: { response: { response: { fullResponse: true, neverError: true } } },
    }, { credentials: API_CRED }),
    ifNode("Render accepted?", [2880, -100], "={{ $json.statusCode }}", { type: "number", operation: "equals" }, 202),
    node("Wait for video", "n8n-nodes-base.wait", 1.1, [3120, -200], {
      resume: "webhook", httpMethod: "POST", limitWaitTime: true, limitType: "afterTimeInterval",
      resumeAmount: 30, resumeUnit: "minutes", options: {},
    }, { webhookId: test ? "7e2a9c4d-1b3f-4e5a-8c6d-9f0a1b2c3d4f" : "7e2a9c4d-1b3f-4e5a-8c6d-9f0a1b2c3d4e" }),
    codeNode("Result fields", "result-fields", [3360, -200]),
    codeNode("Fail if render failed", "fail-if-failed", [3600, 0]),
  );
  // "Save result" sits after "Result fields"
  nodes.find((x) => x.name === "Save result").position = [3600, -200];
  nodes.find((x) => x.name === "Fail if render failed").position = [3840, -200];

  const to = (name, index = 0) => ({ node: name, type: "main", index });
  const connections = {
    "Every hour": { main: [[to("Config")]] },
    "Start (manual)": { main: [[to("Config")]] },
    "Render a row (webhook)": { main: [[to("Config")]] },
    Config: { main: [[to("Read Brand")]] },
    "Read Brand": { main: [[to("Read Languages")]] },
    "Read Languages": { main: [[to("Enabled languages")]] },
    "Enabled languages": { main: [[to("Read language tab")]] },
    "Read language tab": { main: [[to("Pick next row")]] },
    "Pick next row": { main: [[to("Build render request")]] },
    "Build render request": { main: [[to("Row status")]] },
    "Row status": { main: [[to("Mark rendering")]] },
    "Mark rendering": { main: [[to("Built OK?")]] },
    "Built OK?": { main: [[to("Start render")], [to("Fail if render failed")]] },
    "Start render": { main: [[to("Render accepted?")]] },
    "Render accepted?": { main: [[to("Wait for video")], [to("Result fields")]] },
    "Wait for video": { main: [[to("Result fields")]] },
    "Result fields": { main: [[to("Save result")]] },
    "Save result": { main: [[to("Fail if render failed")]] },
  };

  return {
    id: test ? "rfSheetReelTest1" : "rfSheetToReel001",
    name: test ? "Reel Factory – sheet to reel (TEST, fixtures)" : "Reel Factory – sheet to reel",
    nodes,
    connections,
    settings: { executionOrder: "v1" },
    active: false,
  };
}

// In test mode "Read Languages" is a Code node; executeOnce matters only for the real Sheets node.
fs.writeFileSync(path.join(DIR, "sheet-to-reel.workflow.json"), JSON.stringify(workflow({ test: false }), null, 2));
fs.writeFileSync(path.join(DIR, "test", "sheet-to-reel.test.workflow.json"), JSON.stringify(workflow({ test: true }), null, 2));
console.log("Wrote n8n/sheet-to-reel.workflow.json and n8n/test/sheet-to-reel.test.workflow.json");
