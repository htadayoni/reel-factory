import { z, url, sfx } from "../../src/schemas.js";
import {
  esc, r3, fontFaces, flagFile, gsapFile, brandedWebsite, wordmarkHtml, logoHtml, charSpans,
} from "../../src/templates/shared.js";

/**
 * "What is this called?" vocabulary quiz.
 * Per item: title types in + question voice -> countdown with ticks -> word + IPA reveal + word voice
 * -> card flies off revealing the next card. Optional "comment" ending on the last card and a CTA outro.
 */

const W = 1080;
const H = 1920;

const layouts = {
  classic: {
    label: "Classic light (reference look)",
    bgTop: "#d6e5fa", bgBottom: "#f1f6fd",
    card: "#ffffff", cardShadow: "0 24px 60px rgba(48,84,140,0.14)",
    stack1: "#edf0f4", stack2: "#e0e5ec",
    text: "#262a33", muted: "#7b8b90",
    ring: "#dde9fb", badgeBg: "#ffffff",
    imagePanel: "transparent",
    pillBg: "#ffffff", pillText: "#2b3a42",
    ctaHeadline: "#4b5e66", ctaSub: "#9aa6ab", ctaButton: "#2b6293", ctaFooter: "#1f3b4d",
    ctaPanel: "rgba(255,255,255,0.35)",
  },
  night: {
    label: "Night (dark card, white image panel)",
    bgTop: "#0b1222", bgBottom: "#1b2a44",
    card: "#141d2f", cardShadow: "0 30px 80px rgba(0,0,0,0.45)",
    stack1: "#1c2740", stack2: "#24314d",
    text: "#f4f7fb", muted: "#93a4bd",
    ring: "#2d3c5c", badgeBg: "#141d2f",
    imagePanel: "#ffffff",
    pillBg: "#141d2f", pillText: "#e6edf7",
    ctaHeadline: "#c9d6e8", ctaSub: "#8597b0", ctaButton: "#7cc4ff", ctaFooter: "#e6edf7",
    ctaPanel: "rgba(255,255,255,0.04)",
    // Brand primary colors are usually dark; use light text for them on this background
    wordmarkPrimary: "#f4f7fb",
  },
};

const itemSchema = z.object({
  word: z.string().min(1).max(40),
  ipa: z.string().max(60).optional(),
  // Text the voice should say for the answer (defaults to `word`)
  say: z.string().optional(),
  // Picture: a URL, or a key in the image library (language-neutral, e.g. "alarm-clock").
  // With neither, the word itself is the library key. Missing library images are generated with AI.
  image: url.optional(),
  imageKey: z.string().max(80).optional(),
  imageSubject: z.string().max(200).optional(), // what to draw, default: the key in words
  imagePrompt: z.string().max(1000).optional(), // full prompt override
});

const schema = z.object({
  title: z.string().max(40).default("What is this called?"),
  flag: z.string().length(2).optional().default("us"), // ISO country code, "" hides it
  flagUrl: url.optional(), // custom flag/badge image instead of the built-in one
  items: z.array(itemSchema).min(1).max(30),
  imageStyle: z.string().default("object-white"),
  countdown: z.number().int().min(0).max(5).default(3),
  speakQuestion: z.boolean().default(true),
  speakAnswer: z.boolean().default(true),
  // The last card asks viewers to comment instead of revealing the answer
  engagement: z
    .object({
      enabled: z.boolean().default(true),
      text: z.string().max(60).default("Let me know in the comments!"),
      speak: z.boolean().default(true),
    })
    .prefault({}),
  cta: z
    .object({
      enabled: z.boolean().default(true),
      headline: z.string().max(40).default("Way more than vocab"),
      subheadline: z.string().max(60).optional(), // default "All inside <website>"
      image: url.optional(), // e.g. app screenshots / product mockup
      buttonText: z.string().max(24).default("DOWNLOAD NOW!"),
      footerText: z.string().max(30).default("LINK IN PROFILE"),
      duration: z.number().min(2).max(15).default(5.5),
      say: z.string().max(120).optional(), // optional voice line over the CTA
    })
    .prefault({}),
  // Sound effects by name from assets/sfx (GET /templates lists them); null = silent
  sounds: z
    .object({
      countdown: sfx.default("tick"),
      reveal: sfx.default(null),
      cardOut: sfx.default(null),
      ctaIn: sfx.default(null),
      volume: z.number().min(0).max(1.5).default(0.9),
    })
    .prefault({}),
  timing: z
    .object({
      countdownStep: z.number().min(0.5).max(2).default(1),
      answerHold: z.number().min(0.3).max(4).default(0.85), // pause after the word is spoken
    })
    .prefault({}),
});

