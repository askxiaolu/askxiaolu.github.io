import {createHmac,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';

export const LIMIT=30;
export const WINDOW_MS=120*60*1000;

// Redis executes the entire script atomically, including across concurrent
// function instances. Use its clock, not the clock of an individual instance.
export const RESERVE_SCRIPT=`
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))}
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window + 1000)
return {1, 0}
`;

export class RateLimitError extends Error {
 constructor(retryAfter){super('ip_rate_limited');this.retryAfter=retryAfter;}
}

export function clientKey(request,env){
 // This header is supplied by Vercel. Do not fall back to user-selected headers
 // such as X-Real-IP, cookies, or request JSON when it is absent.
 const ip=request.headers.get('x-vercel-forwarded-for')?.trim();
 if(env.VERCEL!=='1'||!ip||!isIP(ip)||!env.RATE_LIMIT_SECRET||env.RATE_LIMIT_SECRET.length<32)throw new Error('rate_limit_unavailable');
 let canonical=ip;
 if(isIP(ip)===6){
  canonical=new URL(`http://[${ip}]/`).hostname.slice(1,-1);
  // Map ::ffff:a.b.c.d and ordinary IPv4 to the same bucket.
  const mapped=canonical.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if(mapped){const a=parseInt(mapped[1],16),b=parseInt(mapped[2],16);canonical=`${a>>8}.${a&255}.${b>>8}.${b&255}`;}
 }
 return 'xiaolu:chat:ip:v1:'+createHmac('sha256',env.RATE_LIMIT_SECRET).update(canonical).digest('hex');
}

export async function reserveQuestion(request,env,fetcher=fetch){
 const key=clientKey(request,env);
 let url;
 const token=env.KV_REST_API_TOKEN||env.UPSTASH_REDIS_REST_TOKEN;
 try{url=new URL(env.KV_REST_API_URL||env.UPSTASH_REDIS_REST_URL);}catch{throw new Error('rate_limit_unavailable');}
 if(url.protocol!=='https:'||!url.hostname.endsWith('.upstash.io')||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!token)throw new Error('rate_limit_unavailable');
 // No automatic retry: a network timeout may happen after Redis reserved a slot.
 // Counting failed attempts conservatively avoids refund/retry abuse.
 let response,data;
 try{
  response=await fetcher(url.href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(['EVAL',RESERVE_SCRIPT,1,key,WINDOW_MS,LIMIT,randomUUID()])});
  if(!response.ok)throw new Error();
  data=await response.json();
 }catch{throw new Error('rate_limit_unavailable');}
 const result=data?.result;
 if(data.error||!Array.isArray(result)||result.length!==2||!result.every(Number.isInteger)||![0,1].includes(result[0])||result[1]<0||result[1]>WINDOW_MS/1000)throw new Error('rate_limit_unavailable');
 if(result[0]===0)throw new RateLimitError(Math.max(1,result[1]));
}
