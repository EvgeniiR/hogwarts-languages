// ── MAIN ───────────────────────────────────────────────────────────────────
// App entry point. Wires the splash button, runs enterApp(), sets up global
// event listeners, and exposes every function referenced by inline HTML
// `onclick` attributes to `window` (ES module scope is not global; this
// block is the documented "public surface" of the app's HTML interface).
import { S, R, loadS, saveS, onSaveError } from './state.js';
import { LEVELS } from './characters.js';
import { SVG } from './portraits.js';
import { prefillCreds, setProvider, saveCreds, clearCreds, removeCreds, KEY_INPUT_ID, savedKeyIndicator, splashEditKey, splashDeleteKey } from './credentials.js';
import { tryPlayNow, stopMusic, tryAudio, syncAudioBtn, toggleAudio, skipSong } from './audio.js';
import { speak, speakFromBtn, setVoicePref, testVoice } from './tts.js';
import { processDateChanges, updPtsUI, updStreakUI, awardPoints, pushLevelOutcome } from './progress.js';
import { genDailyChallenges } from './challenges.js';
import { sendMsg, selChar, selCharByName, updHeaderAll, showHints, useHint, renderMsgs, genStarter, retryLastMsg } from './chat.js';
import { renderSide, setSTab, navWeek, toggleVAdd, submitVAdd, editVocab, cancelEditVocab, saveEditVocab, deleteVocab, editMistake, cancelEditMistake, saveEditMistake, deleteMistake, openFc, closeFc, flipFc, navFc, handleSelUp, hideSelBtn, addSelectionToVocab } from './sidepanel.js';
import { openGames, closeGames, setGameTab, setGameDifficulty, genDictation, genTranslation, hintDictation, checkDictation, skipDictation, hintTranslation, checkTranslation, skipTranslation, genOrderGame, checkOrder, hintOrder, skipOrder, genMemory, skipMemory, flipMemCard, cleanupMemory, setRandomMode, renderMemoryLobby } from './games.js';
import { openSettings, closeSettings, setSettingsTab, renderSettings, setModelPref, setTtsOff, openAchievements, closeAchievements, renderAchievements, validateProviderKey, clearLog } from './settings.js';
import { openErrExplain, closeErrExplain, askErrFollowUp, clickErrSuggestion } from './error-explain.js';
import { showToast, aResize } from './helpers.js';

// Portrait injection
export function buildPortraits(){Object.keys(SVG).forEach(k=>{const el=document.getElementById('p_'+k);if(el)el.innerHTML=SVG[k];});}

async function enterApp(skipValidation=false){
  tryPlayNow();
  const keyVal=document.getElementById(KEY_INPUT_ID[R.provider]).value.trim();
  document.getElementById('splashKeyErr')?.remove();
  if(!skipValidation&&keyVal){
    const btn=document.getElementById('splashBtn');
    const prev=btn.textContent;btn.textContent='Verificando…';btn.disabled=true;
    const ok=await validateProviderKey(R.provider,keyVal);
    if(ok===false){
      btn.textContent=prev;btn.disabled=false;
      const errEl=document.createElement('div');
      errEl.id='splashKeyErr';
      errEl.style.cssText='font-size:11px;color:#d04040;margin-top:6px;text-align:center;';
      errEl.innerHTML='✗ Clave inválida · <a href="#" style="color:var(--gold);" onclick="event.preventDefault();enterApp(true)">Continuar de todos modos →</a>';
      document.querySelector('.sp-key').appendChild(errEl);
      return;
    }
  }
  if(R.provider==='anthropic')R.keys.anthropic=keyVal;
  else if(R.provider==='gemini')R.keys.gemini=keyVal;
  else if(R.provider==='openai')R.keys.openai=keyVal;
  else R.keys.groq=keyVal;
  // Restore all other providers' saved keys so settings tab stays correct.
  if(R.cachedCreds.anthropic&&!R.keys.anthropic)R.keys.anthropic=R.cachedCreds.anthropic;
  if(R.cachedCreds.gemini&&!R.keys.gemini)R.keys.gemini=R.cachedCreds.gemini;
  if(R.cachedCreds.groq&&!R.keys.groq)R.keys.groq=R.cachedCreds.groq;
  if(R.cachedCreds.openai&&!R.keys.openai)R.keys.openai=R.cachedCreds.openai;
  const remember=document.getElementById('rememberKey').checked;
  if(remember&&keyVal)await saveCreds(R.provider,keyVal);
  else if(!remember)await clearCreds(R.provider);
  const btn=document.getElementById('splashBtn');btn.textContent='Cargando…';btn.disabled=true;
  await loadS();processDateChanges();
  if(S.musicOff)stopMusic();
  syncAudioBtn();
  document.getElementById('splash').style.display='none';
  document.getElementById('mainApp').style.display='flex';
  buildPortraits();updHeaderAll();selCharByName('hermione');
  // Prefetch starters for all 4 characters in parallel at init.
  // genStarter guards against re-fetching if history exists or already loading.
  // Only R.cur (hermione) shows typing dots; others load silently in background.
  // Stagger by 400ms to avoid rate limits on free-tier providers.
  const chars=Object.keys(S.hist);
  for(let i=0;i<chars.length;i++){
    const delay=i*400;
    if(delay)setTimeout(()=>genStarter(chars[i]),delay);
    else genStarter(chars[i]);
  }
  setInterval(()=>{const t=new Date().toISOString().slice(0,10);if(S.lastActiveDate&&S.lastActiveDate!==t)processDateChanges();},60000);
  tryAudio();
  await saveS();
}

