import type { BenchmarkChartsCopy } from "@/components/benchmark-charts";
import type { HomeCopy } from "./home-copy";

const HELLO_WORLD = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

// new App() applique déjà requestId() et secureHeaders() automatiquement ;
// ces appels explicites ne font que personnaliser (et remplacer) les valeurs par défaut.
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // par IP client par défaut ; derrière un proxy, configurez behindProxy ou keyGenerator

app.get(
  "/books/:id",
  {
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Trouvé", body: z.object({ id: z.string(), title: z.string() }) },
      404: { description: "Introuvable" },
    },
  },
  async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`Livre \${params.id}\` },
  }),
);

serve(app, { port: 3000 });`;

const MCP_SERVER_SNIPPET = `import { App, bearerAuth, createMcpHandler, mcpRoutes } from "@daloyjs/core";

const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  tools: [/* vos outils, avec des schémas d’entrée validés */],
});

const app = new App();
app.use(bearerAuth({ validate: checkToken })); // sans hook d’authentification, la production refuse de démarrer
for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route); // votre API est désormais aussi un serveur MCP
}`;

/** French strings for the benchmark charts (plain data: crosses to the client). */
const BENCHMARK_CHARTS_FR: BenchmarkChartsCopy = {
  heading: "Comment DaloyJS se compare",
  intro:
    "Des chiffres réels issus de la suite de benchmarks du dépôt. Choisissez une métrique, mais gardez à l’esprit les réserves ci-dessous : aucune de ces comparaisons n’est parfaitement équitable.",
  tabs: {
    deps: {
      trigger: "Dépendances",
      title: "Dépendances transitives installées",
      description:
        "Chaque paquet tiré par l’installation est une surface d’attaque à laquelle quelqu’un doit faire confiance. DaloyJS et Hono sont les deux seuls à n’en ajouter aucune.",
      takeaway:
        "DaloyJS installe 0 dépendance transitive, à égalité avec Hono pour la plus petite surface d’exposition de la chaîne d’approvisionnement, alors qu’une application NestJS sécurisée en embarque 86.",
      soWhat:
        "Moins de paquets à qui faire confiance, c’est moins de CVE et aucun script postinstall inattendu. Zéro dépendance signifie que le framework n’ouvre aucune porte de son côté dans la chaîne d’approvisionnement ; le reste de votre arbre de dépendances reste à vérifier par vos soins.",
    },
    install: {
      trigger: "Taille installée",
      title: "Espace occupé sur le disque",
      description:
        "Mégaoctets écrits au total dans node_modules pour une application « hello world », en version minimale et en configuration renforcée (parité de sécurité).",
      takeaway:
        "DaloyJS occupe environ 2,4 Mo sur le disque et ne grossit pas quand vous activez la sécurité, car le renforcement est déjà dans le cœur. Fastify et NestJS gonflent dès que vous rajoutez les plugins équivalents.",
      soWhat:
        "Des installations plus légères, c’est une CI plus rapide, des images Docker plus minces et des démarrages à froid plus rapides en serverless et à l’edge.",
    },
    bundle: {
      trigger: "Taille du bundle",
      title: "Sortie empaquetée et compressée avec gzip",
      description:
        "Build de production en un seul fichier, compressé avec gzip. Plus il est petit, plus il se déploie vite à l’edge et démarre vite à froid.",
      takeaway:
        "DaloyJS pèse environ 61 ko compressé en version minimale et environ 67 ko en version sécurisée, juste derrière Hono et pour une fraction des bundles Express ou Nest, tout en embarquant davantage de fonctionnalités par défaut.",
      soWhat:
        "Un bundle plus petit démarre plus vite après un démarrage à froid : le premier utilisateur qui atteint votre fonction edge ou votre endpoint serverless attend moins.",
    },
    throughput: {
      trigger: "Débit",
      title: "Requêtes par seconde, avec une pile de middlewares",
      description:
        "Les deux frameworks exécutent une pile de middlewares comparable sur les mêmes routes avec 100 connexions. C’est la version équitable de la question du débit : combien cela coûte-t-il quand les deux font vraiment du travail ?",
      takeaway:
        "Avec des middlewares comparables des deux côtés, DaloyJS devance Hono dans tous les scénarios : environ 25,2k contre 19,7k requêtes/s sur les routes statiques (environ 28 % de plus) et environ 22,5k contre 14,3k sur la route POST avec corps (environ 58 % de plus), tout en validant ce corps avec Zod. Activer la sécurité et la validation par défaut ne vous coûte plus le benchmark.",
      soWhat:
        "La sécurité et la validation sont pratiquement gratuites au niveau du framework. Votre vrai goulot d’étranglement sera la base de données et le réseau, pas DaloyJS.",
    },
  },
  seriesMinimal: "Minimale",
  seriesSecure: "Parité de sécurité",
  depsUnit: "dépendances",
  scenarios: {
    "Static route": "Route statique",
    "Dynamic route": "Route dynamique",
    "POST + body": "POST + corps",
  },
  soWhatLabel: "Ce que cela signifie pour vous :",
  takeawayLabel: "À retenir :",
  ranAt: "octobre 2026",
  sourceIn: "code dans",
  caveatsTitle: "Pourquoi on compare des pommes et des oranges",
  caveatsIntro:
    "Ces frameworks ne sont pas le même outil : un graphique face à face ressemble donc plus à une comparaison entre pommes et oranges qu’à une course équitable. Voici, simplement, ce que ces chiffres prouvent et ce qu’ils ne prouvent pas.",
  notes: [
    "Des pommes et des oranges, pas une comparaison à armes égales. Ce sont des outils différents qui font des quantités de travail différentes. À chaque requête, DaloyJS valide le corps contre votre schéma Zod ou Valibot et applique des en-têtes sécurisés, un identifiant de requête, des limites de taille du corps et des délais d’expiration, le tout par défaut. Les applications « minimales » des autres frameworks n’en font presque rien, et même la « parité de sécurité » l’égale rarement point par point. Une partie de chaque chiffre de DaloyJS correspond donc à de la sécurité et de la validation que vous devriez sinon construire vous-même.",
    "La méthode de mesure de la taille diffère : DaloyJS est un paquet unique sans dépendances, tandis que les autres résolvent des arbres transitifs dont la taille exacte dépend de la date de génération du lockfile.",
    "Le débit dépend de la charge : avec une pile de middlewares comparable des deux côtés, DaloyJS devance Hono d’environ 27 % sur ces routes GET et d’environ 58 % sur la route POST avec corps, et DaloyJS valide en plus ce corps avec Zod. Les services réels sont généralement limités par la base de données et les entrées/sorties, pas par le dispatch du framework : ces micro-chiffres prédisent donc rarement la production.",
    "Des environnements d’exécution cibles différents : certains frameworks (par exemple Elysia) sont optimisés pour Bun, mais sont mesurés ici avec leurs adaptateurs Node pour disposer d’une base équitable sur un seul runtime.",
    "Une seule machine, un seul moment : un Apple M3 Max, Node v26.4.0, octobre 2026, avec @daloyjs/core 1.5.4 et une autre charge en arrière-plan sur la machine (les deux frameworks ont été mesurés l’un après l’autre, la comparaison tient donc mieux que les chiffres absolus). Votre matériel, votre runtime et vos versions feront bouger ces chiffres.",
  ],
};

