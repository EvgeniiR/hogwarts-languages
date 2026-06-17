// ── AUDIO ──────────────────────────────────────────────────────────────────
// Ambient music manager with lazy loading, gapless preloading of the next
// track, and instant mute/unmute (pause/resume — never re-downloads).

import { S, saveS } from './state.js';
import { shuffleArray } from './helpers.js';

// ── Constants ─────────────────────────────────────────────────────────────

const VOLUME = 0.25;

const FALLBACK_FILES = [
  "audio/A Fool's Theme - Brian Bolger.mp3",
  "audio/Aaron Kenny - English Country Garden (Happy).mp3",
  "audio/Aaron Kenny - Happy Haunts (Happy).mp3",
  "audio/Aaron Kenny - The Curious Kitten (Bright).mp3",
  "audio/Cooper Cannell - Sprightly Pursuit (Bright).mp3",
  "audio/English Country Garden - Aaron Kenny.mp3",
  "audio/First Dream - Brian Bolger.mp3",
  "audio/Jesse's Carnival Waltz - The Great North Sound Society.mp3",
  "audio/Saving The World - Aaron Kenny.mp3",
  "audio/Sir Cubworth - Monster At The Door (Dark).mp3",
  "audio/Sir Cubworth - Murder Mystery (Dramatic).mp3",
  "audio/Sir Cubworth - Rolling Hills (Inspirational).mp3",
  "audio/Sir Cubworth - Waltz To Death (Dark).mp3",
  "audio/The Curious Kitten - Aaron Kenny.mp3",
  "audio/The Two Seasons - Dan Bodan.mp3",
];

// ── Audio Manager ─────────────────────────────────────────────────────────

class AudioManager {
  constructor() {
    // Playlist state
    this._playlist = [];
    this._currentIndex = 0;
    this._playlistLoaded = false;
    this._playlistPromise = null;    // shared in-flight load promise

    // Playback state: two elements — one playing, one preloaded.
    this._current = null;            // HTMLAudioElement currently playing/paused
    this._next = null;               // preloaded HTMLAudioElement for next track
    this._nextIdx = -1;              // playlist index held by _next (-1 = none)
    this._failCount = 0;             // consecutive track failures (loop guard)

    // Autoplay workaround
    this._userInteracted = false;
    this._interactionListenerAttached = false;

    // UI beeps context (independent of music mute)
    this._audioContext = null;
  }

  // ── Getters ─────────────────────────────────────────────────────────────

  get isMuted() {
    return S.musicOff === true;
  }

  get isPlaying() {
    const el = this._current;
    return !!el && !el.paused && !el.ended;
  }

  // ── Playlist Management ────────────────────────────────────────────────

