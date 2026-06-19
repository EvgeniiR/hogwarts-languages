# Hogwarts Español — Agent Guide

> **Keep this file current.** Update AGENTS.md whenever you change any file — module contents, state shape, new exports, known issues. Stale docs cause bugs in future sessions.

---

## Multi-mode agent loop (autonomous)

Every non-trivial task follows a structured 6-phase cycle (Clarify → Design → Design-Review → Plan → Code → Review) with dedicated subagents. See [opencode-agents/README.md](opencode-agents/README.md) for the full workflow process, phase descriptions, and model assignments.

---

## What this is

A Spanish learning app with a Harry Potter theme. Users have conversations with Hermione, Dumbledore, Hagrid, and Snape, powered by LLM APIs. Tracks vocabulary, grammar mistakes, streaks, and house points.

Built for a specific user (~A2/B1 Spanish, ~1.5 years Duolingo). Deployed on Cloudflare Pages.

## Coding principles

- **Ask, don't assume.** Before implementing a decision about defaults, labels, ordering, or user-facing choices, ask the user for their preference. Don't assume you know what they want.
- **Fix the rule, not the instance.** Prefer systemic fixes (CSS rules, shared helpers, selector tightening) over point fixes (inline styles, one-off copy-paste, workarounds on single elements). If a bug can recur elsewhere, solve it at the source.
- Run `bash scripts/check.sh` after every batch of JS changes.

## File layout

```
hogwarts-espanol.html   ← HTML shell only. No JS, no CSS.
css/styles.css          ← All styles (~362 lines, static)
js/                     ← ES modules (26 files)
audio/                  ← Ambient MP3s + manifest.json
index.html              ← Redirects to hogwarts-espanol.html
DEPLOY.md               ← Deploy instructions
AGENTS.md               ← This file
manifest.json           ← PWA manifest
sw.js                   ← Service worker (stale-while-revalidate for static assets)
icon-192.png            ← PWA icon 192×192
icon-512.png            ← PWA icon 512×512
```

## Which file for which feature

When editing a feature, load **only this file** — not the whole project.

| Feature | File |
|---------|------|
| App entry point, init, window bindings | `js/main.js` |
| Persisted state (S), runtime state (R), loadS/saveS, onSaveError | `js/state.js` |
| localStorage abstraction | `js/storage.js` |
| Shared pure utilities (esc, showToast, normWords, weekStart, extractJSON…) | `js/helpers.js` |
| Character definitions, system-prompt assembly (`buildSys`, `getSys`) | `js/characters.js` |
| SVG portraits (static, rarely changes) | `js/portraits.js` |
| LLM router: Groq / OpenAI / DeepSeek | `js/llm.js` |
| API key persistence, provider selection, splash auth management (`splashEditKey`, `splashDeleteKey`, `removeCreds`, `savedKeyIndicator`) | `js/credentials.js` |
| Ambient music (gapless two-element preload), instant mute/unmute, UI beeps | `js/audio.js` |
| Text-to-speech (speak, speakFromBtn with rate, voice picker) | `js/tts.js` |
| Points, streak, level, achievements, HP milestones | `js/progress.js` |
| Daily challenges (gen + render) | `js/challenges.js` |
| sendMsg, message render, character select, hints, owl, retryLastMsg, updProviderBadge | `js/chat.js` |
| Side panel: vocab/grammar/mistakes tabs, flashcards, vocab CRUD, flashcard TTS, SRS review, flashcard reverse mode | `js/sidepanel.js` |
| Error explain overlay: grammar mistake Q&A, loading states | `js/error-explain.js` |
| Minigame engine primitives (round, game, GAME_DIFF, award, wordDiffHtml, etc.) — leaf module | `js/game-core.js` |
| Minigame overlay routing only (imports from game-core.js) | `js/games.js` |
| Dictation game | `js/game-dictation.js` |
| Translation game | `js/game-translation.js` |
| Word-order game (drag-and-drop, requires SortableJS CDN) | `js/game-order.js` |
| Pensieve Memory Match (card-flip, Canvas particle engine) | `js/game-memory.js` |
| Canvas particle engine (ambient float + burst on match) | `js/particles.js` |
| Spaced repetition (vocab SRS — Leitner levels 0-4) | `js/srs.js` |
| Settings overlay: voice, model, llm log viewer, model comparison | `js/settings.js` |
| Model comparison debug tool (compareModels) | `js/model-compare.js` |
| Reading comprehension (El Profeta): RSS + LLM articles, quiz, recap | `js/reading.js` |
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
- **SRS integration**: `checkPair()` calls `srsPromote()` on the Spanish word's vocab entry on each correct match. `boardComplete()` saves state.

