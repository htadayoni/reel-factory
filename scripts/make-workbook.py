"""Builds the reel-planning workbook (upload to Google Drive -> converted to a Google Sheet).

Run: uv run --with openpyxl python scripts/make-workbook.py [out.xlsx]

Tabs
  <Language> (English, German, ...)  one row = one video; n8n picks rows with Status = ready
  Languages                          per-language defaults (flag, voice, texts, video folder)
  Brand                              project-wide brand used by every video
  Lists                              allowed values for the dropdowns
  Guide                              how to fill a row
"""
import sys
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = sys.argv[1] if len(sys.argv) > 1 else "language-learning-reels.xlsx"

STATUSES = ["draft", "ready", "rendering", "rendered", "failed", "scheduled", "published"]
TEMPLATES = ["vocab-quiz"]
LAYOUTS = ["classic", "night"]
PLATFORMS = ["instagram", "tiktok", "youtube", "facebook"]

# Columns of every language tab. (name, width, filled by)
VIDEO_COLUMNS = [
    ("ID", 10, "you"),
    ("Status", 12, "you"),
    ("Topic", 16, "you"),
    ("Template", 13, "you"),
    ("Layout", 10, "you"),
    ("Vocabs", 52, "you"),
    ("Title", 22, "you"),
    ("Published name", 24, "you"),
    ("Publish date", 18, "you"),
    ("Platforms", 22, "you"),
    ("Caption", 44, "you"),
    ("Hashtags", 34, "you"),
    ("First comment", 30, "you"),
    ("Notes", 24, "you"),
    ("Options (JSON)", 26, "you"),
    ("Video URL", 40, "n8n"),
    ("Thumbnail URL", 30, "n8n"),
    ("Duration (s)", 11, "n8n"),
    ("Images generated", 24, "n8n"),
    ("Rendered at", 18, "n8n"),
    ("Job ID", 20, "n8n"),
    ("Error", 30, "n8n"),
    ("Published URL", 30, "publish"),
    ("Published at", 18, "publish"),
]

HEADER_FILL = {"you": "1F3B4D", "n8n": "5B6B73", "publish": "7A5C8F"}

EN_BEDROOM = """Duvet | /duːˈveɪ/ | duvet
Headboard | /ˈhɛdˌbɔrd/ | headboard
Nightstand | /ˈnaɪtˌstænd/ | nightstand
Pillowcase | /ˈpɪloʊˌkeɪs/ | pillowcase
Alarm clock | /əˈlɑrm klɑk/ | alarm-clock
Wardrobe | /ˈwɔrˌdroʊb/ | wardrobe
Hanger | /ˈhæŋər/ | hanger
Mattress | /ˈmætrəs/ | mattress
Blanket | /ˈblæŋkɪt/ | blanket
Slippers | /ˈslɪpərz/ | slippers
Pajamas | /pəˈdʒɑməz/ | pajamas
Bed | /bɛd/ | bed"""

EN_KITCHEN = """Kettle | /ˈkɛtəl/ | kettle
Toaster | /ˈtoʊstər/ | toaster
Frying pan | /ˈfraɪɪŋ pæn/ | frying-pan
Whisk | /wɪsk/ | whisk
Cutting board | /ˈkʌtɪŋ bɔrd/ | cutting-board
Colander | /ˈkɑləndər/ | colander
Ladle | /ˈleɪdəl/ | ladle
Fridge | /frɪdʒ/ | fridge"""

DE_BEDROOM = """die Bettdecke | /diː ˈbɛtˌdɛkə/ | duvet
der Nachttisch | /deːɐ̯ ˈnaxtˌtɪʃ/ | nightstand
der Wecker | /deːɐ̯ ˈvɛkɐ/ | alarm-clock
der Kleiderschrank | /deːɐ̯ ˈklaɪ̯dɐˌʃʁaŋk/ | wardrobe
der Kleiderbügel | /deːɐ̯ ˈklaɪ̯dɐˌbyːɡl̩/ | hanger
die Matratze | /diː maˈtʁat͡sə/ | mattress
die Hausschuhe | /diː ˈhaʊ̯sˌʃuːə/ | slippers
das Bett | /das bɛt/ | bed"""

