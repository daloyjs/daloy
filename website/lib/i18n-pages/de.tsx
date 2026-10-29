import type { TranslatedPagesCopy } from "./types";

/**
 * Standard German (de) copy for the translated pages under `/de`. See
 * {@link TranslatedPagesCopy} for the English sources it mirrors. The landing
 * page body lives in `components/home/home-copy-de.tsx`.
 *
 * Style: Hochdeutsch for Germany, Austria and Switzerland alike, formal
 * "Sie", „…“ quotation marks, and no em dashes. German is offered only
 * through the header language menu (see `PROMOTED_LOCALES` in lib/i18n.ts).
 */
export const PAGES_COPY_DE: TranslatedPagesCopy = {
  listSeparator: ", ",
  end: ".",
  home: {
    title: "Contract-first REST-APIs in TypeScript, standardmäßig sicher, gebaut für Teams, die mit KI entwickeln",
    description:
      "Sichere Standardeinstellungen, kein Start in Produktion bei bekannten Fehlkonfigurationen, null Laufzeitabhängigkeiten und typisierte OpenAPI-3.1-Clients.",
    keywords: [
      "DaloyJS auf Deutsch",
      "TypeScript-Framework",
      "REST-API mit TypeScript",
      "standardmäßig sicher",
      "OpenAPI 3.1",
      "typisierter Client",
      "Lieferkettensicherheit",
      "null Abhängigkeiten",
      "MCP-Server",
    ],
    ogFooter: "Standardmäßig sicher · Null Laufzeitabhängigkeiten",
  },
  about: {
    title: "Über DaloyJS",
    description:
      "Was DaloyJS ist, wer es pflegt und wie dieses quelloffene, vertragsbasierte und standardmäßig sichere TypeScript-Framework lizenziert und veröffentlicht wird.",
    keywords: ["über DaloyJS", "DaloyJS-Team", "DaloyJS-Maintainer", "Devlin Duldulao"],
    heading: "Über DaloyJS",
    paragraphs: [
      "DaloyJS ist ein vertragsbasiertes (contract-first) Web-Framework für TypeScript, das zwischen Laufzeitumgebungen portabel ist. Eine einzige Routendefinition ist die maßgebliche Quelle für Validierung, OpenAPI 3.1, typisierte Clients und den HTTP-Handler. Die Laufzeit hat keine einzige npm-Abhängigkeit, bringt sichere Standardeinstellungen mit (Größenlimits für den Request-Body, Request-Timeouts, Bereinigung von Headern, Allowlists für JWT-Algorithmen, Vergleiche in konstanter Zeit, gegen Prototype Pollution abgesicherte Parser und einen optionalen, gegen SSRF geschützten fetch-Wrapper) und führt dieselbe Anwendung auf Node.js, Bun, Deno, Cloudflare Workers und Vercel aus.",
      "Das Projekt ist quelloffen und steht unter der MIT-Lizenz. Das Framework wird als @daloyjs/core auf npm und als @daloyjs/daloy auf JSR aus demselben TypeScript-Quellcode veröffentlicht. Eine neue Anwendung legen Sie mit pnpm create daloy@latest an. Quellcode, Issue-Tracker, Changelog und Sicherheitsrichtlinie liegen im GitHub-Repository unter github.com/daloyjs/daloy.",
      "Daloy bedeutet auf Tagalog „Fluss“ und wird da-loy ausgesprochen. Der Name erinnert daran, dass Requests, Responses, Verträge, Typen und generierte Clients in einem gemeinsamen Fluss laufen sollten, statt über die Schichten hinweg auseinanderzudriften. Eine ausführlichere Notiz zum Namen finden Sie unter /de/about-the-name.",
      "DaloyJS wird von Devlin Duldulao gepflegt, einem philippinischen Fullstack-Entwickler, der in Norwegen lebt, gemeinsam mit ehrenamtlichen Mitwirkenden. Es ist ein Softwareprojekt, kein eingetragenes Unternehmen mit Büro für Besucher. Technische Fragen, Sponsoring und Sicherheitsmeldungen laufen über die Kontaktseite. Erste Schritte, Installation und das Tutorial der Dokumentation sind ins Deutsche übersetzt; die übrige technische Dokumentation und der Blog sind auf Englisch.",
    ],
    more: {
      label: "Mehr:",
      links: [
        { href: "/de/contact", label: "Kontakt" },
        { href: "/de/privacy", label: "Datenschutz" },
        { href: "/de/about-the-name", label: "zum Namen" },
        { href: "/de/docs", label: "die Dokumentation auf Deutsch" },
      ],
      lastSeparator: " und ",
    },
  },
  aboutTheName: {
    title: "Zum Namen",
    description:
      "Was Daloy bedeutet, wie man es ausspricht und warum dieses TypeScript-Framework den Tagalog-Namen für „Fluss“ als Zeichen seiner Identität trägt.",
    keywords: ["Bedeutung von Daloy", "Aussprache von Daloy", "Name DaloyJS", "Fluss auf Tagalog"],
    heading: "Zum Namen",
    body: (
      <>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          <span className="font-medium text-foreground">Daloy</span> bedeutet
          auf Tagalog <strong>„Fluss“</strong>. Wir sprechen es{" "}
          <strong>da-loy</strong> aus.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          Die Schreibweise in Baybayin{" "}
          <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔ </span> gehört
          zur Identität des Projekts, im Alltag bleibt der Name des Frameworks
          aber schlicht:{" "}
          <strong className="text-foreground">DaloyJS</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          Der Name passt zum Produkt: Requests, Responses, Verträge, Typen und
          generierte Clients bewegen sich in einem gemeinsamen, vertragsbasierten
          Fluss, statt sich auf getrennte Schichten zu verteilen.
        </p>
      </>
    ),
  },
  contact: {
    title: "Kontakt zu DaloyJS",
    description:
      "E-Mail, GitHub-Issues und der vertrauliche Kanal für Sicherheitslücken in DaloyJS: So erreichen Sie die Maintainer des Projekts und mit welchen Anliegen.",
    keywords: ["Kontakt DaloyJS", "DaloyJS E-Mail", "DaloyJS Sicherheitskontakt", "daloyjs@gmail.com"],
    heading: "Kontakt zu DaloyJS",
    paragraphs: [
      "Am schnellsten erreichen Sie die Maintainer von DaloyJS per E-Mail: daloyjs@gmail.com. Nutzen Sie diese Adresse für Fehler in der Dokumentation, Fragen zu Releases, Sponsoring und alles, was keine Sicherheitslücke ist. Das Postfach wird auf Englisch betreut. Auf dieser Website gibt es weder Telefon noch Chat; E-Mail ist der Kanal, der tatsächlich einen Menschen erreicht.",
      "Für Bugs, Fragen zur API und Feature-Wünsche öffnen Sie bitte ein Issue auf GitHub unter github.com/daloyjs/daloy. Issues bleiben öffentlich, durchsuchbar und mit dem Code verknüpft und sind für die Produktarbeit daher ein besseres Archiv als ein privates Postfach. Pull Requests sind willkommen, wenn sie Tests enthalten und keine sichere Standardeinstellung abschwächen.",
      "Wenn Sie eine mögliche Sicherheitslücke melden möchten, öffnen Sie bitte kein öffentliches Issue mit Details zum Exploit. Nutzen Sie die vertrauliche Meldung von Sicherheitslücken auf GitHub unter github.com/daloyjs/daloy/security/advisories/new oder schreiben Sie an daloyjs@gmail.com, mit genug Informationen zur Reproduktion und ohne einen größeren Proof of Concept als nötig. Sicherheitsrichtlinie, unterstützte Versionen und Fristen für Fixes stehen in SECURITY.md im Repository und unter /.well-known/security.txt.",
      "Social-Media- und Paketprofile, falls Sie prüfen möchten, dass diese Website zum selben Projekt gehört: GitHub (github.com/daloyjs/daloy), npm (@daloyjs/core), JSR (@daloyjs/daloy), Open Collective (opencollective.com/daloyjs), X/Twitter (@daloyjs), Bluesky (daloyjs.dev), Mastodon (@daloyjs@mastodon.social) und dev.to/daloyjs. Die Datenschutzerklärung unter /de/privacy erklärt, was diese Website bei Ihrem Besuch erfasst.",
    ],
    directLabel: "Direkte Links:",
    issues: "GitHub-Issues",
    advisory: "vertrauliche Sicherheitsmeldung",
    privacyLabel: ". Datenschutz: ",
  },
  privacy: {
    title: "Datenschutzerklärung von DaloyJS",
    description:
      "Welche Daten die Website daloyjs.dev erfasst, welche Anbieter den Datenverkehr verarbeiten und wie Sie die Maintainer bei Fragen zum Datenschutz erreichen.",
    keywords: ["Datenschutz DaloyJS", "Datenschutzerklärung daloyjs.dev", "Webanalyse DaloyJS"],
    heading: "Datenschutzerklärung von DaloyJS",
    updated: "Zuletzt aktualisiert: 29. Oktober 2026",
    appliesTo: "Gilt für",
    courtesy: {
      before: "Dies ist eine Übersetzung zur besseren Lesbarkeit. Bei Abweichungen gilt die ",
      link: "englische Fassung",
      after: ".",
    },
    paragraphs: [
      "Diese Datenschutzerklärung gilt für die Informations- und Dokumentationswebsite von DaloyJS unter daloyjs.dev. Sie gilt nicht für Anwendungen, die Sie mit dem Framework @daloyjs/core bauen: Diese Anwendungen gehören Ihnen, und Sie sind der Verantwortliche für die Daten ihrer Nutzer. Die Website ist eine statische Dokumentationsseite. Sie hat keine Benutzerkonten, keine Anmeldung, keinen Bezahlvorgang und keine serverseitige Datenbank über Besucher.",
      "Wenn Sie eine Seite laden, erhalten wir die Request-Metadaten, die jeder HTTPS-Server sieht: IP-Adresse, User-Agent, angeforderte URL und Referrer. Hosting und Auslieferung laufen über Vercel. Vercel kann diese Metadaten verarbeiten, um den Dienst zu betreiben, Missbrauch abzuwehren und aggregierte Statistiken über den Datenverkehr zu erstellen. Außerdem laden wir Vercel Analytics und Vercel Speed Insights, die Besuche und Core Web Vitals ohne separates Werbeprofil messen. Google Analytics (Property G-DSBFBZT7RQ) wird für aggregierte Berichte über den Datenverkehr genutzt. Der MCP-Server der Dokumentation unter /mcp zählt in Vercel Analytics, wie viele Suchanfragen in einer anderen Sprache als Englisch gestellt werden und ob sie eine Seite gefunden haben; er speichert und sendet weder den Suchtext noch Ihre IP-Adresse oder Cookies. Diese Anbieter handeln als Auftragsverarbeiter für diese Website. Wir verkaufen keine personenbezogenen Daten, setzen kein Remarketing-Pixel ein und fügen Besucherdaten keiner Marketingliste hinzu.",
      "Die Website speichert im Browser eine Einstellung für das Farbschema (hell, dunkel oder wie im System) über next-themes, damit die Oberfläche beim Neuladen nicht flackert. Ein Service Worker unter /sw.js kann zuvor geöffnete Seiten für die Offline-Seite unter /offline zwischenspeichern. Beides bleibt auf Ihrem Gerät. Wenn Sie an daloyjs@gmail.com, über GitHub oder über Open Collective schreiben, gelten für Ihre Nachricht die Bedingungen und Aufbewahrungsregeln dieses Drittanbieters; wir bewahren Korrespondenz nur so lange auf, wie es für eine Antwort oder einen Sicherheitsnachweis nötig ist.",
      "Da der Maintainer in Norwegen lebt, nehmen wir die europäischen Datenschutzregeln als Maßstab, auch wenn dies ein kleines Open-Source-Projekt ist. Sie können erfragen, welche Daten wir über Sie haben, die Löschung von Korrespondenz verlangen oder der Webanalyse widersprechen, indem Sie an daloyjs@gmail.com schreiben. Sie können die Webanalyse auch im Browser blockieren und diese Website als Markdown (Accept: text/markdown) oder über /llms.txt lesen, ohne unser JavaScript auszuführen. Diese Erklärung wurde zuletzt am 29. Oktober 2026 aktualisiert. Ändert sie sich wesentlich, datieren wir die neue Fassung hier.",
    ],
    questions: "Fragen zum Datenschutz:",
    otherContact: ". Weitere Kontaktmöglichkeiten: ",
  },
  docsIndex: {
    title: "Dokumentation auf Deutsch",
    description:
      "Starten Sie mit DaloyJS auf Deutsch: Installation, die erste vertragsbasierte Route und ein vollständiges Tutorial. Die übrige Dokumentation ist auf Englisch.",
    keywords: ["DaloyJS-Dokumentation", "DaloyJS auf Deutsch", "TypeScript-API-Tutorial", "Erste Schritte DaloyJS"],
    heading: "Dokumentation auf Deutsch",
    intro:
      "Diese Seiten führen Sie von einem leeren Ordner zu einer typisierten, getesteten API. Es sind Übersetzungen der englischen Originaldokumentation; die übrige technische Dokumentation (Sicherheit, Adapter, API-Referenz und mehr) gibt es vorerst nur auf Englisch.",
  },
};