**Flashcards (`sidepanel.js`) specifics:**
- Spanish→English default, toggle to English→Spanish via `toggleFcReverse()` button in overlay header (updates to 🇬🇧→🇪🇸)
- `fcReverse` flag swaps `fcWord`/`fcDef` display and the button label
- TTS always speaks the Spanish word regardless of mode
- 800ms debounce prevents voice glitching on rapid flips
- "Toca para revelar →" hint hides after first flip, resets per session

**SRS / Spaced Repetition (`srs.js`) specifics:**
- Leitner-style: 5 levels (0=new, 1=1d, 2=3d, 3=7d, 4=30d/mastered)
- Vocab entries get `srsLevel` (0-4) and `srsNext` (epoch ms of next review)
- `state.js` `loadS()` migrates existing vocab — adds defaults for missing fields
- `game-memory.js` `checkPair()` promotes on correct pair match
- Side panel vocab tab: shows `📅 N` due-count badge + `▶ Repasar` button
- Inline review: one word at a time, `srsReveal()` shows definition, `srsAnswer(true/false)` promotes/demotes
- Review session ends when queue exhausted; `closeSrsReview()` exits early
- `startSrsReview`, `srsReveal`, `srsAnswer`, `closeSrsReview` are on `window`

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
  modelPrefs: {groq:'', openai:'', deepseek:''},
  achievements: {streak:0, msgs:0, vocab:0, challenges:0, pts:0},
  levelWindow: bool[],       // last 30 correct/incorrect outcomes
  gameDifficulty: 'easy'|'medium'|'hard',
  readingDifficulty: 'easy'|'medium'|'hard',  // persisted reading difficulty, defaults to medium
  musicOff: false,           // persisted music on/off state
  ttsOff: false,             // persisted TTS mute state (use !==undefined check in loadS)
  currentHints: {hermione:[], dumbledore:[], hagrid:[], snape:[]},  // persisted reply-suggestion hints per character
  readingArticles: [],          // pruned to last 10 on save; [{id,source,title,text,quiz,ts,completed,difficulty}]
  readingCompleted: 0,          // lifetime count of completed articles
  readingCompletedIds: {},      // article IDs that have been completed (prevents double points)
  repairProvider: 'groq',    // provider used for JSON repair (Groq always, or '' = main provider)
  lastChar: 'hermione',      // last active character, restored on reload
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
  provider: 'groq',            // 'groq' | 'openai' | 'deepseek'
  keys: {groq:'', openai:'', deepseek:''},  // in-memory API keys
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

The HTML has ~51 `onclick="fnName()"` attributes. Module scope is not global, so `main.js` assigns every HTML-referenced function to `window` in a documented block at the bottom. If you add a new `onclick` in the HTML, add the matching binding in `main.js`'s `Object.assign(window, {...})` block.

## Characters

| Character | Style | JSON default pts | sys prompt persona line |
|-----------|-------|-----------------|------------------------|
| Hermione  | Precise, bookish, friendly but exacting | 5 | see `characters.js` `chars.hermione` |
| Dumbledore| Poetic, wise, philosophical | 7 | `chars.dumbledore` |
| Hagrid    | Enthusiastic, warm, animal-obsessed (richer vocab) | 4 | `chars.hagrid` |
| Snape     | Sarcastic, corrects everything, no mercy | 6 | `chars.snape` |

System prompts are assembled at call time by `getSys(k)` in `characters.js`, which uses a single format for all providers (Groq/OpenAI/DeepSeek — all are OpenAI-compatible and Groq+DeepSeek enforce JSON at the API level via `response_format:json_object`). Each character stores a `persona` (with a `{{LV}}` placeholder) and a JSON `shape`; the shared rules — `SCORING_RULE` (anti-farming: `points:0` for non-effort but **no** mood punishment), `CONVO_RULE` (be proactive, end with a question), `OPTIONS_RULE`, and `VARIETY_RULE` (anti-repetition) — live **once** in `characters.js`. `buildSys(persona,shape)` assembles the prompt; `getSys(k)` appends the daily-challenge line **only if the challenge for that character is not yet completed** (saves tokens). Reply-suggestion chips are rendered via `renderHints()`/`#hintsR` UI from the LLM `options` field and are **persisted** in `S.currentHints` per character (saved in `sendMsg` and `genStarter`; restored on `selChar`/page reload). Static hints (`chars[k].hints`) are shown by `showHints()` as a fallback when no persisted hints exist for the character. `genStarter` seeds the user turn with a random HP scenario (`SEEDS` array in `chat.js`) so openers vary across resets.

