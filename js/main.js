// ── MAIN ───────────────────────────────────────────────────────────────────
// App entry point. Wires the splash button, runs enterApp(), sets up global
// event listeners, and exposes every function referenced by inline HTML
// `onclick` attributes to `window` (ES module scope is not global; this
// block is the documented "public surface" of the app's HTML interface).
import { S, R, loadS, saveS, _syncComplete, onSaveError } from './state.js';
import { LEVELS } from './characters.js';
import { SVG } from './portraits.js';
import { prefillCreds, setProvider, saveCreds, clearCreds, removeCreds, KEY_INPUT_ID, savedKeyIndicator, splashEditKey, splashDeleteKey } from './credentials.js';
import { tryPlayNow, stopMusic, tryAudio, syncAudioBtn, toggleAudio, skipSong } from './audio.js';
import { speak, speakFromBtn, setVoicePref, testVoice } from './tts.js';
import { processDateChanges, updPtsUI, updStreakUI, awardPoints, pushLevelOutcome } from './progress.js';
import { genDailyChallenges } from './challenges.js';
import { sendMsg, selChar, selCharByName, updHeaderAll, useHint, renderMsgs, genStarter, retryLastMsg, resetConversation } from './chat.js';
import { renderSide, setSTab, navWeek, toggleVAdd, submitVAdd, editVocab, cancelEditVocab, saveEditVocab, deleteVocab, editMistake, cancelEditMistake, saveEditMistake, deleteMistake, openFc, closeFc, flipFc, navFc, toggleFcReverse, handleSelUp, hideSelBtn, addSelectionToVocab, addReadingSelToVocab, startSrsReview, srsReveal, srsAnswer, closeSrsReview } from './sidepanel.js';
import { openSettings, closeSettings, setSettingsTab, renderSettings, setModelPref, setTtsOff, openAchievements, closeAchievements, renderAchievements, validateProviderKey, clearLog } from './settings.js';
import { openErrExplain, closeErrExplain, askErrFollowUp, clickErrSuggestion } from './error-explain.js';
import { compareModels } from './model-compare.js';
import { getToken, isAuthenticated, signInWithGoogle, initOneTap, signOut, getUserEmail } from './auth.js';
import { consecutivePushFailures } from './sync.js';
import { showToast, aResize } from './helpers.js';
import lang from './lang.js';

// ── Lazy-load overlays — deferred to remove ~65KB from startup critical path ───
let _readingM, _readingLoad, _gamesM, _gamesLoad;
async function _loadReading() {
  if (_readingLoad) return _readingLoad;
  if (_readingM) return;
  _readingLoad = import('./reading.js').then(m => {
    _readingM = m;
    const fns = ['openReading','closeReading','selectReadingSource','selectArticle','startQuiz','startRecap','answerQuiz','submitRecap','returnToLobby','setReadingDiff','refreshSource','readingListen'];
    fns.forEach(k => { window[k] = m[k]; });
    _readingLoad = null;
  });
  return _readingLoad;
}
async function _loadGames() {
  if (_gamesLoad) return _gamesLoad;
  if (_gamesM) return;
  _gamesLoad = import('./games.js').then(m => {
    _gamesM = m;
    const fns = ['openGames','closeGames','setGameTab','setGameDifficulty','genDictation','genTranslation','hintDictation','checkDictation','skipDictation','hintTranslation','checkTranslation','skipTranslation','genOrderGame','checkOrder','hintOrder','skipOrder','genMemory','skipMemory','flipMemCard','cleanupMemory','setRandomMode','renderMemoryLobby'];
    fns.forEach(k => { window[k] = m[k]; });
    _gamesLoad = null;
  });
  return _gamesLoad;
}

// Portrait injection
export function buildPortraits(){Object.keys(SVG).forEach(k=>{const el=document.getElementById('p_'+k);if(el)el.innerHTML=SVG[k];});}

