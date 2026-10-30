import type { BenchmarkChartsCopy } from "@/components/benchmark-charts";
import type { HomeCopy } from "./home-copy";

const HELLO_WORLD = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

// new App() wendet requestId() und secureHeaders() bereits automatisch an;
// diese expliziten Aufrufe passen die Standardwerte nur an (und ersetzen sie).
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // standardmäßig pro Client-IP; hinter einem Proxy behindProxy oder keyGenerator setzen

app.get(
  "/books/:id",
  {
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Gefunden", body: z.object({ id: z.string(), title: z.string() }) },
      404: { description: "Nicht gefunden" },
    },
  },
  async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`Buch \${params.id}\` },
  }),
);

serve(app, { port: 3000 });`;

const MCP_SERVER_SNIPPET = `import { App, bearerAuth, createMcpHandler, mcpRoutes } from "@daloyjs/core";

const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  tools: [/* Ihre Tools, mit validierten Eingabeschemas */],
});

const app = new App();
app.use(bearerAuth({ validate: checkToken })); // ohne Auth-Hook verweigert die Produktion den Start
for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route); // Ihre API ist jetzt auch ein MCP-Server
}`;

/** German strings for the benchmark charts (plain data: crosses to the client). */
const BENCHMARK_CHARTS_DE: BenchmarkChartsCopy = {
  heading: "Wie DaloyJS im Vergleich abschneidet",
  intro:
    "Echte Zahlen aus der eigenen Benchmark-Suite des Repositorys. Wählen Sie eine Metrik, behalten Sie aber die Hinweise unten im Blick: Keiner dieser Vergleiche ist wirklich gleichwertig.",
  tabs: {
    deps: {
      trigger: "Abhängigkeiten",
      title: "Installierte transitive Abhängigkeiten",
      description:
        "Jedes Paket, das die Installation mitbringt, ist Angriffsfläche, der jemand vertrauen muss. DaloyJS und Hono sind die einzigen beiden, die keine einzige mitbringen.",
      takeaway:
        "DaloyJS installiert 0 transitive Abhängigkeiten und teilt sich mit Hono die kleinste Angriffsfläche in der Lieferkette, während eine abgesicherte NestJS-Anwendung 86 mitzieht.",
      soWhat:
        "Weniger Pakete, denen man vertrauen muss, bedeuten weniger CVEs und keine überraschenden postinstall-Skripte. Null Abhängigkeiten heißt, dass das Framework keine eigenen Türen in der Lieferkette öffnet; den Rest Ihres Abhängigkeitsbaums müssen Sie weiterhin selbst prüfen.",
    },
    install: {
      trigger: "Installationsgröße",
      title: "Belegter Speicherplatz",
      description:
        "Gesamte Megabytes in node_modules für eine „Hello World“-Anwendung, minimal im Vergleich zu einer abgesicherten Konfiguration (Sicherheitsparität).",
      takeaway:
        "DaloyJS belegt rund 2,4 MB auf der Festplatte und wächst nicht, wenn Sie die Sicherheit einschalten, weil die Härtung bereits im Kern steckt. Fastify und NestJS blähen sich auf, sobald Sie die entsprechenden Plugins nachrüsten.",
      soWhat:
        "Kleinere Installationen bedeuten schnellere CI-Läufe, schlankere Docker-Images und schnellere Kaltstarts in Serverless und am Edge.",
    },
    bundle: {
      trigger: "Bundle-Größe",
      title: "Gebündelte, mit gzip komprimierte Ausgabe",
      description:
        "Produktions-Build in einer einzigen Datei, mit gzip komprimiert. Je kleiner, desto schneller das Deployment am Edge und der Kaltstart.",
      takeaway:
        "DaloyJS kommt komprimiert auf rund 61 kB in der minimalen und rund 67 kB in der sicheren Variante, direkt hinter Hono und nur ein Bruchteil der Bundles von Express oder Nest, obwohl es standardmäßig mehr mitbringt.",
      soWhat:
        "Ein kleineres Bundle startet nach einem Kaltstart schneller, sodass der erste Nutzer Ihrer Edge-Funktion oder Ihres Serverless-Endpunkts weniger wartet.",
    },
    throughput: {
      trigger: "Durchsatz",
      title: "Requests pro Sekunde mit Middleware-Stack",
      description:
        "Beide Frameworks laufen mit einem vergleichbaren Middleware-Stack auf denselben Routen bei 100 Verbindungen. Das ist die faire Version der Durchsatzfrage: Was kostet es, wenn beide Seiten wirklich arbeiten?",
      takeaway:
        "Mit vergleichbarer Middleware auf beiden Seiten liegt DaloyJS in jedem Szenario vor Hono: rund 25,2k gegenüber 19,7k Requests pro Sekunde auf statischen Routen (rund 28 % mehr) und rund 22,5k gegenüber 14,3k auf der POST-Route mit Body (rund 58 % mehr), und validiert diesen Body dabei zusätzlich mit Zod. Standardmäßig aktive Sicherheit und Validierung kosten Sie den Benchmark nicht mehr.",
      soWhat:
        "Sicherheit und Validierung sind auf Framework-Ebene praktisch kostenlos. Ihr eigentlicher Engpass werden Datenbank und Netzwerk sein, nicht DaloyJS.",
    },
  },
  seriesMinimal: "Minimal",
  seriesSecure: "Sicherheitsparität",
  depsUnit: "Abhängigkeiten",
  scenarios: {
    "Static route": "Statische Route",
    "Dynamic route": "Dynamische Route",
    "POST + body": "POST + Body",
  },
  soWhatLabel: "Was das für Sie bedeutet:",
  takeawayLabel: "Fazit:",
  ranAt: "Oktober 2026",
  sourceIn: "Code in",
  caveatsTitle: "Warum das ein Vergleich von Äpfeln mit Birnen ist",
  caveatsIntro:
    "Diese Frameworks sind nicht dasselbe Werkzeug, daher gleicht ein direkter Vergleich eher Äpfeln und Birnen als einem fairen Rennen. Hier steht verständlich, was diese Zahlen belegen und was nicht.",
  notes: [
    "Äpfel und Birnen, kein Vergleich auf Augenhöhe. Es sind unterschiedliche Werkzeuge, die unterschiedlich viel Arbeit leisten. Bei jedem Request validiert DaloyJS den Body gegen Ihr Zod- oder Valibot-Schema und setzt sichere Header, eine Request-ID, Größenlimits für den Body und Timeouts, alles standardmäßig. Die „minimalen“ Anwendungen der anderen Frameworks tun davon kaum etwas, und selbst die „Sicherheitsparität“ entspricht dem selten Punkt für Punkt. Ein Teil jeder DaloyJS-Zahl ist also Sicherheit und Validierung, die Sie sonst selbst bauen müssten.",
    "Die Größe wird unterschiedlich gemessen: DaloyJS ist ein einziges Paket ohne Abhängigkeiten, während die anderen transitive Bäume auflösen, deren genaue Größe davon abhängt, wann das Lockfile erzeugt wurde.",
    "Der Durchsatz hängt von der Last ab: Mit vergleichbarem Middleware-Stack auf beiden Seiten liegt DaloyJS auf diesen GET-Routen rund 27 % und auf der POST-Route mit Body rund 58 % vor Hono, und DaloyJS validiert diesen Body zusätzlich mit Zod. Echte Dienste werden meist durch Datenbank und I/O begrenzt, nicht durch das Dispatching des Frameworks, daher sagen solche Mikrozahlen die Produktion selten voraus.",
    "Unterschiedliche Ziel-Laufzeiten: Manche Frameworks (etwa Elysia) sind für Bun optimiert, werden hier aber über ihre Node-Adapter gemessen, um eine faire Basis auf einer einzigen Laufzeit zu haben.",
    "Eine Maschine, ein Zeitpunkt: ein Apple M3 Max, Node v26.4.0, Oktober 2026, mit @daloyjs/core 1.5.4 und weiterer Last im Hintergrund (beide Frameworks wurden direkt nacheinander gemessen, der Vergleich ist also belastbarer als die absoluten Zahlen). Ihre Hardware, Laufzeit und Versionen werden diese Zahlen verschieben.",
  ],
};

