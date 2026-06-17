// ── ORDER GAME ──────────────────────────────────────────────────────────────
// A wizarding news headline is scrambled (words out of order). Drag the word
// chips into the correct order to restore the letter. An owl scrambled it!
import { S, R, saveS } from './state.js';
import { chars } from './characters.js';
import { callLLM } from './llm.js';
import { esc, friendlyError } from './helpers.js';
import { awardPoints, pushLevelOutcome } from './progress.js';
import { renderSide } from './sidepanel.js';
import { playCorrect, playMinor, playIncorrect } from './audio.js';
import { round, game, GAME_DIFF, diffSelectorHtml, award } from './game-core.js';

let sortableScrambled=null, sortableTarget=null;
let orderReqId=0;

function scrambleWords(words){
  let shuffled;
  do{
    shuffled=[...words];
    for(let i=shuffled.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
    }
  }while(shuffled.length>1&&shuffled.every((w,i)=>w===words[i]));
  return shuffled;
}

export async function genOrderGame(){
  const el=document.getElementById('gamesContent');
  round.sentence='';round.checked=false;round.orderWords=[];
  el.innerHTML=diffSelectorHtml()+'<div class="edim">✨ La lechuza está preparando tu carta…</div>';
  const reqId=++orderReqId;
  try{
    const txt=await callLLM(null,[{role:'user',content:`Eres ${chars[R.cur].name}. ${GAME_DIFF[S.gameDifficulty].orderPrompt} Tema: una noticia del mundo mágico relacionada contigo. Genera UNA frase corta en español que sea un titular. Sin signos de puntuación. Solo la frase, sin comillas ni explicaciones.`}],60,'low');
    if(reqId!==orderReqId)return;
    const words=txt.trim().split(/\s+/).map(w=>w.replace(/^[¿¡"'(]+|[.,!?;:"')]+$/g,'')).filter(Boolean);
    if(words.length<3)throw new Error('too short');
    round.orderWords=words;
  }catch(e){
    el.innerHTML=diffSelectorHtml()+`<div style="font-size:12px;color:#d04040;margin-bottom:8px;">${esc(friendlyError(e))}</div><button class="fc-btn" style="width:100%;" onclick="genOrderGame()">Reintentar</button>`;
    return;
  }
  renderOrderRound();
}

export function renderOrderRound(){
  const el=document.getElementById('gamesContent');
  const shuffled=scrambleWords(round.orderWords);
  el.innerHTML=diffSelectorHtml()+`
    <div class="order-letter">
      <span class="owl-stamp">🦉</span>
      <div class="order-desc">La lechuza ha mezclado las palabras de esta noticia. Arrástralas al orden correcto.</div>
      <div class="order-scrambled" id="orderScrambled">
        ${shuffled.map(w=>`<div class="word-chip" data-word="${esc(w)}">${esc(w)}</div>`).join('')}
      </div>
      <div style="font-size:10px;color:#7a5010;margin-bottom:4px;">⬇ Ordena aquí las palabras</div>
      <div class="order-target" id="orderTarget"></div>
    </div>
    <div class="order-actions">
      <button onclick="hintOrder()">💡 Pista (-1)</button>
      <button onclick="checkOrder()">✅ Comprobar</button>
      <button onclick="skipOrder()">⏭ Saltar (-1)</button>
    </div>
    <div id="orderResult"></div>`;
  setTimeout(initSortable,50);
}

function initSortable(){
  if(typeof Sortable==='undefined'){
    document.getElementById('gamesContent').innerHTML='<div class="edim">⚠ No se pudo cargar el componente de arrastrar. Comprueba tu conexión e intenta recargar la página.</div>';
    return;
  }
  destroySortable();
  const scEl=document.getElementById('orderScrambled');
  const tgEl=document.getElementById('orderTarget');
  if(!scEl||!tgEl)return;
  sortableScrambled=new Sortable(scEl,{
    group:{name:'words',pull:true,put:true},
    sort:false,
    animation:150,
    onEnd:function(){document.getElementById('orderResult').innerHTML='';}
  });
  sortableTarget=new Sortable(tgEl,{
    group:{name:'words',pull:true,put:true},
    sort:true,
    animation:150,
    onEnd:function(){document.getElementById('orderResult').innerHTML='';}
  });
}

function destroySortable(){
  if(sortableScrambled){sortableScrambled.destroy();sortableScrambled=null;}
  if(sortableTarget){sortableTarget.destroy();sortableTarget=null;}
}

export function hintOrder(){
  if(round.checked)return;
  const tgEl=document.getElementById('orderTarget');
  const scEl=document.getElementById('orderScrambled');
  if(!tgEl||!scEl)return;
  const placed=[...tgEl.querySelectorAll('.word-chip')].map(el=>el.dataset.word);
  const correct=round.orderWords;
  const nextIdx=placed.length;
  if(nextIdx>=correct.length)return;
  const nextWord=correct[nextIdx];
  const chip=[...scEl.querySelectorAll('.word-chip')].find(el=>el.dataset.word===nextWord);
  if(chip){chip.classList.add('hint-glow');setTimeout(()=>chip.classList.remove('hint-glow'),2000);}
  awardPoints(-1);
  document.getElementById('orderResult').innerHTML=`<div style="font-size:11px;color:#9a6520;">💡 Pista usada. Busca la palabra "${esc(nextWord)}"</div>`;
}

export function checkOrder(){
  if(round.checked)return;
  const tgEl=document.getElementById('orderTarget');
  if(!tgEl)return;
  const userWords=[...tgEl.querySelectorAll('.word-chip')].map(el=>el.dataset.word);
  const correct=round.orderWords;
  if(userWords.length!==correct.length){
    document.getElementById('orderResult').innerHTML=`<div style="font-size:11px;color:#d04040;">Coloca todas las palabras en la zona de orden antes de comprobar.</div>`;
    return;
  }
  round.checked=true;
  const matches=userWords.filter((w,i)=>w===correct[i]).length;
  const ratio=matches/correct.length;
  const tier=ratio===1?'correct':ratio>=0.7?'minor':'incorrect';
  pushLevelOutcome(tier==='correct');
  const {diff,bonus}=award(tier);
  if(tier==='correct')playCorrect();else if(tier==='minor')playMinor();else playIncorrect();
  S.grammar.push({ch:R.cur,text:`Práctica de orden de palabras: "${correct.join(' ')}"`,ts:Date.now()});
  if(tier!=='correct'){
    S.mistakes.push({wrong:userWords.join(' '),right:correct.join(' '),note:`Orden de palabras (${diff.label})`,ts:Date.now(),source:'orden'});
  }
  renderSide();
  saveS();
  destroySortable();
  const restored=correct.join(' ');
  const tierColor={correct:'#5ab030',minor:'#c08020',incorrect:'#d04040'}[tier];
  const tierMsg={correct:'✓ ¡Orden correcto! +'+diff.pts+' pts',minor:'〜 Casi correcto. +'+diff.minorPts+' pts',incorrect:'✗ Orden incorrecto. -'+diff.penalty+' pts'}[tier];
  const userLine=tier!=='correct'?`<div class="incorrect-line">Tu orden: ${userWords.join(' ')}</div>`:'';
  document.getElementById('orderResult').innerHTML=`<div class="order-result"><div class="correct-line">${tierMsg}${bonus?` · 🔥 ¡Combo x${game.combo}! +${bonus} pts`:''}</div><div class="restored-sentence">${esc(restored)}</div>${userLine}</div><button class="fc-btn" style="margin-top:8px;width:100%;" onclick="genOrderGame()">Siguiente →</button>`;
}

export function skipOrder(){destroySortable();game.combo=0;awardPoints(-1);genOrderGame();}
