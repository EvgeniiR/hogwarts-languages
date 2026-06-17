// ── MINIGAMES ──────────────────────────────────────────────────────────────
// Dictation and Translation share a single config-driven engine. The old
// code had ~140 near-mirror lines; this unification removes the duplication
// while keeping each game's distinct UI and grading logic.
import { S, R, saveS } from './state.js';
import { chars } from './characters.js';
import { callLLM } from './llm.js';
import { esc, friendlyError, normWords, extractJSON } from './helpers.js';
import { awardPoints } from './progress.js';
import { speak } from './tts.js';
import { renderSide } from './sidepanel.js';

export const GAME_DIFF={
  easy:{label:'Fácil',pts:4,penalty:2,minorPts:2,prompt:'Usa SOLO una frase muy básica y corta (máximo 5 palabras), vocabulario elemental (saludos, colores, familia, números, animales comunes). Presente simple únicamente.'},
  medium:{label:'Medio',pts:8,penalty:4,minorPts:4,prompt:'Usa una frase corta (5-8 palabras), vocabulario básico-intermedio, presente e indefinido.'},
  hard:{label:'Difícil',pts:12,penalty:6,minorPts:6,prompt:'Usa una frase de 8-12 palabras, vocabulario variado, puede incluir subjuntivo o condicional.'}
};

const GAME_TOPICS=['animales mágicos','comida y bebida','el clima','la familia','un viaje','un hechizo o poción','la escuela en Hogwarts','un objeto mágico','un amigo','el tiempo libre','un libro','un sueño','una fiesta','el bosque prohibido','un castillo','una mascota','el deporte','la ropa','un cumpleaños','las vacaciones'];

// ── Shared round state ──────────────────────────────────────────────────────
let gameTab='dictation', gameCombo=0;
let round={sentence:'',ref:'',phrase:'',checked:false,review:false};
let recentDictSentences=[], recentTranslPhrases=[];

function randomTopic(){return GAME_TOPICS[Math.floor(Math.random()*GAME_TOPICS.length)];}
function rememberRecent(arr,val){arr.push(val);if(arr.length>8)arr.shift();}
function pickReviewItem(predicate){
  const pool=S.mistakes.filter(predicate);
  return pool.length?pool[Math.floor(Math.random()*pool.length)]:null;
}