/** Phase 1: which remote assets and voice lines the template needs. */
function collect(data, { brand }) {
  const assets = {};
  data.items.forEach((it, i) => {
    assets[`item${i}`] = it.image || {
      library: { key: it.imageKey || it.word, subject: it.imageSubject, prompt: it.imagePrompt, style: data.imageStyle },
    };
  });
  if (data.flagUrl) assets.flag = data.flagUrl;
  if (brand.logo) assets.logo = brand.logo;
  if (data.cta.enabled && data.cta.image) assets.ctaImage = data.cta.image;

  const speech = {};
  if (data.speakQuestion) speech.question = data.title;
  data.items.forEach((it, i) => {
    const last = i === data.items.length - 1;
    if (last && data.engagement.enabled) {
      if (data.engagement.speak) speech.engagement = data.engagement.text;
    } else if (data.speakAnswer) {
      speech[`answer${i}`] = it.say || it.word;
    }
  });
  if (data.cta.enabled && data.cta.say) speech.cta = data.cta.say;
  return { assets, speech };
}

/** Phase 2: timeline plan + composition HTML. */
function build({ data, layout: L, brand, assets, speech }) {
  const step = data.timing.countdownStep;
  const n = data.countdown;
  const FLY = 0.45;
  const qDur = speech.question?.duration ?? 0;
  const typeDur = Math.min(1.0, data.title.length * 0.045);

  const audio = [];
  const items = [];
  let t = 0;
  data.items.forEach((it, i) => {
    const last = i === data.items.length - 1;
    const ask = last && data.engagement.enabled;
    const start = t;
    if (speech.question) audio.push({ speech: "question", at: start });
    const countStart = start + Math.max(qDur, typeDur) + 0.15;
    const ticks = Array.from({ length: n }, (_, k) => countStart + k * step);
    const snd = data.sounds;
    if (snd.countdown) ticks.forEach((at) => audio.push({ sfx: snd.countdown, at, volume: snd.volume }));
    const reveal = countStart + n * step + (n ? 0.05 : 0.3);
    const lineKey = ask ? "engagement" : `answer${i}`;
    if (speech[lineKey]) audio.push({ speech: lineKey, at: reveal + 0.05 });
    if (snd.reveal) audio.push({ sfx: snd.reveal, at: reveal, volume: snd.volume });
    const lineDur = speech[lineKey]?.duration ?? 0.7;
    const exit = reveal + Math.max(lineDur, 0.7) + data.timing.answerHold;
    items.push({ start, countStart, reveal, exit, ask, ticks });
    t = exit + 0.25; // next card's title starts typing while this one is still flying away
  });

  const lastItem = items[items.length - 1];
  const snd = data.sounds;
  const hasCta = data.cta.enabled;
  const ctaStart = hasCta ? lastItem.exit + 0.2 : null;
  const ctaDur = hasCta ? Math.max(data.cta.duration, (speech.cta?.duration ?? 0) + 1.5) : 0;
  if (hasCta && speech.cta) audio.push({ speech: "cta", at: ctaStart + 0.6 });
  if (hasCta && snd.ctaIn) audio.push({ sfx: snd.ctaIn, at: ctaStart, volume: snd.volume });
  // Without a CTA the last card stays on screen and the video ends after a short hold.
  const duration = r3(hasCta ? ctaStart + ctaDur : lastItem.exit + 0.6);

  // Clip windows: each card shows from the moment the previous card starts flying away.
  items.forEach((it, i) => {
    it.clipStart = i === 0 ? 0 : items[i - 1].exit - 0.05;
    const flies = !(i === items.length - 1 && !hasCta);
    it.clipEnd = flies ? it.exit + FLY + 0.05 : duration;
    it.flies = flies;
    if (flies && snd.cardOut) audio.push({ sfx: snd.cardOut, at: it.exit, volume: snd.volume });
  });

  const lora = fontFaces("Lora", "lora", [400, 600, 700]);
  const files = [gsapFile, ...lora.files];
  let flagSrc = "";
  if (assets.flag) flagSrc = assets.flag;
  else if (data.flag) {
    files.push(flagFile(data.flag));
    flagSrc = "assets/flag.svg";
  }

  const cards = data.items
    .map((it, i) => {
      const p = items[i];
      const answer = p.ask
        ? `<div class="ask" data-fit>${esc(data.engagement.text)}</div>`
        : `<div class="word" data-fit>${esc(it.word)}</div>${it.ipa ? `<div class="ipa" data-fit>${esc(it.ipa)}</div>` : ""}`;
      const nums = Array.from({ length: n }, (_, k) => `<span class="num">${n - k}</span>`).join("");
      return `
      <div class="slot clip" id="slot-${i}" data-start="${r3(p.clipStart)}" data-duration="${r3(p.clipEnd - p.clipStart)}" data-track-index="1" style="z-index:${100 - i}">
        <div class="card" id="card-${i}">
          <div class="title" data-fit>${charSpans(data.title)}</div>
          <div class="imgbox"><img src="${esc(assets[`item${i}`])}" alt=""></div>
          ${n ? `<div class="badge" id="badge-${i}">${nums}</div>` : ""}
          <div class="answer" id="answer-${i}">${answer}</div>
        </div>
      </div>`;
    })
    .join("");

  const ctaHtml = hasCta
    ? `
      <section class="cta clip${assets.ctaImage ? "" : " no-image"}" id="cta" data-start="${r3(ctaStart)}" data-duration="${r3(duration - ctaStart)}" data-track-index="2">
        <div class="cta-panel" id="cta-panel"></div>
        <div class="cta-headline" id="cta-headline" data-fit>${esc(data.cta.headline)}</div>
        <div class="cta-sub" id="cta-sub">${esc(data.cta.subheadline ?? `All inside ${brand.website || brand.name}`)}</div>
        <div class="cta-wordmark" id="cta-wordmark" data-fit>${wordmarkHtml(brand, L.wordmarkPrimary)}</div>
        ${assets.ctaImage ? `<div class="cta-image" id="cta-image"><img src="${esc(assets.ctaImage)}" alt=""></div>` : ""}
        <div class="cta-button" id="cta-button"><span class="bars"><i></i><i></i><i></i></span><span class="txt">${esc(data.cta.buttonText)}</span><span class="bars"><i></i><i></i><i></i></span></div>
        <div class="cta-footer" id="cta-footer"><i></i><span>${esc(data.cta.footerText)}</span><i></i></div>
      </section>`
    : "";

  const plan = {
    n, step, typeDur, FLY, ctaStart,
    items: items.map((p) => ({ start: r3(p.start), countStart: r3(p.countStart), reveal: r3(p.reveal), exit: r3(p.exit), flies: p.flies, ask: p.ask })),
  };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${W}, height=${H}">
<title>vocab-quiz</title>
<script src="assets/gsap.min.js"></script>
<style>
${lora.css}
:root{--text:${L.text};--muted:${L.muted};--card:${L.card};--ring:${L.ring}}
html,body{margin:0;background:${L.bgBottom}}
body{font-family:"Lora",Georgia,serif;color:var(--text)}
#root{position:relative;width:100%;height:100%;overflow:hidden;background:linear-gradient(180deg,${L.bgTop} 0%,${L.bgBottom} 70%)}
.chrome{position:absolute;inset:0}
.flag{position:absolute;left:50%;top:252px;width:196px;height:130px;margin-left:-98px;border-radius:16px;overflow:hidden;box-shadow:0 10px 24px rgba(30,50,90,0.18)}
.flag img{width:100%;height:100%;object-fit:cover;display:block}
.stack{position:absolute;left:60px;width:960px;top:417px;height:1218px;border-radius:40px}
.stack{box-shadow:0 10px 24px rgba(30,50,90,0.08)}
.stack.s2{background:${L.stack2};transform:translateY(46px) scale(0.965)}
.stack.s1{background:${L.stack1};transform:translateY(24px) scale(0.982)}
.pill{position:absolute;left:50%;top:1694px;height:78px;width:360px;margin-left:-180px;border-radius:39px;background:${L.pillBg};box-shadow:0 8px 22px rgba(30,50,90,0.10);display:flex;align-items:center;justify-content:center;gap:14px;font-weight:700;font-size:34px;color:${L.pillText}}
.slot{position:absolute;inset:0}
.card{position:absolute;left:60px;top:417px;width:960px;height:1218px;border-radius:40px;background:var(--card);box-shadow:${L.cardShadow};overflow:hidden}
.title{position:absolute;left:40px;right:40px;top:44px;height:104px;line-height:104px;text-align:center;font-weight:700;font-size:62px;white-space:nowrap}
.imgbox{position:absolute;left:56px;right:56px;top:190px;height:690px;border-radius:28px;background:${L.imagePanel};display:flex;align-items:center;justify-content:center;overflow:hidden}
.imgbox img{max-width:100%;max-height:100%;object-fit:contain;display:block;mix-blend-mode:multiply}
.badge{position:absolute;left:50%;top:924px;width:168px;height:168px;margin-left:-84px;border-radius:50%;background:${L.badgeBg};box-shadow:inset 0 0 0 18px var(--ring)}
.num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:68px;opacity:0}
.answer{position:absolute;left:40px;right:40px;top:930px;height:240px;text-align:center}
.word{height:150px;line-height:150px;font-weight:700;font-size:98px;white-space:nowrap;opacity:0}
.ipa{margin-top:-8px;height:70px;line-height:70px;font-size:50px;color:var(--muted);white-space:nowrap;opacity:0}
.ask{height:150px;line-height:150px;font-weight:700;font-size:52px;white-space:nowrap;opacity:0}
.cta{position:absolute;inset:0}
.cta-panel{position:absolute;left:226px;right:226px;top:255px;height:1050px;border-radius:120px;background:${L.ctaPanel}}
.cta-headline{position:absolute;left:60px;right:60px;top:330px;height:100px;line-height:100px;text-align:center;font-weight:700;font-size:68px;color:${L.ctaHeadline};white-space:nowrap}
.cta-sub{position:absolute;left:60px;right:60px;top:432px;height:44px;line-height:44px;text-align:center;font-size:30px;color:${L.ctaSub}}
.cta-wordmark{position:absolute;left:40px;right:40px;top:500px;height:190px;line-height:190px;text-align:center;font-weight:700;font-size:150px;white-space:nowrap;letter-spacing:-1px}
.cta-image{position:absolute;left:0;right:0;top:690px;height:610px;display:flex;align-items:center;justify-content:center}
.cta-image img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.cta-button{position:absolute;left:0;right:0;top:1330px;height:110px;display:flex;align-items:center;justify-content:center;gap:34px;color:${L.ctaButton};font-weight:700;font-size:68px}
.cta-button .bars{display:flex;flex-direction:column;gap:9px}
.cta-button .bars i{display:block;width:30px;height:6px;border-radius:3px;background:currentColor}
.cta-button .bars i:nth-child(2){width:20px}
.cta-button .bars:last-child{align-items:flex-end}
.cta-footer{position:absolute;left:0;right:0;top:1460px;height:70px;display:flex;align-items:center;justify-content:center;gap:26px;color:${L.ctaFooter};font-weight:700;font-size:44px;letter-spacing:1px}
.cta-footer i{display:block;width:44px;height:6px;border-radius:3px;background:currentColor}
.cta.no-image .cta-panel{top:470px;height:760px}
.cta.no-image .cta-headline{top:560px}
.cta.no-image .cta-sub{top:662px}
.cta.no-image .cta-wordmark{top:730px}
.cta.no-image .cta-button{top:1000px}
.cta.no-image .cta-footer{top:1130px}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${duration}">
  <div class="chrome" id="chrome">
    ${flagSrc ? `<div class="flag"><img src="${esc(flagSrc)}" alt=""></div>` : ""}
    <div class="stack s2"></div>
    <div class="stack s1"></div>
    <div class="pill">${logoHtml(brand, assets, 46)}<span>${brandedWebsite(brand)}</span></div>
  </div>
  ${cards}
  ${ctaHtml}
  <audio id="soundtrack" src="assets/soundtrack.wav" data-start="0" data-duration="${duration}" data-track-index="5" data-volume="1"></audio>
