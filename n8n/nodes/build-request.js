// Turn the picked row into a reel-factory render request. Never throws: on a problem it returns
// { ok: false, error } so the row is marked "failed" with the reason.
const { sheet, row, language: lang, brand, renderer } = $input.first().json;
const s = (v) => (v === undefined || v === null ? '' : String(v).trim());

function deepMerge(a, b) {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v);
  return out;
}
const slug = (v) => s(v).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// One builder per template: how the sheet columns become template data.
const builders = {
  'vocab-quiz': () => {
    const items = s(row.Vocabs)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [word, ipa, imageKey, imagePrompt] = line.split('|').map((p) => p.trim());
        const item = { word };
        if (ipa) item.ipa = ipa;
        if (imageKey) item.imageKey = imageKey;
        if (imagePrompt) item.imagePrompt = imagePrompt;
        return item;
      });
    if (!items.length) throw new Error('Vocabs is empty (one per line: word | IPA | image key)');
    const cta = {
      headline: s(lang['CTA headline']) || undefined,
      subheadline: s(lang['CTA subheadline']) || undefined,
      buttonText: s(lang['CTA button']) || undefined,
      footerText: s(lang['CTA footer']) || undefined,
      image: s(brand.ctaImage) || undefined,
    };
    return {
      title: s(row.Title) || s(lang['Question title']) || undefined,
      flag: s(lang.Flag).toLowerCase() || undefined,
      items,
      engagement: { enabled: true, text: s(lang['Comment prompt']) || undefined },
      cta,
    };
  },
};

try {
  const template = s(row.Template) || s(brand.defaultTemplate) || 'vocab-quiz';
  const build = builders[template];
  if (!build) throw new Error(`No sheet mapping for template "${template}" yet`);

  const name = s(row['Published name']) || s(row.ID);
  if (!name) throw new Error('Published name is empty');

  let request = {
    template,
    layout: s(row.Layout) || s(brand.defaultLayout) || undefined,
    brand: {
      name: s(brand.name) || undefined,
      website: s(brand.website) || undefined,
      logo: s(brand.logo) || undefined,
      primaryColor: s(brand.primaryColor) || undefined,
      accentColor: s(brand.accentColor) || undefined,
      wordmark: s(brand.wordmark) ? s(brand.wordmark).split(',').map((p) => p.trim()).filter(Boolean) : undefined,
    },
    voice: { provider: s(lang['Voice provider']) || undefined, voice: s(lang.Voice) || undefined },
    output: { quality: s(brand.quality) || 'standard', name: name.replace(/\s+/g, '-'), folder: s(lang['Video folder']) || slug(sheet) },
    data: build(),
    meta: { sheet, id: s(row.ID), rowNumber: row.row_number },
  };

  const options = s(row['Options (JSON)']);
  if (options) {
    let parsed;
    try {
      parsed = JSON.parse(options);
    } catch (e) {
      throw new Error(`Options (JSON) is not valid JSON: ${e.message}`);
    }
    request = deepMerge(request, parsed);
  }
  // Drop undefined values so the renderer's defaults apply
  request = JSON.parse(JSON.stringify(request));
  return [{ json: { ok: true, request, renderer } }];
} catch (e) {
  return [{ json: { ok: false, error: e.message, renderer } }];
}
