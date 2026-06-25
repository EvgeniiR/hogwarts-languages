// ── EL PROFETA / THE DAILY PROPHET ─────────────────────────────────────────
// Reading comprehension overlay. Eight category buttons → LLM-generated
// Markdown article → quiz or written-recap verified by one LLM call.
// Topics are drawn from reading-topics.js with session-level dedup.
import { S, saveS } from './state.js';
import { esc, showToast, extractJSON } from './helpers.js';
import { callLLM } from './llm.js';
import { awardPoints } from './progress.js';
import lang from './lang.js';

const DIFF_MULT = { easy:1, medium:1.5, hard:2 };

let currentArticleId = null;
let readingMode = null;   // 'quiz' | 'recap' | null
let quizIdx = 0;
let quizScore = 0;
let quizAnswered = false;
let quizPendingTimer = null;
let quizKeyHandler = null;
let quizAnswers = [];
let quizShuffledOrder = [];
let readingReqId = 0;
const readingSession = { view:'lobby', category:null, articleId:null, quizIdx:0, quizScore:0, mode:null };
const sessionArticle = {};   // cache: 'category_difficulty' → article
const recentTopics = {};     // dedup: categoryKey → Set
let readingTopics = null;    // loaded topics module

// ── helpers ──────────────────────────────────────────────────────────────────

async function loadTopics() {
  if (readingTopics) return readingTopics;
  readingTopics = (await import('./reading-topics.js')).default;
  return readingTopics;
}

function mdToHtml(md) {
  // Escape HTML entities first (same as esc() but preserve \n for line splitting)
  let s = String(md || '');
  s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const lines = s.split('\n');
  const result = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let content, tag;
    if (trimmed.startsWith('### ')) {
      content = trimmed.slice(4);
      tag = 'h3';
    } else if (trimmed.startsWith('## ')) {
      content = trimmed.slice(3);
      tag = 'h2';
    } else if (trimmed.startsWith('# ')) {
      content = trimmed.slice(2);
      tag = 'h1';
    } else {
      content = trimmed;
      tag = 'p';
    }
    // Apply inline formatting: **bold** then *italic*
    content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    content = content.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    result.push(`<${tag}>${content}</${tag}>`);
  }
  return result.join('');
}

