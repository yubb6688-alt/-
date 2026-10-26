# 种草助手

单页前端 + 零第三方运行依赖的 Node 后端。生成小红书笔记、抖音口播、详情页首屏，以及 Dify 返回的图片和视频。

## 本地运行

需要 **Node.js 22.13+**（推荐 Node.js 24 LTS）。

```sh
cp .env.example .env
# 编辑 .env，填写 DIFY_API_KEY 和 ACCESS_CODE
npm start
```

打开 http://localhost:3000。无需 npm install。开发时可用 `npm run dev` 自动重启；执行 `npm test` 运行接口与前端状态逻辑测试。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `DIFY_API_KEY` | 必填，Dify 工作流应用 API Key，只在后端使用 |
| `ACCESS_CODE` | 必填，访问口令，两个 API 均检查 `X-Access-Code` |
| `PORT` | 可选，默认 `3000` |
| `TRUST_PROXY` | 默认 `false`；仅在可信反向代理覆盖 `X-Forwarded-For`，且后端不能被绕过代理直接访问时设为 `true` |

不要把密钥写进源码或 GitHub。`.env`、数据库均已忽略；`.env.example` 只有空值。访问口令不保存在浏览器持久存储中。

## API

- `POST /api/start`：JSON `{ product, campaign, audience, want, shot }`。商品与生成内容严格匹配固定选项，人群必填且最多 60 字，镜头最多 500 字，活动最多 100 字、空值默认“双 11”。调用 Dify streaming 接口，收到第一个带 `workflow_run_id` 的 SSE 事件后取消读取并返回 `{ id }`。
- `GET /api/status?id=...`：返回 `{ status, elapsed, error, outputs }`，将 Dify 的 `elapsed_time` 映射为 `elapsed`。
- 口令错误返回 `401`；同 IP 的已认证 `/api/start` 请求在滚动 10 分钟内最多 6 次（包含无效输入与上游失败的尝试），超限返回 `429` 和 `Retry-After`。
- 限流使用 Node 内置 SQLite，存储于 `.data/limits.sqlite`，服务重启后保留计数。同一持久磁盘上的进程通过事务防止并发超限。
- 浏览器每 5 秒查询一次，查询不重叠；从提交起最多等待 6 分钟。超时只停止浏览器查询，不会自动取消后台 Dify 任务。启动上游请求 30 秒超时，查询上游请求 15 秒超时。

## Dify 输出

支持 `outputs.result`（JSON 字符串）与外层 `verdict`、`image_url`、`video_url`。`result` 结构：

```json
{
  "verdict": "自动通过",
  "rounds": 1,
  "reason": "",
  "xhs": { "title": "标题", "body": "正文", "tags": ["#话题"] },
  "douyin": { "script": "口播" },
  "detail": { "headline": "主标题", "points": ["卖点1", "卖点2", "卖点3"], "price": "价格条" },
  "image_url": "https://example.com/image.png",
  "video_url": "https://example.com/video.mp4",
  "video_desc": "视频描述",
  "error": ""
}
```

任一 verdict 为“转人工”时只显示原因，不展示内容。自动通过时显示所有文案和返回的素材；外层素材 URL 优先，内层作为补充。所有动态文字通过 `textContent` 写入，不解析 HTML；媒体只允许 HTTP/HTTPS 地址。HTTPS 上线时应让 Dify 输出 HTTPS 素材链接。素材跨域和外链访问策略由素材托管方决定。

## 部署到 Vercel

项目包含 Vercel Functions 入口（`api/start.js`、`api/status.js`），前端静态资源由 `public/` 提供。Vercel 部署使用 Upstash Redis 实现跨函数实例的每 IP 滚动窗口限流；需在 Vercel Marketplace 为项目连接 Upstash Redis，并配置 `DIFY_API_KEY`、`ACCESS_CODE`。Redis 集成提供的 REST URL/token 环境变量名称应为 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`。

部署步骤：在 Vercel 导入 GitHub 仓库，框架预设选择 Other（或接受自动识别），根目录保持仓库根目录，不填写 Build Command、Output Directory；连接 Upstash Redis，设置环境变量后部署。生产环境部署完成后用网页口令测试生成与状态轮询。

## 本地或 Docker 部署

本地和 Docker 使用常驻 Node 服务及 SQLite 限流存储。部署到普通 Node 运行平台或服务器时，启动命令为 `npm start`，绑定平台提供的 `PORT`，在平台环境变量中配置两个密钥。将 `.data` 挂载到持久磁盘，并通过 HTTPS 反向代理提供访问。

也可使用附带的 Dockerfile：

```sh
docker build -t zhongcao-assistant .
docker run --env-file .env -p 3000:3000 -v zhongcao-data:/app/.data zhongcao-assistant
```

默认按单实例部署。若扩展到多个无共享持久存储的实例，需先把限流改为共享 Redis/数据库，避免各实例分别计数。

## 文件

- `public/`：页面、响应式样式、轮询与安全结果渲染
- `server.mjs`：HTTP 静态文件与 API 入口
- `lib/api.mjs`：校验、鉴权、Dify 请求、SSE 读取
- `lib/limiter.mjs`：持久化滚动窗口限流
- `test/`：模拟 Dify 的接口测试与前端状态测试，不消耗真实生成额度

真实 Dify 端到端生成需配置有效密钥后验证。
