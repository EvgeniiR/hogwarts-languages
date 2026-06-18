// ── CHAT ───────────────────────────────────────────────────────────────────
// sendMsg, conversation starters, message rendering, character selection,
// mood updates, owl animation, hints, typing indicator.
import { S, R, saveS } from './state.js';
import { chars, getSys, LEVELS } from './characters.js';
import { SVG } from './portraits.js';
import { callLLM } from './llm.js';
import { repairJSON } from './llm.js';
import { awardPoints, updPtsUI, updStreakUI, checkAchievements, checkLevelUp, pushLevelOutcome } from './progress.js';
import { playRecv, playSend, playVocab, playSpell } from './audio.js';
import { speak } from './tts.js';
import { esc, mdInline, showToast, friendlyError, extractJSON } from './helpers.js';
import { renderChallengeUI, genDailyChallenges } from './challenges.js';
import { renderSide, vocabExists } from './sidepanel.js';

const MOOD_LABELS=['Enfadado/a','De mal humor','Neutral','Contento/a','Encantado/a'];
export function updMood(k,v){
  v=Math.max(0,Math.min(4,v));S.moods[k]=v;
  const dot=document.getElementById('m_'+k);
  if(dot){
    dot.style.background=['#d04040','#c08020','#c9a84c','#4aa020','#20d060'][v];
    dot.title=MOOD_LABELS[v];
    dot.setAttribute('aria-label',MOOD_LABELS[v]);
    dot.classList.remove('mood-pulse');
    void dot.offsetWidth;
    dot.classList.add('mood-pulse');
  }
}

export function updHeaderAll(){
  updPtsUI();updStreakUI();
  document.getElementById('lvlBadge').textContent=LEVELS[S.level];
  Object.keys(S.moods).forEach(k=>updMood(k,S.moods[k]));
  updProviderBadge();
}

export function updProviderBadge(){
  const badge=document.getElementById('pvdBadge');
  if(!badge)return;
  const names={groq:'Groq',openai:'OpenAI',anthropic:'Anthropic',gemini:'Gemini'};
  badge.textContent=names[R.provider]||R.provider;
  badge.dataset.pvd=R.provider;
}

export function flyOwl(){
  const w=document.getElementById('owlW');const o=document.createElement('div');
  o.className='owl';o.textContent='🦉';o.style.top=(12+Math.random()*18)+'%';
  w.appendChild(o);setTimeout(()=>o.remove(),2400);
}

