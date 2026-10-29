import test from 'node:test';
import assert from 'node:assert/strict';
import {clientKey,reserveQuestion,RateLimitError,LIMIT,WINDOW_MS} from '../lib/rate-limit.mjs';
import {handleRequest} from '../api/chat.mjs';
import {answerQuestion} from '../lib/rag.mjs';

const env={VERCEL:'1',CHAT_ENABLED:'1',RATE_LIMIT_SECRET:'fixture-secret-for-offline-testing-only',UPSTASH_REDIS_REST_URL:'https://fixture.upstash.io',UPSTASH_REDIS_REST_TOKEN:'fixture-token',XIAOLU_INSTRUCTIONS:'offline fixture',OPENAI_API_KEY:'fixture',OPENAI_PROJECT_ID:'project',OPENAI_VECTOR_STORE_ID:'store'};
const request=(ip='192.0.2.1',q='保研怎么准备？')=>new Request('https://service.example/api/chat',{method:'POST',headers:{Origin:'https://askxiaolu.github.io','Content-Type':'application/json','x-vercel-forwarded-for':ip},body:JSON.stringify({question:q})});
test('IP keys are canonical and contain neither raw IP nor question',()=>{
 const key=clientKey(request(),env);assert.match(key,/^xiaolu:chat:ip:v1:[a-f0-9]{64}$/);assert.ok(!key.includes('192.0.2.1'));
 assert.equal(key,clientKey(request('::ffff:192.0.2.1'),env));
 assert.equal(clientKey(request('2001:0db8:0000:0000:0000:0000:0000:0001'),env),clientKey(request('2001:db8::1'),env));
 assert.notEqual(key,clientKey(request('192.0.2.2'),env));
 assert.notEqual(key,clientKey(request(),{...env,RATE_LIMIT_SECRET:'a-different-fixture-secret-at-least-32-chars'}));
});
test('missing trusted identity or secret fails closed',async()=>{
 for(const ip of ['','unknown','192.0.2.1, 192.0.2.2'])await assert.rejects(()=>reserveQuestion(request(ip),env,()=>assert.fail('no network')),/rate_limit_unavailable/);
 assert.throws(()=>clientKey(request(),{...env,VERCEL:undefined}),/rate_limit_unavailable/);
 assert.throws(()=>clientKey(request(),{...env,RATE_LIMIT_SECRET:''}),/rate_limit_unavailable/);
});
test('reservation carries only hashed identity and server-generated values',async()=>{
 const bodies=[];
 const fetcher=async(url,options)=>{assert.equal(url,env.UPSTASH_REDIS_REST_URL+'/');bodies.push(JSON.parse(options.body));assert.equal(options.redirect,'error');return Response.json({result:[1,0]});};
 await reserveQuestion(request(),env,fetcher);await reserveQuestion(request(),env,fetcher);
 assert.equal(bodies[0][0],'EVAL');assert.equal(bodies[0][2],1);assert.equal(bodies[0][4],WINDOW_MS);assert.equal(bodies[0][5],LIMIT);assert.equal(LIMIT,30);assert.equal(WINDOW_MS,7200000);
 assert.notEqual(bodies[0][6],bodies[1][6]);assert.doesNotMatch(JSON.stringify(bodies),/192\.0\.2\.1|保研/);
});
test('counter denial becomes retryable error; provider faults cannot grant access',async()=>{
 await assert.rejects(()=>reserveQuestion(request(),env,async()=>Response.json({result:[0,391]})),e=>e instanceof RateLimitError&&e.retryAfter===391);
 for(const data of [{error:'provider failure'},{result:null},{result:[1]},{result:[2,0]},{result:[0,999999]}])await assert.rejects(()=>reserveQuestion(request(),env,async()=>Response.json(data)),/rate_limit_unavailable/);
 await assert.rejects(()=>reserveQuestion(request(),env,async()=>{throw Error('network');}),/rate_limit_unavailable/);
});
test('quota runs before upstream and blocks every model call on failure',async()=>{
 let modelCalls=0,reservations=0;
 const answer=(q,history,settings,_fetch,before)=>answerQuestion(q,history,settings,()=>{modelCalls++;assert.fail('must not call model');},before);
 const response=await handleRequest(request(),{env,answer,reserve:async()=>{reservations++;throw new RateLimitError(391);}});
 assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'391');assert.equal((await response.json()).retry_after_seconds,391);assert.equal(reservations,1);assert.equal(modelCalls,0);
 const unavailable=await handleRequest(request(),{env,answer,reserve:async()=>{throw Error('rate_limit_unavailable');}});assert.equal(unavailable.status,503);assert.equal(modelCalls,0);
});
test('free greetings and maintenance do not consume a model quota',async()=>{
 const reserve=async()=>assert.fail('no reservation');
 assert.equal((await handleRequest(request('192.0.2.1','你好'),{env,reserve})).status,200);
 assert.equal((await handleRequest(request(),{env:{...env,CHAT_ENABLED:'0'},reserve})).status,200);
});
