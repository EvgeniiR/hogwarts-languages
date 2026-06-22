// ── EL PROFETA / THE DAILY PROPHET ─────────────────────────────────────────
// Reading comprehension overlay. Nine content sources: eight human-written RSS
// feeds + LLM-generated Harry Potter lore. User reads an article then takes a
// quiz or writes a recap verified by one LLM call.
import { S, saveS } from './state.js';
import { esc, showToast, extractJSON } from './helpers.js';
import { callLLM } from './llm.js';
import { awardPoints } from './progress.js';
import lang from './lang.js';

const RSS2JSON_URL = 'https://api.rss2json.com/v1/api.json';
const DIFF_MULT = { easy:1, medium:1.5, hard:2 };

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const rtf = new Intl.RelativeTimeFormat(lang.dateLocale, { numeric: 'auto' });
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return rtf.format(0, 'minute');
  if (mins < 60) return rtf.format(-mins, 'minute');
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return rtf.format(-hrs, 'hour');
  const days = Math.floor(hrs / 24);
  if (days < 30) return rtf.format(-days, 'day');
  return rtf.format(-Math.floor(days/30), 'month');
}

let currentArticleId = null;
let readingMode = null;   // 'quiz' | 'recap' | null
let quizIdx = 0;
let quizScore = 0;
let quizAnswered = false;
let quizPendingTimer = null;
let quizKeyHandler = null;
let quizAnswers = [];
let readingReqId = 0;
let sessionHeadlines = {};
const readingSession = { view:'lobby', source:null, articleId:null, quizIdx:0, quizScore:0, mode:null };

