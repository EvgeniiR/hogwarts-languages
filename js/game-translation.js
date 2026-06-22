import { S, R, saveS } from './state.js';
import { chars, LEVELS } from './characters.js';
import { callLLM } from './llm.js';
import { esc, friendlyError, normWords, extractJSON } from './helpers.js';
import { awardPoints, pushLevelOutcome } from './progress.js';
import { renderSide } from './sidepanel.js';
import { playCorrect, playMinor, playIncorrect } from './audio.js';
import { round, game, GAME_DIFF, randomTopic, rememberRecent, pickReviewItem, diffSelectorHtml, award, wordDiffHtml, wordMaskHint, recentTranslPhrases } from './game-core.js';
import lang from './lang.js';

let translReqId=0;
export async function genTranslation(){
  const el=document.getElementById('gamesContent');
  round.sentence='';round.ref='';round.phrase='';round.checked=false;round.review=false;
  el.innerHTML=diffSelectorHtml()+`<div class="mem-loading">${lang.ui.loadingPhrase}</div>`;
  const review=Math.random()<0.3?pickReviewItem(m=>m.source===lang.ui.translateSource&&m.phrase):null;
  if(review){round.phrase=review.phrase;round.ref=review.right;round.review=true;renderTranslationRound();return;}
  const topic=randomTopic();
  const avoid=recentTranslPhrases.length?` Do not repeat or resemble these recent phrases: ${recentTranslPhrases.map(s=>`"${s}"`).join('; ')}.`:'';
  const reqId=++translReqId;
  try{
    const raw=await callLLM(
      lang.prompts.translationSys(chars[R.cur].name,LEVELS[S.level]),
      [{role:'user',content:lang.prompts.translationUser(GAME_DIFF[S.gameDifficulty].prompt,topic,avoid)}],
      150,{type:'trans-gen'});
    if(reqId!==translReqId)return;
    const parsed=extractJSON(raw);
    round.phrase=parsed.phrase;round.ref=parsed.refTranslation||'';
    rememberRecent(recentTranslPhrases,round.phrase);
  }catch(e){
    el.innerHTML=diffSelectorHtml()+`<div class="game-error">${esc(friendlyError(e))}</div><button class="fc-btn" style="width:100%;" onclick="genTranslation()">${lang.ui.btnRetry}</button>`;
    return;
  }
  renderTranslationRound();
}

export function renderTranslationRound(){
  document.getElementById('gamesContent').innerHTML=diffSelectorHtml()+`
    <div class="svc-row" style="text-align:center;">
      ${round.review?`<div class="edim">${lang.ui.reviewBadge}</div>`:''}
      <div class="svc-lbl" style="text-align:center;">${lang.ui.translateLabel}</div>
      <div class="game-phrase" style="text-align:center;">"${esc(round.phrase)}"</div>
      <input id="translInput" class="game-input" placeholder="${lang.ui.translatePlaceholder}" autocomplete="off">
      <div class="vadd-row">
        <button aria-label="${lang.ui.btnHint}" onclick="hintTranslation()">${lang.ui.btnHint}</button>
        <button aria-label="${lang.ui.btnCheck}" onclick="checkTranslation(this)">${lang.ui.btnCheck}</button>
        <button aria-label="${lang.ui.btnSkip}" onclick="skipTranslation()">${lang.ui.btnSkip}</button>
      </div>
    </div>
    <div id="translResult"></div>`;
}

export function hintTranslation(){
  const hint=wordMaskHint(round.ref);
  document.getElementById('translResult').innerHTML=hint?`<div class="edim">💡 ${hint}</div>`:`<div class="edim">${lang.ui.translateHintNone}</div>`;
}

export function skipTranslation(){game.combo=0;awardPoints(-1);saveS();genTranslation();}

export async function checkTranslation(btn){
  if(round.checked)return;
  const input=document.getElementById('translInput').value.trim();
  if(!input)return;
  document.querySelectorAll('#gamesContent .vadd-row button').forEach(b=>{b.disabled=true;});
  btn.classList.add('loading-btn');
  btn.textContent=lang.ui.translateChecking;
  let verdict;
  try{
    const raw=await callLLM(
      lang.prompts.translationEvalSys,
      [{role:'user',content:lang.prompts.translationEvalUser(round.phrase,input)}],
      150,{temperature:0.2,type:'trans-check'});
    verdict={status:'incorrect',correction:round.ref||round.phrase,note:'',...extractJSON(raw)};
  }catch(e){
    document.querySelectorAll('#gamesContent .vadd-row button').forEach(b=>{b.disabled=false;});
    btn.classList.remove('loading-btn');
    btn.textContent=lang.ui.btnCheck;
    document.getElementById('translResult').innerHTML=`<div class="game-error">${esc(friendlyError(e))}</div>`;
    return;
  }
  round.checked=true;
  const tier=verdict.status;
  pushLevelOutcome(tier==='correct');
  const {diff,bonus}=award(tier);
  if(tier==='correct')playCorrect();else if(tier==='minor')playMinor();else playIncorrect();
  if(tier!=='correct'){
    S.mistakes.push({wrong:input,right:verdict.correction,note:verdict.note||lang.ui.translateNote,ts:Date.now(),source:lang.ui.translateSource,phrase:round.phrase});
    renderSide();
  }
  saveS();
  const transDiffHtml=tier!=='correct'?wordDiffHtml(normWords(input),normWords(verdict.correction)):'';
  const tierMsg={
    correct:lang.ui.scoreCorrect(diff.pts),
    minor:lang.ui.scoreMinor(diff.minorPts),
    incorrect:lang.ui.scoreIncorrect(diff.penalty),
  }[tier];
  document.getElementById('translResult').innerHTML=`${transDiffHtml?`<div class="game-result-msg">${transDiffHtml}</div>`:''}<div class="game-result-msg tier-${tier}">${tierMsg}${bonus?lang.ui.scoreCombo(game.combo,bonus):''}</div>${verdict.note?`<div style="font-size:11px;color:#5a3000;margin-top:4px;">${esc(verdict.note)}</div>`:''}<button class="game-next" onclick="genTranslation()">${lang.ui.btnNext}</button>`;
}
