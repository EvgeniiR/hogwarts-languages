import { S, R, saveS } from './state.js';
import { chars, LEVELS } from './characters.js';
import { callLLM } from './llm.js';
import { esc, friendlyError, normWords, extractJSON } from './helpers.js';
import { awardPoints, pushLevelOutcome } from './progress.js';
import { renderSide } from './sidepanel.js';
import { playCorrect, playMinor, playIncorrect } from './audio.js';
import { round, game, GAME_DIFF, randomTopic, rememberRecent, pickReviewItem, diffSelectorHtml, award, wordDiffHtml, wordMaskHint, recentTranslPhrases } from './game-core.js';

let translReqId=0;
export async function genTranslation(){
  const el=document.getElementById('gamesContent');
  round.sentence='';round.ref='';round.phrase='';round.checked=false;round.review=false;
  el.innerHTML=diffSelectorHtml()+'<div class="mem-loading">Generando frase</div>';
  const review=Math.random()<0.3?pickReviewItem(m=>m.source==='traduccion'&&m.phrase):null;
  if(review){round.phrase=review.phrase;round.ref=review.right;round.review=true;renderTranslationRound();return;}
  const topic=randomTopic();
  const avoid=recentTranslPhrases.length?` No repitas ni te parezcas a estas frases recientes: ${recentTranslPhrases.map(s=>`"${s}"`).join('; ')}.`:'';
  const reqId=++translReqId;
  try{
    const raw=await callLLM(`Eres un profesor de español generando ejercicios de traducción inglés→español para un estudiante de nivel ${LEVELS[S.level]}.`,[{role:'user',content:`Eres ${chars[R.cur].name}. ${GAME_DIFF[S.gameDifficulty].prompt} Tema: ${topic}. Genera UNA frase corta en INGLÉS sobre ese tema para que el estudiante la traduzca al español.${avoid} Refleja tu personalidad. RESPONDE SOLO con este JSON: {"phrase":"frase en inglés","refTranslation":"una traducción correcta al español"}`}],100,'low');
    if(reqId!==translReqId)return;
    const parsed=extractJSON(raw);
    round.phrase=parsed.phrase;round.ref=parsed.refTranslation||'';
    rememberRecent(recentTranslPhrases,round.phrase);
  }catch(e){
    el.innerHTML=diffSelectorHtml()+`<div class="game-error">${esc(friendlyError(e))}</div><button class="fc-btn" style="width:100%;" onclick="genTranslation()">Reintentar</button>`;
    return;
  }
  renderTranslationRound();
}

export function renderTranslationRound(){
  document.getElementById('gamesContent').innerHTML=diffSelectorHtml()+`
    <div class="svc-row" style="text-align:center;">
      ${round.review?'<div class="edim">🔁 Repaso de un error anterior</div>':''}
      <div class="svc-lbl" style="text-align:center;">Traduce al español:</div>
      <div class="game-phrase" style="text-align:center;">"${esc(round.phrase)}"</div>
      <input id="translInput" class="game-input" placeholder="Tu traducción…" autocomplete="off">
      <div class="vadd-row">
        <button aria-label="Pista" onclick="hintTranslation()">💡 Pista</button>
        <button aria-label="Comprobar traducción" onclick="checkTranslation(this)">✅ Comprobar</button>
        <button aria-label="Saltar, -1 punto" onclick="skipTranslation()">⏭ Saltar (-1)</button>
      </div>
    </div>
    <div id="translResult"></div>`;
}

export function hintTranslation(){
  const hint=wordMaskHint(round.ref);
  document.getElementById('translResult').innerHTML=hint?`<div class="edim">💡 ${hint}</div>`:'<div class="edim">Sin pista disponible para esta frase.</div>';
}

export function skipTranslation(){game.combo=0;awardPoints(-1);genTranslation();}

export async function checkTranslation(btn){
  if(round.checked)return;
  const input=document.getElementById('translInput').value.trim();
  if(!input)return;
  // Disable all action buttons to prevent skip/hint races during the async LLM call.
  document.querySelectorAll('#gamesContent .vadd-row button').forEach(b=>{b.disabled=true;});
  btn.classList.add('loading-btn');
  btn.textContent='⏳ Comprobando…';
  let verdict;
  try{
    const raw=await callLLM(null,[{role:'user',content:`Evalúa esta traducción inglés→español:

Frase en inglés: "${round.phrase}"
El estudiante tradujo: "${input}"

REGLAS:
- IGNORA tildes/acentos faltantes y "n" en vez de "ñ" — no son errores.
- "correct": traducción completamente correcta (acepta variantes válidas).
- "minor": un error pequeño pero se entiende el significado.
- "incorrect": el significado está mal o falta algo importante.

Responde SOLO con: {"status":"correct|minor|incorrect","correction":"traducción correcta","note":"breve explicación en español"}`}],100,'medium');
    verdict={status:'incorrect',correction:round.ref||round.phrase,note:'',...extractJSON(raw)};
  }catch(e){
    document.querySelectorAll('#gamesContent .vadd-row button').forEach(b=>{b.disabled=false;});
    btn.classList.remove('loading-btn');
    btn.textContent='✅ Comprobar';
    document.getElementById('translResult').innerHTML=`<div class="game-error">${esc(friendlyError(e))}</div>`;
    return;
  }
  round.checked=true;
  const tier=verdict.status;
  pushLevelOutcome(tier==='correct');
  const {diff,bonus}=award(tier);
  if(tier==='correct')playCorrect();else if(tier==='minor')playMinor();else playIncorrect();
  if(tier!=='correct'){
    S.mistakes.push({wrong:input,right:verdict.correction,note:verdict.note||'Traducción',ts:Date.now(),source:'traduccion',phrase:round.phrase});
    renderSide();
  }
  saveS();
  const transDiffHtml=tier!=='correct'?wordDiffHtml(normWords(input),normWords(verdict.correction)):'';
  const tierMsg={correct:'✓ ¡Correcto! +'+diff.pts+' pts',minor:'〜 Casi correcto. +'+diff.minorPts+' pts',incorrect:'✗ Incorrecto. -'+diff.penalty+' pts'}[tier];
  document.getElementById('translResult').innerHTML=`${transDiffHtml?`<div class="game-result-msg">${transDiffHtml}</div>`:''}<div class="game-result-msg tier-${tier}">${tierMsg}${bonus?` · 🔥 ¡Combo x${game.combo}! +${bonus} pts`:''}</div>${verdict.note?`<div style="font-size:11px;color:#5a3000;margin-top:4px;">${esc(verdict.note)}</div>`:''}<button class="game-next" onclick="genTranslation()">Siguiente →</button>`;
}
