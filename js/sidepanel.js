// ── SIDE PANEL ─────────────────────────────────────────────────────────────
// Vocab / Grammar / Mistakes tabs with week navigation, inline editing,
// manual vocab add, text-selection-to-vocab, and flashcards.
import { S, R, saveS } from './state.js';
import { chars } from './characters.js';
import { openErrExplain } from './error-explain.js';
import { callLLM } from './llm.js';
import { esc, showToast, weekStart } from './helpers.js';
import { checkAchievements } from './progress.js';
import { playVocab } from './audio.js';

// ── Vocab dedup (shared with chat.js via import) ─────────────────────────────
// BUGFIX: case-insensitive throughout — the old addVocabWord was already
// case-insensitive but sendMsg/genStarter matched case-sensitively.
// See also chat.js vocabExists().
export function vocabExists(word){
  return !!S.vocab.find(x=>x.word.toLowerCase()===(word||'').toLowerCase());
}

export function addVocabWord(word,def){
  word=(word||'').trim();def=(def||'').trim();
  if(!word)return false;
  if(vocabExists(word)){showToast('Ya está en tu vocabulario','#9aa8d0','#1e0c04');return false;}
  S.vocab.push({word,def:def||'(sin traducción)',ts:Date.now()});playVocab();renderSide();checkAchievements();saveS();
  return true;
}
async function lookupDefinition(word){
  try{
    const txt=await callLLM('Eres un diccionario español-inglés. Responde SOLO con la traducción al inglés, 1-4 palabras, sin puntuación ni explicación.',[{role:'user',content:word}],20,'low');
    return txt.trim().replace(/^["']|["']$/g,'');
  }catch(e){return '';}
}

// ── Manual add form ───────────────────────────────────────────────────────────
let vAddOpen=false;
export function toggleVAdd(open){
  vAddOpen=open===undefined?!vAddOpen:open;
  renderSide();
  if(vAddOpen)setTimeout(()=>document.getElementById('vAddWord')?.focus(),0);
}
export async function submitVAdd(btn){
  const wEl=document.getElementById('vAddWord');const dEl=document.getElementById('vAddDef');
  const word=wEl.value.trim();let def=dEl.value.trim();
  if(!word)return;
  if(!def){btn.textContent='Traduciendo…';btn.classList.add('loading-btn');btn.disabled=true;def=await lookupDefinition(word);btn.classList.remove('loading-btn');}
  vAddOpen=false;
  addVocabWord(word,def);
}

// ── Select-from-chat → vocab ───────────────────────────────────────────────
let pendingSelection='';
export function hideSelBtn(){const b=document.getElementById('selVocabBtn');if(b)b.style.display='none';pendingSelection='';}
export function handleSelUp(e){
  const btn=document.getElementById('selVocabBtn');
  if(!btn||btn.contains(e.target))return;
  setTimeout(()=>{
    const sel=window.getSelection();
    const text=sel.toString().trim();
    const msgsEl=document.getElementById('msgs');
    if(!text||sel.rangeCount===0||!msgsEl||!msgsEl.contains(sel.anchorNode)){hideSelBtn();return;}
    pendingSelection=text;
    const rect=sel.getRangeAt(0).getBoundingClientRect();
    const parentRect=document.querySelector('.main').getBoundingClientRect();
    btn.style.left=Math.max(4,rect.left-parentRect.left)+'px';
    btn.style.top=Math.max(4,rect.top-parentRect.top-30)+'px';
    btn.style.display='block';
  },10);
}
export async function addSelectionToVocab(){
  const word=pendingSelection;hideSelBtn();
  if(!word)return;
  if(vocabExists(word)){showToast('Ya está en tu vocabulario','#9aa8d0','#1e0c04');window.getSelection().removeAllRanges();return;}
  const def=await lookupDefinition(word);
  addVocabWord(word,def);
  window.getSelection().removeAllRanges();
  showToast(`✨ "${word}" añadida al vocabulario`,'#2a5018','#7acc40');
}

// ── Week navigation ────────────────────────────────────────────────────────────
let viewWeek=weekStart(Date.now());
let sTab='vocab',editingVocab=null,editingMistake=null;

export function setSTab(t){
  sTab=t;editingVocab=null;editingMistake=null;
  ['vocab','grammar','mistakes'].forEach(x=>document.getElementById('stb_'+x).classList.toggle('active',x===t));
  renderSide();
}
function inViewWeek(ts){return weekStart(ts||Date.now())===viewWeek;}
function weeksWithData(){
  const weeks=new Set([weekStart(Date.now())]);
  [...S.vocab,...S.mistakes,...S.grammar].forEach(x=>weeks.add(weekStart(x.ts||Date.now())));
  return Array.from(weeks).sort((a,b)=>a-b);
}
function fmtWeekRange(ws){
  const todayWk=weekStart(Date.now());
  if(ws===todayWk)return 'Esta semana';
  if(ws===todayWk-7*86400000)return 'Semana pasada';
  const fmt=d=>d.toLocaleDateString('es-ES',{day:'numeric',month:'short'});
  return fmt(new Date(ws))+' - '+fmt(new Date(ws+6*86400000));
}
function weekNavHtml(){
  const weeks=weeksWithData();
  const idx=weeks.indexOf(viewWeek);
  const hasPrev=idx>0;const hasNext=idx>=0&&idx<weeks.length-1;
  return `<div class="wknav"><button class="wknav-btn" ${hasPrev?'':'disabled'} onclick="navWeek(-1)" aria-label="Semana anterior">‹</button><span class="wknav-lbl">${fmtWeekRange(viewWeek)}</span><button class="wknav-btn" ${hasNext?'':'disabled'} onclick="navWeek(1)" aria-label="Semana siguiente">›</button></div>`;
}
export function navWeek(dir){
  const weeks=weeksWithData();
  const idx=weeks.indexOf(viewWeek)+dir;
  if(idx<0||idx>=weeks.length)return;
  viewWeek=weeks[idx];editingVocab=null;editingMistake=null;renderSide();
}

// ── Edit / delete ──────────────────────────────────────────────────────────────
export function editVocab(idx){editingVocab=idx;renderSide();}
export function cancelEditVocab(){editingVocab=null;renderSide();}
export function saveEditVocab(idx){
  const w=document.getElementById('evWord').value.trim();
  const d=document.getElementById('evDef').value.trim();
  if(!w)return;
  S.vocab[idx]={...S.vocab[idx],word:w,def:d||'(sin traducción)'};
  editingVocab=null;renderSide();saveS();
}
export function deleteVocab(idx){S.vocab.splice(idx,1);renderSide();saveS();}
export function editMistake(idx){editingMistake=idx;renderSide();}
export function cancelEditMistake(){editingMistake=null;renderSide();}
export function saveEditMistake(idx){
  const wrong=document.getElementById('emWrong').value.trim();
  const right=document.getElementById('emRight').value.trim();
  const note=document.getElementById('emNote').value.trim();
  if(!wrong||!right)return;
  S.mistakes[idx]={...S.mistakes[idx],wrong,right,note};
  editingMistake=null;renderSide();saveS();
}
export function deleteMistake(idx){S.mistakes.splice(idx,1);renderSide();saveS();}

// ── Flashcards ────────────────────────────────────────────────────────────────
let fcCards=[],fcIdx=0,fcFlipped=false,fcLastSpeak=0;
export function openFc(){
  if(!S.vocab.length){showToast('Habla con los personajes para acumular vocabulario','#9aa8d0','#f0e8e0');return;}
  fcCards=[...S.vocab].sort(()=>Math.random()-.5);fcIdx=0;fcFlipped=false;renderFc();
  document.getElementById('fcOv').style.display='flex';
}
export function closeFc(){document.getElementById('fcOv').style.display='none';if(window.speechSynthesis)window.speechSynthesis.cancel();}
function renderFc(){
  if(!fcCards.length){closeFc();return;}
  fcFlipped=false;const card=fcCards[fcIdx];
  const cardEl=document.querySelector('.fc-card');
  if(cardEl)cardEl.classList.remove('flipped');
  document.getElementById('fcProg').textContent=(fcIdx+1)+' / '+fcCards.length;
  document.getElementById('fcWord').textContent=card.word;
  document.getElementById('fcDef').textContent=card.def;
  document.getElementById('fcHint').textContent='Toca para revelar →';
}
export function flipFc(){
  fcFlipped=!fcFlipped;
  const cardEl=document.querySelector('.fc-card');
  if(cardEl)cardEl.classList.toggle('flipped',fcFlipped);
  if(fcFlipped&&window.speechSynthesis){const now=Date.now();if(now-fcLastSpeak<800)return;fcLastSpeak=now;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(fcCards[fcIdx].word);u.lang='es-ES';u.rate=.82;u.onerror=()=>{};window.speechSynthesis.speak(u);}
}
export function navFc(dir){fcIdx=(fcIdx+dir+fcCards.length)%fcCards.length;renderFc();}

// ── Main render ────────────────────────────────────────────────────────────────
export function renderSide(){
  const el=document.getElementById('scon');
  const wk=weekNavHtml();
  if(sTab==='vocab'){
    const actions=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><span class="side-act" onclick="toggleVAdd()">➕ Añadir palabra</span><span class="side-act" onclick="openFc()">🃏 Flashcards →</span></div>`;
    const form=vAddOpen?`<div class="vadd"><input id="vAddWord" placeholder="Palabra en español" autocomplete="off"><input id="vAddDef" placeholder="Significado (vacío = traducir)" autocomplete="off"><div class="vadd-row"><button onclick="submitVAdd(this)">Añadir</button><button onclick="toggleVAdd(false)">Cancelar</button></div></div>`:'';
    const items=S.vocab.filter(v=>inViewWeek(v.ts));
    if(!items.length){el.innerHTML=wk+actions+form+'<div class="edim">Las palabras aparecen mientras hablas…</div>';return;}
    el.innerHTML=wk+actions+form+items.slice().reverse().slice(0,30).map(v=>{
      const idx=S.vocab.indexOf(v);
      if(idx===editingVocab)return `<div class="vi vadd"><input id="evWord" value="${esc(v.word)}" autocomplete="off"><input id="evDef" value="${esc(v.def)}" autocomplete="off"><div class="vadd-row"><button onclick="saveEditVocab(${idx})">Guardar</button><button onclick="cancelEditVocab()">Cancelar</button></div></div>`;
      return `<div class="vi"><div class="vi-row"><div class="vw">${esc(v.word)}</div><div class="vi-acts"><button class="vi-btn" onclick="editVocab(${idx})" aria-label="Editar"><i class="ti ti-pencil"></i></button><button class="vi-btn" onclick="deleteVocab(${idx})" aria-label="Eliminar"><i class="ti ti-trash"></i></button></div></div><div class="vd">${esc(v.def)}</div></div>`;
    }).join('');
  }else if(sTab==='grammar'){
    const items=S.grammar.filter(g=>inViewWeek(g.ts));
    if(!items.length){el.innerHTML=wk+'<div class="edim">Las notas gramaticales aparecen aquí…</div>';return;}
    el.innerHTML=wk+items.slice().reverse().slice(0,40).map(g=>{
      const col=chars[g.ch]?.ac||'#c9a84c';
      return `<div class="gi"><div style="display:flex;gap:6px;align-items:flex-start;"><div style="width:2px;min-height:16px;border-radius:2px;background:${col};flex-shrink:0;margin-top:2px;"></div><div style="font-size:11px;color:var(--lt);line-height:1.5;">${esc(g.text)}</div></div></div>`;
    }).join('');
  }else{
    const items=S.mistakes.filter(m=>inViewWeek(m.ts));
    if(!items.length){el.innerHTML=wk+'<div class="edim">Los errores aparecen aquí…</div>';return;}
    el.innerHTML=wk+items.slice().reverse().slice(0,20).map(m=>{
      const idx=S.mistakes.indexOf(m);
      if(idx===editingMistake)return `<div class="mi vadd"><input id="emWrong" value="${esc(m.wrong)}" placeholder="Incorrecto" autocomplete="off"><input id="emRight" value="${esc(m.right)}" placeholder="Correcto" autocomplete="off"><input id="emNote" value="${esc(m.note||'')}" placeholder="Nota" autocomplete="off"><div class="vadd-row"><button onclick="saveEditMistake(${idx})">Guardar</button><button onclick="cancelEditMistake()">Cancelar</button></div></div>`;
      return `<div class="mi"><div class="mi-row"><div><div class="mw">${esc(m.wrong)}</div><div class="mr">${esc(m.right)}</div><div class="mn">${esc(m.note||'')}</div></div><div class="vi-acts"><button class="vi-btn" onclick="openErrExplain(${idx})" aria-label="Explicar"><i class="ti ti-book-2"></i></button><button class="vi-btn" onclick="editMistake(${idx})" aria-label="Editar"><i class="ti ti-pencil"></i></button><button class="vi-btn" onclick="deleteMistake(${idx})" aria-label="Eliminar"><i class="ti ti-trash"></i></button></div></div></div>`;
    }).join('');
  }
}
