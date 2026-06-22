// ── CHAT ───────────────────────────────────────────────────────────────────
// sendMsg, conversation starters, message rendering, character selection,
// mood updates, hints, typing indicator.
import { S, R, saveS, HIST_CAP } from './state.js';
import { chars, getSys, LEVELS, OPTIONS_PROMPT, ANALYSIS_PROMPT, SUMMARY_PROMPT } from './characters.js';
import { SVG } from './portraits.js';
import { callLLM } from './llm.js';
import { repairJSON } from './llm.js';
import { awardPoints, updPtsUI, updStreakUI, checkAchievements, checkLevelUp, pushLevelOutcome } from './progress.js';
import { playRecv, playSend, playVocab } from './audio.js';
import { speak } from './tts.js';
import { esc, mdInline, showToast, friendlyError, extractJSON, aResize } from './helpers.js';
import { renderChallengeUI, genDailyChallenges } from './challenges.js';
import { renderSide, vocabExists } from './sidepanel.js';
import lang from './lang.js';

export function updMood(k,v){
  v=Math.max(0,Math.min(4,v));S.moods[k]=v;
  const dot=document.getElementById('m_'+k);
  if(dot){
    dot.style.background=['#d04040','#c08020','#c9a84c','#4aa020','#20d060'][v];
    dot.title=lang.moodLabels[v];
    dot.setAttribute('aria-label',lang.moodLabels[v]);
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
  const names={groq:'Groq',openai:'OpenAI',deepseek:'DeepSeek'};
  badge.textContent=names[R.provider]||R.provider;
  badge.dataset.pvd=R.provider;
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
    div.innerHTML=`<div class="mav" style="background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--mt);">${lang.ui.youLabel}</div><div class="bbl">${esc(m.content)}</div>`;
  }else{
    const ch=chars[charKey];div.className='msg a';
    const note=m.note?`<span class="note">${esc(m.note)}</span>`:'';
    const safe=(m.display||'').replace(/"/g,'&quot;');
    const retry=m.error?`<div style="margin-top:6px;"><button class="retry-btn" onclick="retryLastMsg()">${lang.ui.chatRetryBtn}</button></div>`:'';
    div.innerHTML=`<div class="mav" style="border-color:${ch.ac};">${SVG[charKey]}</div><div class="bbl" id="b${i}">${mdInline(esc(m.display))}<button class="spk-btn" data-txt="${safe}" onclick="speakFromBtn(this)" aria-label="${lang.ui.ariaListen}"><i class="ti ti-volume" aria-hidden="true"></i></button>${note}${retry}</div>`;
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
  const ch=chars[R.cur];
  if(!msgs.length){
    c.innerHTML=`<div class="empty-ch"><div style="width:60px;height:60px;border-radius:50%;overflow:hidden;border:2px solid var(--dim);">${SVG[R.cur]}</div><div style="color:var(--gold);font-style:italic;">${ch.name}</div><div>${lang.ui.emptyChat}</div><i class="ti ti-arrow-back-up" role="button" tabindex="0" aria-label="Reiniciar charla" onclick="resetConversation()" onkeydown="if(event.key==='Enter')resetConversation()" title="reiniciar charla" style="margin-top:8px;cursor:pointer;color:var(--mt);font-size:13px;opacity:.55;transition:opacity .2s;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.45'"></i></div>`;
    return;
  }
  c.innerHTML='';
  msgs.forEach((m,i)=>c.appendChild(createMsgEl(m,i,R.cur)));
  c.insertAdjacentHTML('afterbegin',`<div style="position:sticky;top:0;z-index:2;text-align:right;margin-bottom:-18px;"><i class="ti ti-arrow-back-up" role="button" tabindex="0" aria-label="Reiniciar charla" onclick="resetConversation()" onkeydown="if(event.key==='Enter')resetConversation()" title="reiniciar charla con ${esc(chars[R.cur].name)}" style="cursor:pointer;color:var(--mt);font-size:13px;opacity:.55;transition:opacity .2s;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.55'"></i></div>`);
  c.scrollTop=c.scrollHeight;
}

// ── Hints ─────────────────────────────────────────────────────────────────────
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
  el.innerHTML=hints.length?hints.map(h=>`<span class="hchip" onclick="useHint(this)">${esc(h)}</span>`).join(''):`<span class="hints-empty">${lang.ui.hintsEmpty}</span>`;
}
export function useHint(el){
  const ta=document.getElementById('ui');  ta.value=el.textContent;aResize(ta);
  ta.focus();
}

// Sanitize LLM reply suggestions → array of ≤3 trimmed non-empty strings (≤80 chars).
export function sanitizeOptions(o){
  if(!Array.isArray(o))return [];
  return o.filter(s=>typeof s==='string'&&s.trim()).map(s=>s.trim().slice(0,80)).slice(0,3);
}

export async function safeParse(raw){
  try{
    const parsed=extractJSON(raw);
    // model "thought out loud" before outputting JSON — prefer the pre-JSON prose if it's substantially richer
    const s=raw.replace(/```json|```/g,'').trim();
    let jsonStart=s.indexOf('{');
    const arrStart=s.indexOf('[');
    if(arrStart!==-1&&(jsonStart===-1||arrStart<jsonStart))jsonStart=arrStart;
    if(jsonStart>0&&typeof parsed.reply==='string'){
      let preText=s.slice(0,jsonStart).trim();
      if(preText.startsWith('"'))preText=preText.slice(1);
      if(preText.endsWith('"'))preText=preText.slice(0,-1);
      preText=preText.trim();
      if(preText.length>parsed.reply.length*2)parsed.reply=preText;
    }
    return parsed;
  }
  catch(e){
    // Step 1: quote bare keys at line-start (note: → "note":)
    let repaired = raw.replace(/(^|[\n\r])\s*([a-zA-Z_]\w*)\s*:/gm, '$1"$2":');
    try{return extractJSON(repaired);}catch(e2){}
    // Step 2: if no braces, find the key:value block and wrap it
    if (!repaired.includes('{')) {
      const knownKeys = ['"reply"','"note"','"vocab"','"mistakes"','"options"','"points"','"mood"','"challengeDone"'];
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
    return{reply:raw.replace(/\{.*\}/s,'').trim()||raw||lang.ui.chatFallback,note:'',vocab:[],mistakes:[],options:[],points:0,mood:2};
  }
}

// ── Character selection ───────────────────────────────────────────────────────
export async function selChar(tab){
  document.querySelectorAll('.ctab').forEach(t=>{t.classList.remove('active');t.style.borderBottomColor='transparent';});
  tab.classList.add('active');R.cur=tab.dataset.ch;
  S.lastChar=R.cur;await saveS();
  const ch=chars[R.cur];tab.style.borderBottomColor=ch.ac;
  const b=document.getElementById('hbadge');if(b){b.textContent=ch.house;b.style.background=ch.bbg;b.style.color=ch.btxt;b.style.borderColor=ch.bbd;}
  const ma=document.getElementById('mainApp');if(ma)ma.style.setProperty('--char-ac',ch.ac);
  renderMsgs();renderHints(S.currentHints[R.cur]&&S.currentHints[R.cur].length?S.currentHints[R.cur]:chars[R.cur].hints);renderSide();
  const sb=document.getElementById('sendB');if(sb)sb.disabled=false;document.getElementById('ui')?.focus();
  genDailyChallenges();
}
export function selCharByName(n){const t=document.querySelector(`[data-ch="${n}"]`);if(t)selChar(t);}

export function resetConversation(){
  S.hist[R.cur]=[];S.currentHints[R.cur]=undefined;
  renderMsgs();renderHints([]);
  saveS();genStarter(R.cur);
}

// ── Conversation starters ────────────────────────────────────────────────────
const starterLoading=new Set();

export async function genStarter(k){
  if(starterLoading.has(k)||S.hist[k].length>0)return;
  starterLoading.add(k);
  if(k===R.cur){document.getElementById('msgs').innerHTML='';showTyping();}
  try{
    const seeds=lang.starterSeeds[k]||lang.starterSeeds.hermione;
    const seed=seeds[Math.floor(Math.random()*seeds.length)];
    const framing=lang.starterFraming[k]||lang.starterFraming.hermione;
    const raw=await callLLM(getSys(k),[{role:'user',content:`${framing} ${seed}.`}],400,{type:'starter'});
    if(S.hist[k].length===0){
      const p=await safeParse(raw);
      S.hist[k].push({role:'assistant',content:p.reply,display:p.reply,note:''});
      if(typeof p.mood==='number')updMood(k,p.mood);
      saveS();
      if(k===R.cur){rmTyping();appendMsg(S.hist[k].at(-1));renderSide();
        const hints = await _genOptions(S.hist[k]);
        S.currentHints[k]=hints;renderHints(hints);}
    }else{if(k===R.cur)rmTyping();}
  }catch(e){
    if(k===R.cur){rmTyping();showToast(friendlyError(e),'#5a0000','#f5e5c0');}
  }
  starterLoading.delete(k);
}

async function _genOptions(hist, reply){
  try {
    const name = chars[R.cur]?.name || 'Professor';
    const recent = hist.slice(-6).map(m => {
      if (m.role === 'assistant') {
        const text = m.summary || m.content.slice(0, 80);
        return `${name}: ${text}`;
      }
      return `${lang.ui.contextStudentLabel}: ${m.content.slice(0, 100)}`;
    }).join('\n');
    const ctx = reply ? `${recent}\n${name}: ${reply.slice(0, 200)}` : recent;
    const raw = await callLLM(OPTIONS_PROMPT.replace('{{LV}}', LEVELS[S.level]), [{ role: 'user', content: ctx }], 200, { temperature: 0.2, type:'Q3' });
    const p = await safeParse(raw);
    return p.options && p.options.length ? sanitizeOptions(p.options) : [];
  } catch (e) { return []; }
}

async function _summarizeReply(reply){
  if (reply.length < 80) return '';
  try {
    const raw = await callLLM(SUMMARY_PROMPT, [{ role: 'user', content: reply }], 80, { temperature: 0.2, type:'Q2.5' });
    const p = await safeParse(raw);
    return (p.summary || '').trim();
  } catch (e) { return ''; }
}

// ── Send message ──────────────────────────────────────────────────────────────
export async function sendMsg(){
  if(R.loading)return;
  const ta=document.getElementById('ui');const txt=ta.value.trim();if(!txt)return;
  S.hist[R.cur].push({role:'user',content:txt});ta.value='';ta.style.height='auto';
  document.getElementById('sendB').disabled=true;R.loading=true;appendMsg(S.hist[R.cur].at(-1));showTyping();playSend();
  let suggestions=[];
  try{
    let hist=S.hist[R.cur].filter(m=>!m.error);
    const name = chars[R.cur]?.name || 'Professor';

    // Build a single conversation summary — no raw assistant text, no format conflicts
    const prev = hist.slice(-8, -1).filter(m => m.content && m.content.trim()); // exclude current user msg
    const summaryLines = prev.map(m => {
      if (m.role === 'assistant') {
        const text = m.summary || m.content.slice(0, 80);
        return `- ${name}: ${text}`;
      }
      return `- ${lang.ui.contextStudentLabel}: ${m.content}`;
    }).join('\n');
    const contextMsg = summaryLines
      ? `${lang.ui.contextSummaryHeader}\n${summaryLines}\n\n${lang.ui.contextLastMsg} ${txt}`
      : txt;

    // Build analysis context: include previous character reply so vocab from it gets extracted too
    const prevAssistant = prev.filter(m => m.role === 'assistant').at(-1);
    const analysisContent = prevAssistant
      ? `${lang.ui.contextCharSaid(name)} "${(prevAssistant.summary || prevAssistant.content).slice(0, 300)}"\n\n${lang.ui.contextStudentReplied} "${txt}"`
      : txt;

    // Q1 (conversation + scoring) ‖ Q2 (vocab/mistakes/note analysis) — parallel
    const [conRaw, anaRaw] = await Promise.all([
      callLLM(getSys(R.cur), [{ role: 'user', content: contextMsg }], 2500, {type:'Q1'}),
      callLLM(ANALYSIS_PROMPT.replace('{{LV}}', LEVELS[S.level]), [{ role: 'user', content: analysisContent }], 800, { temperature: 0.2, type:'Q2' })
    ]);

    // Parse conversation (Q1)
    const p=await safeParse(conRaw);
    if(!p.reply||!p.reply.trim())throw new Error('empty reply');
    S.hist[R.cur].push({role:'assistant',content:p.reply,display:p.reply,summary:'',note:''});
    S.totalMsgs++;

    // Scoring
    const today=new Date().toISOString().slice(0,10);
    const ck=R.cur+'_'+today;
    if(p.challengeDone&&!S.challengeDone[ck]){
      S.challengeDone[ck]=true;
      S.challengesCompleted=(S.challengesCompleted||0)+1;
      awardPoints(10);renderChallengeUI(R.cur);
      showToast(lang.ui.toastChallengeComplete,'#2a5018','#7acc40');
    }
    if(p.points)awardPoints(p.points);
    if(typeof p.mood==='number')updMood(R.cur,p.mood);

    // Parse analysis (Q2) — vocab, mistakes, note
    let changed=false;
    try{
      const a=await safeParse(anaRaw);
      if(a.vocab&&a.vocab.length){a.vocab.forEach(v=>{if(!vocabExists(v.word)){S.vocab.push({...v,ts:Date.now()});playVocab();changed=true;}});}
      if(a.mistakes&&a.mistakes.length){a.mistakes.forEach(m=>S.mistakes.push({...m,ts:Date.now()}));changed=true;}
      if(a.note){S.grammar.push({ch:R.cur,text:a.note,ts:Date.now()});changed=true;S.hist[R.cur].at(-1).note=a.note;}
      pushLevelOutcome(!(a.mistakes&&a.mistakes.length));
    }catch(e2){pushLevelOutcome(true);}
    if(changed)renderSide();

    // Q2.5 (summarize reply) ‖ Q3 (suggestions) — parallel
    const [sum, opts] = await Promise.all([
      _summarizeReply(p.reply),
      _genOptions(hist, p.reply)
    ]);
    S.hist[R.cur].at(-1).summary = sum;
    suggestions = opts;
    checkAchievements();
    playRecv();if(!S.ttsOff)setTimeout(()=>speak(p.reply),350);
    S.currentHints[R.cur]=suggestions;saveS();
  }catch(e){const msg=friendlyError(e);S.hist[R.cur].push({role:'assistant',content:msg,display:msg,note:'',error:true});saveS();}
  rmTyping();R.loading=false;document.getElementById('sendB').disabled=false;appendMsg(S.hist[R.cur].at(-1));renderHints(suggestions);document.getElementById('ui').focus();
}
