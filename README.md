# Two Lenses

**Paste one news video. See how other outlets covered the same event, side by side, and where the framing differs.**

Built at the Gemini 4 Argon hackathon (Problem Statement Two: *More Dimensions*): a system that generates a media-literacy explainer, **renders it, watches the result, critiques it against the goal, and fixes it in a loop**.

Most people see one outlet's version of a story. On the same day in October 2026, the same 400,000 people in France were "**rioters**" in one report and "**for the most part peaceful and large**" in another. Two Lenses makes that difference visible, with timestamps, so a viewer (or a teacher running a media-literacy class) can check it themselves.

## How it works

```
paste a link ─► find sources ─► analyze ─► render ─► watch & critique ─► fix ─┐
                                              ▲                                │
                                              └──────── until it passes ───────┘
```

1. **Find sources.** Reads the video's metadata, writes neutral search queries, searches YouTube, ranks candidates (preferring outlets with a different perspective), downloads them. Links already in the local library resolve offline.
2. **Analyze.** Gemini 4 Argon watches every report in full (long-video understanding, all sources in one context) and pairs the *moments* that answer the same question: first words, stated cause, who gets to explain, how bad it was, why viewers should care. Each segment gets a verbatim quote, timestamps, and a named framing technique.
3. **Render.** The explainer player (`player/`) plays both outlets in sync with annotations; headless Chrome records it to video.
4. **Watch & critique.** Two critics:
   - **Deterministic checks** (`src/checks.js`): every quote must appear in the captions inside its clip (fuzzy, filler-tolerant), every outlet in a moment gets the same scrutiny, notes are short enough to read.
   - **Argon** watches the *rendered recording* plus the sources and scores **grounding**, **fairness** and **readability**, with timestamped issues.
5. **Fix.** Argon patches the explainer (re-finding timestamps and quotes in the sources) and the loop re-renders until no errors remain.

The fairness criterion is deliberate: the critic flags any moment where one outlet gets scrutiny and the other doesn't. Outlets get neutral colors (amber, teal), never red/blue.

## Run it

Requires Node 22+, ffmpeg, yt-dlp, and Google Chrome (Playwright uses it to decode H.264).

```bash
npm install
npx playwright install ffmpeg
echo 'GEMINI_API_KEY=...' > .env      # without a key, a stub model runs the bundled sample
npm run serve                          # http://localhost:4317
```

Fetch the sample videos (git-ignored for copyright) using the IDs in [`samples/france-protests/README.md`](samples/france-protests/README.md):

```bash
cd samples/france-protests
yt-dlp -f "bv*[height<=480][ext=mp4]+ba[ext=m4a]" --merge-output-format mp4 \
  --write-info-json --write-auto-subs --sub-langs en -o "fox_see-it-violent.%(ext)s" -- axeGlqVhwks
# …same for the other IDs/filenames in the table
```

CLI:

```bash
npm run loop                                         # curated France sample
node src/loop.js --url "https://youtu.be/<id>"       # any video: discover → analyze → loop
node src/loop.js samples/france-protests/set.json --maxSeg 6   # quick preview clips
```

## Layout

| Path | What |
|---|---|
| `launch/` | Paste-a-link landing page |
| `viewer/` | Live loop view: stepper, coverage found, scores per iteration, before → after diffs |
| `player/` | The explainer itself (interactive, or `mode=reel` for recording) |
| `src/loop.js` | Orchestrates discover → analyze → render → critique → fix |
| `src/discover.js` | Finding alternative coverage (local library or YouTube) |
| `src/checks.js`, `src/captions.js` | Deterministic grounding / fairness / readability checks |
| `src/models/gemini.js` | Gemini 4 Argon: search queries, ranking, analysis, critique, fix |
| `src/models/stub.js` | Offline stand-in with a hand-written flawed draft (for demos without a key) |
| `prompts/` | Analyze, critique and fix prompts |

## License

MIT
