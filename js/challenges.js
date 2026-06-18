// ── DAILY CHALLENGES ───────────────────────────────────────────────────────
// Generates a batch of 4 character-specific challenges per day (one LLM call).
// Results cached in S.challenges[YYYY-MM-DD]. Completion tracked in
// S.challengeDone['charKey_YYYY-MM-DD'] and the persistent S.challengesCompleted.
import { S, R, saveS } from './state.js';
import { chars, LEVELS } from './characters.js';
import { callLLM } from './llm.js';
import { aResize, extractJSON, showToast } from './helpers.js';

export const CHALLENGE_PROMPT=`You are a creative Spanish-language teacher and Harry Potter super-fan.
Today is {{DATE}}. Generate exactly 4 daily role-play challenges for the app Hogwarts Español,
where a {{LEVEL}} learner practises by chatting with four characters.

Character themes and difficulty:
- hermione (nivel {{LEVEL}}): investigación en la biblioteca, hechizos, preparación de exámenes, normas de Hogwarts — vocabulario académico
- dumbledore (un poco más difícil que {{LEVEL}}): dilemas morales, acertijos, sabiduría, reflexiones filosóficas — estructuras complejas
- hagrid (más fácil que {{LEVEL}} — frases cortas, vocabulario básico): criaturas mágicas, alimentar/domesticar animales, el bosque
- snape (más difícil que {{LEVEL}}): pociones, castigos, disculpas formales, defender decisiones — registro formal, gramática exigente

Each challenge is a short mission the user must accomplish entirely in Spanish.
The challenge text (in Spanish) is shown to the user before they start.

Generate exactly one challenge per character (4 total). Output ONLY a JSON array:
[{"character":"hagrid","challenge":"Cuéntale a Hagrid cuál es tu criatura mágica favorita y por qué la encuentras fascinante.","focus":"el verbo 'gustar/encantar' y adjetivos básicos","exampleOpener":"Hagrid, me encantan los hipogrifos porque son muy valientes."},{"character":"snape","challenge":"Convence al Profesor Snape de que tu Poción Multijugos salió mal por culpa de los ingredientes, no por un error tuyo.","focus":"dar excusas y disculpas formales (condicional / imperfecto de subjuntivo)","exampleOpener":"Profesor, quisiera explicarle que los ingredientes estaban en mal estado."}]

Rules:
- character must be exactly one of: hermione, dumbledore, hagrid, snape — one each
- challenge: 1-2 sentences in Spanish describing the mission
- focus: the main grammar or vocabulary point to practise (in Spanish), calibrated to each character's difficulty level
- exampleOpener: a natural Spanish opening phrase for the user
- Hagrid's challenge must use simpler vocabulary and shorter sentences than the overall level; Snape's must be noticeably more demanding
- Include a mix of scenarios across the 4 characters: asking for help, persuading, recounting, apologising, describing, making plans
- Use authentic Harry Potter lore (pociones, criaturas, hechizos, tareas del Torneo de los Tres Magos, contraseñas de salas comunes, castigos)
- Challenges should feel like mini-quests, not classroom exercises
- Today is {{DATE}} — make today's challenges fresh and different from a typical day
- Output ONLY the JSON array — no markdown, no explanation`;

export function renderChallengeUI(k){
  const ck=k+'_'+new Date().toISOString().slice(0,10);
  const done=!!S.challengeDone[ck];
  const chal=document.querySelector('.chal');
  if(chal)chal.style.display=done?'none':'';
  const lbl=document.querySelector('.chal-lbl');
  if(lbl)lbl.textContent=done?'✅ Desafío completado':'⭐ Desafío del día';
}

export function updateChalTxt(k){
  const today=new Date().toISOString().slice(0,10);
  const c=S.challenges[today]?.[k];
  const focusEl=document.getElementById('chalFocus');
  const opEl=document.getElementById('chalOpener');
  if(c){
    document.getElementById('chalTxt').textContent=c.challenge;
    if(focusEl)focusEl.textContent=c.focus?'📌 '+c.focus:'';
    if(opEl){
      opEl.textContent=c.exampleOpener?'💬 '+c.exampleOpener:'';
      opEl.title=c.exampleOpener?'Clic para insertar en el cuadro de texto':'';
      opEl.style.textDecoration=c.exampleOpener?'underline dotted':'none';
      opEl.onclick=c.exampleOpener?()=>{const ta=document.getElementById('ui');ta.value=c.exampleOpener;aResize(ta);ta.focus();opEl.classList.add('opener-flash');setTimeout(()=>opEl.classList.remove('opener-flash'),400);}:null;
    }
  }else{
    document.getElementById('chalTxt').textContent='Cargando tu desafío…';
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
  document.getElementById('chalTxt').innerHTML='<span class="mem-loading">Generando desafíos de hoy</span>';
  try{
    const raw=await callLLM(null,[{role:'user',content:CHALLENGE_PROMPT.replace(/\{\{LEVEL\}\}/g,LEVELS[S.level]).replace(/\{\{DATE\}\}/g,today)}],800,'low');
    const arr=extractJSON(raw);
    if(Array.isArray(arr)&&arr.length>=4){
      const map={};
      arr.forEach(c=>{if(c.character&&c.challenge&&c.exampleOpener)map[c.character]={challenge:c.challenge,focus:c.focus||'',exampleOpener:c.exampleOpener};});
      if(Object.keys(map).length===4){S.challenges[today]=map;saveS();}
    }
  }catch(e){
    challengesLoading=false;
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

export function retryChallenges(){genDailyChallenges();}
