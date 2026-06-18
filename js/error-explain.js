import { S, R } from './state.js';
import { callLLM } from './llm.js';
import { esc, friendlyError, extractJSON, mdInline } from './helpers.js';

let convHistory = [];
let currentMistake = null;

const SYS = `You are a Spanish language tutor. The learner made a mistake in Spanish. Write the explanation IN SPANISH.
CRITICAL: Respond ONLY with a JSON object — no text before or after, no markdown, no backticks.
{"explanation":"...","suggestions":["...","...","..."]}
- explanation: 2-4 short paragraphs in Spanish, **bold** key grammar terms, include example sentences.
- suggestions: 3 concise follow-up questions in Spanish the learner might ask.`;

export function openErrExplain(idx) {
  currentMistake = S.mistakes[idx];
  convHistory = [];
  const ov = document.getElementById('errExplainOv');
  ov.style.display = 'flex';
  renderError();
  renderChat();
  fetchExplanation();
}

export function closeErrExplain() {
  document.getElementById('errExplainOv').style.display = 'none';
}

export async function askErrFollowUp() {
  const inp = document.getElementById('eeInp');
  const q = inp.value.trim();
  if (!q) return;
  inp.value = '';
  convHistory.push({ role: 'user', content: q });
  renderChat();
  await fetchAnswer(q);
}

export function clickErrSuggestion(q) {
  document.getElementById('eeInp').value = '';
  convHistory.push({ role: 'user', content: q });
  renderChat();
  fetchAnswer(q);
}

function sanitizeJSON(raw) {
  const inside = raw.replace(/```json|```/g, '').trim();
  return inside.replace(/(?<!\\)[\n\r]/g, ' ');
}

function renderError() {
  const m = currentMistake;
  document.getElementById('eeError').innerHTML =
    `<div class="ee-err-card">
       <div class="mw">${esc(m.wrong)}</div>
       <div class="mr">${esc(m.right)}</div>
       ${m.note ? `<div class="mn" style="margin-top:4px;">${esc(m.note)}</div>` : ''}
     </div>`;
}

function renderChat() {
  const el = document.getElementById('eeChat');
  el.innerHTML = convHistory.map(msg =>{
    if(msg.loading)return `<div class="ee-bubble ee-bubble-assistant"><div class="ee-loading" style="padding:0"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>`;
    return `<div class="ee-bubble ee-bubble-${msg.role}">${mdInline(esc(msg.content))}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function fetchExplanation() {
  const m = currentMistake;
  const userMsg = `Wrong: "${m.wrong}" → Correct: "${m.right}"${m.note ? `\nNote: ${m.note}` : ''}\nExplain this error in detail.`;
  setExplLoading(true);
  setSugg([]);
  let raw;
  try {
    raw = await callLLM(SYS, [{ role: 'user', content: userMsg }], 600);
  } catch(e) {
    setExplLoading(false);
    document.getElementById('eeExpl').innerHTML =
      `<div style="color:#d04040;font-size:12px;padding:8px 0;">${friendlyError(e)}</div>`;
    return;
  }
  let data;
  try {
    data = extractJSON(sanitizeJSON(raw));
  } catch(e) { console.warn('JSON parse falló en fetchExplanation', e); }
  convHistory = [{ role: 'assistant', content: (data && data.explanation) || raw }];
  setExplLoading(false);
  renderChat();
  setSugg((data && data.suggestions) || []);
}

async function fetchAnswer(question) {
  const m = currentMistake;
  const context = `Wrong: "${m.wrong}" → Correct: "${m.right}"${m.note ? `\nNote: ${m.note}` : ''}`;
  const msgs = [
    ...convHistory.slice(0, -1)
      .map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: question }
  ];
  if (convHistory.length === 2) {
    msgs.unshift({ role: 'user', content: context + '\nExplain this error.' });
  }
  setSugg([]);
  const loadIdx=convHistory.length;
  convHistory.push({ role: 'assistant', content: '', loading: true });
  renderChat();
  let raw;
  try {
    raw = await callLLM(SYS, msgs, 500);
  } catch(e) {
    convHistory.splice(loadIdx, 1);
    convHistory.push({ role: 'assistant', content: friendlyError(e) });
    renderChat();
    return;
  }
  convHistory.splice(loadIdx, 1);
  let data;
  try {
    data = extractJSON(sanitizeJSON(raw));
  } catch(e) { console.warn('JSON parse falló en fetchAnswer', e); }
  convHistory.push({ role: 'assistant', content: (data && (data.explanation || data.answer)) || raw });
  renderChat();
  setSugg((data && data.suggestions) || []);
}

function setExplLoading(loading) {
  document.getElementById('eeExpl').innerHTML = loading
    ? `<div class="ee-loading"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`
    : '';
}

function setSugg(suggestions) {
  document.getElementById('eeSugg').innerHTML = suggestions.length
    ? `<div class="ee-sugg-row">${suggestions.map(s =>
        `<button class="hchip" onclick="clickErrSuggestion(${JSON.stringify(s)})">${esc(s)}</button>`
      ).join('')}</div>`
    : '';
}