/** Standard German (de) landing-page copy. Mirrors `HOME_COPY_EN`. */
export const HOME_COPY_DE: HomeCopy = {
  locale: "de",
  links: {
    gettingStarted: "/de/docs/getting-started",
    docs: "/de/docs",
    installation: "/de/docs/installation",
    tutorial: "/de/docs/tutorials/bookstore",
    mcp: "/docs/mcp",
    openapi: "/de/docs/openapi",
    blog: "/blog",
  },
  hero: {
    title: "Contract-first REST-APIs in TypeScript mit sicheren Standardeinstellungen, gebaut für Teams, die mit KI entwickeln",
    subtitle:
      "DaloyJS bringt sichere Standardeinstellungen mit, verweigert in Produktion den Start bei Fehlkonfigurationen, die es kennt, und läuft ohne eine einzige Laufzeitabhängigkeit, mit einer gehärteten, per Provenance signierten Veröffentlichungspipeline. Kein Framework macht eine Anwendung vollständig sicher oder stoppt jeden Angriff auf die Lieferkette, deshalb sagt die Dokumentation klar, was standardmäßig aktiv ist, was Sie selbst einschalten und welche Risiken bleiben.",
    primaryCta: "Loslegen: Daloy installieren",
    secondaryCta: "Dokumentation lesen",
    contentLanguageNote:
      "Die Einstiegsseiten und Kernleitfäden (Routing, Validierung, Fehler, OpenAPI, typisierter Client, Sicherheit) gibt es auf Deutsch; der Rest der Doku und der Blog sind auf Englisch.",
    factsLabel: "Das Projekt in Zahlen",
    facts: [
      "Über 3.000 bestandene Framework-Tests",
      "Coverage-Schwellen: ≥90 % Zeilen und Funktionen, ≥92 % Branches",
      "0 Laufzeitabhängigkeiten",
      "Node 24 LTS, Node 26+, Bun, Deno, Cloudflare",
      "MIT-Lizenz",
    ],
    nameNote: (
      <>
        <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔</span> Daloy
        bedeutet auf Tagalog <span className="text-foreground">„Fluss“</span>{" "}
        (ausgesprochen{" "}
        <span className="whitespace-nowrap text-foreground">da-loy</span>).
      </>
    ),
    aboutLabel: "Über uns",
    aboutHref: "/de/about",
    nameLabel: "Zum Namen",
    nameHref: "/de/about-the-name",
    tutorialLabel: "Tutorial: API für einen Buchladen",
  },
  security: {
    eyebrow: "Sicherheit und Lieferkette",
    title: "Standardmäßig sicher: die Schutzschicht für KI-generierten Code",
    body: "Wenn KI-Modelle den Code schreiben, ist nicht mehr die Tippgeschwindigkeit der Engpass, sondern Laufzeitsicherheit und die Integrität der Lieferkette. DaloyJS setzt Schutzmechanismen auf Laufzeitebene durch: Größenlimits für den Request-Body, Timeouts, Schutz vor Prototype Pollution, das Ausblenden von Details bei 5xx-Fehlern und die Verweigerung des Starts bei Fehlkonfigurationen, ganz ohne transitive Abhängigkeiten, die sich ausnutzen ließen.",
  },
  features: {
    secureDefaults: {
      title: "Sichere Laufzeit-Standardeinstellungen",
      body: "Anders als Frameworks, die grundlegende Schutzmaßnahmen Plugins oder manuellem Fehler-Routing überlassen, startet der Kern von DaloyJS mit aktiven Schutzmechanismen: Größenlimits für den Body, Request-Timeouts, gegen Prototype Pollution abgesichertes JSON, korrekte 405-Method-Not-Allowed-Antworten und das Ausblenden von 5xx-Details, das im Fehlerfall sicher bleibt (überall aktiv außer in einer ausdrücklich deklarierten Entwicklungs- oder Testumgebung). In Produktion verweigert es den Start bei Fehlkonfigurationen, die es kennt, etwa schwachen Session-Secrets oder Session-Cookies ohne CSRF-Schutz.",
      badges: [
        "Body-Limits (Standard 1 MiB)",
        "Request-Timeouts",
        "Schutz vor Prototype Pollution",
        "RFC 9457 problem+json",
        "Strikte Schema-Validierung",
        "Konfigurationsprüfung beim Start",
      ],
    },
    zeroDeps: {
      title: "Null Laufzeitabhängigkeiten",
      body: "Die Installation von @daloyjs/core fügt genau null transitive Pakete hinzu. Keine postinstall-Skripte zum Prüfen und keine überraschenden CVEs aus Abhängigkeiten, die Sie nie gewählt haben. Das Framework bringt keinen eigenen Abhängigkeitsbaum mit; die übrigen Abhängigkeiten Ihrer Anwendung prüfen Sie weiterhin selbst.",
      stat: {
        value: "0",
        label: "transitive Pakete in @daloyjs/core",
      },
    },
    supplyChain: {
      title: "Gegen Lieferkettenangriffe gehärtete Vorlagen",
      body: "Wählen Sie in create-daloy pnpm, und pnpm-workspace.yaml ist bereits gehärtet: ignoreScripts blockiert Schadcode in Installationsskripten (nicht Code, der beim Import läuft), ein minimumReleaseAge von 24 Stunden lässt frisch veröffentlichte schädliche Versionen verstreichen, die rechtzeitig entdeckt werden, und verifyStoreIntegrity hält Installationen ehrlich. Das optionale Sicherheitspaket ergänzt gehärtete GitHub Actions, Dependabot, CODEOWNERS, SECURITY.md, die Prüfung der Lockfile-Herkunft, Container-Vorlagen ohne Root mit tini und daloy doctor, einen Validator für die Produktionskonfiguration.",
      badges: [
        "ignoreScripts",
        "minimumReleaseAge 24 h",
        "verifyStoreIntegrity",
        "Per SHA gepinnte Actions",
        "Prüfung mit daloy doctor",
      ],
    },
    aiNative: {
      title: "Für KI gemachte Vorlagen",
      body: "Jedes mit create-daloy erstellte Projekt enthält eine AGENTS.md und Kontext-Skills, und diese Dokumentation ist über MCP lesbar. Coding-Agenten, die AGENTS.md lesen, übernehmen die Konventionen Ihres Frameworks, die Routing-Regeln und die Sicherheitsprimitiven ohne Prompt-Engineering-Ritual.",
      badges: ["AGENTS.md enthalten", "Kontext-Skills", "Über MCP lesbar"],
    },
    streaming: {
      title: "Streaming und Observability",
      body: "Hilfsfunktionen für SSE und NDJSON, die Backpressure respektieren, sowie ein OpenTelemetry-Tracing-Hook, der HTTP-Server-Spans mit den Attributen der semantischen Konventionen erzeugt.",
      badges: ["SSE mit Backpressure", "NDJSON-Streaming", "OTel-HTTP-Server-Spans"],
    },
    portable: {
      title: "Portabel zwischen Laufzeiten",
      body: "Der Kern sieht nur Request → Response. Die Adapter leben am Rand: Node, Bun, Deno, Cloudflare Workers, Vercel, Fastly Compute und AWS Lambda. Dieselbe Anwendung, dieselben Tests.",
      badges: ["Node 24+", "Bun", "Deno", "Cloudflare Workers", "Vercel", "AWS Lambda"],
    },
    contractFirst: {
      title: "Contract-first von Grund auf",
      body: "Eine einzige Routendefinition ist die maßgebliche Quelle für Validierung, Typen, OpenAPI 3.1, den typisierten Client und eingebaute Vertragstests, sodass Abweichungen kaum noch Verstecke finden.",
      badges: ["Validierung zur Laufzeit", "OpenAPI-3.1-Spezifikation", "Typisierter Hey-API-Client", "Eingebaute Vertragstests"],
    },
    typedClients: {
      title: "Typisierte Clients mit Hey API",
      body: "Führen Sie pnpm gen aus und erhalten Sie ein vollständig typisiertes fetch-SDK für jeden Consumer in jedem TS-Projekt, generiert aus Ihrer echten Spezifikation. Oder verzichten Sie mit dem typisierten In-Process-Client ganz auf Codegenerierung.",
      badges: ["pnpm gen", "Ohne Konfiguration", "Durchgängig typisiertes fetch-SDK"],
    },
    batteries: {
      title: "Alles inklusive",
      body: "Edge-taugliche Sessions, WebSockets, die aus denselben Rate-Limit-Kontingenten schöpfen wie HTTP, strukturierte Logs und ein geordnetes Herunterfahren: die Produktionsinfrastruktur, die Sie sonst aus Plugins zusammensetzen, weiterhin ohne Laufzeitabhängigkeiten.",
      badges: ["Edge-Sessions", "Rate-Limits für WebSocket", "Strukturierte Logs", "Geordnetes Herunterfahren"],
    },
  },
  benchmarks: {
    eyebrow: "Benchmarks und Performance",
    title: "Die Zahlen, mit Kleingedrucktem",
    body: "Wenn KI-Agenten Tools in Schleifen aufrufen und Requests mit hoher Parallelität senden, werden Durchsatz und Kaltstartlatenz entscheidend. DaloyJS hat Sicherheitsprüfungen standardmäßig aktiv, und diese Benchmarks messen die Performance mit allen Schutzmechanismen eingeschaltet.",
    charts: BENCHMARK_CHARTS_DE,
  },
  mcp: {
    eyebrow: "Für Maschinen gebaut: KI-Agenten und Tools",
    title: "DaloyJS ist bereit für MCP",
    intro: (
      <>
        Das{" "}
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noreferrer"
          hrefLang="en"
          className="underline underline-offset-4"
        >
          Model Context Protocol
        </a>{" "}
        (MCP) ist der offene Standard, über den KI-Agenten wie Claude, Cursor
        und VS Code Tools aufrufen und Dokumentation lesen. DaloyJS unterstützt
        beide Seiten: Ihre Anwendung kann ein MCP-Server werden, und diese
        Dokumentation (auf Englisch) ist bereits einer.
      </>
    ),
    serverTitle: "Machen Sie Ihre API zum MCP-Server",
    serverBody: (
      <>
        DaloyJS baut MCP-Server allein mit <code>@daloyjs/core</code>, ohne
        SDK: Streamable-HTTP-Transport, Validierung der Eingabeschemas und eine
        Startsperre in Produktion, die nicht hochfährt, wenn in der Kette eines
        MCP-Endpunkts kein Auth-Hook steckt. Sie prüft, dass der Hook vorhanden
        ist und in Produktion bei jedem Request lief, nicht aber, dass er
        jemanden abweist; testen Sie Ihre Authentifizierung also auch selbst.
      </>
    ),
    serverCta: "MCP-Server bauen →",
    serverSnippet: MCP_SERVER_SNIPPET,
    docsTitle: "Lesen Sie diese Dokumentation über MCP",
    docsBody:
      "Ein öffentlicher, schreibgeschützter Endpunkt, den Ihr Coding-Agent ohne Kopieren und Einfügen durchsuchen und lesen kann. Kein API-Schlüssel nötig.",
    endpointTitle: "Endpunkt",
    endpointBody: "Richten Sie jeden MCP-kompatiblen Client auf diese URL:",
    tools: {
      search_docs: "Stichwortsuche über alle Dokumentationsseiten, sortiert nach Relevanz.",
      get_doc: "Den vollständigen Text einer Seite über ihre Route oder ihren Slug lesen.",
      list_docs: "Alle verfügbaren Dokumentationsseiten mit einem Aufruf auflisten.",
    },
    configLabel: "Fügen Sie ihn zur Konfiguration Ihres MCP-Clients hinzu",
    stdioNote: "Ihr Client kann nur stdio? Verbinden Sie ihn über",
  },
  contracts: {
    eyebrow: "Den Schadensradius begrenzen",
    title: "Verträge als Sicherheitsbarrieren, nicht als Syntaxschmuck",
    body: "In einem KI-zentrierten Workflow sind Verträge kein ästhetischer Luxus für Menschen: Sie sind die von der Maschine durchgesetzte Grenze, die verhindert, dass halluzinierte Datenstrukturen zwischen Komponenten durchsickern. Ein einziger Routenvertrag validiert Requests strikt, begrenzt Antworten und liefert live die OpenAPI-3.1-Spezifikation und den typisierten Client.",
    flow: {
      title: "Vertragsfluss",
      tagline: "einmal definieren -> den Rest generieren",
      steps: [
        { label: "Vertrag", detail: "GET /books/:id + z.object(...)" },
        { label: "Validierung", detail: "zur Laufzeit, in beide Richtungen" },
        { label: "OpenAPI 3.1", detail: "Live-Spezifikation + /docs" },
        { label: "typisierter Client", detail: "pnpm gen -> fetch-SDK" },
      ],
    },
    helloWorld: HELLO_WORLD,
  },
  scalar: {
    title: "Scalar-API-Referenz in einer Zeile",
    body: (
      <>
        Scalar ist der moderne Nachfolger von Swagger UI: schnell, aufgeräumt,
        mit nativem Dark Mode und eingebauten Test-Requests. In DaloyJS ist es
        die <em>Standard</em>-Oberfläche für die Dokumentation, kein Plugin:{" "}
        <code>docs: true</code> im Konstruktor von <code>App</code> bindet
        diese Seite automatisch unter <code>/docs</code> und die
        Live-Spezifikation OpenAPI 3.1 unter <code>/openapi.json</code> ein.
      </>
    ),
    footer:
      "Generiert aus Ihren Routenverträgen, ohne zusätzlichen Code. Lieber Swagger UI oder Redoc? Beide sind nur ein Konfigurationsfeld entfernt.",
    guideCta: "Leitfaden zu OpenAPI und Doku-Oberfläche →",
  },
  comparison: {
    eyebrow: "Abwägungen im Ökosystem",
    title: "Die Stärken der Konkurrenz, mit weniger Kompromissen",
    body: "DaloyJS will nicht in einer einzelnen Disziplin gewinnen. Es will die Klebearbeit zwischen den besten Ideen beseitigen, die Entwickler ohnehin schätzen.",
    youWant: "Sie wollen",
    todayPrefix: "Heute:",
    todaysBest: "Das Beste heute",
    daloyGives: "Was DaloyJS Ihnen bietet",
    rows: [
      {
        want: "Portable Härtung der Lieferkette für Ihre Anwendungen",
        best: "pnpm-Standards + Kern ohne Abhängigkeiten",
        give: "Gehärtete pnpm-Installationseinstellungen, Lockfiles mit geprüfter Herkunft, SBOM + npm-Provenance",
      },
      {
        want: "Passend für Serverless / Edge",
        best: "Hono",
        give: "Kern auf Basis von Webstandards, Adapter für mehrere Laufzeiten",
      },
      {
        want: "Ausgereifter Betrieb und Doku für Node",
        best: "Fastify",
        give: "Gekapselte Plugins, strukturierte Logs, geordnetes Herunterfahren",
      },
      {
        want: "Moderne TS-first-DX, Bun-tauglich",
        best: "Elysia",
        give: "Durchgängig typisierte Handler, typisierter Kontext und typisierter Client",
      },
      {
        want: "Die beste OpenAPI-Ergonomie",
        best: "FastAPI",
        give: "Eingebautes OpenAPI 3.1 aus einer einzigen Routendefinition",
      },
      {
        want: "Die beste Generierung typisierter Clients",
        best: "Hey API",
        give: "pnpm gen → vollständig typisiertes fetch-SDK",
      },
    ],
  },
  cta: {
    title: "Bereit, mit sicheren Standardeinstellungen auszuliefern?",
    body: "Legen Sie in Sekunden ein Projekt an, mit gehärteter Installation für Ihren Paketmanager, generierter CI, die Installationsskripte blockiert, gepinnten GitHub Actions, Dependabot, CODEOWNERS und Prüfung der Lockfile-Herkunft. Behalten Sie dann den Vertrag bei, während die Anwendung wächst: Dieselbe Anwendung läuft auf Node, Bun, Deno und Cloudflare Workers.",
    install: "DaloyJS installieren",
    tutorial: "Eine Buchladen-API bauen",
    source: "Quellcode ansehen",
  },
  support: {
    eyebrow: "Das Projekt unterstützen",
    title: "Wenn Ihnen DaloyJS Zeit spart, können Sie mir einen Kaffee spendieren",
    body: "DaloyJS ist kostenlos und MIT-lizenziert. Wenn die Dokumentation, die Artikel oder das Framework selbst Ihnen geholfen haben, etwas mit etwas weniger Drama auszuliefern, ist ein Kaffee eine durchaus vernünftige Art, die Arbeit am Laufen zu halten.",
    coffee: "Kaffee spendieren",
    blog: "Blog lesen (auf Englisch)",
  },
};
