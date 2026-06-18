# Hogwarts Español — Agent Guide

> **Keep this file current.** Update AGENTS.md whenever you change any file — module contents, state shape, new exports, known issues. Stale docs cause bugs in future sessions.

## What this is

A Spanish learning app with a Harry Potter theme. Users have conversations with Hermione, Dumbledore, Hagrid, and Snape, powered by LLM APIs. Tracks vocabulary, grammar mistakes, streaks, and house points.

Built for a specific user (~A2/B1 Spanish, ~1.5 years Duolingo). Deployed on Cloudflare Pages.

## Coding principles

- **Fix the rule, not the instance.** Prefer systemic fixes (CSS rules, shared helpers, selector tightening) over point fixes (inline styles, one-off copy-paste, workarounds on single elements). If a bug can recur elsewhere, solve it at the source.
- Run `bash scripts/check.sh` after every batch of JS changes.

## File layout

```
hogwarts-espanol.html   ← HTML shell only. No JS, no CSS.
css/styles.css          ← All styles (~336 lines, static)
js/                     ← ES modules (22 files)
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
| Persisted state (S), runtime state (R), loadS/saveS, onSaveError | `js/state.js` |
| localStorage / window.storage abstraction | `js/storage.js` |
| Shared pure utilities (esc, showToast, normWords, weekStart, extractJSON…) | `js/helpers.js` |
| Character definitions, system-prompt assembly (`buildSys`, `getSys`) | `js/characters.js` |
| SVG portraits (static, rarely changes) | `js/portraits.js` |
| LLM router: Anthropic / Gemini / Groq | `js/llm.js` |
| API key persistence, provider selection, splash auth management (`splashEditKey`, `splashDeleteKey`, `removeCreds`, `savedKeyIndicator`) | `js/credentials.js` |
| Ambient music (gapless two-element preload), instant mute/unmute, UI beeps | `js/audio.js` |
| Text-to-speech (speak, speakFromBtn with rate, voice picker) | `js/tts.js` |
| Points, streak, level, achievements, HP milestones | `js/progress.js` |
| Daily challenges (gen + render) | `js/challenges.js` |
| sendMsg, message render, character select, hints, owl, retryLastMsg, updProviderBadge | `js/chat.js` |
| Side panel: vocab/grammar/mistakes tabs, flashcards, vocab CRUD, flashcard TTS | `js/sidepanel.js` |
| Error explain overlay: grammar mistake Q&A, loading states | `js/error-explain.js` |
| Minigame engine primitives (round, game, GAME_DIFF, award, wordDiffHtml, etc.) — leaf module | `js/game-core.js` |
| Minigame overlay routing only (imports from game-core.js) | `js/games.js` |
| Dictation game | `js/game-dictation.js` |
| Translation game | `js/game-translation.js` |
| Word-order game (drag-and-drop, requires SortableJS CDN) | `js/game-order.js` |
| Pensieve Memory Match (card-flip, Canvas particle engine) | `js/game-memory.js` |
| Canvas particle engine (ambient float + burst on match) | `js/particles.js` |
| Settings overlay: voice, model, llm log viewer | `js/settings.js` |
| All CSS | `css/styles.css` |

**Memory Match (game-memory.js) specifics:**
- **Vocab selection** (`smartWeightedPick`): weights by `ageDays×2 + mistakes×5 + random×10`, sorts descending, takes top `count×3`, shuffles those, picks `count` — prevents always selecting the same words
- **Random mode** (`setRandomMode` / "🎲 Aleatorio" checkbox): when enabled, `llmVocabAll(count)` generates all vocab fresh each game instead of drawing from `S.vocab`; `recentVocab` Set (RECENT_MAX=50) excludes recently used words across rounds
- **Difficulty**: easy=4 pairs, medium=6, hard=8
- **LLM fallback**: `llmVocab(count)` generates missing vocab when `S.vocab` has fewer entries than needed; dedup by lowercase `word`; silent on error/no key
- **Lobby flow**: `renderMemoryLobby()` is the tab entry point — shows difficulty selector, random-mode checkbox, and "▶ Empezar" button. `genMemory()` is only called when the button is pressed (no LLM on tab open). After board complete or skip, "Menú →" returns to the lobby. `renderMemoryLobby` must be on `window` (bound in `main.js`) because it is referenced from `onclick` in dynamically rendered HTML.
- **`genMemory()` is async** — may `await llmVocabAll()` or `await llmVocab()` depending on mode; request-id guard (`memReqId`) prevents stale responses from racing with rapid difficulty changes
- **Scoring**: 1 pt per matched pair (feedback only); `award('correct')` fires **once** at board completion (main pts + combo milestone); `pushLevelOutcome(true)` fires once at board completion; skip deducts 1 pt and counts as incorrect outcome
- **Card colors**: driven by `data-type="es"` / `data-type="en"` attribute on `.memory-card`; CSS attribute selectors `[data-type="es"] .memory-card-front` (gold gradient) / `[data-type="en"] .memory-card-front` (blue gradient); same for `.memory-card-back` (parchment gold vs blue-grey)
- **Imports**: `callLLM` from `llm.js`, `extractJSON`/`showToast` from `helpers.js`, `R`/`saveS` from `state.js`

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
  modelPrefs: {anthropic:'', gemini:'', groq:'', openai:''},
  achievements: {streak, msgs, vocab, challenges, pts, hp_firstYear, hp_quidditch, hp_merlin, hp_champion},
  levelWindow: bool[],       // last 30 correct/incorrect outcomes
  gameDifficulty: 'easy'|'medium'|'hard',
  musicOff: false,           // persisted music on/off state
  ttsOff: false,             // persisted TTS mute state (use !==undefined check in loadS)
  currentHints: {hermione:[], dumbledore:[], hagrid:[], snape:[]},  // persisted reply-suggestion hints per character
  version: 2                 // schema version stamp
}
```

