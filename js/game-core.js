// ── GAME CORE ───────────────────────────────────────────────────────────────
// Shared engine primitives: difficulty config, round/game state, scoring,
// word utilities, topic picker. Leaf module — no imports from game-*.js.
import { S } from './state.js';
import { esc, normWords } from './helpers.js';
import { awardPoints } from './progress.js';

export const GAME_DIFF={
  easy:{label:'Fácil',pts:4,penalty:2,minorPts:2,prompt:'Usa SOLO una frase muy básica y corta (máximo 5 palabras), vocabulario elemental (saludos, colores, familia, números, animales comunes). Presente simple únicamente.',orderPrompt:'Usa SOLO una frase muy básica y corta (4-6 palabras) sobre un evento simple. Vocabulario elemental. Presente simple.'},
  medium:{label:'Medio',pts:8,penalty:4,minorPts:4,prompt:'Usa una frase corta (5-8 palabras), vocabulario básico-intermedio, presente e indefinido.',orderPrompt:'Usa una frase de 6-9 palabras, vocabulario básico-intermedio sobre un evento, presente o indefinido.'},
  hard:{label:'Difícil',pts:12,penalty:6,minorPts:6,prompt:'Usa una frase de 8-12 palabras, vocabulario variado, puede incluir subjuntivo o condicional.',orderPrompt:'Usa una frase de 9-12 palabras, vocabulario variado sobre un evento, puede incluir subjuntivo o condicional.'}
};

const GAME_TOPICS=['animales mágicos','comida y bebida','el clima','la familia','un viaje','un hechizo o poción','la escuela en Hogwarts','un objeto mágico','un amigo','el tiempo libre','un libro','un sueño','una fiesta','el bosque prohibido','un castillo','una mascota','el deporte','la ropa','un cumpleaños','las vacaciones'];

export const game={combo:0};
export const round={sentence:'',ref:'',phrase:'',checked:false,review:false,orderWords:[]};
export const recentDictSentences=[];
export const recentTranslPhrases=[];
export const recentOrderSentences=[];

export function randomTopic(){return GAME_TOPICS[Math.floor(Math.random()*GAME_TOPICS.length)];}
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
