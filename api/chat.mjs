import {answerQuestion} from '../lib/rag.mjs';
export default {async fetch(request){
 const origins=(process.env.ALLOWED_ORIGINS||'https://askxiaolu.github.io').split(',').map(s=>s.trim());
 const origin=request.headers.get('origin');
 const production=process.env.VERCEL_PROJECT_PRODUCTION_URL;
 if(production)origins.push(`https://${production}`);
 const same=origin===new URL(request.url).origin;
 const allowed=!!origin&&(origins.includes(origin)||same);
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
 if(allowed){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Methods']='POST, OPTIONS';headers['Access-Control-Allow-Headers']='Content-Type';}
 const send=(s,data)=>new Response(JSON.stringify(data),{status:s,headers});
 if(!allowed)return send(403,{error:'暂时无法从这个页面发起对话。'});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return send(405,{error:'请通过聊天页面提问。'});
 if(!request.headers.get('content-type')?.includes('application/json'))return send(415,{error:'请求格式不正确。'});
 if(Number(request.headers.get('content-length')||0)>50000)return send(413,{error:'问题太长啦，请简短一些。'});
 try{
  const text=await request.text();if(text.length>14000)return send(413,{error:'问题太长啦，请简短一些。'});
  const body=JSON.parse(text);const q=String(body.question||'').trim();
  if(!q||q.length>1500)return send(400,{error:'请把问题控制在1500字以内。'});
  const history=(Array.isArray(body.history)?body.history:[]).slice(-6).filter(h=>h&&['user','assistant'].includes(h.role)&&typeof h.content==='string').map(h=>({role:h.role,content:h.content.slice(0,1000)}));
  return send(200,await answerQuestion(q,history,process.env));
 }catch(error){console.warn('chat_request_failed',String(error.message).replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,80));return send(503,{error:'这次连接没有完成，稍后再试一次吧～'});}
}};
