/**
 * Cross-language search glossary: maps the technical terms Chinese and
 * Spanish developers actually type to the English keywords the docs use, so
 * a query like "限流" or "pruebas" reaches the English page instead of
 * returning nothing.
 *
 * Scope is deliberate:
 * - Chinese has established translations for most concepts (中间件, 限流,
 *   路由, 跨域…), and our own `/zh` pages use them, so the list is broad.
 * - Spanish mostly keeps the English term ("middleware", "token"), so the list
 *   only covers translations and cognates the ranker cannot link on its own
 *   ("validación" ≠ "validation" to a suffix stemmer).
 * - Product and API names (Redis, JWT, OpenAPI, Zod) are never listed: they
 *   are typed in English in every language.
 *
 * Every entry names the English page it should surface (`expect`);
 * tests/lib/docs-glossary.test.ts runs each one against the real docs, so a
 * mapping that finds nothing useful fails CI instead of adding noise. Pure
 * data plus string functions: safe in client components.
 */

/** One glossary entry. */
export type GlossaryEntry = {
  /** The term as written (Chinese) or accent-free lowercase (Spanish). */
  term: string;
  /** English keywords to search for. */
  english: string;
  /** A docs route the English keywords must rank in the top results. */
  expect: string;
};

/** Simplified Chinese → English. */
export const ZH_GLOSSARY: readonly GlossaryEntry[] = [
  { term: "中间件", english: "middleware", expect: "/docs/api-reference/middleware" },
  { term: "限流", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "速率限制", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "路由", english: "routing", expect: "/docs/routing" },
  { term: "校验", english: "validation", expect: "/docs/validation" },
  { term: "数据验证", english: "validation", expect: "/docs/validation" },
  { term: "跨域", english: "cors middleware", expect: "/docs/api-reference/middleware" },
  { term: "鉴权", english: "authentication", expect: "/docs/auth" },
  { term: "身份验证", english: "authentication", expect: "/docs/auth" },
  { term: "身份认证", english: "authentication", expect: "/docs/auth" },
  { term: "认证", english: "authentication", expect: "/docs/auth" },
  { term: "授权", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "权限", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "会话", english: "session", expect: "/docs/security/session" },
  { term: "跨站请求伪造", english: "csrf", expect: "/docs/security/csrf" },
  { term: "服务端请求伪造", english: "ssrf fetch guard", expect: "/docs/security/fetch-guard" },
  { term: "sql注入", english: "sql injection", expect: "/docs/security/sql-injection" },
  { term: "命令注入", english: "command injection", expect: "/docs/security/command-injection" },
  { term: "供应链", english: "supply chain", expect: "/docs/security/supply-chain" },
  { term: "部署", english: "deployment", expect: "/docs/deployment" },
  { term: "安装", english: "installation", expect: "/docs/installation" },
  { term: "快速开始", english: "getting started", expect: "/docs/getting-started" },
  { term: "入门", english: "getting started", expect: "/docs/getting-started" },
  { term: "教程", english: "tutorial", expect: "/docs/tutorials/bookstore" },
  { term: "脚手架", english: "scaffold", expect: "/docs/scaffolder" },
  { term: "命令行", english: "cli", expect: "/docs/cli" },
  { term: "环境变量", english: "environment variables config", expect: "/docs/config" },
  { term: "配置", english: "config", expect: "/docs/config" },
  { term: "日志", english: "logging", expect: "/docs/logging" },
  { term: "链路追踪", english: "tracing", expect: "/docs/tracing" },
  { term: "追踪", english: "tracing", expect: "/docs/tracing" },
  { term: "指标", english: "metrics", expect: "/docs/metrics" },
  { term: "监控", english: "metrics", expect: "/docs/metrics" },
  { term: "错误处理", english: "errors", expect: "/docs/errors" },
  { term: "单元测试", english: "testing", expect: "/docs/testing" },
  { term: "测试", english: "testing", expect: "/docs/testing" },
  { term: "类型化客户端", english: "typed client", expect: "/docs/typed-client" },
  { term: "客户端", english: "typed client", expect: "/docs/typed-client" },
  { term: "接口文档", english: "openapi", expect: "/docs/openapi" },
  { term: "分页", english: "pagination", expect: "/docs/pagination" },
  { term: "幂等", english: "idempotency", expect: "/docs/idempotency" },
  { term: "响应缓存", english: "response cache", expect: "/docs/response-cache" },
  { term: "缓存", english: "cache", expect: "/docs/response-cache" },
  { term: "文件上传", english: "multipart upload", expect: "/docs/multipart" },
  { term: "流式", english: "streaming", expect: "/docs/streaming" },
  { term: "服务端推送", english: "streaming sse", expect: "/docs/streaming" },
  { term: "定时任务", english: "scheduler", expect: "/docs/scheduler" },
  { term: "后台任务", english: "jobs", expect: "/docs/jobs" },
  { term: "任务队列", english: "jobs", expect: "/docs/jobs" },
  { term: "数据库", english: "databases", expect: "/docs/databases" },
  { term: "多租户", english: "multitenancy", expect: "/docs/multitenancy" },
  { term: "并发限制", english: "concurrency limit", expect: "/docs/concurrency-limit" },
  { term: "支付", english: "payment integrations", expect: "/docs/payments" },
  { term: "邮件", english: "email", expect: "/docs/email" },
  { term: "插件", english: "plugins", expect: "/docs/plugins" },
  { term: "适配器", english: "adapters", expect: "/docs/adapters" },
  { term: "防火墙", english: "waf", expect: "/docs/waf" },
  { term: "封禁", english: "auto ban", expect: "/docs/auto-ban" },
  { term: "爬虫", english: "bot guard", expect: "/docs/bot-guard" },
  { term: "机器人", english: "bot guard", expect: "/docs/bot-guard" },
  { term: "地区封锁", english: "geo block", expect: "/docs/geo-block" },
  { term: "双向tls", english: "mtls", expect: "/docs/mtls" },
  { term: "请求签名", english: "http signatures", expect: "/docs/http-signatures" },
  { term: "密码哈希", english: "hashing", expect: "/docs/security/hashing" },
  { term: "哈希", english: "hashing", expect: "/docs/security/hashing" },
  { term: "重定向", english: "safe redirect", expect: "/docs/security/safe-redirect" },
  { term: "健康检查", english: "health check", expect: "/docs/security/lifecycle-health" },
  { term: "优雅停机", english: "graceful shutdown", expect: "/docs/security/lifecycle-health" },
  { term: "安全响应头", english: "secure headers", expect: "/docs/security/secure-defaults" },
  { term: "默认安全", english: "secure defaults", expect: "/docs/security/secure-defaults" },
  { term: "压缩", english: "compression", expect: "/docs/security/compression" },
  { term: "解压", english: "decompression", expect: "/docs/request-decompression" },
  { term: "回调", english: "webhook", expect: "/docs/webhook-delivery" },
  { term: "版本控制", english: "api versioning", expect: "/docs/api-versioning" },
  { term: "生命周期", english: "api lifecycle", expect: "/docs/api-lifecycle" },
  { term: "智能体", english: "agent", expect: "/docs/tutorials/agent-loop" },
  { term: "模块化单体", english: "modular monolith", expect: "/docs/architecture/modular-monolith" },
  { term: "重试", english: "retry fetch resilience", expect: "/docs/fetch-resilience" },
  { term: "熔断", english: "circuit breaker", expect: "/docs/fetch-resilience" },
];

