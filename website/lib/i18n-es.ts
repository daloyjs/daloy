/**
 * Castilian Spanish (es-ES) copy for the translated marketing pages under
 * `/es`. Each export mirrors an English source; keep them in step when the
 * English changes:
 *
 * - {@link HOME_TITLE_ES} / {@link HOME_DESCRIPTION_ES} ← `HOME_TITLE` /
 *   `HOME_DESCRIPTION` in `lib/seo.ts`
 * - `*_PARAGRAPHS_ES` ← the matching `*_PARAGRAPHS` in `lib/trust-content.ts`
 *
 * The landing page body lives in `components/home/home-copy-es.tsx`.
 */

/** Spanish home page `<title>` fragment and OG headline. */
export const HOME_TITLE_ES =
  "APIs REST en TypeScript basadas en contratos y seguras por defecto, pensadas para equipos que programan con IA";

/** Spanish home page meta description (140–160 characters). */
export const HOME_DESCRIPTION_ES =
  "Valores seguros por defecto, negativa a arrancar en producción con configuraciones erróneas, cero dependencias y clientes tipados OpenAPI 3.1 desde un contrato.";

/** Spanish `/es/about` body. Mirrors `ABOUT_PARAGRAPHS`. */
export const ABOUT_PARAGRAPHS_ES = [
  "DaloyJS es un framework web de TypeScript basado en contratos y portable entre entornos de ejecución. Una sola definición de ruta es la fuente de verdad para la validación, OpenAPI 3.1, los clientes tipados y el handler HTTP. El runtime no tiene ninguna dependencia de npm, trae valores seguros por defecto (límites de tamaño del cuerpo, tiempos de espera por petición, saneamiento de cabeceras, listas de algoritmos JWT permitidos, comparaciones en tiempo constante, parsers a salvo de la contaminación de prototipos y un envoltorio de fetch opcional protegido contra SSRF) y ejecuta la misma aplicación en Node.js, Bun, Deno, Cloudflare Workers y Vercel.",
  "El proyecto es de código abierto con licencia MIT. El framework se publica como @daloyjs/core en npm y como @daloyjs/daloy en JSR a partir del mismo código TypeScript. Crea una aplicación nueva con pnpm create daloy@latest. El código fuente, el gestor de incidencias, el registro de cambios y la política de seguridad están en el repositorio de GitHub, en github.com/daloyjs/daloy.",
  "Daloy significa flujo en tagalo y se pronuncia da-loy. El nombre recuerda que las peticiones, las respuestas, los contratos, los tipos y los clientes generados deberían avanzar en un único flujo en lugar de separarse entre capas. Hay una nota más larga sobre el nombre en /es/about-the-name.",
  "DaloyJS lo mantiene Devlin Duldulao, un desarrollador fullstack filipino que vive en Noruega, junto con colaboradores voluntarios. Es un proyecto de software, no una empresa registrada con una oficina abierta al público. Las preguntas técnicas, el patrocinio y los informes de seguridad se gestionan a través de la página de contacto. Los primeros pasos, la instalación y el tutorial de la documentación están traducidos al español; el resto de la documentación técnica y el blog están en inglés.",
] as const;