DE_KITCHEN = """der Wasserkocher | /deːɐ̯ ˈvasɐˌkɔxɐ/ | kettle
der Toaster | /deːɐ̯ ˈtoːstɐ/ | toaster
die Pfanne | /diː ˈpfanə/ | frying-pan
der Schneebesen | /deːɐ̯ ˈʃneːˌbeːzn̩/ | whisk
das Schneidebrett | /das ˈʃnaɪ̯dəˌbʁɛt/ | cutting-board
der Kühlschrank | /deːɐ̯ ˈkyːlˌʃʁaŋk/ | fridge"""

ROWS = {
    "English": [
        ["EN-001", "ready", "Bedroom", "vocab-quiz", "classic", EN_BEDROOM, "", "en-bedroom-01",
         datetime(2026, 10, 20, 18, 0), "instagram, tiktok",
         "Can you name every bedroom item before the timer runs out? 🛏️ Save this for later!",
         "#englishvocabulary #learnenglish #esl #vocabulary", "Which one did you get wrong? 👇", "", ""],
        ["EN-002", "draft", "Kitchen", "vocab-quiz", "night", EN_KITCHEN, "", "en-kitchen-01",
         datetime(2026, 10, 22, 18, 0), "instagram",
         "Kitchen words you use every day — how many do you know? 🍳",
         "#englishvocabulary #learnenglish #kitchen", "", "New images: needs OPENAI_API_KEY", ""],
    ],
    "German": [
        ["DE-001", "ready", "Schlafzimmer", "vocab-quiz", "classic", DE_BEDROOM, "", "de-schlafzimmer-01",
         datetime(2026, 10, 21, 18, 0), "instagram",
         "Kennst du alle Wörter im Schlafzimmer? 🛏️ Speichern und später üben!",
         "#deutschlernen #learngerman #wortschatz #deutsch", "", "", ""],
        ["DE-002", "draft", "Küche", "vocab-quiz", "classic", DE_KITCHEN, "", "de-kueche-01",
         datetime(2026, 10, 23, 18, 0), "instagram",
         "Wörter aus der Küche — wie viele kennst du? 🍳",
         "#deutschlernen #learngerman #küche", "", "Reuses the English kitchen images", ""],
    ],
}

LANG_COLUMNS = ["Sheet", "Language code", "Enabled", "Flag", "Voice provider", "Voice", "Question title",
                "Comment prompt", "CTA headline", "CTA subheadline", "CTA button", "CTA footer",
                "Video folder", "Default hashtags"]
LANGUAGES = [
    ["English", "en-US", "TRUE", "us", "piper", "en_US-lessac-medium", "What is this called?",
     "Let me know in the comments!", "Way more than vocab", "All inside fluenthub.app", "DOWNLOAD NOW!",
     "LINK IN PROFILE", "english", "#learnenglish"],
    ["German", "de-DE", "TRUE", "de", "piper", "de_DE-thorsten-medium", "Wie heißt das?",
     "Schreib's in die Kommentare!", "Viel mehr als Vokabeln", "Alles in fluenthub.app", "JETZT LADEN!",
     "LINK IN DER BIO", "german", "#deutschlernen"],
]

BRAND = [
    ("name", "FluentHub", "Brand name (watermark fallback, CTA wordmark)"),
    ("website", "fluenthub.app", "Shown in the watermark pill"),
    ("primaryColor", "#1d3b40", "Hex color"),
    ("accentColor", "#43a41a", "Hex color"),
    ("wordmark", "Fluent,Hub", "Two-tone CTA name, comma separated"),
    ("logo", "", "Optional square logo URL"),
    ("ctaImage", "", "Optional CTA image URL (app screenshots / mockup, transparent PNG looks best)"),
    ("defaultTemplate", "vocab-quiz", "Used when a row's Template is empty"),
    ("defaultLayout", "classic", "Used when a row's Layout is empty"),
    ("quality", "standard", "draft | standard | high"),
]

