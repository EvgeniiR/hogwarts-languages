// ── AUDIO ──────────────────────────────────────────────────────────────────
// Ambient music manager with lazy loading, seamless resume, and race-free
// async operations.

import { S, saveS } from './state.js';
import { shuffleArray } from './helpers.js';

// ── Constants ─────────────────────────────────────────────────────────────

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
    this._playlistLoading = false;

    // Playback state
    this._audio = null;              // HTMLAudioElement or null
    this._playGeneration = 0;        // cancels stale async operations
    this._nextTrackQueued = false;   // prevents duplicate onended handling

    // Autoplay workaround
    this._userInteracted = false;
    this._interactionListenerAttached = false;

    // UI beeps context
    this._audioContext = null;
  }

  // ── Getters ─────────────────────────────────────────────────────────────

  get isMuted() {
    return S.musicOff === true;
  }

  get isPlaying() {
    const el = this._audio;
    return !!el && !el.paused && !el.ended;
  }

  get currentTrack() {
    if (!this._playlistLoaded || this._playlist.length === 0) return null;
    return this._playlist[this._currentIndex];
  }

  // ── Playlist Management ────────────────────────────────────────────────

  async _ensurePlaylistLoaded() {
    if (this._playlistLoaded) return;
    if (this._playlistLoading) {
      // Wait for the ongoing load to finish
      await new Promise(resolve => {
        const check = () => {
          if (!this._playlistLoading) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
      return;
    }

    this._playlistLoading = true;
    try {
      const response = await fetch('audio/manifest.json');
      let files = [];

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          files = data.map(name => `audio/${name}`);
        }
      }

      this._playlist = files.length > 0 ? shuffleArray(files) : shuffleArray(FALLBACK_FILES);
      this._currentIndex = 0;
      this._playlistLoaded = true;
    } catch (_) {
      this._playlist = shuffleArray(FALLBACK_FILES);
      this._currentIndex = 0;
      this._playlistLoaded = true;
    } finally {
      this._playlistLoading = false;
    }
  }

  // ── Audio Element Management ───────────────────────────────────────────

  _destroyAudio() {
    if (!this._audio) return;

    const el = this._audio;
    el.onended = null;
    el.onerror = null;
    el.pause();
    el.src = '';
    el.load();

    this._audio = null;
    this._nextTrackQueued = false;
  }

  _createAudioElement() {
    // Create audio element if it doesn't exist (first time)
    if (!this._audio) {
      const el = new Audio();
      el.volume = 0.25;

      // Track ended naturally
      el.onended = () => {
        if (this._nextTrackQueued) return; // Prevent duplicate handling
        this._nextTrackQueued = true;
        this._advanceToNextTrack();
      };

      // Track failed to play
      el.onerror = () => {
        console.warn('Audio playback error, advancing to next track');
        this._destroyAudio();
        if (!this.isMuted) {
          this._advanceToNextTrack();
        }
      };

      this._audio = el;
    }

    return this._audio;
  }

  _loadAndPlayTrack(src) {
    const el = this._createAudioElement();
    el.dataset.track = String(this._currentIndex);
    this._nextTrackQueued = false;

    // Set new source and play (reuses same audio element to preserve autoplay permission)
    el.src = src;
    el.load();
    el.play().catch(err => {
      console.warn('Autoplay prevented:', err);
    });
  }

  _advanceToNextTrack() {
    if (this._playlist.length === 0) return;

    this._currentIndex = (this._currentIndex + 1) % this._playlist.length;
    this._playGeneration++;

    if (!this.isMuted) {
      const src = this._playlist[this._currentIndex];
      this._loadAndPlayTrack(src);
    } else {
      this._destroyAudio();
    }
  }

  // ── Playback Control ────────────────────────────────────────────────────

  _playTrack(generation) {
    if (this.isMuted) return;
    if (generation !== this._playGeneration) return;
    if (this._playlist.length === 0) return;

    const src = this._playlist[this._currentIndex];

    // If same track is paused, just resume
    if (this._audio && this._audio.dataset.track === String(this._currentIndex) && this._audio.paused) {
      this._audio.play().catch(() => {
        // Resume failed - reload from scratch
        this._loadAndPlayTrack(src);
      });
      return;
    }

    // Load and play the track (reuses existing audio element if any)
    this._loadAndPlayTrack(src);
  }

  _pauseAudio() {
    if (this._audio) {
      this._audio.pause();
    }
  }

  // ── User Interaction Workaround ────────────────────────────────────────

  _attachInteractionListener() {
    if (this._interactionListenerAttached) return;
    this._interactionListenerAttached = true;

    const handler = () => {
      if (!this._userInteracted) {
        this._userInteracted = true;
        this._ensurePlayback();
      }
    };

    document.addEventListener('pointerdown', handler);
    document.addEventListener('keydown', handler);
  }

  async _ensurePlayback() {
    // Resume audio context for beeps if needed
    this._ensureAudioContext();

    if (this.isMuted) {
      this._pauseAudio();
      this._updateUI();
      return;
    }

    if (this.isPlaying) return;

    if (!this._playlistLoaded) {
      await this._ensurePlaylistLoaded();
      if (this._playlist.length === 0) return;
    }

    if (!this.isPlaying) {
      // Increment generation to cancel any stale operations
      this._playGeneration++;
      this._playTrack(this._playGeneration);
    }
  }

  _ensureAudioContext() {
    if (this._audioContext) return;
    try {
      this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
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
    if (!this._playlistLoaded) {
      await this._ensurePlaylistLoaded();
    }
    this._attachInteractionListener();
    await this._ensurePlayback();
  }

  toggleAudio() {
    if (this.isMuted) {
      // Unmute
      S.musicOff = false;
      this._playGeneration++;
      this._playTrack(this._playGeneration);
    } else {
      // Mute
      S.musicOff = true;
      this._pauseAudio();
    }

    this._updateUI();
    saveS();
  }

  skipSong() {
    if (!this._playlistLoaded || this._playlist.length <= 1) return;

    this._currentIndex = (this._currentIndex + 1) % this._playlist.length;
    this._playGeneration++;

    if (!this.isMuted) {
      const src = this._playlist[this._currentIndex];
      this._loadAndPlayTrack(src);
    } else {
      this._updateUI();
    }
  }

  stopMusic() {
    this._pauseAudio();
    S.musicOff = true;
    this._updateUI();
    saveS();
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