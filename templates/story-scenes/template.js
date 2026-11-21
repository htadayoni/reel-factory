import path from "node:path";
import { z, url } from "../../src/schemas.js";
import { ROOT } from "../../src/config.js";
import { esc, r3, gsapFile } from "../../src/templates/shared.js";

/**
 * "Story scenes": a narrated story told scene by scene.
 * Each scene is one spoken line over a full-screen picture (slow push-in), or over a card (a big number, a rule,
 * a quote) when it has no picture. Captions follow the voice a few words at a time. Optional pieces: a small tag
 * in the corner (e.g. "story"), a series line, and a bar of stats at the top whose values can change per scene.
 * A closing card carries the call to action.
 *
 * Nothing here belongs to one client: colors, font, texts, stats and pictures all come with the request.
 * Right-to-left is detected from the text.
 */

const W = 1080;
const H = 1920;

const FONTS = [
  { weight: 400, file: "Vazirmatn-Regular.woff2" },
  { weight: 500, file: "Vazirmatn-Medium.woff2" },
  { weight: 700, file: "Vazirmatn-Bold.woff2" },
  { weight: 900, file: "Vazirmatn-Black.woff2" },
];

const layouts = {
  night: { label: "Night (neutral dark)", bg: "#0b1220", text: "#F5F5F2", muted: "#AAB2C0", card: "#0f1a2e", bar: "rgba(8,12,22,.72)" },
  light: { label: "Light (neutral)", bg: "#F5F2EC", text: "#1A1A1A", muted: "#6B6B6B", card: "#EFE9DE", bar: "rgba(255,255,255,.8)" },
};