// ── Overlay open/close ────────────────────────────────────────────────────
export function openGames(){renderGames();document.getElementById('gamesOv').style.display='flex';}
export function closeGames(){document.getElementById('gamesOv').style.display='none';window.speechSynthesis.cancel();}
export function setGameTab(t){
  gameTab=t;
  document.querySelectorAll('#gamesOv .settings-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));
  renderGames();
}
export function setGameDifficulty(d){
  S.gameDifficulty=d;saveS();
  if(gameTab==='dictation')genDictation();else genTranslation();
}

function diffSelectorHtml(){
  return `<div class="vadd-row" style="margin-bottom:10px;">${Object.keys(GAME_DIFF).map(k=>
    `<button onclick="setGameDifficulty('${k}')" style="${S.gameDifficulty===k?'background:rgba(139,105,20,.15);':''}">${GAME_DIFF[k].label}</button>`
  ).join('')}</div>`;
}

export function renderGames(){
  if(gameTab==='dictation'){if(!round.sentence||round.checked)genDictation();else renderDictationRound();}
  else{if(!round.phrase||round.checked)genTranslation();else renderTranslationRound();}
}

// ── Shared scoring helper ──────────────────────────────────────────────────
function award(tier){
  const diff=GAME_DIFF[S.gameDifficulty];
  let bonus=0;
  if(tier==='correct'){
    gameCombo++;if(gameCombo%3===0)bonus=2;
    awardPoints(diff.pts+bonus);
  }else{
    gameCombo=0;
    awardPoints(tier==='minor'?diff.minorPts:-diff.penalty);
  }
  return {diff,bonus};
}

function wordDiffHtml(inputWords,refWords){
  return refWords.map((w,i)=>`<span class="${inputWords[i]===w?'mr':'mw'}">${esc(w)}</span>`).join(' ');
}
function wordMaskHint(sentence){
  const words=normWords(sentence);
  if(!words.length)return '';
  return words.map((w,i)=>i===0?w:'_'.repeat(w.length)).join(' ');
}

// ── DICTATION ──────────────────────────────────────────────────────────────
export async function genDictation(){
  const el=document.getElementById('gamesContent');
  round={sentence:'',ref:'',phrase:'',checked:false,review:false};
  el.innerHTML=diffSelectorHtml()+'<div class="edim">✨ Generando oración…</div>';
  const review=Math.random()<0.3?pickReviewItem(m=>m.source==='dictado'):null;
  if(review){round.sentence=review.right;round.review=true;renderDictationRound();return;}
  const topic=randomTopic();
  const avoid=recentDictSentences.length?` No repitas ni te parezcas a estas oraciones recientes: ${recentDictSentences.map(s=>`"${s}"`).join('; ')}.`:'';
  try{
    const txt=await callLLM(null,[{role:'user',content:`Eres ${chars[R.cur].name}. ${GAME_DIFF[S.gameDifficulty].prompt} Tema: ${topic}. Genera UNA oración en español sobre ese tema que dirías tú, para un ejercicio de dictado.${avoid} Refleja tu personalidad. Solo la oración, sin comillas ni explicaciones.`}],60,'low');
    round.sentence=txt.trim();rememberRecent(recentDictSentences,round.sentence);
  }catch(e){
    el.innerHTML=diffSelectorHtml()+`<div style="font-size:12px;color:#d04040;margin-bottom:8px;">${esc(friendlyError(e))}</div><button class="fc-btn" style="width:100%;" onclick="genDictation()">Reintentar</button>`;
    return;
  }
  renderDictationRound();
}
function renderDictationRound(){
  document.getElementById('gamesContent').innerHTML=diffSelectorHtml()+`
    <div class="svc-row" style="text-align:center;">
      ${round.review?'<div class="edim">🔁 Repaso de un error anterior</div>':''}
      <button onclick="speak(dictSentence)" style="margin-bottom:6px;">🔊 Escuchar</button>
      <button onclick="speak(dictSentence,0.55)" style="margin-bottom:8px;">🐢 Más despacio</button>
      <input id="dictInput" placeholder="Escribe lo que escuchaste…" autocomplete="off">
      <div class="vadd-row">
        <button onclick="hintDictation()">💡 Pista</button>
        <button onclick="checkDictation()">Comprobar</button>
        <button onclick="skipDictation()">⏭ Saltar (-1)</button>
      </div>
    </div>
    <div id="dictResult"></div>`;
  // expose sentence to the onclick handlers (no closure available in innerHTML)
  window.dictSentence=round.sentence;
}
export function hintDictation(){document.getElementById('dictResult').innerHTML=`<div class="edim">💡 ${wordMaskHint(round.sentence)}</div>`;}
export function skipDictation(){gameCombo=0;awardPoints(-1);genDictation();}
export function checkDictation(){
  if(round.checked)return;
  const input=document.getElementById('dictInput').value;
  const a=normWords(input),b=normWords(round.sentence);
  const matches=b.filter((w,i)=>a[i]===w).length;
  const ratio=matches/Math.max(a.length,b.length,1);
  const tier=ratio===1&&a.length===b.length?'correct':ratio>=0.7?'minor':'incorrect';
  round.checked=true;
  const {pushLevelOutcome}=window;if(pushLevelOutcome)pushLevelOutcome(tier==='correct');
  const {diff,bonus}=award(tier);
  if(tier!=='correct'){
    S.mistakes.push({wrong:input,right:round.sentence,note:'Dictado',ts:Date.now(),source:'dictado'});
    renderSide();
  }
  saveS();
  const tierColor={correct:'#5ab030',minor:'#c08020',incorrect:'#d04040'}[tier];
  const tierMsg={correct:'✓ ¡Correcto! +'+diff.pts+' pts',minor:'〜 Casi correcto. +'+diff.minorPts+' pts',incorrect:'✗ Incorrecto. -'+diff.penalty+' pts'}[tier];
  document.getElementById('dictResult').innerHTML=`<div style="margin-top:8px;font-size:12px;">${wordDiffHtml(a,b)}</div><div style="margin-top:6px;font-size:11px;color:${tierColor};">${tierMsg}${bonus?` · 🔥 ¡Combo x${gameCombo}! +${bonus} pts`:''}</div><button class="fc-btn" style="margin-top:8px;width:100%;" onclick="genDictation()">Siguiente →</button>`;
}

// ── TRANSLATION ─────────────────────────────────────────────────────────────
export async function genTranslation(){
  const el=document.getElementById('gamesContent');
  round={sentence:'',ref:'',phrase:'',checked:false,review:false};
  el.innerHTML=diffSelectorHtml()+'<div class="edim">✨ Generando frase…</div>';
  const review=Math.random()<0.3?pickReviewItem(m=>m.source==='traduccion'&&m.phrase):null;
  if(review){round.phrase=review.phrase;round.ref=review.right;round.review=true;renderTranslationRound();return;}
  const topic=randomTopic();
  const avoid=recentTranslPhrases.length?` No repitas ni te parezcas a estas frases recientes: ${recentTranslPhrases.map(s=>`"${s}"`).join('; ')}.`:'';
  try{
    const raw=await callLLM(null,[{role:'user',content:`Eres ${chars[R.cur].name}. ${GAME_DIFF[S.gameDifficulty].prompt} Tema: ${topic}. Genera UNA frase corta en INGLÉS sobre ese tema para que el estudiante la traduzca al español.${avoid} Refleja tu personalidad. RESPONDE SOLO con este JSON: {"phrase":"frase en inglés","refTranslation":"una traducción correcta al español"}`}],100,'low');
    const parsed=extractJSON(raw);
    round.phrase=parsed.phrase;round.ref=parsed.refTranslation||'';
    rememberRecent(recentTranslPhrases,round.phrase);
  }catch(e){
    el.innerHTML=diffSelectorHtml()+`<div style="font-size:12px;color:#d04040;margin-bottom:8px;">${esc(friendlyError(e))}</div><button class="fc-btn" style="width:100%;" onclick="genTranslation()">Reintentar</button>`;
    return;
  }
  renderTranslationRound();
}
function renderTranslationRound(){
  document.getElementById('gamesContent').innerHTML=diffSelectorHtml()+`
    <div class="svc-row">
      ${round.review?'<div class="edim">🔁 Repaso de un error anterior</div>':''}
      <div class="svc-lbl">Traduce al español:</div>
      <div style="font-size:13px;color:var(--ink);margin-bottom:8px;font-style:italic;">"${esc(round.phrase)}"</div>
      <input id="translInput" placeholder="Tu traducción…" autocomplete="off">
      <div class="vadd-row">
        <button onclick="hintTranslation()">💡 Pista</button>
        <button onclick="checkTranslation(this)">Comprobar</button>
        <button onclick="skipTranslation()">⏭ Saltar (-1)</button>
      </div>
    </div>
    <div id="translResult"></div>`;
}
export function hintTranslation(){
  const hint=wordMaskHint(round.ref);
  document.getElementById('translResult').innerHTML=hint?`<div class="edim">💡 ${hint}</div>`:'<div class="edim">Sin pista disponible para esta frase.</div>';
}
export function skipTranslation(){gameCombo=0;awardPoints(-1);genTranslation();}
export async function checkTranslation(btn){
  if(round.checked)return;
  const input=document.getElementById('translInput').value.trim();
  if(!input)return;
  btn.textContent='Comprobando…';btn.disabled=true;
  let verdict;
  try{
    const raw=await callLLM(null,[{role:'user',content:`Frase en inglés: "${round.phrase}". El estudiante tradujo: "${input}". El estudiante no tiene teclado español, así que IGNORA tildes/acentos faltantes y "n" en vez de "ñ" — no los marques como error. Clasifica la traducción como "correct" (completamente correcta, acepta variantes válidas), "minor" (un error pequeño pero se entiende el significado, ej. una palabra equivocada o un pequeño fallo de concordancia), o "incorrect" (el significado está mal o falta algo importante). RESPONDE SOLO con este JSON: {"status":"correct","correction":"traducción correcta","note":"breve explicación en español"}`}],100,'low');
    verdict={status:'incorrect',correction:round.ref||round.phrase,note:'',...extractJSON(raw)};
  }catch(e){
    btn.textContent='Comprobar';btn.disabled=false;
    document.getElementById('translResult').innerHTML=`<div style="font-size:12px;color:#d04040;">${esc(friendlyError(e))}</div>`;
    return;
  }
  round.checked=true;
  const tier=verdict.status;
  const {pushLevelOutcome}=window;if(pushLevelOutcome)pushLevelOutcome(tier==='correct');
  const {diff,bonus}=award(tier);
  if(tier!=='correct'){
    S.mistakes.push({wrong:input,right:verdict.correction,note:verdict.note||'Traducción',ts:Date.now(),source:'traduccion',phrase:round.phrase});
    renderSide();
  }
  saveS();
  const transDiffHtml=tier!=='correct'?wordDiffHtml(normWords(input),normWords(verdict.correction)):'';
  const tierColor={correct:'#5ab030',minor:'#c08020',incorrect:'#d04040'}[tier];
  const tierMsg={correct:'✓ ¡Correcto! +'+diff.pts+' pts',minor:'〜 Casi correcto. +'+diff.minorPts+' pts',incorrect:'✗ Incorrecto. -'+diff.penalty+' pts'}[tier];
  document.getElementById('translResult').innerHTML=`<div style="margin-top:8px;font-size:12px;color:${tierColor};">${tierMsg}${bonus?` · 🔥 ¡Combo x${gameCombo}! +${bonus} pts`:''}</div>${transDiffHtml?`<div style="margin-top:6px;font-size:12px;">${transDiffHtml}</div>`:''}${verdict.note?`<div style="font-size:11px;color:var(--mt);margin-top:4px;">${esc(verdict.note)}</div>`:''}<button class="fc-btn" style="margin-top:8px;width:100%;" onclick="genTranslation()">Siguiente →</button>`;
}
