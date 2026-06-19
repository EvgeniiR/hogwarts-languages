// ── DAILY CHALLENGES ───────────────────────────────────────────────────────
// Generates a batch of 4 character-specific challenges per day (one LLM call).
// Results cached in S.challenges[YYYY-MM-DD]. Completion tracked in
// S.challengeDone['charKey_YYYY-MM-DD'] and the persistent S.challengesCompleted.
import { S, R, saveS } from './state.js';
import { chars, LEVELS } from './characters.js';
import { callLLM } from './llm.js';
import { aResize, extractJSON, showToast } from './helpers.js';

export const CHALLENGE_SYS = `You are a creative Spanish-language teacher and Harry Potter super-fan.
Generate daily role-play challenges where the learner practises Spanish by chatting with characters.

Character themes and difficulty:
- hermione (at the learner's level): biblioteca, hechizos, exámenes, normas — vocabulario académico
- dumbledore (slightly harder): dilemas morales, acertijos, sabiduría, reflexiones filosóficas — estructuras complejas
- hagrid (easier — short sentences, basic vocab): criaturas mágicas, alimentar animales, el bosque
- snape (harder): pociones, castigos, disculpas formales — registro formal, gramática exigente

Rules:
- Exactly one challenge per character (4 total)
- challenge: 1-2 sentences in Spanish describing a mini-mission
- focus: the main grammar/vocabulary point to practise (in Spanish)
- exampleOpener: a natural Spanish opening phrase the user can say
- Hagrid must use simpler vocabulary; Snape must be noticeably more demanding
- Mix scenarios: asking for help, persuading, recounting, apologising, describing, making plans
- Use authentic Harry Potter lore
- Challenges should feel like mini-quests, not classroom exercises
- Output ONLY a clean JSON array — no text before or after, no markdown, no explanation`;

const CHALLENGE_USER = `Today is {{DATE}}. Generate exactly 4 challenges for a {{LEVEL}} learner. Output ONLY this JSON object:
{"challenges":[{"character":"hagrid","challenge":"Cuéntale a Hagrid cuál es tu criatura mágica favorita y por qué la encuentras fascinante.","focus":"el verbo 'gustar/encantar' y adjetivos básicos","exampleOpener":"Hagrid, me encantan los hipogrifos porque son muy valientes."},{"character":"snape","challenge":"Convence al Profesor Snape de que tu Poción Multijugos salió mal por culpa de los ingredientes, no por un error tuyo.","focus":"dar excusas y disculpas formales (condicional / imperfecto de subjuntivo)","exampleOpener":"Profesor, quisiera explicarle que los ingredientes estaban en mal estado."}]}
Make today's challenges fresh and different from a typical day.`;

export function renderChallengeUI(k){
  const ck=k+'_'+new Date().toISOString().slice(0,10);
  const done=!!S.challengeDone[ck];
  const chal=document.querySelector('.chal');
  if(chal)chal.style.display=done?'none':'';
  const lbl=document.querySelector('.chal-lbl');
  if(lbl)lbl.textContent=done?'✅ Desafío completado':'⭐ Desafío del día';
}

function updateChalTxt(k){
  const today=new Date().toISOString().slice(0,10);
  const c=S.challenges[today]?.[k];
  const chalEl=document.getElementById('chalTxt');
  const focusEl=document.getElementById('chalFocus');
  const opEl=document.getElementById('chalOpener');
  if(c){
    chalEl.classList.remove('mem-loading');
    chalEl.style.fontStyle='';
    chalEl.textContent=c.challenge;
    if(focusEl)focusEl.textContent=c.focus?'📌 '+c.focus:'';
    if(opEl){
      opEl.textContent=c.exampleOpener?'💬 '+c.exampleOpener:'';
      opEl.title=c.exampleOpener?'Clic para insertar en el cuadro de texto':'';
      opEl.style.textDecoration=c.exampleOpener?'underline dotted':'none';
      opEl.onclick=c.exampleOpener?()=>{const ta=document.getElementById('ui');ta.value=c.exampleOpener;aResize(ta);ta.focus();opEl.classList.add('opener-flash');setTimeout(()=>opEl.classList.remove('opener-flash'),400);}:null;
    }
  }else{
    chalEl.classList.add('mem-loading');
    chalEl.style.fontStyle='normal';
    chalEl.textContent='Cargando tu desafío…';
    if(focusEl)focusEl.textContent='';
    if(opEl){opEl.textContent='';opEl.onclick=null;opEl.style.cursor='';}
  }
}

let challengesLoading=false;

export async function genDailyChallenges(){
  const today=new Date().toISOString().slice(0,10);
  if(S.challenges[today]&&Object.keys(S.challenges[today]).length===4){
    updateChalTxt(R.cur);renderChallengeUI(R.cur);return;
  }
  if(challengesLoading)return;
  challengesLoading=true;
  const chalEl=document.getElementById('chalTxt');
  chalEl.classList.remove('mem-loading');
  chalEl.style.fontStyle='';
  chalEl.innerHTML='<span class="mem-loading">Generando desafíos de hoy</span>';
  try{
    const raw=await callLLM(CHALLENGE_SYS,[{role:'user',content:CHALLENGE_USER.replace(/\{\{LEVEL\}\}/g,LEVELS[S.level]).replace(/\{\{DATE\}\}/g,today)}],800);
    const parsed=extractJSON(raw);
    const arr=parsed.challenges||parsed;
    if(Array.isArray(arr)&&arr.length>=4){
      const map={};
      arr.forEach(c=>{if(c.character&&c.challenge&&c.exampleOpener)map[c.character]={challenge:c.challenge,focus:c.focus||'',exampleOpener:c.exampleOpener};});
      if(Object.keys(map).length===4){S.challenges[today]=map;await saveS();}
    }
  }catch(e){
    challengesLoading=false;
    document.getElementById('chalTxt').classList.remove('mem-loading');
    document.getElementById('chalTxt').style.fontStyle='';
    document.getElementById('chalTxt').textContent='No disponible';
    const el=document.getElementById('chalFocus');if(el)el.textContent='';
    const op=document.getElementById('chalOpener');
    if(op){op.textContent='🔄 Reintentar';op.style.cursor='pointer';op.onclick=()=>retryChallenges();op.style.textDecoration='underline dotted';}
    const lbl=document.querySelector('.chal-lbl');if(lbl)lbl.textContent='⭐ Desafío del día';
    return;
  }
  challengesLoading=false;
  updateChalTxt(R.cur);renderChallengeUI(R.cur);
}

function retryChallenges(){genDailyChallenges();}
