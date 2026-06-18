import { S, R, saveS } from './state.js';
import { esc, shuffleArray, extractJSON, showToast } from './helpers.js';
import { LEVELS } from './characters.js';
import { awardPoints, pushLevelOutcome } from './progress.js';
import { playCorrect, playIncorrect } from './audio.js';
import { game, diffSelectorHtml, award } from './game-core.js';
import { ParticleEngine } from './particles.js';
import { srsPromote } from './srs.js';
import { callLLM } from './llm.js';

let cards = [];
let flippedIndices = [];
let matchedPairs = 0;
let totalPairs = 0;
let timerInterval = null;
let seconds = 0;
let timerStarted = false;
let isProcessing = false;
let isPreviewing = false;
let engine = null;
let randomMode = false;
const recentVocab = new Set();
const RECENT_MAX = 50;
let memReqId = 0;

export function setRandomMode(checked) {
  randomMode = checked;
}

function smartWeightedPick(count) {
  const now = Date.now();
  const scored = S.vocab.map(v => {
    const ageDays = (now - (v.ts || now)) / 86400000;
    const mistakeCount = S.mistakes.filter(m => m.right && m.right.toLowerCase().includes(v.word.toLowerCase())).length;
    const weight = ageDays * 2 + mistakeCount * 5 + Math.random() * 10;
    return { data: v, weight };
  });
  scored.sort((a, b) => b.weight - a.weight);
  const top = scored.slice(0, count * 3);
  return shuffleArray(top).slice(0, count).map(s => s.data);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function boardComplete() {
  stopTimer();
  if (engine) { engine.stop(); engine = null; }
  const timeBonus = Math.max(0, Math.floor((90 - seconds) / 10));
  if (timeBonus > 0) awardPoints(timeBonus);
  const {diff,bonus}=award('correct');
  pushLevelOutcome(true);
  document.getElementById('memResult').innerHTML = `<div style="margin-top:10px;text-align:center;">
    <div class="tier-correct" style="font-size:13px;font-weight:500;">✓ ¡Pensieve completado!</div>
    <div style="font-size:11px;color:#7a5520;margin-top:4px;">⏱ ${seconds}s${timeBonus > 0 ? ' · +' + timeBonus + ' pts (tiempo)' : ''}</div>
    <div style="font-size:11px;color:#7a5520;">+${diff.pts} pts${bonus ? ` · 🔥 Combo +${bonus}` : ''} · ${totalPairs} parejas</div>
    <button class="game-next" onclick="renderMemoryLobby()">Menú →</button>
  </div>`;
  saveS();
}

function checkPair() {
  isProcessing = true;
  const [i1, i2] = flippedIndices;
  const c1 = cards[i1], c2 = cards[i2];
  const match = c1.pairId === c2.pairId && c1.type !== c2.type;

  if (match) {
    matchedPairs++;
    c1.matched = c2.matched = true;
    const el1 = document.querySelector(`.memory-card[data-idx="${i1}"]`);
    const el2 = document.querySelector(`.memory-card[data-idx="${i2}"]`);
    if (el1) {
      el1.classList.add('matched');
      if (engine) {
        const pos = engine.getPos(el1);
        engine.burst(pos.x, pos.y, 14, '232,200,96');
      }
    }
    if (el2) {
      el2.classList.add('matched');
      if (engine) {
        const pos = engine.getPos(el2);
        engine.burst(pos.x, pos.y, 14, '232,200,96');
      }
    }
    playCorrect();
    awardPoints(1);
    const esCard = c1.type === 'es' ? c1 : c2;
    const ve = S.vocab.find(x => x.word.toLowerCase() === esCard.text.toLowerCase());
    if (ve) srsPromote(ve);
    flippedIndices = [];
    isProcessing = false;
    const pEl = document.getElementById('memPairs');
    if (pEl) pEl.textContent = matchedPairs + '/' + totalPairs;
    if (matchedPairs === totalPairs) boardComplete();
  } else {
    playIncorrect();
    game.combo = 0;
    awardPoints(-1);
    setTimeout(() => {
      c1.flipped = c2.flipped = false;
      const el1 = document.querySelector(`.memory-card[data-idx="${i1}"]`);
      const el2 = document.querySelector(`.memory-card[data-idx="${i2}"]`);
      if (el1) el1.classList.remove('flipped');
      if (el2) el2.classList.remove('flipped');
      flippedIndices = [];
      isProcessing = false;
    }, 900);
  }
}

export function flipMemCard(el) {
  if (isProcessing || isPreviewing) return;
  const idx = parseInt(el.dataset.idx, 10);
  const card = cards[idx];
  if (card.flipped || card.matched) return;
  if (flippedIndices.length >= 2) return;

  if (!timerStarted) {
    timerStarted = true;
    timerInterval = setInterval(() => {
      seconds++;
      const t = document.getElementById('memTimer');
      if (t) t.textContent = '⏱ ' + seconds + 's';
    }, 1000);
  }

  card.flipped = true;
  el.classList.add('flipped');
  flippedIndices.push(idx);

  if (flippedIndices.length === 2) checkPair();
}

export function renderMemoryLobby() {
  const el = document.getElementById('gamesContent');
  el.innerHTML = diffSelectorHtml() + `
    <div class="svc-lbl" style="margin-top:2px;">Vocabulario</div>
    <div class="vadd-row" style="margin-bottom:12px;">
      <button onclick="setRandomMode(false);renderMemoryLobby()"${!randomMode?' class="diff-btn-active"':''}>📖 Mis palabras</button>
      <button onclick="setRandomMode(true);renderMemoryLobby()"${randomMode?' class="diff-btn-active"':''}>🎲 Aleatorio</button>
    </div>
    <button class="fc-btn" style="width:100%;padding:10px 0;" onclick="genMemory()">▶ Empezar</button>`;
}

function renderMemory() {
  const el = document.getElementById('gamesContent');
  el.innerHTML = diffSelectorHtml() + `
    <div class="pensieve-hdr">Pensieve · Recupera los recuerdos</div>
    <div class="pensieve-stats"><span id="memTimer">⏱ 0s</span><span id="memPairs">${matchedPairs}/${totalPairs}</span></div>
    <div class="pensieve-grid" id="memGrid">
      ${cards.map((c, i) => `
        <div class="memory-card${c.matched ? ' matched' : ''}${c.flipped ? ' flipped' : ''}" data-idx="${i}" data-type="${c.type}" onclick="flipMemCard(this)" role="button" aria-label="${esc(c.text)}">
          <div class="memory-card-inner">
            <div class="memory-card-front"></div>
            <div class="memory-card-back">${esc(c.text)}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="mem-preview-bar" id="memPreviewBar" style="display:none;"><div class="mem-preview-bar-fill" id="memPreviewFill"></div></div>
    <div class="pensieve-actions" style="justify-content:center;">
      <button onclick="skipMemory()">⏭ Revelar todo (-1)</button>
    </div>
    <div id="memResult"></div>`;
  if (window.innerWidth >= 820) {
    document.getElementById('memGrid').style.gridTemplateColumns = `repeat(${Math.min(totalPairs, 4)}, 1fr)`;
  }
}

export async function genMemory() {
  if (engine) { engine.stop(); engine = null; }
  stopTimer();
  cards = []; flippedIndices = []; matchedPairs = 0; timerStarted = false; seconds = 0; isProcessing = false; isPreviewing = false;
  const reqId = ++memReqId;
  const pairs = S.gameDifficulty === 'easy' ? 4 : S.gameDifficulty === 'medium' ? 6 : 8;
  let picked;
  if (randomMode) {
    document.getElementById('gamesContent').innerHTML = diffSelectorHtml() + '<div class="mem-loading">Generando vocabulario aleatorio</div>';
    const llm = await llmVocab(pairs, true);
    if (reqId !== memReqId) return;
    if (llm && llm.length >= 2) {
      picked = llm;
    } else {
      showToast('No se pudo generar. Usando vocabulario guardado.', '#7a5520');
      picked = smartWeightedPick(pairs);
    }
  } else {
    picked = smartWeightedPick(pairs);
    if (picked.length < pairs) {
      const needed = pairs - picked.length;
      document.getElementById('gamesContent').innerHTML = diffSelectorHtml() + '<div class="mem-loading">Generando vocabulario nuevo</div>';
      const extra = await llmVocab(needed);
      if (reqId !== memReqId) return;
      if (extra && extra.length) {
        extra.forEach(v => { if (!S.vocab.some(x => x.word.toLowerCase() === v.word.toLowerCase())) S.vocab.push(v); });
        saveS();
        picked = smartWeightedPick(pairs);
      }
    }
  }
  if (!picked || picked.length < 2) {
    document.getElementById('gamesContent').innerHTML = diffSelectorHtml() + '<div class="edim">Agrega más vocabulario primero (al menos 2 palabras).</div><button class="game-next" onclick="closeGames()">Ir al chat →</button>';
    return;
  }
  totalPairs = Math.min(picked.length, pairs);
  for (let i = 0; i < totalPairs; i++) {
    const v = picked[i];
    cards.push({ id: i * 2, pairId: i, text: v.word, type: 'es', flipped: false, matched: false });
    cards.push({ id: i * 2 + 1, pairId: i, text: v.def || '(sin traducción)', type: 'en', flipped: false, matched: false });
  }
  const wide = window.innerWidth >= 820;
  const enCards = shuffleArray(cards.filter(c => c.type === 'en'));
  const esCards = shuffleArray(cards.filter(c => c.type === 'es'));
  if (wide) {
    cards = [...enCards, ...esCards];
  } else {
    cards = enCards.flatMap((c, i) => esCards[i] ? [c, esCards[i]] : [c]);
  }
  renderMemory();
  if (engine) { engine.stop(); engine = null; }
  engine = new ParticleEngine(document.getElementById('gamesOv'));
  requestAnimationFrame(() => { if (engine) engine.start(); });
  isPreviewing = true;
  document.querySelectorAll('#memGrid .memory-card').forEach(el => el.classList.add('flipped'));
  const previewBar = document.getElementById('memPreviewBar');
  const previewFill = document.getElementById('memPreviewFill');
  if (previewBar && previewFill) {
    previewBar.style.display = 'block';
    const start = performance.now();
    const duration = 3000;
    function tick() {
      const elapsed = performance.now() - start;
      const pct = Math.max(0, 100 - (elapsed / duration) * 100);
      previewFill.style.width = pct + '%';
      if (elapsed < duration) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  setTimeout(() => {
    if (previewBar) previewBar.style.display = 'none';
    document.querySelectorAll('#memGrid .memory-card:not(.matched)').forEach(el => el.classList.remove('flipped'));
    cards.forEach(c => { c.flipped = false; });
    isPreviewing = false;
  }, 3000);
}

export function skipMemory() {
  stopTimer();
  if (engine) { engine.stop(); engine = null; }
  isProcessing = false;
  awardPoints(-1);
  pushLevelOutcome(false);
  cards.forEach(c => { c.flipped = true; c.matched = true; });
  const grid = document.getElementById('memGrid');
  if (grid) {
    grid.querySelectorAll('.memory-card').forEach(el => el.classList.add('flipped', 'matched'));
  }
  const el = document.getElementById('memResult');
  if (el) {
    el.innerHTML = `<button class="game-next" style="margin-top:10px;" onclick="renderMemoryLobby()">Menú →</button>`;
  }
  saveS();
}

export function cleanupMemory() {
  stopTimer();
  if (engine) { engine.stop(); engine = null; }
}

async function llmVocab(count, fresh = false) {
  if (!R.keys.groq && !R.keys.gemini && !R.keys.anthropic) return null;
  const exclude = recentVocab.size ? `\nNO uses ninguna de estas palabras: ${[...recentVocab].join(', ')}` : '';
  const prompt = `Genera${fresh?' exactamente':''} ${count} pares de vocabulario español-inglés nivel A2/B1.
Palabras útiles y naturales — temas cotidianos o del mundo de Harry Potter.
Output ONLY un JSON object: {"pairs":[{"word":"tranquilo","def":"calm"},{"word":"escoba","def":"broom"}]}
Sin markdown, sin explicación.${exclude}`;
  try {
    const raw = await callLLM(`Eres un profesor de español generando pares de vocabulario para un juego de memoria de nivel ${LEVELS[S.level]}.`, [{ role: 'user', content: prompt }], fresh ? 800 : 600, 'low');
    const parsed = extractJSON(raw);
    const arr = parsed.pairs || parsed;
    if (!Array.isArray(arr)) return null;
    const valid = arr.filter(v => v.word && v.def);
    if (fresh) {
      valid.forEach(v => {
        recentVocab.add(v.word.toLowerCase());
        if (recentVocab.size > RECENT_MAX) recentVocab.delete([...recentVocab][0]);
      });
    }
    return valid.map(v => ({ word: v.word, def: v.def, ts: Date.now() }));
  } catch (e) { /* silent */ }
  return null;
}
