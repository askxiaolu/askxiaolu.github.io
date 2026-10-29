import {readFileSync} from 'node:fs';
const prompt = readFileSync(new URL('./scope-prompt.md',import.meta.url),'utf8');
const registry = new Map(JSON.parse(readFileSync(new URL('./content-links.json',import.meta.url),'utf8')).contents.map(r=>[r.content_id,r]));
export const suggestions=['保研材料怎么准备？','第一次联系导师，邮件怎么写？','自我介绍PPT怎么组织？'];
export const cleanAnswer=value=>value.replace(/filecite[^]*/g,'').replace(/\*\*([^*]+)\*\*/g,'$1').trim();
const meta=/api[\s_-]*key|密钥|系统提示|系统指令|开发者指令|隐藏提示|模型|参数量|上下文窗口|知识截止|训练数据|temperature|底层实现|后台实现|你的版本|你是GPT|你由谁开发|你是谁开发|你来自哪家|openai|claude|luna|astra|token/i;
const topics=/小鹿|学姐|保研|考研|复试|夏令营|推免|导师|推荐信|材料|PPT|简历|个人陈述|排名|大创|项目经历|科研|文献|zotero|codex|英语|四六级|听力|大英赛|信管|信息管理|学硕|专硕|奖学金|竞赛|大学|帖子|图文|摄影|相机|拍照|pocket|剪辑/i;
export function guide(status='out_of_scope',answer='我主要陪你聊小鹿分享过的学习、保研和科研经验～可以从下面这些问题开始呀。'){
 return {status,answer,recommendations:[],suggested_questions:suggestions};
}
export function guard(q,history=[]){
 if(meta.test(q)||/忽略.{0,12}(规则|指令|限制)|(system|developer)\s*:|越狱|泄露/i.test(q))return guide();
 if(/小鹿.{0,12}(手机号|电话|住址|家庭地址|私人联系方式|身份证|密码)/.test(q))return guide('insufficient','这类私人信息不在这里提供哦。可以问我小鹿公开分享过的学习经验～');
 if(/^(你好|您好|嗨|hello|hi|你是谁|你能做什么|这里可以问些什么|可以问什么|怎么用)[～~！!？?。\s]*$/i.test(q))return guide('help','嗨，很高兴见到你！我可以帮你查小鹿的学习、保研与科研经验，再推荐值得细看的帖子～');
 if(/^(?:(?:你好|您好|嗨)[，,！!\s]*)?(?:我叫|我是|我目前|我现在|我在读|我来自)/.test(q)&&!/怎么|如何|想问|想了解|怎么办|能否|可以|请|什么|[？?]/.test(q))return guide('help','嗨，欢迎你来～很高兴认识你！你最近最想了解哪件事，或者想先看看小鹿哪方面的分享？');
 if(!topics.test(q)&&!(history.length&&/^(那|这个|这些|刚才|上面|还需要|还有|能再|可以再|详细|具体|先做|多久|怎么准备)/.test(q)))return guide();
 return null;
}
const schema={type:'object',properties:{status:{type:'string',enum:['answer','out_of_scope','help','insufficient']},answer:{type:'string'},source_content_ids:{type:'array',items:{type:'string'}},recommendations:{type:'array',items:{type:'object',properties:{content_id:{type:'string'},reason:{type:'string'}},required:['content_id','reason'],additionalProperties:false}},suggested_questions:{type:'array',items:{type:'string'}}},required:['status','answer','source_content_ids','recommendations','suggested_questions'],additionalProperties:false};
export async function answerQuestion(q,history,env,fetcher=fetch){
 const canned=guard(q,history);if(canned)return canned;
 if(env.CHAT_ENABLED==='0')return guide('insufficient','今天先聊到这里，稍后再来找我吧～');
 if(!env.OPENAI_API_KEY||!env.OPENAI_PROJECT_ID||!env.OPENAI_VECTOR_STORE_ID)throw new Error('configuration_missing');
 const result=await fetcher('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json','OpenAI-Project':env.OPENAI_PROJECT_ID},body:JSON.stringify({model:'gpt-6-luna',instructions:prompt,input:[...history.map(h=>({role:h.role,content:h.content})),{role:'user',content:q}],reasoning:{effort:'none'},max_output_tokens:1000,max_tool_calls:1,store:false,service_tier:'default',tools:[{type:'file_search',vector_store_ids:[env.OPENAI_VECTOR_STORE_ID],max_num_results:8}],include:['file_search_call.results'],text:{format:{type:'json_schema',name:'xiaolu_answer',strict:true,schema}}})});
 if(!result.ok)throw new Error(`upstream_${result.status}`);
 const data=await result.json();if(data.status!=='completed')throw new Error('incomplete_response');
 const calls=(data.output||[]).filter(o=>o.type==='file_search_call');
 const output=(data.output||[]).filter(o=>o.type==='message').flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
 const parsed=JSON.parse(output);
 const evidence=calls.flatMap(c=>c.results||[]).map(r=>r.text||'').join('\n');
 const ids=new Set([...evidence.matchAll(/(?:content_id|关联作品ID)[：:\s]+([a-f0-9]{24}|xiaolu_profile)/g)].map(m=>m[1]));
 const validStatus=['answer','out_of_scope','help','insufficient'].includes(parsed.status);
 const recs=Array.isArray(parsed.recommendations)?parsed.recommendations:[];
 const cited=[...(Array.isArray(parsed.source_content_ids)?parsed.source_content_ids:[]),...recs.map(r=>r.content_id)];
 const invalid=!validStatus||typeof parsed.answer!=='string'||meta.test(parsed.answer)||recs.length>5||cited.some(id=>!ids.has(id)||(!registry.has(id)&&id!=='xiaolu_profile'))||(parsed.status==='answer'&&!calls.length);
 if(invalid)return guide('insufficient','这次没找到足够可靠的依据，我先不猜啦。可以把问题再说具体一点～');
 if(parsed.status==='help'||parsed.status==='out_of_scope')return guide(parsed.status);
 const unique=[...new Map(recs.filter(r=>registry.has(r.content_id)).map(r=>[r.content_id,r])).values()];
 return {status:parsed.status,answer:cleanAnswer(parsed.answer),recommendations:unique.map(r=>({content_id:r.content_id,reason:String(r.reason).slice(0,180),title:registry.get(r.content_id).title,kind:registry.get(r.content_id).kind,url:registry.get(r.content_id).url})),suggested_questions:(parsed.suggested_questions||[]).slice(0,3)};
}
