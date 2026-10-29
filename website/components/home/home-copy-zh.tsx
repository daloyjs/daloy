import type { BenchmarkChartsCopy } from "@/components/benchmark-charts";
import type { HomeCopy } from "./home-copy";

const HELLO_WORLD = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

// new App() 已经自动应用 requestId() 和 secureHeaders()；
// 这里的显式调用只用于自定义（并替换）默认配置。
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // 默认按客户端 IP 计数；位于代理之后时，请设置 behindProxy 或 keyGenerator

app.get(
  "/books/:id",
  {
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "已找到", body: z.object({ id: z.string(), title: z.string() }) },
      404: { description: "未找到" },
    },
  },
  async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`图书 \${params.id}\` },
  }),
);

serve(app, { port: 3000 });`;

const MCP_SERVER_SNIPPET = `import { App, bearerAuth, createMcpHandler, mcpRoutes } from "@daloyjs/core";

const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  tools: [/* 你的工具，带有经过校验的输入 schema */],
});

const app = new App();
app.use(bearerAuth({ validate: checkToken })); // 没有认证 hook：生产环境拒绝启动
for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route); // 你的 API 现在同时也是一个 MCP 服务器
}`;

/** Chinese strings for the benchmark charts (plain data: crosses to the client). */
const BENCHMARK_CHARTS_ZH: BenchmarkChartsCopy = {
  heading: "DaloyJS 的表现如何",
  intro:
    "以下是仓库自带基准测试套件的真实数据。你可以任选一项指标查看，但请留意下方的说明，因为这些对比都不是严格意义上的同类比较。",
  tabs: {
    deps: {
      trigger: "依赖数量",
      title: "安装的传递依赖数量",
      description:
        "安装时拉进来的每一个包，都是需要有人信任的攻击面。只有 DaloyJS 和 Hono 两者不引入任何传递依赖。",
      takeaway:
        "DaloyJS 安装 0 个传递依赖，与 Hono 并列供应链攻击面最小；而一个安全配置的 NestJS 应用会带进 86 个。",
      soWhat:
        "需要信任的包越少，CVE 越少，也不会冒出意料之外的 postinstall 脚本。零依赖意味着框架本身不会在供应链上开出新的口子；其余依赖树仍然需要你自己审查。",
    },
    install: {
      trigger: "安装体积",
      title: "磁盘占用",
      description:
        "一个 hello world 应用写入 node_modules 的总兆字节数，分为最小安装和经过安全加固（安全对等）的配置。",
      takeaway:
        "DaloyJS 在磁盘上约占 2.4 MB，开启安全配置后也不会增长，因为加固能力本来就在核心中。Fastify 和 NestJS 一旦补上同等插件，体积就会明显膨胀。",
      soWhat:
        "安装体积越小，CI 越快，Docker 镜像越精简，在 serverless 和边缘环境中的冷启动也越快。",
    },
    bundle: {
      trigger: "打包体积",
      title: "打包并经 gzip 压缩后的产物",
      description:
        "单文件生产构建，经 gzip 压缩。体积越小，部署到边缘越快，冷启动也越快。",
      takeaway:
        "DaloyJS 压缩后最小配置约 61 kB，安全配置约 67 kB，仅次于 Hono，只有 Express 或 Nest 打包体积的一小部分，而且默认自带的功能更多。",
      soWhat:
        "打包体积越小，冷启动后启动越快，第一个访问你的边缘函数或 serverless 端点的用户等待时间就越短。",
    },
    throughput: {
      trigger: "吞吐量",
      title: "每秒请求数（带中间件栈）",
      description:
        "两个框架在相同路由上运行相当的中间件栈，并发 100 个连接。这才是吞吐量问题的公平版本：当双方都真正干活时，要付出多少代价？",
      takeaway:
        "在双方中间件相当的情况下，DaloyJS 在所有场景中都领先 Hono：静态路由约 25.2k 对 19.7k 请求/秒（领先约 28%），带请求体的 POST 路由约 22.5k 对 14.3k（领先约 58%），同时还用 Zod 校验了请求体。默认开启安全与校验，不再意味着输掉基准测试。",
      soWhat:
        "在框架层面，安全与校验几乎是免费的。你真正的瓶颈会是数据库和网络，而不是 DaloyJS。",
    },
  },
  seriesMinimal: "最小配置",
  seriesSecure: "安全对等",
  depsUnit: "个依赖",
  scenarios: {
    "Static route": "静态路由",
    "Dynamic route": "动态路由",
    "POST + body": "POST + 请求体",
  },
  soWhatLabel: "这对你意味着什么：",
  takeawayLabel: "结论：",
  ranAt: "2026 年 10 月",
  sourceIn: "源码位于",
  caveatsTitle: "为什么这不是同类比较",
  caveatsIntro:
    "这些框架并不是同一种工具，所以正面对比图更像是拿苹果和橙子作比较，而不是一场公平的比赛。下面用直白的话说明这些数字能证明什么、不能证明什么。",
  notes: [
    "苹果对橙子，而不是同类比较。这些工具不同，做的工作量也不同。每个请求中，DaloyJS 都会按你的 Zod 或 Valibot schema 校验请求体，并开箱即用地执行安全响应头、请求 ID、请求体大小限制和请求超时。其他框架的“最小配置”应用几乎都不做这些事，即便“安全对等”配置也很少能逐项对齐。所以 DaloyJS 的每个数字里，都有一部分是你原本需要自己实现的安全与校验工作。",
    "体积的统计方式不同：DaloyJS 是一个零依赖的单独包，而其他框架需要解析传递依赖树，其确切大小取决于 lockfile 生成的时间。",
    "吞吐量取决于负载形态：在双方中间件栈相当的情况下，DaloyJS 在这些 GET 路由上领先 Hono 约 27%，在带请求体的 POST 路由上领先约 58%，而且 DaloyJS 还额外用 Zod 校验了请求体。真实服务通常受限于数据库和 I/O 时间，而不是框架的分发开销，所以这些微观数字很少能预测生产环境的表现。",
    "目标运行时不同：有些框架（例如 Elysia）针对 Bun 做了优化，但这里为了获得公平的单一运行时基线，统一用它们的 Node 适配器测量。",
    "单台机器、单一时刻：一台 Apple M3 Max，Node v26.4.0，2026 年 10 月，@daloyjs/core 1.5.4，机器上还有其他后台负载（两个框架是先后连续测量的，因此相对比较比绝对数值更可靠）。你的硬件、运行时和版本都会改变这些数字。",
  ],
};