async function enterApp(skipValidation=false){
  tryPlayNow();
  const keyVal=document.getElementById(KEY_INPUT_ID[R.provider]).value.trim();
  document.getElementById('splashKeyErr')?.remove();
  if(!skipValidation&&keyVal){
    const btn=document.getElementById('splashBtn');
    const prev=btn.textContent;    btn.textContent=lang.ui.splashVerifying;btn.classList.add('loading');btn.disabled=true;
    const ok=await validateProviderKey(R.provider,keyVal);
    if(ok===false){
      btn.textContent=prev;btn.classList.remove('loading');btn.disabled=false;
      const errEl=document.createElement('div');
      errEl.id='splashKeyErr';
      errEl.style.cssText='font-size:11px;color:#d04040;margin-top:6px;text-align:center;';
      errEl.innerHTML=`${lang.ui.splashKeyInvalid} · <a href="#" style="color:var(--gold);" onclick="event.preventDefault();enterApp(true)">${lang.ui.splashKeyContinueAnyway}</a>`;
      document.querySelector('.sp-key').appendChild(errEl);
      return;
    }
  }
  if(R.provider==='openai')R.keys.openai=keyVal;
  else if(R.provider==='deepseek')R.keys.deepseek=keyVal;
  else R.keys.groq=keyVal;
  // Restore all other providers' saved keys so settings tab stays correct.
  if(R.cachedCreds.groq&&!R.keys.groq)R.keys.groq=R.cachedCreds.groq;
  if(R.cachedCreds.openai&&!R.keys.openai)R.keys.openai=R.cachedCreds.openai;
  if(R.cachedCreds.deepseek&&!R.keys.deepseek)R.keys.deepseek=R.cachedCreds.deepseek;
  const remember=document.getElementById('rememberKey').checked;
  if(remember&&keyVal)await saveCreds(R.provider,keyVal);
  else if(!remember)await clearCreds(R.provider);
  const btn=document.getElementById('splashBtn');  btn.textContent=lang.ui.splashLoading;btn.classList.add('loading');btn.disabled=true;
  await loadS();processDateChanges();
  if(S.musicOff)stopMusic();
  syncAudioBtn();
  document.getElementById('splash').style.display='none';
  document.getElementById('mainApp').style.display='flex';
  buildPortraits();updHeaderAll();selCharByName(S.lastChar||'hermione');
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
  setInterval(()=>{const t=new Date().toISOString().slice(0,10);if(S.lastActiveDate&&S.lastActiveDate!==t){processDateChanges();saveS();}updateSyncBadge();},60000);
  tryAudio();
  await saveS();
  updateAuthUI();
  updateSyncBadge();
}

// ── Auth UI functions ─────────────────────────────────────────────────────
async function authSignInGoogle() {
  const btn = document.getElementById('googleSignInBtn');
  btn.disabled = true;
  document.getElementById('authMsg').innerHTML = '';
  const result = await signInWithGoogle();
  btn.disabled = false;
  if (result.ok) {
    document.getElementById('authMsg').innerHTML = `<span class="auth-success">${lang.ui.signInSuccess}</span>`;
    updateAuthUI();
  } else {
    document.getElementById('authMsg').innerHTML = `<span class="auth-error">${lang.ui.signInError(result.error)}</span>`;
  }
}

async function authSignOut() {
  signOut();
  updateAuthUI();
  showToast(lang.ui.toastSignedOut,'#2a5018','#7acc40');
  // Re-show auth form on splash for next time
  document.getElementById('spAuth').style.display = '';
  document.getElementById('authMsg').innerHTML = '';
}

function skipAuth() {
  document.getElementById('spAuth').style.display = 'none';
}

async function updateAuthUI() {
  const authSection = document.getElementById('spAuth');
  const signOutBtn = document.getElementById('authSignOutBtn');
  const syncBadge = document.getElementById('syncBadge');
  const authed = await isAuthenticated();
  if (authed) {
    if (signOutBtn) signOutBtn.style.display = '';
    if (syncBadge) syncBadge.style.display = '';
    if (authSection) authSection.style.display = 'none';
  } else {
    if (signOutBtn) signOutBtn.style.display = 'none';
    if (syncBadge) syncBadge.style.display = 'none';
  }
}

async function updateSyncBadge() {
  const badge = document.getElementById('syncBadge');
  if (!badge) return;
  const authed = await isAuthenticated();
  if (!authed) { badge.style.display = 'none'; return; }
  badge.style.display = '';
  if (!_syncComplete) {
    badge.className = 'sync-badge error';
    badge.title = lang.ui.syncPending;
  } else if (consecutivePushFailures >= 3) {
    badge.className = 'sync-badge error';
    badge.title = lang.ui.syncOffline;
  } else {
    badge.className = 'sync-badge';
    badge.title = lang.ui.syncActive;
  }
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
  btn.classList.remove('loading');
  btn.textContent=lang.ui.splashSave;
  btn.disabled=false;
  btn.onclick = saveSplashAuth;
  // Pre-fill inputs and indicators for all providers.
  ['groq','openai','deepseek'].forEach(p=>{
    if(R.keys[p]){
      const el=document.getElementById(KEY_INPUT_ID[p]);
      if(el)el.value=R.keys[p];
    }
    savedKeyIndicator(p);
  });
  setProvider(R.provider);
  document.getElementById('rememberKey').checked=!!(R.cachedCreds&&R.cachedCreds[R.provider]);
  setTimeout(()=>{
    const el=document.getElementById(KEY_INPUT_ID[R.provider]);
    if(el&&el.style.display!=='none')el.focus();
  },50);
}