**loadS() migration rules:**
- Boolean fields need `if(d.field!==undefined)S.field=d.field` — never `if(d.field)` or `false` is lost
- `musicOff` was previously missing from loadS() and always defaulted to `false` after reload (fixed)

## Runtime state object (`R`) — session only

```js
R = {
  cur: 'hermione',             // active character key
  provider: 'groq',            // 'anthropic'|'gemini'|'groq'|'openai'
  keys: {anthropic, gemini, groq, openai},  // in-memory API keys
  cachedCreds: {},             // saved creds from hp_creds storage
  loading: false,              // true while an LLM call is in flight
  llmLog: []                   // session-only query log (capped 50, cleared on reload)
}
```

`R` is exported from `state.js`. Mutate `R.x` directly — modules share the same object reference via ES `import {R}`.

## Responsive design

Five breakpoints in `css/styles.css`:

| Breakpoint | What it does |
|-----------|------|
| `max-height:550px` | Compact mode — shrinks header, ctabs, challenge bar, input area, message bubbles for short viewports |
| `max-width:600px` | Mobile — side panel becomes a slide-in drawer with scrim; `#sideBtn` visible; header title + streak label hidden |
| `601px–819px` | Tablet — side panel narrowed to 148px; reduced font sizes and padding in the side panel |
| `820px` (min) | Wide — `.pensieve-grid` expands to `max-width:704px` (was `width:740px` on the card itself before `clamp()` took over) |
| `1100px` (min) | Extra-large — `.wrap` grows to `max-width:1100px`; side panel 230px; larger portraits (48px), message font (14px), input buttons (38px), memory cards (90px) |

Overlay cards (`.settings-card`, `.fc-card`, `.settings-card--games`, `.achievements-card`, `.ee-card`) use `clamp()` to scale proportionally with viewport width — no fixed `px` widths.

Memory Match grid: at ≥820px, the inline JS sets `grid-template-columns: repeat(${Math.min(totalPairs, 4)}, 1fr)` — capped at 4 columns to prevent unreadable narrow cards on hard difficulty (8 pairs).

The `.wrap` container no longer has `max-height:800px` — it uses the full viewport height via `height:100vh`.

## How ES modules + inline HTML work together

The HTML has ~50 `onclick="fnName()"` attributes. Module scope is not global, so `main.js` assigns every HTML-referenced function to `window` in a documented block at the bottom. If you add a new `onclick` in the HTML, add the matching binding in `main.js`'s `Object.assign(window, {...})` block.

## Characters

