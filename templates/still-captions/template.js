import path from "node:path";
import { z, url } from "../../src/schemas.js";
import { ROOT } from "../../src/config.js";
import { slugKey } from "../../src/images/library.js";
import { esc, r3, gsapFile, logoHtml, brandedWebsite } from "../../src/templates/shared.js";

/**
 * "Still image + synced captions".
 * One picture stays on screen while a voice reads the script; the script is shown a few words at a time,
 * switching in step with the voice. Each script line is spoken as one voice clip (natural prosody, cached
 * per line), and its caption chunks share that clip's time in proportion to their length.
 * An optional closing card carries the call to action.
 *
 * Nothing here belongs to one service: colors, font, picture style, direction, call to action and disclosure
 * all come with the request. The built-in layouts are neutral defaults. Right-to-left is detected from the text.
 *
 * Markup in a line: *word or phrase* highlights it in the accent color (brand.accentColor); the asterisks are not spoken.
 */

const W = 1080;
const H = 1920;

// Bundled fallback font (Arabic-script and Latin). A request can bring its own with theme.fontUrl.
const FONTS = [
  { weight: 400, file: "Vazirmatn-Regular.woff2" },
  { weight: 500, file: "Vazirmatn-Medium.woff2" },
  { weight: 700, file: "Vazirmatn-Bold.woff2" },
  { weight: 900, file: "Vazirmatn-Black.woff2" },
];

const layouts = {
  light: {
    label: "Light (neutral)",
    bg: "#F7F7F5", text: "#1A1A1A", muted: "#6B6B6B",
    imagePanel: "transparent", ctaBg: "#F7F7F5", pillText: "#ffffff",
  },
  dark: {
    label: "Dark (neutral)",
    bg: "#101114", text: "#F5F5F5", muted: "#9A9A9A",
    imagePanel: "#ffffff", ctaBg: "#101114", pillText: "#101114",
  },
};

// Only characters a CSS color needs, so a request cannot inject styles
const cssColor = z.string().regex(/^[#\w(),.%\s-]{1,48}$/, "must be a CSS color like #aabbcc or rgb(0,0,0)");

const imageStyle = z.union([
  z.string(), // built-in id
  z.object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/, "lowercase letters, digits and dashes"),
    prompt: z.string().min(10).max(2000).refine((p) => p.includes("{subject}"), "must contain {subject}"),
    transparent: z.boolean().default(false),
    label: z.string().max(80).optional(),
  }),
]);

const schema = z
  .object({
    // One entry per spoken line (a sentence or a short paragraph). Each is one voice clip.
    lines: z.array(z.string().min(1).max(400)).min(1).max(40),
    // Picture: a URL, or a key in the image library (generated with AI on a miss, in the style below).
    image: url.optional(),
    imageKey: z.string().max(80).optional(),
    imageSubject: z.string().max(300).optional(),
    imagePrompt: z.string().max(2000).optional(),
    imageStyle: imageStyle.default("object-white"),
    theme: z
      .object({
        bg: cssColor.optional(),
        text: cssColor.optional(),
        muted: cssColor.optional(),
        imagePanel: cssColor.optional(),
        ctaBg: cssColor.optional(),
        pillText: cssColor.optional(),
        fontUrl: url.optional(), // one font file (woff2/ttf/otf) used for every weight
      })
      .prefault({}),
    dir: z.enum(["auto", "rtl", "ltr"]).default("auto"),
    lang: z.string().max(12).optional(),
    caption: z
      .object({
        maxWords: z.number().int().min(2).max(9).default(5),
        maxChars: z.number().int().min(14).max(60).default(34),
        fontSize: z.number().int().min(48).max(110).default(78),
        // Words a caption should not end on (the chunk runs one word longer instead); language specific, so the caller supplies them
        hangingWords: z.array(z.string().max(20)).max(60).default([]),
        stickyWords: z.array(z.string().max(20)).max(60).default([]), // words that stay with the word before them and never start a caption (e.g. a postposition)
      })
      .prefault({}),
    lead: z.number().min(0).max(2).default(0.4), // seconds before the first line
    gap: z.number().min(0).max(1.5).default(0.2), // pause between lines
    zoom: z.number().min(0).max(0.2).default(0.06), // slow push-in on the picture over the whole video
    cta: z
      .object({
        enabled: z.boolean().default(false),
        text: z.string().max(90).optional(),
        handle: z.string().max(40).optional(), // shown as a pill, e.g. t.me/yourchannel
        say: z.string().max(200).optional(), // optional spoken line over the closing card
        duration: z.number().min(1.5).max(10).default(3.5),
      })
      .prefault({}),
    // Small line at the bottom, e.g. a note that the voice is synthetic. Empty = hidden.
    disclosure: z.string().max(80).default(""),
    // Size in pixels of the round brand logo beside the name at the bottom.
    logoSize: z.number().min(40).max(260).default(84),
    // What the voice reads, one entry per line, when it must differ from the caption: the same words with
    // pronunciation marks (Persian short vowels, shadda). Captions always show `lines`. Same word count per line.
    speech: z.array(z.string()).optional(),
  })
  .refine((d) => d.image || d.imageKey || d.imageSubject || d.imagePrompt, {
    error: "give image, imageKey, imageSubject or imagePrompt",
  })
  .refine((d) => !d.speech || (d.speech.length === d.lines.length && d.speech.every((t, i) => plainWords(t) === plainWords(d.lines[i]))), {
    error: "speech must have one entry per line with the same number of words as that line",
  });