</div>
<script>
const PLAN = ${JSON.stringify(plan)};
function fitText(el) {
  const style = getComputedStyle(el);
  let size = parseFloat(style.fontSize);
  const min = size * 0.45;
  while (el.scrollWidth > el.clientWidth + 1 && size > min) {
    size -= 2;
    el.style.fontSize = size + "px";
  }
}
function buildTimeline() {
  document.querySelectorAll("[data-fit]").forEach(fitText);
  const tl = gsap.timeline({ paused: true });
  PLAN.items.forEach((p, i) => {
    const card = document.getElementById("card-" + i);
    const chars = card.querySelectorAll(".title .ch");
    // Title typewriter
    tl.fromTo(chars, { opacity: 0 }, { opacity: 1, duration: 0.01, stagger: PLAN.typeDur / Math.max(chars.length, 1) }, p.start);
    // Countdown
    const badge = document.getElementById("badge-" + i);
    if (badge) {
      const nums = badge.querySelectorAll(".num");
      nums.forEach((num, k) => {
        const at = p.countStart + k * PLAN.step;
        tl.fromTo(num, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.18, ease: "back.out(2)" }, at);
        if (k < nums.length - 1) tl.to(num, { opacity: 0, duration: 0.08 }, at + PLAN.step - 0.04);
      });
      tl.fromTo(badge, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.2, ease: "back.out(2)" }, p.countStart - 0.08);
      tl.to(badge, { opacity: 0, scale: 0.6, duration: 0.18, ease: "power2.in" }, p.reveal - 0.12);
    }
    // Reveal
    const answer = document.getElementById("answer-" + i);
    const main = answer.querySelector(".word, .ask");
    const ipa = answer.querySelector(".ipa");
    tl.fromTo(main, { opacity: 0, scale: 0.82, y: 24 }, { opacity: 1, scale: 1, y: 0, duration: 0.38, ease: "back.out(1.8)" }, p.reveal);
    if (ipa) tl.fromTo(ipa, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }, p.reveal + 0.12);
    // Fly away to uncover the next card
    if (p.flies) {
      tl.fromTo(card, { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 },
        { x: 170, y: -110, rotation: 8, scale: 1.05, opacity: 0, duration: PLAN.FLY, ease: "power2.in" }, p.exit);
    }
  });
  if (PLAN.ctaStart !== null) {
    const s = PLAN.ctaStart;
    tl.fromTo("#chrome", { opacity: 1 }, { opacity: 0, duration: 0.3 }, s - 0.15);
    tl.fromTo("#cta-panel", { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.5, ease: "power2.out" }, s);
    tl.fromTo("#cta-headline", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, s + 0.05);
    tl.fromTo("#cta-sub", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, s + 0.2);
    tl.fromTo("#cta-wordmark", { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.55, ease: "back.out(1.6)" }, s + 0.3);
    if (document.getElementById("cta-image")) {
      tl.fromTo("#cta-image", { opacity: 0, y: 80 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, s + 0.5);
    }
    tl.fromTo("#cta-button", { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)" }, s + 0.8);
    tl.fromTo("#cta-footer", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, s + 1.0);
    tl.to("#cta-button", { scale: 1.06, duration: 0.5, ease: "sine.inOut", yoyo: true, repeat: 3 }, s + 1.6);
  }
  window.__timelines["main"] = tl;
}
document.fonts.ready.then(buildTimeline);
</script>
</body>
</html>
`;

  const firstAnswer = items.find((p) => !p.ask) || items[0];
  return { html, duration, files, audio, thumbnailAt: r3(firstAnswer.reveal + 0.5) };
}

const example = {
  template: "vocab-quiz",
  layout: "classic",
  brand: {
    name: "FluentHub",
    website: "fluenthub.app",
    primaryColor: "#1d3b40",
    accentColor: "#43a41a",
    wordmark: ["Fluent", "Hub"],
  },
  voice: { provider: "piper", voice: "en_US-lessac-medium" },
  data: {
    title: "What is this called?",
    flag: "us",
    items: [
      { image: "https://example.com/duvet.png", word: "Duvet", ipa: "/duːˈveɪ/" },
      { image: "https://example.com/headboard.png", word: "Headboard", ipa: "/ˈhɛdˌbɔrd/" },
      { image: "https://example.com/bed.png", word: "Bed", ipa: "/bɛd/" },
    ],
    engagement: { enabled: true, text: "Let me know in the comments!" },
    cta: { headline: "Way more than vocab", image: "https://example.com/app-phones.png" },
  },
  callbackUrl: "https://your-n8n.example.com/webhook/reel-done",
  meta: { workflow: "bedroom-vocab" },
};

export default {
  id: "vocab-quiz",
  name: "Vocabulary quiz",
  description: "\"What is this called?\" cards: picture, countdown, word + IPA reveal, comment prompt and CTA outro.",
  size: { width: W, height: H },
  layouts,
  defaultLayout: "classic",
  schema,
  example,
  collect,
  build,
};