| Character | Style | JSON default pts | sys prompt persona line |
|-----------|-------|-----------------|------------------------|
| Hermione  | Precise, bookish, friendly but exacting | 5 | see `characters.js` `chars.hermione` |
| Dumbledore| Poetic, wise, philosophical | 7 | `chars.dumbledore` |
| Hagrid    | Enthusiastic, warm, animal-obsessed (richer vocab) | 4 | `chars.hagrid` |
| Snape     | Sarcastic, corrects everything, no mercy | 6 | `chars.snape` |

System prompts are assembled at call time by `getSys(k)` in `characters.js`, which is **provider-aware** (branches on `R.provider`): Groq gets terse/directive framing, Gemini moderate, Anthropic/OpenAI the richest persona. Each character stores a `persona` (with a `{{LV}}` placeholder) and a JSON `shape`; the shared rules — `SPELL_RULE`, `SCORING_RULE` (anti-farming: `points:0` for non-effort but **no** mood punishment), `CONVO_RULE` (be proactive, end with a question), `OPTIONS_RULE`, and `VARIETY_RULE` (anti-repetition — applied in all three provider branches) — live **once** in `characters.js`. Each `shape` includes an `options` array (2-3 learner-POV reply suggestions); `getSys(k)` appends the daily-challenge line **only if the challenge for that character is not yet completed** (saves tokens). Reply-suggestion chips are rendered via `renderHints()`/`#hintsR` UI from the LLM `options` field and are **persisted** in `S.currentHints` per character (saved in `sendMsg` and `genStarter`; restored on `selChar`/page reload). Static hints (`chars[k].hints`) are shown by `showHints()` as a fallback when no persisted hints exist for the character. `genStarter` seeds the user turn with a random HP scenario (`SEEDS` array in `chat.js`) so openers vary across resets.

## LLM providers

| Provider | Key (`R.keys.X`) | Default model | Notes |
|----------|-----------------|---------------|-------|
| Anthropic | `R.keys.anthropic` | `claude-opus-4-8` | Effort via `output_config:{effort}` (NOT `thinking`). Haiku skips effort param. Opus 4.8 uses adaptive thinking — `thinking:{type:'enabled'}` returns 400. |
| Gemini | `R.keys.gemini` | `gemini-2.5-flash` | Falls back to `gemini-2.5-flash-lite` on 429 |
| Groq | `R.keys.groq` | `llama-3.3-70b-versatile` | OpenAI-compatible |
| OpenAI | `R.keys.openai` | `gpt-4.1-mini` | OpenAI-compatible, same format as Groq |

Valid effort values: `low`, `medium`, `high`, `xhigh`, `max` — passed as `output_config:{effort}` in the Anthropic request body. Conversation (`sendMsg`) and error explanations use `'medium'` effort; conversation starters and daily challenges use `'low'`. Effort is consumed only by the Anthropic path. Groq and Gemini set `temperature:0.9`; Anthropic accepts no temperature (Opus 4.8 returns 400 on it).

All three providers use `fetchWithTimeout` (30s) defined in `llm.js`. `AbortError` is non-retryable.

## Daily challenges

`CHALLENGE_PROMPT` in `challenges.js`: single batch LLM call → `S.challenges[today]` keyed by ISO date. Each challenge: `{challenge, focus, exampleOpener}`. Done: `S.challengeDone['charKey_YYYY-MM-DD']` (pruned 14d) + `S.challengesCompleted` (persistent, never pruned). Challenge is only injected into the LLM system prompt via `getSys()` when **not yet completed** for that character (token saving). When a challenge is completed, the `.chal` div is hidden entirely (not just relabeled).

## Settings / overlays

The app has **four separate overlays**, each with its own `<div class="settings-ov">` in the HTML:

- **`settingsOv`** — 3-tab settings card + auth button:
  - **🔊 Voz** — TTS voice picker; male/female; test button
  - **🧠 Modelo** — per-provider model selector (reads `R.provider`)
  - **📋 Log** — in-memory LLM query log viewer; click to expand prompt/response; clear button; dropped on reload
  - **🔑 Gestionar cuentas →** — opens splash overlay for full auth management (providers, keys, saved-key pattern with Cambiar/Eliminar)
- **Header provider badge** — `#pvdBadge` element updated by `updProviderBadge()` (exported from `chat.js`, called by `setProvider` in `credentials.js` and `updHeaderAll`)
- **`achievementsOv`** — HP milestones (top) + stat achievement bars (bottom); opened via header trophy icon
- **`gamesOv`** — 4-tab minigames card: Dictado / Traducción / Orden / Pensieve
- **`fcOv`** — flashcard overlay

