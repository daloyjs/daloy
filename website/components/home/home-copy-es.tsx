import type { BenchmarkChartsCopy } from "@/components/benchmark-charts";
import type { HomeCopy } from "./home-copy";

const HELLO_WORLD = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

// new App() ya aplica requestId() y secureHeaders() automáticamente;
// estas llamadas explícitas solo personalizan (y sustituyen) los valores por defecto.
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // por IP de cliente por defecto; detrás de un proxy, configura behindProxy o keyGenerator

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
  tools: [/* tus herramientas, con esquemas de entrada validados */],
});

const app = new App();
app.use(bearerAuth({ validate: checkToken })); // sin hook de autenticación, producción se niega a arrancar
for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route); // tu API ya es también un servidor MCP
}`;

/** Spanish strings for the benchmark charts (plain data: crosses to the client). */
const BENCHMARK_CHARTS_ES: BenchmarkChartsCopy = {
  heading: "Cómo se compara DaloyJS",
  intro:
    "Cifras reales del propio conjunto de benchmarks del repositorio. Elige una métrica, pero ten en cuenta las advertencias de abajo, porque ninguna es una comparación limpia de igual a igual.",
  tabs: {
    deps: {
      trigger: "Dependencias",
      title: "Dependencias transitivas instaladas",
      description:
        "Cada paquete que arrastra la instalación es superficie de ataque en la que alguien tiene que confiar. DaloyJS y Hono son los dos únicos que no añaden ninguno.",
      takeaway:
        "DaloyJS instala 0 dependencias transitivas, empatado con Hono como la menor superficie en la cadena de suministro, mientras que una aplicación NestJS segura arrastra 86.",
      soWhat:
        "Menos paquetes en los que confiar significa menos CVE y ningún script postinstall inesperado. Cero dependencias significa que el framework no abre puertas propias en la cadena de suministro; el resto de tu árbol de dependencias sigue siendo cosa tuya.",
    },
    install: {
      trigger: "Tamaño instalado",
      title: "Espacio ocupado en disco",
      description:
        "Megabytes totales escritos en node_modules para una aplicación «hola, mundo», en versión mínima frente a una configuración reforzada (paridad de seguridad).",
      takeaway:
        "DaloyJS ocupa unos 2,4 MB en disco y no crece al activar la seguridad, porque el refuerzo ya viene en el núcleo. Fastify y NestJS se disparan en cuanto les añades los plugins equivalentes.",
      soWhat:
        "Instalaciones más pequeñas significan una CI más rápida, imágenes de Docker más ligeras y arranques en frío más rápidos en serverless y en el edge.",
    },
    bundle: {
      trigger: "Tamaño del bundle",
      title: "Salida empaquetada y comprimida con gzip",
      description:
        "Build de producción en un solo archivo, comprimido con gzip. Cuanto más pequeño, antes se despliega en el edge y antes arranca en frío.",
      takeaway:
        "DaloyJS ocupa unos 61 kB comprimido en la versión mínima y unos 67 kB en la segura, solo por detrás de Hono y una fracción de los bundles de Express o Nest, pese a traer más cosas de serie.",
      soWhat:
        "Un bundle más pequeño arranca antes tras un arranque en frío, así que el primer usuario que llega a tu función edge o a tu endpoint serverless espera menos.",
    },
    throughput: {
      trigger: "Rendimiento",
      title: "Peticiones por segundo, con una pila de middleware",
      description:
        "Ambos frameworks ejecutan una pila de middleware comparable en las mismas rutas con 100 conexiones. Es la versión justa de la pregunta sobre el rendimiento: ¿cuánto cuesta cuando los dos lados hacen trabajo de verdad?",
      takeaway:
        "Con un middleware comparable en ambos lados, DaloyJS supera a Hono en todos los escenarios: unas 25,2k frente a 19,7k peticiones/s en rutas estáticas (un 28 % más) y unas 22,5k frente a 14,3k en la ruta POST con cuerpo (un 58 % más), validando además ese cuerpo con Zod. Tener la seguridad y la validación activadas por defecto ya no te cuesta el benchmark.",
      soWhat:
        "La seguridad y la validación salen prácticamente gratis en la capa del framework. Tu verdadero cuello de botella será la base de datos y la red, no DaloyJS.",
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
  caveatsTitle: "Por qué esto es comparar peras con manzanas",
  caveatsIntro:
    "Estos frameworks no son la misma herramienta, así que una gráfica cara a cara se parece más a comparar peras con manzanas que a una carrera justa. Esto es lo que estas cifras demuestran y lo que no, en lenguaje llano.",
  notes: [
    "Peras con manzanas, no una comparación de igual a igual. Son herramientas distintas que hacen cantidades de trabajo distintas. En cada petición, DaloyJS valida el cuerpo contra tu esquema de Zod o Valibot y aplica cabeceras seguras, un ID de petición, límites de tamaño del cuerpo y tiempos de espera, todo de serie. Las aplicaciones «mínimas» de los demás frameworks no hacen casi nada de esto, e incluso la «paridad de seguridad» rara vez lo iguala punto por punto. Así que parte de cada cifra de DaloyJS es seguridad y validación que, de otro modo, tendrías que construir tú.",
    "La metodología del tamaño difiere: DaloyJS es un único paquete sin dependencias, mientras que los demás resuelven árboles transitivos cuyo tamaño exacto depende de cuándo se generó el lockfile.",
    "El rendimiento depende de la carga de trabajo: con una pila de middleware comparable en ambos lados, DaloyJS saca un 27 % de ventaja a Hono en estas rutas GET y un 58 % en la ruta POST con cuerpo, y además DaloyJS valida ese cuerpo con Zod. Los servicios reales suelen estar limitados por la base de datos y la E/S, no por el despacho del framework, así que estas microcifras rara vez predicen lo que pasará en producción.",
    "Entornos de ejecución distintos: algunos frameworks (por ejemplo, Elysia) están optimizados para Bun, pero aquí se miden con sus adaptadores de Node para tener una base justa con un único runtime.",
    "Una sola máquina, un solo momento: un Apple M3 Max, Node v26.4.0, octubre de 2026, con @daloyjs/core 1.5.4 y otra carga de fondo en la máquina (los dos frameworks se midieron uno detrás de otro, así que la comparación se sostiene mejor que las cifras absolutas). Tu hardware, tu runtime y tus versiones moverán estas cifras.",
  ],
};

/** Castilian Spanish (es-ES) landing-page copy. Mirrors `HOME_COPY_EN`. */
export const HOME_COPY_ES: HomeCopy = {
  locale: "es",
  links: {
    gettingStarted: "/es/docs/getting-started",
    docs: "/es/docs",
    installation: "/es/docs/installation",
    tutorial: "/es/docs/tutorials/bookstore",
    mcp: "/docs/mcp",
    openapi: "/docs/openapi",
    blog: "/blog",
  },
  languageNotice: {
    badge: "English",
    text: "This page is also available in English.",
    cta: "Read in English",
    href: "/",
    lang: "en",
  },
  hero: {
    title:
      "APIs REST en TypeScript basadas en contratos, seguras por defecto y pensadas para equipos que programan con IA",
    subtitle:
      "DaloyJS trae valores seguros por defecto, se niega a arrancar en producción ante las configuraciones erróneas que conoce y funciona sin dependencias en tiempo de ejecución, con un proceso de publicación reforzado y firmado con procedencia. Ningún framework hace que una aplicación sea totalmente segura ni detiene todos los ataques a la cadena de suministro, así que la documentación explica qué viene activado por defecto, qué activas tú y qué riesgos quedan.",
    primaryCta: "Empieza: instala Daloy",
    secondaryCta: "Leer la documentación",
    contentLanguageNote:
      "Los primeros pasos, la instalación y el tutorial están en español; el resto de la documentación y el blog, de momento, solo en inglés.",
    factsLabel: "Datos del proyecto",
    facts: [
      "Más de 3000 pruebas del framework en verde",
      "Umbrales de cobertura: ≥90 % de líneas y funciones, ≥92 % de ramas",
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
    nameLabel: "El nombre",
    nameHref: "/es/about-the-name",
    tutorialLabel: "Tutorial: la API de una librería",
  },
  security: {
    eyebrow: "Seguridad y cadena de suministro",
    title:
      "Valores seguros por defecto: la capa de defensa para el código generado por IA",
    body: "Cuando un modelo de IA genera el código, la velocidad a la que teclea el desarrollador deja de ser el cuello de botella: lo que importa es la seguridad en tiempo de ejecución y la integridad de la cadena de suministro. DaloyJS aplica las barreras en la capa de ejecución: límites de tamaño del cuerpo de la petición, tiempos de espera, protección frente a la contaminación de prototipos, ocultación de los detalles de los errores 5xx y negativa a arrancar ante configuraciones erróneas, sin dependencias transitivas que explotar.",
  },
  features: {
    secureDefaults: {
      title: "Valores de ejecución seguros por defecto",
      body: "A diferencia de los frameworks que dejan las protecciones básicas en manos de plugins o de un enrutado de errores manual, el núcleo de DaloyJS arranca con las barreras activadas: límites de tamaño del cuerpo, tiempos de espera por petición, JSON a salvo de la contaminación de prototipos, respuestas 405 Method Not Allowed correctas y ocultación de los detalles de los errores 5xx que falla de forma segura (activa en todas partes salvo en un entorno de desarrollo o de pruebas declarado explícitamente). En producción se niega a arrancar ante las configuraciones erróneas que conoce, como secretos de sesión débiles o cookies de sesión sin CSRF.",
      badges: [
        "Límites del cuerpo (1 MiB por defecto)",
        "Tiempos de espera por petición",
        "Defensa contra la contaminación de prototipos",
        "RFC 9457 problem+json",
        "Validación estricta de esquemas",
        "Comprobaciones de configuración al arrancar",
      ],
    },
    zeroDeps: {
      title: "Cero dependencias en tiempo de ejecución",
      body: "Instalar @daloyjs/core añade exactamente cero paquetes transitivos. Ni scripts postinstall que auditar ni CVE inesperados en dependencias que nunca elegiste. El framework no aporta un árbol de dependencias propio; las demás dependencias de tu aplicación siguen siendo cosa tuya.",
      stat: {
        value: "0",
        label: "paquetes transitivos en @daloyjs/core",
      },
    },
    supplyChain: {
      title: "Plantillas reforzadas para la cadena de suministro",
      body: "Elige pnpm en create-daloy y pnpm-workspace.yaml ya viene reforzado: ignoreScripts bloquea las cargas maliciosas en scripts de instalación (no el código que se ejecuta al importar), un minimumReleaseAge de 24 horas deja pasar de largo las versiones maliciosas recién publicadas que se detectan a tiempo, y verifyStoreIntegrity mantiene honestas las instalaciones. El paquete de seguridad opcional añade GitHub Actions reforzadas, Dependabot, CODEOWNERS, SECURITY.md, verificación del origen del lockfile, plantillas de contenedor sin root y con tini, y daloy doctor, un validador de la configuración de producción.",
      badges: [
        "ignoreScripts",
        "minimumReleaseAge de 24 h",
        "verifyStoreIntegrity",
        "Actions fijadas por SHA",
        "Auditoría con daloy doctor",
      ],
    },
    aiNative: {
      title: "Plantillas preparadas para la IA",
      body: "Todo proyecto creado con create-daloy incluye un AGENTS.md y skills de contexto, y esta documentación se puede leer por MCP. Los agentes de programación que leen AGENTS.md aprenden las convenciones de tu framework, las reglas de enrutado y las primitivas de seguridad sin rituales de prompt engineering.",
      badges: ["Incluye AGENTS.md", "Skills de contexto", "Legible por MCP"],
    },
    streaming: {
      title: "Streaming y observabilidad",
      body: "Utilidades de SSE y NDJSON que respetan la contrapresión, y un hook de trazas de OpenTelemetry que emite spans de servidor HTTP con los atributos de las convenciones semánticas.",
      badges: [
        "SSE con contrapresión",
        "Streaming NDJSON",
        "Spans HTTP de OTel",
      ],
    },
    portable: {
      title: "Portable entre entornos de ejecución",
      body: "El núcleo solo ve Request → Response. Los adaptadores viven en el borde: Node, Bun, Deno, Cloudflare Workers, Vercel, Fastly Compute y AWS Lambda. La misma aplicación y las mismas pruebas.",
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
      title: "Basado en contratos desde el diseño",
      body: "Una sola definición de ruta es la fuente de verdad para la validación, los tipos, OpenAPI 3.1, el cliente tipado y las pruebas de contrato integradas, así que las discrepancias tienen menos sitios donde esconderse.",
      badges: [
        "Validación en tiempo de ejecución",
        "Especificación OpenAPI 3.1",
        "Cliente tipado con Hey API",
        "Pruebas de contrato integradas",
      ],
    },
    typedClients: {
      title: "Clientes tipados con Hey API",
      body: "Ejecuta pnpm gen y obtén un SDK fetch totalmente tipado, para cualquier consumidor y en cualquier proyecto TS, generado a partir de tu especificación real. O sáltate la generación de código con el cliente tipado en proceso.",
      badges: ["pnpm gen", "Sin configuración", "SDK fetch tipado de extremo a extremo"],
    },
    batteries: {
      title: "Pilas incluidas",
      body: "Sesiones aptas para el edge, WebSockets que gastan de los mismos cupos de limitación de peticiones que HTTP, logs estructurados y apagado ordenado: la fontanería de producción que normalmente montas a base de plugins, y aun así sin dependencias en tiempo de ejecución.",
      badges: [
        "Sesiones en el edge",
        "Límites de peticiones en WebSocket",
        "Logs estructurados",
        "Apagado ordenado",
      ],
    },
  },
  benchmarks: {
    eyebrow: "Benchmarks y rendimiento",
    title: "Las cifras, con la letra pequeña incluida",
    body: "Cuando los agentes de IA encadenan herramientas y lanzan peticiones con mucha concurrencia, el rendimiento y la latencia del arranque en frío pasan a ser críticos. DaloyJS trae las comprobaciones de seguridad activadas por defecto, y estos benchmarks miden el rendimiento con todas las protecciones en marcha.",
    charts: BENCHMARK_CHARTS_ES,
  },
  mcp: {
    eyebrow: "Nativo para máquinas: para agentes y herramientas de IA",
    title: "DaloyJS está listo para MCP",
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
        (MCP) es el estándar abierto que usan agentes de IA como Claude, Cursor
        y VS Code para llamar a herramientas y leer documentación. DaloyJS lo
        soporta en ambos extremos: tu aplicación puede convertirse en un
        servidor MCP, y esta documentación (en inglés) ya lo es.
      </>
    ),
    serverTitle: "Convierte tu API en un servidor MCP",
    serverBody: (
      <>
        DaloyJS crea servidores MCP solo con <code>@daloyjs/core</code>, sin
        SDK: transporte Streamable HTTP, validación de los esquemas de entrada y
        una protección al arrancar en producción que se niega a iniciar si un
        endpoint MCP no tiene un hook de autenticación en su cadena. Comprueba
        que el hook está ahí y, en producción, que se ha ejecutado en cada
        petición, no que rechace a nadie, así que prueba también tu
        autenticación.
      </>
    ),
    serverCta: "Crea un servidor MCP →",
    serverSnippet: MCP_SERVER_SNIPPET,
    docsTitle: "Lee esta documentación por MCP",
    docsBody:
      "Un endpoint público de solo lectura en el que tu agente de programación puede buscar y leer sin copiar y pegar. No hace falta clave de API.",
    endpointTitle: "Endpoint",
    endpointBody: "Apunta cualquier cliente compatible con MCP a esta URL:",
    tools: {
      search_docs:
        "Búsqueda por palabras clave en todas las páginas de la documentación, ordenada por relevancia.",
      get_doc: "Lee el texto completo de una página por su ruta o su slug.",
      list_docs:
        "Consulta todas las páginas de documentación disponibles en una sola llamada.",
    },
    configLabel: "Añádelo a la configuración de tu cliente MCP",
    stdioNote: "¿Usas un cliente que solo admite stdio? Conéctalo con",
  },
  contracts: {
    eyebrow: "Contener el radio de impacto",
    title: "Contratos como recintos de seguridad, no como sintaxis decorativa",
    body: "En un flujo de trabajo centrado en la IA, los contratos no son un lujo estético para humanos: son la frontera que la máquina hace cumplir y que impide que estructuras de datos alucinadas se filtren entre componentes. Un solo contrato de ruta valida estrictamente las peticiones, acota las respuestas y genera en vivo la especificación OpenAPI 3.1 y el cliente tipado.",
    flow: {
      title: "flujo del contrato",
      tagline: "defínelo una vez -> genera el resto",
      steps: [
        { label: "contrato", detail: "GET /books/:id + z.object(...)" },
        { label: "validación", detail: "en ejecución, en ambos sentidos" },
        { label: "OpenAPI 3.1", detail: "especificación en vivo + /docs" },
        { label: "cliente tipado", detail: "pnpm gen -> SDK fetch" },
      ],
    },
    helloWorld: HELLO_WORLD,
  },
  scalar: {
    title: "Referencia de API con Scalar, en una línea",
    body: (
      <>
        Scalar es el sucesor moderno de Swagger UI: rápido, limpio, con modo
        oscuro nativo y peticiones de prueba integradas. En DaloyJS es la
        interfaz de documentación <em>por defecto</em>, no un plugin:{" "}
        <code>docs: true</code> en el constructor de <code>App</code> monta
        automáticamente esta página en <code>/docs</code> y la especificación
        OpenAPI 3.1 en vivo en <code>/openapi.json</code>.
      </>
    ),
    footer:
      "Se genera a partir de los contratos de tus rutas, sin código extra. ¿Prefieres Swagger UI o Redoc? Ambos están a un campo de configuración de distancia.",
    guideCta: "Guía de OpenAPI y de la interfaz de documentación →",
  },
  comparison: {
    eyebrow: "Compromisos del ecosistema",
    title: "Lo mejor de cada competidor, con menos renuncias",
    body: "DaloyJS no intenta ganar en una sola casilla. Intenta eliminar el trabajo de pegamento entre las mejores ideas que a los desarrolladores ya les gustan.",
    youWant: "Quieres",
    todayPrefix: "Hoy:",
    todaysBest: "Lo mejor hoy",
    daloyGives: "Lo que te da DaloyJS",
    rows: [
      {
        want: "Refuerzo portable de la cadena de suministro para las aplicaciones que creas",
        best: "valores por defecto de pnpm + núcleo sin dependencias",
        give: "Ajustes de instalación de pnpm reforzados, lockfiles con origen verificado, SBOM + procedencia de npm",
      },
      {
        want: "Encaje en serverless / edge",
        best: "Hono",
        give: "Núcleo basado en estándares web, adaptadores para varios runtimes",
      },
      {
        want: "Operaciones y documentación maduras en Node",
        best: "Fastify",
        give: "Plugins encapsulados, logs estructurados, apagado ordenado",
      },
      {
        want: "DX moderna centrada en TS, compatible con Bun",
        best: "Elysia",
        give: "Handlers, contexto y cliente tipados de extremo a extremo",
      },
      {
        want: "La mejor ergonomía de OpenAPI",
        best: "FastAPI",
        give: "OpenAPI 3.1 integrado a partir de una sola definición de ruta",
      },
      {
        want: "La mejor generación de clientes tipados",
        best: "Hey API",
        give: "pnpm gen → SDK fetch totalmente tipado",
      },
    ],
  },
  cta: {
    title: "¿Todo listo para desplegar con valores seguros por defecto?",
    body: "Crea un proyecto en segundos con la instalación reforzada para tu gestor de paquetes, una CI generada que bloquea los scripts de instalación, GitHub Actions fijadas, Dependabot, CODEOWNERS y verificación del origen del lockfile. Después, mantén el contrato a medida que la aplicación crece: la misma aplicación funciona en Node, Bun, Deno y Cloudflare Workers.",
    install: "Instalar DaloyJS",
    tutorial: "Crea la API de una librería",
    source: "Ver el código fuente",
  },
  support: {
    eyebrow: "Apoya el proyecto",
    title: "Si DaloyJS te ahorra tiempo, puedes invitarme a un café",
    body: "DaloyJS es gratuito y tiene licencia MIT. Si la documentación, los artículos o el propio framework te han ayudado a sacar algo adelante con un poco menos de drama, un café es una forma perfectamente razonable de mantener vivo el trabajo.",
    coffee: "Invítame a un café",
    blog: "Leer el blog (en inglés)",
  },
};
