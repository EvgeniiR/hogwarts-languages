# Hogwarts Español

A Spanish-practice web app where you hold conversations with Hermione, Dumbledore, Hagrid, and Snape. It tracks the vocabulary and grammar mistakes that come up while you chat, turns them into flashcards and spaced-repetition reviews, and wraps the whole thing in daily challenges, minigames, and house points.

The goal was a low-friction entry point for learners who want to use LLMs for practice but don't want to wrangle tools or subscriptions — bring an API key, pick a character, start talking.

**Live:** https://hogwarts-espanol.pages.dev

A working MVP, taken from concept to something deployed and usable day to day rather than a throwaway demo. The work was in owning it end to end: deciding what to build, what to cut, and sweating the details a prototype skips — UX, accessibility, asynchronous behavior, performance, and LLM token efficiency.

## What it does

- **Conversations with four characters**, each with a distinct persona, mood that shifts with the conversation, and an anti-farming scoring system so you can't grind points with one-word replies
- **Bring-your-own-key** across four LLM providers — Groq and Gemini (free tiers), OpenAI, and Anthropic — with timeouts, retries, and quota fallback
- **Automatic tracking** of new vocabulary and grammar mistakes pulled from your chats
- **Spaced repetition** (Leitner system) and **flashcards** with a reverse mode, built on top of the vocab you accumulate
- **Four minigames** — dictation, translation, word-order (drag and drop), and a Pensieve memory-match with a Canvas particle engine
- **Daily challenges, streaks, levels (A2 → B1+), achievements, and house points** to keep the loop going
- **Text-to-speech** for every reply and **voice input** for your side of the conversation
- **Ambient music**, gapless and mutable
- **Installable PWA** with offline-capable static assets and a fully responsive layout from phone to wide desktop

The UI is in Spanish on purpose — it's part of the immersion.

## How it's built

No framework, no build step — plain ES modules served as static files, with a few small CDN dependencies (web fonts, an icon set, and a drag-and-drop helper). Deployed to Cloudflare Pages by direct upload.

Built using AI coding agents (Claude Code and DeepSeek) as implementation tools, with architecture, feature planning, technical trade-offs, and review of every change directed by me. Scoped as an MVP, with no backend or build tooling added beyond what was needed to ship.

[`AGENTS.md`](AGENTS.md) is the working spec maintained through that process: state shapes, module boundaries, and a catalogue of every pitfall and its fix.

## Architecture highlights

- Provider abstraction unifying four LLM APIs behind one interface, with per-call timeouts, retries, and quota fallback
- Persistent client-side state with schema migrations
- Feature-oriented ES module structure with isolated ownership (24 modules)
- Installable PWA with a cache-first service worker for static assets
- Bring-your-own-key design that avoids any backend infrastructure

## Running it locally

ES modules don't load over `file://`, so you need an HTTP server:

```bash
npx live-server --port=8787
# or: python3 -m http.server 8787
```

Then open http://localhost:8787/hogwarts-espanol.html and paste in an API key for any one of the four providers (Groq's free tier is the quickest start).

After any change to `js/`, run the smoke test:

```bash
bash scripts/check.sh
```

It syntax-checks every module and verifies the import graph resolves. Deploy notes live in [`DEPLOY.md`](DEPLOY.md).

## Scope and limitations

These are conscious MVP trade-offs, not oversights:

- **Progress is per-device.** Everything is in `localStorage` — no accounts, no sync, and no export/backup yet. Clearing site data resets you. (An import/export of vocab + progress is the most obvious next step.)
- **The ambient music isn't in this repo.** The `audio/*.mp3` files are git-ignored to keep the repository light, so a fresh clone runs fine but silent. They're uploaded as part of the Cloudflare deploy.
- **API keys are stored client-side** in `localStorage` in plaintext. That's acceptable for a personal bring-your-own-key tool on your own device; it would not be for a multi-user product.
- **Voice input is Chrome/Edge only** (it uses `webkitSpeechRecognition`); other browsers fall back gracefully to typing.
- **Tests are a smoke check**, not a suite — syntax and module resolution, nothing behavioural.

## Disclaimer

This is a non-commercial fan project made for language practice. It is not affiliated with, endorsed by, or sponsored by Warner Bros., J.K. Rowling, or any rights holder of the Harry Potter universe. All referenced names and characters belong to their respective owners. The music tracks are royalty-free.