function mdToPlain(md) {
  return (md || '')
    .replace(/^### /gm, '')
    .replace(/^## /gm, '')
    .replace(/^# /gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

async function pickTopic(category) {
  await loadTopics();
  const cat = readingTopics[category];
  if (!cat || !cat.topics || !cat.topics.length) return null;
  if (!recentTopics[category]) recentTopics[category] = new Set();
  const set = recentTopics[category];
  const available = cat.topics.filter(t => !set.has(t));
  if (available.length === 0) {
    set.clear();
    showToast(lang.ui.readingTopicsRepeating);
    // All topics available again after clear; pick from full set
    const idx = Math.floor(Math.random() * cat.topics.length);
    const topic = cat.topics[idx];
    set.add(topic);
    return topic;
  }
  const idx = Math.floor(Math.random() * available.length);
  const topic = available[idx];
  set.add(topic);
  return topic;
}

async function generateArticle(category, topic) {
  const dc = lang.readingDiffConfig[S.readingDifficulty];
  const rawMarkdown = await callLLM(
    lang.prompts.articleSys,
    [{ role: 'user', content: lang.prompts.articleUser(topic, dc) }],
    dc.tokens,
    { json: false }
  );
  const titleMatch = rawMarkdown.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : rawMarkdown.substring(0, 60).trim().replace(/\n/g, ' ');
  return {
    id: 'r_' + category + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    category,
    title,
    text: rawMarkdown,
    quiz: null,
    ts: Date.now(),
    completed: false,
    difficulty: S.readingDifficulty
  };
}

// ── overlay open/close ──────────────────────────────────────────────────────

export function setReadingDiff(diff) {
  S.readingDifficulty = diff;
  document.querySelectorAll('.reading-diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === diff));
  saveS();
}

export function openReading() {
  document.getElementById('readingOv').style.display = 'flex';
  if (!quizKeyHandler) {
    quizKeyHandler = e => {
      if (readingMode !== 'quiz' || quizAnswered) return;
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= 4) { e.preventDefault(); answerQuiz(num - 1); }
    };
    document.addEventListener('keydown', quizKeyHandler);
  }
  if (readingSession.view === 'lobby' || !readingSession.view) {
    renderReadingLobby();
  } else {
    restoreSession();
  }
}

function restoreSession() {
  currentArticleId = readingSession.articleId;
  readingMode = readingSession.mode;
  quizIdx = readingSession.quizIdx;
  quizScore = readingSession.quizScore;
  // Try sessionArticle cache first (keyed by category+difficulty), then S.readingArticles
  let article = null;
  if (readingSession.category) {
    const cacheKey = readingSession.category + '_' + S.readingDifficulty;
    article = sessionArticle[cacheKey];
  }
  if (!article && readingSession.articleId) {
    article = S.readingArticles.find(a => a.id === readingSession.articleId);
  }
  if (!article) { renderReadingLobby(); return; }
  if (readingSession.view === 'article') {
    renderArticleView(article);
  } else if (readingSession.view === 'quiz') {
    if (article.quiz && quizIdx < article.quiz.length) {
      renderQuizQuestion(article);
    } else {
      renderArticleView(article);
    }
  } else if (readingSession.view === 'recap') {
    startRecap();
  } else {
    renderReadingLobby();
  }
}

export function closeReading() {
  window.speechSynthesis.cancel();
  document.getElementById('readingOv').style.display = 'none';
  const rp = document.getElementById('selReadingPopup'); if (rp) rp.style.display = 'none';
  if (quizKeyHandler) { document.removeEventListener('keydown', quizKeyHandler); quizKeyHandler = null; }
  readingSession.view = readingMode === 'quiz' ? 'quiz' : readingMode === 'recap' ? 'recap' : currentArticleId ? 'article' : 'lobby';
  readingSession.articleId = currentArticleId;
  readingSession.quizIdx = quizIdx;
  readingSession.quizScore = quizScore;
  readingSession.mode = readingMode;
}

// ── lobby ───────────────────────────────────────────────────────────────────

export function renderReadingLobby() {
  currentArticleId = null;
  readingMode = null;
  quizIdx = 0; quizScore = 0; quizAnswered = false; quizAnswers = [];
  if (quizPendingTimer) { clearTimeout(quizPendingTimer); quizPendingTimer = null; }
  const el = document.getElementById('readingCard');
  const dc = lang.readingDiffConfig;
  const categories = lang.readingCategories;
  el.innerHTML = `<div class="reading-lobby">
    <div class="reading-lobby-title">${lang.ui.readingTitle}</div>
    <div class="reading-lobby-sub">${lang.ui.readingSubtitle}</div>
    ${S.readingCompleted > 0 ? `<div style="font-size:11px;color:var(--gold);margin-bottom:6px;">${lang.ui.readingCompletedCount(S.readingCompleted)}</div>` : ''}
    <div class="reading-diff-row">
      <button class="reading-diff-btn ${S.readingDifficulty==='easy'?'active':''}" data-diff="easy" onclick="setReadingDiff('easy')">${dc.easy.icon} ${dc.easy.label}</button>
      <button class="reading-diff-btn ${S.readingDifficulty==='medium'?'active':''}" data-diff="medium" onclick="setReadingDiff('medium')">${dc.medium.icon} ${dc.medium.label}</button>
      <button class="reading-diff-btn ${S.readingDifficulty==='hard'?'active':''}" data-diff="hard" onclick="setReadingDiff('hard')">${dc.hard.icon} ${dc.hard.label}</button>
    </div>
    <div class="reading-source-grid">
      ${categories.map(cat => `<button class="reading-source-btn${cat.key==='magical'?' reading-source-btn--magic':''}" onclick="selectReadingCategory('${cat.key}')">
        <span class="src-icon">${cat.icon}</span>${cat.label}
      </button>`).join('')}
    </div>
  </div>`;
}

// ── category selection (direct-to-article) ───────────────────────────────────

export async function selectReadingCategory(categoryKey) {
  const reqId = ++readingReqId;
  const el = document.getElementById('readingCard');

  // Session cache — reuse already-generated article for this category+difficulty
  const cacheKey = categoryKey + '_' + S.readingDifficulty;
  if (sessionArticle[cacheKey]) {
    readingSession.category = categoryKey;
    currentArticleId = sessionArticle[cacheKey].id;
    renderArticleView(sessionArticle[cacheKey]);
    return;
  }

  el.innerHTML = `<div class="mem-loading" style="text-align:center;padding:40px;">${lang.ui.readingLoadingArticle}</div><button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingCancelBtn}</button>`;

  try {
    const topic = await pickTopic(categoryKey);
    if (!topic) {
      if (reqId !== readingReqId) return;
      el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--ink);">
        <div style="font-size:14px;margin-bottom:8px;">${lang.ui.readingLoadFailed}</div>
        <button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingBack}</button>
      </div>`;
      return;
    }
    if (reqId !== readingReqId) return;

    const article = await generateArticle(categoryKey, topic);
    if (reqId !== readingReqId) return;

    sessionArticle[cacheKey] = article;
    readingSession.category = categoryKey;
    currentArticleId = article.id;

    S.readingArticles = S.readingArticles || [];
    S.readingArticles.push(article);
    S.readingArticles = S.readingArticles.slice(-10);
    saveS();

    renderArticleView(article);
  } catch (e) {
    if (reqId !== readingReqId) return;
    el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--ink);">
      <div style="font-size:14px;margin-bottom:8px;">${lang.ui.readingLoadError}</div>
      <div style="font-size:11px;color:#7a5520;margin-bottom:12px;">${esc(e.message)}</div>
      <div style="display:flex;gap:6px;justify-content:center;">
        <button class="reading-back-btn" onclick="selectReadingCategory('${esc(categoryKey)}')">${lang.ui.readingRetry}</button>
        <button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingBack}</button>
      </div>
    </div>`;
  }
}

export async function regenerateArticle() {
  const category = readingSession.category;
  if (!category) return;
  const cacheKey = category + '_' + S.readingDifficulty;
  delete sessionArticle[cacheKey];
  await selectReadingCategory(category);
}

// ── article selection ───────────────────────────────────────────────────────

export async function selectArticle(articleId) {
  currentArticleId = articleId;
  readingMode = null;
  quizIdx = 0; quizScore = 0; quizAnswered = false;

  const article = S.readingArticles.find(a => a.id === articleId);
  if (!article) { renderReadingLobby(); return; }

  readingSession.category = article.category || null;
  renderArticleView(article);
}

// ── quiz generation ─────────────────────────────────────────────────────────

async function generateQuizForArticle(article) {
  const dc = lang.readingDiffConfig[article.difficulty || S.readingDifficulty];
  const plainText = mdToPlain(article.text);
  const raw = await callLLM(lang.prompts.quizSys(dc.quizInstr), [{ role: 'user', content: lang.prompts.quizUser(plainText.substring(0, 4000)) }], 1500, { temperature: 0.2, type:'quiz' });
  const parsed = extractJSON(raw);
  if (parsed.quiz && parsed.quiz.length) {
    article.quiz = parsed.quiz;
  }
}

// ── article view ────────────────────────────────────────────────────────────

function renderArticleView(article) {
  const isCompleted = S.readingCompletedIds[article.id];
  const el = document.getElementById('readingCard');
  const catDef = lang.readingCategories.find(c => c.key === article.category) || {};
  const txtAttr = mdToPlain(article.text).substring(0, 4000).replace(/"/g, '&quot;').replace(/\n/g, ' ');
  el.innerHTML = `<div class="reading-article-wrap">
    <div class="reading-article-title">${esc(article.title)}</div>
    <div class="reading-article-meta">
      <span>${catDef.icon || ''} ${catDef.label || article.category}</span>
      ${isCompleted ? `<span style="color:#2a8018;">${lang.ui.readingCompleted}</span>` : `<span>${lang.ui.readingNew}</span>`}
      ${article.ts ? '<span>'+new Date(article.ts).toLocaleDateString(lang.dateLocale)+'</span>' : ''}
      <button class="reading-listen-btn" data-txt="${txtAttr}" data-rate="0.75" onclick="readingListen(this)">${lang.ui.readingListenBtn}</button>
    </div>
    <div class="reading-article-text">${mdToHtml(article.text)}</div>
  </div>
  ${isCompleted ? `<div style="text-align:center;font-size:10px;color:#7a5520;margin-bottom:4px;">${lang.ui.readingAlreadyDone}</div>` : ''}
  <div class="reading-actions">
    <button onclick="startQuiz()">${lang.ui.readingQuizBtn}</button>
    <button onclick="startRecap()">${lang.ui.readingRecapBtn}</button>
    <button onclick="regenerateArticle()">${lang.ui.readingRegenerate}</button>
  </div>
  <button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingBack}</button>`;
}

// ── quiz ────────────────────────────────────────────────────────────────────

export async function startQuiz() {
  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article) return;
  readingMode = 'quiz';
  quizIdx = 0; quizScore = 0; quizAnswers = [];

  // Generate quiz on demand if needed
  if (!article.quiz || !article.quiz.length) {
    const reqId = ++readingReqId;
    const el = document.getElementById('readingCard');
    el.innerHTML = `<div class="mem-loading" style="text-align:center;padding:40px;">${lang.ui.readingQuizGenLoading}</div><button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">${lang.ui.readingCancelBtn}</button>`;
    try {
      await generateQuizForArticle(article);
      if (reqId !== readingReqId) return;
      saveS();
    } catch (e) {
      if (reqId !== readingReqId) return;
      renderArticleView(article);
      showToast(lang.ui.readingQuizGenError);
      return;
    }
  }

  renderQuizQuestion(article);
}

function renderQuizQuestion(article) {
  quizAnswered = false;
  const q = article.quiz[quizIdx];
  const el = document.getElementById('readingCard');
  quizShuffledOrder = q.options.map((_, i) => i);
  for (let i = quizShuffledOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [quizShuffledOrder[i], quizShuffledOrder[j]] = [quizShuffledOrder[j], quizShuffledOrder[i]];
  }
  el.innerHTML = `<div class="reading-quiz-wrap">
    <div class="reading-quiz-prog">${lang.ui.readingQuizQuestion(quizIdx + 1, article.quiz.length)}</div>
    <div class="reading-quiz-q">${esc(q.q)}</div>
    <div class="reading-quiz-opts">
      ${quizShuffledOrder.map((origIdx, displayIdx) => `<button class="reading-quiz-opt" data-idx="${displayIdx}" onclick="answerQuiz(${displayIdx})">${esc(q.options[origIdx])}</button>`).join('')}
    </div>
  </div>
  <details class="reading-article-toggle">
    <summary style="cursor:pointer;font-size:11px;color:#7a5520;font-family:'Cinzel',Georgia,serif;padding:4px 8px;">${lang.ui.readingArticleToggle}</summary>
    <div class="reading-article-toggle-text">${mdToHtml(article.text)}</div>
  </details>
  <button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">${lang.ui.readingCancelBtn}</button>`;
}

export function answerQuiz(optIdx) {
  if (quizAnswered) return;
  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article) return;

  const opts = document.querySelectorAll('.reading-quiz-opt');
  opts.forEach(b => b.classList.remove('quiz-pending'));

  if (quizPendingTimer) {
    clearTimeout(quizPendingTimer);
  }

  if (opts[optIdx]) opts[optIdx].classList.add('quiz-pending');

  quizPendingTimer = setTimeout(() => {
    quizAnswered = true;
    const correct = article.quiz[quizIdx].correct;
    const origIdx = quizShuffledOrder[optIdx];
    const correctDisplayIdx = quizShuffledOrder.indexOf(correct);
    opts.forEach((btn, i) => {
      btn.classList.remove('quiz-pending');
      btn.disabled = true;
      if (i === correctDisplayIdx) btn.classList.add('correct');
      if (i === optIdx && origIdx !== correct) btn.classList.add('wrong');
    });
    if (origIdx === correct) quizScore++;
    quizAnswers[quizIdx] = origIdx;

    setTimeout(() => {
      quizIdx++;
      if (quizIdx < article.quiz.length) {
        renderQuizQuestion(article);
      } else {
        renderQuizResults(article);
      }
    }, 900);
  }, 800);
}

function renderQuizResults(article) {
  const total = article.quiz.length;
  const ratio = quizScore / total;
  const pct = Math.round(ratio * 100);

  let pointsAwarded = 0;
  if (!S.readingCompletedIds[article.id]) {
    S.readingCompleted = (S.readingCompleted || 0) + 1;
    S.readingCompletedIds[article.id] = true;
    article.completed = true;
    pointsAwarded = Math.round((3 + ratio * 5) * DIFF_MULT[article.difficulty || 'medium']);
    awardPoints(pointsAwarded);
    saveS();
  }

  readingMode = null;
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="reading-result-wrap">
    <div class="reading-result-score">${quizScore}/${total}</div>
    <div class="reading-result-label">${lang.ui.readingPct(pct)}</div>
    <div style="font-size:12px;color:var(--ink);font-style:italic;line-height:1.6;margin-bottom:8px;">${lang.ui.readingQuizFeedback(ratio)}</div>
    ${pointsAwarded > 0 ? `<div class="reading-result-label" style="color:#2a8018;">+${pointsAwarded} pts</div>` : `<div class="reading-result-label" style="color:#7a5520;">${lang.ui.readingNoPoints}</div>`}
    <div class="reading-quiz-review">
      ${article.quiz.map((q, i) => {
        const chosen = quizAnswers[i] !== undefined ? quizAnswers[i] : -1;
        const isCorrect = chosen === q.correct;
        return `<div class="reading-quiz-review-item ${isCorrect ? 'review-correct' : 'review-wrong'}">
          <span>${isCorrect ? '✓' : '✗'}</span>
          <span>${esc(q.q)}</span>
          ${!isCorrect && chosen >= 0 ? `<span style="font-size:10px;display:block;color:#5ab030;">${lang.ui.readingCorrectAnswer}${esc(q.options[q.correct])}</span>` : ''}
          ${chosen < 0 ? `<span style="font-size:10px;display:block;color:#7a5520;">${lang.ui.readingUnanswered}</span>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="reading-actions">
      <button onclick="startQuiz()">${lang.ui.readingRetry}</button>
      <button onclick="selectArticle('${esc(article.id)}')">${lang.ui.readingCancelBtn}</button>
    </div>
    <button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingBackToMenu}</button>
  </div>`;
}

// ── recap ───────────────────────────────────────────────────────────────────

export function startRecap() {
  readingMode = 'recap';
  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article) return;
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="reading-recap-wrap">
    <div style="font-size:11px;color:#7a5520;margin-bottom:6px;">${lang.ui.readingRecapInstr}</div>
    <details class="reading-article-toggle">
      <summary style="cursor:pointer;font-size:11px;color:#7a5520;font-family:'Cinzel',Georgia,serif;padding:4px 8px;">${lang.ui.readingArticleToggle}</summary>
      <div class="reading-article-toggle-text">${mdToHtml(article.text)}</div>
    </details>
    <textarea class="reading-recap-ta" id="recapTa" placeholder="${lang.ui.readingRecapPlaceholder}"></textarea>
    <div class="reading-actions" style="margin-top:10px;">
      <button onclick="submitRecap()">✉️ ${lang.ui.saveBtn}</button>
    </div>
    <button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">${lang.ui.readingCancelBtn}</button>
  </div>`;
}

export async function submitRecap() {
  if (readingMode !== 'recap') return;
  const reqId = ++readingReqId;
  const ta = document.getElementById('recapTa');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text || text.length < 20) {
    showToast(lang.ui.readingRecapInstr);
    return;
  }

  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article) return;

  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="mem-loading" style="text-align:center;padding:40px;">${lang.ui.readingRecapEvalLoading}</div><button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">${lang.ui.readingCancelBtn}</button>`;

  try {
    const raw = await callLLM(lang.prompts.recapSys, [{ role: 'user', content: lang.prompts.recapUser(article.text.substring(0, 4000), text) }], 1000, { temperature: 0.2, type:'recap' });
    if (reqId !== readingReqId) return;
    const parsed = extractJSON(raw);
    const score = Math.max(0, Math.min(1, parsed.score || 0));

    let pointsAwarded = 0;
    if (!S.readingCompletedIds[article.id]) {
      S.readingCompleted = (S.readingCompleted || 0) + 1;
      S.readingCompletedIds[article.id] = true;
      article.completed = true;
      pointsAwarded = Math.round((3 + score * 5) * DIFF_MULT[article.difficulty || 'medium']);
      awardPoints(pointsAwarded);
      saveS();
    }

    renderRecapResults(article, score, parsed.feedback || '', parsed.missedKeyPoints || [], pointsAwarded);
  } catch (e) {
    if (reqId !== readingReqId) return;
    el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--ink);">
      <div style="font-size:14px;margin-bottom:8px;">${lang.ui.readingRecapEvalError}</div>
      <div style="font-size:11px;color:#7a5520;margin-bottom:12px;">${esc(e.message)}</div>
      <button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">${lang.ui.readingCancelBtn}</button>
    </div>`;
  }
}

function renderRecapResults(article, score, feedback, missedPoints, pointsAwarded) {
  readingMode = null;
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="reading-result-wrap">
    <div class="reading-result-score">${lang.ui.readingPct(Math.round(score * 100))}</div>
    <div class="reading-result-label">${lang.ui.readingResultLabel}</div>
    ${feedback ? `<div class="reading-recap-fb">${esc(feedback)}</div>` : ''}
    ${missedPoints.length ? `<div class="reading-recap-fb"><strong>${lang.ui.readingMissedPoints}</strong><br>${missedPoints.map(p => '• ' + esc(p)).join('<br>')}</div>` : ''}
    ${pointsAwarded > 0 ? `<div class="reading-result-label" style="color:#2a8018;">+${pointsAwarded} pts</div>` : `<div class="reading-result-label" style="color:#7a5520;">${lang.ui.readingNoPoints}</div>`}
    <div class="reading-actions">
      <button onclick="startRecap()">${lang.ui.readingRetry}</button>
      <button onclick="selectArticle('${esc(article.id)}')">${lang.ui.readingCancelBtn}</button>
    </div>
    <button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingBackToMenu}</button>
  </div>`;
}

// ── TTS for article reading ─────────────────────────────────────────────────

export function readingListen(btn) {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    btn.classList.remove('active');
    return;
  }
  btn.classList.add('active');
  const t = btn.dataset.txt;
  const rate = btn.dataset.rate ? parseFloat(btn.dataset.rate) : undefined;
  if (t) {
    const u = new SpeechSynthesisUtterance(t);
    if (rate) u.rate = rate;
    u.lang = lang.ttsLocale;
    u.onend = () => btn.classList.remove('active');
    u.onerror = () => btn.classList.remove('active');
    window.speechSynthesis.speak(u);
  } else {
    btn.classList.remove('active');
  }
}

export function returnToLobby() {
  readingSession.view = 'lobby';
  readingSession.category = null;
  readingSession.articleId = null;
  readingSession.quizIdx = 0;
  readingSession.quizScore = 0;
  readingSession.mode = null;
  renderReadingLobby();
}
