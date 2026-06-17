// ── SETTINGS OVERLAY ───────────────────────────────────────────────────────
// Four tabs: Voice, Model, Auth/Cuenta, Logros.
import { S, R, saveS } from './state.js';
import { esc, showToast } from './helpers.js';
import { spanishVoices, setVoicePref, testVoice } from './tts.js';
import { saveCreds, clearCreds } from './credentials.js';
import { achievementMetrics, ACH_LABELS, ACH_X, HP_MILESTONES, nextMilestone } from './progress.js';

let settingsTab='voice';
let keyValidTimer=null;

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
    if(R.provider==='anthropic'){
      const models=[['','Opus 4.8 (mejor calidad)'],['claude-sonnet-4-6','Sonnet 4.6 (más económico)'],['claude-haiku-4-5-20251001','Haiku 4.5 (el más económico)']];
      el.innerHTML=`<div class="svc-row"><div class="svc-lbl">Modelo de Anthropic</div>
        <select onchange="setModelPref('anthropic',this.value)">${models.map(([v,l])=>`<option value="${v}" ${S.modelPrefs.anthropic===v?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
    }else if(R.provider==='groq'){
      const models=[['','Llama 3.3 70B (mejor calidad)'],['llama-3.1-8b-instant','Llama 3.1 8B (más rápido)']];
      el.innerHTML=`<div class="svc-row"><div class="svc-lbl">Modelo de Groq</div>
        <select onchange="setModelPref('groq',this.value)">${models.map(([v,l])=>`<option value="${v}" ${S.modelPrefs.groq===v?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
    }else if(R.provider==='gemini'){
      const models=[['','Flash 2.5 (mejor calidad)'],['gemini-2.5-flash-lite','Flash Lite 2.5 (más rápido)']];
      el.innerHTML=`<div class="svc-row"><div class="svc-lbl">Modelo de Gemini</div>
        <select onchange="setModelPref('gemini',this.value)">${models.map(([v,l])=>`<option value="${v}" ${S.modelPrefs.gemini===v?'selected':''}>${esc(l)}</option>`).join('')}
        </select><div class="edim">Flash 2.5 cambia a Flash Lite automáticamente si se alcanza el límite de velocidad.</div></div>`;
    }else if(R.provider==='openai'){
      const models=[['','GPT-4.1 Mini (buena calidad)'],['gpt-4.1','GPT-4.1 (mejor calidad, más lento)']];
      el.innerHTML=`<div class="svc-row"><div class="svc-lbl">Modelo de OpenAI</div>
        <select onchange="setModelPref('openai',this.value)">${models.map(([v,l])=>`<option value="${v}" ${S.modelPrefs.openai===v?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
    }
  }else if(settingsTab==='auth'){
    const pvdKey={groq:R.keys.groq,gemini:R.keys.gemini,anthropic:R.keys.anthropic,openai:R.keys.openai};
    const pvdLabel={groq:'Groq ✦ free',gemini:'Gemini ✦ free',anthropic:'Anthropic',openai:'OpenAI'};
    const pvdPlaceholder={groq:'gsk_...',gemini:'AIza...',anthropic:'sk-ant-api03-...',openai:'sk-proj-...'};
    const curKey=pvdKey[R.provider];
    const inpStyle=`width:100%;padding:5px;border-radius:4px;border:1px solid var(--bdg);background:#fffaf0;color:var(--ink);font-size:12px;font-family:monospace;margin-bottom:4px;`;
    const statusDiv=`<div id="keyValidStatus" style="font-size:10px;min-height:14px;margin-bottom:6px;"></div>`;
    const keyHtml=curKey
      ?`<div id="keyStatusRow" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="color:#2a8018;font-size:11px;">✓ Clave guardada</span><button onclick="document.getElementById('keyStatusRow').remove();const i=document.getElementById('authKeyInput');i.style.display='';i.focus();" style="font-size:10px;padding:2px 7px;border-radius:3px;border:1px solid var(--bdg);background:none;color:#7a5520;cursor:pointer;font-family:Cinzel,Georgia,serif;">Cambiar</button></div><input id="authKeyInput" type="password" oninput="authKeyTyped(this.value)" placeholder="${pvdPlaceholder[R.provider]}" style="display:none;${inpStyle}">${statusDiv}`
      :`<input id="authKeyInput" type="password" oninput="authKeyTyped(this.value)" placeholder="${pvdPlaceholder[R.provider]}" style="${inpStyle}">${statusDiv}`;
    el.innerHTML=`
      <div class="svc-row">
        <div class="svc-lbl">Proveedor</div>
        <div style="display:flex;gap:5px;margin-bottom:10px;">${['groq','gemini','anthropic','openai'].map(p=>{
          const active=R.provider===p;const hasK=!!pvdKey[p];
          return `<button id="spvd_${p}" onclick="setAuthProvider('${p}')" style="flex:1;padding:4px 4px;border-radius:4px;border:1px solid var(--bdg);background:${active?'rgba(139,105,20,.15)':'none'};color:${active?'#5a3000':'#7a5520'};cursor:pointer;font-family:Cinzel,Georgia,serif;font-size:9px;position:relative;">${esc(pvdLabel[p])}${hasK?'<span style="position:absolute;top:2px;right:3px;font-size:7px;color:#4a9020;">●</span>':''}</button>`;
        }).join('')}</div>
        <div class="svc-lbl">API Key</div>
        ${keyHtml}
        <div style="display:flex;gap:6px;">
          <button onclick="saveAuthFromSettings()" style="flex:1;font-size:11px;padding:5px;border-radius:3px;border:1px solid var(--bdg);background:none;color:#7a5520;cursor:pointer;font-family:Cinzel,Georgia,serif;">Guardar</button>
          <button onclick="clearAuthFromSettings()" style="font-size:11px;padding:5px 8px;border-radius:3px;border:1px solid #c05050;background:none;color:#c05050;cursor:pointer;font-family:Cinzel,Georgia,serif;">Cerrar sesión</button>
        </div>
      </div>`;
  }
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

export function setModelPref(provider,v){S.modelPrefs[provider]=v;saveS();}
export function setTtsOff(v){S.ttsOff=v;saveS();}
export function setAuthProvider(p){R.provider=p;renderSettings();}

export async function validateProviderKey(provider,key){
  try{
    let res;
    if(provider==='groq'){
      res=await fetch('https://api.groq.com/openai/v1/models',{headers:{'Authorization':`Bearer ${key}`}});
    }else if(provider==='gemini'){
      res=await fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':key}});
    }else if(provider==='openai'){
      res=await fetch('https://api.openai.com/v1/models',{headers:{'Authorization':`Bearer ${key}`}});
    }else{
      res=await fetch('https://api.anthropic.com/v1/models',{headers:{'x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'}});
    }
    return res.ok;
  }catch(e){return null;}
}

export function authKeyTyped(val){
  const st=document.getElementById('keyValidStatus');
  if(!st)return;
  clearTimeout(keyValidTimer);
  if(!val.trim()){st.textContent='';return;}
  st.textContent='⏳ Verificando…';st.style.color='#9a6520';
  keyValidTimer=setTimeout(async()=>{
    const ok=await validateProviderKey(R.provider,val.trim());
    const st2=document.getElementById('keyValidStatus');
    if(!st2)return;
    if(ok===true){st2.textContent='✓ Clave válida';st2.style.color='#2a8018';}
    else if(ok===false){st2.textContent='✗ Clave inválida';st2.style.color='#c05050';}
    else{st2.textContent='⚠ Sin conexión';st2.style.color='#9a6520';}
  },600);
}

export async function saveAuthFromSettings(){
  const keyVal=(document.getElementById('authKeyInput')?.value||'').trim();
  if(!keyVal)return;
  if(R.provider==='groq')R.keys.groq=keyVal;
  else if(R.provider==='gemini')R.keys.gemini=keyVal;
  else if(R.provider==='openai')R.keys.openai=keyVal;
  else R.keys.anthropic=keyVal;
  await saveCreds(R.provider,keyVal);
  showToast('✓ Guardado','#2a5018','#7acc40');
  renderSettings();
}
export async function clearAuthFromSettings(){
  await clearCreds(R.provider);
  location.reload();
}