function hideSplashAuth(){
  document.getElementById('splash').style.display='none';
  document.getElementById('splashBackBtn').style.display='none';
  const btn=document.getElementById('splashBtn');
  btn.classList.remove('loading');
  btn.textContent=lang.ui.splashBtn;
  btn.onclick = enterApp;
  document.getElementById('mainApp').style.display='flex';
}

async function saveSplashAuth(){
  const btn=document.getElementById('splashBtn');
  btn.textContent=lang.ui.splashSaving;btn.classList.add('loading');btn.disabled=true;
  try{
    const keyVal=(document.getElementById(KEY_INPUT_ID[R.provider])?.value||'').trim();
    if(keyVal){
      R.keys[R.provider]=keyVal;
      await saveCreds(R.provider,keyVal);
    }
    for(const p of ['groq','openai','deepseek']){
      if(p===R.provider)continue;
      const v=document.getElementById(KEY_INPUT_ID[p])?.value?.trim();
      if(v){
        R.keys[p]=v;
        await saveCreds(p,v);
      }
    }
    // Ensure last-provider stays as the currently active one (saveCreds loop overwrites it)
    if (R.keys[R.provider]) await saveCreds(R.provider, R.keys[R.provider]);
    hideSplashAuth();
    showToast(lang.ui.toastSaved,'#2a5018','#7acc40');
  }catch(e){
    btn.classList.remove('loading');btn.disabled=false;
    btn.textContent=lang.ui.splashSave;
    showToast('Error: '+e.message,'#5a0000','#f5e5c0');
  }
}

// ── Bottom-of-page init ────────────────────────────────────────────────────
// Kick off voice list enumeration early so voices are ready when settings open.
window.speechSynthesis&&window.speechSynthesis.getVoices&&window.speechSynthesis.getVoices();
if('speechSynthesis' in window)window.speechSynthesis.onvoiceschanged=()=>{
  if(document.getElementById('settingsOv').style.display==='flex')renderSettings();
};

onSaveError(()=>showToast(lang.ui.saveError,'#740001','#f5e5c0'));

const hasAutologin=await prefillCreds();
setTimeout(()=>{
  const el=document.getElementById(KEY_INPUT_ID[R.provider]);
  if(el&&el.style.display!=='none')el.focus();
},50);
if(hasAutologin){
  document.querySelector('.sp-key').style.display='none';
  const btn=document.getElementById('splashBtn');
  btn.textContent=lang.ui.splashBtnContinue;
  btn.onclick=()=>enterApp(true);
} else {
  document.querySelector('.sp-key').style.display='';
}
// Auth visibility — show/hide auth section based on token state
const authenticated = await isAuthenticated();
if (authenticated) {
  document.getElementById('spAuth').style.display = 'none';
} else if (!hasAutologin) {
  document.getElementById('spAuth').style.display = '';
} else {
  document.getElementById('spAuth').style.display = '';
}
updateAuthUI();

// Fire One Tap passively on page load — zero-friction sign-in for Chrome
// users already signed into Google. Silent failure is fine — button stays visible.
// Skip if already authenticated — no point showing One Tap to a signed-in user.
if (!authenticated) initOneTap(() => {
  document.getElementById('spAuth').style.display = 'none';
  updateAuthUI();
});