/** Spanish (accent-free, lowercase) → English. */
export const ES_GLOSSARY: readonly GlossaryEntry[] = [
  { term: "validacion", english: "validation", expect: "/docs/validation" },
  { term: "validar", english: "validation", expect: "/docs/validation" },
  { term: "autenticacion", english: "authentication", expect: "/docs/auth" },
  { term: "autorizacion", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "enrutamiento", english: "routing", expect: "/docs/routing" },
  { term: "rutas", english: "routing", expect: "/docs/routing" },
  { term: "despliegue", english: "deployment", expect: "/docs/deployment" },
  { term: "desplegar", english: "deployment", expect: "/docs/deployment" },
  { term: "instalacion", english: "installation", expect: "/docs/installation" },
  { term: "instalar", english: "installation", expect: "/docs/installation" },
  { term: "pruebas de contrato", english: "contract tests", expect: "/docs/testing" },
  { term: "pruebas", english: "testing", expect: "/docs/testing" },
  { term: "dependencias", english: "dependencies supply chain", expect: "/docs/security/supply-chain" },
  { term: "cadena de suministro", english: "supply chain", expect: "/docs/security/supply-chain" },
  { term: "sesion", english: "session", expect: "/docs/security/session" },
  { term: "sesiones", english: "session", expect: "/docs/security/session" },
  { term: "registros", english: "logging", expect: "/docs/logging" },
  { term: "trazas", english: "tracing", expect: "/docs/tracing" },
  { term: "metricas", english: "metrics", expect: "/docs/metrics" },
  { term: "errores", english: "errors", expect: "/docs/errors" },
  { term: "paginacion", english: "pagination", expect: "/docs/pagination" },
  { term: "idempotencia", english: "idempotency", expect: "/docs/idempotency" },
  { term: "base de datos", english: "databases", expect: "/docs/databases" },
  { term: "bases de datos", english: "databases", expect: "/docs/databases" },
  { term: "correo", english: "email", expect: "/docs/email" },
  { term: "pagos", english: "payment integrations", expect: "/docs/payments" },
  { term: "complementos", english: "plugins", expect: "/docs/plugins" },
  { term: "adaptadores", english: "adapters", expect: "/docs/adapters" },
  { term: "limitacion de peticiones", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "limite de peticiones", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "concurrencia", english: "concurrency limit", expect: "/docs/concurrency-limit" },
  { term: "tareas programadas", english: "scheduler", expect: "/docs/scheduler" },
  { term: "segundo plano", english: "jobs", expect: "/docs/jobs" },
  { term: "subida de archivos", english: "multipart upload", expect: "/docs/multipart" },
  { term: "cabeceras seguras", english: "secure headers", expect: "/docs/security/secure-defaults" },
  { term: "inyeccion sql", english: "sql injection", expect: "/docs/security/sql-injection" },
  { term: "inyeccion de comandos", english: "command injection", expect: "/docs/security/command-injection" },
  { term: "multiinquilino", english: "multitenancy", expect: "/docs/multitenancy" },
  { term: "configuracion", english: "config", expect: "/docs/config" },
  { term: "variables de entorno", english: "environment variables config", expect: "/docs/config" },
  { term: "primeros pasos", english: "getting started", expect: "/docs/getting-started" },
  { term: "cliente tipado", english: "typed client", expect: "/docs/typed-client" },
  { term: "reintentos", english: "retry fetch resilience", expect: "/docs/fetch-resilience" },
  { term: "compresion", english: "compression", expect: "/docs/security/compression" },
  { term: "descompresion", english: "decompression", expect: "/docs/request-decompression" },
  { term: "redireccion", english: "safe redirect", expect: "/docs/security/safe-redirect" },
  { term: "versionado", english: "api versioning", expect: "/docs/api-versioning" },
  { term: "apagado ordenado", english: "graceful shutdown", expect: "/docs/security/lifecycle-health" },
  { term: "cierre ordenado", english: "graceful shutdown", expect: "/docs/security/lifecycle-health" },
  { term: "comprobacion de salud", english: "health check", expect: "/docs/security/lifecycle-health" },
];