// ── Splash auth management (shown from settings) ──────────────────────────
function showSplashAuth(){
  document.getElementById('splashKeyErr')?.remove();
  document.getElementById('mainApp').style.display='none';
  const splash=document.getElementById('splash');
  splash.style.display='flex';
  document.querySelector('.sp-key').style.display='';
  document.getElementById('splashBackBtn').style.display='';
  const btn=document.getElementById('splashBtn');
  btn.textContent='Guardar';
  btn.disabled=false;
  btn.setAttribute('onclick','saveSplashAuth()');
  // Pre-fill inputs and indicators for all providers.
  ['groq','openai','anthropic','gemini'].forEach(p=>{
    if(R.keys[p]){
      const el=document.getElementById(KEY_INPUT_ID[p]);
      if(el)el.value=R.keys[p];
    }
    savedKeyIndicator(p);
  });
  setProvider(R.provider);
  document.getElementById('rememberKey').checked=!!(R.cachedCreds&&R.cachedCreds[R.provider]);
}

function hideSplashAuth(){
  document.getElementById('splash').style.display='none';
  document.getElementById('splashBackBtn').style.display='none';
  const btn=document.getElementById('splashBtn');
  btn.textContent='Accio Español →';
  btn.setAttribute('onclick','enterApp()');
  document.getElementById('mainApp').style.display='flex';
}

async function saveSplashAuth(){
  try{
    const keyVal=(document.getElementById(KEY_INPUT_ID[R.provider])?.value||'').trim();
    if(keyVal){
      R.keys[R.provider]=keyVal;
      await saveCreds(R.provider,keyVal);
    }
    for(const p of ['groq','openai','anthropic','gemini']){
      if(p===R.provider)continue;
      const v=document.getElementById(KEY_INPUT_ID[p])?.value?.trim();
      if(v){
        R.keys[p]=v;
        await saveCreds(p,v);
      }
    }
    hideSplashAuth();
    showToast('✓ Guardado','#2a5018','#7acc40');
  }catch(e){
    showToast('Error al guardar: '+e.message,'#5a0000','#f5e5c0');
  }
}

// ── Bottom-of-page init ────────────────────────────────────────────────────
// Kick off voice list enumeration early so voices are ready when settings open.
window.speechSynthesis&&window.speechSynthesis.getVoices&&window.speechSynthesis.getVoices();
if('speechSynthesis' in window)window.speechSynthesis.onvoiceschanged=()=>{
  if(document.getElementById('settingsOv').style.display==='flex')renderSettings();
};

onSaveError(()=>showToast('⚠ Error al guardar tu progreso (almacenamiento lleno)','#740001','#f5e5c0'));

const hasAutologin=await prefillCreds();
if(hasAutologin){
  document.querySelector('.sp-key').style.display='none';
  const btn=document.getElementById('splashBtn');
  btn.textContent='Continuar →';
  btn.onclick=()=>enterApp(true);
}

