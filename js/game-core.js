// ── GAME CORE ───────────────────────────────────────────────────────────────
// Shared engine primitives: difficulty config, round/game state, scoring,
// word utilities, topic picker. Leaf module — no imports from game-*.js.
import { S } from './state.js';
import { esc, normWords } from './helpers.js';
import { awardPoints } from './progress.js';
import lang from './lang.js';

export const GAME_DIFF = Object.fromEntries(
  Object.entries(lang.gameDiff).map(([k,v]) => [k, {...v}])
);

export const game={combo:0};
export const round={sentence:'',ref:'',phrase:'',checked:false,review:false,orderWords:[]};
export const recentDictSentences=[];
export const recentTranslPhrases=[];
export const recentOrderSentences=[];

export function randomTopic(){const t=lang.gameTopics;return t[Math.floor(Math.random()*t.length)];}
export function rememberRecent(arr,val){arr.push(val);if(arr.length>8)arr.shift();}
export function pickReviewItem(predicate){
  const pool=S.mistakes.filter(predicate);
  return pool.length?pool[Math.floor(Math.random()*pool.length)]:null;
}

export function diffSelectorHtml(){
  return `<div class="vadd-row" style="margin-bottom:10px;">${Object.keys(GAME_DIFF).map(k=>
    `<button onclick="setGameDifficulty('${k}')"${S.gameDifficulty===k?' class="diff-btn-active"':''}>${GAME_DIFF[k].label}</button>`
  ).join('')}</div>`;
}

export function award(tier){
  const diff=GAME_DIFF[S.gameDifficulty];
  let bonus=0;
  if(tier==='correct'){
    game.combo++;if(game.combo%3===0)bonus=2;
    awardPoints(diff.pts+bonus);
  }else{
    game.combo=0;
    awardPoints(tier==='minor'?diff.minorPts:-diff.penalty);
  }
  return {diff,bonus};
}

export function wordDiffHtml(inputWords,refWords){
  return refWords.map((w,i)=>`<span class="${inputWords[i]===w?'mr':'mw'}">${esc(w)}</span>`).join(' ');
}

export function wordMaskHint(sentence){
  const words=normWords(sentence);
  if(!words.length)return '';
  return words.map((w,i)=>i===0?w:'_'.repeat(w.length)).join(' ');
}
