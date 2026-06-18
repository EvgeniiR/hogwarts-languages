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
    return callAnthropic(systemPrompt,messages,maxTokens,effort);
  };
  const delays=[1000,2000];
  let attempts=0;
  for(let attempt=0;;attempt++){
    attempts=attempt+1;
    try{
      const raw=await fn();
      entry.status='ok';entry.responseRaw=raw;entry.latencyMs=Date.now()-entry.ts;entry.attempts=attempts;
      return raw;
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
  return data.content.filter(b=>b.type==='text').map(b=>b.text).join('');
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
  return data.candidates?.[0]?.content?.parts?.map(p=>p.text).join('')||'';
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
    body:JSON.stringify({model:S.modelPrefs.groq||'llama-3.3-70b-versatile',messages:msgs,max_tokens:maxTokens,temperature:0.9})
  });
  const data=await res.json();
  throwIfBad(res,data);
  return data.choices?.[0]?.message?.content||'';
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
  return data.choices?.[0]?.message?.content||'';
}

// One-shot JSON repair — fires on safeParse failure. Uses Groq fast model.
export async function repairJSON(raw){
  try{
    const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${R.keys.groq}`},
      body:JSON.stringify({
        model:'llama-3.1-8b-instant',
        messages:[{role:'user',content:`Convierte este texto en un objeto JSON válido con los campos reply, note, vocab, mistakes, spells, options, points, mood, challengeDone. Responde SOLO con el JSON, sin explicaciones ni backticks:\n\n${raw.slice(0,2000)}`}],
        max_tokens:300,
        temperature:0
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content||'';
  }catch(e){return '';}
}
