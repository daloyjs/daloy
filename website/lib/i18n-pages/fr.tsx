import type { TranslatedPagesCopy } from "./types";

/**
 * French (fr-FR) copy for the translated pages under `/fr`. See
 * {@link TranslatedPagesCopy} for the English sources it mirrors. The landing
 * page body lives in `components/home/home-copy-fr.tsx`.
 *
 * Style: France French, formal "vous", typographic apostrophes, guillemets
 * for quotations, and no em dashes. French is offered only through the
 * header language menu (see `PROMOTED_LOCALES` in lib/i18n.ts).
 */
export const PAGES_COPY_FR: TranslatedPagesCopy = {
  listSeparator: ", ",
  end: ".",
  home: {
    title:
      "API REST TypeScript orientées contrat et sûres par défaut, pensées pour les équipes qui développent avec l’IA",
    documentTitle: "API TypeScript orientées contrat, sûres par défaut",
    description:
      "Réglages sûrs par défaut, refus de démarrer en production sur une configuration erronée, zéro dépendance et clients typés OpenAPI 3.1 issus d’un contrat.",
    keywords: [
      "DaloyJS en français",
      "framework TypeScript",
      "API REST TypeScript",
      "sûr par défaut",
      "OpenAPI 3.1",
      "client typé",
      "chaîne d’approvisionnement",
      "zéro dépendance",
      "serveur MCP",
    ],
    ogFooter: "Sûr par défaut · Zéro dépendance d’exécution",
  },
  about: {
    title: "À propos de DaloyJS",
    description:
      "Ce qu’est DaloyJS, qui le maintient, et comment ce framework TypeScript open source, orienté contrat et sûr par défaut, est publié et sous quelle licence.",
    keywords: ["à propos de DaloyJS", "équipe DaloyJS", "mainteneur DaloyJS", "Devlin Duldulao"],
    heading: "À propos de DaloyJS",
    paragraphs: [
      "DaloyJS est un framework web TypeScript orienté contrat et portable d’un environnement d’exécution à l’autre. Une seule définition de route fait foi pour la validation, OpenAPI 3.1, les clients typés et le handler HTTP. Le runtime n’a aucune dépendance npm, applique des réglages sûrs par défaut (limites de taille du corps, délais d’expiration des requêtes, assainissement des en-têtes, listes d’algorithmes JWT autorisés, comparaisons à temps constant, parseurs protégés contre la pollution de prototype et un wrapper fetch optionnel protégé contre le SSRF) et exécute la même application sur Node.js, Bun, Deno, Cloudflare Workers et Vercel.",
      "Le projet est open source sous licence MIT. Le framework est publié sous le nom @daloyjs/core sur npm et @daloyjs/daloy sur JSR, à partir du même code source TypeScript. Créez une nouvelle application avec pnpm create daloy@latest. Le code source, le suivi des tickets, le journal des modifications et la politique de sécurité se trouvent dans le dépôt GitHub, à l’adresse github.com/daloyjs/daloy.",
      "Daloy signifie « flux » en tagalog et se prononce da-loy. Le nom rappelle que les requêtes, les réponses, les contrats, les types et les clients générés doivent avancer dans un seul et même flux au lieu de se disperser entre les couches. Une note plus détaillée sur le nom se trouve sur /fr/about-the-name.",
      "DaloyJS est maintenu par Devlin Duldulao, développeur fullstack philippin installé en Norvège, avec l’aide de contributeurs bénévoles. C’est un projet logiciel, pas une entreprise immatriculée avec des bureaux ouverts au public. Les questions techniques, le parrainage et les signalements de sécurité passent par la page de contact. Les premiers pas, l’installation et le tutoriel de la documentation sont traduits en français ; le reste de la documentation technique et le blog sont en anglais.",
    ],
    more: {
      label: "Plus :",
      links: [
        { href: "/fr/contact", label: "contact" },
        { href: "/fr/privacy", label: "confidentialité" },
        { href: "/fr/about-the-name", label: "à propos du nom" },
        { href: "/fr/docs", label: "la documentation en français" },
      ],
      lastSeparator: " et ",
    },
  },
  aboutTheName: {
    title: "À propos du nom",
    description:
      "Ce que signifie Daloy, comment le prononcer et pourquoi ce framework TypeScript porte ce nom tagalog, qui veut dire « flux », comme marque de son identité.",
    keywords: ["signification de Daloy", "prononciation de Daloy", "nom DaloyJS", "flux en tagalog"],
    heading: "À propos du nom",
    body: (
      <>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          <span className="font-medium text-foreground">Daloy</span> signifie{" "}
          <strong>flux</strong> en tagalog. Nous le prononçons{" "}
          <strong>da-loy</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          L’écriture en baybayin{" "}
          <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔ </span> fait
          partie de l’identité du projet, mais dans la pratique le nom du
          framework reste simple :{" "}
          <strong className="text-foreground">DaloyJS</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          Le nom correspond au produit : les requêtes, les réponses, les
          contrats, les types et les clients générés avancent dans un seul flux
          orienté contrat au lieu de se disperser entre des couches séparées.
        </p>
      </>
    ),
  },
  contact: {
    title: "Contacter DaloyJS",
    description:
      "E-mail, tickets GitHub et canal privé pour signaler une vulnérabilité dans DaloyJS : voici comment joindre les mainteneurs du projet et à quel sujet.",
    keywords: ["contacter DaloyJS", "e-mail DaloyJS", "contact sécurité DaloyJS", "daloyjs@gmail.com"],
    heading: "Contacter DaloyJS",
    paragraphs: [
      "Le moyen le plus rapide de joindre les mainteneurs de DaloyJS est l’e-mail : daloyjs@gmail.com. Utilisez cette adresse pour signaler une erreur dans la documentation, poser une question sur une version, parler de parrainage ou de tout ce qui n’est pas une vulnérabilité. La boîte de réception est traitée en anglais. Ce site n’a ni téléphone ni chat ; l’e-mail est le canal qui atteint réellement une personne.",
      "Pour les bogues, les questions sur l’API et les demandes de fonctionnalités, ouvrez un ticket GitHub sur github.com/daloyjs/daloy. Les tickets restent publics, consultables et liés au code, ce qui en fait de meilleures archives qu’une boîte de réception privée pour le travail sur le produit. Les pull requests sont les bienvenues lorsqu’elles incluent des tests et n’affaiblissent aucun réglage de sécurité par défaut.",
      "Pour signaler une vulnérabilité présumée, n’ouvrez pas de ticket public contenant les détails de l’exploit. Utilisez le signalement privé de vulnérabilités de GitHub sur github.com/daloyjs/daloy/security/advisories/new, ou écrivez à daloyjs@gmail.com avec suffisamment d’informations pour la reproduire et sans preuve de concept plus volumineuse que nécessaire. La politique de sécurité, les versions prises en charge et les délais de correction figurent dans SECURITY.md, dans le dépôt, et sur /.well-known/security.txt.",
      "Profils sociaux et de paquets, si vous voulez vérifier que ce site correspond bien au même projet : GitHub (github.com/daloyjs/daloy), npm (@daloyjs/core), JSR (@daloyjs/daloy), Open Collective (opencollective.com/daloyjs), X/Twitter (@daloyjs), Bluesky (daloyjs.dev), Mastodon (@daloyjs@mastodon.social) et dev.to/daloyjs. La politique de confidentialité sur /fr/privacy explique ce que ce site collecte lorsque vous le consultez.",
    ],
    directLabel: "Liens directs :",
    issues: "tickets GitHub",
    advisory: "avis de sécurité privé",
    privacyLabel: ". Confidentialité : ",
  },
  privacy: {
    title: "Politique de confidentialité de DaloyJS",
    description:
      "Les données que collecte daloyjs.dev, les prestataires qui traitent le trafic et la façon de joindre les mainteneurs pour une question de confidentialité.",
    keywords: ["confidentialité DaloyJS", "politique de confidentialité daloyjs.dev", "mesure d’audience DaloyJS"],
    heading: "Politique de confidentialité de DaloyJS",
    updated: "Dernière mise à jour : 29 octobre 2026",
    appliesTo: "S’applique à",
    courtesy: {
      before: "Ceci est une traduction proposée pour faciliter la lecture. En cas de divergence, la ",
      link: "version anglaise",
      after: " fait foi.",
    },
    paragraphs: [
      "Cette politique de confidentialité s’applique au site de présentation et de documentation de DaloyJS sur daloyjs.dev. Elle ne s’applique pas aux applications que vous construisez avec le framework @daloyjs/core : elles vous appartiennent, et vous êtes le responsable du traitement des données de leurs utilisateurs. Le site est un site de documentation statique. Il n’a ni comptes utilisateur, ni connexion, ni paiement, ni base de données des visiteurs côté serveur.",
      "Lorsque vous chargez une page, nous recevons les métadonnées de requête que voit n’importe quel serveur HTTPS : adresse IP, agent utilisateur, URL demandée et page de provenance. L’hébergement et la diffusion reposent sur Vercel. Vercel peut traiter ces métadonnées pour exploiter le service, absorber les abus et produire des statistiques de trafic agrégées. Nous chargeons aussi Vercel Analytics et Vercel Speed Insights, qui mesurent les visites et les Core Web Vitals sans profil publicitaire distinct. Google Analytics (propriété G-DSBFBZT7RQ) sert à produire des rapports de trafic agrégés. Le serveur MCP de la documentation sur /mcp compte, dans Vercel Analytics, combien de recherches sont rédigées dans une autre langue que l’anglais et si elles ont trouvé une page ; il ne conserve ni n’envoie le texte de la recherche, votre adresse IP ou vos cookies. Ces prestataires agissent en tant que sous-traitants pour ce site. Nous ne vendons pas de données personnelles, n’utilisons pas de pixel de reciblage et n’ajoutons pas les données des visiteurs à une liste marketing.",
      "Le site enregistre dans le navigateur une préférence de thème (clair, sombre ou celui du système) via next-themes, afin que l’interface ne clignote pas au rechargement. Un service worker sur /sw.js peut mettre en cache des pages déjà ouvertes pour la page hors ligne /offline. Ces deux éléments restent sur votre appareil. Si vous écrivez à daloyjs@gmail.com, sur GitHub ou sur Open Collective, les conditions et les règles de conservation de ce tiers s’appliquent au message envoyé ; nous ne conservons la correspondance que le temps nécessaire pour vous répondre ou pour garder une trace de sécurité.",
      "Comme le mainteneur vit en Norvège, nous prenons la réglementation européenne sur la protection des données comme référence, même s’il s’agit d’un petit projet open source. Vous pouvez demander quelles données nous détenons sur vous, nous demander de supprimer la correspondance ou vous opposer à la mesure d’audience en écrivant à daloyjs@gmail.com. Vous pouvez aussi bloquer la mesure d’audience dans votre navigateur, et lire ce site en Markdown (Accept: text/markdown) ou via /llms.txt sans exécuter notre JavaScript. Cette politique a été mise à jour pour la dernière fois le 29 octobre 2026. Si elle change de manière substantielle, nous daterons ici la nouvelle version.",
    ],
    questions: "Questions de confidentialité :",
    otherContact: ". Autres moyens de contact : ",
  },
  docsIndex: {
    title: "Documentation en français",
    description:
      "Premiers pas avec DaloyJS en français : installation, première route orientée contrat et un tutoriel complet. Le reste de la documentation est en anglais.",
    keywords: ["documentation DaloyJS", "DaloyJS en français", "tutoriel API TypeScript", "premiers pas DaloyJS"],
    heading: "Documentation en français",
    intro:
      "Ces pages vous mènent d’un dossier vide à une API typée et testée. Ce sont des traductions de la documentation originale en anglais ; le reste de la documentation technique (sécurité, adaptateurs, référence de l’API, etc.) n’existe pour l’instant qu’en anglais.",
  },
};
