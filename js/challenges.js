// ── DAILY CHALLENGES ───────────────────────────────────────────────────────
// Generates a batch of 4 character-specific challenges per day (one LLM call).
// Results cached in S.challenges[YYYY-MM-DD]. Completion tracked in
// S.challengeDone['charKey_YYYY-MM-DD'] and the persistent S.challengesCompleted.
import { S, R, saveS } from './state.js';
import { chars, LEVELS } from './characters.js';
import { callLLM } from './llm.js';
import { aResize, extractJSON, showToast } from './helpers.js';
import lang from './lang.js';

export function renderChallengeUI(k){
  const ck=k+'_'+new Date().toISOString().slice(0,10);
  const done=!!S.challengeDone[ck];
  const chal=document.querySelector('.chal');
  if(chal)chal.style.display=done?'none':'';
  const lbl=document.querySelector('.chal-lbl');
  if(lbl)lbl.textContent=done?lang.ui.chalDone:lang.ui.chalTitle;
}

function updateChalTxt(k){
  const today=new Date().toISOString().slice(0,10);
  const c=S.challenges[today]?.[k];
  const chalEl=document.getElementById('chalTxt');
  const focusEl=document.getElementById('chalFocus');
  const opEl=document.getElementById('chalOpener');
  if(c){
    chalEl.classList.remove('mem-loading');
    chalEl.style.fontStyle='';
    chalEl.textContent=c.challenge;
    if(focusEl)focusEl.textContent=c.focus?'📌 '+c.focus:'';
    if(opEl){
      opEl.textContent=c.exampleOpener?'💬 '+c.exampleOpener:'';
      opEl.title=c.exampleOpener?lang.ui.chalOpenerTitle:'' ;
      opEl.style.textDecoration=c.exampleOpener?'underline dotted':'none';
      opEl.onclick=c.exampleOpener?()=>{const ta=document.getElementById('ui');ta.value=c.exampleOpener;aResize(ta);ta.focus();opEl.classList.add('opener-flash');setTimeout(()=>opEl.classList.remove('opener-flash'),400);}:null;
    }
  }else{
    chalEl.classList.add('mem-loading');
    chalEl.style.fontStyle='normal';
    chalEl.textContent=lang.ui.chalLoading;
    if(focusEl)focusEl.textContent='';
    if(opEl){opEl.textContent='';opEl.onclick=null;opEl.style.cursor='';}
  }
}

let challengesLoading=false;

export async function genDailyChallenges(){
  const today=new Date().toISOString().slice(0,10);
  if(S.challenges[today]&&Object.keys(S.challenges[today]).length===4){
    updateChalTxt(R.cur);renderChallengeUI(R.cur);return;
  }
  if(challengesLoading)return;
  challengesLoading=true;
  const chalEl=document.getElementById('chalTxt');
  chalEl.classList.remove('mem-loading');
  chalEl.style.fontStyle='';
  chalEl.innerHTML=`<span class="mem-loading">${lang.ui.chalLoading}</span>`;
  try{
    const raw=await callLLM(lang.prompts.challengeSys,[{role:'user',content:lang.prompts.challengeUser.replace('{{LEVEL}}',LEVELS[S.level]).replace('{{DATE}}',today)}],800,{type:'challenge'});
    const parsed=extractJSON(raw);
    const arr=parsed.challenges||parsed;
    if(Array.isArray(arr)&&arr.length>=4){
      const map={};
      arr.forEach(c=>{if(c.character&&c.challenge&&c.exampleOpener)map[c.character]={challenge:c.challenge,focus:c.focus||'',exampleOpener:c.exampleOpener};});
      if(Object.keys(map).length===4){S.challenges[today]=map;await saveS();}
    }
  }catch(e){
    challengesLoading=false;
    document.getElementById('chalTxt').classList.remove('mem-loading');
    document.getElementById('chalTxt').style.fontStyle='';
    document.getElementById('chalTxt').textContent=lang.ui.chalNA;
    const el=document.getElementById('chalFocus');if(el)el.textContent='';
    const op=document.getElementById('chalOpener');
    if(op){op.textContent=lang.ui.chalRetry;op.style.cursor='pointer';op.onclick=()=>retryChallenges();op.style.textDecoration='underline dotted';}
    const lbl=document.querySelector('.chal-lbl');if(lbl)lbl.textContent=lang.ui.chalTitle;
    return;
  }
  challengesLoading=false;
  updateChalTxt(R.cur);renderChallengeUI(R.cur);
}

function retryChallenges(){genDailyChallenges();}