/** Spanish `/es/contact` body. Mirrors `CONTACT_PARAGRAPHS`. */
export const CONTACT_PARAGRAPHS_ES = [
  "La forma más rápida de contactar con los mantenedores de DaloyJS es el correo electrónico: daloyjs@gmail.com. Usa esa dirección para errores en la documentación, preguntas sobre versiones, patrocinio y cualquier cosa que no sea una vulnerabilidad. El buzón se atiende en inglés. No hay teléfono ni chat en este sitio; el correo es el canal que de verdad llega a una persona.",
  "Para errores, preguntas sobre la API y peticiones de funcionalidades, abre una incidencia en GitHub, en github.com/daloyjs/daloy. Las incidencias son públicas, se pueden buscar y quedan ligadas al código, lo que las convierte en mejor archivo que una bandeja de entrada privada para el trabajo de producto. Las pull requests son bienvenidas cuando incluyen pruebas y no debilitan ningún valor seguro por defecto.",
  "Para informar de una posible vulnerabilidad, no abras una incidencia pública con los detalles del exploit. Usa el informe privado de vulnerabilidades de GitHub en github.com/daloyjs/daloy/security/advisories/new, o escribe a daloyjs@gmail.com con información suficiente para reproducirla y sin una prueba de concepto más grande de lo necesario. La política de seguridad, las versiones con soporte y los plazos de corrección están en SECURITY.md, en el repositorio, y en /.well-known/security.txt.",
  "Perfiles sociales y de paquetes, por si quieres comprobar que este sitio corresponde al mismo proyecto: GitHub (github.com/daloyjs/daloy), npm (@daloyjs/core), JSR (@daloyjs/daloy), Open Collective (opencollective.com/daloyjs), X/Twitter (@daloyjs), Bluesky (daloyjs.dev), Mastodon (@daloyjs@mastodon.social) y dev.to/daloyjs. La política de privacidad en /es/privacy explica qué recoge este sitio web cuando lo visitas.",
] as const;

/** Spanish `/es/privacy` body. Mirrors `PRIVACY_PARAGRAPHS`. */
export const PRIVACY_PARAGRAPHS_ES = [
  "Esta política de privacidad se aplica al sitio web de marketing y documentación de DaloyJS en daloyjs.dev. No se aplica a las aplicaciones que construyas con el framework @daloyjs/core: esas son tuyas, y tú eres el responsable del tratamiento de los datos de sus usuarios. El sitio web es un sitio de documentación estático. No tiene cuentas de usuario, ni inicio de sesión, ni pagos, ni una base de datos de visitantes en el servidor.",
  "Cuando cargas una página recibimos los metadatos de la petición que ve cualquier servidor HTTPS: dirección IP, agente de usuario, URL solicitada y página de referencia. El alojamiento y la entrega funcionan sobre Vercel. Vercel puede tratar esos metadatos para operar el servicio, absorber abusos y elaborar estadísticas de tráfico agregadas. También cargamos Vercel Analytics y Vercel Speed Insights, que miden las visitas y las Core Web Vitals sin un perfil publicitario aparte. Google Analytics (propiedad G-DSBFBZT7RQ) se usa para informes de tráfico agregados. Esos proveedores actúan como encargados del tratamiento de este sitio. No vendemos datos personales, no usamos píxeles de remarketing y no añadimos los datos de los visitantes a ninguna lista de marketing.",
  "El sitio guarda en el navegador una preferencia de tema (claro, oscuro o el del sistema) mediante next-themes para que la interfaz no parpadee al recargar. Un service worker en /sw.js puede guardar en caché páginas abiertas anteriormente para la página sin conexión de /offline. Ambas cosas se quedan en tu dispositivo. Si escribes a daloyjs@gmail.com, GitHub u Open Collective, al mensaje que envíes se le aplican las condiciones y las reglas de conservación de ese tercero; solo conservamos la correspondencia el tiempo necesario para responderte o para mantener un registro de seguridad.",
  "Como el mantenedor vive en Noruega, la normativa europea de protección de datos es la referencia que nos exigimos, aunque se trate de un pequeño proyecto de código abierto. Puedes preguntar qué datos tenemos sobre ti, pedirnos que borremos la correspondencia u oponerte a la analítica escribiendo a daloyjs@gmail.com. También puedes bloquear la analítica en tu navegador, y puedes leer este sitio en Markdown (Accept: text/markdown) o mediante /llms.txt sin ejecutar nuestro JavaScript. Esta política se actualizó por última vez el 21 de agosto de 2026. Si cambia de forma sustancial, fecharemos aquí la nueva versión.",
] as const;