/** Phase 1: remote assets and voice lines. */
function collect(data, { brand }) {
  const assets = {};
  assets.main =
    data.image ||
    {
      library: {
        key: data.imageKey || slugKey(data.imageSubject || data.imagePrompt || "still"),
        subject: data.imageSubject,
        prompt: data.imagePrompt,
        style: data.imageStyle,
      },
    };
  if (brand.logo) assets.logo = brand.logo;
  if (data.theme.fontUrl) assets.font = data.theme.fontUrl;

  const speech = {};
  data.lines.forEach((l, i) => {
    speech[`s${i}`] = plain(data.speech?.[i] ?? l);
  });
  if (data.cta.enabled && data.cta.say) speech.cta = data.cta.say;
  return { assets, speech };
}

const plain = (s) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim();
const plainWords = (s) => plain(s).split(" ").length;

/* ---------- caption chunking ---------- */

const STRONG = /[،؛؟?!.:;…]$/;
const TRAIL = /[»"'’)\]]+$/;

/** Split a line into words, tracking *highlight* spans across words. */
function words(line) {
  let on = false;
  return line
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      let t = raw;
      if (t.startsWith("*")) { on = true; t = t.replace(/^\*+/, ""); }
      const hl = on;
      // a closing asterisk may be followed by punctuation: "*word*."
      if (t.includes("*")) { on = false; t = t.replace(/\*/g, ""); }
      return { t, hl };
    })
    .filter((w) => w.t)
    .map((w, i) => ({ ...w, i })); // i = position among the spoken words
}

/** Start and end character index (in code points) of each space-separated word of `text`. */
function wordSpans(text) {
  const cps = Array.from(text);
  const spans = [];
  let i = 0;
  while (i < cps.length) {
    while (i < cps.length && /\s/.test(cps[i])) i++;
    if (i >= cps.length) break;
    const s = i;
    while (i < cps.length && !/\s/.test(cps[i])) i++;
    spans.push({ s, e: i - 1 });
  }
  return spans;
}

/**
 * Captions break at punctuation first. A stretch of words longer than maxWords/maxChars is split into the fewest
 * chunks that fit and those chunks are made about equal (six words become 3+3, not 5+1), so a phrase is not cut
 * at its last word. A chunk does not end on a hanging word when moving the break by one word avoids it.
 */
