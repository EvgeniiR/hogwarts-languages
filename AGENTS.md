# Hogwarts Español — Agent Guide

> **Keep this file current.** Update AGENTS.md whenever you change any file — module contents, state shape, new exports, known issues. Stale docs cause bugs in future sessions.

## What this is

A Spanish learning app with a Harry Potter theme. Users have conversations with Hermione, Dumbledore, Hagrid, and Snape, powered by LLM APIs. Tracks vocabulary, grammar mistakes, streaks, and house points.

Built for a specific user (~A2/B1 Spanish, ~1.5 years Duolingo). Deployed on Cloudflare Pages.

## File layout

```
hogwarts-espanol.html   ← HTML shell only. No JS, no CSS.
css/styles.css          ← All styles (~150 lines, static)
js/                     ← ES modules (16 files)
audio/                  ← Ambient MP3s + manifest.json
index.html              ← Redirects to hogwarts-espanol.html
DEPLOY.md               ← Deploy instructions
AGENTS.md               ← This file
```

## Which file for which feature

When editing a feature, load **only this file** — not the whole project.

| Feature | File |
|---------|------|
| App entry point, init, window bindings | `js/main.js` |
| Persisted state (S), runtime state (R), loadS/saveS | `js/state.js` |
| localStorage / window.storage abstraction | `js/storage.js` |
| Shared pure utilities (esc, showToast, normWords, weekStart…) | `js/helpers.js` |
| Character definitions, system-prompt assembly (`buildSys`, `getSys`) | `js/characters.js` |
| SVG portraits (static, rarely changes) | `js/portraits.js` |
| LLM router: Anthropic / Gemini / Groq | `js/llm.js` |
| API key persistence, provider selection | `js/credentials.js` |
| Ambient music, drone synth, UI beeps | `js/audio.js` |
| Text-to-speech (speak, voice picker) | `js/tts.js` |
| Points, streak, level, achievements, HP milestones | `js/progress.js` |
| Daily challenges (gen + render) | `js/challenges.js` |
| sendMsg, message render, character select, hints, owl | `js/chat.js` |
| Side panel: vocab/grammar/mistakes tabs, flashcards, vocab CRUD | `js/sidepanel.js` |
| Minigames: dictation + translation (unified engine) | `js/games.js` |
| Settings overlay: voice, model, auth, achievements | `js/settings.js` |
| All CSS | `css/styles.css` |

**For cross-cutting changes** (e.g. a new state field), you'll need `state.js` + the module(s) that read/write it.

## Development server (required)

ES modules do **not** load over `file://`. Always serve over HTTP:

```bash
python3 -m http.server 8787
# or: npx serve .
```

Then open http://localhost:8787/hogwarts-espanol.html

## State object (`S`) — persisted

```js
S = {
  vocab: [{word, def, ts}],
  mistakes: [{wrong, right, note, ts, source}],
  grammar: [{ch, text, ts}],
  weeklyPts: number,         // weekly cap 200; resets each ISO Monday
  dailyEarned: number,       // resets daily; ≥50 qualifies streak
  currentWeek: 'YYYY-Www',
  lastActiveDate: 'YYYY-MM-DD',
  lifetimePts: number,       // uncapped, used for HP milestones
  totalMsgs: number,         // drives level progression
  streak: {count, lastDate},
  level: 0|1|2,              // 0=A2, 1=B1, 2=B1+
  moods: {hermione:0-4, ...},
  hist: {hermione:[], ...},  // capped at 25 msgs/char on saveS()
  challenges: {              // keyed by date
    'YYYY-MM-DD': {hermione:{challenge,focus,exampleOpener}, ...}
  },
  challengeDone: {'charKey_YYYY-MM-DD': true},  // pruned to 14 days
  challengesCompleted: number,  // PERSISTENT lifetime counter (not pruned)
  voicePrefs: {f:'', m:''},
  modelPrefs: {anthropic:'', gemini:'', groq:''},
  achievements: {streak, msgs, vocab, challenges, pts, hp_firstYear, hp_quidditch, hp_merlin, hp_champion},
  levelWindow: bool[],       // last 30 correct/incorrect outcomes
  gameDifficulty: 'easy'|'medium'|'hard',
  musicOff: false            // persisted music on/off state
}
```

**loadS() migration rules:**
- Boolean fields need `if(d.field!==undefined)S.field=d.field` — never `if(d.field)` or `false` is lost
- `musicOff` was previously missing from loadS() and always defaulted to `false` after reload (fixed)

## Runtime state object (`R`) — session only

```js
R = {
  cur: 'hermione',             // active character key
  provider: 'groq',            // 'anthropic'|'gemini'|'groq'
  keys: {anthropic, gemini, groq},  // in-memory API keys
  cachedCreds: {},             // saved creds from hp_creds storage
  loading: false               // true while an LLM call is in flight
}
```

`R` is exported from `state.js`. Mutate `R.x` directly — modules share the same object reference via ES `import {R}`.

## How ES modules + inline HTML work together

The HTML has ~50 `onclick="fnName()"` attributes. Module scope is not global, so `main.js` assigns every HTML-referenced function to `window` in a documented block at the bottom. If you add a new `onclick` in the HTML, add the matching binding in `main.js`'s `Object.assign(window, {...})` block.

## Characters

