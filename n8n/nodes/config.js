// ── Settings for this workflow ─────────────────────────────────────────────
// Google Sheet with the language tabs (the long ID in its URL)
const SPREADSHEET_ID = '11saBfyb7nnLA9OE5OCebVTGsCHQ2slrig6jbNJPxDrE';
// Renderer URL. On the VPS this is the docker service; locally set REEL_FACTORY_URL.
let renderer = 'http://reel-factory:3077';
try { renderer = $env.REEL_FACTORY_URL || renderer; } catch (e) { /* env access blocked */ }
// ───────────────────────────────────────────────────────────────────────────

// The webhook trigger can ask for one row: POST {"sheet": "German", "id": "DE-001"}
const body = $input.first().json.body ?? {};
return [{ json: { spreadsheetId: SPREADSHEET_ID, renderer, sheet: body.sheet ?? null, id: body.id ?? null } }];
