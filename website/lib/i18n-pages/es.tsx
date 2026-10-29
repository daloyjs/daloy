import type { TranslatedPagesCopy } from "./types";

/**
 * Castilian Spanish (es-ES) copy for the translated pages under `/es`. See
 * {@link TranslatedPagesCopy} for the English sources it mirrors. The landing
 * page body lives in `components/home/home-copy-es.tsx`.
 */
export const PAGES_COPY_ES: TranslatedPagesCopy = {
  listSeparator: ", ",
  end: ".",
  home: {
    title:
      "APIs REST en TypeScript basadas en contratos y seguras por defecto, pensadas para equipos que programan con IA",
    documentTitle: "APIs TypeScript por contrato y seguras por defecto",
    description:
      "Valores seguros por defecto, negativa a arrancar en producción con configuraciones erróneas, cero dependencias y clientes tipados OpenAPI 3.1 desde un contrato.",
    keywords: [
      "DaloyJS en español",
      "framework TypeScript",
      "API REST TypeScript",
      "seguro por defecto",
      "OpenAPI 3.1",
      "cliente tipado",
      "cadena de suministro",
      "cero dependencias",
      "servidor MCP",
    ],
    ogFooter: "Seguro por defecto · Cero dependencias en ejecución",
  },
  about: {
    title: "Acerca de DaloyJS",
    description:
      "Qué es DaloyJS, quién lo mantiene y cómo se licencia y se publica este framework de TypeScript de código abierto, seguro por defecto y basado en contratos.",
    keywords: ["acerca de DaloyJS", "equipo de DaloyJS", "mantenedor de DaloyJS", "Devlin Duldulao"],
    heading: "Acerca de DaloyJS",
    paragraphs: [
      "DaloyJS es un framework web de TypeScript basado en contratos y portable entre entornos de ejecución. Una sola definición de ruta es la fuente de verdad para la validación, OpenAPI 3.1, los clientes tipados y el handler HTTP. El runtime no tiene ninguna dependencia de npm, trae valores seguros por defecto (límites de tamaño del cuerpo, tiempos de espera por petición, saneamiento de cabeceras, listas de algoritmos JWT permitidos, comparaciones en tiempo constante, parsers a salvo de la contaminación de prototipos y un envoltorio de fetch opcional protegido contra SSRF) y ejecuta la misma aplicación en Node.js, Bun, Deno, Cloudflare Workers y Vercel.",
      "El proyecto es de código abierto con licencia MIT. El framework se publica como @daloyjs/core en npm y como @daloyjs/daloy en JSR a partir del mismo código TypeScript. Crea una aplicación nueva con pnpm create daloy@latest. El código fuente, el gestor de incidencias, el registro de cambios y la política de seguridad están en el repositorio de GitHub, en github.com/daloyjs/daloy.",
      "Daloy significa flujo en tagalo y se pronuncia da-loy. El nombre recuerda que las peticiones, las respuestas, los contratos, los tipos y los clientes generados deberían avanzar en un único flujo en lugar de separarse entre capas. Hay una nota más larga sobre el nombre en /es/about-the-name.",
      "DaloyJS lo mantiene Devlin Duldulao, un desarrollador fullstack filipino que vive en Noruega, junto con colaboradores voluntarios. Es un proyecto de software, no una empresa registrada con una oficina abierta al público. Las preguntas técnicas, el patrocinio y los informes de seguridad se gestionan a través de la página de contacto. Los primeros pasos, la instalación y el tutorial de la documentación están traducidos al español; el resto de la documentación técnica y el blog están en inglés.",
    ],
    more: {
      label: "Más:",
      links: [
        { href: "/es/contact", label: "contacto" },
        { href: "/es/privacy", label: "privacidad" },
        { href: "/es/about-the-name", label: "sobre el nombre" },
        { href: "/es/docs", label: "la documentación en español" },
      ],
      lastSeparator: " y ",
    },
  },
  aboutTheName: {
    title: "Sobre el nombre",
    description:
      "Qué significa Daloy, cómo se pronuncia y por qué el framework de TypeScript DaloyJS lleva este nombre tagalo, que quiere decir flujo, como seña de identidad.",
    keywords: ["significado de Daloy", "pronunciación de Daloy", "nombre DaloyJS", "flujo en tagalo"],
    heading: "Sobre el nombre",
    body: (
      <>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          <span className="font-medium text-foreground">Daloy</span> significa{" "}
          <strong>flujo</strong> en tagalo. Lo pronunciamos{" "}
          <strong>da-loy</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          La grafía en baybayin{" "}
          <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔ </span> forma
          parte de la identidad del proyecto, pero en la práctica el nombre del
          framework sigue siendo sencillo:{" "}
          <strong className="text-foreground">DaloyJS</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          El nombre encaja con el producto: las peticiones, las respuestas, los
          contratos, los tipos y los clientes generados avanzan por un único
          flujo basado en contratos en lugar de separarse en capas distintas.
        </p>
      </>
    ),
  },
  contact: {
    title: "Contactar con DaloyJS",
    description:
      "Correo electrónico, incidencias de GitHub y el canal privado para informar de vulnerabilidades en DaloyJS. Cómo ponerte en contacto con los mantenedores.",
    keywords: ["contacto DaloyJS", "correo DaloyJS", "contacto de seguridad DaloyJS", "daloyjs@gmail.com"],
    heading: "Contactar con DaloyJS",
    paragraphs: [
      "La forma más rápida de contactar con los mantenedores de DaloyJS es el correo electrónico: daloyjs@gmail.com. Usa esa dirección para errores en la documentación, preguntas sobre versiones, patrocinio y cualquier cosa que no sea una vulnerabilidad. El buzón se atiende en inglés. No hay teléfono ni chat en este sitio; el correo es el canal que de verdad llega a una persona.",
      "Para errores, preguntas sobre la API y peticiones de funcionalidades, abre una incidencia en GitHub, en github.com/daloyjs/daloy. Las incidencias son públicas, se pueden buscar y quedan ligadas al código, lo que las convierte en mejor archivo que una bandeja de entrada privada para el trabajo de producto. Las pull requests son bienvenidas cuando incluyen pruebas y no debilitan ningún valor seguro por defecto.",
      "Para informar de una posible vulnerabilidad, no abras una incidencia pública con los detalles del exploit. Usa el informe privado de vulnerabilidades de GitHub en github.com/daloyjs/daloy/security/advisories/new, o escribe a daloyjs@gmail.com con información suficiente para reproducirla y sin una prueba de concepto más grande de lo necesario. La política de seguridad, las versiones con soporte y los plazos de corrección están en SECURITY.md, en el repositorio, y en /.well-known/security.txt.",
      "Perfiles sociales y de paquetes, por si quieres comprobar que este sitio corresponde al mismo proyecto: GitHub (github.com/daloyjs/daloy), npm (@daloyjs/core), JSR (@daloyjs/daloy), Open Collective (opencollective.com/daloyjs), X/Twitter (@daloyjs), Bluesky (daloyjs.dev), Mastodon (@daloyjs@mastodon.social) y dev.to/daloyjs. La política de privacidad en /es/privacy explica qué recoge este sitio web cuando lo visitas.",
    ],
    directLabel: "Enlaces directos:",
    issues: "incidencias de GitHub",
    advisory: "aviso de seguridad privado",
    privacyLabel: ". Privacidad: ",
  },
  privacy: {
    title: "Política de privacidad de DaloyJS",
    description:
      "Qué datos recoge el sitio web daloyjs.dev, qué proveedores tratan el tráfico y cómo contactar con los mantenedores para cualquier consulta sobre privacidad.",
    keywords: ["privacidad DaloyJS", "política de privacidad daloyjs.dev", "analítica DaloyJS"],
    heading: "Política de privacidad de DaloyJS",
    updated: "Última actualización: 29 de octubre de 2026",
    appliesTo: "Se aplica a",
    courtesy: {
      before: "Esta es una traducción de cortesía. Si hay alguna discrepancia, prevalece la ",
      link: "versión en inglés",
      after: ".",
    },
    paragraphs: [
      "Esta política de privacidad se aplica al sitio web de marketing y documentación de DaloyJS en daloyjs.dev. No se aplica a las aplicaciones que construyas con el framework @daloyjs/core: esas son tuyas, y tú eres el responsable del tratamiento de los datos de sus usuarios. El sitio web es un sitio de documentación estático. No tiene cuentas de usuario, ni inicio de sesión, ni pagos, ni una base de datos de visitantes en el servidor.",
      "Cuando cargas una página recibimos los metadatos de la petición que ve cualquier servidor HTTPS: dirección IP, agente de usuario, URL solicitada y página de referencia. El alojamiento y la entrega funcionan sobre Vercel. Vercel puede tratar esos metadatos para operar el servicio, absorber abusos y elaborar estadísticas de tráfico agregadas. También cargamos Vercel Analytics y Vercel Speed Insights, que miden las visitas y las Core Web Vitals sin un perfil publicitario aparte. Google Analytics (propiedad G-DSBFBZT7RQ) se usa para informes de tráfico agregados. El servidor MCP de la documentación en /mcp cuenta en Vercel Analytics cuántas búsquedas están escritas en un idioma distinto del inglés y si encontraron alguna página; no guarda ni envía el texto de la búsqueda, tu dirección IP ni cookies. Esos proveedores actúan como encargados del tratamiento de este sitio. No vendemos datos personales, no usamos píxeles de remarketing y no añadimos los datos de los visitantes a ninguna lista de marketing.",
      "El sitio guarda en el navegador una preferencia de tema (claro, oscuro o el del sistema) mediante next-themes para que la interfaz no parpadee al recargar. Un service worker en /sw.js puede guardar en caché páginas abiertas anteriormente para la página sin conexión de /offline. Ambas cosas se quedan en tu dispositivo. Si escribes a daloyjs@gmail.com, GitHub u Open Collective, al mensaje que envíes se le aplican las condiciones y las reglas de conservación de ese tercero; solo conservamos la correspondencia el tiempo necesario para responderte o para mantener un registro de seguridad.",
      "Como el mantenedor vive en Noruega, la normativa europea de protección de datos es la referencia que nos exigimos, aunque se trate de un pequeño proyecto de código abierto. Puedes preguntar qué datos tenemos sobre ti, pedirnos que borremos la correspondencia u oponerte a la analítica escribiendo a daloyjs@gmail.com. También puedes bloquear la analítica en tu navegador, y puedes leer este sitio en Markdown (Accept: text/markdown) o mediante /llms.txt sin ejecutar nuestro JavaScript. Esta política se actualizó por última vez el 29 de octubre de 2026. Si cambia de forma sustancial, fecharemos aquí la nueva versión.",
    ],
    questions: "Consultas de privacidad:",
    otherContact: ". Otras formas de contacto: ",
  },
  docsIndex: {
    title: "Documentación en español",
    description:
      "Primeros pasos con DaloyJS en castellano: instalación, tu primera ruta basada en contratos y un tutorial completo. El resto de la documentación está en inglés.",
    keywords: ["documentación DaloyJS", "DaloyJS en español", "tutorial TypeScript API", "primeros pasos DaloyJS"],
    heading: "Documentación en español",
    intro:
      "Estas páginas te llevan de una carpeta vacía a una API tipada y probada. Son traducciones de la documentación original en inglés; el resto de la documentación técnica (seguridad, adaptadores, referencia de la API y demás) está, de momento, solo en inglés.",
  },
};