| Character | Style | JSON default pts | sys prompt persona line |
|-----------|-------|-----------------|------------------------|
| Hermione  | Precise, bookish, friendly but exacting | 5 | see `characters.js` `chars.hermione` |
| Dumbledore| Poetic, wise, philosophical | 7 | `chars.dumbledore` |
| Hagrid    | Enthusiastic, simple vocab, animal-obsessed | 4 | `chars.hagrid` |
| Snape     | Sarcastic, corrects everything, no mercy | 6 | `chars.snape` |

System prompts are assembled by `buildSys(persona, jsonShape)` in `characters.js`. The shared spell rule and `PUNTUACIÓN OBLIGATORIA` anti-farming rule live **once** in `buildSys` — edit there, not 4× in each character. `getSys(k)` appends the daily challenge line at call time.

## LLM providers

| Provider | Key (`R.keys.X`) | Default model | Notes |
|----------|-----------------|---------------|-------|
| Anthropic | `R.keys.anthropic` | `claude-opus-4-8` | Effort via `output_config:{effort}` (NOT `thinking`). Haiku skips effort param. Opus 4.8 uses adaptive thinking — `thinking:{type:'enabled'}` returns 400. |
| Gemini | `R.keys.gemini` | `gemini-2.5-flash` | Falls back to `gemini-2.5-flash-lite` on 429 |
| Groq | `R.keys.groq` | `llama-3.3-70b-versatile` | OpenAI-compatible |

Valid effort values: `low`, `medium`, `high`, `xhigh`, `max` — passed as `output_config:{effort}` in the Anthropic request body.

## Daily challenges

`CHALLENGE_PROMPT` in `challenges.js`: single batch LLM call → `S.challenges[today]` keyed by ISO date. Each challenge: `{challenge, focus, exampleOpener}`. Done: `S.challengeDone['charKey_YYYY-MM-DD']` (pruned 14d) + `S.challengesCompleted` (persistent, never pruned).

## Settings tabs

- **🔊 Voz** — TTS voice picker; male/female; test button
- **🧠 Modelo** — per-provider model selector (reads `R.provider`)  
- **🔑 Cuenta** — API key management; green-dot indicator; instant validation (`validateProviderKey`); hidden-input "Cambiar" pattern
- **🏆 Logros** — HP milestones (top) + stat achievement bars (bottom)

## Auth / credentials

- `hp_creds` stores `{groq, gemini, anthropic, last}` in storage
- `prefillCreds()` runs at page load; returns `true` if autologin; `main.js` calls `enterApp()` on that
- All providers' keys are loaded into `R.keys` on autologin
- Provider default: if saved last-provider has no key, falls back to Groq

## Persistence

- Storage: `window.storage` (artifact) checked first, then `localStorage`
- Keys: `hp_v1` (state S), `hp_creds` (API keys)
- Pruning on save: vocab ≤200, mistakes ≤60, grammar ≤80, hist ≤25/char, challenges/challengeDone pruned to 14 days

## Known issues

- **Mobile layout** — 186px side panel cramps chat on narrow screens; no responsive breakpoint
- **JSON reliability** — Gemini occasionally breaks strict JSON output; `try/catch` fallback handles it
- **Voice input** — Chrome/Edge only (`webkitSpeechRecognition`); Safari/Firefox unsupported
- **Audio autoplay** — blocked until splash button click; don't call audio before `enterApp()`

## Fixed issues (pitfall reference)

- **`S.musicOff` not restored on reload** — `if(d.field)` silently skips `false`. Boolean state must use `if(d.field!==undefined)S.field=d.field`. Fixed in `state.js` `loadS()`.
- **Challenge-achievement counter decaying** — `achievementMetrics().challenges` was counting `S.challengeDone` (pruned to 14 days), making the progress bar slide back. Fixed with persistent `S.challengesCompleted` counter in `state.js`/`chat.js`.
- **Case-sensitive vocab dedup** — `sendMsg` used `===` while `addVocabWord` used `toLowerCase`. Unified in `vocabExists()` in `sidepanel.js`, imported by `chat.js`.
- **Anthropic `thinking` param wrong shape** — `{type:'enabled',effort}` returns 400 on Opus 4.8. Correct: use `output_config:{effort}` at request top level (no `thinking` field needed for adaptive thinking).

## Common pitfalls

- **Boolean state in loadS()** — use `!==undefined` check, not truthiness
- **New `onclick` in HTML** — must add matching `window.X = fn` in `js/main.js`'s `Object.assign` block
- **Circular imports** — `state.js` and `helpers.js` are the only leaf modules; keep them dependency-free
- **API history cap** — `sendMsg()` slices to `.slice(-25)` before every call; don't add extra slicing
- **Gemini message format** — role is `'model'` not `'assistant'`; handled in `callGeminiModel` in `llm.js`
- **`window.storage` in artifacts** — must be checked first in all storage reads/writes; already handled by `storage.js` `kvGet`/`kvSet`
- **`R.loading`** — set in `chat.js` `sendMsg()`; guards against double-submit; do not reset elsewhere

## Deploy

```bash
# Only if audio files changed:
node -e "const fs=require('fs');fs.writeFileSync('audio/manifest.json',JSON.stringify(fs.readdirSync('audio').filter(f=>f.toLowerCase().endsWith('.mp3')).sort(),null,2)+'\n')"

# Deploy to Cloudflare Pages:
npx wrangler pages deploy . --project-name=hogwarts-espanol
```

No build step. Cloudflare Pages serves ES modules fine over HTTPS.