## LLM providers

| Provider | Key (`R.keys.X`) | Default model | Notes |
|----------|-----------------|---------------|-------|
| Groq | `R.keys.groq` | `llama-3.3-70b-versatile` | OpenAI-compatible. `response_format:{type:'json_object'}` enforces valid JSON at API level. |
| DeepSeek | `R.keys.deepseek` | `deepseek-v4-flash` | OpenAI-compatible. Thinking mode ON by default — must set `thinking:{type:'disabled'}`. JSON enforced via `response_format`. |
| OpenAI | `R.keys.openai` | `gpt-4.1-mini` | OpenAI-compatible. |

All three providers use `fetchWithTimeout` (30s) defined in `llm.js`. `AbortError` is non-retryable. Groq and DeepSeek use `temperature:0.9` with `response_format:{type:'json_object'}`; OpenAI uses `temperature:0.9`.

## Daily challenges

`CHALLENGE_PROMPT` in `challenges.js`: single batch LLM call → `S.challenges[today]` keyed by ISO date. Each challenge: `{challenge, focus, exampleOpener}`. Done: `S.challengeDone['charKey_YYYY-MM-DD']` (pruned 14d) + `S.challengesCompleted` (persistent, never pruned). Challenge is only injected into the LLM system prompt via `getSys()` when **not yet completed** for that character (token saving). When a challenge is completed, the `.chal` div is hidden entirely (not just relabeled).

## Settings / overlays

The app has **five separate overlays**, each with its own `<div class="settings-ov">` in the HTML:

- **`settingsOv`** — 3-tab settings card + auth button + model comparison:
  - **🔊 Voz** — TTS voice picker; male/female; test button
  - **🧠 Modelo** — per-provider model selector (reads `R.provider`)
  - **📋 Log** — in-memory LLM query log viewer; click to expand prompt/response; clear button; dropped on reload
  - **🔑 Gestionar cuentas →** — opens splash overlay for full auth management (providers, keys, saved-key pattern with Cambiar/Eliminar)
  - **⚡ Comparar modelos** — parallel comparison across all available models with custom question + character selector
- **Header provider badge** — `#pvdBadge` element updated by `updProviderBadge()` (exported from `chat.js`, called by `setProvider` in `credentials.js` and `updHeaderAll`)
- **`achievementsOv`** — HP milestones (top) + stat achievement bars (bottom); opened via header trophy icon
- **`gamesOv`** — 4-tab minigames card: Dictado / Traducción / Orden / Pensieve
- **`readingOv`** — Reading comprehension: articles from 8 RSS feeds + 1 LLM-generated HP lore source, with 4-question quiz or written recap
- **`errExplainOv`** — grammar mistake Q&A overlay; opened from side-panel mistake list
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

- `hp_creds` stores `{groq, openai, deepseek, last}` in storage
- `prefillCreds()` runs at page load; returns `true` if autologin; `main.js` hides `.sp-key` and changes the button to "Continuar →" (calls `enterApp(true)` on click)
- All providers' keys are loaded into `R.keys` on autologin
- Provider default: if saved last-provider has no key, falls back to Groq
- **Splash is the auth hub**: provider selection, key input with saved-key pattern (✓ Guardada / Cambiar / Eliminar), and per-provider descriptions with "conseguir clave →" links
- `showSplashAuth()` (from settings "Gestionar cuentas →" button) pre-fills saved keys and changes splash button to "Guardar"; `hideSplashAuth()` returns to app
- Per-provider key deletion via `splashDeleteKey(p)` / `removeCreds(p)` — no reload needed
- Provider order on splash: Groq → DeepSeek → OpenAI
- Provider labels: Groq "Recomendado · Gratis", DeepSeek "Recomendado · Avanzado", OpenAI (bare)
- `validateProviderKey()` in `settings.js` handles all 3 providers for splash key validation

## Persistence

- Storage: `localStorage` via `storage.js` `kvGet`/`kvSet`
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

- **Boolean state in loadS()** — use `!==undefined` check, not truthiness. `if(d.field)` silently skips `false` and `0`.
- **New `onclick` in HTML** — must add matching `window.X = fn` in `js/main.js`'s `Object.assign` block
- **Circular imports** — `state.js`, `helpers.js`, and `storage.js` are leaf modules; keep them dependency-free. `game-core.js` is also a leaf; `game-*.js` files import engine primitives from it, never vice versa. `games.js` is a pure router that re-exports game functions — `game-*.js` files must not import from `games.js`.
- **API history cap** — `sendMsg()` slices to `.slice(-25)` before every call; don't add extra slicing
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