/** Upper bound on glossary expansions applied to one query. */
export const MAX_GLOSSARY_MATCHES = 8;

/** One applied mapping, for transparency in tool output. */
export type GlossaryMatch = { source: string; english: string };

/** Longest terms first, so "速率限制" wins over anything shorter inside it. */
const ZH_BY_LENGTH = [...ZH_GLOSSARY].sort((a, b) => [...b.term].length - [...a.term].length);
const ES_BY_LENGTH = [...ES_GLOSSARY].sort((a, b) => b.term.length - a.term.length);

/** Lowercase, accents stripped, every non-letter/digit run as one space. */
function foldSpanish(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/**
 * Find glossary terms in a query and return the English keywords to search
 * for. Chinese terms match as substrings (longest first, each span used
 * once); Spanish terms match as accent-insensitive whole words or phrases.
 * At most {@link MAX_GLOSSARY_MATCHES} mappings apply.
 *
 * @param query - Raw query (already length-capped by the caller).
 * @returns The applied mappings, in the order found.
 */
export function glossaryMatches(query: string): GlossaryMatch[] {
  const matches: GlossaryMatch[] = [];

  // Chinese: drop spaces so "sql 注入" and "双向 TLS" still match.
  let zh = query.toLowerCase().replace(/\s+/g, "");
  for (const entry of ZH_BY_LENGTH) {
    if (matches.length >= MAX_GLOSSARY_MATCHES) return matches;
    if (zh.includes(entry.term)) {
      matches.push({ source: entry.term, english: entry.english });
      zh = zh.split(entry.term).join("\u0000");
    }
  }

  let es = foldSpanish(query);
  for (const entry of ES_BY_LENGTH) {
    if (matches.length >= MAX_GLOSSARY_MATCHES) return matches;
    const needle = ` ${entry.term} `;
    if (es.includes(needle)) {
      matches.push({ source: entry.term, english: entry.english });
      es = es.split(needle).join(" \u0000 ");
    }
  }
  return matches;
}

/**
 * Spanish function words. Once the glossary has recognised a Spanish query,
 * these are dropped from the English-side search: "de" or "la" would only
 * match stray words in English pages and push the right page down.
 */
const SPANISH_STOPWORDS = new Set([
  "a", "al", "como", "con", "de", "del", "el", "en", "es", "hacer", "la", "las", "lo", "los",
  "mi", "mis", "o", "para", "por", "que", "se", "su", "sus", "un", "una", "y",
]);

/**
 * The query to rank the English docs with: the glossary's English keywords
 * first (so the term cap in `tokenize` never drops them), then the rest of
 * the original query (which may carry English words such as "zod"), minus
 * Spanish function words and the Spanish words already translated.
 *
 * @param query - Raw query.
 * @param matches - Result of {@link glossaryMatches}.
 * @returns The expanded English query, or the original when nothing matched.
 */
export function englishSearchQuery(query: string, matches: readonly GlossaryMatch[]): string {
  if (matches.length === 0) return query;
  // Words already translated by a Spanish match carry nothing for English.
  const translated = new Set(matches.flatMap((match) => match.source.split(" ")));
  const rest = query
    .split(/\s+/)
    .filter((word) => {
      const folded = foldSpanish(word).trim();
      return !SPANISH_STOPWORDS.has(folded) && !translated.has(folded);
    })
    .join(" ");
  return [...new Set(matches.map((match) => match.english)), rest].join(" ").trim();
}
