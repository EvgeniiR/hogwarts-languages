// ── STATE ──────────────────────────────────────────────────────────────────
// `S` = persisted app state (saved to storage). Only ever mutated in place,
//       never reassigned, so `import {S}` gives every module the live object.
// `R` = ephemeral runtime/session state shared across modules. Holds mutable
//       primitives (current character, active provider, in-memory API keys)
//       that several modules read AND write — wrapped in an object so plain
//       `import {R}` reflects cross-module mutations (ES import bindings are
//       read-only for importers, so a bare exported `let` would not).
import { kvGet, kvSet } from './storage.js';
import { srsInit } from './srs.js';

export let S = {
  vocab:[],mistakes:[],grammar:[],
  weeklyPts:0,dailyEarned:0,currentWeek:'',lastActiveDate:'',lifetimePts:0,
  totalMsgs:0,streak:{count:0,lastDate:null},level:0,
  moods:{hermione:2,dumbledore:2,hagrid:2,snape:2},
  hist:{hermione:[],dumbledore:[],hagrid:[],snape:[]},
  challenges:{},challengeDone:{},challengesCompleted:0,
  voicePrefs:{f:'',m:''},modelPrefs:{groq:'',openai:'',deepseek:''},
  achievements:{streak:0,msgs:0,vocab:0,challenges:0,pts:0,reading:0},
  levelWindow:[],gameDifficulty:'medium',readingDifficulty:'medium',musicOff:false,ttsOff:false,
  repairProvider:'groq',
  lastChar:'hermione',
  currentHints:{},
  readingArticles:[],readingCompleted:0,readingCompletedIds:{},
  _updatedAt:0,
  version:2
};

