# Reel Factory

A small HTTP service that turns JSON into Instagram reels (1080×1920 MP4). n8n sends a template name and data; the service downloads the images, generates the voice, renders the video with [HyperFrames](https://hyperframes.dev), and returns an MP4 link.

```
n8n ──POST /render {template, layout, brand, data, callbackUrl}──▶ reel-factory
                                                                  ├─ download images (URLs)
                                                                  ├─ voice lines (Piper / ElevenLabs, cached)
                                                                  ├─ template → HyperFrames HTML + mixed soundtrack
                                                                  └─ render MP4 + thumbnail
n8n ◀── POST callbackUrl {status, videoUrl, thumbnailUrl, meta} ──┘
```

## Run locally

Requirements: Node 22+, ffmpeg/ffprobe, Python 3.10+ (for Piper; `uv` is used when installed).

```bash
npm install
npm run setup:piper          # installs Piper + the en_US-lessac-medium voice
npm start                    # API on http://localhost:3077
```

Render a sample (served from `./samples` by the same server):

```bash
curl -s -X POST "localhost:3077/render?wait=true" -H 'content-type: application/json' -d @examples/vocab-quiz.quick.json
```

Without the server: `npm run render -- examples/vocab-quiz.quick.json` (the sample image URLs point at the server, so keep it running).

Debug a template visually: start with `KEEP_WORK=1`, then open the generated project in HyperFrames Studio:
`npx hyperframes preview data/jobs/<job-id>/work/project`.

## API

All endpoints except `/health` and `/files` need `X-API-Key: <API_KEY>` when `API_KEY` is set.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/templates` | Templates with their layouts, data JSON schema and an example request |
| `POST` | `/validate` | Check a request without rendering |
| `POST` | `/render` | Queue a render → `202 {id, status, statusUrl}`. `?wait=true` holds the request until done |
| `GET` | `/jobs/:id` | Job status: `queued`, `running` (with `stage`), `done`, `failed` |
| `GET` | `/files/:id/video.mp4` | The video (also `thumbnail.jpg`) — public, the job ID is the secret; deleted after `RETENTION_HOURS` |
| `GET` | `/library/videos/<folder>/<name>.mp4` | Published videos (requests with `output.name`), kept permanently |
| `GET` | `/images` | Image library: every stored image with its key, style, prompt and URL |
| `GET` | `/images/:key` | One library image (404 when missing) |
| `POST` | `/images` | `{key, subject?, prompt?, url?, force?}` → existing image, or generate it (or import `url`) |
| `DELETE` | `/images/:key` | Remove an image so the next render generates a new one |

### Request

```jsonc
{
  "template": "vocab-quiz",
  "layout": "classic",                      // template layout, see GET /templates
  "brand": {                                // per workflow / project
    "name": "FluentHub",
    "website": "fluenthub.app",
    "logo": "https://…/logo.png",           // optional, else a colored initial
    "primaryColor": "#1d3b40",
    "accentColor": "#43a41a",
    "wordmark": ["Fluent", "Hub"]           // two-tone name on the CTA
  },
  "voice": { "provider": "piper", "voice": "en_US-lessac-medium", "speed": 1 },
  "music": { "url": "https://…/bed.mp3", "volume": 0.12 },   // optional
  "output": { "fps": 30, "quality": "standard",               // draft | standard | high
              "name": "en-bedroom-01", "folder": "english" },  // optional: also store as library/videos/english/en-bedroom-01.mp4
  "data": { … template data … },
  "callbackUrl": "https://n8n…/webhook-waiting/…",            // optional, POSTed when finished
  "meta": { "anything": "returned untouched" }
}
```

Voices (`voice.provider`):

| Provider | What | Setup |
|---|---|---|
| `piper` (default) | Free local voices, e.g. `en_US-lessac-medium`, `de_DE-thorsten-medium` | `bash scripts/setup-piper.sh <voice>` |
| `openrouter` | ElevenLabs through OpenRouter. `voice`: a premade name (`george`, `rachel`, …) or an ElevenLabs voice-library ID. `options`: `model` (default `elevenlabs/eleven-multilingual-v2`; also `eleven-v4`, `eleven-v3`, `eleven-flash-v2.5`), `stability`, `similarity_boost`, `style`, `use_speaker_boost`, `seed`. `speed` works only on Multilingual v2 and Flash. Your own cloned voices need your ElevenLabs key added to OpenRouter (BYOK). | `OPENROUTER_API_KEY` |
| `elevenlabs` | ElevenLabs API directly (`voice` = voice ID) | `ELEVENLABS_API_KEY` |

Example: `"voice": {"provider": "openrouter", "voice": "george", "options": {"model": "elevenlabs/eleven-v4", "stability": 0.5}}`. Voice lines are cached (per text, voice, settings and model), so re-renders don't pay twice.

## Templates

### `vocab-quiz`

"What is this called?" cards. Per item: the title types in and is spoken, a 3-2-1 countdown ticks, the word and IPA appear and are spoken, then the card flies off to reveal the next one. The last card can ask for comments, and a CTA screen closes the video. Layouts: `classic` (light, the reference look) and `night`.

```jsonc
"data": {
  "title": "What is this called?",
  "flag": "us",                         // any ISO country code, or "flagUrl"
  "items": [
    { "word": "Duvet", "ipa": "/duːˈveɪ/", "imageKey": "duvet" },          // picture from the image library (AI on a miss)
    { "word": "Kettle", "image": "https://…/kettle.png", "say": "optional spoken text" }  // or any image URL
  ],
  "countdown": 3,
  "engagement": { "enabled": true, "text": "Let me know in the comments!" },
  "cta": { "headline": "Way more than vocab", "subheadline": "All inside fluenthub.app", "image": "https://…/phones.png",
           "buttonText": "DOWNLOAD NOW!", "footerText": "LINK IN PROFILE", "duration": 5.5 },
  "timing": { "countdownStep": 1, "answerHold": 0.85 }
}
```

Sound effects come from `assets/sfx` by name (`GET /templates` lists them): `"sounds": {"countdown": "tick", "reveal": "pop", "cardOut": "whoosh-short", "ctaIn": "chime", "volume": 0.9}`; `null` turns one off. The defaults match the reference (ticks only). Drop new `.wav`/`.mp3` files into `assets/sfx` to add more.

Video length is driven by the voice: each card lasts about 6.2 s with Piper (12 cards + CTA ≈ 80 s).
Images look best on a white or transparent background (they blend into the card).

### `still-captions`

One picture stays on screen while a voice reads a script; the script appears a few words at a time and an optional closing card carries a call to action. Text direction (left-to-right or right-to-left) is detected from the script; the bundled font (Vazirmatn) covers Arabic-script and Latin text. Layouts: `light` and `dark`, both neutral. Example: `examples/still-captions.example.json`.

**This service holds nothing that belongs to one client.** The caller sends its own colors, font, picture style, call to action and disclosure; nothing is stored here except the generated pictures, cached by style.

```jsonc
"data": {
  "lines": [ "Here is a *simple idea* worth keeping.", "…" ],   // one voice clip per line; *…* highlights in brand.accentColor, not spoken
  "imageKey": "lighthouse",              // or "image": "https://…", or imageSubject / imagePrompt (AI on a miss)
  "imageSubject": "a lighthouse on a calm sea",
  "imageStyle": {                        // the caller's picture style (a built-in id like "object-white" also works)
    "id": "flat-calm",                   // lowercase letters, digits, dashes
    "prompt": "Flat illustration … Subject: {subject}. No text.",   // must contain {subject}
    "transparent": false
  },
  "theme": { "bg": "#FAFAF7", "text": "#1A1A1A", "muted": "#6B6B6B", "imagePanel": "transparent", "ctaBg": "#FAFAF7", "pillText": "#fff", "fontUrl": "https://…/font.woff2" },
  "dir": "auto",                         // "rtl" | "ltr" | "auto"
  "caption": { "maxWords": 5, "maxChars": 34, "fontSize": 78, "hangingWords": ["and", "of"] },   // words a caption should not end on
  "cta": { "enabled": true, "text": "…", "handle": "example.com", "say": "optional spoken line", "duration": 3.5 },
  "disclosure": ""                       // small footer, e.g. a note that the voice is synthetic; empty hides it
  "logoSize": 84,                        // px of the round brand logo beside the name (40 to 260)
  "speech": ["…"]                        // optional: what the voice reads per line, the same words with pronunciation marks (Persian short vowels); captions keep showing "lines"
}
```

- **Picture styles are per request.** A custom style's id is namespaced with a short hash of its prompt (`library/images/<id>-<hash>/`), so two clients never share pictures, and changing the prompt generates new ones.
- Each line is spoken as one clip (cached per line), so changing one line re-voices only that line. `voice.tempo` (0.8 to 1.5) speeds the finished clip up with ffmpeg, for models without a speed setting.
- Caption chunks split at punctuation first, then at `maxWords`/`maxChars`. **With the `elevenlabs` provider the timing is exact**: it asks the `with-timestamps` endpoint when each character is spoken (`options.timestamps: false` turns that off), the TTS layer returns it as `alignment` ({chars, starts, ends}, cached next to the clip and scaled for `voice.tempo`), and each caption switches on its first word. Providers without alignment (`openrouter`, `piper`) fall back to an estimate: chunks share the clip's time in proportion to their length, which was up to about 0.4 s off in the first test. The template falls back per line when the alignment does not match the text.

### Adding a template

Create `templates/<id>/template.js` exporting:

- `schema` — zod schema of `data` (defaults included; served as JSON schema at `/templates`)
- `layouts` — named theme/layout token sets, `defaultLayout`
- `collect(data, {brand})` → `{ assets: {key: url}, speech: {key: text} }` — what to download and speak
- `build({data, layout, brand, assets, speech})` → `{ html, duration, files, audio, thumbnailAt }` — the HyperFrames composition HTML, extra files to copy (fonts, gsap, flags), and timed audio events (`{speech: key, at}` or `{sfx: "tick", at}` from `assets/sfx/`)

Helpers for fonts, flags, brand pills and wordmarks are in `src/templates/shared.js`. The server picks up new templates on restart.

## Image library

Vocab pictures live in `library/images/<style>/<key>.png` with an index in `library/images/index.json`. Keys are language-neutral (`alarm-clock`), so English, German, … all reuse the same picture. When a render needs a key that is not in the library, the renderer generates it once and stores it; every later video reuses it. Generation goes through **OpenRouter** (`IMAGE_PROVIDER=openrouter`, `OPENROUTER_API_KEY`), model `OPENROUTER_IMAGE_MODEL` (default `openai/gpt-image-1-mini`: transparent background, studio product look, about $0.009 per image at medium quality, measured for gpt-image-1-mini). Any image model from OpenRouter's `GET /api/v1/images/models` works — the renderer only sends the parameters that model supports (models without transparency get a white background, which blends into the card). `IMAGE_PROVIDER=openai` calls OpenAI directly with `OPENAI_API_KEY` instead. Each library entry records the model, prompt and cost.

- Replace a picture: `DELETE /images/<key>` (next render regenerates) or `POST /images {"key": "...", "url": "https://…"}` to import your own.
- Pre-generate: `POST /images {"key": "frying-pan"}`; force a new take with `"force": true`; steer it with `"subject"` or a full `"prompt"`.
- Samples: the 12 bedroom pictures from the reference reel are already imported.

## Google Sheet workflow (Language Learning – Reels)

The planning sheet ("Language Learning – Reels" in Google Drive, built by `scripts/make-workbook.py`) has:

- one tab per language (`English`, `German`, …) — **one row = one video**: ID, Status, Topic, Template, Layout, Vocabs (one per line: `word | IPA | image key`), Title, Published name, Publish date, Platforms, Caption, Hashtags, First comment, Notes, Options (JSON), and result columns the workflow fills in (Video URL, Thumbnail URL, Duration, Images generated, Rendered at, Job ID, Error) plus Published URL/at for a later publishing workflow;
- `Languages` — per-language defaults: flag, voice, question title, comment prompt, CTA texts, video folder; `Enabled` switches a language off;
- `Brand` — the project's brand (name, website, colors, wordmark, logo, CTA image, default template/layout, quality);
- `Lists` (dropdown values) and `Guide`.

`n8n/sheet-to-reel.workflow.json` (built from `n8n/nodes/*.js` by `node n8n/build-workflows.mjs`):

1. Triggers: every hour, manual, or `POST /webhook/reel-factory/sheet-render` with `{"sheet": "German", "id": "DE-001"}` to render one specific row.
2. Reads Brand, Languages and every enabled language tab; picks the `ready` row with the earliest Publish date.
3. Builds the render request from the row + language defaults + brand (`Options (JSON)` is deep-merged last), sets the row to `rendering`.
4. Calls the renderer and waits for its callback; writes `rendered` + links (or `failed` + the reason) back to the row. Failed rows also fail the n8n execution, so error notifications fire.

Videos are stored as `library/videos/<Video folder>/<Published name>.mp4`.

**Connect Google Sheets in n8n (once):** in the n8n editor open *Credentials → Add credential → Google Sheets OAuth2 API*. Self-hosted n8n needs your own Google OAuth client: in Google Cloud Console create a project, enable the *Google Sheets API* and *Google Drive API*, create an *OAuth client ID* (Web application) with the redirect URL n8n shows (`http://localhost:5678/rest/oauth2-credential/callback` locally), paste client ID/secret into n8n and sign in. Name it "Google Sheets account", select it in the five Google Sheets nodes, then publish the workflow. (A *Google Service Account* credential also works — share the sheet with the service account's email.)

**Test without Google:** `n8n/test/sheet-to-reel.test.workflow.json` is the same workflow with the sheet replaced by `n8n/test/fixtures.json` and row updates POSTed to `http://localhost:3095/sheet-update`. Run `node n8n/test/capture-server.mjs`, then `curl -X POST localhost:5678/webhook/reel-factory/sheet-render-test -d '{}' -H 'content-type: application/json'`.

## n8n: direct JSON workflow

`n8n/vocab-quiz.workflow.json` has two triggers (manual, and a webhook at `POST /webhook/reel-factory/vocab-quiz`), builds the request in a Code node, calls `POST /render` with the Wait node's `$execution.resumeUrl` as `callbackUrl`, and continues when the renderer calls back. The last node outputs `videoUrl`, `thumbnailUrl`, `duration` and `meta`, or fails with the renderer's error.

The webhook accepts optional overrides, so other workflows can reuse it:

```json
{ "topic": "Kitchen", "layout": "night", "items": [{ "image": "https://…", "word": "Kettle", "ipa": "/ˈkɛtəl/" }],
  "brand": { … }, "voice": { … }, "cta": { … }, "sounds": { "reveal": "pop" } }
```

The renderer URL comes from the `REEL_FACTORY_URL` env var (default `http://reel-factory:3077`, the docker service name on the VPS). Calls are authenticated with a **Header Auth** credential named "Reel Factory API key" (`X-API-Key` / your key).

### Local n8n (same version as the VPS, 2.43.7)

```bash
npm run n8n:install     # once; installs n8n into local-n8n/
npm run n8n:setup       # (n8n stopped) imports the workflows + API key credential from .env, publishes them
npm start               # renderer, in one terminal
npm run n8n:start       # n8n on http://localhost:5678, in another
curl -X POST localhost:5678/webhook/reel-factory/vocab-quiz -H 'content-type: application/json' -d '{"topic":"Bedroom"}'
```

On first visit the n8n editor asks you to create the local owner account. Re-run `n8n:setup` (with n8n stopped) after changing the workflow file.

## Configuration

See `.env.example`. Notables: `PUBLIC_BASE_URL` (used in the returned links), `API_KEY`, `RENDER_CONCURRENCY` (1 on a 2 vCPU VPS), `RETENTION_HOURS`, `OPENROUTER_API_KEY` (one key for AI images and ElevenLabs voices; OpenRouter keys start with `sk-or-v1-`).

## Notes

- `samples/vocab-bedroom/` images are cropped from the reference reel and are for local testing only.
- HyperFrames runs headless Chrome; on a 2 vCPU VPS expect several minutes per 80 s reel (39 s on an M-series Mac).