const cssColor = z.string().regex(/^[#\w(),.%\s-]{1,48}$/, "must be a CSS color");

const scene = z.object({
  text: z.string().min(1).max(400), // caption and voice line; *word* highlights in the accent color
  speech: z.string().max(600).optional(), // what the voice reads when it differs (pronunciation marks); same word count
  image: url.optional(), // full-screen picture; without one the scene is a card
  card: z
    .object({
      big: z.string().max(40), // e.g. "۴۳٪", "۰", "قانون ۱"
      small: z.string().max(160).optional(),
      source: z.string().max(80).optional(), // shown small under the card
    })
    .optional(),
  label: z.string().max(40).optional(), // a short word shown over the picture (e.g. what a symbol stands for)
  stats: z.array(z.string().max(24)).max(4).optional(), // values for the stat bar from this scene on
  pause: z.number().min(0).max(2).optional(), // extra silence after this line
});

const schema = z
  .object({
    scenes: z.array(scene).min(1).max(30),
    statLabels: z.array(z.string().max(24)).max(4).default([]),
    tag: z.string().max(24).default(""),
    series: z.string().max(60).default(""),
    theme: z
      .object({ bg: cssColor.optional(), text: cssColor.optional(), muted: cssColor.optional(), card: cssColor.optional(), bar: cssColor.optional(), fontUrl: url.optional() })
      .prefault({}),
    dir: z.enum(["auto", "rtl", "ltr"]).default("auto"),
    lang: z.string().max(12).optional(),
    caption: z
      .object({
        maxWords: z.number().int().min(2).max(9).default(4),
        maxChars: z.number().int().min(14).max(60).default(28),
        fontSize: z.number().int().min(48).max(110).default(74),
        hangingWords: z.array(z.string().max(20)).max(60).default([]),
        stickyWords: z.array(z.string().max(20)).max(60).default([]),
      })
      .prefault({}),
    lead: z.number().min(0).max(2).default(0.3),
    gap: z.number().min(0).max(1.5).default(0.25),
    zoom: z.number().min(0).max(0.25).default(0.08), // push-in on each picture over its scene
    // "full": pictures fill the screen, captions low with a shadow. "framed": pictures are shown whole (contain) on the
    // background colour, captions sit in a pill near the top — for pictures that carry their own frame.
    // "soft": every picture fills the same centred 2:3 box and fades out at its edges into the background colour;
    // captions sit in a pill near the top — every scene keeps the same size whatever the picture's own shape.
    look: z.enum(["full", "framed", "soft"]).default("full"),
    captionInk: cssColor.optional(), // caption text colour in the framed look (pill background is theme.card)
    cta: z
      .object({
        enabled: z.boolean().default(false),
        text: z.string().max(120).optional(),
        small: z.string().max(120).optional(),
        handle: z.string().max(40).optional(),
        say: z.string().max(300).optional(),
        saySpeech: z.string().max(400).optional(),
        duration: z.number().min(1.5).max(10).default(3.5),
      })
      .prefault({}),
  })
  .refine((d) => d.scenes.every((s) => s.image || s.card), { error: "every scene needs an image or a card" })
  .refine((d) => d.scenes.every((s) => !s.speech || plainWords(s.speech) === plainWords(s.text)), {
    error: "a scene's speech must have the same number of words as its text",
  });

function collect(data) {
  const assets = {};
  data.scenes.forEach((s, i) => { if (s.image) assets[`img${i}`] = s.image; });
  if (data.theme.fontUrl) assets.font = data.theme.fontUrl;
  const speech = {};
  data.scenes.forEach((s, i) => { speech[`s${i}`] = plain(s.speech ?? s.text); });
  if (data.cta.enabled && data.cta.say) speech.cta = plain(data.cta.saySpeech ?? data.cta.say);
  return { assets, speech };
}

const plain = (s) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim();
const plainWords = (s) => plain(s).split(" ").length;

/* ---------- caption chunking (same rules as still-captions) ---------- */

const STRONG = /[،؛؟?!.:;…]$/;
const TRAIL = /[»"'’)\]]+$/;

function words(line) {
  let on = false;
  return line.split(/\s+/).filter(Boolean).map((raw) => {
    let t = raw;
    if (t.startsWith("*")) { on = true; t = t.replace(/^\*+/, ""); }
    const hl = on;
    if (t.includes("*")) { on = false; t = t.replace(/\*/g, ""); }
    return { t, hl };
  }).filter((w) => w.t).map((w, i) => ({ ...w, i }));
}

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

function chunkWords(ws, maxWords, maxChars, hangingWords, stickyWords = []) {
  const HANGING = new Set(hangingWords);
  const STICKY = new Set(stickyWords);
  const bare = (w) => w.t.replace(TRAIL, "");
  const len = (c) => c.map((w) => w.t).join(" ").length;
  const stretches = [];
  let cur = [];
  for (const w of ws) { cur.push(w); if (STRONG.test(bare(w))) { stretches.push(cur); cur = []; } }
  if (cur.length) stretches.push(cur);
  const out = [];
  for (const s of stretches) {
    const k = Math.max(Math.ceil(s.length / maxWords), Math.ceil(len(s) / maxChars), 1);
    if (k === 1) { out.push(s); continue; }
    const base = Math.floor(s.length / k);
    const extra = s.length % k;
    const cuts = [];
    let at = 0;
    for (let i = 0; i < k - 1; i++) { at += base + (i < extra ? 1 : 0); cuts.push(at); }
    cuts.forEach((c, i) => {
      const last = s[c - 1];
      if (!HANGING.has(bare(last)) && !(last.t.startsWith("«") && !last.t.includes("»"))) return;
      const from = i ? cuts[i - 1] : 0;
      const to = i + 1 < cuts.length ? cuts[i + 1] : s.length;
      if (c - 1 - from >= 1) cuts[i] = c - 1;
      else if (c + 1 - from <= maxWords + 1 && c + 1 < to) cuts[i] = c + 1;
    });
    cuts.forEach((c, i) => {
      const to = i + 1 < cuts.length ? cuts[i + 1] : s.length;
      if (STICKY.has(bare(s[c])) && c + 1 < to) cuts[i] = c + 1;
    });
    let from = 0;
    for (const c of [...cuts, s.length]) { out.push(s.slice(from, c)); from = c; }
  }
  return out;
}

const weight = (c) => c.reduce((n, w) => n + w.t.replace(/[^\p{L}\p{N}]/gu, "").length + 1, 0) + (STRONG.test(c[c.length - 1].t.replace(TRAIL, "")) ? 3 : 0);
const chunkHtml = (c) => c.map((w) => (w.hl ? `<span class="hl">${esc(w.t)}</span>` : esc(w.t))).join(" ");
const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

function build({ data, layout, brand, assets, speech }) {
  const L = { ...layout, ...Object.fromEntries(Object.entries(data.theme).filter(([k, v]) => k !== "fontUrl" && v)) };
  const { maxWords, maxChars, fontSize, hangingWords, stickyWords } = data.caption;
  const dir = data.dir === "auto" ? (data.scenes.some((s) => RTL_CHARS.test(s.text)) ? "rtl" : "ltr") : data.dir;
  const audio = [];
  const chunks = [];
  const scenesPlan = [];
  let t = data.lead;
  let aligned = 0;
  let stats = data.statLabels.map(() => "");

  data.scenes.forEach((sc, i) => {
    const clip = speech[`s${i}`];
    const dur = clip.duration;
    const start = i === 0 ? 0 : t;
    audio.push({ speech: `s${i}`, at: r3(t) });
    const ws = words(sc.text);
    const cs = chunkWords(ws, maxWords, maxChars, hangingWords, stickyWords);
    const spoken = plain(sc.speech ?? sc.text);
    const al = clip.alignment;
    const spans = wordSpans(spoken);
    const exact = al && al.chars.length === Array.from(spoken).length && spans.length === ws.length;
    let starts;
    if (exact) {
      aligned++;
      starts = cs.map((c) => Math.max(0, al.starts[spans[c[0].i].s] - 0.04));
      starts[0] = 0;
    } else {
      const total = cs.reduce((n, c) => n + weight(c), 0);
      let at = 0;
      starts = cs.map((c) => { const s = at; at += (weight(c) / total) * dur; return s; });
    }
    const after = data.gap + (sc.pause ?? 0);
    cs.forEach((c, k) => {
      const last = k === cs.length - 1;
      chunks.push({ html: chunkHtml(c), start: r3(t + starts[k]), end: r3(last ? t + dur + after : t + starts[k + 1]) });
    });
    if (sc.stats) stats = data.statLabels.map((_, j) => sc.stats[j] ?? stats[j]);
    t += dur + after;
    scenesPlan.push({ i, start: r3(start), end: r3(t), image: sc.image ? assets[`img${i}`] : null, card: sc.card || null, label: sc.label || null, stats: [...stats] });
  });

  const speechEnd = t;
  const hasCta = data.cta.enabled;
  const ctaStart = hasCta ? speechEnd + 0.1 : null;
  const ctaDur = hasCta ? Math.max(data.cta.duration, (speech.cta?.duration ?? 0) + 1.2) : 0;
  if (hasCta && speech.cta) audio.push({ speech: "cta", at: r3(ctaStart + 0.4) });
  const duration = r3(hasCta ? ctaStart + ctaDur : speechEnd + 0.6);
  scenesPlan[scenesPlan.length - 1].end = hasCta ? r3(ctaStart + 0.4) : duration;
  if (hasCta) chunks.forEach((c) => { c.end = Math.min(c.end, ctaStart); });

  const files = [gsapFile, ...FONTS.map((f) => ({ from: path.join(ROOT, "assets", "fonts", f.file), to: `assets/fonts/${f.file}` }))];
  const fallbackCss = FONTS.map((f) => `@font-face{font-family:"Fallback";font-weight:${f.weight};font-display:block;src:url("assets/fonts/${f.file}") format("woff2");}`).join("\n");
  const customCss = assets.font ? [400, 500, 700, 900].map((w) => `@font-face{font-family:"Custom";font-weight:${w};font-display:block;src:url("${esc(assets.font)}");}`).join("\n") : "";
  const family = assets.font ? `"Custom","Fallback",sans-serif` : `"Fallback",sans-serif`;
  const accent = brand.accentColor;

  const sceneEls = scenesPlan.map((s) => s.image
    ? `<div class="scene" id="sc${s.i}"><img class="pic" id="pic${s.i}" src="${esc(s.image)}" alt=""><div class="shade"></div>${s.label ? `<div class="label" id="lab${s.i}"><span>${esc(s.label)}</span></div>` : ""}</div>`
    : `<div class="scene card" id="sc${s.i}"><div class="cardbox">
        <div class="big${/^[«»"“”❝❞]+$/.test(s.card.big) ? " mark" : ""}" id="big${s.i}">${esc(s.card.big)}</div>
        ${s.card.small ? `<div class="small" id="small${s.i}">${esc(s.card.small)}</div>` : ""}
        ${s.card.source ? `<div class="src">${esc(s.card.source)}</div>` : ""}
      </div><div class="shade"></div></div>`).join("");

  // stat bar: one cell per label; a value cell per scene state, faded in when it changes
  const statStates = [];
  scenesPlan.forEach((s) => {
    const prev = statStates[statStates.length - 1];
    if (!prev || prev.values.join("|") !== s.stats.join("|")) statStates.push({ at: s.start, values: s.stats });
  });
  const statBar = data.statLabels.length
    ? `<div class="stats">${data.statLabels.map((lab, j) => `<div class="stat"><div class="lab">${esc(lab)}</div><div class="vals">${statStates.map((st, k) => `<div class="val" id="v${j}_${k}">${esc(st.values[j] || "")}</div>`).join("")}</div></div>`).join("")}</div>`
    : "";
  const tag = data.tag ? `<div class="tag">${esc(data.tag)}</div>` : "";
  const series = data.series ? `<div class="series">${esc(data.series)}</div>` : "";
  const chunkEls = chunks.map((c, i) => `<div class="chunk" id="c${i}"><div class="t">${c.html}</div></div>`).join("");
  const ctaHtml = hasCta
    ? `<section class="cta clip" id="cta" data-start="${r3(ctaStart)}" data-duration="${r3(duration - ctaStart)}" data-track-index="2">
        ${data.cta.text ? `<div class="cta-text" id="cta-text">${esc(data.cta.text)}</div>` : ""}
        ${data.cta.small ? `<div class="cta-small" id="cta-small">${esc(data.cta.small)}</div>` : ""}
        ${data.cta.handle ? `<div class="cta-handle" id="cta-handle"><span>${esc(data.cta.handle)}</span></div>` : ""}
      </section>`
    : "";

  const plan = {
    duration, zoom: data.zoom, ctaStart,
    // same: this scene shows the same picture as the one before it, so the change between them is instant
    scenes: scenesPlan.map((s, k) => ({ i: s.i, start: s.start, end: s.end, image: !!s.image, same: !!s.image && k > 0 && !!data.scenes[scenesPlan[k - 1].i].image && data.scenes[scenesPlan[k - 1].i].image === data.scenes[s.i].image && !scenesPlan[k - 1].label && !s.label })),
    chunks: chunks.map((c) => ({ start: c.start, end: c.end })),
    statStates: statStates.map((s) => s.at), statCount: data.statLabels.length,
    timing: `${aligned}/${data.scenes.length} lines aligned to the voice`,
  };

  const framed = data.look !== "full";
  const soft = data.look === "soft";
  const softCss = soft ? `
.pic{object-fit:cover;top:400px;left:60px;right:60px;width:960px;height:1440px;bottom:auto;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 14%,#000 86%,transparent 100%),linear-gradient(to bottom,transparent 0,#000 11%,#000 89%,transparent 100%);-webkit-mask-composite:source-in;mask-image:linear-gradient(to right,transparent 0,#000 14%,#000 86%,transparent 100%),linear-gradient(to bottom,transparent 0,#000 11%,#000 89%,transparent 100%);mask-composite:intersect}
` : "";
  const lookCss = framed ? `
.pic{object-fit:contain;top:330px;bottom:120px;height:auto;width:100%}
.card{background:${L.bg}}
.card .cardbox{background:${L.card};border-radius:44px;padding:70px 50px;top:560px;box-shadow:0 10px 40px rgba(0,0,0,.12)}
.shade{display:none}
.caption{top:150px;height:250px;left:90px;right:90px}
.chunk{align-items:center}
.t{display:inline-block;width:auto;max-width:100%;color:${data.captionInk || L.text};text-shadow:none;background:${L.card};border-radius:28px;padding:18px 40px;font-size:${Math.round(fontSize * 0.8)}px;box-shadow:0 6px 24px rgba(0,0,0,.12)}
.series{color:${L.text};text-shadow:none;opacity:.75}
.tag{background:${L.text};color:${L.bg}}
${softCss}` : "";
  const html = `<!doctype html>
<html lang="${esc(data.lang || "und")}" dir="${dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${W}, height=${H}">
<title>story-scenes</title>
<script src="assets/gsap.min.js"></script>
<style>
${fallbackCss}
${customCss}
:root{--text:${L.text};--muted:${L.muted};--accent:${accent}}
html,body{margin:0;background:${L.bg}}
body{font-family:${family};color:var(--text);direction:${dir}}
#root{position:relative;width:100%;height:100%;overflow:hidden;background:${L.bg}}
.scene{position:absolute;inset:0;opacity:0;overflow:hidden}
.pic{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 45%}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.45) 0%,rgba(0,0,0,0) 18%,rgba(0,0,0,0) 55%,rgba(0,0,0,.78) 100%)}
.card{background:${L.card}}
.card .shade{background:radial-gradient(circle at 50% 40%,rgba(255,255,255,.06),rgba(0,0,0,.35))}
.cardbox{position:absolute;left:90px;right:90px;top:520px;text-align:center;z-index:1}
.big{font-weight:900;font-size:230px;line-height:1.15;color:var(--accent)}
.big.mark{direction:ltr;unicode-bidi:isolate;line-height:.9}
.small{margin-top:30px;font-weight:700;font-size:56px;line-height:1.6;color:var(--text)}
.src{margin-top:26px;font-weight:500;font-size:34px;color:var(--muted);direction:ltr;unicode-bidi:isolate}
.stats{position:absolute;top:150px;left:60px;right:60px;display:flex;gap:16px;z-index:5}
.stat{flex:1;background:${L.bar};border-radius:22px;padding:14px 20px;backdrop-filter:blur(6px)}
.lab{font-weight:500;font-size:28px;color:var(--muted)}
.vals{position:relative;height:66px}
.val{position:absolute;inset:0;font-weight:900;font-size:52px;line-height:66px;opacity:0;color:var(--text)}
.tag{position:absolute;top:70px;${dir === "rtl" ? "right" : "left"}:60px;background:rgba(255,255,255,.92);color:#111;font-weight:700;font-size:30px;padding:6px 22px;border-radius:40px;z-index:6}
.series{position:absolute;top:76px;${dir === "rtl" ? "left" : "right"}:60px;font-weight:700;font-size:30px;color:#fff;opacity:.9;z-index:6;text-shadow:0 2px 8px rgba(0,0,0,.6)}
.caption{position:absolute;left:70px;right:70px;top:1370px;height:330px;z-index:7}
.chunk{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0}
.t{width:100%;text-align:center;font-weight:900;font-size:${fontSize}px;line-height:1.55;color:#fff;text-shadow:0 4px 18px rgba(0,0,0,.85)}
.hl{color:var(--accent)}
.label{position:absolute;left:0;right:0;top:1640px;display:flex;justify-content:center;z-index:2}
.label span{font-weight:900;font-size:76px;line-height:1.4;color:var(--accent);background:${L.card};border-radius:30px;padding:10px 46px;box-shadow:0 8px 30px rgba(0,0,0,.14)}
.cta{position:absolute;inset:0;background:${L.bg};z-index:9}
${lookCss}
.cta-text{position:absolute;left:90px;right:90px;top:640px;text-align:center;font-weight:900;font-size:76px;line-height:1.55}
.cta-small{position:absolute;left:90px;right:90px;top:960px;text-align:center;font-weight:500;font-size:44px;line-height:1.6;color:var(--muted)}
.cta-handle{position:absolute;left:0;right:0;top:1180px;display:flex;justify-content:center}
.cta-handle span{display:inline-block;direction:ltr;unicode-bidi:isolate;background:var(--accent);color:#111;font-weight:700;font-size:46px;padding:16px 46px;border-radius:60px}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${duration}">
  ${sceneEls}
  ${statBar}
  ${tag}
  ${series}
  <div class="caption" id="caption">${chunkEls}</div>
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
  // Scenes never overlap: the old one fades out completely before the new one fades in (a short dip to the
  // background), so two pictures, captions or cards are never on screen at once.
  const OUT = 0.18, IN = 0.24, X = OUT + IN;
  PLAN.scenes.forEach((s, k) => {
    const el = document.getElementById("sc" + s.i);
    const next = PLAN.scenes[k + 1];
    if (s.same) tl.set(el, { opacity: 1 }, s.start);
    else tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: IN, ease: "power1.out" }, s.start);
    if (next && next.same) tl.set(el, { opacity: 0 }, next.start);
    else if (next) tl.to(el, { opacity: 0, duration: OUT, ease: "power1.in" }, Math.max(s.start + IN, s.end - OUT));
    if (s.image && PLAN.zoom > 0) tl.fromTo("#pic" + s.i, { scale: 1.02 }, { scale: 1.02 + PLAN.zoom, duration: s.end - s.start + X, ease: "none" }, s.start);
    const lab = document.getElementById("lab" + s.i);
    if (lab) tl.fromTo(lab, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "back.out(1.6)" }, s.start + 0.2);
    if (!s.image) {
      const big = document.getElementById("big" + s.i);
      if (big) tl.fromTo(big, { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.7)" }, s.start + 0.1);
      const small = document.getElementById("small" + s.i);
      if (small) tl.fromTo(small, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power2.out" }, s.start + 0.35);
    }
  });
  PLAN.chunks.forEach((c, i) => {
    const el = document.getElementById("c" + i);
    fit(el.querySelector(".t"), box);
    tl.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.12, ease: "power2.out" }, c.start);
    tl.set(el, { opacity: 0 }, c.end);
  });
  for (let j = 0; j < PLAN.statCount; j++) {
    PLAN.statStates.forEach((at, k) => {
      const el = document.getElementById("v" + j + "_" + k);
      if (!el) return;
      tl.fromTo(el, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }, at + (k ? 0.12 : 0.2));
      const next = PLAN.statStates[k + 1];
      if (next !== undefined) tl.to(el, { opacity: 0, y: -18, duration: 0.15 }, Math.max(at + 0.5, next - 0.15));
    });
  }
  if (PLAN.ctaStart !== null) {
    const s = PLAN.ctaStart;
    tl.fromTo("#cta", { opacity: 0 }, { opacity: 1, duration: 0.4 }, s);
    ["#cta-text", "#cta-small"].forEach((q, n) => { if (document.querySelector(q)) tl.fromTo(q, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, s + 0.4 + n * 0.2); });
    if (document.getElementById("cta-handle")) tl.fromTo("#cta-handle", { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.6)" }, s + 0.85);
  }
  window.__timelines["main"] = tl;
}
document.fonts.ready.then(buildTimeline);
</script>
</body>
</html>
`;
  return { html, duration, files, audio, thumbnailAt: r3(Math.min(duration - 0.1, 1.2)) };
}

const example = {
  template: "story-scenes",
  layout: "night",
  brand: { name: "Your Brand", accentColor: "#F2B84B" },
  voice: { provider: "piper", voice: "en_US-lessac-medium" },
  data: {
    tag: "story",
    series: "Episode 1",
    statLabels: ["Day", "Sign-ups"],
    scenes: [
      { text: "For six months he built at night.", image: "https://example.com/a.jpg", stats: ["180", "0"] },
      { text: "Sign-ups after a day: zero.", card: { big: "0", small: "sign-ups after 24 hours" } },
    ],
    cta: { enabled: true, text: "What would you do?", handle: "example.com" },
  },
};

export default {
  id: "story-scenes",
  name: "Story scenes",
  description: "A narrated story scene by scene: one spoken line per full-screen picture or card (big number, rule, quote), captions synced to the voice, an optional stat bar whose values change per scene, a corner tag and series line, and a closing call-to-action card. Everything visual comes with the request.",
  size: { width: W, height: H },
  layouts,
  defaultLayout: "night",
  schema,
  example,
  collect,
  build,
};