function chunkWords(ws, maxWords, maxChars, hangingWords, stickyWords = []) {
  const HANGING = new Set(hangingWords);
  const STICKY = new Set(stickyWords);
  const bare = (w) => w.t.replace(TRAIL, "");
  const len = (c) => c.map((w) => w.t).join(" ").length;

  // 1. stretches between strong punctuation
  const stretches = [];
  let cur = [];
  for (const w of ws) {
    cur.push(w);
    if (STRONG.test(bare(w))) {
      stretches.push(cur);
      cur = [];
    }
  }
  if (cur.length) stretches.push(cur);

  // 2. split each long stretch evenly
  const out = [];
  for (const s of stretches) {
    const k = Math.max(Math.ceil(s.length / maxWords), Math.ceil(len(s) / maxChars), 1);
    if (k === 1) {
      out.push(s);
      continue;
    }
    const base = Math.floor(s.length / k);
    const extra = s.length % k;
    const cuts = [];
    let at = 0;
    for (let i = 0; i < k - 1; i++) {
      at += base + (i < extra ? 1 : 0);
      cuts.push(at);
    }
    // keep a hanging word with what follows it, if that stays short enough
    cuts.forEach((c, i) => {
      const last = s[c - 1];
      if (!HANGING.has(bare(last)) && !(last.t.startsWith("«") && !last.t.includes("»"))) return; // a word that opens a quote also hangs
      const from = i ? cuts[i - 1] : 0;
      const to = i + 1 < cuts.length ? cuts[i + 1] : s.length;
      if (c - 1 - from >= 1) cuts[i] = c - 1; // the hanging word moves to the next chunk
      else if (c + 1 - from <= maxWords + 1 && c + 1 < to) cuts[i] = c + 1;
    });
    // a sticky word never starts a chunk: it stays with the word before it
    cuts.forEach((c, i) => {
      const to = i + 1 < cuts.length ? cuts[i + 1] : s.length;
      if (STICKY.has(bare(s[c])) && c + 1 < to) cuts[i] = c + 1;
    });
    let from = 0;
    for (const c of [...cuts, s.length]) {
      out.push(s.slice(from, c));
      from = c;
    }
  }
  return out;
}

const weight = (c) => c.reduce((n, w) => n + w.t.replace(/[^\p{L}\p{N}]/gu, "").length + 1, 0) + (STRONG.test(c[c.length - 1].t.replace(TRAIL, "")) ? 3 : 0);

const chunkHtml = (c) => c.map((w) => (w.hl ? `<span class="hl">${esc(w.t)}</span>` : esc(w.t))).join(" ");

const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

