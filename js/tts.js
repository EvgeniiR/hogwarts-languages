// ── TEXT-TO-SPEECH ─────────────────────────────────────────────────────────
// Web Speech API synthesis. Picks a Spanish voice by gender (user override in
// S.voicePrefs, else a name-hint heuristic). Only works where the browser
// exposes es-* voices (Chrome/Edge).
import { R, S, saveS } from './state.js';
import { chars } from './characters.js';

const FEMALE_VOICE_HINTS=['female','mujer','mónica','monica','paulina','helena','sabina','elvira','lucia','lucía','penelope','penélope','conchita','marisol','esperanza','camila'];
const MALE_VOICE_HINTS=['male','hombre','jorge','pablo','diego','enrique','carlos','miguel','juan','raul','raúl'];

export function spanishVoices(){return window.speechSynthesis.getVoices().filter(v=>v.lang.startsWith('es'));}

export function pickVoice(gender){
  const es=spanishVoices();
  const prefName=S.voicePrefs&&S.voicePrefs[gender];
  if(prefName){const pref=es.find(v=>v.name===prefName);if(pref)return {voice:pref,matched:true};}
  const hints=gender==='f'?FEMALE_VOICE_HINTS:MALE_VOICE_HINTS;
  const match=es.find(v=>hints.some(h=>v.name.toLowerCase().includes(h)));
  return {voice:match||es[0],matched:!!match};
}

export function speak(txt,rate){
  if(!('speechSynthesis' in window))return;
  const clean=txt.replace(/[💡✨🐉📋][\s\S]{0,300}$/,'').trim().substring(0,300);
  const gender=chars[R.cur]?.gender||'m';
  const u=new SpeechSynthesisUtterance(clean);u.lang='es-ES';u.rate=rate||.88;
  const {voice,matched}=pickVoice(gender);
  if(voice)u.voice=voice;
  u.pitch=matched?1:(gender==='f'?1.25:0.92);
  window.speechSynthesis.cancel();window.speechSynthesis.speak(u);
}
export function speakFromBtn(btn){const t=btn.dataset.txt;if(t)speak(t);}

export function setVoicePref(gender,name){S.voicePrefs[gender]=name||'';saveS();}
export function testVoice(gender){
  const name=S.voicePrefs[gender];
  const voice=name?spanishVoices().find(v=>v.name===name):null;
  const u=new SpeechSynthesisUtterance(gender==='f'?'Hola, soy Hermione.':'Hola, así sueno yo.');
  u.lang='es-ES';u.rate=.88;
  if(voice)u.voice=voice;
  window.speechSynthesis.cancel();window.speechSynthesis.speak(u);
}
