// ── ORDER GAME ──────────────────────────────────────────────────────────────
// A wizarding news headline is scrambled (words out of order). Drag the word
// chips into the correct order to restore the letter. An owl scrambled it!
import { S, R, saveS } from './state.js';
import { chars, LEVELS } from './characters.js';
import { callLLM } from './llm.js';
import { esc, friendlyError } from './helpers.js';
import { awardPoints, pushLevelOutcome } from './progress.js';
import { renderSide } from './sidepanel.js';
import { playCorrect, playMinor, playIncorrect } from './audio.js';
import { round, game, GAME_DIFF, diffSelectorHtml, award, recentOrderSentences, rememberRecent, pickReviewItem } from './game-core.js';
import lang from './lang.js';

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
  round.sentence='';round.checked=false;round.orderWords=[];round.review=false;
  el.innerHTML=diffSelectorHtml()+`<div class="mem-loading">${lang.ui.loadingOwl}</div>`;
  const review=Math.random()<0.3?pickReviewItem(m=>m.source===lang.ui.orderSource):null;
  if(review){round.orderWords=review.right.split(/\s+/);round.review=true;renderOrderRound();return;}
  const reqId=++orderReqId;
  const avoid=recentOrderSentences.length?` Do not repeat or resemble these recent headlines: ${recentOrderSentences.map(s=>`"${s}"`).join('; ')}.`:'';
  try{
    const txt=await callLLM(
      lang.prompts.orderSys,
      [{role:'user',content:lang.prompts.orderUser(chars[R.cur].name,GAME_DIFF[S.gameDifficulty].orderPrompt,avoid)}],
      60,{json:false});
    if(reqId!==orderReqId)return;
    const words=txt.trim().split(/\s+/).map(w=>w.replace(/^[¿¡"'(]+|[.,!?;:"')]+$/g,'')).filter(Boolean);
    if(words.length<3)throw new Error('too short');
    round.orderWords=words;
    rememberRecent(recentOrderSentences,txt.trim());
  }catch(e){
    el.innerHTML=diffSelectorHtml()+`<div class="game-error">${esc(friendlyError(e))}</div><button class="fc-btn" style="width:100%;" onclick="genOrderGame()">${lang.ui.btnRetry}</button>`;
    return;
  }
  renderOrderRound();
}

export function renderOrderRound(){
  const el=document.getElementById('gamesContent');
  const shuffled=scrambleWords(round.orderWords);
  el.innerHTML=diffSelectorHtml()+`
    <div class="order-letter">
      ${round.review?`<div class="edim" style="margin-bottom:6px;">${lang.ui.reviewBadge}</div>`:''}
      <span class="owl-stamp">🦉</span>
      <div class="order-desc">${lang.ui.orderLoadingMsg}</div>
      <div class="order-scrambled" id="orderScrambled">
        ${shuffled.map(w=>`<div class="word-chip" data-word="${esc(w)}">${esc(w)}</div>`).join('')}
      </div>
      <div class="game-order-label">${lang.ui.orderAreaLabel}</div>
      <div class="order-target" id="orderTarget"></div>
    </div>
    <div class="order-actions">
      <button aria-label="${lang.ui.btnHint}" onclick="hintOrder()">${lang.ui.btnHint} (-1)</button>
      <button aria-label="${lang.ui.btnCheck}" onclick="checkOrder()">${lang.ui.btnCheck}</button>
      <button aria-label="${lang.ui.btnSkip}" onclick="skipOrder()">${lang.ui.btnSkip}</button>
    </div>
    <div id="orderResult"></div>`;
  setTimeout(initSortable,50);
}

function initSortable(){
  if(typeof Sortable==='undefined'){
    document.getElementById('gamesContent').innerHTML=`<div class="edim">⚠ ${lang.ui.orderLoadError}</div>`;
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
  if(!chip)return;
  if(chip){chip.classList.add('hint-glow');setTimeout(()=>chip.classList.remove('hint-glow'),2000);}
  awardPoints(-1);saveS();
  document.getElementById('orderResult').innerHTML=`<div class="game-hint-msg">${lang.ui.orderHintMsg(esc(nextWord))}</div>`;
}

export function checkOrder(){
  if(round.checked)return;
  const tgEl=document.getElementById('orderTarget');
  if(!tgEl)return;
  const userWords=[...tgEl.querySelectorAll('.word-chip')].map(el=>el.dataset.word);
  const correct=round.orderWords;
  if(userWords.length!==correct.length){
    document.getElementById('orderResult').innerHTML=`<div class="game-error">${lang.ui.orderPlaceFirst}</div>`;
    return;
  }
  round.checked=true;
  const matches=userWords.filter((w,i)=>w===correct[i]).length;
  const ratio=matches/correct.length;
  const tier=ratio===1?'correct':ratio>=0.7?'minor':'incorrect';
  pushLevelOutcome(tier==='correct');
  const {diff,bonus}=award(tier);
  if(tier==='correct')playCorrect();else if(tier==='minor')playMinor();else playIncorrect();
  S.grammar.push({ch:R.cur,text:`${lang.ui.orderPracticeNote(diff.label)}: "${correct.join(' ')}"`,ts:Date.now()});
  if(tier!=='correct'){
    S.mistakes.push({wrong:userWords.join(' '),right:correct.join(' '),note:lang.ui.orderPracticeNote(diff.label),ts:Date.now(),source:lang.ui.orderSource});
  }
  renderSide();
  saveS();
  destroySortable();
  const restored=correct.join(' ');
  const tierMsg={
    correct:lang.ui.scoreCorrectOrder(diff.pts),
    minor:lang.ui.scoreMinorOrder(diff.minorPts),
    incorrect:lang.ui.scoreIncorrectOrder(diff.penalty),
  }[tier];
  const userLine=tier!=='correct'?`<div class="incorrect-line">${lang.ui.youLabel}: ${userWords.join(' ')}</div>`:'';
  document.getElementById('orderResult').innerHTML=`<div class="order-result"><div class="tier-${tier}">${tierMsg}${bonus?lang.ui.scoreCombo(game.combo,bonus):''}</div><div class="restored-sentence">${esc(restored)}</div>${userLine}</div><button class="game-next" onclick="genOrderGame()">${lang.ui.btnNext}</button>`;
}

export function skipOrder(){destroySortable();game.combo=0;awardPoints(-1);saveS();genOrderGame();}