/** Phase 2: timeline plan + composition HTML. */
function build({ data, layout, brand, assets, speech }) {
  const L = { ...layout, ...Object.fromEntries(Object.entries(data.theme).filter(([k, v]) => k !== "fontUrl" && v)) };
  const { maxWords, maxChars, fontSize, hangingWords, stickyWords } = data.caption;
  const dir = data.dir === "auto" ? (data.lines.some((l) => RTL_CHARS.test(l)) ? "rtl" : "ltr") : data.dir;
  const audio = [];
  const chunks = [];
  let t = data.lead;

  let aligned = 0;
  data.lines.forEach((line, i) => {
    const clip = speech[`s${i}`];
    const dur = clip.duration;
    audio.push({ speech: `s${i}`, at: r3(t) });
    const ws = words(line);
    const cs = chunkWords(ws, maxWords, maxChars, hangingWords, stickyWords);

    // Exact timing: the voice provider says when each character is spoken. Used only when it lines up with our words.
    const spoken = plain(data.speech?.[i] ?? line); // the text the voice read (may carry pronunciation marks)
    const al = clip.alignment;
    const spans = wordSpans(spoken);
    const exact = al && al.chars.length === Array.from(spoken).length && spans.length === ws.length;
    let starts;
    if (exact) {
      aligned++;
      starts = cs.map((c) => Math.max(0, al.starts[spans[c[0].i].s] - 0.04)); // show a hair before the word is heard
      starts[0] = 0;
    } else {
      // estimate: chunks share the clip's time in proportion to their length
      const total = cs.reduce((n, c) => n + weight(c), 0);
      let at = 0;
      starts = cs.map((c) => { const s = at; at += (weight(c) / total) * dur; return s; });
    }
    cs.forEach((c, k) => {
      const last = k === cs.length - 1;
      // each chunk stays up until the next starts; the last one through the pause, so the caption never flickers empty
      chunks.push({ html: chunkHtml(c), start: r3(t + starts[k]), end: r3(last ? t + dur + data.gap : t + starts[k + 1]) });
    });
    t += dur + data.gap;
  });

  const speechEnd = t - data.gap;
  const hasCta = data.cta.enabled;
  const ctaStart = hasCta ? speechEnd + 0.35 : null;
  const ctaDur = hasCta ? Math.max(data.cta.duration, (speech.cta?.duration ?? 0) + 1.2) : 0;
  if (hasCta && speech.cta) audio.push({ speech: "cta", at: r3(ctaStart + 0.5) });
  const duration = r3(hasCta ? ctaStart + ctaDur : speechEnd + 0.8);
  if (hasCta) chunks.forEach((c) => { c.end = Math.min(c.end, ctaStart); });

  const files = [
    gsapFile,
    ...FONTS.map((f) => ({ from: path.join(ROOT, "assets", "fonts", f.file), to: `assets/fonts/${f.file}` })),
  ];
  const fallbackCss = FONTS.map(
    (f) => `@font-face{font-family:"Fallback";font-style:normal;font-weight:${f.weight};font-display:block;src:url("assets/fonts/${f.file}") format("woff2");}`,
  ).join("\n");
  const customCss = assets.font
    ? [400, 500, 700, 900].map((w) => `@font-face{font-family:"Custom";font-style:normal;font-weight:${w};font-display:block;src:url("${esc(assets.font)}");}`).join("\n")
    : "";
  const family = assets.font ? `"Custom","Fallback",sans-serif` : `"Fallback",sans-serif`;

  const accent = brand.accentColor;
  const chunkEls = chunks.map((c, i) => `<div class="chunk" id="c${i}"><div class="t">${c.html}</div></div>`).join("");
  const plan = {
    chunks: chunks.map((c) => ({ start: c.start, end: c.end })), ctaStart, duration, zoom: data.zoom,
    timing: `${aligned}/${data.lines.length} lines aligned to the voice`, // the rest are estimated
  };

  const foot = data.disclosure ? `<div class="disc">${esc(data.disclosure)}</div>` : "";
  const handle = data.cta.handle ? `<div class="cta-handle" id="cta-handle"><span>${esc(data.cta.handle)}</span></div>` : "";
  const ctaHtml = hasCta
    ? `<section class="cta clip" id="cta" data-start="${r3(ctaStart)}" data-duration="${r3(duration - ctaStart)}" data-track-index="2">
        <div class="cta-logo" id="cta-logo">${logoHtml(brand, assets, 150)}</div>
        ${data.cta.text ? `<div class="cta-text" id="cta-text">${esc(data.cta.text)}</div>` : ""}
        ${handle}
        ${foot}
      </section>`
    : "";

  const html = `<!doctype html>
<html lang="${esc(data.lang || "und")}" dir="${dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${W}, height=${H}">
<title>still-captions</title>
<script src="assets/gsap.min.js"></script>
<style>
${fallbackCss}
${customCss}
:root{--text:${L.text};--muted:${L.muted};--accent:${accent}}
html,body{margin:0;background:${L.bg}}
body{font-family:${family};color:var(--text);direction:${dir}}
#root{position:relative;width:100%;height:100%;overflow:hidden;background:${L.bg}}
.caption{position:absolute;left:70px;right:70px;top:230px;height:300px}
.chunk{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0}
.t{width:100%;text-align:center;font-weight:900;font-size:${fontSize}px;line-height:1.55}
.hl{color:var(--accent)}
.imgbox{position:absolute;left:140px;width:800px;top:565px;height:800px;border-radius:40px;background:${L.imagePanel};overflow:hidden}
.imgbox img{width:100%;height:100%;object-fit:cover;display:block;transform-origin:50% 50%}
.brand{position:absolute;left:0;right:0;top:1415px;display:flex;align-items:center;justify-content:center;gap:22px;direction:ltr}
.brand .name{font-weight:700;font-size:38px;color:var(--text);direction:${dir}}
.brand .site{font-weight:500;font-size:28px;color:var(--muted);direction:ltr}
.brand .col{display:flex;flex-direction:column;align-items:flex-start;gap:2px}
.disc{position:absolute;left:0;right:0;top:1530px;text-align:center;font-weight:400;font-size:26px;color:var(--muted)}
.cta{position:absolute;inset:0;background:${L.ctaBg}}
.cta-logo{position:absolute;left:0;right:0;top:560px;display:flex;justify-content:center}
.cta-text{position:absolute;left:100px;right:100px;top:790px;text-align:center;font-weight:900;font-size:74px;line-height:1.6}
.cta-handle{position:absolute;left:0;right:0;top:1030px;display:flex;justify-content:center}
.cta-handle span{display:inline-block;direction:ltr;unicode-bidi:isolate;background:var(--accent);color:${L.pillText};font-weight:700;font-size:44px;padding:16px 44px;border-radius:60px}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${duration}">
  <div class="caption" id="caption">${chunkEls}</div>
  <div class="imgbox" id="imgbox"><img id="pic" src="${esc(assets.main)}" alt=""></div>
  <div class="brand">${logoHtml(brand, assets, data.logoSize)}<div class="col"><span class="name">${esc(brand.name)}</span>${brand.website ? `<span class="site">${brandedWebsite(brand)}</span>` : ""}</div></div>
  ${foot}
  ${ctaHtml}
  <audio id="soundtrack" src="assets/soundtrack.wav" data-start="0" data-duration="${duration}" data-track-index="5" data-volume="1"></audio>
</div>
<script>
const PLAN = ${JSON.stringify(plan)};
function fit(el, box) {
  let size = parseFloat(getComputedStyle(el).fontSize);
  const min = size * 0.55;
  while (el.offsetHeight > box.clientHeight && size > min) { size -= 2; el.style.fontSize = size + "px"; }
}
function buildTimeline() {
  const box = document.getElementById("caption");
  const tl = gsap.timeline({ paused: true });
  PLAN.chunks.forEach((c, i) => {
    const el = document.getElementById("c" + i);
    fit(el.querySelector(".t"), box);
    tl.fromTo(el, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.14, ease: "power2.out" }, c.start);
    tl.set(el, { opacity: 0 }, c.end);
  });
  tl.fromTo("#imgbox", { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power1.out" }, 0);
  if (PLAN.zoom > 0) tl.fromTo("#pic", { scale: 1 }, { scale: 1 + PLAN.zoom, duration: PLAN.duration, ease: "none" }, 0);
  if (PLAN.ctaStart !== null) {
    const s = PLAN.ctaStart;
    tl.fromTo("#cta", { opacity: 0 }, { opacity: 1, duration: 0.35 }, s);
    tl.fromTo("#cta-logo", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, s + 0.1);
    if (document.getElementById("cta-text")) tl.fromTo("#cta-text", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, s + 0.25);
    if (document.getElementById("cta-handle")) tl.fromTo("#cta-handle", { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.6)" }, s + 0.5);
  }
  window.__timelines["main"] = tl;
}
document.fonts.ready.then(buildTimeline);
</script>
</body>
</html>
`;

  return { html, duration, files, audio, thumbnailAt: r3(Math.min(duration - 0.1, (chunks[0]?.start ?? 0) + 0.8)) };
}

const example = {
  template: "still-captions",
  layout: "light",
  brand: { name: "Your Brand", website: "example.com", primaryColor: "#1A1A1A", accentColor: "#2B6CB0" },
  voice: { provider: "piper", voice: "en_US-lessac-medium" },
  data: {
    lines: ["Here is a *simple idea* worth keeping.", "One picture, a few words at a time."],
    imageSubject: "a lighthouse on a calm sea",
    imageStyle: {
      id: "flat-calm",
      prompt: "Flat illustration, soft colors, plain light background. Subject: {subject}. No text, no letters, no logos.",
    },
    theme: { bg: "#FAFAF7" },
    cta: { enabled: true, text: "Read more", handle: "example.com" },
  },
};

export default {
  id: "still-captions",
  name: "Still image + synced captions",
  description: "One picture stays on screen while the voice reads the script; captions follow a few words at a time (direction detected from the text), then an optional call-to-action card. Theme, font, picture style and texts all come with the request.",
  size: { width: W, height: H },
  layouts,
  defaultLayout: "light",
  schema,
  example,
  collect,
  build,
};