// ── Typing indicator ─────────────────────────────────────────────────────────
export function showTyping(){
  const ch=chars[R.cur];const c=document.getElementById('msgs');
  const d=document.createElement('div');d.className='msg a';d.id='typi';
  d.innerHTML=`<div class="mav" style="border-color:${ch.ac};">${SVG[R.cur]}</div><div class="bbl"><div class="typing-bb"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;
  c.appendChild(d);c.scrollTop=c.scrollHeight;
}
export function rmTyping(){const t=document.getElementById('typi');if(t)t.remove();}

// ── Message render ────────────────────────────────────────────────────────────
function createMsgEl(m,i,charKey){
  const div=document.createElement('div');
  if(m.role==='user'){
    div.className='msg u';
    div.innerHTML=`<div class="mav" style="background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--mt);">Tú</div><div class="bbl">${esc(m.content)}</div>`;
  }else{
    const ch=chars[charKey];div.className='msg a';
    const note=m.note?`<span class="note">${esc(m.note)}</span>`:'';
    const safe=(m.display||'').replace(/"/g,'&quot;');
    const retry=m.error?`<div style="margin-top:6px;"><button class="retry-btn" onclick="retryLastMsg()">Reintentar →</button></div>`:'';
    div.innerHTML=`<div class="mav" style="border-color:${ch.ac};">${SVG[charKey]}</div><div class="bbl" id="b${i}">${mdInline(esc(m.display))}<button class="spk-btn" data-txt="${safe}" onclick="speakFromBtn(this)" aria-label="Escuchar"><i class="ti ti-volume" aria-hidden="true"></i></button>${note}${retry}</div>`;
    if(m.hasSpell){
      m.hasSpell=false;
      setTimeout(()=>{const b=document.getElementById('b'+i);if(b){b.classList.add('spell-flash');playSpell();}},120);
    }
  }
  return div;
}

export function appendMsg(m){
  const c=document.getElementById('msgs');
  const empty=c.querySelector('.empty-ch');
  if(empty)c.innerHTML='';
  const i=S.hist[R.cur].length-1;
  c.appendChild(createMsgEl(m,i,R.cur));
  c.scrollTop=c.scrollHeight;
}

export function renderMsgs(){
  const msgs=S.hist[R.cur];const c=document.getElementById('msgs');
  if(!msgs.length){
    const ch=chars[R.cur];
    c.innerHTML=`<div class="empty-ch"><div style="width:60px;height:60px;border-radius:50%;overflow:hidden;border:2px solid var(--dim);">${SVG[R.cur]}</div><div style="color:var(--gold);font-style:italic;">${ch.name}</div><div>Di "Hola" para empezar</div></div>`;
    return;
  }
  c.innerHTML='';
  msgs.forEach((m,i)=>c.appendChild(createMsgEl(m,i,R.cur)));
  c.scrollTop=c.scrollHeight;
}

// ── Hints ─────────────────────────────────────────────────────────────────────
export function showHints(){renderHints(chars[R.cur].hints);}
export function retryLastMsg(){
  const hist=S.hist[R.cur];
  if(!hist.length||!hist.at(-1).error)return;
  hist.pop();
  const userMsg=hist.at(-1);
  if(!userMsg||userMsg.role!=='user')return;
  const ta=document.getElementById('ui');
  ta.value=userMsg.content;aResize(ta);
  renderMsgs();
  sendMsg();
}
export function renderHints(hints){
  const el=document.getElementById('hintsR');
  el.innerHTML=hints.length?hints.map(h=>`<span class="hchip" onclick="useHint(this)">${esc(h)}</span>`).join(''):'<span class="hints-empty">Las sugerencias aparecerán aquí…</span>';
}
export function useHint(el){
  const ta=document.getElementById('ui');ta.value=el.textContent;
  const {aResize}=window;if(aResize)aResize(ta);
  renderHints([]);ta.focus();
}

// Sanitize LLM reply suggestions → array of ≤3 trimmed non-empty strings (≤80 chars).
function sanitizeOptions(o){
  if(!Array.isArray(o))return [];
  return o.filter(s=>typeof s==='string'&&s.trim()).map(s=>s.trim().slice(0,80)).slice(0,3);
}

async function safeParse(raw){
  try{return extractJSON(raw);}
  catch(e){
    // Step 1: quote bare keys at line-start (note: → "note":)
    let repaired = raw.replace(/(^|[\n\r])\s*([a-zA-Z_]\w*)\s*:/gm, '$1"$2":');
    try{return extractJSON(repaired);}catch(e2){}
    // Step 2: if no braces, find the key:value block and wrap it
    if (!repaired.includes('{')) {
      const knownKeys = ['"reply"','"note"','"vocab"','"mistakes"','"spells"','"options"','"points"','"mood"','"challengeDone"'];
      let firstAt = Infinity;
      for (const k of knownKeys) {
        const rx = new RegExp('(?:^|\\n)\\s*' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':', 'm');
        const m = repaired.match(rx);
        if (m && m.index < firstAt) firstAt = m.index + (repaired[m.index] === '\n' ? 1 : 0);
      }
      if (firstAt < Infinity) {
        const textPart = repaired.slice(0, firstAt).trimEnd();
        let jsonPart = repaired.slice(firstAt);
        jsonPart = jsonPart.replace(/([}\]"\d])\s*\n\s*"/g, '$1,\n"');
        repaired = (textPart ? textPart + '\n' : '') + '{' + jsonPart + '}';
      }
    }
    try{return extractJSON(repaired);}catch(e3){}
    // Step 3: LLM-powered repair for any remaining malformation
    try{
      const fixed = await repairJSON(raw);
      if(fixed)return extractJSON(fixed);
    }catch(e4){}
    return{reply:raw.replace(/\{.*\}/s,'').trim()||raw,note:'',vocab:[],mistakes:[],spells:[],points:0,mood:2,options:[]};
  }
}

// ── Character selection ───────────────────────────────────────────────────────
export function selChar(tab){
  document.querySelectorAll('.ctab').forEach(t=>{t.classList.remove('active');t.style.borderBottomColor='transparent';});
  tab.classList.add('active');R.cur=tab.dataset.ch;
  const ch=chars[R.cur];tab.style.borderBottomColor=ch.ac;
  const b=document.getElementById('hbadge');b.textContent=ch.house;b.style.background=ch.bbg;b.style.color=ch.btxt;b.style.borderColor=ch.bbd;
  document.getElementById('mainApp').style.setProperty('--char-ac',ch.ac);
  renderMsgs();renderHints(S.currentHints[R.cur]&&S.currentHints[R.cur].length?S.currentHints[R.cur]:chars[R.cur].hints);renderSide();
  document.getElementById('sendB').disabled=false;document.getElementById('ui').focus();
  genDailyChallenges();
}
export function selCharByName(n){const t=document.querySelector(`[data-ch="${n}"]`);if(t)selChar(t);}

// ── Conversation starters ────────────────────────────────────────────────────
const starterLoading=new Set();
const STARTER_SEEDS={
  hermione:['un examen sorpresa de Pociones','un hechizo que salió mal en la biblioteca','una duda sobre un tema de Transformaciones','un problema con el giratiempo','un descubrimiento en la Sala de los Menesteres'],
  dumbledore:['un recuerdo en el Pensadero','una profecía por descifrar','una decisión difícil sobre un alumno','el significado de un objeto misterioso','una lección sobre el amor y la magia'],
  hagrid:['una criatura herida en el bosque','un huevo de dragón a punto de eclosionar','un nuevo animal llegado a la cabaña','algo peligroso suelto en los terrenos','una visita a la casa de Aragog'],
  snape:['un ingrediente de pociones muy raro','un castigo que cumplir en el calabozo','una queja sobre un alumno problemático','una receta de pociones secreta','una inspección en la mazmorra']
};
const STARTER_FRAMING={
  hermione:'Empieza con una pregunta académica o una observación erudita sobre:',
  dumbledore:'Empieza con una reflexión sabia o una metáfora sobre:',
  hagrid:'Empieza con una exclamación entusiasta sobre:',
  snape:'Empieza con una queja sarcástica o una observación cortante sobre:'
};
export async function genStarter(k){
  if(starterLoading.has(k)||S.hist[k].length>0)return;
  starterLoading.add(k);
  if(k===R.cur){document.getElementById('msgs').innerHTML='';showTyping();}
  try{
    const seeds=STARTER_SEEDS[k]||STARTER_SEEDS.hermione;
    const seed=seeds[Math.floor(Math.random()*seeds.length)];
    const framing=STARTER_FRAMING[k]||STARTER_FRAMING.hermione;
    const raw=await callLLM(getSys(k),[{role:'user',content:`${framing} ${seed}.`}],400,'low');
    if(S.hist[k].length===0){
      const p=await safeParse(raw);
      const hasSpell=p.spells&&p.spells.length>0;
      S.hist[k].push({role:'assistant',content:p.reply,display:p.reply,note:p.note,hasSpell});
      if(p.vocab&&p.vocab.length)p.vocab.forEach(v=>{if(!vocabExists(v.word))S.vocab.push({...v,ts:Date.now()});});
      if(p.note)S.grammar.push({ch:k,text:p.note,ts:Date.now()});
      if(typeof p.mood==='number')updMood(k,p.mood);
      S.currentHints[k]=sanitizeOptions(p.options);
      saveS();
      if(k===R.cur){rmTyping();appendMsg(S.hist[k].at(-1));renderSide();renderHints(S.currentHints[k]);}
    }else{if(k===R.cur)rmTyping();}
  }catch(e){
    if(k===R.cur){rmTyping();showToast(friendlyError(e),'#5a0000','#f5e5c0');}
  }
  starterLoading.delete(k);
}

// ── Send message ──────────────────────────────────────────────────────────────
export async function sendMsg(){
  if(R.loading)return;
  const ta=document.getElementById('ui');const txt=ta.value.trim();if(!txt)return;
  S.hist[R.cur].push({role:'user',content:txt});ta.value='';ta.style.height='auto';
  document.getElementById('sendB').disabled=true;R.loading=true;appendMsg(S.hist[R.cur].at(-1));showTyping();playSend();
  const effort='medium';
  let suggestions=[];
  try{
    let hist=S.hist[R.cur].filter(m=>!m.error);
    let msgs=hist.slice(-25).map(m=>({role:m.role,content:m.content}));
    msgs=msgs.filter((m,i)=>i===msgs.length-1||m.role!==msgs[i+1].role);
    const firstUser=msgs.findIndex(m=>m.role==='user');if(firstUser>0)msgs=msgs.slice(firstUser);
    const raw=await callLLM(getSys(R.cur),msgs,1000,effort);
    const p=await safeParse(raw);suggestions=sanitizeOptions(p.options);
    const hasSpell=p.spells&&p.spells.length>0;
    S.hist[R.cur].push({role:'assistant',content:p.reply,display:p.reply,note:p.note,hasSpell});
    S.totalMsgs++;
    flyOwl();
    const today=new Date().toISOString().slice(0,10);
    const ck=R.cur+'_'+today;
    if(p.challengeDone&&!S.challengeDone[ck]){
      S.challengeDone[ck]=true;
      S.challengesCompleted=(S.challengesCompleted||0)+1;
      awardPoints(10);renderChallengeUI(R.cur);
      showToast('🎉 ¡Desafío completado! +10 pts','#2a5018','#7acc40');
    }
    let changed=false;
    if(p.vocab&&p.vocab.length){p.vocab.forEach(v=>{if(!vocabExists(v.word)){S.vocab.push({...v,ts:Date.now()});playVocab();changed=true;}});}
    if(p.mistakes&&p.mistakes.length){p.mistakes.forEach(m=>S.mistakes.push({...m,ts:Date.now()}));changed=true;}
    pushLevelOutcome(!(p.mistakes&&p.mistakes.length));
    if(p.note){S.grammar.push({ch:R.cur,text:p.note,ts:Date.now()});changed=true;}
    if(p.points)awardPoints(p.points);
    if(typeof p.mood==='number')updMood(R.cur,p.mood);
    if(checkLevelUp())saveS();
    if(changed)renderSide();
    checkAchievements();
    playRecv();if(!S.ttsOff)setTimeout(()=>speak(p.reply),350);
    S.currentHints[R.cur]=suggestions;saveS();
  }catch(e){const msg=friendlyError(e);S.hist[R.cur].push({role:'assistant',content:msg,display:msg,note:'',hasSpell:false,error:true});}
  rmTyping();R.loading=false;document.getElementById('sendB').disabled=false;appendMsg(S.hist[R.cur].at(-1));renderHints(suggestions);document.getElementById('ui').focus();
}