## Minigames

Four games, each in its own file. All share engine state from `game-core.js`:

| Game | File | How checked |
|------|------|-------------|
| Dictation | `game-dictation.js` | Sync word-diff (`normWords`) |
| Translation | `game-translation.js` | Async LLM verdict |
| Word order | `game-order.js` | Sync word-position compare; requires SortableJS CDN |
| Pensieve Memory | `game-memory.js` | Sync pair-id compare (no LLM); Canvas particle engine from `particles.js` |

`round` and `game` objects are exported from `game-core.js` and mutated in place by all four game files. Each game imports `pushLevelOutcome` directly from `progress.js` — **do not route through `window`**. All four games call `saveS()` explicitly after scoring (board complete or skip).

## Auth / credentials

- `hp_creds` stores `{groq, openai, anthropic, gemini, last}` in storage
- `prefillCreds()` runs at page load; returns `true` if autologin; `main.js` hides `.sp-key` and changes the button to "Continuar →" (calls `enterApp(true)` on click)
- All providers' keys are loaded into `R.keys` on autologin
- Provider default: if saved last-provider has no key, falls back to Groq
- **Splash is the auth hub**: provider selection, key input with saved-key pattern (✓ Guardada / Cambiar / Eliminar), and per-provider descriptions with "conseguir clave →" links
- `showSplashAuth()` (from settings "Gestionar cuentas →" button) pre-fills saved keys and changes splash button to "Guardar"; `hideSplashAuth()` returns to app
- Per-provider key deletion via `splashDeleteKey(p)` / `removeCreds(p)` — no reload needed
- Provider order on splash: Groq → OpenAI → Anthropic → Gemini
- Provider labels: Groq "✦ Gratis", OpenAI "★ Recomendado", Gemini "✦ Gratis"
- `validateProviderKey()` in `settings.js` handles all 4 providers for splash key validation

## Persistence

- Storage: `window.storage` (artifact) checked first, then `localStorage`
- Keys: `hp_v1` (state S), `hp_creds` (API keys)
- Pruning on save: vocab ≤200, mistakes ≤60, grammar ≤80, hist ≤25/char, challenges/challengeDone pruned to 14 days
- `kvSet` now propagates errors (no silent catch). `saveS` catches them and calls the `onSaveError` callback registered in `main.js` (shows a toast). To register: `import {onSaveError} from './state.js'` then `onSaveError(cb)`.

## Known issues

- **Voice input** — Chrome/Edge only (`webkitSpeechRecognition`); Safari/Firefox unsupported (shows Spanish toast instead of alert)

## Fixed issues (pitfall reference)

