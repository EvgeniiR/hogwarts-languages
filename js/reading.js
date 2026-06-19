// ── EL PROFETA ─────────────────────────────────────────────────────────────
// Reading comprehension overlay. Nine content sources: eight human-written RSS
// feeds + LLM-generated Harry Potter lore. User reads an article then takes a
// quiz or writes a recap verified by one LLM call.
import { S, saveS } from './state.js';
import { esc, showToast, extractJSON } from './helpers.js';
import { callLLM } from './llm.js';
import { awardPoints } from './progress.js';

const RSS_FEEDS = {
  noticias:    'https://www.20minutos.es/rss',
  ciencia:     'https://www.hipertextual.com/feed',
  arte:        'https://www.abc.es/rss/feeds/abc_Cultura.xml',
  naturaleza:  'https://www.abc.es/rss/feeds/abc_Natural.xml',
  tecnologia:  'https://www.abc.es/rss/feeds/abc_Tecnologia.xml',
  viajes:      'https://www.descubrir.com/rss',
  sociedad:    'https://www.eldiario.es/rss',
  diseno:      'https://www.yorokobu.es/feed'
};
const RSS2JSON_URL = 'https://api.rss2json.com/v1/api.json';
const SOURCE_ICONS = { noticias:'📰', ciencia:'🔬', arte:'🎨', naturaleza:'🦁', tecnologia:'💻', viajes:'✈️', sociedad:'🏛', diseno:'🎭', magico:'⚡' };
const SOURCE_LABELS = { noticias:'20minutos · RSS', ciencia:'Hipertextual · RSS', arte:'ABC Cultura · RSS', naturaleza:'ABC Natural · RSS', tecnologia:'ABC Tecnología · RSS', viajes:'Descubrir.com · RSS', sociedad:'ElDiario.es · RSS', diseno:'Yorokobu · RSS', magico:'⚡ IA · Harry Potter' };
const BTN_LABELS = { noticias:'Actualidad', ciencia:'Ciencia', arte:'Arte', naturaleza:'Naturaleza', tecnologia:'Tecnología', viajes:'Viajes', sociedad:'Sociedad', diseno:'Diseño', magico:'Mundo mágico' };

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} hora${hrs!==1?'s':''}`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `hace ${days} día${days!==1?'s':''}`;
  return `hace ${Math.floor(days/30)} mes${Math.floor(days/30)!==1?'es':''}`;
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

const DIFF_CONFIG = {
  easy:   { count:1, words:'250-350', vocab:'Vocabulario: sencillo y natural, frases cortas, presente e indefinido.', tokens:2000, quizInstr:'preguntas de comprensión literal, opciones con vocabulario básico', icon:'📗', label:'Fácil' },
  medium: { count:1, words:'500-600', vocab:'Vocabulario: intermedio y natural, subjuntivo ocasional, estructuras variadas.', tokens:3000, quizInstr:'preguntas de comprensión literal e inferencia simple, opciones con vocabulario intermedio', icon:'📙', label:'Medio' },
  hard:   { count:1, words:'750-850', vocab:'Vocabulario: rico y natural, con subjuntivo, condicional y modismos cuando resulten apropiados, evitando palabras innecesariamente rebuscadas.', tokens:4000, quizInstr:'preguntas de inferencia, tono del autor y matices, opciones con vocabulario avanzado', icon:'📕', label:'Difícil' }
};
const DIFF_MULT = { easy:1, medium:1.5, hard:2 };

export function setReadingDiff(diff) {
  S.readingDifficulty = diff;
  document.querySelectorAll('.reading-diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === diff));
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
  const sources = ['magico','noticias','ciencia','arte','naturaleza','tecnologia','viajes','sociedad','diseno'];
  el.innerHTML = `<div class="reading-lobby">
    <div class="reading-lobby-title">📰 EL PROFETA</div>
    <div class="reading-lobby-sub">Lee artículos en español y demuestra tu comprensión</div>
    ${S.readingCompleted > 0 ? `<div style="font-size:11px;color:var(--gold);margin-bottom:6px;">📚 ${S.readingCompleted} artículo${S.readingCompleted!==1?'s':''} completado${S.readingCompleted!==1?'s':''}</div>` : ''}
    <div class="reading-diff-row">
      <button class="reading-diff-btn ${S.readingDifficulty==='easy'?'active':''}" data-diff="easy" onclick="setReadingDiff('easy')">📗 Fácil</button>
      <button class="reading-diff-btn ${S.readingDifficulty==='medium'?'active':''}" data-diff="medium" onclick="setReadingDiff('medium')">📙 Medio</button>
      <button class="reading-diff-btn ${S.readingDifficulty==='hard'?'active':''}" data-diff="hard" onclick="setReadingDiff('hard')">📕 Difícil</button>
    </div>
    <div class="reading-source-grid">
      ${sources.map(s => `<button class="reading-source-btn${s==='magico'?' reading-source-btn--magic':''}" onclick="selectReadingSource('${s}')">
        <span class="src-icon">${SOURCE_ICONS[s]||''}</span>${BTN_LABELS[s]}<span class="src-label">${SOURCE_LABELS[s]}</span>
      </button>`).join('')}
    </div>
  </div>`;
}

// ── source selection ────────────────────────────────────────────────────────
export async function selectReadingSource(source) {
  const reqId = ++readingReqId;
  const el = document.getElementById('readingCard');

  // Session cache — reuse already-fetched headlines
  if (sessionHeadlines[source] && sessionHeadlines[source].length) {
    // For LLM articles, invalidate cache if difficulty changed
    if (source === 'magico' && sessionHeadlines._magicoDiff !== S.readingDifficulty) {
      delete sessionHeadlines[source];
    } else {
      readingSession.source = source;
      renderHeadlines(sessionHeadlines[source], source);
      return;
    }
  }

  el.innerHTML = '<div class="mem-loading" style="text-align:center;padding:40px;">Cargando artículos…</div><button class="reading-back-btn" onclick="returnToLobby()">← Cancelar</button>';

  try {
    let headlines;
    if (source === 'magico') {
      headlines = await generateLLMArticles();
    } else {
      headlines = await fetchRSSHeadlines(RSS_FEEDS[source], source, reqId);
    }
    if (reqId !== readingReqId) return;
    if (!headlines || !headlines.length) {
      el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--ink);">
        <div style="font-size:14px;margin-bottom:8px;">No se pudieron cargar los artículos</div>
        <div style="font-size:11px;color:#7a5520;margin-bottom:12px;">El servicio no está disponible ahora. Intenta con otra fuente.</div>
        <div style="display:flex;gap:6px;justify-content:center;">
          <button class="reading-back-btn" onclick="refreshSource('${source}')">🔄 Reintentar</button>
          <button class="reading-back-btn" onclick="returnToLobby()">← Volver al menú</button>
        </div>
      </div>`;
      return;
    }
    if (reqId !== readingReqId) return;

    sessionHeadlines[source] = headlines;
    if (source === 'magico') sessionHeadlines._magicoDiff = S.readingDifficulty;

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
      <div style="font-size:14px;margin-bottom:8px;">Error al cargar artículos</div>
      <div style="font-size:11px;color:#7a5520;margin-bottom:12px;">${esc(e.message)}</div>
      <button class="reading-back-btn" onclick="returnToLobby()">← Volver al menú</button>
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
      .replace(/<[^>]*>/g, '\n')
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
  const dc = DIFF_CONFIG[S.readingDifficulty];
  const el = document.getElementById('readingCard');
  el.innerHTML = '<div class="mem-loading" style="text-align:center;padding:40px;">Generando artículo…</div><button class="reading-back-btn" onclick="returnToLobby()">← Cancelar</button>';

  const sys = `Eres Rita Skeeter, reportera estrella del diario "El Profeta". Tu estilo: sensacionalista, vívido y adictivo. Escribes historias que atrapan, jamás entradas de enciclopedia. MUESTRAS escenas concretas, diálogos breves y detalles específicos; EVITAS afirmaciones generales o resúmenes abstractos. Exageras dramáticamente, pero NO inventas hechos que contradigan el canon de Harry Potter: si introduces rumores o especulación, los presentas claramente como tales. ${dc.vocab}. Registro: periodístico natural de revista dominical, con párrafos cortos (3-5 frases) para lectura fluida.
REGLAS DEL CUESTIONARIO: 4 preguntas que evalúen comprensión de matices y detalles concretos, no lo obvio. Opciones incorrectas plausibles pero distinguibles para un lector atento. El campo "correct" es el índice entero basado en CERO (0, 1, 2 o 3) de la opción correcta.`;
  const user = `Generas UN SOLO artículo para "El Profeta". No escribas introducciones, listas ni múltiples historias — uno solo. EXTENSIÓN EXACTA: ${dc.words} palabras. Título: provocador, estilo tabloide mágico (nunca descriptivo-académico). Estructura narrativa: gancho inicial potente → desarrollo con tensión creciente → cierre memorable. Respeta el canon de Harry Potter. Elige UN tema: personajes emblemáticos, hechizos legendarios, criaturas fascinantes, lugares ocultos de Hogwarts, eventos históricos del mundo mágico, clases memorables, pociones célebres, objetos encantados, duelos épicos, secretos del Ministerio, historias de las casas o misterios jamás resueltos. Responde SOLO con JSON sin texto adicional: {"article":{"title":"...","text":"...","quiz":[{"q":"...","options":["A","B","C","D"],"correct":0}]}}`;

  const raw = await callLLM(sys, [{ role: 'user', content: user }], dc.tokens);
  const parsed = extractJSON(raw);
  const a = parsed.article || {};
  return [{
    id: 'r_magico_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    source: 'magico',
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
        <span class="hl-icon">${SOURCE_ICONS[h.source]||''}</span>
        <span>${esc(h.title)}<span style="font-size:10px;color:#7a5520;display:block;">~${wc} palabras · ${timeAgo(h.ts)}</span></span>
      </div>`;
    }).join('')}
  </div>
  <div style="display:flex;gap:6px;justify-content:center;">
    <button class="reading-back-btn" onclick="returnToLobby()">← Elegir otra fuente</button>
    <button class="reading-back-btn" onclick="refreshSource('${source}')">🔄 Actualizar</button>
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
  const dc = DIFF_CONFIG[article.difficulty || S.readingDifficulty];
  const sys = `Eres un profesor de español. Generas preguntas de comprensión lectora. ${dc.quizInstr}.`;
  const user = `Basado en este artículo en español, genera 4 preguntas de opción múltiple con 4 opciones cada una. La opción correcta debe estar claramente basada en el texto. Responde SOLO con JSON: {"quiz":[{"q":"pregunta","options":["A","B","C","D"],"correct":0}]}. Artículo:\n\n${article.text.substring(0, 4000)}`;
  const raw = await callLLM(sys, [{ role: 'user', content: user }], 1500);
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
  const sourceLabel = SOURCE_LABELS[article.source] || article.source;
  // Escape text for data-txt attribute (no double quotes that break attribute)
  const txtAttr = article.text.substring(0, 4000).replace(/"/g, '&quot;').replace(/\n/g, ' ');
  el.innerHTML = `<div class="reading-article-wrap">
    <div class="reading-article-title">${esc(article.title)}</div>
    <div class="reading-article-meta">
      <span>${SOURCE_ICONS[article.source]||''} ${sourceLabel}</span>
      ${isCompleted ? '<span style="color:#2a8018;">✓ Completado</span>' : '<span>Nuevo</span>'}
      ${article.ts ? '<span>'+new Date(article.ts).toLocaleDateString('es-ES')+'</span>' : ''}
      ${article.link && article.source!=='magico' ? `<a href="${esc(article.link)}" target="_blank" style="color:var(--gold);font-size:10px;text-decoration:none;" title="Abrir artículo original">🔗 Fuente</a>` : ''}
      <button class="reading-listen-btn" data-txt="${txtAttr}" data-rate="0.75" onclick="readingListen(this)"><i class="ti ti-volume"></i> Leer en voz alta</button>
    </div>
    <div class="reading-article-text">${escText}</div>
  </div>
  ${isCompleted ? '<div style="text-align:center;font-size:10px;color:#7a5520;margin-bottom:4px;">Ya completado — puedes repetir sin puntos extra</div>' : ''}
  <div class="reading-actions">
    <button onclick="startQuiz()">📝 Cuestionario</button>
    <button onclick="startRecap()">✍️ Resumen</button>
  </div>
  <button class="reading-back-btn" onclick="selectReadingSource('${esc(article.source)}')">← Más artículos</button>`;
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
    el.innerHTML = '<div class="mem-loading" style="text-align:center;padding:40px;">Generando preguntas…</div><button class="reading-back-btn" onclick="selectArticle(\'' + esc(article.id) + '\')">← Cancelar</button>';
    try {
      await generateQuizForArticle(article);
      if (reqId !== readingReqId) return;
      saveS();
    } catch (e) {
      if (reqId !== readingReqId) return;
      renderArticleView(article);
      showToast('No se pudieron generar las preguntas. Inténtalo de nuevo.');
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
    <div class="reading-quiz-prog">Pregunta ${quizIdx + 1} de ${article.quiz.length}</div>
    <div class="reading-quiz-q">${esc(q.q)}</div>
    <div class="reading-quiz-opts">
      ${q.options.map((opt, i) => `<button class="reading-quiz-opt" data-idx="${i}" onclick="answerQuiz(${i})">${esc(opt)}</button>`).join('')}
    </div>
  </div>
  <details class="reading-article-toggle">
    <summary style="cursor:pointer;font-size:11px;color:#7a5520;font-family:'Cinzel',Georgia,serif;padding:4px 8px;">📖 Ver artículo</summary>
    <div class="reading-article-toggle-text">${esc(article.text)}</div>
  </details>
  <button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">← Volver al artículo</button>`;
}

export function answerQuiz(optIdx) {
  if (quizAnswered) return;
  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article) return;

  const opts = document.querySelectorAll('.reading-quiz-opt');
  // Clear previous pending highlight
  opts.forEach(b => b.classList.remove('quiz-pending'));

  if (quizPendingTimer) {
    clearTimeout(quizPendingTimer);
  }

  // Highlight pending selection
  if (opts[optIdx]) opts[optIdx].classList.add('quiz-pending');

  // Lock in after 800ms — user can change selection within window
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
  let feedback = '';
  if (ratio >= 1) feedback = '¡Excelente! Has comprendido todo el artículo.';
  else if (ratio >= 0.75) feedback = 'Muy bien, has entendido la mayor parte.';
  else if (ratio >= 0.5) feedback = 'Bien, aunque algunos detalles se te escaparon.';
  else feedback = 'Sigue practicando — relee el artículo e inténtalo de nuevo.';

  el.innerHTML = `<div class="reading-result-wrap">
    <div class="reading-result-score">${quizScore}/${total}</div>
    <div class="reading-result-label">${pct}% correcto</div>
    <div style="font-size:12px;color:var(--ink);font-style:italic;line-height:1.6;margin-bottom:8px;">${feedback}</div>
    ${pointsAwarded > 0 ? `<div class="reading-result-label" style="color:#2a8018;">+${pointsAwarded} puntos</div>` : `<div class="reading-result-label" style="color:#7a5520;">Ya completado — sin puntos extra</div>`}
    <div class="reading-quiz-review">
      ${article.quiz.map((q, i) => {
        const chosen = quizAnswers[i] !== undefined ? quizAnswers[i] : -1;
        const isCorrect = chosen === q.correct;
        return `<div class="reading-quiz-review-item ${isCorrect ? 'review-correct' : 'review-wrong'}">
          <span>${isCorrect ? '✓' : '✗'}</span>
          <span>${esc(q.q)}</span>
          ${!isCorrect && chosen >= 0 ? `<span style="font-size:10px;display:block;color:#5ab030;">Respuesta correcta: ${esc(q.options[q.correct])}</span>` : ''}
          ${chosen < 0 ? `<span style="font-size:10px;display:block;color:#7a5520;">Sin responder</span>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="reading-actions">
      <button onclick="startQuiz()">🔄 Reintentar</button>
      <button onclick="selectArticle('${esc(article.id)}')">← Volver al artículo</button>
    </div>
    <button class="reading-back-btn" onclick="returnToLobby()">📰 Menú</button>
  </div>`;
}

// ── recap ───────────────────────────────────────────────────────────────────
export function startRecap() {
  readingMode = 'recap';
  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article) return;
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="reading-recap-wrap">
    <div style="font-size:11px;color:#7a5520;margin-bottom:6px;">Escribe un resumen en español (3-5 frases) de lo que has leído:</div>
    <details class="reading-article-toggle">
      <summary style="cursor:pointer;font-size:11px;color:#7a5520;font-family:'Cinzel',Georgia,serif;padding:4px 8px;">📖 Ver artículo</summary>
      <div class="reading-article-toggle-text">${esc(article.text)}</div>
    </details>
    <textarea class="reading-recap-ta" id="recapTa" placeholder="El artículo trata sobre..."></textarea>
    <div class="reading-actions" style="margin-top:10px;">
      <button onclick="submitRecap()">✉️ Enviar</button>
    </div>
    <button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">← Volver al artículo</button>
  </div>`;
}

export async function submitRecap() {
  if (readingMode !== 'recap') return;
  const reqId = ++readingReqId;
  const ta = document.getElementById('recapTa');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text || text.length < 20) {
    showToast('Escribe al menos 20 caracteres');
    return;
  }

  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article) return;

  const el = document.getElementById('readingCard');
  el.innerHTML = '<div class="mem-loading" style="text-align:center;padding:40px;">Evaluando tu resumen…</div><button class="reading-back-btn" onclick="selectArticle(\'' + esc(article.id) + '\')">← Cancelar</button>';

  try {
    const sys = 'Eres un profesor de español. Evalúas la comprensión lectora de un estudiante basándote en su resumen. Sé justo pero exigente. Responde SOLO con JSON.';
    const user = `Artículo:\n${article.text.substring(0, 4000)}\n\nResumen del estudiante:\n${text}\n\nEvalúa el resumen. Responde SOLO con JSON: {"score":0-1,"feedback":"breve comentario en español (2-3 frases)","missedKeyPoints":["punto clave no mencionado"]}`;
    const raw = await callLLM(sys, [{ role: 'user', content: user }], 1000);
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
      <div style="font-size:14px;margin-bottom:8px;">Error al evaluar</div>
      <div style="font-size:11px;color:#7a5520;margin-bottom:12px;">${esc(e.message)}</div>
      <button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">← Volver al artículo</button>
    </div>`;
  }
}

