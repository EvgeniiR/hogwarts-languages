// ── MAIN ───────────────────────────────────────────────────────────────────
// App entry point. Wires the splash button, runs enterApp(), sets up global
// event listeners, and exposes every function referenced by inline HTML
// `onclick` attributes to `window` (ES module scope is not global; this
// block is the documented "public surface" of the app's HTML interface).
import { S, R, loadS, saveS } from './state.js';
import { LEVELS } from './characters.js';
import { SVG } from './portraits.js';
import { prefillCreds, setProvider, saveCreds, clearCreds, KEY_INPUT_ID } from './credentials.js';
import { tryAudio, syncAudioBtn, toggleAudio, skipSong } from './audio.js';
import { speak, speakFromBtn, setVoicePref, testVoice } from './tts.js';
import { processDateChanges, updPtsUI, updStreakUI, awardPoints } from './progress.js';
import { genDailyChallenges } from './challenges.js';
import { sendMsg, selChar, selCharByName, updHeaderAll, showHints, useHint, renderMsgs, genStarter } from './chat.js';
import { renderSide, setSTab, navWeek, toggleVAdd, submitVAdd, editVocab, cancelEditVocab, saveEditVocab, deleteVocab, editMistake, cancelEditMistake, saveEditMistake, deleteMistake, openFc, closeFc, flipFc, navFc, handleSelUp, hideSelBtn, addSelectionToVocab } from './sidepanel.js';
import { openGames, closeGames, setGameTab, setGameDifficulty, genDictation, genTranslation, hintDictation, checkDictation, skipDictation, hintTranslation, checkTranslation, skipTranslation } from './games.js';
import { openSettings, closeSettings, setSettingsTab, renderSettings, setModelPref, setAuthProvider, authKeyTyped, saveAuthFromSettings, clearAuthFromSettings, openAchievements, closeAchievements, renderAchievements } from './settings.js';

// Portrait injection
export function buildPortraits(){Object.keys(SVG).forEach(k=>{const el=document.getElementById('p_'+k);if(el)el.innerHTML=SVG[k];});}

async function enterApp(){
  const keyVal=document.getElementById(KEY_INPUT_ID[R.provider]).value.trim();
  if(R.provider==='anthropic')R.keys.anthropic=keyVal;
  else if(R.provider==='gemini')R.keys.gemini=keyVal;
  else R.keys.groq=keyVal;
  // Restore all other providers' saved keys so settings tab stays correct.
  if(R.cachedCreds.anthropic&&!R.keys.anthropic)R.keys.anthropic=R.cachedCreds.anthropic;
  if(R.cachedCreds.gemini&&!R.keys.gemini)R.keys.gemini=R.cachedCreds.gemini;
  if(R.cachedCreds.groq&&!R.keys.groq)R.keys.groq=R.cachedCreds.groq;
  const remember=document.getElementById('rememberKey').checked;
  if(remember&&keyVal)await saveCreds(R.provider,keyVal);
  else if(!remember)await clearCreds(R.provider);
  const btn=document.getElementById('splashBtn');btn.textContent='Cargando…';btn.disabled=true;
  await loadS();processDateChanges();
  document.getElementById('splash').remove();
  document.getElementById('mainApp').style.display='flex';
  buildPortraits();updHeaderAll();selCharByName('hermione');
  setInterval(()=>{const t=new Date().toISOString().slice(0,10);if(S.lastActiveDate&&S.lastActiveDate!==t)processDateChanges();},60000);
  // Sync audio icon to saved S.musicOff BEFORE tryAudio() fires asynchronously.
  syncAudioBtn();
  tryAudio();
  await saveS();
}

// ── Bottom-of-page init ────────────────────────────────────────────────────
// Kick off voice list enumeration early so voices are ready when settings open.
window.speechSynthesis&&window.speechSynthesis.getVoices&&window.speechSynthesis.getVoices();
if('speechSynthesis' in window)window.speechSynthesis.onvoiceschanged=()=>{
  if(document.getElementById('settingsOv').style.display==='flex')renderSettings();
};

const hasAutologin=await prefillCreds();
if(hasAutologin)enterApp();

document.addEventListener('mouseup',handleSelUp);
document.addEventListener('touchend',handleSelUp);
document.getElementById('msgs').addEventListener('scroll',hideSelBtn);

if('mediaSession' in navigator){
  ['play','pause','stop','seekbackward','seekforward','previoustrack','nexttrack'].forEach(action=>{
    try{navigator.mediaSession.setActionHandler(action,()=>{});}catch(e){}
  });
}

// ── Voice input (mic) ─────────────────────────────────────────────────────
let rec=null,isRec=false;
function toggleMic(){
  if(!('webkitSpeechRecognition' in window)&&!('SpeechRecognition' in window)){alert('Voice input needs Chrome or Edge.');return;}
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
  sendMsg, showHints, useHint,
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
  openSettings, closeSettings, setSettingsTab, setModelPref,
  setAuthProvider, authKeyTyped, saveAuthFromSettings, clearAuthFromSettings,
  setVoicePref, testVoice,
  // Games overlay
  openGames, closeGames, setGameTab, setGameDifficulty,
  genDictation, genTranslation,
  hintDictation, checkDictation, skipDictation,
  hintTranslation, checkTranslation, skipTranslation,
  // TTS
  speak, speakFromBtn,
  // Voice input
  toggleMic,
  // Textarea keyboard handler
  hKey: (e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}},
  // helpers needed by inline dynamic HTML (aResize, speak)
  aResize: (el)=>{el.style.height='auto';el.style.height=Math.min(el.scrollHeight,72)+'px';},
  // games.js uses window.pushLevelOutcome (called inside dynamic innerHTML)
  pushLevelOutcome: (await import('./progress.js')).pushLevelOutcome,
});
