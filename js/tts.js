// ── TEXT-TO-SPEECH ─────────────────────────────────────────────────────────
// Web Speech API synthesis. Picks a voice in the target language by gender
// (user override in S.voicePrefs, else a name-hint heuristic).
import { R, S, saveS } from './state.js';
import { chars } from './characters.js';
import lang from './lang.js';

export const langVoices = function(){return window.speechSynthesis.getVoices().filter(v=>v.lang.startsWith(lang.ttsLocale.slice(0,2)));};
// Keep old name as alias so settings.js import still works
export const spanishVoices = langVoices;

export function pickVoice(gender){
  const voices=langVoices();
  const prefName=S.voicePrefs&&S.voicePrefs[gender];
  if(prefName){const pref=voices.find(v=>v.name===prefName);if(pref)return {voice:pref,matched:true};}
  const hints=gender==='f'?lang.femaleVoiceHints:lang.maleVoiceHints;
  const match=voices.find(v=>hints.some(h=>v.name.toLowerCase().includes(h)));
  return {voice:match||voices[0]||null,matched:!!match};
}

export function speak(txt,rate){
  if(!('speechSynthesis' in window))return;
  const clean=txt.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/gu,' ').replace(/\s+/g,' ').trim().substring(0,300);
  const gender=chars[R.cur]?.gender||'m';
  const {voice,matched}=pickVoice(gender);
  if(!voice)return;
  const u=new SpeechSynthesisUtterance(clean);u.lang=lang.ttsLocale;u.rate=rate||.88;u.voice=voice;
  u.pitch=matched?1:(gender==='f'?1.25:0.92);
  window.speechSynthesis.cancel();window.speechSynthesis.speak(u);
}
export function speakFromBtn(btn){const t=btn.dataset.txt;const rate=btn.dataset.rate?parseFloat(btn.dataset.rate):undefined;if(t)speak(t,rate);}

export function setVoicePref(gender,name){S.voicePrefs[gender]=name||'';saveS();}
export function testVoice(gender){
  const name=S.voicePrefs[gender];
  const voice=name?langVoices().find(v=>v.name===name):null;
  const u=new SpeechSynthesisUtterance(gender==='f'?lang.ui.ttsTestFemale:lang.ui.ttsTestMale);
  u.lang=lang.ttsLocale;u.rate=.88;
  if(voice)u.voice=voice;
  window.speechSynthesis.cancel();window.speechSynthesis.speak(u);
}