/** French (fr-FR) landing-page copy. Mirrors `HOME_COPY_EN`. */
export const HOME_COPY_FR: HomeCopy = {
  locale: "fr",
  links: {
    gettingStarted: "/fr/docs/getting-started",
    docs: "/fr/docs",
    installation: "/fr/docs/installation",
    tutorial: "/fr/docs/tutorials/bookstore",
    mcp: "/docs/mcp",
    openapi: "/fr/docs/openapi",
    blog: "/blog",
  },
  hero: {
    title:
      "Des API REST TypeScript orientées contrat et sûres par défaut, pensées pour les équipes qui développent avec l’IA",
    subtitle:
      "DaloyJS fournit des réglages sûrs par défaut, refuse de démarrer en production face aux erreurs de configuration qu’il connaît et fonctionne sans aucune dépendance d’exécution, avec une chaîne de publication renforcée et signée avec provenance. Aucun framework ne rend une application totalement sûre ni n’arrête toutes les attaques sur la chaîne d’approvisionnement : la documentation indique donc ce qui est activé par défaut, ce que vous activez vous-même et les risques qui subsistent.",
    primaryCta: "Commencer : installer Daloy",
    secondaryCta: "Lire la documentation",
    contentLanguageNote:
      "Les premiers pas, l’installation, le tutoriel et les guides essentiels (routage, validation, erreurs, OpenAPI, client typé, sécurité) existent en français ; le reste de la documentation et le blog sont en anglais.",
    factsLabel: "Le projet en bref",
    facts: [
      "Plus de 3000 tests du framework au vert",
      "Seuils de couverture : ≥90 % lignes et fonctions, ≥92 % branches",
      "0 dépendance d’exécution",
      "Node 24 LTS, Node 26+, Bun, Deno, Cloudflare",
      "Licence MIT",
    ],
    nameNote: (
      <>
        <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔</span> Daloy
        signifie <span className="text-foreground">flux</span> en tagalog (se
        prononce{" "}
        <span className="whitespace-nowrap text-foreground">da-loy</span>).
      </>
    ),
    aboutLabel: "À propos",
    aboutHref: "/fr/about",
    nameLabel: "Le nom",
    nameHref: "/fr/about-the-name",
    tutorialLabel: "Tutoriel : l’API d’une librairie",
  },
  security: {
    eyebrow: "Sécurité et chaîne d’approvisionnement",
    title: "Sûr par défaut : la couche de défense pour le code généré par l’IA",
    body: "Quand un modèle d’IA écrit le code, la vitesse de frappe du développeur n’est plus le goulot d’étranglement : ce qui compte, c’est la sécurité à l’exécution et l’intégrité de la chaîne d’approvisionnement. DaloyJS applique des garde-fous au niveau de l’exécution : limites de taille du corps des requêtes, délais d’expiration, protection contre la pollution de prototype, masquage des détails des erreurs 5xx et refus de démarrer sur une configuration erronée, sans aucune dépendance transitive à exploiter.",
  },
  features: {
    secureDefaults: {
      title: "Réglages d’exécution sûrs par défaut",
      body: "Contrairement aux frameworks qui laissent les protections de base aux plugins ou à un routage des erreurs fait main, le cœur de DaloyJS démarre avec les garde-fous activés : limites de taille du corps, délais d’expiration des requêtes, JSON protégé contre la pollution de prototype, véritables réponses 405 Method Not Allowed et masquage des détails des erreurs 5xx qui échoue en position sûre (actif partout sauf dans un environnement de développement ou de test déclaré explicitement). En production, il refuse de démarrer face aux erreurs de configuration qu’il connaît, comme des secrets de session faibles ou des cookies de session sans CSRF.",
      badges: [
        "Limites du corps (1 Mio par défaut)",
        "Délais d’expiration",
        "Défense contre la pollution de prototype",
        "RFC 9457 problem+json",
        "Validation stricte des schémas",
        "Contrôles de configuration au démarrage",
      ],
    },
    zeroDeps: {
      title: "Zéro dépendance d’exécution",
      body: "Installer @daloyjs/core n’ajoute exactement aucun paquet transitif. Aucun script postinstall à auditer, aucune CVE surprise venue de dépendances que vous n’avez jamais choisies. Le framework n’ajoute aucun arbre de dépendances qui lui soit propre ; les autres dépendances de votre application restent à vérifier par vos soins.",
      stat: {
        value: "0",
        label: "paquet transitif dans @daloyjs/core",
      },
    },
    supplyChain: {
      title: "Modèles renforcés pour la chaîne d’approvisionnement",
      body: "Choisissez pnpm dans create-daloy et pnpm-workspace.yaml est déjà renforcé : ignoreScripts bloque les charges malveillantes des scripts d’installation (pas le code exécuté à l’import), un minimumReleaseAge de 24 heures laisse passer les versions malveillantes fraîchement publiées qui sont repérées à temps, et verifyStoreIntegrity garantit l’honnêteté des installations. Le paquet de sécurité optionnel ajoute des GitHub Actions renforcées, Dependabot, CODEOWNERS, SECURITY.md, la vérification de l’origine du lockfile, des modèles de conteneur sans root avec tini et daloy doctor, un validateur de configuration de production.",
      badges: [
        "ignoreScripts",
        "minimumReleaseAge de 24 h",
        "verifyStoreIntegrity",
        "Actions épinglées par SHA",
        "Audit daloy doctor",
      ],
    },
    aiNative: {
      title: "Des modèles conçus pour l’IA",
      body: "Chaque projet créé avec create-daloy inclut un AGENTS.md et des skills de contexte, et cette documentation est lisible via MCP. Les agents de code qui lisent AGENTS.md adoptent les conventions de votre framework, ses règles de routage et ses primitives de sécurité sans rituel de prompt engineering.",
      badges: ["AGENTS.md inclus", "Skills de contexte", "Lisible via MCP"],
    },
    streaming: {
      title: "Streaming et observabilité",
      body: "Des utilitaires SSE et NDJSON qui respectent la contre-pression, plus un hook de traces OpenTelemetry qui émet des spans de serveur HTTP avec les attributs des conventions sémantiques.",
      badges: ["SSE avec contre-pression", "Streaming NDJSON", "Spans HTTP OTel"],
    },
    portable: {
      title: "Portable entre les runtimes",
      body: "Le cœur ne voit que Request → Response. Les adaptateurs vivent en bordure : Node, Bun, Deno, Cloudflare Workers, Vercel, Fastly Compute et AWS Lambda. Même application, mêmes tests.",
      badges: ["Node 24+", "Bun", "Deno", "Cloudflare Workers", "Vercel", "AWS Lambda"],
    },
    contractFirst: {
      title: "Orienté contrat dès la conception",
      body: "Une seule définition de route fait foi pour la validation, les types, OpenAPI 3.1, le client typé et les tests de contrat intégrés : les divergences ont moins d’endroits où se cacher.",
      badges: [
        "Validation à l’exécution",
        "Spécification OpenAPI 3.1",
        "Client typé Hey API",
        "Tests de contrat intégrés",
      ],
    },
    typedClients: {
      title: "Clients typés avec Hey API",
      body: "Lancez pnpm gen et obtenez un SDK fetch entièrement typé, pour n’importe quel consommateur et dans n’importe quel projet TS, généré à partir de votre vraie spécification. Ou passez-vous de la génération de code grâce au client typé en processus.",
      badges: ["pnpm gen", "Zéro configuration", "SDK fetch typé de bout en bout"],
    },
    batteries: {
      title: "Tout est fourni",
      body: "Des sessions adaptées à l’edge, des WebSockets qui puisent dans les mêmes quotas de limitation de débit que HTTP, des logs structurés et un arrêt propre : la tuyauterie de production que vous assemblez d’habitude à coups de plugins, toujours sans aucune dépendance d’exécution.",
      badges: ["Sessions edge", "Limites de débit WebSocket", "Logs structurés", "Arrêt propre"],
    },
  },
  benchmarks: {
    eyebrow: "Benchmarks et performances",
    title: "Les chiffres, avec les astérisques",
    body: "Quand des agents d’IA enchaînent les outils et envoient des requêtes à forte concurrence, le débit et la latence de démarrage à froid deviennent critiques. DaloyJS active les contrôles de sécurité par défaut, et ces benchmarks mesurent les performances avec toutes les protections en place.",
    charts: BENCHMARK_CHARTS_FR,
  },
  mcp: {
    eyebrow: "Pensé pour les machines : agents et outils d’IA",
    title: "DaloyJS est prêt pour MCP",
    intro: (
      <>
        Le{" "}
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noreferrer"
          hrefLang="en"
          className="underline underline-offset-4"
        >
          Model Context Protocol
        </a>{" "}
        (MCP) est le standard ouvert qu’utilisent des agents d’IA comme Claude,
        Cursor et VS Code pour appeler des outils et lire de la documentation.
        DaloyJS le prend en charge des deux côtés : votre application peut
        devenir un serveur MCP, et cette documentation (en anglais) en est déjà
        un.
      </>
    ),
    serverTitle: "Transformez votre API en serveur MCP",
    serverBody: (
      <>
        DaloyJS construit des serveurs MCP avec <code>@daloyjs/core</code>{" "}
        seul, sans SDK : transport Streamable HTTP, validation des schémas
        d’entrée et une protection au démarrage en production qui refuse de se
        lancer si un endpoint MCP n’a aucun hook d’authentification dans sa
        chaîne. Elle vérifie que le hook est présent et, en production, qu’il
        s’est exécuté à chaque requête, pas qu’il refuse qui que ce soit :
        testez donc aussi votre authentification.
      </>
    ),
    serverCta: "Créer un serveur MCP →",
    serverSnippet: MCP_SERVER_SNIPPET,
    docsTitle: "Lisez cette documentation via MCP",
    docsBody:
      "Un endpoint public en lecture seule, dans lequel votre agent de code peut chercher et lire sans copier-coller. Aucune clé d’API nécessaire.",
    endpointTitle: "Endpoint",
    endpointBody: "Pointez n’importe quel client compatible MCP vers cette URL :",
    tools: {
      search_docs: "Recherche par mots-clés dans toutes les pages de la documentation, triée par pertinence.",
      get_doc: "Lit le texte complet d’une page à partir de sa route ou de son slug.",
      list_docs: "Parcourt toutes les pages de documentation disponibles en un seul appel.",
    },
    configLabel: "Ajoutez-le à la configuration de votre client MCP",
    stdioNote: "Vous utilisez un client qui ne gère que stdio ? Faites le pont avec",
  },
  contracts: {
    eyebrow: "Limiter le rayon d’impact",
    title: "Des contrats comme enceintes de sécurité, pas comme syntaxe décorative",
    body: "Dans un flux de travail centré sur l’IA, les contrats ne sont pas un luxe esthétique pour humains : ce sont des frontières que la machine fait respecter et qui empêchent des structures de données hallucinées de fuir d’un composant à l’autre. Un seul contrat de route valide strictement les requêtes, borne les réponses et produit en direct la spécification OpenAPI 3.1 et le client typé.",
    flow: {
      title: "flux du contrat",
      tagline: "définir une fois -> générer le reste",
      steps: [
        { label: "contrat", detail: "GET /books/:id + z.object(...)" },
        { label: "validation", detail: "à l’exécution, dans les deux sens" },
        { label: "OpenAPI 3.1", detail: "spécification en direct + /docs" },
        { label: "client typé", detail: "pnpm gen -> SDK fetch" },
      ],
    },
    helloWorld: HELLO_WORLD,
  },
  scalar: {
    title: "Référence d’API Scalar, en une ligne",
    body: (
      <>
        Scalar est le successeur moderne de Swagger UI : rapide, épuré, avec un
        mode sombre natif et des requêtes d’essai intégrées. Dans DaloyJS,
        c’est l’interface de documentation <em>par défaut</em>, pas un plugin :{" "}
        <code>docs: true</code> sur le constructeur <code>App</code> monte
        automatiquement cette page sur <code>/docs</code> et la spécification
        OpenAPI 3.1 en direct sur <code>/openapi.json</code>.
      </>
    ),
    footer:
      "Générée à partir des contrats de vos routes, sans code supplémentaire. Vous préférez Swagger UI ou Redoc ? Les deux sont à un champ de configuration près.",
    guideCta: "Guide OpenAPI et interface de documentation →",
  },
  comparison: {
    eyebrow: "Compromis de l’écosystème",
    title: "Le meilleur de chaque concurrent, avec moins de compromis",
    body: "DaloyJS ne cherche pas à gagner sur une seule case. Il cherche à supprimer le travail de colle entre les meilleures idées que les développeurs apprécient déjà.",
    youWant: "Vous voulez",
    todayPrefix: "Aujourd’hui :",
    todaysBest: "Le meilleur aujourd’hui",
    daloyGives: "Ce que DaloyJS vous apporte",
    rows: [
      {
        want: "Un renforcement portable de la chaîne d’approvisionnement pour vos applications",
        best: "réglages par défaut de pnpm + cœur sans dépendance",
        give: "Réglages d’installation pnpm renforcés, lockfiles à l’origine vérifiée, SBOM + provenance npm",
      },
      {
        want: "S’adapter au serverless / à l’edge",
        best: "Hono",
        give: "Cœur basé sur les standards du web, adaptateurs multi-runtime",
      },
      {
        want: "Des opérations et une documentation Node matures",
        best: "Fastify",
        give: "Plugins encapsulés, logs structurés, arrêt propre",
      },
      {
        want: "Une DX moderne centrée sur TS, compatible Bun",
        best: "Elysia",
        give: "Handlers, contexte et client typés de bout en bout",
      },
      {
        want: "La meilleure ergonomie OpenAPI",
        best: "FastAPI",
        give: "OpenAPI 3.1 intégré à partir d’une seule définition de route",
      },
      {
        want: "La meilleure génération de clients typés",
        best: "Hey API",
        give: "pnpm gen → SDK fetch entièrement typé",
      },
    ],
  },
  cta: {
    title: "Envie de livrer avec des réglages sûrs par défaut ?",
    body: "Créez un projet en quelques secondes avec une installation renforcée pour votre gestionnaire de paquets, une CI générée qui bloque les scripts d’installation, des GitHub Actions épinglées, Dependabot, CODEOWNERS et la vérification de l’origine du lockfile. Gardez ensuite le contrat à mesure que l’application grandit : la même application tourne sur Node, Bun, Deno et Cloudflare Workers.",
    install: "Installer DaloyJS",
    tutorial: "Construire l’API d’une librairie",
    source: "Voir le code source",
  },
  support: {
    eyebrow: "Soutenir le projet",
    title: "Si DaloyJS vous fait gagner du temps, vous pouvez m’offrir un café",
    body: "DaloyJS est gratuit et sous licence MIT. Si la documentation, les articles ou le framework lui-même vous ont aidé à livrer quelque chose avec un peu moins de drame, un café est une façon parfaitement raisonnable de faire vivre le projet.",
    coffee: "M’offrir un café",
    blog: "Lire le blog (en anglais)",
  },
};
