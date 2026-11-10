import type { BenchmarkChartsCopy } from "@/components/benchmark-charts";
import type { HomeCopy } from "./home-copy";

const HELLO_WORLD = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

// requestId() y secureHeaders() ya los aplica automáticamente new App();
// estas llamadas explícitas solo personalizan (y reemplazan) los valores por defecto.
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // por IP del cliente de forma predeterminada; detrás de un proxy, configura behindProxy o keyGenerator

app.get(
  "/books/:id",
  {
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Encontrado", body: z.object({ id: z.string(), title: z.string() }) },
      404: { description: "No encontrado" },
    },
  },
  async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`Libro \${params.id}\` },
  }),
);

serve(app, { port: 3000 });`;

const MCP_SERVER_SNIPPET = `import { App, bearerAuth, createMcpHandler, mcpRoutes } from "@daloyjs/core";

const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  tools: [/* tus herramientas, con la entrada validada mediante esquemas */],
});

const app = new App();
app.use(bearerAuth({ validate: checkToken })); // sin hook de autenticación, no arranca en producción
for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route); // tu API ya es también un servidor MCP
}`;

/** Spanish strings for the benchmark charts (plain data: crosses to the client). */
const BENCHMARK_CHARTS_ES: BenchmarkChartsCopy = {
  heading: "Cómo se compara DaloyJS",
  intro:
    "Cifras reales obtenidas con el conjunto de benchmarks del propio repositorio. Elige una métrica, pero ten en cuenta las salvedades que aparecen abajo, porque ninguna de estas comparaciones se hace en igualdad de condiciones.",
  tabs: {
    deps: {
      trigger: "Dependencias",
      title: "Dependencias transitivas instaladas",
      description:
        "Cada paquete que se descarga en la instalación es una superficie de ataque en la que alguien tiene que confiar. DaloyJS y Hono son los únicos que no añaden ninguna.",
      takeaway:
        "DaloyJS instala 0 dependencias transitivas, empatado con Hono como la opción con menor superficie de ataque en la cadena de suministro, mientras que una aplicación de NestJS configurada de forma segura incorpora 86.",
      soWhat:
        "Menos paquetes en los que confiar implican menos CVE y ningún script postinstall inesperado. No tener dependencias significa que el framework no abre por su cuenta ninguna puerta de entrada a la cadena de suministro; revisar el resto de tu árbol de dependencias sigue siendo tu responsabilidad.",
    },
    install: {
      trigger: "Tamaño de instalación",
      title: "Espacio ocupado en disco",
      description:
        "Total de megabytes escritos en node_modules para una aplicación «Hola, mundo», con una configuración mínima frente a una reforzada en seguridad (con protecciones equivalentes).",
      takeaway:
        "DaloyJS ocupa unos 2.4 MB en disco y su tamaño no cambia al activar la seguridad, porque las protecciones ya vienen integradas en el núcleo. En cambio, Fastify y NestJS crecen considerablemente en cuanto les añades los plugins equivalentes.",
      soWhat:
        "Instalaciones más pequeñas significan ejecuciones de CI más rápidas, imágenes de Docker más ligeras y arranques en frío más rápidos en entornos serverless y edge.",
    },
    bundle: {
      trigger: "Tamaño del bundle",
      title: "Salida empaquetada y comprimida con gzip",
      description:
        "Compilación de producción en un único archivo, comprimida con gzip. Cuanto más pequeña, más rápido se despliega en entornos edge y menos tarda en arrancar en frío.",
      takeaway:
        "Comprimido con gzip, DaloyJS ocupa unos 61 kB en la configuración mínima y unos 67 kB en la segura. Solo Hono es más pequeño, y DaloyJS ocupa una fracción de lo que ocupan los bundles de Express o Nest, a pesar de incluir más funciones por defecto.",
      soWhat:
        "Un bundle más pequeño se inicia más rápido en un arranque en frío, así que el primer usuario que llega a tu función edge o a tu endpoint serverless espera menos.",
    },
    throughput: {
      trigger: "Throughput",
      title: "Solicitudes por segundo, con una pila de middleware",
      description:
        "Ambos frameworks ejecutan una pila de middleware comparable en las mismas rutas con 100 conexiones simultáneas. Esta es la forma justa de medir el throughput: ¿cuánto cuesta cuando los dos hacen trabajo real?",
      takeaway:
        "Con un middleware comparable en ambos frameworks, DaloyJS supera a Hono en todos los escenarios: unas 25 200 frente a unas 19 700 solicitudes por segundo en rutas estáticas (alrededor de un 28 % más) y unas 22 500 frente a unas 14 300 en la ruta POST con cuerpo (alrededor de un 58 % más), y además valida ese cuerpo con Zod. Tener la seguridad y la validación activadas por defecto ya no te hace perder en los benchmarks.",
      soWhat:
        "La seguridad y la validación prácticamente no tienen costo en la capa del framework. El verdadero cuello de botella estará en la base de datos y en la red, no en DaloyJS.",
    },
  },
  seriesMinimal: "Mínima",
  seriesSecure: "Paridad de seguridad",
  depsUnit: "dependencias",
  scenarios: {
    "Static route": "Ruta estática",
    "Dynamic route": "Ruta dinámica",
    "POST + body": "POST + cuerpo",
  },
  soWhatLabel: "Qué significa para ti:",
  takeawayLabel: "Conclusión:",
  ranAt: "octubre de 2026",
  sourceIn: "código en",
  caveatsTitle: "Por qué no es una comparación en igualdad de condiciones",
  caveatsIntro:
    "Estos frameworks no son la misma herramienta, así que una gráfica que los enfrenta directamente se parece más a comparar peras con manzanas que a una competencia justa. A continuación explicamos, en términos sencillos, qué demuestran estas cifras y qué no.",
  notes: [
    "Herramientas distintas, no una comparación equivalente. Son herramientas diferentes que hacen distintas cantidades de trabajo. En cada solicitud, DaloyJS valida el cuerpo con tu esquema de Zod o Valibot cuando la ruta declara un esquema de cuerpo, y aplica encabezados de seguridad, un ID de solicitud, límites de tamaño del cuerpo y tiempos de espera para las solicitudes, todo sin configuración adicional. Las aplicaciones “mínimas” de los demás frameworks no hacen casi nada de esto, e incluso las configuraciones con protecciones equivalentes rara vez lo igualan punto por punto. Por eso, parte de cada cifra de DaloyJS corresponde a seguridad y validación que, de otro modo, tendrías que implementar tú.",
    "La forma de medir el espacio en disco es distinta: DaloyJS es un único paquete sin dependencias, mientras que los demás resuelven árboles de dependencias transitivas cuyo tamaño exacto depende de cuándo se generó el lockfile.",
    "El throughput depende de la carga de trabajo: con una pila de middleware comparable en ambos frameworks, DaloyJS supera a Hono en alrededor de un 27 % en estas rutas GET y en alrededor de un 58 % en la ruta POST con cuerpo, y además valida ese cuerpo con Zod. Los servicios reales suelen estar limitados por la base de datos y las operaciones de E/S, no por la forma en que el framework despacha las solicitudes, así que estas microcifras rara vez anticipan lo que pasará en producción.",
    "Distintos entornos de ejecución de destino: algunos frameworks (por ejemplo, Elysia) están optimizados para Bun, pero aquí se miden con sus adaptadores para Node, para tener una base de comparación justa en un único entorno.",
    "Una sola máquina, un solo momento: un Apple M3 Max con Node v26.4.0, en octubre de 2026, con @daloyjs/core 1.5.4 y otros procesos ejecutándose en segundo plano (los dos frameworks se midieron uno tras otro, así que la comparación entre ellos es más sólida que las cifras absolutas). Tu hardware, tu entorno de ejecución y tus versiones harán que estas cifras cambien.",
  ],
};

