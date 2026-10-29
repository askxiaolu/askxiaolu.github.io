import {answerQuestion} from '../lib/rag.mjs';
import {reserveQuestion,RateLimitError} from '../lib/rate-limit.mjs';
export async function readJson(request){
 const reader=request.body?.getReader();if(!reader)throw new Error('invalid_json');
 let bytes=0;const parts=[];
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>50000){await reader.cancel();throw new Error('body_too_large');}parts.push(value);}
 const all=new Uint8Array(bytes);let at=0;for(const part of parts){all.set(part,at);at+=part.length;}
 const text=new TextDecoder().decode(all);if(text.length>14000)throw new Error('body_too_large');
 try{return JSON.parse(text);}catch{throw new Error('invalid_json');}
}
export async function handleRequest(request,{env=process.env,answer=answerQuestion,reserve=reserveQuestion}={}){
 const origin=request.headers.get('origin');
 const origins=(env.ALLOWED_ORIGINS||'https://askxiaolu.github.io').split(',').map(s=>s.trim()).filter(Boolean);
 if(env.VERCEL_PROJECT_PRODUCTION_URL)origins.push(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
 const allowed=!!origin&&origins.includes(origin);
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
 if(allowed){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Methods']='POST, OPTIONS';headers['Access-Control-Allow-Headers']='Content-Type';headers['Access-Control-Max-Age']='600';}
 const send=(status,data,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,...extra}});
 // Only the canonical route is accepted; encoded and extension aliases cannot
 // evade platform rules applied to /api/chat.
 if(new URL(request.url).pathname!=='/api/chat')return send(404,{error:'没有找到这个接口。'});
 if(!allowed)return send(403,{error:'暂时无法从这个页面发起对话。'});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return send(405,{error:'请通过聊天页面提问。'});
 if(!request.headers.get('content-type')?.includes('application/json'))return send(415,{error:'请求格式不正确。'});
 if(Number(request.headers.get('content-length')||0)>50000)return send(413,{error:'问题太长啦，请简短一些。'});
 try{
  const body=await readJson(request);
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.question!=='string')return send(400,{error:'请输入一个问题。'});
  const q=body.question.trim();if(!q||q.length>1500)return send(400,{error:'请把问题控制在1500字以内。'});
  const history=(Array.isArray(body.history)?body.history:[]).slice(-6).filter(h=>h&&['user','assistant'].includes(h.role)&&typeof h.content==='string').map(h=>({role:h.role,content:h.content.slice(0,1000)}));
  return send(200,await answer(q,history,env,fetch,()=>reserve(request,env)));
 }catch(error){
  if(error instanceof RateLimitError){const minutes=Math.ceil(error.retryAfter/60);return send(429,{error:`最近两小时的提问次数用完啦，请约${minutes}分钟后再来聊～`,retry_after_seconds:error.retryAfter},{'Retry-After':String(error.retryAfter)});}
  if(error.message==='rate_limit_unavailable')return send(503,{error:'问答服务暂时维护中，稍后再来聊吧～'});
  if(error.message==='body_too_large')return send(413,{error:'问题太长啦，请简短一些。'});
  if(error.message==='invalid_json')return send(400,{error:'请求格式不正确，请刷新后再试。'});
  if(error.message==='upstream_429')return send(429,{error:'现在暂时无法继续回答，稍后再试一下吧～'});
  // Log controlled categories only, never raw upstream bodies or user text.
  console.warn('chat_request_failed',['configuration_missing','incomplete_response'].includes(error.message)?error.message:error.name==='TimeoutError'?'timeout':'request_error');
  return send(503,{error:'这次连接没有完成，稍后再试一次吧～'});
 }
}
export default {fetch:request=>handleRequest(request)};