document.addEventListener('mouseup',handleSelUp);
document.addEventListener('touchend',handleSelUp);
document.getElementById('msgs').addEventListener('scroll',hideSelBtn);
document.getElementById('readingOv').addEventListener('scroll',hideSelBtn);
document.addEventListener('keydown',e=>{
  if(e.key==='Tab'){
    const overlays=['settingsOv','achievementsOv','gamesOv','errExplainOv','fcOv','readingOv'];
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
  if(e.key==='Enter'&&!e.shiftKey){
    const splash=document.getElementById('splash');
    if(splash&&splash.offsetParent!==null){
      const active=document.activeElement;
      if(!active||active.tagName==='BODY'||active.closest('.sp-key')||active.id==='splashBtn'){
        e.preventDefault();
        document.getElementById('splashBtn').click();
      }
    }
  }
  if(e.key!=='Escape')return;
  const pairs=[['settingsOv',closeSettings],['achievementsOv',closeAchievements],['gamesOv',closeGames],['errExplainOv',closeErrExplain],['fcOv',closeFc],['readingOv',closeReading]];
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
  if(!('webkitSpeechRecognition' in window)&&!('SpeechRecognition' in window)){showToast(lang.ui.micNotSupported,'#5a0000','#f5e5c0');return;}
  if(isRec){if(rec)rec.stop();return;}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  rec=new SR();rec.lang=lang.sttLocale;rec.continuous=false;rec.interimResults=true;
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
  authSignInGoogle, authSignOut, skipAuth,
  // Audio
  toggleAudio, skipSong,
  // Character tabs
  selChar, selCharByName,
  // Chat input
  sendMsg, useHint, retryLastMsg, resetConversation,
  // Side panel tabs
  setSTab, navWeek,
  // Vocab add form
  toggleVAdd, submitVAdd,
  // Vocab / mistake edit
  editVocab, cancelEditVocab, saveEditVocab, deleteVocab,
  editMistake, cancelEditMistake, saveEditMistake, deleteMistake,
  // SRS review
  startSrsReview, srsReveal, srsAnswer, closeSrsReview,
  // Vocab selection from chat/reading
  addSelectionToVocab, addReadingSelToVocab,
  // Flashcards
  openFc, closeFc, flipFc, navFc, toggleFcReverse,
  // Achievements overlay
  openAchievements, closeAchievements,
  // Settings overlay
  openSettings, closeSettings, setSettingsTab, setModelPref, setTtsOff,
  setVoicePref, testVoice,
  clearLog,
  // Model comparison
  compareModels,
  // Auth / splash management
  splashEditKey, splashDeleteKey, showSplashAuth, hideSplashAuth, saveSplashAuth,
  // Error explain overlay
  openErrExplain, closeErrExplain, askErrFollowUp, clickErrSuggestion,
  // Games overlay (lazy)
  openGames() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.openGames()); },
  closeGames() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.closeGames()); },
  setGameTab(t) { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.setGameTab(t)); },
  setGameDifficulty(d) { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.setGameDifficulty(d)); },
  genDictation() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.genDictation()); },
  genTranslation() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.genTranslation()); },
  hintDictation() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.hintDictation()); },
  checkDictation() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.checkDictation()); },
  skipDictation() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.skipDictation()); },
  hintTranslation() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.hintTranslation()); },
  checkTranslation() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.checkTranslation()); },
  skipTranslation() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.skipTranslation()); },
  genOrderGame() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.genOrderGame()); },
  checkOrder() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.checkOrder()); },
  hintOrder() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.hintOrder()); },
  skipOrder() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.skipOrder()); },
  genMemory() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.genMemory()); },
  skipMemory() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.skipMemory()); },
  flipMemCard(i) { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.flipMemCard(i)); },
  cleanupMemory() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.cleanupMemory()); },
  setRandomMode(v) { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.setRandomMode(v)); },
  renderMemoryLobby() { (_gamesM ? Promise.resolve() : _loadGames()).then(() => _gamesM.renderMemoryLobby()); },
  // TTS
  speak, speakFromBtn,
  // Side panel (mobile)
  toggleSide,
  // Voice input
  toggleMic,
  // Textarea keyboard handler
  hKey: (e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}},
  aResize,
  // Reading comprehension (lazy)
  openReading() { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.openReading()); },
  closeReading() { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.closeReading()); },
  selectReadingSource(s) { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.selectReadingSource(s)); },
  selectArticle(id) { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.selectArticle(id)); },
  startQuiz() { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.startQuiz()); },
  startRecap() { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.startRecap()); },
  answerQuiz(i) { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.answerQuiz(i)); },
  submitRecap() { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.submitRecap()); },
  returnToLobby() { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.returnToLobby()); },
  setReadingDiff(d) { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.setReadingDiff(d)); },
  refreshSource(s) { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.refreshSource(s)); },
  readingListen(btn) { (_readingM ? Promise.resolve() : _loadReading()).then(() => _readingM.readingListen(btn)); },
});
