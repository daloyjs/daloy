import type { BenchmarkChartsCopy } from "@/components/benchmark-charts";
import type { HomeCopy } from "./home-copy";

const HELLO_WORLD = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

// new App() já aplica requestId() e secureHeaders() automaticamente;
// estas chamadas explícitas só personalizam (e substituem) os valores padrão.
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // por IP do cliente por padrão; atrás de um proxy, configure behindProxy ou keyGenerator

app.get(
  "/books/:id",
  {
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Encontrado", body: z.object({ id: z.string(), title: z.string() }) },
      404: { description: "Não encontrado" },
    },
  },
  async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`Livro \${params.id}\` },
  }),
);

serve(app, { port: 3000 });`;

const MCP_SERVER_SNIPPET = `import { App, bearerAuth, createMcpHandler, mcpRoutes } from "@daloyjs/core";

const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  tools: [/* suas ferramentas, com schemas de entrada validados */],
});

const app = new App();
app.use(bearerAuth({ validate: checkToken })); // sem hook de autenticação, a produção se recusa a iniciar
for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route); // sua API agora também é um servidor MCP
}`;

/** Portuguese strings for the benchmark charts (plain data: crosses to the client). */
const BENCHMARK_CHARTS_PT: BenchmarkChartsCopy = {
  heading: "Como o DaloyJS se compara",
  intro:
    "Números reais da própria suíte de benchmarks do repositório. Escolha uma métrica, mas tenha em mente as ressalvas abaixo, porque nenhuma destas é uma comparação perfeitamente justa.",
  tabs: {
    deps: {
      trigger: "Dependências",
      title: "Dependências transitivas instaladas",
      description:
        "Cada pacote que a instalação puxa é uma superfície de ataque em que alguém precisa confiar. DaloyJS e Hono são os únicos dois que não trazem nenhuma.",
      takeaway:
        "O DaloyJS instala 0 dependências transitivas, empatado com o Hono como a menor superfície na cadeia de suprimentos, enquanto um aplicativo NestJS seguro traz 86.",
      soWhat:
        "Menos pacotes em que confiar significa menos CVEs e nenhum script postinstall inesperado. Zero dependências significa que o framework não abre portas próprias na cadeia de suprimentos; o restante da sua árvore de dependências continua sendo sua responsabilidade.",
    },
    install: {
      trigger: "Tamanho instalado",
      title: "Espaço ocupado em disco",
      description:
        "Total de megabytes gravados em node_modules para um aplicativo “hello world”, na versão mínima e numa configuração reforçada (paridade de segurança).",
      takeaway:
        "O DaloyJS ocupa cerca de 2,4 MB em disco e não cresce quando você ativa a segurança, porque o reforço já está no núcleo. Fastify e NestJS incham assim que você adiciona os plugins equivalentes.",
      soWhat:
        "Instalações menores significam CI mais rápida, imagens Docker mais enxutas e cold starts mais rápidos em serverless e na edge.",
    },
    bundle: {
      trigger: "Tamanho do bundle",
      title: "Saída empacotada e compactada com gzip",
      description:
        "Build de produção em um único arquivo, compactado com gzip. Quanto menor, mais rápido para fazer deploy na edge e para o cold start.",
      takeaway:
        "O DaloyJS fica com cerca de 61 kB compactado na versão mínima e cerca de 67 kB na segura, atrás apenas do Hono e com uma fração dos bundles de Express ou Nest, mesmo trazendo mais recursos por padrão.",
      soWhat:
        "Um bundle menor inicia mais rápido depois de um cold start, então o primeiro usuário que chega à sua função edge ou endpoint serverless espera menos.",
    },
    throughput: {
      trigger: "Throughput",
      title: "Requisições por segundo, com uma pilha de middlewares",
      description:
        "Os dois frameworks rodam uma pilha de middlewares comparável nas mesmas rotas, com 100 conexões. Esta é a versão justa da pergunta sobre throughput: quanto custa quando os dois lados realmente trabalham?",
      takeaway:
        "Com middlewares comparáveis dos dois lados, o DaloyJS supera o Hono em todos os cenários: cerca de 25,2k contra 19,7k requisições/s em rotas estáticas (cerca de 28% a mais) e cerca de 22,5k contra 14,3k na rota POST com corpo (cerca de 58% a mais), validando esse corpo com Zod ao mesmo tempo. Ter segurança e validação ativadas por padrão não custa mais o benchmark.",
      soWhat:
        "Segurança e validação saem praticamente de graça na camada do framework. Seu verdadeiro gargalo será o banco de dados e a rede, não o DaloyJS.",
    },
  },
  seriesMinimal: "Mínima",
  seriesSecure: "Paridade de segurança",
  depsUnit: "dependências",
  scenarios: {
    "Static route": "Rota estática",
    "Dynamic route": "Rota dinâmica",
    "POST + body": "POST + corpo",
  },
  soWhatLabel: "O que isso significa para você:",
  takeawayLabel: "Conclusão:",
  ranAt: "outubro de 2026",
  sourceIn: "código em",
  caveatsTitle: "Por que isto é comparar laranjas com maçãs",
  caveatsIntro:
    "Esses frameworks não são a mesma ferramenta, então um gráfico lado a lado se parece mais com comparar laranjas com maçãs do que com uma corrida justa. Veja, em palavras simples, o que esses números provam e o que não provam.",
  notes: [
    "Laranjas com maçãs, não uma comparação em pé de igualdade. São ferramentas diferentes fazendo quantidades diferentes de trabalho. Em cada requisição, o DaloyJS valida o corpo contra seu schema Zod ou Valibot e aplica cabeçalhos seguros, um ID de requisição, limites de tamanho do corpo e timeouts, tudo por padrão. Os aplicativos “mínimos” dos outros frameworks não fazem quase nada disso, e mesmo a “paridade de segurança” raramente equivale item por item. Então parte de cada número do DaloyJS é segurança e validação que você teria de construir por conta própria.",
    "A forma de medir o tamanho é diferente: o DaloyJS é um único pacote sem dependências, enquanto os outros resolvem árvores transitivas cujo tamanho exato depende de quando o lockfile foi gerado.",
    "O throughput depende da carga: com uma pilha de middlewares comparável dos dois lados, o DaloyJS fica cerca de 27% à frente do Hono nessas rotas GET e cerca de 58% na rota POST com corpo, e ainda valida esse corpo com Zod. Serviços reais costumam ser limitados pelo banco de dados e por I/O, não pelo despacho do framework, então esses micronúmeros raramente preveem o comportamento em produção.",
    "Runtimes-alvo diferentes: alguns frameworks (por exemplo, o Elysia) são otimizados para Bun, mas aqui são medidos com seus adaptadores de Node para ter uma base justa em um único runtime.",
    "Uma única máquina, um único momento: um Apple M3 Max, Node v26.4.0, outubro de 2026, com @daloyjs/core 1.5.4 e outra carga em segundo plano na máquina (os dois frameworks foram medidos um logo após o outro, então a comparação se sustenta melhor do que os números absolutos). Seu hardware, seu runtime e suas versões vão mudar esses números.",
  ],
};