export const R = {
  cur:'hermione',
  provider:'groq',            // 'groq' | 'openai' | 'deepseek'
  keys:{groq:'',openai:'',deepseek:''},
  cachedCreds:{},
  loading:false,
  llmLog:[]                   // session-only LLM query log (cleared on reload)
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
export const HIST_CAP = 25;
// True after first mergeAndSync completes — gates pushState in saveS()
// so we never push stale/empty state to cloud before the first sync.
export let _syncComplete = false;

export async function saveS(){
  try{
    S._updatedAt = Date.now();
    const d={...S,
      hist:Object.fromEntries(Object.entries(S.hist).map(([k,v])=>[k,v.filter(m=>!m.error).slice(-HIST_CAP)])),
      grammar:S.grammar.slice(-80),mistakes:S.mistakes.slice(-60),vocab:S.vocab.slice(-200),
      challenges:pruneOldDates(S.challenges,14),challengeDone:pruneOldDates(S.challengeDone,14),
      readingArticles:(S.readingArticles||[]).slice(-10)};
    const keptIds=new Set((S.readingArticles||[]).map(a=>a.id));
    d.readingCompletedIds=Object.fromEntries(Object.entries(S.readingCompletedIds||{}).filter(([id])=>keptIds.has(id)));
    await kvSet('hp_v1',JSON.stringify(d));
    // Push to cloud only after initial mergeAndSync has completed.
    if (_syncComplete && typeof window !== 'undefined') {
      try { import('./sync.js').then(m => m.pushState()).catch(() => {}); } catch (_) {}
    }
  }catch(e){console.error('saveS failed',e);if(_onSaveError)_onSaveError(e);}
}

export async function loadS(){
  try{
    const str=await kvGet('hp_v1');
    if(str){
      const d=JSON.parse(str);
      if(d.vocab)S.vocab=d.vocab;if(d.mistakes)S.mistakes=d.mistakes;if(d.grammar)S.grammar=d.grammar;
      if(d.weeklyPts!==undefined)S.weeklyPts=d.weeklyPts;else if(d.pts)S.weeklyPts=d.pts;
      if(d.dailyEarned!==undefined)S.dailyEarned=d.dailyEarned;
      if(d.currentWeek!==undefined)S.currentWeek=d.currentWeek;
      if(d.lastActiveDate!==undefined)S.lastActiveDate=d.lastActiveDate;
      if(d.totalMsgs!==undefined)S.totalMsgs=d.totalMsgs;if(d.streak)S.streak=d.streak;
      if(d.level!==undefined)S.level=d.level;if(d.moods)S.moods=d.moods;
      if(d.hist)S.hist={hermione:[],dumbledore:[],hagrid:[],snape:[],...d.hist};
      if(d.challenges){S.challenges=d.challenges;Object.keys(S.challenges).forEach(k=>{if(typeof S.challenges[k]==='string')delete S.challenges[k];});}
      if(d.challengeDone)S.challengeDone=d.challengeDone;
      if(d.voicePrefs)S.voicePrefs=d.voicePrefs;
      if(d.modelPrefs)S.modelPrefs={...S.modelPrefs,...d.modelPrefs};
      if(d.currentHints)S.currentHints={hermione:[],dumbledore:[],hagrid:[],snape:[],...d.currentHints};
      if(d.lifetimePts!==undefined)S.lifetimePts=d.lifetimePts;
      if(d.achievements)S.achievements={streak:0,msgs:0,vocab:0,challenges:0,pts:0,...d.achievements};
      if(d.levelWindow)S.levelWindow=d.levelWindow;
      if(d.gameDifficulty!==undefined)S.gameDifficulty=d.gameDifficulty;
      if(d.readingDifficulty!==undefined)S.readingDifficulty=d.readingDifficulty;
      if(d.musicOff!==undefined)S.musicOff=d.musicOff;
      if(d.ttsOff!==undefined)S.ttsOff=d.ttsOff;
      if(d.repairProvider!==undefined)S.repairProvider=d.repairProvider;
      if(d.lastChar!==undefined)S.lastChar=d.lastChar;
      // Persistent challenge counter (BUGFIX): the old metric counted
      // S.challengeDone, which is pruned to 14 days, so the achievement bar
      // slid backward over time. Seed the new counter from the best evidence
      // we have of past completions.
      const doneNow=Object.values(S.challengeDone).filter(Boolean).length;
      S.challengesCompleted=Math.max(d.challengesCompleted||0,(S.achievements.challenges||0),doneNow);
      if(d.readingArticles) S.readingArticles = d.readingArticles;
      if(d.readingCompleted !== undefined) S.readingCompleted = d.readingCompleted;
      if(d.readingCompletedIds) S.readingCompletedIds = d.readingCompletedIds;
      if(d._updatedAt !== undefined) S._updatedAt = d._updatedAt;
    }
  }catch(e){console.warn('loadS falló — estado corrupto o almacenamiento inaccesible',e);}
  S.version=2;
  const now=Date.now();
  S.vocab.forEach(v=>{if(!v.ts)v.ts=now;srsInit(v);});
  S.mistakes.forEach(m=>{if(!m.ts)m.ts=now;});
  S.grammar.forEach(g=>{if(!g.ts)g.ts=now;});
  // Block on merge with remote — prevents saveS() from bumping _updatedAt mid-sync.
  // _syncComplete gate: only true when mergeAndSync actually resolved
  // (auto-resolution or user choice). If it returns {resolved:false} or
  // throws, _syncComplete stays false and saveS() won't push to cloud.
  try {
    const syncM = await import('./sync.js');
    const result = await syncM.mergeAndSync();
    _syncComplete = !!(result && result.resolved);
  } catch (_) { /* _syncComplete stays false */ }

  // ── Online re-sync ──────────────────────────────────────────────────────
  // If the initial mergeAndSync failed (offline / push_failed_proceed_anyway),
  // _syncComplete stays false and saveS() never pushes.  Register a one-shot
  // online listener that retries mergeAndSync so the user doesn't need a
  // manual page reload.  Registered at the end of loadS() so it only fires
  // after the initial sync attempt — the one-shot self-removal + _syncComplete
  // guard prevent parallel runs.
  const _onReconnect = async () => {
    window.removeEventListener('online', _onReconnect);
    if (_syncComplete) return;
    try {
      const syncM = await import('./sync.js');
      const result = await syncM.mergeAndSync();
      _syncComplete = !!(result && result.resolved);
    } catch (_) { /* keep _syncComplete as-is */ }
  };
  window.addEventListener('online', _onReconnect);
}
