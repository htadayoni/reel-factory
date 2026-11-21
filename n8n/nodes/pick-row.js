// Choose the row to render: the "ready" row with the earliest Publish date across all language tabs,
// or the row given by the webhook ({sheet, id}). Outputs nothing when there is no work.
const cfg = $('Config').first().json;

function parseDate(v) {
  if (v === null || v === undefined || v === '') return Infinity;
  if (typeof v === 'number') return Math.round((v - 25569) * 86400000); // Sheets serial date
  const t = Date.parse(String(v).trim().replace(' ', 'T'));
  return Number.isNaN(t) ? Infinity : t;
}

const rows = $input.all().map((item, i) => ({
  row: item.json,
  language: $('Enabled languages').itemMatching(i).json,
}));

let candidates;
if (cfg.id) {
  candidates = rows.filter((r) => String(r.row.ID).trim() === String(cfg.id).trim());
  candidates = candidates.filter((r) => String(r.row.Status).trim().toLowerCase() !== 'rendering');
} else {
  candidates = rows.filter((r) => String(r.row.Status ?? '').trim().toLowerCase() === 'ready');
}
if (!candidates.length) return [];

candidates.sort((a, b) => parseDate(a.row['Publish date']) - parseDate(b.row['Publish date']));
const { row, language } = candidates[0];

const brand = {};
for (const { json } of $('Read Brand').all()) {
  if (json.Key) brand[String(json.Key).trim()] = json.Value === undefined ? '' : String(json.Value).trim();
}

return [{ json: { sheet: language.Sheet, rowNumber: row.row_number, id: row.ID, row, language, brand, renderer: cfg.renderer } }];
