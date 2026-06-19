import { S, R, saveS } from './state.js';
import { chars, LEVELS } from './characters.js';
import { callLLM } from './llm.js';
import { esc, friendlyError, normWords } from './helpers.js';
import { awardPoints, pushLevelOutcome } from './progress.js';
import { playCorrect, playMinor, playIncorrect } from './audio.js';
import { renderSide } from './sidepanel.js';
import { round, game, GAME_DIFF, randomTopic, rememberRecent, pickReviewItem, diffSelectorHtml, award, wordDiffHtml, wordMaskHint, recentDictSentences } from './game-core.js';

let dictReqId=0;
export async function genDictation(){
  const el=document.getElementById('gamesContent');
  round.sentence='';round.ref='';round.phrase='';round.checked=false;round.review=false;
  el.innerHTML=diffSelectorHtml()+'<div class="mem-loading">Generando oración</div>';
  const review=Math.random()<0.3?pickReviewItem(m=>m.source==='dictado'):null;
  if(review){round.sentence=review.right;round.review=true;renderDictationRound();return;}
  const topic=randomTopic();
  const avoid=recentDictSentences.length?` No repitas ni te parezcas a estas oraciones recientes: ${recentDictSentences.map(s=>`"${s}"`).join('; ')}.`:'';
  const reqId=++dictReqId;
  try{
    const txt=await callLLM(`Eres un profesor de español generando ejercicios de dictado para un estudiante de nivel ${LEVELS[S.level]}.`,[{role:'user',content:`Eres ${chars[R.cur].name}. ${GAME_DIFF[S.gameDifficulty].prompt} Tema: ${topic}. Genera UNA oración en español sobre ese tema que dirías tú, para un ejercicio de dictado.${avoid} Refleja tu personalidad. Solo la oración, sin comillas ni explicaciones.`}],60);
    if(reqId!==dictReqId)return;
    round.sentence=txt.trim();rememberRecent(recentDictSentences,round.sentence);
  }catch(e){
    el.innerHTML=diffSelectorHtml()+`<div class="game-error">${esc(friendlyError(e))}</div><button class="fc-btn" style="width:100%;" onclick="genDictation()">Reintentar</button>`;
    return;
  }
  renderDictationRound();
}

export function renderDictationRound(){
  document.getElementById('gamesContent').innerHTML=diffSelectorHtml()+`
    <div class="svc-row" style="text-align:center;">
      ${round.review?'<div class="edim">🔁 Repaso de un error anterior</div>':''}
      <div class="game-listen-row">
        <button aria-label="Escuchar la oración" data-txt="${esc(round.sentence)}" onclick="speakFromBtn(this)">🔊 Escuchar</button>
        <button aria-label="Escuchar más despacio" data-txt="${esc(round.sentence)}" data-rate="0.55" onclick="speakFromBtn(this)">🐢 Más despacio</button>
      </div>
      <input id="dictInput" class="game-input" placeholder="Escribe lo que escuchaste…" autocomplete="off">
      <div class="vadd-row">
        <button aria-label="Pista" onclick="hintDictation()">💡 Pista</button>
        <button aria-label="Comprobar respuesta" onclick="checkDictation()">✅ Comprobar</button>
        <button aria-label="Saltar, -1 punto" onclick="skipDictation()">⏭ Saltar (-1)</button>
      </div>
    </div>
    <div id="dictResult"></div>`;
}

export function hintDictation(){document.getElementById('dictResult').innerHTML=`<div class="edim">💡 ${wordMaskHint(round.sentence)}</div>`;}

export function skipDictation(){game.combo=0;awardPoints(-1);saveS();genDictation();}

export function checkDictation(){
  if(round.checked)return;
  const input=document.getElementById('dictInput').value;
  const a=normWords(input),b=normWords(round.sentence);
  const matches=b.filter((w,i)=>a[i]===w).length;
  const ratio=matches/Math.max(a.length,b.length,1);
  const tier=ratio===1&&a.length===b.length?'correct':ratio>=0.7?'minor':'incorrect';
  round.checked=true;
  pushLevelOutcome(tier==='correct');
  const {diff,bonus}=award(tier);
  if(tier==='correct')playCorrect();else if(tier==='minor')playMinor();else playIncorrect();
  if(tier!=='correct'){
    S.mistakes.push({wrong:input,right:round.sentence,note:'Dictado',ts:Date.now(),source:'dictado'});
    renderSide();
  }
  saveS();
  const tierMsg={correct:'✓ ¡Correcto! +'+diff.pts+' pts',minor:'〜 Casi correcto. +'+diff.minorPts+' pts',incorrect:'✗ Incorrecto. -'+diff.penalty+' pts'}[tier];
  document.getElementById('dictResult').innerHTML=`<div class="game-result-msg">${wordDiffHtml(a,b)}</div><div class="game-result-msg tier-${tier}">${tierMsg}${bonus?` · 🔥 ¡Combo x${game.combo}! +${bonus} pts`:''}</div><button class="game-next" onclick="genDictation()">Siguiente →</button>`;
}