  _ensurePlaylistLoaded() {
    if (this._playlistLoaded) return Promise.resolve();
    if (this._playlistPromise) return this._playlistPromise;

    this._playlistPromise = (async () => {
      let files = [];
      try {
        const response = await fetch('audio/manifest.json');
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            files = data.map(name => `audio/${name}`);
          }
        }
      } catch (_) { /* fall back below */ }

      this._playlist = shuffleArray(files.length > 0 ? files : FALLBACK_FILES);
      this._currentIndex = 0;
      this._playlistLoaded = true;
    })();

    return this._playlistPromise;
  }

  // ── Audio Element Management ───────────────────────────────────────────

  // Create an element for a given source. `play=true` wires the playback
  // handlers (onended/onerror/oncanplay); preload elements just download.
  _makeElement(src, play) {
    const el = new Audio();
    el.volume = VOLUME;
    el.preload = 'auto';
    el.src = src;

    if (play) {
      el.oncanplay = () => { this._failCount = 0; };
      el.onended = () => this._advance();
      el.onerror = () => this._onTrackError();
    }

    el.load();
    return el;
  }

  _destroy(el) {
    if (!el) return;
    el.onended = null;
    el.onerror = null;
    el.oncanplay = null;
    el.pause();
    el.src = '';
    el.load();
  }

  _nextIndex() {
    return this._playlist.length === 0
      ? 0
      : (this._currentIndex + 1) % this._playlist.length;
  }

  // Warm the upcoming track so it's buffered before the current one ends.
  _preloadNext() {
    if (this._playlist.length <= 1) return;       // nothing distinct to preload
    const idx = this._nextIndex();
    if (this._next && this._nextIdx === idx) return;
    this._destroy(this._next);
    this._next = this._makeElement(this._playlist[idx], false);
    this._nextIdx = idx;
  }

  _play(el) {
    el.play().catch(err => {
      // Blocked (no engagement yet) — resume on the next user gesture.
      console.warn('Audio play prevented:', err);
      this._attachInteractionListener();
    });
  }

  // Start the track at `_currentIndex` from scratch (used for the very first
  // play and as an error fallback). Preloads the following track.
  _startCurrent() {
    if (this.isMuted || this._playlist.length === 0) return;
    this._destroy(this._current);
    const src = this._playlist[this._currentIndex];
    this._current = this._makeElement(src, true);
    if (this._playlist.length <= 1) this._current.loop = true;
    this._play(this._current);
    this._preloadNext();
  }

  // Move to the next track. Promotes the preloaded element if present so the
  // switch is instant; otherwise loads from scratch.
  _advance() {
    if (this._playlist.length === 0) return;
    this._currentIndex = this._nextIndex();

    const promoted = this._nextIdx === this._currentIndex ? this._next : null;
    if (!promoted) this._destroy(this._next);
    this._next = null;
    this._nextIdx = -1;
    this._destroy(this._current);

    if (this.isMuted) { this._current = null; return; }

    if (promoted) {
      // Re-wire as the active (playing) element.
      promoted.oncanplay = () => { this._failCount = 0; };
      promoted.onended = () => this._advance();
      promoted.onerror = () => this._onTrackError();
      this._current = promoted;
      this._play(this._current);
      this._preloadNext();
    } else {
      this._startCurrent();
    }
  }

  _onTrackError() {
    console.warn('Audio playback error on track', this._currentIndex);
    this._destroy(this._current);
    this._current = null;
    this._failCount++;
    if (this.isMuted) return;
    if (this._failCount >= this._playlist.length) {
      console.warn('All tracks failed to play — giving up.');
      this._failCount = 0;
      return;
    }
    this._advance();
  }

  // ── User Interaction Workaround ────────────────────────────────────────

  _attachInteractionListener() {
    if (this._interactionListenerAttached) return;
    this._interactionListenerAttached = true;

    const handler = () => {
      this._resumeAudioContext();
      if (!this._userInteracted) {
        this._userInteracted = true;
        this._ensurePlayback();
      }
    };

    document.addEventListener('pointerdown', handler);
    document.addEventListener('keydown', handler);
  }

  async _ensurePlayback() {
    this._ensureAudioContext();
    this._resumeAudioContext();

    if (this.isMuted) return;
    if (this.isPlaying) return;

    if (!this._playlistLoaded) {
      await this._ensurePlaylistLoaded();
      if (this._playlist.length === 0) return;
    }

    // If a track is loaded but paused, resume it; else start fresh.
    if (this._current && this._current.paused) this._play(this._current);
    else if (!this.isPlaying) this._startCurrent();
  }

  _ensureAudioContext() {
    if (this._audioContext) return;
    try {
      this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
  }

  _resumeAudioContext() {
    if (this._audioContext && this._audioContext.state === 'suspended') {
      this._audioContext.resume().catch(() => {});
    }
  }

  // ── UI Updates ──────────────────────────────────────────────────────────

  _updateUI() {
    const btn = document.getElementById('aBtn');
    if (!btn) return;

    btn.innerHTML = this.isMuted
        ? '<i class="ti ti-volume-off"></i>'
        : '<i class="ti ti-volume"></i>';
  }

  // ── Public API ──────────────────────────────────────────────────────────

  tryPlayNow() {
    this._ensureAudioContext();
    this._attachInteractionListener();
    this._ensurePlayback().catch(() => {});
  }

  async tryAudio() {
    this._attachInteractionListener();
    await this._ensurePlayback();
  }

  toggleAudio() {
    if (this.isMuted) {
      // Unmute — resume the existing track (no re-download) if we have one.
      S.musicOff = false;
      this._resumeAudioContext();
      if (this._current) this._play(this._current);
      else this._ensurePlayback();
    } else {
      // Mute — just pause; position and buffer are preserved.
      S.musicOff = true;
      if (this._current) this._current.pause();
    }
    this._updateUI();
    saveS();
  }

  skipSong() {
    if (!this._playlistLoaded || this._playlist.length <= 1) return;
    this._failCount = 0;
    if (this.isMuted) {
      // Advance the pointer only; nothing plays while muted.
      this._currentIndex = this._nextIndex();
      this._destroy(this._next); this._next = null; this._nextIdx = -1;
    } else {
      this._advance();
    }
    this._updateUI();
  }

  stopMusic() {
    if (this._current) this._current.pause();
    this._updateUI();
  }

  syncAudioBtn() {
    this._updateUI();
  }

  // ── UI Beeps ────────────────────────────────────────────────────────────

  _beep(freq, type, vol, dur, delay = 0) {
    if (!this._audioContext) return;

    const ctx = this._audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;

    osc.connect(gain);
    gain.connect(ctx.destination);

    const startTime = ctx.currentTime + delay;
    osc.start(startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
    osc.stop(startTime + dur);
  }

  playSend() {
    this._beep(600, 'triangle', 0.1, 0.15);
  }

  playRecv() {
    [500, 660, 820].forEach((f, i) =>
        this._beep(f, 'sine', 0.08, 0.22, i * 0.075)
    );
  }

  playVocab() {
    this._beep(880, 'sine', 0.07, 0.28);
  }

  playSpell() {
    [400, 600, 900, 1200, 1600].forEach((f, i) =>
        this._beep(f, 'triangle', 0.06, 0.25, i * 0.06)
    );
  }

  playCorrect() {
    [523, 659, 784].forEach((f, i) =>
        this._beep(f, 'sine', 0.08, 0.25, i * 0.08)
    );
  }

  playMinor() {
    this._beep(440, 'triangle', 0.08, 0.2);
  }

  playIncorrect() {
    [400, 350, 300].forEach((f, i) =>
        this._beep(f, 'sawtooth', 0.04, 0.3, i * 0.12)
    );
  }
}

// ── Singleton Instance ────────────────────────────────────────────────────

const audioManager = new AudioManager();

// ── Public API Bindings ──────────────────────────────────────────────────

export function tryPlayNow() { audioManager.tryPlayNow(); }
export function tryAudio() { return audioManager.tryAudio(); }
export function toggleAudio() { audioManager.toggleAudio(); }
export function skipSong() { audioManager.skipSong(); }
export function stopMusic() { audioManager.stopMusic(); }
export function syncAudioBtn() { audioManager.syncAudioBtn(); }

export function playSend() { audioManager.playSend(); }
export function playRecv() { audioManager.playRecv(); }
export function playVocab() { audioManager.playVocab(); }
export function playSpell() { audioManager.playSpell(); }
export function playCorrect() { audioManager.playCorrect(); }
export function playMinor() { audioManager.playMinor(); }
export function playIncorrect() { audioManager.playIncorrect(); }
