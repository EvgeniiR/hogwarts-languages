import { R } from './state.js';
import { S } from './state.js';
import { chars, buildSys, LV_NOTE, LEVELS } from './characters.js';
import { callModelDirect } from './llm.js';
import { safeParse, sanitizeOptions } from './chat.js';
import { esc } from './helpers.js';
import lang from './lang.js';

const MODELS = [
  {p:'deepseek',m:'deepseek-v4-flash',label:'DeepSeek V4 Flash'},
  {p:'groq',m:'','label':'Groq Llama 3.3 70B'},
  {p:'groq',m:'llama-3.1-8b-instant',label:'Groq Llama 3.1 8B'},
  {p:'openai',m:'','label':'OpenAI GPT-4.1 Mini'},
  {p:'openai',m:'gpt-4.1',label:'OpenAI GPT-4.1'},
];

export async function compareModels(){
  const el=document.getElementById('compareResults');
  const charKey=document.getElementById('compareChar')?.value||'dumbledore';
  const question=(document.getElementById('compareQuestion')?.value||'').trim();
  if(!question){el.innerHTML='<div class="compare-error">'+lang.ui.compareNoQuestion+'</div>';return;}

  const c=chars[charKey];
  const persona=c.persona.replace('{{LV}}',LV_NOTE[S.level]);
  const sys=buildSys(persona,c.shape);
  const msgs=[{role:'user',content:question}];

  const available=MODELS.filter(x=>R.keys[x.p]);
  if(!available.length){el.innerHTML='<div class="compare-error">'+lang.ui.compareNoKeys+'</div>';return;}

  el.innerHTML='<div class="compare-loading">'+lang.ui.compareSending(available.length)+'</div>';

  const results=[];
  const promises=available.map(async m=>{
    const start=Date.now();
    try{
      const {text,usage}=await callModelDirect(m.p,m.m||undefined,sys,msgs,2500);
      const parsed=await safeParse(text);
      const options=sanitizeOptions(parsed.options);
      results.push({label:m.label,provider:m.p,ok:true,reply:parsed.reply||lang.ui.compareEmptyReply,options,tokensIn:usage.in,tokensOut:usage.out,ms:Date.now()-start});
    }catch(e){
      results.push({label:m.label,provider:m.p,ok:false,error:e.message,ms:Date.now()-start});
    }
    renderCompare(el,results,available.length);
  });

  await Promise.allSettled(promises);
  renderCompare(el,results,available.length,true);
}

function renderCompare(el,results,total,done){
  const sorted=[...results].sort((a,b)=>{
    const order=['deepseek','groq','openai'];
    const ai=order.indexOf(a.provider),bi=order.indexOf(b.provider);
    return ai!==bi?ai-bi:a.label.localeCompare(b.label);
  });
  const header=`<div style="margin-bottom:8px;color:var(--mt);font-size:11px;">${done?lang.ui.compareDone:lang.ui.compareProgress}: ${results.length}/${total}</div>`;
  el.innerHTML=header+sorted.map(r=>{
    if(!r.ok)return `<div class="cr"><div class="cr-h">${esc(r.label)} <span class="cr-tok">${r.ms}ms</span></div><div class="compare-error">${esc(r.error)}</div></div>`;
    const tokens=r.tokensIn||r.tokensOut?`<span class="cr-tok">${r.tokensIn}/${r.tokensOut}</span>`:'';
    const options=r.options.length?`<div class="cr-opt">${r.options.map(o=>`<span class="cr-oc">💬 ${esc(o)}</span>`).join('')}</div>`:'';
    return `<div class="cr">
      <div class="cr-h">${esc(r.label)} <span class="cr-ms">${r.ms}ms</span> ${tokens}</div>
      <div class="cr-r">${esc(r.reply)}</div>
      ${options}
    </div>`;
  }).join('');
}
