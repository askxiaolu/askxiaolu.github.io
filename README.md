# Ask Xiaolu · GitHub管理，Vercel运行问答接口

GitHub Pages发布前端；Vercel从同一仓库自动部署Node云函数。仅适用于当前已确定的服务范围（OpenAI支持地区）。

## 首次连接

1. 在Vercel导入本仓库，框架选择Other，构建命令留空，输出目录留默认，Node 22。
2. 在Vercel秘密环境变量设置OPENAI_API_KEY、OPENAI_PROJECT_ID、OPENAI_VECTOR_STORE_ID，普通变量ALLOWED_ORIGINS设为https://askxiaolu.github.io。值不提交GitHub。
3. 使用已完成索引的向量库，云函数不会上传、重建或删除知识库。
4. 部署后把生产域名https://...vercel.app填入site-config.js的ASKXIAOLU_API_BASE。
5. 仓库Settings → Pages选择GitHub Actions。主分支更新后自动发布前端，Vercel Git集成自动更新后端。

## 限制

模型固定gpt-6-luna，每次最多1000输出tokens、一次File Search。范围校验和链接白名单在服务端执行。OpenAI项目的1 USD月度硬限制和6 RPM/30,000 TPM继续生效；平台执行可能有短暂延迟。

云函数不使用本地文件或内存作为全局费用计数器。当前以OpenAI项目硬限制作为整体费用控制。CORS是浏览器来源校验，不等于身份认证或完整防刷机制；公开大规模推广前应增加持久限流/人机验证。CHAT_ENABLED=0可关闭付费调用。

## 管理

- index.html、site-config.js：公开前端。
- api/chat.mjs、lib/：问答云函数和来源校验。
- .github/workflows/check.yml：提交时执行离线检查，不调用付费API。
- .github/workflows/pages.yml：只上传前端静态文件到GitHub Pages。
- .env.example：变量名称示例，没有真实Key。

`npm test`只运行模拟上游的离线测试。API Key只放Vercel的秘密变量，不上传本地private/目录、成本账本、来源截图或备份。
小鹿学姐的个人网站 · 科研日常、AI 工具与学习分享
