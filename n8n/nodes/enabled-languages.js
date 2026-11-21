// Keep the languages whose "Enabled" column is not FALSE/no/0; one item per language tab to read.
const off = new Set(['false', 'no', '0', 'off']);
const wanted = $('Config').first().json.sheet;
return $input.all().filter((item) => {
  const lang = item.json;
  if (!lang.Sheet) return false;
  if (wanted) return String(lang.Sheet).trim().toLowerCase() === String(wanted).trim().toLowerCase();
  return !off.has(String(lang.Enabled ?? '').trim().toLowerCase());
});
