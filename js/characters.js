// ── CHARACTERS ─────────────────────────────────────────────────────────────
// Character definitions, system prompts for the 4-query LLM pipeline:
//   Q1: buildSys(persona,shape) — conversation only (reply, points, mood)
//   Q2: ANALYSIS_PROMPT — vocab/mistakes/note extraction
//   Q2.5: SUMMARY_PROMPT — condense assistant reply for context
//   Q3: OPTIONS_PROMPT — suggestion chip generation
import { S } from './state.js';
import lang from './lang.js';

export const LEVELS = lang.levels;
export const LV_NOTE = lang.levelNotes;

export function buildSys(persona,shape){
  return `${lang.prompts.buildSysPrefix}\n${shape}\n\n${persona}\n\n${lang.prompts.convoRule}\n${lang.prompts.scoringRule}`;
}

export const chars = {
  hermione:{name:'Hermione Granger',house:'Gryffindor',ac:'#ae0001',bbg:'#1a0400',btxt:'#c9a84c',bbd:'#8b6914',gender:'f',
    get hints(){return lang.personas.hermione.hints;},
    get persona(){return lang.personas.hermione.persona;},
    shape:`{"reply":"[YOUR RESPONSE HERE]","points":5,"mood":2,"challengeDone":false}`},
  dumbledore:{name:'Albus Dumbledore',house:'Order of the Phoenix',ac:'#2030a0',bbg:'#0a0a20',btxt:'#9090d0',bbd:'#2a2870',gender:'m',
    get hints(){return lang.personas.dumbledore.hints;},
    get persona(){return lang.personas.dumbledore.persona;},
    shape:`{"reply":"[YOUR RESPONSE HERE]","points":7,"mood":2,"challengeDone":false}`},
  hagrid:{name:'Rubeus Hagrid',house:'Hogwarts',ac:'#5a9e20',bbg:'#061006',btxt:'#7acc40',bbd:'#1a3a10',gender:'m',
    get hints(){return lang.personas.hagrid.hints;},
    get persona(){return lang.personas.hagrid.persona;},
    shape:`{"reply":"[YOUR RESPONSE HERE]","points":4,"mood":2,"challengeDone":false}`},
  snape:{name:'Severus Snape',house:'Slytherin',ac:'#7a6a90',bbg:'#040a06',btxt:'#b0d0b0',bbd:'#1a3020',gender:'m',
    get hints(){return lang.personas.snape.hints;},
    get persona(){return lang.personas.snape.persona;},
    shape:`{"reply":"[YOUR RESPONSE HERE]","points":6,"mood":1,"challengeDone":false}`}
};

export const OPTIONS_PROMPT = lang.prompts.optionsPrompt;
export const ANALYSIS_PROMPT = lang.prompts.analysisPrompt;
export const SUMMARY_PROMPT = lang.prompts.summaryPrompt;

export function getSys(k){
  const c=chars[k];
  const persona=c.persona.replace('{{LV}}',LV_NOTE[S.level]);
  const today=new Date().toISOString().slice(0,10);
  const ck=k+'_'+today;
  if(S.challengeDone[ck])return buildSys(persona,c.shape);
  const ch=S.challenges[today]?.[k];
  const chalLine=ch?`\nDaily challenge: "${ch.challenge}". Set challengeDone:true if the student's message fulfils it.`:'';
  return buildSys(persona,c.shape)+chalLine;
}