export function setReadingDiff(diff) {
  S.readingDifficulty = diff;
  document.querySelectorAll('.reading-diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === diff));
  saveS();
}

// ── overlay open/close ──────────────────────────────────────────────────────
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
  if (readingSession.view === 'headlines' && readingSession.source) {
    const cached = sessionHeadlines[readingSession.source];
    if (cached && cached.length) {
      renderHeadlines(cached, readingSession.source);
    } else {
      renderReadingLobby();
    }
    return;
  }
  const article = S.readingArticles.find(a => a.id === readingSession.articleId);
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
  const rp=document.getElementById('selReadingPopup');if(rp)rp.style.display='none';
  if (quizKeyHandler) { document.removeEventListener('keydown', quizKeyHandler); quizKeyHandler = null; }
  readingSession.view = readingMode === 'quiz' ? 'quiz' : readingMode === 'recap' ? 'recap' : currentArticleId ? 'article' : readingSession.source ? 'headlines' : 'lobby';
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
  const sources = lang.rssSources;
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
      ${sources.map(s => {
        const magicKey = lang.rssSources[0]; // first source is always magic/magico
        return `<button class="reading-source-btn${s===magicKey?' reading-source-btn--magic':''}" onclick="selectReadingSource('${s}')">
          <span class="src-icon">${lang.rssSourceIcons[s]||''}</span>${lang.rssBtnLabels[s]}<span class="src-label">${lang.rssSourceLabels[s]}</span>
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

// ── source selection ────────────────────────────────────────────────────────
export async function selectReadingSource(source) {
  const reqId = ++readingReqId;
  const el = document.getElementById('readingCard');
  const magicKey = lang.rssSources[0];

  // Session cache — reuse already-fetched headlines
  if (sessionHeadlines[source] && sessionHeadlines[source].length) {
    // For LLM articles, invalidate cache if difficulty changed
    if (source === magicKey && sessionHeadlines._magicDiff !== S.readingDifficulty) {
      delete sessionHeadlines[source];
    } else {
      readingSession.source = source;
      renderHeadlines(sessionHeadlines[source], source);
      return;
    }
  }

  el.innerHTML = `<div class="mem-loading" style="text-align:center;padding:40px;">${lang.ui.readingLoading}</div><button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingCancelBtn}</button>`;

  try {
    let headlines;
    if (source === magicKey) {
      headlines = await generateLLMArticles();
    } else {
      headlines = await fetchRSSHeadlines(lang.rssFeeds[source], source, reqId);
    }
    if (reqId !== readingReqId) return;
    if (!headlines || !headlines.length) {
      el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--ink);">
        <div style="font-size:14px;margin-bottom:8px;">${lang.ui.readingLoadFailed}</div>
        <div style="font-size:11px;color:#7a5520;margin-bottom:12px;">${lang.ui.readingLoadFailedSub}</div>
        <div style="display:flex;gap:6px;justify-content:center;">
          <button class="reading-back-btn" onclick="refreshSource('${source}')">${lang.ui.readingRefresh}</button>
          <button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingBack}</button>
        </div>
      </div>`;
      return;
    }
    if (reqId !== readingReqId) return;

    sessionHeadlines[source] = headlines;
    if (source === magicKey) sessionHeadlines._magicDiff = S.readingDifficulty;

    S.readingArticles = S.readingArticles || [];
    headlines.forEach(h => {
      if (!S.readingArticles.find(a => a.id === h.id)) {
        S.readingArticles.push(h);
      }
    });
    S.readingArticles = S.readingArticles.slice(-10);
    saveS();

    readingSession.source = source;
    renderHeadlines(headlines, source);
  } catch (e) {
    if (reqId !== readingReqId) return;
    el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--ink);">
      <div style="font-size:14px;margin-bottom:8px;">${lang.ui.readingLoadError}</div>
      <div style="font-size:11px;color:#7a5520;margin-bottom:12px;">${esc(e.message)}</div>
      <button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingBack}</button>
    </div>`;
  }
}

export function refreshSource(source) {
  delete sessionHeadlines[source];
  selectReadingSource(source);
}

// ── RSS fetching ────────────────────────────────────────────────────────────
async function fetchRSSHeadlines(rssUrl, source, reqId) {
  const url = `${RSS2JSON_URL}?rss_url=${encodeURIComponent(rssUrl)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 'ok' || !data.items) return null;
  return data.items.slice(0, 8).map(item => {
    const text = (item.content || item.description || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/<\/?(br|p|div|h[1-6]|li|ul|ol|blockquote|hr)[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return {
      id: 'r_' + source + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      source,
      title: (item.title || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      text,
      link: item.link || '',
      quiz: null,
      ts: Date.now(),
      completed: false,
      difficulty: S.readingDifficulty
    };
  });
}

// ── LLM article generation ──────────────────────────────────────────────────
async function generateLLMArticles() {
  const dc = lang.readingDiffConfig[S.readingDifficulty];
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="mem-loading" style="text-align:center;padding:40px;">${lang.ui.readingLoadingArticle}</div><button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingCancelBtn}</button>`;

  // Article + quiz in one large JSON (up to 4000 tokens) is the most
  // truncation-prone call in the app. If the first parse fails, regenerate once
  // before surfacing the error to the caller's retry UI.
  let parsed;
  try {
    parsed = extractJSON(await callLLM(lang.prompts.magicSys(dc.vocab), [{ role: 'user', content: lang.prompts.magicUser(dc.words) }], dc.tokens));
  } catch (e) {
    parsed = extractJSON(await callLLM(lang.prompts.magicSys(dc.vocab), [{ role: 'user', content: lang.prompts.magicUser(dc.words) }], dc.tokens));
  }
  const magicKey = lang.rssSources[0];
  const a = parsed.article || {};
  return [{
    id: 'r_' + magicKey + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    source: magicKey,
    title: a.title || '',
    text: a.text || '',
    quiz: a.quiz || null,
    ts: Date.now(),
    completed: false,
    difficulty: S.readingDifficulty
  }];
}

// ── headline list ───────────────────────────────────────────────────────────
function renderHeadlines(headlines, source) {
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="reading-headlines">
    ${headlines.map(h => {
      const wc = h.text ? h.text.split(/\s+/).length : 0;
      return `<div class="reading-headline-item" onclick="selectArticle('${esc(h.id)}')">
        <span class="hl-icon">${lang.rssSourceIcons[h.source]||''}</span>
        <span>${esc(h.title)}<span style="font-size:10px;color:#7a5520;display:block;">${lang.ui.readingWords(wc)} · ${timeAgo(h.ts)}</span></span>
      </div>`;
    }).join('')}
  </div>
  <div style="display:flex;gap:6px;justify-content:center;">
    <button class="reading-back-btn" onclick="returnToLobby()">${lang.ui.readingBack}</button>
    <button class="reading-back-btn" onclick="refreshSource('${source}')">${lang.ui.readingRefresh}</button>
  </div>`;
}

// ── article selection ───────────────────────────────────────────────────────
export async function selectArticle(articleId) {
  const reqId = ++readingReqId;
  currentArticleId = articleId;
  readingMode = null;
  quizIdx = 0; quizScore = 0; quizAnswered = false;

  const article = S.readingArticles.find(a => a.id === articleId);
  if (!article) { renderReadingLobby(); return; }

  renderArticleView(article);
}

// ── quiz generation ─────────────────────────────────────────────────────────
async function generateQuizForArticle(article) {
  const dc = lang.readingDiffConfig[article.difficulty || S.readingDifficulty];
  const raw = await callLLM(lang.prompts.quizSys(dc.quizInstr), [{ role: 'user', content: lang.prompts.quizUser(article.text.substring(0, 4000)) }], 1500, { temperature: 0.2 });
  const parsed = extractJSON(raw);
  if (parsed.quiz && parsed.quiz.length) {
    article.quiz = parsed.quiz;
  }
}

// ── article view ────────────────────────────────────────────────────────────
function renderArticleView(article) {
  const isCompleted = S.readingCompletedIds[article.id];
  const el = document.getElementById('readingCard');
  const escText = esc(article.text);
  const sourceLabel = lang.rssSourceLabels[article.source] || article.source;
  const txtAttr = article.text.substring(0, 4000).replace(/"/g, '&quot;').replace(/\n/g, ' ');
  el.innerHTML = `<div class="reading-article-wrap">
    <div class="reading-article-title">${esc(article.title)}</div>
    <div class="reading-article-meta">
      <span>${lang.rssSourceIcons[article.source]||''} ${sourceLabel}</span>
      ${isCompleted ? `<span style="color:#2a8018;">${lang.ui.readingCompleted}</span>` : `<span>${lang.ui.readingNew}</span>`}
      ${article.ts ? '<span>'+new Date(article.ts).toLocaleDateString(lang.dateLocale)+'</span>' : ''}
      ${article.link && article.source!==lang.rssSources[0] ? `<a href="${esc(article.link)}" target="_blank" style="color:var(--gold);font-size:10px;text-decoration:none;" title="${lang.ui.readingSourceTitle}">🔗 ${lang.ui.readingSourceTitle}</a>` : ''}
      <button class="reading-listen-btn" data-txt="${txtAttr}" data-rate="0.75" onclick="readingListen(this)">${lang.ui.readingListenBtn}</button>
    </div>
    <div class="reading-article-text">${escText}</div>
  </div>
  ${isCompleted ? `<div style="text-align:center;font-size:10px;color:#7a5520;margin-bottom:4px;">${lang.ui.readingAlreadyDone}</div>` : ''}
  <div class="reading-actions">
    <button onclick="startQuiz()">${lang.ui.readingQuizBtn}</button>
    <button onclick="startRecap()">${lang.ui.readingRecapBtn}</button>
  </div>
  <button class="reading-back-btn" onclick="selectReadingSource('${esc(article.source)}')">${lang.ui.readingMoreArticles(article.source)}</button>`;
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
  el.innerHTML = `<div class="reading-quiz-wrap">
    <div class="reading-quiz-prog">${lang.ui.readingQuizQuestion(quizIdx + 1, article.quiz.length)}</div>
    <div class="reading-quiz-q">${esc(q.q)}</div>
    <div class="reading-quiz-opts">
      ${q.options.map((opt, i) => `<button class="reading-quiz-opt" data-idx="${i}" onclick="answerQuiz(${i})">${esc(opt)}</button>`).join('')}
    </div>
  </div>
  <details class="reading-article-toggle">
    <summary style="cursor:pointer;font-size:11px;color:#7a5520;font-family:'Cinzel',Georgia,serif;padding:4px 8px;">${lang.ui.readingArticleToggle}</summary>
    <div class="reading-article-toggle-text">${esc(article.text)}</div>
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
    opts.forEach((btn, i) => {
      btn.classList.remove('quiz-pending');
      btn.disabled = true;
      if (i === correct) btn.classList.add('correct');
      if (i === optIdx && i !== correct) btn.classList.add('wrong');
    });
    if (optIdx === correct) quizScore++;
    quizAnswers[quizIdx] = optIdx;

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
      <div class="reading-article-toggle-text">${esc(article.text)}</div>
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
    const raw = await callLLM(lang.prompts.recapSys, [{ role: 'user', content: lang.prompts.recapUser(article.text.substring(0, 4000), text) }], 1000, { temperature: 0.2 });
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
  readingSession.view = 'lobby'; readingSession.source = null; readingSession.articleId = null; readingSession.quizIdx = 0; readingSession.quizScore = 0; readingSession.mode = null;
  renderReadingLobby();
}