document.addEventListener('mouseup',handleSelUp);
document.addEventListener('touchend',handleSelUp);
document.getElementById('msgs').addEventListener('scroll',hideSelBtn);
document.addEventListener('keydown',e=>{
  if(e.key==='Tab'){
    const overlays=['settingsOv','achievementsOv','gamesOv','errExplainOv','fcOv'];
    for(const id of overlays){
      const ov=document.getElementById(id);
      if(ov&&ov.style.display==='flex'){
        const focusable=ov.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if(!focusable.length)return;
        const first=focusable[0],last=focusable[focusable.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
        return;
      }
    }
    return;
  }
  if(e.key!=='Escape')return;
  const pairs=[['settingsOv',closeSettings],['achievementsOv',closeAchievements],['gamesOv',closeGames],['errExplainOv',closeErrExplain],['fcOv',closeFc]];
  for(const [id,fn] of pairs){if(document.getElementById(id)?.style.display==='flex'){fn();break;}}
});

if('mediaSession' in navigator){
  ['play','pause','stop','seekbackward','seekforward','previoustrack','nexttrack'].forEach(action=>{
    try{navigator.mediaSession.setActionHandler(action,()=>{});}catch(e){}
  });
}

// ── Side panel toggle (mobile) ────────────────────────────────────────────
function toggleSide(){
  document.querySelector('.side').classList.toggle('open');
}

// ── Voice input (mic) ─────────────────────────────────────────────────────
let rec=null,isRec=false;
function toggleMic(){
  if(!('webkitSpeechRecognition' in window)&&!('SpeechRecognition' in window)){showToast('El micrófono solo funciona en Chrome o Edge','#5a0000','#f5e5c0');return;}
  if(isRec){if(rec)rec.stop();return;}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  rec=new SR();rec.lang='es-ES';rec.continuous=false;rec.interimResults=true;
  const btn=document.getElementById('micB');const ta=document.getElementById('ui');
  rec.onstart=()=>{isRec=true;btn.classList.add('rec');btn.querySelector('i').className='ti ti-microphone-off';};
  rec.onresult=(e)=>{ta.value=Array.from(e.results).map(r=>r[0].transcript).join('');window.aResize&&window.aResize(ta);};
  rec.onend=rec.onerror=()=>{isRec=false;btn.classList.remove('rec');btn.querySelector('i').className='ti ti-microphone';rec=null;};
  rec.start();
}

// ── window bindings: inline `onclick` handlers need global scope ────────────
// The HTML uses onclick="fnName()" on ~50 elements. ES module functions are
// NOT in global scope. This block re-exports every HTML-referenced function
// to window. If you add a new onclick in the HTML, add its binding here.
Object.assign(window,{
  // Splash / auth
  enterApp, setProvider,
  // Audio
  toggleAudio, skipSong,
  // Character tabs
  selChar, selCharByName,
  // Chat input
  sendMsg, showHints, useHint, retryLastMsg,
  // Side panel tabs
  setSTab, navWeek,
  // Vocab add form
  toggleVAdd, submitVAdd,
  // Vocab / mistake edit
  editVocab, cancelEditVocab, saveEditVocab, deleteVocab,
  editMistake, cancelEditMistake, saveEditMistake, deleteMistake,
  // Vocab selection from chat
  addSelectionToVocab,
  // Flashcards
  openFc, closeFc, flipFc, navFc,
  // Achievements overlay
  openAchievements, closeAchievements,
  // Settings overlay
  openSettings, closeSettings, setSettingsTab, setModelPref, setTtsOff,
  setVoicePref, testVoice,
  clearLog,
  // Auth / splash management
  splashEditKey, splashDeleteKey, showSplashAuth, hideSplashAuth, saveSplashAuth,
  // Error explain overlay
  openErrExplain, closeErrExplain, askErrFollowUp, clickErrSuggestion,
  // Games overlay
  openGames, closeGames, setGameTab, setGameDifficulty,
  genDictation, genTranslation,
  hintDictation, checkDictation, skipDictation,
  hintTranslation, checkTranslation, skipTranslation,
  genOrderGame, checkOrder, hintOrder, skipOrder,
  genMemory, skipMemory, flipMemCard, cleanupMemory, setRandomMode, renderMemoryLobby,
  // TTS
  speak, speakFromBtn,
  // Side panel (mobile)
  toggleSide,
  // Voice input
  toggleMic,
  // Textarea keyboard handler
  hKey: (e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}},
  aResize,
});