/** Simplified Chinese (zh-CN) landing-page copy. Mirrors `HOME_COPY_EN`. */
export const HOME_COPY_ZH: HomeCopy = {
  locale: "zh",
  links: {
    gettingStarted: "/zh/docs/getting-started",
    docs: "/zh/docs",
    installation: "/zh/docs/installation",
    tutorial: "/zh/docs/tutorials/bookstore",
    mcp: "/docs/mcp",
    openapi: "/docs/openapi",
    blog: "/blog",
  },
  hero: {
    title: "契约优先、默认安全的 TypeScript REST API，为 AI 辅助开发团队打造",
    subtitle:
      "DaloyJS 自带默认安全配置，在生产环境中遇到已知的错误配置会拒绝启动，零运行时依赖，并拥有经过加固、带来源证明签名的发布流程。没有任何框架能让应用绝对安全，也无法阻止所有供应链攻击，所以文档会写清楚哪些默认开启、哪些需要你自己开启，以及还剩哪些风险。",
    primaryCta: "开始使用：安装 Daloy",
    secondaryCta: "阅读文档",
    contentLanguageNote:
      "快速开始、安装和教程已有中文版；其余文档和博客目前只有英文版。",
    factsLabel: "项目概况",
    facts: [
      "3000 多个框架测试全部通过",
      "覆盖率门槛：行和函数 ≥90%，分支 ≥92%",
      "0 个运行时依赖",
      "Node 24 LTS、Node 26+、Bun、Deno、Cloudflare",
      "MIT 许可证",
    ],
    nameNote: (
      <>
        <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔</span> Daloy
        在他加禄语中意为<span className="text-foreground">“流动”</span>（读作{" "}
        <span className="whitespace-nowrap text-foreground">da-loy</span>）。
      </>
    ),
    aboutLabel: "关于",
    aboutHref: "/zh/about",
    nameLabel: "名字的由来",
    nameHref: "/zh/about-the-name",
    tutorialLabel: "教程：图书商店 API",
  },
  security: {
    eyebrow: "安全与供应链",
    title: "默认安全：AI 生成代码的防护层",
    body: "当代码由 AI 模型生成时，开发者的打字速度已不再是瓶颈，真正关键的是运行时安全和供应链完整性。DaloyJS 在运行时层面强制执行防护措施：请求体大小限制、超时、防原型污染、5xx 错误细节脱敏，以及启动时拒绝错误配置，而且没有可供利用的传递依赖。",
  },
  features: {
    secureDefaults: {
      title: "默认安全的运行时配置",
      body: "有些框架把基本防护交给插件或手写的错误路由，而 DaloyJS 的核心从一开始就开启了防护：请求体大小限制、请求超时、防原型污染的 JSON 解析、规范的 405 Method Not Allowed 响应，以及失败即关闭的 5xx 错误细节脱敏（除显式声明的开发或测试环境外，处处开启）。在生产环境中，它遇到已知的错误配置会拒绝启动，例如弱会话密钥，或未启用 CSRF 的会话 cookie。",
      badges: [
        "请求体限制（默认 1 MiB）",
        "请求超时",
        "原型污染防护",
        "RFC 9457 problem+json",
        "严格的 schema 校验",
        "启动时配置检查",
      ],
    },
    zeroDeps: {
      title: "零运行时依赖",
      body: "安装 @daloyjs/core 只会新增零个传递依赖包。没有需要审计的 postinstall 脚本，也不会因为你从未选择的依赖而突然冒出 CVE。框架本身不带来依赖树；应用的其他依赖仍需你自己审查。",
      stat: {
        value: "0",
        label: "@daloyjs/core 中的传递依赖包",
      },
    },
    supplyChain: {
      title: "经过供应链加固的项目模板",
      body: "在 create-daloy 中选择 pnpm，pnpm-workspace.yaml 就已经完成加固：ignoreScripts 会拦截安装脚本中的恶意负载（但拦不住导入时执行的代码），24 小时的 minimumReleaseAge 让你避开那些刚发布、并能被及时发现的恶意版本，verifyStoreIntegrity 则确保安装结果可信。可选的安全套件还会加入加固后的 GitHub Actions、Dependabot、CODEOWNERS、SECURITY.md、lockfile 来源校验、非 root 并使用 tini 的容器模板，以及用于检查生产环境配置的 daloy doctor。",
      badges: [
        "ignoreScripts",
        "24 小时 minimumReleaseAge",
        "verifyStoreIntegrity",
        "按 SHA 固定的 Actions",
        "daloy doctor 审计",
      ],
    },
    aiNative: {
      title: "为 AI 而生的项目模板",
      body: "create-daloy 创建的每个项目都包含 AGENTS.md 和上下文 skills，这些文档也可以通过 MCP 读取。读取 AGENTS.md 的编程智能体会自动掌握框架的约定、路由规则和安全原语，无需繁琐的提示词工程。",
      badges: ["自带 AGENTS.md", "上下文 skills", "可通过 MCP 读取"],
    },
    streaming: {
      title: "流式传输与可观测性",
      body: "支持背压的 SSE 和 NDJSON 工具函数，以及一个 OpenTelemetry 追踪 hook，可输出带语义约定属性的 HTTP 服务器 span。",
      badges: ["支持背压的 SSE", "NDJSON 流式传输", "OTel HTTP 服务器 span"],
    },
    portable: {
      title: "跨运行时移植",
      body: "核心只关心 Request → Response。适配器位于边缘层：Node、Bun、Deno、Cloudflare Workers、Vercel、Fastly Compute 和 AWS Lambda，同一个应用，同一套测试。",
      badges: ["Node 24+", "Bun", "Deno", "Cloudflare Workers", "Vercel", "AWS Lambda"],
    },
    contractFirst: {
      title: "以契约优先为设计原则",
      body: "一份路由定义就是校验、类型、OpenAPI 3.1、类型化客户端和内置契约测试的唯一事实来源，让不一致无处藏身。",
      badges: ["运行时校验", "OpenAPI 3.1 规范", "Hey API 类型化客户端", "内置契约测试"],
    },
    typedClients: {
      title: "Hey API 类型化客户端",
      body: "运行 pnpm gen，即可根据你真实的规范生成完全类型化的 fetch SDK，适用于任何调用方、任何 TS 项目。也可以使用进程内类型化客户端，完全跳过代码生成。",
      badges: ["pnpm gen", "零配置", "端到端类型化的 fetch SDK"],
    },
    batteries: {
      title: "开箱即用",
      body: "适用于边缘环境的会话、与 HTTP 共用同一套限流额度的 WebSocket、结构化日志和优雅停机：这些通常要靠插件拼装的生产级基础设施，这里全部自带，而且依然零运行时依赖。",
      badges: ["边缘会话", "WebSocket 限流", "结构化日志", "优雅停机"],
    },
  },
  benchmarks: {
    eyebrow: "基准测试与性能",
    title: "数字，以及附带的注意事项",
    body: "当 AI 智能体循环调用工具、以高并发发送请求时，吞吐量和冷启动延迟就变得至关重要。DaloyJS 默认开启安全检查，这些基准测试衡量的正是所有防护都开启时的性能。",
    charts: BENCHMARK_CHARTS_ZH,
  },
  mcp: {
    eyebrow: "为机器而生：面向 AI 智能体和工具",
    title: "DaloyJS 已支持 MCP",
    intro: (
      <>
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noreferrer"
          hrefLang="en"
          className="underline underline-offset-4"
        >
          Model Context Protocol
        </a>
        （MCP）是 Claude、Cursor 和 VS Code 等 AI 智能体用来调用工具、阅读文档的开放标准。DaloyJS
        两端都支持：你的应用可以成为 MCP 服务器，而本站文档（英文）本身就是一个 MCP 服务器。
      </>
    ),
    serverTitle: "把你的 API 变成 MCP 服务器",
    serverBody: (
      <>
        DaloyJS 只用 <code>@daloyjs/core</code> 就能构建 MCP 服务器，无需
        SDK：Streamable HTTP 传输、输入 schema 校验，以及一项生产环境启动保护：如果 MCP
        端点的处理链中没有认证 hook，就拒绝启动。它检查的是 hook
        是否存在，以及在生产环境中是否对每个请求都执行过，而不检查它是否真的拒绝了谁，所以也请测试你的认证逻辑。
      </>
    ),
    serverCta: "构建 MCP 服务器 →",
    serverSnippet: MCP_SERVER_SNIPPET,
    docsTitle: "通过 MCP 阅读本站文档",
    docsBody: "一个公开、只读的端点，你的 AI 编程助手可以直接搜索和阅读，无需复制粘贴，也不需要 API 密钥。",
    endpointTitle: "端点",
    endpointBody: "将任何兼容 MCP 的客户端指向这个 URL：",
    tools: {
      search_docs: "在所有文档页面中按关键词搜索，并按相关性排序。",
      get_doc: "按路由或 slug 读取某个页面的全文。",
      list_docs: "一次调用即可浏览所有可用的文档页面。",
    },
    configLabel: "添加到你的 MCP 客户端配置中",
    stdioNote: "使用仅支持 stdio 的客户端？可以这样桥接：",
  },
  contracts: {
    eyebrow: "限定影响范围",
    title: "契约是安全边界，而不是装饰性语法",
    body: "在以 AI 为先的工作流中，契约不是给人看的审美点缀，而是由机器强制执行的边界，防止幻觉出来的数据结构在组件之间泄漏。一份路由契约会严格校验请求、约束响应内容，并实时生成 OpenAPI 3.1 规范和类型化客户端。",
    flow: {
      title: "契约流",
      tagline: "定义一次 -> 其余自动生成",
      steps: [
        { label: "契约", detail: "GET /books/:id + z.object(...)" },
        { label: "校验", detail: "运行时，双向校验" },
        { label: "OpenAPI 3.1", detail: "实时规范 + /docs 界面" },
        { label: "类型化客户端", detail: "pnpm gen -> fetch SDK" },
      ],
    },
    helloWorld: HELLO_WORLD,
  },
  scalar: {
    title: "Scalar API 参考，一行搞定",
    body: (
      <>
        Scalar 是 Swagger UI 的现代继任者：快速、简洁、原生支持深色模式，并内置在线调试请求。在
        DaloyJS 中，它是<em>默认</em>的文档界面，而不是插件：在 <code>App</code>{" "}
        构造函数中设置 <code>docs: true</code>，就会自动在 <code>/docs</code>{" "}
        挂载这个页面，并在 <code>/openapi.json</code> 提供实时的 OpenAPI 3.1 规范。
      </>
    ),
    footer: "根据你的路由契约自动生成，无需额外代码。更喜欢 Swagger UI 或 Redoc？改一个配置字段即可。",
    guideCta: "OpenAPI 与文档界面指南 →",
  },
  comparison: {
    eyebrow: "生态取舍",
    title: "汲取各家所长，减少取舍",
    body: "DaloyJS 并不想只在某一项上胜出，而是想省掉开发者在各种好点子之间写胶水代码的工作。",
    youWant: "你想要",
    todayPrefix: "目前：",
    todaysBest: "目前的最佳选择",
    daloyGives: "DaloyJS 提供的",
    rows: [
      {
        want: "为你构建的应用提供可移植的供应链加固",
        best: "pnpm 默认配置 + 零运行时依赖的核心",
        give: "加固的 pnpm 安装配置、来源已校验的 lockfile、SBOM + npm 来源证明",
      },
      {
        want: "适配 serverless / 边缘环境",
        best: "Hono",
        give: "基于 Web 标准的核心，多运行时适配器",
      },
      {
        want: "成熟的 Node 运维能力与文档",
        best: "Fastify",
        give: "封装的插件、结构化日志、优雅停机",
      },
      {
        want: "现代的 TS 优先开发体验，支持 Bun",
        best: "Elysia",
        give: "端到端类型化的处理函数、上下文和客户端",
      },
      {
        want: "最好用的 OpenAPI 体验",
        best: "FastAPI",
        give: "从一份路由定义内置生成 OpenAPI 3.1",
      },
      {
        want: "最好的类型化客户端代码生成",
        best: "Hey API",
        give: "pnpm gen → 完全类型化的 fetch SDK",
      },
    ],
  },
  cta: {
    title: "准备好以默认安全的方式交付了吗？",
    body: "几秒钟就能创建项目：为你的包管理器加固安装配置，生成会拦截安装脚本的 CI，固定版本的 GitHub Actions、Dependabot、CODEOWNERS 以及 lockfile 来源校验。随着应用增长，契约始终保持一致，同一个应用可以运行在 Node、Bun、Deno 和 Cloudflare Workers 上。",
    install: "安装 DaloyJS",
    tutorial: "构建图书商店 API",
    source: "查看源码",
  },
  support: {
    eyebrow: "支持本项目",
    title: "如果 DaloyJS 帮你节省了时间，可以请我喝杯咖啡",
    body: "DaloyJS 免费且以 MIT 许可证开源。如果文档、文章或框架本身让你少折腾了一些就把东西交付了，请杯咖啡就是让这份工作继续下去的好方式。",
    coffee: "请我喝杯咖啡",
    blog: "阅读博客（英文）",
  },
};