function renderRecapResults(article, score, feedback, missedPoints, pointsAwarded) {
  readingMode = null;
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="reading-result-wrap">
    <div class="reading-result-score">${Math.round(score * 100)}%</div>
    <div class="reading-result-label">Comprensión evaluada</div>
    ${feedback ? `<div class="reading-recap-fb">${esc(feedback)}</div>` : ''}
    ${missedPoints.length ? `<div class="reading-recap-fb"><strong>Puntos clave no mencionados:</strong><br>${missedPoints.map(p => '• ' + esc(p)).join('<br>')}</div>` : ''}
    ${pointsAwarded > 0 ? `<div class="reading-result-label" style="color:#2a8018;">+${pointsAwarded} puntos</div>` : `<div class="reading-result-label" style="color:#7a5520;">Ya completado — sin puntos extra</div>`}
    <div class="reading-actions">
      <button onclick="startRecap()">🔄 Reintentar</button>
      <button onclick="selectArticle('${esc(article.id)}')">← Volver al artículo</button>
    </div>
    <button class="reading-back-btn" onclick="returnToLobby()">📰 Menú</button>
  </div>`;
}

// ── back to lobby ───────────────────────────────────────────────────────────
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
    u.lang = 'es-ES';
    u.onend = () => btn.classList.remove('active');
    u.onerror = () => btn.classList.remove('active');
    window.speechSynthesis.speak(u);
  } else {
    btn.classList.remove('active');
  }
}

export function returnToLobby() {

// ── back to lobby (original) ─────────────────────────────────────────────────
  readingSession.view = 'lobby'; readingSession.source = null; readingSession.articleId = null; readingSession.quizIdx = 0; readingSession.quizScore = 0; readingSession.mode = null;
  renderReadingLobby();
}
