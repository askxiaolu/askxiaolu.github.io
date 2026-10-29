import {readFileSync} from 'node:fs';
const registry=new Map(JSON.parse(readFileSync(new URL('./content-links.json',import.meta.url),'utf8')).contents.map(r=>[r.content_id,r]));
export const suggestions=['保研材料怎么准备？','第一次联系导师，邮件怎么写？','自我介绍怎么组织？'];
export const cleanAnswer=value=>value.replace(/filecite[^]*/g,'').replace(/\*\*([^*]+)\*\*/g,'$1').trim();
const internal=/api[\s_-]*key|密钥|内部提示词|系统提示词|系统指令|开发者指令|隐藏提示|参数量|上下文窗口|知识截止|训练数据|temperature|后台实现|底层实现|你.{0,12}(?:什么模型|哪个模型|模型名称|模型版本|哪个版本|什么版本|哪家(?:公司|厂商)|谁开发|谁提供)|(?:后台|底层|正在使用|运行的).{0,8}模型|(?:gpt|openai|claude|luna|astra).{0,10}(?:是你|你的|参数|版本)/i;
const related=/小鹿|保研|考研|复试|夏令营|推免|导师|推荐信|材料|PPT|简历|个人陈述|自我介绍|大创|科研|文献|zotero|codex|学习|英语|四六级|听力|信管|学硕|专硕|奖学金|竞赛|大学|摄影|相机|拍照|剪辑/i;
const distant=/天气|买哪只股票|推荐.{0,8}(?:股票|基金)|比特币.{0,8}(?:买|价格)|贪吃蛇|赌场|彩票|八卦|算命/i;
export function guide(status='out_of_scope',answer='这个话题离小鹿的分享有些远啦。学习、面试或科研上的问题，我更能帮上忙～'){
 return {status,answer,recommendations:[],suggested_questions:suggestions};
}
export function guard(q){
 if(internal.test(q)||/忽略.{0,12}(规则|指令|限制)|(?:system|developer)\s*:|越狱|泄露/i.test(q))return guide();
 if(/小鹿.{0,12}(手机号|电话|住址|家庭地址|私人联系方式|身份证|密码)/.test(q))return guide('insufficient','这类私人信息不在这里提供哦。可以聊聊学姐公开分享过的经验～');
 if(/^(你好|您好|嗨|hello|hi)[～~！!？?。\s]*$/i.test(q))return guide('help','嗨，欢迎你来～最近在忙些什么，有什么想聊聊的？');
 if(distant.test(q)&&!related.test(q))return guide();
 return null;
}
const schema={type:'object',properties:{status:{type:'string',enum:['answer','general','out_of_scope','help','insufficient']},answer:{type:'string'},source_content_ids:{type:'array',items:{type:'string'}},recommendations:{type:'array',items:{type:'object',properties:{content_id:{type:'string'},reason:{type:'string'}},required:['content_id','reason'],additionalProperties:false}},suggested_questions:{type:'array',items:{type:'string'}}},required:['status','answer','source_content_ids','recommendations','suggested_questions'],additionalProperties:false};
function leaksPrivateText(text,env){
 if(/\b(?:sk-[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,})/.test(text))return true;
 if(env.OPENAI_API_KEY&&text.includes(env.OPENAI_API_KEY))return true;
 const normalized=text.replace(/\s/g,'');const prompt=(env.XIAOLU_INSTRUCTIONS||'').replace(/\s/g,'');
 for(let i=0;i+64<=prompt.length;i+=16)if(normalized.includes(prompt.slice(i,i+64)))return true;
 return false;
}
export async function answerQuestion(q,history,env,fetcher=fetch,beforeModel=async()=>{}){
 const canned=guard(q);if(canned)return canned;
 if(env.CHAT_ENABLED!=='1')return guide('insufficient','小站正在整理维护中，稍后再来找我聊吧～');
 if(!env.OPENAI_API_KEY||!env.OPENAI_PROJECT_ID||!env.OPENAI_VECTOR_STORE_ID||!env.XIAOLU_INSTRUCTIONS)throw new Error('configuration_missing');
 await beforeModel();
 const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json','OpenAI-Project':env.OPENAI_PROJECT_ID},body:JSON.stringify({model:'gpt-6-luna',instructions:env.XIAOLU_INSTRUCTIONS,input:[...history.map(h=>({role:h.role,content:h.content})),{role:'user',content:q}],reasoning:{effort:'none'},max_output_tokens:1000,max_tool_calls:1,store:false,service_tier:'default',tools:[{type:'file_search',vector_store_ids:[env.OPENAI_VECTOR_STORE_ID],max_num_results:8}],include:['file_search_call.results'],text:{format:{type:'json_schema',name:'xiaolu_answer',strict:true,schema}}})});
 if(!response.ok)throw new Error(`upstream_${response.status}`);
 const data=await response.json();if(data.status!=='completed')throw new Error('incomplete_response');
 const calls=(data.output||[]).filter(o=>o.type==='file_search_call');
 const raw=(data.output||[]).filter(o=>o.type==='message').flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
 const p=JSON.parse(raw);
 const ids=new Set([...calls.flatMap(c=>c.results||[]).map(r=>r.text||'').join('\n').matchAll(/(?:content_id|关联作品ID)[：:\s]+([a-f0-9]{24}|xiaolu_profile)/g)].map(m=>m[1]));
 const recs=Array.isArray(p.recommendations)?p.recommendations:[];
 const sourceIds=Array.isArray(p.source_content_ids)?p.source_content_ids:[];
 const cited=[...sourceIds,...recs.map(r=>r?.content_id)];
 const valid=['answer','general','out_of_scope','help','insufficient'].includes(p.status)&&typeof p.answer==='string'&&p.answer.length<=1800&&recs.length<=5&&cited.every(id=>ids.has(id)&&(registry.has(id)||id==='xiaolu_profile'));
 if(!valid||leaksPrivateText(JSON.stringify(p),env))return guide('insufficient','这次的回答还不够可靠，我先不猜啦。你可以换个更具体的问法～');
 if(p.status==='answer'&&!calls.length)return guide('insufficient','暂时没有查到足够的依据，你可以补充一点背景，我再帮你找找～');
 if(p.status==='general'&&!calls.length&&/小鹿(?:学姐)?(?:说过|建议|认为|提到|指出)/.test(p.answer))return guide('insufficient','这部分暂时没有找到小鹿分享过的依据，可以聊聊你具体想解决的学习或面试问题～');
 const suggested=(Array.isArray(p.suggested_questions)?p.suggested_questions:[]).filter(s=>typeof s==='string').slice(0,3).map(s=>s.slice(0,120));
 if(['help','out_of_scope'].includes(p.status))return {status:p.status,answer:cleanAnswer(p.answer),recommendations:[],suggested_questions:suggested.length?suggested:suggestions};
 const unique=[...new Map(recs.filter(r=>registry.has(r.content_id)).map(r=>[r.content_id,r])).values()];
 return {status:p.status,answer:cleanAnswer(p.answer),recommendations:unique.map(r=>({content_id:r.content_id,reason:String(r.reason).slice(0,140),title:registry.get(r.content_id).title,kind:registry.get(r.content_id).kind,url:registry.get(r.content_id).url})),suggested_questions:suggested};
}