/** Brazilian Portuguese (pt-BR) landing-page copy. Mirrors `HOME_COPY_EN`. */
export const HOME_COPY_PT: HomeCopy = {
  locale: "pt",
  links: {
    gettingStarted: "/pt/docs/getting-started",
    docs: "/pt/docs",
    installation: "/pt/docs/installation",
    tutorial: "/pt/docs/tutorials/bookstore",
    mcp: "/docs/mcp",
    openapi: "/docs/openapi",
    blog: "/blog",
  },
  hero: {
    title:
      "APIs REST em TypeScript orientadas a contrato e seguras por padrão, feitas para equipes que desenvolvem com IA",
    subtitle:
      "O DaloyJS traz configurações seguras por padrão, se recusa a iniciar em produção diante dos erros de configuração que conhece e roda com zero dependências em tempo de execução, com um pipeline de publicação reforçado e assinado com proveniência. Nenhum framework torna um aplicativo totalmente seguro nem impede todos os ataques à cadeia de suprimentos, então a documentação diz o que vem ativado por padrão, o que você ativa e quais riscos permanecem.",
    primaryCta: "Comece: instale o Daloy",
    secondaryCta: "Ler a documentação",
    contentLanguageNote:
      "Os primeiros passos, a instalação e o tutorial estão em português; o restante da documentação e o blog estão, por enquanto, em inglês.",
    factsLabel: "O projeto em números",
    facts: [
      "Mais de 3.000 testes do framework passando",
      "Limites de cobertura: ≥90% de linhas e funções, ≥92% de branches",
      "0 dependências em tempo de execução",
      "Node 24 LTS, Node 26+, Bun, Deno, Cloudflare",
      "Licença MIT",
    ],
    nameNote: (
      <>
        <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔</span> Daloy
        significa <span className="text-foreground">fluxo</span> em tagalo (se
        pronuncia{" "}
        <span className="whitespace-nowrap text-foreground">da-loy</span>).
      </>
    ),
    aboutLabel: "Sobre",
    aboutHref: "/pt/about",
    nameLabel: "O nome",
    nameHref: "/pt/about-the-name",
    tutorialLabel: "Tutorial: a API de uma livraria",
  },
  security: {
    eyebrow: "Segurança e cadeia de suprimentos",
    title: "Seguro por padrão: a camada de defesa para código gerado por IA",
    body: "Quando modelos de IA geram o código, a velocidade de digitação do desenvolvedor deixa de ser o gargalo: o que importa é a segurança em tempo de execução e a integridade da cadeia de suprimentos. O DaloyJS aplica proteções na camada de execução: limites de tamanho do corpo da requisição, timeouts, proteção contra poluição de protótipo, ocultação dos detalhes de erros 5xx e recusa em iniciar com configurações incorretas, sem nenhuma dependência transitiva para explorar.",
  },
  features: {
    secureDefaults: {
      title: "Configurações de execução seguras por padrão",
      body: "Ao contrário dos frameworks que deixam as proteções básicas para plugins ou para um roteamento de erros manual, o núcleo do DaloyJS já começa com as proteções ativadas: limites de tamanho do corpo, timeouts de requisição, JSON protegido contra poluição de protótipo, respostas 405 Method Not Allowed corretas e ocultação dos detalhes de erros 5xx que falha de forma segura (ativa em todo lugar, exceto em um ambiente de desenvolvimento ou de teste declarado explicitamente). Em produção, ele se recusa a iniciar diante dos erros de configuração que conhece, como segredos de sessão fracos ou cookies de sessão sem CSRF.",
      badges: [
        "Limites do corpo (1 MiB por padrão)",
        "Timeouts de requisição",
        "Defesa contra poluição de protótipo",
        "RFC 9457 problem+json",
        "Validação estrita de schemas",
        "Verificações de configuração na inicialização",
      ],
    },
    zeroDeps: {
      title: "Zero dependências em tempo de execução",
      body: "Instalar o @daloyjs/core adiciona exatamente zero pacotes transitivos. Nenhum script postinstall para auditar e nenhuma CVE surpresa vinda de dependências que você nunca escolheu. O framework não traz uma árvore de dependências própria; as outras dependências do seu aplicativo continuam sendo sua responsabilidade.",
      stat: {
        value: "0",
        label: "pacotes transitivos no @daloyjs/core",
      },
    },
    supplyChain: {
      title: "Templates reforçados para a cadeia de suprimentos",
      body: "Escolha o pnpm no create-daloy e o pnpm-workspace.yaml já vem reforçado: ignoreScripts bloqueia cargas maliciosas em scripts de instalação (não o código que roda no import), um minimumReleaseAge de 24 horas deixa passar as versões maliciosas recém-publicadas que são detectadas a tempo, e verifyStoreIntegrity mantém as instalações íntegras. O pacote de segurança opcional adiciona GitHub Actions reforçadas, Dependabot, CODEOWNERS, SECURITY.md, verificação da origem do lockfile, templates de contêiner sem root e com tini, e o daloy doctor, um validador da configuração de produção.",
      badges: [
        "ignoreScripts",
        "minimumReleaseAge de 24 h",
        "verifyStoreIntegrity",
        "Actions fixadas por SHA",
        "Auditoria com daloy doctor",
      ],
    },
    aiNative: {
      title: "Templates feitos para IA",
      body: "Todo projeto criado pelo create-daloy inclui um AGENTS.md e skills de contexto, e esta documentação pode ser lida via MCP. Agentes de código que leem o AGENTS.md aprendem as convenções do seu framework, as regras de roteamento e as primitivas de segurança sem nenhum ritual de prompt engineering.",
      badges: ["AGENTS.md incluído", "Skills de contexto", "Legível via MCP"],
    },
    streaming: {
      title: "Streaming e observabilidade",
      body: "Utilitários de SSE e NDJSON que respeitam backpressure, além de um hook de tracing do OpenTelemetry que emite spans de servidor HTTP com os atributos das convenções semânticas.",
      badges: ["SSE com backpressure", "Streaming NDJSON", "Spans HTTP do OTel"],
    },
    portable: {
      title: "Portável entre runtimes",
      body: "O núcleo só enxerga Request → Response. Os adaptadores ficam na borda: Node, Bun, Deno, Cloudflare Workers, Vercel, Fastly Compute e AWS Lambda. O mesmo aplicativo, os mesmos testes.",
      badges: ["Node 24+", "Bun", "Deno", "Cloudflare Workers", "Vercel", "AWS Lambda"],
    },
    contractFirst: {
      title: "Orientado a contrato desde o design",
      body: "Uma única definição de rota é a fonte da verdade para a validação, os tipos, o OpenAPI 3.1, o cliente tipado e os testes de contrato integrados, então as divergências têm menos onde se esconder.",
      badges: [
        "Validação em tempo de execução",
        "Especificação OpenAPI 3.1",
        "Cliente tipado com Hey API",
        "Testes de contrato integrados",
      ],
    },
    typedClients: {
      title: "Clientes tipados com Hey API",
      body: "Rode pnpm gen e tenha um SDK fetch totalmente tipado, para qualquer consumidor e em qualquer projeto TS, gerado a partir da sua especificação real. Ou dispense a geração de código com o cliente tipado em processo.",
      badges: ["pnpm gen", "Zero configuração", "SDK fetch tipado de ponta a ponta"],
    },
    batteries: {
      title: "Tudo incluído",
      body: "Sessões prontas para a edge, WebSockets que consomem das mesmas cotas de rate limit que o HTTP, logs estruturados e desligamento gracioso: a infraestrutura de produção que você normalmente monta com plugins, ainda com zero dependências em tempo de execução.",
      badges: ["Sessões na edge", "Rate limit em WebSocket", "Logs estruturados", "Desligamento gracioso"],
    },
  },
  benchmarks: {
    eyebrow: "Benchmarks e desempenho",
    title: "Os números, com os asteriscos incluídos",
    body: "Quando agentes de IA encadeiam ferramentas e disparam requisições com alta concorrência, o throughput e a latência de cold start passam a ser críticos. O DaloyJS vem com as verificações de segurança ativadas por padrão, e estes benchmarks medem o desempenho com todas as proteções ligadas.",
    charts: BENCHMARK_CHARTS_PT,
  },
  mcp: {
    eyebrow: "Feito para máquinas: agentes e ferramentas de IA",
    title: "O DaloyJS está pronto para MCP",
    intro: (
      <>
        O{" "}
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noreferrer"
          hrefLang="en"
          className="underline underline-offset-4"
        >
          Model Context Protocol
        </a>{" "}
        (MCP) é o padrão aberto que agentes de IA como Claude, Cursor e VS Code
        usam para chamar ferramentas e ler documentação. O DaloyJS suporta os
        dois lados: seu aplicativo pode se tornar um servidor MCP, e esta
        documentação (em inglês) já é um.
      </>
    ),
    serverTitle: "Transforme sua API em um servidor MCP",
    serverBody: (
      <>
        O DaloyJS cria servidores MCP apenas com o <code>@daloyjs/core</code>,
        sem SDK: transporte Streamable HTTP, validação de schemas de entrada e
        uma proteção de inicialização em produção que se recusa a iniciar
        quando um endpoint MCP não tem um hook de autenticação na sua cadeia.
        Ela verifica se o hook está lá e, em produção, se ele rodou em cada
        requisição, não se ele rejeita alguém, então teste também a sua
        autenticação.
      </>
    ),
    serverCta: "Criar um servidor MCP →",
    serverSnippet: MCP_SERVER_SNIPPET,
    docsTitle: "Leia esta documentação via MCP",
    docsBody:
      "Um endpoint público e somente leitura em que seu agente de código pode pesquisar e ler sem copiar e colar. Não precisa de chave de API.",
    endpointTitle: "Endpoint",
    endpointBody: "Aponte qualquer cliente compatível com MCP para esta URL:",
    tools: {
      search_docs: "Busca por palavras-chave em todas as páginas da documentação, ordenada por relevância.",
      get_doc: "Lê o texto completo de uma página pela rota ou pelo slug.",
      list_docs: "Lista todas as páginas de documentação disponíveis em uma única chamada.",
    },
    configLabel: "Adicione à configuração do seu cliente MCP",
    stdioNote: "Usa um cliente que só aceita stdio? Faça a ponte com",
  },
  contracts: {
    eyebrow: "Limitar o raio de impacto",
    title: "Contratos como barreiras de segurança, não como sintaxe decorativa",
    body: "Num fluxo de trabalho centrado em IA, contratos não são um luxo estético para humanos: são a fronteira imposta pela máquina que impede que estruturas de dados alucinadas vazem entre componentes. Um único contrato de rota valida as requisições com rigor, delimita as respostas e gera ao vivo a especificação OpenAPI 3.1 e o cliente tipado.",
    flow: {
      title: "fluxo do contrato",
      tagline: "defina uma vez -> gere o resto",
      steps: [
        { label: "contrato", detail: "GET /books/:id + z.object(...)" },
        { label: "validação", detail: "em execução, nos dois sentidos" },
        { label: "OpenAPI 3.1", detail: "especificação ao vivo + /docs" },
        { label: "cliente tipado", detail: "pnpm gen -> SDK fetch" },
      ],
    },
    helloWorld: HELLO_WORLD,
  },
  scalar: {
    title: "Referência de API com Scalar, em uma linha",
    body: (
      <>
        O Scalar é o sucessor moderno do Swagger UI: rápido, limpo, com modo
        escuro nativo e requisições de teste integradas. No DaloyJS, ele é a
        interface de documentação <em>padrão</em>, não um plugin:{" "}
        <code>docs: true</code> no construtor de <code>App</code> monta
        automaticamente esta página em <code>/docs</code> e a especificação
        OpenAPI 3.1 ao vivo em <code>/openapi.json</code>.
      </>
    ),
    footer:
      "Gerada a partir dos contratos das suas rotas, sem código extra. Prefere Swagger UI ou Redoc? Os dois estão a um campo de configuração de distância.",
    guideCta: "Guia de OpenAPI e da interface de documentação →",
  },
  comparison: {
    eyebrow: "Escolhas do ecossistema",
    title: "O melhor de cada concorrente, com menos concessões",
    body: "O DaloyJS não tenta vencer em um único quesito. Ele tenta eliminar o trabalho de cola entre as melhores ideias de que os desenvolvedores já gostam.",
    youWant: "Você quer",
    todayPrefix: "Hoje:",
    todaysBest: "O melhor hoje",
    daloyGives: "O que o DaloyJS oferece",
    rows: [
      {
        want: "Reforço portável da cadeia de suprimentos para os aplicativos que você cria",
        best: "padrões do pnpm + núcleo sem dependências",
        give: "Configurações de instalação do pnpm reforçadas, lockfiles com origem verificada, SBOM + proveniência do npm",
      },
      {
        want: "Encaixe em serverless / edge",
        best: "Hono",
        give: "Núcleo baseado em padrões web, adaptadores para vários runtimes",
      },
      {
        want: "Operação e documentação maduras em Node",
        best: "Fastify",
        give: "Plugins encapsulados, logs estruturados, desligamento gracioso",
      },
      {
        want: "DX moderna focada em TS, compatível com Bun",
        best: "Elysia",
        give: "Handlers, contexto e cliente tipados de ponta a ponta",
      },
      {
        want: "A melhor ergonomia de OpenAPI",
        best: "FastAPI",
        give: "OpenAPI 3.1 integrado a partir de uma única definição de rota",
      },
      {
        want: "A melhor geração de clientes tipados",
        best: "Hey API",
        give: "pnpm gen → SDK fetch totalmente tipado",
      },
    ],
  },
  cta: {
    title: "Tudo pronto para entregar com configurações seguras por padrão?",
    body: "Crie um projeto em segundos com a instalação reforçada para o seu gerenciador de pacotes, uma CI gerada que bloqueia scripts de instalação, GitHub Actions fixadas, Dependabot, CODEOWNERS e verificação da origem do lockfile. Depois, mantenha o contrato enquanto o aplicativo cresce: o mesmo aplicativo roda em Node, Bun, Deno e Cloudflare Workers.",
    install: "Instalar o DaloyJS",
    tutorial: "Construir a API de uma livraria",
    source: "Ver o código-fonte",
  },
  support: {
    eyebrow: "Apoie o projeto",
    title: "Se o DaloyJS economiza seu tempo, você pode me pagar um café",
    body: "O DaloyJS é gratuito e tem licença MIT. Se a documentação, os artigos ou o próprio framework ajudaram você a entregar algo com um pouco menos de drama, um café é uma ótima forma de manter o trabalho andando.",
    coffee: "Me pague um café",
    blog: "Ler o blog (em inglês)",
  },
};