- **`S.musicOff` not restored on reload** — `if(d.field)` silently skips `false`. Boolean state must use `if(d.field!==undefined)S.field=d.field`. Fixed in `state.js` `loadS()`.
- **Challenge-achievement counter decaying** — `achievementMetrics().challenges` was counting `S.challengeDone` (pruned to 14 days), making the progress bar slide back. Fixed with persistent `S.challengesCompleted` counter in `state.js`/`chat.js`.
- **Case-sensitive vocab dedup** — `sendMsg` used `===` while `addVocabWord` used `toLowerCase`. Unified in `vocabExists()` in `sidepanel.js`, imported by `chat.js`.
- **Anthropic `thinking` param wrong shape** — `{type:'enabled',effort}` returns 400 on Opus 4.8. Correct: use `output_config:{effort}` at request top level.
- **`extractJSON` array branch dead** — object branch (`{`) ran first for array-of-objects responses (daily challenges), slicing from `{` to `}` and dropping the `[]` wrapper. Fixed: check which delimiter appears first; array wins if `[` comes before `{`. Also strips trailing commas before parsing.
- **No fetch timeout** — hung TCP connection kept `R.loading=true` forever, locking the send button. Fixed: `fetchWithTimeout` (30s `AbortController`) in `llm.js`; `AbortError` is non-retryable.
- **Autologin audio** — music starts on the first user interaction (any click or keypress) via a persistent global listener. `tryPlayNow()` attaches the listener; `_ensurePlayback()` resumes the `AudioContext` and plays if not muted.
- **Suspended `AudioContext` → silent beeps** — the context was created at page load (before any gesture) and never resumed, so UI beeps could stay muted forever. Fixed: `_resumeAudioContext()` (called from the interaction handler, `_ensurePlayback`, and unmute) resumes when `state==='suspended'`. Beeps never check `isMuted` — mute affects music only.
- **`onerror` infinite advance loop** — a failing track advanced to the next, which also failed, cycling forever (offline / bad paths). Fixed: `_failCount` gives up after one full playlist cycle; reset on `oncanplay`.
- **Silent `saveS` failures** — `kvSet` swallowed all errors; quota exceeded caused silent data loss. Fixed: `kvSet` propagates errors; `saveS` catches and calls `onSaveError` callback (wired to a toast in `main.js`).
- **`esc()` didn't escape quotes** — `"` in vocab words could break `value="..."` attributes (self-XSS path to API key theft). Fixed: `esc()` now escapes `"` → `&quot;`.
- **`window.pushLevelOutcome` global** — game files read `pushLevelOutcome` via `window` (set by a dynamic import in `main.js`). Fixed: each game file imports `pushLevelOutcome` directly from `progress.js`.
- **`window.dictSentence` global** — dictation speak buttons used `onclick="speak(dictSentence)"` with a `window` variable. Fixed: buttons now use `data-txt`/`data-rate` attributes with `speakFromBtn(this)`.
- **Translation game race** — skip/hint buttons stayed active during async `checkTranslation` LLM call; rapid skip could corrupt scoring. Fixed: all `.vadd-row` buttons disabled at check start, re-enabled on error.
- **Sortable CDN silent failure** — if `cdn.jsdelivr.net` unavailable, `new Sortable(...)` threw uncaught in `setTimeout`. Fixed: `initSortable` guards `typeof Sortable==='undefined'` and shows an error message.
- **English `alert()` for mic** — unsupported-browser message was in English. Fixed: uses Spanish `showToast` instead.
- **Mobile layout** — 186px side panel cramped chat on narrow screens. Fixed (D1): responsive drawer with scrim; `#sideBtn` shows on mobile only.
- **TTS always-on** — speech fired on every message with no mute toggle. Fixed: `S.ttsOff` flag + "Leer respuestas en voz alta" checkbox in the Voz settings tab (`settings.js` `setTtsOff`).

## Common pitfalls

- **Boolean state in loadS()** — use `!==undefined` check, not truthiness
- **New `onclick` in HTML** — must add matching `window.X = fn` in `js/main.js`'s `Object.assign` block
- **Circular imports** — `state.js`, `helpers.js`, and `storage.js` are leaf modules; keep them dependency-free. `game-core.js` is also a leaf; `game-*.js` files import engine primitives from it, never vice versa. `games.js` is a pure router that re-exports game functions — `game-*.js` files must not import from `games.js`.
- **API history cap** — `sendMsg()` slices to `.slice(-25)` before every call; don't add extra slicing
- **Gemini message format** — role is `'model'` not `'assistant'`; handled in `callGeminiModel` in `llm.js`
- **`window.storage` in artifacts** — must be checked first in all storage reads/writes; already handled by `storage.js` `kvGet`/`kvSet`
- **`R.loading`** — set in `chat.js` `sendMsg()`; guards against double-submit; do not reset elsewhere
- **Focus trap** — `main.js` keydown handler traps Tab within open overlays (settings, games, achievements, error explain, flashcards); add new overlays to the `overlays` array if needed
- **`speakFromBtn` rate** — `tts.js` `speakFromBtn` reads `btn.dataset.rate` (optional float). Use `data-rate="0.55"` on slow-speak buttons instead of inline `speak(x, 0.55)` calls.

## Verification

After any JS change, run:
```bash
bash scripts/check.sh
```
This checks syntax (`node --check`) on every `js/*.js` file and verifies the ES module import graph resolves (excluding `main.js` which needs `window`).

## Deploy

```bash
# Only if audio files changed:
node -e "const fs=require('fs');fs.writeFileSync('audio/manifest.json',JSON.stringify(fs.readdirSync('audio').filter(f=>f.toLowerCase().endsWith('.mp3')).sort(),null,2)+'\n')"

# Deploy to Cloudflare Pages:
npx wrangler pages deploy . --project-name=hogwarts-espanol
```

No build step. Cloudflare Pages serves ES modules fine over HTTPS.
