// ── STATE ──────────────────────────────────────────────────────────────────
// `S` = persisted app state (saved to storage). Only ever mutated in place,
//       never reassigned, so `import {S}` gives every module the live object.
// `R` = ephemeral runtime/session state shared across modules. Holds mutable
//       primitives (current character, active provider, in-memory API keys)
//       that several modules read AND write — wrapped in an object so plain
//       `import {R}` reflects cross-module mutations (ES import bindings are
//       read-only for importers, so a bare exported `let` would not).
import { kvGet, kvSet } from './storage.js';

export let S = {
  vocab:[],mistakes:[],grammar:[],
  weeklyPts:0,dailyEarned:0,currentWeek:'',lastActiveDate:'',lifetimePts:0,
  totalMsgs:0,streak:{count:0,lastDate:null},level:0,
  moods:{hermione:2,dumbledore:2,hagrid:2,snape:2},
  hist:{hermione:[],dumbledore:[],hagrid:[],snape:[]},
  challenges:{},challengeDone:{},challengesCompleted:0,
  voicePrefs:{f:'',m:''},modelPrefs:{anthropic:'',gemini:'',groq:'',openai:''},
  achievements:{streak:0,msgs:0,vocab:0,challenges:0,pts:0},
  levelWindow:[],gameDifficulty:'medium',musicOff:false,ttsOff:false,
  version:2
};

export const R = {
  cur:'hermione',
  provider:'groq',            // 'anthropic' | 'gemini' | 'groq' | 'openai'
  keys:{anthropic:'',gemini:'',groq:'',openai:''},
  cachedCreds:{}
};

export function pruneOldDates(obj,days){
  const cutoff=Date.now()-days*86400000;
  return Object.fromEntries(Object.entries(obj).filter(([k])=>{
    const ds=k.includes('_')?k.slice(k.lastIndexOf('_')+1):k;
    const t=new Date(ds).getTime();
    return isNaN(t)||t>=cutoff;
  }));
}

let _onSaveError=null;
export function onSaveError(cb){_onSaveError=cb;}

export async function saveS(){
  try{
    const d={...S,
      hist:Object.fromEntries(Object.entries(S.hist).map(([k,v])=>[k,v.filter(m=>!m.error).slice(-25)])),
      grammar:S.grammar.slice(-80),mistakes:S.mistakes.slice(-60),vocab:S.vocab.slice(-200),
      challenges:pruneOldDates(S.challenges,14),challengeDone:pruneOldDates(S.challengeDone,14)};
    await kvSet('hp_v1',JSON.stringify(d));
  }catch(e){if(_onSaveError)_onSaveError(e);}
}

export async function loadS(){
  try{
    const str=await kvGet('hp_v1');
    if(str){
      const d=JSON.parse(str);
      if(d.vocab)S.vocab=d.vocab;if(d.mistakes)S.mistakes=d.mistakes;if(d.grammar)S.grammar=d.grammar;
      if(d.weeklyPts!==undefined)S.weeklyPts=d.weeklyPts;else if(d.pts)S.weeklyPts=d.pts;
      if(d.dailyEarned!==undefined)S.dailyEarned=d.dailyEarned;
      if(d.currentWeek)S.currentWeek=d.currentWeek;
      if(d.lastActiveDate)S.lastActiveDate=d.lastActiveDate;
      if(d.totalMsgs)S.totalMsgs=d.totalMsgs;if(d.streak)S.streak=d.streak;
      if(d.level!==undefined)S.level=d.level;if(d.moods)S.moods=d.moods;
      if(d.hist)S.hist={hermione:[],dumbledore:[],hagrid:[],snape:[],...d.hist};
      if(d.challenges){S.challenges=d.challenges;Object.keys(S.challenges).forEach(k=>{if(typeof S.challenges[k]==='string')delete S.challenges[k];});}
      if(d.challengeDone)S.challengeDone=d.challengeDone;
      if(d.voicePrefs)S.voicePrefs=d.voicePrefs;
      if(d.modelPrefs)S.modelPrefs={...S.modelPrefs,...d.modelPrefs};
      else if(d.modelPref)S.modelPrefs.anthropic=d.modelPref;
      if(d.lifetimePts)S.lifetimePts=d.lifetimePts;
      if(d.achievements)S.achievements={streak:0,msgs:0,vocab:0,challenges:0,pts:0,...d.achievements};
      if(d.levelWindow)S.levelWindow=d.levelWindow;
      if(d.gameDifficulty)S.gameDifficulty=d.gameDifficulty;
      if(d.musicOff!==undefined)S.musicOff=d.musicOff;
      if(d.ttsOff!==undefined)S.ttsOff=d.ttsOff;
      // Persistent challenge counter (BUGFIX): the old metric counted
      // S.challengeDone, which is pruned to 14 days, so the achievement bar
      // slid backward over time. Seed the new counter from the best evidence
      // we have of past completions.
      const doneNow=Object.values(S.challengeDone).filter(Boolean).length;
      S.challengesCompleted=Math.max(d.challengesCompleted||0,(S.achievements.challenges||0),doneNow);
    }
  }catch(e){}
  S.version=2;
  const now=Date.now();
  S.vocab.forEach(v=>{if(!v.ts)v.ts=now;});
  S.mistakes.forEach(m=>{if(!m.ts)m.ts=now;});
  S.grammar.forEach(g=>{if(!g.ts)g.ts=now;});
}
