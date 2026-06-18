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

export async function callLLM(systemPrompt, messages, maxTokens, effort){
  const entry={
    ts:Date.now(),
    provider:R.provider,
    systemPrompt:systemPrompt||'(sin prompt)',
    messages,
    maxTokens,
    effort:effort||'',
    status:'pending'
  };
  R.llmLog.push(entry);
  if(R.llmLog.length>50)R.llmLog.shift();
  const fn=()=>{
    if(R.provider==='gemini')return callGemini(systemPrompt,messages,maxTokens);
    if(R.provider==='groq')return callGroq(systemPrompt,messages,maxTokens);
    if(R.provider==='openai')return callOpenAI(systemPrompt,messages,maxTokens);
    if(R.provider==='deepseek')return callDeepseek(systemPrompt,messages,maxTokens);
    return callAnthropic(systemPrompt,messages,maxTokens,effort);
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

async function callAnthropic(systemPrompt, messages, maxTokens, effort){
  const key=R.keys.anthropic;
  const headers={'Content-Type':'application/json'};
  if(key){headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';headers['anthropic-dangerous-direct-browser-access']='true';}
  if(messages.length>1){
    const i=messages.length-2;
    messages=messages.map((m,idx)=>idx===i?{...m,content:[{type:'text',text:m.content,cache_control:{type:'ephemeral'}}]}:m);
  }
  const model=S.modelPrefs.anthropic||'claude-opus-4-8';
  const body={model,max_tokens:maxTokens,messages};
  if(systemPrompt)body.system=[{type:'text',text:systemPrompt,cache_control:{type:'ephemeral'}}];
  // Effort controls token spend (low|medium|high|xhigh|max). It lives in
  // output_config, NOT inside `thinking`. The old `thinking:{type:'enabled',
  // effort}` shape returns 400 on Opus 4.8 (manual thinking unsupported).
  // Haiku does not support the effort parameter, so skip it there.
  if(effort&&!/haiku/.test(model))body.output_config={effort};
  const res=await fetchWithTimeout('https://api.anthropic.com/v1/messages',{method:'POST',headers,body:JSON.stringify(body)});
  const data=await res.json();
  throwIfBad(res,data);
  return {text:data.content.filter(b=>b.type==='text').map(b=>b.text).join(''),usage:{in:data.usage?.input_tokens||0,out:data.usage?.output_tokens||0}};
}

async function callGeminiModel(systemPrompt, messages, maxTokens, model){
  const contents=messages.map(m=>({
    role:m.role==='assistant'?'model':'user',
    parts:[{text:m.content}]
  }));
  const body={contents,generationConfig:{maxOutputTokens:maxTokens,temperature:0.9}};
  if(systemPrompt)body.systemInstruction={parts:[{text:systemPrompt}]};
  const res=await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':R.keys.gemini},body:JSON.stringify(body)
  });
  const data=await res.json();
  throwIfBad(res,data);
  return {text:data.candidates?.[0]?.content?.parts?.map(p=>p.text).join('')||'',usage:{in:data.usageMetadata?.promptTokenCount||0,out:data.usageMetadata?.candidatesTokenCount||0}};
}
let geminiFlashDownUntil=0, geminiFlashFailCount=0;
async function callGemini(systemPrompt, messages, maxTokens){
  const preferred=S.modelPrefs.gemini||'gemini-2.5-flash';
  if(preferred==='gemini-2.5-flash-lite'||Date.now()<geminiFlashDownUntil){
    return await callGeminiModel(systemPrompt, messages, maxTokens, 'gemini-2.5-flash-lite');
  }
  try{
    const result=await callGeminiModel(systemPrompt, messages, maxTokens, preferred);
    geminiFlashFailCount=0;
    return result;
  }catch(e){
    if(e.status===429){
      geminiFlashFailCount++;
      geminiFlashDownUntil=geminiFlashFailCount===1?Date.now()+60000:Infinity;
      return await callGeminiModel(systemPrompt, messages, maxTokens, 'gemini-2.5-flash-lite');
    }
    throw e;
  }
}

async function callGroq(systemPrompt, messages, maxTokens){
  const msgs=[];
  if(systemPrompt)msgs.push({role:'system',content:systemPrompt});
  msgs.push(...messages);
  const res=await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${R.keys.groq}`},
    body:JSON.stringify({model:S.modelPrefs.groq||'llama-3.3-70b-versatile',messages:msgs,max_tokens:maxTokens,temperature:0.9,response_format:{type:'json_object'}})
  });
  const data=await res.json();
  throwIfBad(res,data);
  return {text:data.choices?.[0]?.message?.content||'',usage:{in:data.usage?.prompt_tokens||0,out:data.usage?.completion_tokens||0}};
}

async function callOpenAI(systemPrompt, messages, maxTokens){
  const msgs=[];
  if(systemPrompt)msgs.push({role:'system',content:systemPrompt});
  msgs.push(...messages);
  const res=await fetchWithTimeout('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${R.keys.openai}`},
    body:JSON.stringify({model:S.modelPrefs.openai||'gpt-4.1-mini',messages:msgs,max_tokens:maxTokens,temperature:0.9})
  });
  const data=await res.json();
  throwIfBad(res,data);
  return {text:data.choices?.[0]?.message?.content||'',usage:{in:data.usage?.prompt_tokens||0,out:data.usage?.completion_tokens||0}};
}

async function callDeepseek(systemPrompt, messages, maxTokens){
  const msgs=[];
  if(systemPrompt)msgs.push({role:'system',content:systemPrompt});
  msgs.push(...messages);
  const res=await fetchWithTimeout('https://api.deepseek.com/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${R.keys.deepseek}`},
    body:JSON.stringify({model:S.modelPrefs.deepseek||'deepseek-v4-flash',messages:msgs,max_tokens:maxTokens,temperature:0.9,thinking:{type:'disabled'},response_format:{type:'json_object'}})
  });
  const data=await res.json();
  throwIfBad(res,data);
  return {text:data.choices?.[0]?.message?.content||'',usage:{in:data.usage?.prompt_tokens||0,out:data.usage?.completion_tokens||0}};
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
  if (provider === 'anthropic'){
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages',{
      method:'POST', headers:{'Content-Type':'application/json','x-api-key':R.keys.anthropic,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:'claude-haiku-4-5-20251001', max_tokens:300, messages:[{role:'user',content:msg}]})
    });
    const data = await res.json();
    return data.content?.filter(b=>b.type==='text').map(b=>b.text).join('')||'';
  }
  if (provider === 'gemini'){
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`,{
      method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':R.keys.gemini},
      body:JSON.stringify({contents:[{role:'user',parts:[{text:msg}]}], generationConfig:{maxOutputTokens:300, temperature:0}})
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.map(p=>p.text).join('')||'';
  }
  return '';
}