GUIDE = [
    "How a row becomes a video",
    "1. Add a row in the language tab (English, German, ...). One row = one video.",
    "2. Vocabs: one per line, as  word | IPA | image key . IPA and image key are optional.",
    "   The image key is language-neutral (e.g. alarm-clock) so all languages share the same picture.",
    "   Missing images are generated with AI once and stored in the image library; later rows reuse them.",
    "   In vocab-quiz the LAST vocab becomes the 'comment' card (its answer is not revealed).",
    "3. Published name = file name of the video (e.g. en-bedroom-01). It is stored as <video folder>/<name>.mp4.",
    "4. Set Status to 'ready'. n8n picks the ready row with the earliest Publish date, sets it to 'rendering',",
    "   and writes back Video URL, Thumbnail URL, Duration, Images generated, Rendered at, Job ID (status 'rendered'),",
    "   or the Error (status 'failed'). Fix the row and set it to 'ready' again to retry.",
    "5. Title empty = the language's Question title (Languages tab). Options (JSON) can override anything in",
    "   the render request, e.g. {\"data\": {\"sounds\": {\"reveal\": \"pop\"}}}.",
    "6. Platforms, Caption, Hashtags, First comment, Published URL/at are for the publishing workflow.",
    "7. Languages tab, Voice provider: piper (free, voice = model name), openrouter (ElevenLabs via OpenRouter,",
    "   voice = george / rachel / any ElevenLabs voice ID) or elevenlabs (direct). Pick an ElevenLabs model with",
    "   Options (JSON): {\"voice\": {\"options\": {\"model\": \"elevenlabs/eleven-v4\"}}}.",
    "Column colors: dark blue = you fill in, grey = written by the render workflow, purple = publishing workflow.",
]


def header(ws, names, fills=None, widths=None):
    for i, name in enumerate(names, 1):
        c = ws.cell(row=1, column=i, value=name)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=(fills[i - 1] if fills else "1F3B4D"))
        c.alignment = Alignment(vertical="center", wrap_text=True)
        if widths:
            ws.column_dimensions[get_column_letter(i)].width = widths[i - 1]
    ws.freeze_panes = "B2" if names[0] == "ID" else "A2"
    ws.row_dimensions[1].height = 30


def dropdown(ws, col_letter, source):
    dv = DataValidation(type="list", formula1=source, allow_blank=True)
    ws.add_data_validation(dv)
    dv.add(f"{col_letter}2:{col_letter}1000")


wb = Workbook()
wb.remove(wb.active)

lists = None
for lang, rows in ROWS.items():
    ws = wb.create_sheet(lang)
    header(ws, [c[0] for c in VIDEO_COLUMNS], [HEADER_FILL[c[2]] for c in VIDEO_COLUMNS], [c[1] for c in VIDEO_COLUMNS])
    for r in rows:
        ws.append(r + [""] * (len(VIDEO_COLUMNS) - len(r)))
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(vertical="top", wrap_text=True)
    for row in ws.iter_rows(min_row=2, min_col=9, max_col=9):
        for c in row:
            c.number_format = "yyyy-mm-dd hh:mm"
    names = [c[0] for c in VIDEO_COLUMNS]
    col = lambda n: get_column_letter(names.index(n) + 1)
    dropdown(ws, col("Status"), f"=Lists!$A$2:$A${len(STATUSES) + 1}")
    dropdown(ws, col("Template"), f"=Lists!$B$2:$B${len(TEMPLATES) + 1}")
    dropdown(ws, col("Layout"), f"=Lists!$C$2:$C${len(LAYOUTS) + 1}")

ws = wb.create_sheet("Languages")
header(ws, LANG_COLUMNS, widths=[12, 13, 9, 7, 13, 22, 22, 28, 22, 24, 16, 18, 13, 22])
for r in LANGUAGES:
    ws.append(r)

ws = wb.create_sheet("Brand")
header(ws, ["Key", "Value", "Notes"], widths=[18, 30, 70])
for r in BRAND:
    ws.append(list(r))

ws = wb.create_sheet("Lists")
header(ws, ["Status", "Template", "Layout", "Platform"], widths=[14, 14, 12, 14])
for i in range(max(len(STATUSES), len(TEMPLATES), len(LAYOUTS), len(PLATFORMS))):
    ws.append([
        STATUSES[i] if i < len(STATUSES) else None,
        TEMPLATES[i] if i < len(TEMPLATES) else None,
        LAYOUTS[i] if i < len(LAYOUTS) else None,
        PLATFORMS[i] if i < len(PLATFORMS) else None,
    ])

ws = wb.create_sheet("Guide")
ws.column_dimensions["A"].width = 120
for i, line in enumerate(GUIDE, 1):
    c = ws.cell(row=i, column=1, value=line)
    if i == 1:
        c.font = Font(bold=True, size=14)

wb.save(OUT)
print(OUT)
