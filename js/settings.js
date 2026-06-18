// ── SETTINGS OVERLAY ───────────────────────────────────────────────────────
// Three tabs: Voice, Model, Log. Auth management moved to splash (via "Gestionar cuentas" button).
import { S, R, saveS } from './state.js';
import { esc, showToast } from './helpers.js';
import { spanishVoices, setVoicePref, testVoice } from './tts.js';
import { achievementMetrics, ACH_LABELS, ACH_X, HP_MILESTONES, nextMilestone } from './progress.js';

let settingsTab='voice';

export function openSettings(){renderSettings();document.getElementById('settingsOv').style.display='flex';}
export function closeSettings(){document.getElementById('settingsOv').style.display='none';}
export function setSettingsTab(t){
  settingsTab=t;
  document.querySelectorAll('.settings-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));
  renderSettings();
}

export function renderSettings(){
  const el=document.getElementById('settingsContent');
  if(settingsTab==='voice'){
    const voices=spanishVoices();
    const opts=g=>'<option value="">Automático</option>'+voices.map(v=>`<option value="${esc(v.name)}" ${S.voicePrefs[g]===v.name?'selected':''}>${esc(v.name)}</option>`).join('');
    el.innerHTML=`
      <div class="svc-row"><div class="svc-lbl">Voz automática</div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--ink);">
          <input type="checkbox" ${S.ttsOff?'':'checked'} onchange="setTtsOff(!this.checked)">
          Leer respuestas en voz alta
        </label></div>
      <div class="svc-row"><div class="svc-lbl">Voz de Hermione (femenina)</div>
        <select onchange="setVoicePref('f',this.value)">${opts('f')}</select>
        <button onclick="testVoice('f')">▶ Probar</button></div>
      <div class="svc-row"><div class="svc-lbl">Voz de Dumbledore, Hagrid y Snape (masculina)</div>
        <select onchange="setVoicePref('m',this.value)">${opts('m')}</select>
        <button onclick="testVoice('m')">▶ Probar</button></div>
      ${voices.length?'':'<div class="edim">Tu navegador no expone voces en español. Prueba con Chrome o Edge.</div>'}`;
  }else if(settingsTab==='model'){
    if(R.provider==='groq'){
      const models=[['','Llama 3.3 70B (mejor calidad)'],['llama-3.1-8b-instant','Llama 3.1 8B (más rápido)']];
      el.innerHTML=`<div class="svc-row"><div class="svc-lbl">Modelo de Groq</div>
        <select onchange="setModelPref('groq',this.value)">${models.map(([v,l])=>`<option value="${v}" ${S.modelPrefs.groq===v?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
    }else if(R.provider==='openai'){
      const models=[['','GPT-4.1 Mini (buena calidad)'],['gpt-4.1','GPT-4.1 (mejor calidad, más lento)']];
      el.innerHTML=`<div class="svc-row"><div class="svc-lbl">Modelo de OpenAI</div>
        <select onchange="setModelPref('openai',this.value)">${models.map(([v,l])=>`<option value="${v}" ${S.modelPrefs.openai===v?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
    }else if(R.provider==='deepseek'){
      el.innerHTML=`<div class="svc-row"><div class="svc-lbl">Modelo de DeepSeek</div>
        <div style="font-size:12px;color:var(--ink);">DeepSeek V4 Flash</div></div>`;
    }
    el.innerHTML+=`<div class="compare-section">
      <div class="svc-lbl" style="margin-top:4px;">⚡ Comparar modelos</div>
      <select id="compareChar" style="margin-top:6px;width:100%;">
        <option value="hermione">Hermione</option>
        <option value="dumbledore" selected>Dumbledore</option>
        <option value="hagrid">Hagrid</option>
        <option value="snape">Snape</option>
      </select>
      <textarea id="compareQuestion" rows="2" style="width:100%;margin-top:6px;background:var(--bg2);border:1px solid var(--bd);color:var(--lt);padding:6px 8px;border-radius:4px;font-size:11px;resize:vertical;font-family:monospace;">Profesor Dumbledore, ¿cuál fue el momento más oscuro de su vida y qué aprendió de él?</textarea>
      <button onclick="compareModels()" class="compare-btn" style="width:100%;margin-top:6px;">⚡ Enviar a todos los modelos</button>
      <div id="compareResults" style="margin-top:8px;"></div>
    </div>`;
  }else if(settingsTab==='log'){
    renderLogTab(el);
  }
}

function renderLogTab(el){
  const log=[...R.llmLog].reverse();
  if(!log.length){
    el.innerHTML='<div class="edim">No hay consultas registradas en esta sesión. El log se borra al recargar la página.</div>';
    return;
  }
  const pvdNames={groq:'Groq',openai:'OpenAI',deepseek:'DeepSeek'};
  const rows=log.map((e,i)=>{
    const time=new Date(e.ts).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const statusIcon=e.status==='ok'?'<span style="color:#4aa020;">✓</span>':'<span style="color:#d04040;">✗</span>';
    const latency=e.latencyMs?`${e.latencyMs}ms`:'';
    const tokens=(e.tokensIn||e.tokensOut)?`<span class="log-tokens">${e.tokensIn||0}/${e.tokensOut||0}</span>`:'';
    const detail=[];
    detail.push(`[SYS] ${e.systemPrompt}`);
    e.messages.forEach(m=>detail.push(`[${m.role.toUpperCase()}] ${m.content}`));
    if(e.responseRaw)detail.push(`[RESP] ${e.responseRaw}`);
    if(e.error)detail.push(`[ERROR] ${e.error}`);
    const detailEsc=esc(detail.join('\n\n'));
    return `<div class="log-entry">
      <div class="log-summary" onclick="this.parentElement.classList.toggle('open')">
        <span class="log-time">${time}</span>
        <span class="log-pvd ${e.provider}">${pvdNames[e.provider]||e.provider}</span>
        <span class="log-status">${statusIcon}${e.attempts>1?` ×${e.attempts}`:''}</span>
        <span class="log-latency">${latency}</span>
        ${tokens}
      </div>
      <div class="log-detail" onclick="event.stopPropagation()">${detailEsc}</div>
    </div>`;
  }).join('');
  el.innerHTML=`
    <div style="font-size:11px;color:#8b6914;margin-bottom:6px;font-style:italic;">Solo esta sesión — se borra al recargar</div>
    ${rows}
    <button class="log-clear-btn" onclick="clearLog()">🗑 Limpiar log (${log.length})</button>`;
}

export function clearLog(){
  R.llmLog.length=0;
  if(document.getElementById('settingsOv').style.display==='flex')renderSettings();
  showToast('Log eliminado','#2a5018','#7acc40');
}

export function renderAchievements(){
  const el=document.getElementById('achievementsContent');
  if(!el)return;
  const metrics=achievementMetrics();
  const regularRows=Object.keys(ACH_LABELS).map(k=>{
    const {icon,name}=ACH_LABELS[k];
    const reached=S.achievements[k]||0;
    const next=nextMilestone(reached,ACH_X[k]);
    const val=metrics[k];
    const pct=Math.min(100,Math.round((val-reached)/(next-reached)*100));
    return `<div class="svc-row"><div class="svc-lbl">${icon} ${name}</div><div style="font-size:11px;color:var(--ink);margin-bottom:3px;">${val} · récord ${reached} · próximo logro: ${next}</div><div class="hg" style="border-color:var(--bdg);"><div class="hg-f" style="width:${pct}%;"></div></div></div>`;
  }).join('');
  const lp=S.lifetimePts||0;
  const milestoneRows=HP_MILESTONES.map(m=>{
    const unlocked=!!S.achievements[m.key];
    const pct=unlocked?100:Math.min(99,Math.round(lp/m.pts*100));
    const color=unlocked?'#c9a84c':'var(--mt)';
    const sub=unlocked?`${m.pts} pts — ¡conseguido!`:`${lp} / ${m.pts} pts históricos`;
    return `<div class="svc-row"><div class="svc-lbl" style="color:${color};">${m.icon} ${m.label}${unlocked?' ✓':''}</div><div style="font-size:11px;color:var(--ink);margin-bottom:3px;">${sub}</div><div class="hg" style="border-color:var(--bdg);"><div class="hg-f" style="width:${pct}%;${unlocked?'background:#c9a84c;':''}"></div></div></div>`;
  }).join('');
  el.innerHTML=`<div class="svc-lbl" style="margin-bottom:6px;color:#c9a84c;">✨ Títulos de Hogwarts</div>`+milestoneRows+`<div class="svc-lbl" style="margin-top:10px;">📊 Estadísticas</div>`+regularRows+`<div class="svc-row"><div class="svc-lbl">⚡ Puntos de por vida</div><div style="font-size:11px;color:var(--ink);margin-bottom:3px;">${lp} pts totales</div></div>`;
}

export function openAchievements(){renderAchievements();document.getElementById('achievementsOv').style.display='flex';}
export function closeAchievements(){document.getElementById('achievementsOv').style.display='none';}

export async function setModelPref(provider,v){S.modelPrefs[provider]=v;await saveS();}
export async function setTtsOff(v){S.ttsOff=v;await saveS();}

export async function validateProviderKey(provider,key){
  try{
    let res;
    if(provider==='groq'){
      res=await fetch('https://api.groq.com/openai/v1/models',{headers:{'Authorization':`Bearer ${key}`}});
    }else if(provider==='openai'){
      res=await fetch('https://api.openai.com/v1/models',{headers:{'Authorization':`Bearer ${key}`}});
    }else if(provider==='deepseek'){
      res=await fetch('https://api.deepseek.com/v1/models',{headers:{'Authorization':`Bearer ${key}`}});
    }else{
      return false;
    }
    return res.ok;
  }catch(e){return null;}
}