/** Neutro Spanish (es-ES) landing-page copy. Mirrors `HOME_COPY_EN`. */
export const HOME_COPY_ES: HomeCopy = {
  locale: "es",
  links: {
    gettingStarted: "/es/docs/getting-started",
    docs: "/es/docs",
    installation: "/es/docs/installation",
    tutorial: "/es/docs/tutorials/bookstore",
    mcp: "/docs/mcp",
    openapi: "/es/docs/openapi",
    blog: "/blog",
  },
  hero: {
    title:
      "APIs REST en TypeScript con enfoque contract-first, seguras por defecto y pensadas para equipos que trabajan con IA",
    subtitle:
      "DaloyJS incluye configuración segura por defecto, se niega a iniciarse en producción si detecta alguno de los errores de configuración que tiene identificados, y funciona sin dependencias en tiempo de ejecución, con un proceso de publicación reforzado y firmado con procedencia verificable (provenance). Ningún framework hace que una aplicación sea completamente segura ni detiene todos los ataques a la cadena de suministro; por eso la documentación indica qué está activado por defecto, qué debes activar tú y qué riesgos persisten.",
    primaryCta: "Empieza: instalar Daloy",
    secondaryCta: "Leer la documentación",
    contentLanguageNote:
      "Por ahora, solo una parte de la documentación está en español: primeros pasos, instalación, el tutorial y las guías básicas (enrutamiento, validación, manejo de errores, OpenAPI, cliente tipado y seguridad). El resto de la documentación y el blog están disponibles solo en inglés.",
    factsLabel: "Datos del proyecto",
    facts: [
      "Más de 3000 pruebas del framework superadas",
      "Cobertura mínima exigida: ≥90 % de líneas y funciones, ≥92 % de ramas",
      "0 dependencias en tiempo de ejecución",
      "Node 24 LTS, Node 26+, Bun, Deno, Cloudflare",
      "Licencia MIT",
    ],
    nameNote: (
      <>
        <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔</span> Daloy
        significa <span className="text-foreground">flujo</span> en tagalo (se
        pronuncia{" "}
        <span className="whitespace-nowrap text-foreground">da-loy</span>).
      </>
    ),
    aboutLabel: "Acerca de",
    aboutHref: "/es/about",
    nameLabel: "Origen del nombre",
    nameHref: "/es/about-the-name",
    tutorialLabel: "Tutorial: API de una librería",
  },
  security: {
    eyebrow: "Seguridad y cadena de suministro",
    title:
      "Seguridad por defecto: la capa de protección para el código generado por IA",
    body: "Cuando los modelos de IA generan código, la velocidad a la que escribe el desarrollador ya no es el cuello de botella; lo son la seguridad en tiempo de ejecución y la integridad de la cadena de suministro. DaloyJS aplica salvaguardas en la capa de ejecución: límites de tamaño del cuerpo de las solicitudes, tiempos de espera (timeouts), protección contra la contaminación de prototipos (prototype pollution), ocultación de detalles en los errores 5xx y negativa a iniciarse ante configuraciones incorrectas. Todo ello sin dependencias transitivas que un atacante pueda explotar.",
  },
  features: {
    secureDefaults: {
      title: "Protecciones en tiempo de ejecución activadas por defecto",
      body: "A diferencia de otros frameworks que dejan las protecciones básicas en manos de plugins o de un manejo manual de errores, el núcleo de DaloyJS viene con las salvaguardas activadas desde el principio: límites de tamaño del cuerpo, tiempos de espera para las solicitudes, análisis de JSON protegido contra la contaminación de prototipos, respuestas 405 Method Not Allowed correctas y ocultación de detalles en los errores 5xx con un comportamiento seguro ante fallos (fail closed), activa en todos los entornos salvo que se declare explícitamente uno de desarrollo o de pruebas. En producción, se niega a iniciarse si detecta alguno de los errores de configuración que tiene identificados, como secretos de sesión débiles o cookies de sesión sin protección CSRF.",
      badges: [
        "Límite de tamaño del cuerpo (1 MiB por defecto)",
        "Tiempos de espera para las solicitudes",
        "Protección contra la contaminación de prototipos",
        "Errores en formato RFC 9457 (problem+json)",
        "Validación estricta de esquemas",
        "Comprobaciones de la configuración al arrancar",
      ],
    },
    zeroDeps: {
      title: "Sin dependencias en tiempo de ejecución",
      body: "Al instalar @daloyjs/core no se añade ningún paquete transitivo. No hay scripts postinstall que auditar ni CVE inesperadas provenientes de dependencias que nunca elegiste. El framework no añade un árbol de dependencias propio; revisar las demás dependencias de tu aplicación sigue siendo tu responsabilidad.",
      stat: {
        value: "0",
        label: "paquetes transitivos en @daloyjs/core",
      },
    },
    supplyChain: {
      title: "Plantillas de proyecto con la cadena de suministro reforzada.",
      body: "Si eliges pnpm en create-daloy, el archivo pnpm-workspace.yaml ya viene reforzado: ignoreScripts bloquea el código malicioso en los scripts de instalación (no el código que se ejecuta al importar), minimumReleaseAge de 24 horas retrasa la instalación de versiones recién publicadas para que las versiones maliciosas que se detectan a tiempo no lleguen a tu proyecto, y verifyStoreIntegrity verifica la integridad de lo que se instala. El conjunto de seguridad opcional añade flujos de GitHub Actions reforzados, Dependabot, CODEOWNERS, SECURITY.md, verificación del origen de los paquetes en el lockfile, plantillas de contenedor que se ejecutan sin privilegios de root y con tini, y daloy doctor, un validador de la configuración para producción",
      badges: [
        "ignoreScripts",
        "minimumReleaseAge de 24 h",
        "verifyStoreIntegrity",
        "Actions fijadas por SHA",
        "Auditoría con daloy doctor",
      ],
    },
    aiNative: {
      title: "Plantillas preparadas para trabajar con IA",
      body: "Todo proyecto generado con create-daloy incluye un archivo AGENTS.md y skills de contexto, y esta documentación se puede consultar a través de MCP. Los agentes de programación que leen AGENTS.md aprenden las convenciones del framework, las reglas de enrutamiento y las primitivas de seguridad sin que tengas que escribir prompts elaborados cada vez.",
      badges: ["Incluye AGENTS.md", "Skills de contexto", "Documentación accesible por MCP"],
    },
    streaming: {
      title: "Streaming y observabilidad",
      body: "Utilidades para SSE y NDJSON que gestionan la contrapresión (backpressure) de forma segura, y un hook de trazas de OpenTelemetry que genera spans de servidor HTTP con atributos según las convenciones semánticas.",
      badges: [
      "SSE con gestión de contrapresión",
        "Streaming con NDJSON",
        "Spans de servidor HTTP con OTel",
      ],
    },
    portable: {
      title: "Portable entre entornos de ejecución",
      body: "El núcleo solo trabaja con Request → Response. Los adaptadores viven en la capa externa: Node, Bun, Deno, Cloudflare Workers, Vercel, Fastly Compute y AWS Lambda. La misma aplicación y las mismas pruebas en todos ellos.",
      badges: [
        "Node 24+",
        "Bun",
        "Deno",
        "Cloudflare Workers",
        "Vercel",
        "AWS Lambda",
      ],
    },
    contractFirst: {
      title: "Contract-first por diseño",
      body: "Una sola definición de ruta es la fuente de verdad para la validación, los tipos, OpenAPI 3.1, el cliente tipado y las pruebas de contrato integradas, así que es más difícil que las desincronizaciones pasen desapercibidas.",
      badges: [
        "Validación en tiempo de ejecución",
        "Especificación OpenAPI 3.1",
        "Cliente tipado con Hey API",
        "Pruebas de contrato integradas",
      ],
    },
    typedClients: {
      title: "Clientes tipados con Hey API",
      body: "Ejecuta pnpm gen y obtén un SDK basado en fetch, completamente tipado, generado a partir de tu especificación real y listo para cualquier aplicación que consuma la API en cualquier proyecto de TypeScript. Si prefieres evitar la generación de código, usa el cliente tipado que se ejecuta en el mismo proceso.",
      badges: ["pnpm gen", "Sin configuración", "SDK de fetch tipado de extremo a extremo"],
    },
    batteries: {
      title: "Todo lo necesario incluido",
      body: "Sesiones compatibles con entornos edge, WebSockets que consumen los mismos cupos de límite de solicitudes que HTTP, logs estructurados y apagado controlado (graceful shutdown): la infraestructura para producción que normalmente armas con plugins, y todo sin dependencias en tiempo de ejecución.",
      badges: [
        "Sesiones para entornos edge",
        "Límites de solicitudes en WebSocket",
        "Logs estructurados",
        "Apagado controlado",
      ],
    },
  },
  benchmarks: {
    eyebrow: "Benchmarks y rendimiento",
    title: "Las cifras, con todas sus salvedades",
    body: "Cuando los agentes de IA ejecutan herramientas en bucle y envían solicitudes con alta concurrencia, el throughput y la latencia de arranque en frío se vuelven críticos. DaloyJS incluye comprobaciones de seguridad activadas por defecto, y estos benchmarks miden el rendimiento de la pila de middleware configurada de DaloyJS, no con todas las protecciones activas en su configuración de producción.",
    charts: BENCHMARK_CHARTS_ES,
  },
  mcp: {
    eyebrow: "Nativo para máquinas: para agentes y herramientas de IA",
    title: "DaloyJS está preparado para MCP",
    intro: (
      <>
        El{" "}
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noreferrer"
          hrefLang="en"
          className="underline underline-offset-4"
        >
          Model Context Protocol
        </a>{" "}
        (MCP) es el estándar abierto que usan agentes de IA como Claude, Cursor y VS Code para invocar herramientas y consultar documentación. DaloyJS lo admite en ambos sentidos: tu aplicación puede convertirse en un servidor MCP, y esta documentación ya lo es.
      </>
    ),
    serverTitle: "Convierte tu API en un servidor MCP",
    serverBody: (
      <>
        DaloyJS crea servidores MCP solo con <code>@daloyjs/core</code>, sin necesidad de ningún SDK: transporte Streamable HTTP, validación de los esquemas de entrada y una comprobación al iniciar que, en producción, se niega a arrancar si un endpoint MCP no público no tiene un hook de autenticación en su cadena (la autenticación es obligatoria por defecto; solo las rutas configuradas con <code>{"{ public: true }"}</code> quedan exentas). La comprobación verifica que el hook esté presente y, en producción, que se haya ejecutado en cada solicitud, pero no que rechace a nadie, así que prueba también tu autenticación.
      </>
    ),
    serverCta: "Crea un servidor MCP →",
    serverSnippet: MCP_SERVER_SNIPPET,
    docsTitle: "Consulta esta documentación a través de MCP",
    docsBody:
      "Un endpoint público de solo lectura en el que tu agente de programación con IA puede buscar y leer sin que tengas que copiar y pegar. No necesitas clave de API.",
    endpointTitle: "Endpoint",
    endpointBody: "Apunta cualquier cliente compatible con MCP a esta URL:",
    tools: {
      search_docs:
        "Búsqueda por palabras clave en todas las páginas de la documentación, con resultados ordenados por relevancia.",
      get_doc: "Lectura del texto completo de una página a partir de su ruta o su slug.",
      list_docs:
        "Listado de todas las páginas de documentación disponibles en una sola llamada.",
    },
    configLabel: "Añádelo a la configuración de tu cliente MCP",
    stdioNote: "¿Usas un cliente que solo admite stdio? Conéctalo con",
  },
  contracts: {
    eyebrow: "Límites al radio de impacto",
    title: "Los contratos como barreras de seguridad, no como sintaxis decorativa",
    body: "En un flujo de trabajo centrado en la IA, los contratos no son un lujo estético para humanos: son el límite que la máquina hace cumplir para impedir que las estructuras de datos alucinadas se filtren entre componentes. Un único contrato de ruta valida estrictamente las solicitudes, acota el contenido de las respuestas y genera la especificación OpenAPI 3.1 y el cliente tipado, siempre actualizados.",
    flow: {
      title: "flujo del contrato",
      tagline: "defínelo una vez -> genera el resto",
      steps: [
        { label: "contrato", detail: "GET /books/:id + z.object(...)" },
        { label: "validación", detail: "en tiempo de ejecución, en ambos sentidos" },
        { label: "OpenAPI 3.1", detail: "especificación en vivo + /docs" },
        { label: "cliente tipado", detail: "pnpm gen -> SDK fetch" },
      ],
    },
    helloWorld: HELLO_WORLD,
  },
  scalar: {
    title: "Referencia de la API con Scalar, en una sola línea",
    body: (
      <>
        Scalar es el sucesor moderno de Swagger UI: rápido, limpio, con modo
        oscuro nativo y con la opción integrada de probar solicitudes desde la
        propia documentación. En DaloyJS es la interfaz de documentación{" "}
        <em>predeterminada</em>, no un plugin: con <code>docs: true</code> en el
        constructor de <code>App</code>, esta página se monta automáticamente en{" "}
        <code>/docs</code> y la especificación OpenAPI 3.1 actualizada en{" "}
        <code>/openapi.json</code>.
      </>
    ),
    footer:
      "Se genera a partir de tus contratos de ruta, sin código adicional. ¿Prefieres Swagger UI o Redoc? Basta con cambiar un campo de la configuración.",
    guideCta: "Guía de OpenAPI y de la interfaz de documentación →",
  },
  comparison: {
    eyebrow: "Concesiones en el ecosistema",
    title: "Las fortalezas de otros frameworks, con menos concesiones",
    body: "DaloyJS no intenta ganar en un solo aspecto. Busca eliminar el trabajo de integración entre las mejores ideas que los desarrolladores ya conocen y valoran.",
    youWant: "Lo que buscas",
    todayPrefix: "Actual:",
    todaysBest: "La mejor opción actual",
    daloyGives: "Lo que te ofrece DaloyJS",
    rows: [
      {
        want: "Cadena de suministro reforzada y portable",
        best: "valores por defecto de pnpm + núcleo sin dependencias",
        give: "Instalación de pnpm reforzada, lockfiles con origen verificado, SBOM + provenance de npm",
      },
      {
        want: "Serverless y edge",
        best: "Hono",
        give: "Núcleo basado en estándares web, adaptadores para varios entornos de ejecución",
      },
      {
        want: "Operaciones y documentación maduras en Node",
        best: "Fastify",
        give: "Plugins encapsulados, logs estructurados, apagado controlado",
      },
      {
        want: "DX moderna centrada en TypeScript, compatible con Bun",
        best: "Elysia",
        give: "Handlers con tipado de extremo a extremo, contexto tipado, cliente tipado",
      },
      {
        want: "La mejor experiencia con OpenAPI",
        best: "FastAPI",
        give: "OpenAPI 3.1 integrado a partir de una sola definición de ruta",
      },
      {
        want: "La mejor generación de clientes tipados",
        best: "Hey API",
        give: "pnpm gen → SDK basado en fetch completamente tipado",
      },
    ],
  },
  cta: {
    title: "¿Todo listo para llevar tu API a producción con seguridad por defecto?",
    body: "Crea un proyecto en segundos con una instalación reforzada para tu gestor de paquetes, un CI generado que bloquea los scripts de instalación, GitHub Actions fijadas, Dependabot, CODEOWNERS y verificación del origen de los paquetes en el lockfile. Después, conserva el contrato a medida que la aplicación crece: la misma aplicación funciona en Node, Bun, Deno y Cloudflare Workers.",
    install: "Instalar DaloyJS",
    tutorial: "Crea la API de una librería",
    source: "Ver el código fuente",
  },
  support: {
    eyebrow: "Apoya el proyecto",
    title: "Si DaloyJS te ahorra tiempo, puedes invitarme a un café",
    body: "DaloyJS es gratuito y tiene licencia MIT. Si la documentación, los artículos del blog o el propio framework te ayudaron a lanzar algo con menos dolores de cabeza, un café es una forma perfectamente razonable de ayudar a que el trabajo continúe.",
    coffee: "Invítame a un café",
    blog: "Leer el blog (en inglés)",
  },
};
