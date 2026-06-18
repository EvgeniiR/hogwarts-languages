// ── LLM ROUTER ─────────────────────────────────────────────────────────────
// Unified entry point `callLLM` routes to the active provider (R.provider),
// with a small retry loop for transient errors. Each provider call reads its
// API key from R.keys and model override from S.modelPrefs.
import { R, S } from './state.js';

function throwIfBad(res,data){
  if(!res.ok||data.error){
    const err=new Error((data.error&&data.error.message)||`HTTP ${res.status}`);
    err.status=res.status;throw err;
  }
}

function isRetryable(err){
  if(err?.name==='AbortError')return false; // request timed out — don't retry
  const status=err&&err.status;
  return status!==401&&status!==403; // don't retry on invalid/unauthorized key
}

function fetchWithTimeout(url,opts,ms=30000){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),ms);
  return fetch(url,{...opts,signal:ctrl.signal}).finally(()=>clearTimeout(timer));
}

export async function callLLM(systemPrompt, messages, maxTokens){
  const entry={
    ts:Date.now(),
    provider:R.provider,
    systemPrompt:systemPrompt||'(sin prompt)',
    messages,
    maxTokens,
    status:'pending'
  };
  R.llmLog.push(entry);
  if(R.llmLog.length>50)R.llmLog.shift();
  const fn=()=>{
    if(R.provider==='groq')return callGroq(systemPrompt,messages,maxTokens);
    if(R.provider==='openai')return callOpenAI(systemPrompt,messages,maxTokens);
    return callDeepseek(systemPrompt,messages,maxTokens);
  };
  const delays=[1000,2000];
  let attempts=0;
  for(let attempt=0;;attempt++){
    attempts=attempt+1;
    try{
      const result=await fn();
      entry.status='ok';entry.responseRaw=result.text;entry.tokensIn=result.usage.in;entry.tokensOut=result.usage.out;entry.latencyMs=Date.now()-entry.ts;entry.attempts=attempts;
      return result.text;
    }
    catch(e){
      if(attempt>=delays.length||!isRetryable(e)){
        entry.status='error';entry.error=e.message;entry.latencyMs=Date.now()-entry.ts;entry.attempts=attempts;
        throw e;
      }
      await new Promise(r=>setTimeout(r,delays[attempt]));
    }
  }
}


async function callGroq(systemPrompt, messages, maxTokens, modelOverride){
  const msgs=[];
  if(systemPrompt)msgs.push({role:'system',content:systemPrompt});
  msgs.push(...messages);
  const res=await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${R.keys.groq}`},
    body:JSON.stringify({model:modelOverride||S.modelPrefs.groq||'llama-3.3-70b-versatile',messages:msgs,max_tokens:maxTokens,temperature:0.9,response_format:{type:'json_object'}})
  });
  const data=await res.json();
  throwIfBad(res,data);
  return {text:data.choices?.[0]?.message?.content||'',usage:{in:data.usage?.prompt_tokens||0,out:data.usage?.completion_tokens||0}};
}

async function callOpenAI(systemPrompt, messages, maxTokens, modelOverride){
  const msgs=[];
  if(systemPrompt)msgs.push({role:'system',content:systemPrompt});
  msgs.push(...messages);
  const res=await fetchWithTimeout('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${R.keys.openai}`},
    body:JSON.stringify({model:modelOverride||S.modelPrefs.openai||'gpt-4.1-mini',messages:msgs,max_tokens:maxTokens,temperature:0.9})
  });
  const data=await res.json();
  throwIfBad(res,data);
  return {text:data.choices?.[0]?.message?.content||'',usage:{in:data.usage?.prompt_tokens||0,out:data.usage?.completion_tokens||0}};
}

async function callDeepseek(systemPrompt, messages, maxTokens, modelOverride){
  const msgs=[];
  if(systemPrompt)msgs.push({role:'system',content:systemPrompt});
  msgs.push(...messages);
  const res=await fetchWithTimeout('https://api.deepseek.com/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${R.keys.deepseek}`},
    body:JSON.stringify({model:modelOverride||S.modelPrefs.deepseek||'deepseek-v4-flash',messages:msgs,max_tokens:maxTokens,temperature:0.9,thinking:{type:'disabled'},response_format:{type:'json_object'}})
  });
  const data=await res.json();
  throwIfBad(res,data);
  return {text:data.choices?.[0]?.message?.content||'',usage:{in:data.usage?.prompt_tokens||0,out:data.usage?.completion_tokens||0}};
}

// Direct model call — bypasses callLLM router and log. Used for model comparison
// where we need explicit provider+model without touching R.provider or S.modelPrefs.
export async function callModelDirect(provider, model, sys, msgs, maxTokens){
  if(provider==='groq')return callGroq(sys,msgs,maxTokens,model);
  if(provider==='openai')return callOpenAI(sys,msgs,maxTokens,model);
  if(provider==='deepseek')return callDeepseek(sys,msgs,maxTokens,model);
  throw new Error('unknown provider: '+provider);
}

// One-shot JSON repair — fires on safeParse failure. Tries Groq first,
// then falls back to the main conversation provider (S.repairProvider controls this).
export async function repairJSON(raw){
  const entry = {
    ts:Date.now(), provider:'', systemPrompt:'(repairJSON)',
    messages:[{role:'user',content:raw.slice(0,800)}],
    maxTokens:300, effort:'repair', status:'pending'
  };
  R.llmLog.push(entry);
  if(R.llmLog.length>50)R.llmLog.shift();
  const result = await _tryRepairProviders(raw, entry);
  if (!result) {
    entry.status='error';entry.error='all providers failed';entry.latencyMs=Date.now()-entry.ts;entry.attempts=1;
  }
  return result;
}

async function _tryRepairProviders(raw, entry){
  const msg = `Convierte este texto en un objeto JSON válido con los campos reply, note, vocab, mistakes, options, points, mood, challengeDone. Responde SOLO con el JSON, sin explicaciones ni backticks:\n\n${raw.slice(0,2000)}`;
  // Determine which providers to try based on user preference
  const useGroq = S.repairProvider !== '';  // '' = "use main provider only"
  const mainProvider = R.provider;
  const toTry = [];
  if (useGroq && mainProvider !== 'groq') toTry.push('groq');
  toTry.push(mainProvider);
  for (const p of toTry) {
    if (!R.keys[p]) continue;
    entry.provider = p;
    try {
      const result = await _repairWith(p, msg);
      if (result) {
        entry.status='ok';entry.responseRaw=result;entry.latencyMs=Date.now()-entry.ts;entry.attempts=1;
        return result;
      }
    } catch(e) { /* try next */ }
  }
  return '';
}

async function _repairWith(provider, msg){
  if (provider === 'groq' || provider === 'openai' || provider === 'deepseek'){
    const endpoint = provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const model = provider === 'groq' ? 'llama-3.1-8b-instant' : provider === 'deepseek' ? 'deepseek-v4-flash' : (S.modelPrefs.openai||'gpt-4.1-mini');
    const body={model, max_tokens:300, temperature:0, messages:[{role:'user',content:msg}]};
    if(provider==='deepseek')body.thinking={type:'disabled'};
    const res = await fetchWithTimeout(endpoint,{
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${R.keys[provider]}`},
      body:JSON.stringify(body)
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content||'';
  }
  return '';
}
