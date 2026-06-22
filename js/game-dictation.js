import { S, R, saveS } from './state.js';
import { chars, LEVELS } from './characters.js';
import { callLLM } from './llm.js';
import { esc, friendlyError, normWords } from './helpers.js';
import { awardPoints, pushLevelOutcome } from './progress.js';
import { playCorrect, playMinor, playIncorrect } from './audio.js';
import { renderSide } from './sidepanel.js';
import { round, game, GAME_DIFF, randomTopic, rememberRecent, pickReviewItem, diffSelectorHtml, award, wordDiffHtml, wordMaskHint, recentDictSentences } from './game-core.js';
import lang from './lang.js';

let dictReqId=0;
export async function genDictation(){
  const el=document.getElementById('gamesContent');
  round.sentence='';round.ref='';round.phrase='';round.checked=false;round.review=false;
  el.innerHTML=diffSelectorHtml()+`<div class="mem-loading">${lang.ui.loadingSentence}</div>`;
  const review=Math.random()<0.3?pickReviewItem(m=>m.source==='dictado'):null;
  if(review){round.sentence=review.right;round.review=true;renderDictationRound();return;}
  const topic=randomTopic();
  const avoid=recentDictSentences.length?` Do not repeat or resemble these recent sentences: ${recentDictSentences.map(s=>`"${s}"`).join('; ')}.`:'';
  const reqId=++dictReqId;
  try{
    const txt=await callLLM(
      lang.prompts.dictationSys(chars[R.cur].name,LEVELS[S.level]),
      [{role:'user',content:lang.prompts.dictationUser(chars[R.cur].name,GAME_DIFF[S.gameDifficulty].prompt,topic,avoid)}],
      60,{json:false});
    if(reqId!==dictReqId)return;
    round.sentence=txt.trim();rememberRecent(recentDictSentences,round.sentence);
  }catch(e){
    el.innerHTML=diffSelectorHtml()+`<div class="game-error">${esc(friendlyError(e))}</div><button class="fc-btn" style="width:100%;" onclick="genDictation()">${lang.ui.btnRetry}</button>`;
    return;
  }
  renderDictationRound();
}

export function renderDictationRound(){
  document.getElementById('gamesContent').innerHTML=diffSelectorHtml()+`
    <div class="svc-row" style="text-align:center;">
      ${round.review?`<div class="edim">${lang.ui.reviewBadge}</div>`:''}
      <div class="game-listen-row">
        <button aria-label="${lang.ui.ariaListen}" data-txt="${esc(round.sentence)}" onclick="speakFromBtn(this)">${lang.ui.btnListen}</button>
        <button aria-label="${lang.ui.ariaSlower}" data-txt="${esc(round.sentence)}" data-rate="0.55" onclick="speakFromBtn(this)">${lang.ui.btnSlower}</button>
      </div>
      <input id="dictInput" class="game-input" placeholder="${lang.ui.dictInputPlaceholder}" autocomplete="off">
      <div class="vadd-row">
        <button aria-label="${lang.ui.btnHint}" onclick="hintDictation()">${lang.ui.btnHint}</button>
        <button aria-label="${lang.ui.btnCheck}" onclick="checkDictation()">${lang.ui.btnCheck}</button>
        <button aria-label="${lang.ui.btnSkip}" onclick="skipDictation()">${lang.ui.btnSkip}</button>
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
    S.mistakes.push({wrong:input,right:round.sentence,note:'Dictation',ts:Date.now(),source:'dictado'});
    renderSide();
  }
  saveS();
  const tierMsg={
    correct:lang.ui.scoreCorrect(diff.pts),
    minor:lang.ui.scoreMinor(diff.minorPts),
    incorrect:lang.ui.scoreIncorrect(diff.penalty),
  }[tier];
  document.getElementById('dictResult').innerHTML=`<div class="game-result-msg">${wordDiffHtml(a,b)}</div><div class="game-result-msg tier-${tier}">${tierMsg}${bonus?lang.ui.scoreCombo(game.combo,bonus):''}</div><button class="game-next" onclick="genDictation()">${lang.ui.btnNext}</button>`;
}
