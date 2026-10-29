import type { TranslatedPagesCopy } from "./types";

/**
 * Simplified Chinese (zh-CN) copy for the translated pages under `/zh`. See
 * {@link TranslatedPagesCopy} for the English sources it mirrors. The landing
 * page body lives in `components/home/home-copy-zh.tsx`.
 *
 * Style: mainland conventions, full-width punctuation, a space between Han
 * characters and Latin words or numbers, and no em dashes.
 */
export const PAGES_COPY_ZH: TranslatedPagesCopy = {
  listSeparator: "、",
  end: "。",
  home: {
    title: "契约优先、默认安全的 TypeScript REST API 框架，为 AI 辅助开发团队打造",
    documentTitle: "契约优先、默认安全的 TypeScript REST API",
    description:
      "默认安全配置，生产环境遇到已知错误配置时拒绝启动，零运行时依赖，并从一份路由契约生成 OpenAPI 3.1 文档和类型化客户端。",
    keywords: [
      "DaloyJS 中文",
      "TypeScript 框架",
      "TypeScript REST API",
      "默认安全",
      "OpenAPI 3.1",
      "类型化客户端",
      "供应链安全",
      "零依赖",
      "MCP 服务器",
    ],
    ogFooter: null,
  },
  about: {
    title: "关于 DaloyJS",
    description:
      "DaloyJS 是什么、由谁维护，以及这个契约优先、默认安全的开源 TypeScript 框架如何授权与发布。",
    keywords: ["关于 DaloyJS", "DaloyJS 团队", "DaloyJS 维护者", "Devlin Duldulao"],
    heading: "关于 DaloyJS",
    paragraphs: [
      "DaloyJS 是一个契约优先、可跨运行时移植的 TypeScript Web 框架。一份路由定义就是校验、OpenAPI 3.1、类型化客户端和 HTTP 处理函数的唯一事实来源。运行时没有任何 npm 依赖，默认提供安全配置（请求体大小限制、请求超时、请求头清理、JWT 算法白名单、恒定时间比较、防原型污染的解析器，以及可选的防 SSRF fetch 封装），同一个应用可以在 Node.js、Bun、Deno、Cloudflare Workers 和 Vercel 上运行。",
      "本项目以 MIT 许可证开源。框架以 @daloyjs/core 发布到 npm，并以 @daloyjs/daloy 发布到 JSR，两者来自同一份 TypeScript 源码。使用 pnpm create daloy@latest 即可创建新应用。源码、问题跟踪、更新日志和安全策略都在 GitHub 仓库 github.com/daloyjs/daloy 中。",
      "Daloy 在他加禄语中意为“流动”，读作 da-loy。这个名字提醒我们：请求、响应、契约、类型和生成的客户端应当沿着同一条流动前进，而不是在各层之间各自漂移。关于名字的更多说明见 /zh/about-the-name。",
      "DaloyJS 由常驻挪威的菲律宾全栈开发者 Devlin Duldulao 与志愿贡献者共同维护。这是一个软件项目，而不是设有对外办公室的注册公司。技术问题、赞助和安全报告都请通过联系页面提交。文档中的快速开始、安装和教程已译为中文；其余技术文档和博客为英文。",
    ],
    more: {
      label: "更多：",
      links: [
        { href: "/zh/contact", label: "联系我们" },
        { href: "/zh/privacy", label: "隐私" },
        { href: "/zh/about-the-name", label: "名字的由来" },
        { href: "/zh/docs", label: "中文文档" },
      ],
      lastSeparator: "，以及",
    },
  },
  aboutTheName: {
    title: "名字的由来",
    description:
      "Daloy 是什么意思、如何发音，以及这个 TypeScript 框架为什么选用这个意为“流动”的他加禄语名字。",
    keywords: ["Daloy 含义", "Daloy 发音", "DaloyJS 名字", "他加禄语 流动"],
    heading: "名字的由来",
    body: (
      <>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          <span className="font-medium text-foreground">Daloy</span>{" "}
          在他加禄语中意为<strong>“流动”</strong>。我们读作{" "}
          <strong>da-loy</strong>。
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          贝贝因文字写法{" "}
          <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔ </span>
          是项目标识的一部分，但在实际使用中，框架的名字依然简单：
          <strong className="text-foreground">DaloyJS</strong>。
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          这个名字与产品相契合：请求、响应、契约、类型和生成的客户端都沿着同一条契约优先的流动前进，而不是在不同的层之间各自分离。
        </p>
      </>
    ),
  },
  contact: {
    title: "联系 DaloyJS",
    description:
      "DaloyJS 的电子邮件、GitHub issue 和私密安全漏洞报告渠道，以及如何联系项目维护者。",
    keywords: ["联系 DaloyJS", "DaloyJS 邮箱", "DaloyJS 安全联系方式", "daloyjs@gmail.com"],
    heading: "联系 DaloyJS",
    paragraphs: [
      "联系 DaloyJS 维护者最快的方式是发送电子邮件至 daloyjs@gmail.com。文档错误、版本问题、赞助以及任何与安全漏洞无关的事项都可以使用这个地址。该邮箱以英文处理。本网站没有电话，也没有在线聊天；电子邮件才是真正能联系到人的渠道。",
      "如需报告缺陷、咨询 API 问题或提出功能请求，请在 GitHub 的 github.com/daloyjs/daloy 上提交 issue。issue 公开、可搜索，并与代码关联，对产品工作来说比私人收件箱更适合作为存档。欢迎提交 pull request，前提是附带测试，并且不削弱任何默认安全设置。",
      "如需报告疑似安全漏洞，请不要在公开 issue 中披露利用细节。请使用 GitHub 的私密漏洞报告功能 github.com/daloyjs/daloy/security/advisories/new，或发送邮件至 daloyjs@gmail.com，提供足以复现问题的信息，概念验证不要超出必要的规模。安全策略、受支持的版本和修复时限见仓库中的 SECURITY.md 以及 /.well-known/security.txt。",
      "如果你想确认本网站与以下账号属于同一个项目，可以查看这些社交与软件包主页：GitHub（github.com/daloyjs/daloy）、npm（@daloyjs/core）、JSR（@daloyjs/daloy）、Open Collective（opencollective.com/daloyjs）、X/Twitter（@daloyjs）、Bluesky（daloyjs.dev）、Mastodon（@daloyjs@mastodon.social）以及 dev.to/daloyjs。/zh/privacy 上的隐私政策说明了你访问本网站时我们会收集哪些信息。",
    ],
    directLabel: "直接链接：",
    issues: "GitHub issue",
    advisory: "私密安全公告",
    privacyLabel: "。隐私：",
  },
  privacy: {
    title: "DaloyJS 隐私政策",
    description:
      "daloyjs.dev 网站会收集哪些数据、哪些服务商处理网站流量，以及如何就隐私问题联系维护者。",
    keywords: ["DaloyJS 隐私", "daloyjs.dev 隐私政策", "DaloyJS 分析统计"],
    heading: "DaloyJS 隐私政策",
    updated: "最后更新：2026 年 10 月 29 日",
    appliesTo: "适用于",
    courtesy: {
      before: "本页是为方便阅读提供的译文。如有出入，以",
      link: "英文版本",
      after: "为准。",
    },
    paragraphs: [
      "本隐私政策适用于 daloyjs.dev 上的 DaloyJS 宣传与文档网站，不适用于你使用 @daloyjs/core 框架构建的应用：那些应用属于你，你是其用户数据的控制者。本网站是一个静态文档站点，没有用户账号、没有登录、没有付费结账，也没有存放访客信息的服务器端数据库。",
      "当你加载页面时，我们会收到任何 HTTPS 服务器都能看到的请求元数据：IP 地址、用户代理、请求的 URL 和来源页面。网站托管和分发运行在 Vercel 上。Vercel 可能会处理这些元数据，用于运营服务、抵御滥用并生成汇总的流量统计。我们还加载了 Vercel Analytics 和 Vercel Speed Insights，用于衡量访问量和 Core Web Vitals，不会建立单独的广告画像。Google Analytics（媒体资源 G-DSBFBZT7RQ）用于汇总的流量报告。位于 /mcp 的文档 MCP 服务器会在 Vercel Analytics 中统计有多少搜索使用了英语以外的语言，以及这些搜索是否找到了页面；它不会保存或发送搜索内容、你的 IP 地址或 cookie。这些服务商作为本网站的数据处理者。我们不出售个人数据，不使用再营销像素，也不会把访客数据加入任何营销名单。",
      "网站会通过 next-themes 在浏览器中保存一项主题偏好（浅色、深色或跟随系统），以免重新加载时界面闪烁。位于 /sw.js 的 service worker 可能会缓存你之前打开过的页面，供 /offline 离线页面使用。这两者都只保存在你的设备上。如果你给 daloyjs@gmail.com、GitHub 或 Open Collective 发送消息，该消息适用相应第三方的条款和保留规则；我们只在回复你或保留安全记录所需的期限内保存往来信件。",
      "由于维护者常驻挪威，我们以欧洲数据保护规则作为自我要求的基准，尽管这只是一个小型开源项目。你可以发送邮件至 daloyjs@gmail.com，询问我们持有你的哪些信息、要求删除往来信件或反对分析统计。你也可以在浏览器中屏蔽分析脚本，或者通过 Markdown（Accept: text/markdown）或 /llms.txt 阅读本网站，而无需运行我们的 JavaScript。本政策最后更新于 2026 年 10 月 29 日。如有重大变更，我们会在此注明新版本的日期。",
    ],
    questions: "隐私问题：",
    otherContact: "。其他联系方式：",
  },
  docsIndex: {
    title: "中文文档",
    description:
      "用中文开始使用 DaloyJS：安装、第一条契约优先的路由，以及一个完整的教程。其余文档目前为英文。",
    keywords: ["DaloyJS 文档", "DaloyJS 中文", "TypeScript API 教程", "DaloyJS 快速开始"],
    heading: "中文文档",
    intro:
      "这些页面带你从一个空文件夹走到一个有类型、经过测试的 API。它们译自英文原版文档；其余技术文档（安全、适配器、API 参考等）目前只有英文版。",
  },
};
