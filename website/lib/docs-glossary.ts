import { foldArabic } from "./arabic";
import { foldCyrillic } from "./cyrillic";

/**
 * Cross-language search glossary: maps the technical terms Chinese and
 * Spanish developers actually type to the English keywords the docs use, so
 * a query like "限流" or "pruebas" reaches the English page instead of
 * returning nothing.
 *
 * Scope is deliberate:
 * - Chinese has established translations for most concepts (中间件, 限流,
 *   路由, 跨域…), and our own `/zh` pages use them, so the list is broad.
 * - Japanese writes most concepts as katakana loanwords (ミドルウェア,
 *   キャッシュ) and some in kanji (認証, 冪等); both are listed.
 * - French and Portuguese, like Spanish, get short lists of translations and
 *   cognates.
 * - Arabic has established terms for many concepts (التوجيه، المصادقة،
 *   تحديد المعدل), matched after folding spelling variants.
 * - Russian terms are stems matched at word starts, because Russian inflects
 *   by case.
 * - German terms match inside words, because German writes compounds as one
 *   word.
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
  /** The term as written (Chinese, Japanese) or accent-free lowercase (Spanish). */
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

/**
 * Japanese → English. Japanese developers write most concepts in katakana
 * loanwords (ミドルウェア, レート制限) and some in kanji (認証, 認可, 冪等),
 * so the list covers both. Terms match as substrings inside the shared
 * CJK matcher, after NFKC (full-width ＳＱＬ and half-width ｷｬｯｼｭ fold to
 * the usual forms). Loanwords whose final long vowel is optional are listed
 * without it ("スケジューラ" also finds "スケジューラー"). Bare "ログ" is
 * absent: it is a substring of "ログイン" (login). No term may also appear in
 * {@link ZH_GLOSSARY}.
 */
export const JA_GLOSSARY: readonly GlossaryEntry[] = [
  { term: "ミドルウェア", english: "middleware", expect: "/docs/api-reference/middleware" },
  { term: "レート制限", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "レートリミット", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "流量制限", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "ルーティング", english: "routing", expect: "/docs/routing" },
  { term: "ルータ", english: "routing", expect: "/docs/routing" },
  { term: "バリデーション", english: "validation", expect: "/docs/validation" },
  { term: "入力チェック", english: "validation", expect: "/docs/validation" },
  { term: "検証", english: "validation", expect: "/docs/validation" },
  { term: "クロスオリジン", english: "cors middleware", expect: "/docs/api-reference/middleware" },
  { term: "認証", english: "authentication", expect: "/docs/auth" },
  { term: "認可", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "権限", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "アクセス制御", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "セッション", english: "session", expect: "/docs/security/session" },
  { term: "sqlインジェクション", english: "sql injection", expect: "/docs/security/sql-injection" },
  { term: "コマンドインジェクション", english: "command injection", expect: "/docs/security/command-injection" },
  { term: "サプライチェーン", english: "supply chain", expect: "/docs/security/supply-chain" },
  { term: "デプロイ", english: "deployment", expect: "/docs/deployment" },
  { term: "インストール", english: "installation", expect: "/docs/installation" },
  { term: "はじめに", english: "getting started", expect: "/docs/getting-started" },
  { term: "入門", english: "getting started", expect: "/docs/getting-started" },
  { term: "チュートリアル", english: "tutorial", expect: "/docs/tutorials/bookstore" },
  { term: "スキャフォールド", english: "scaffold", expect: "/docs/scaffolder" },
  { term: "コマンドライン", english: "cli", expect: "/docs/cli" },
  { term: "環境変数", english: "environment variables config", expect: "/docs/config" },
  { term: "設定", english: "config", expect: "/docs/config" },
  { term: "ロギング", english: "logging", expect: "/docs/logging" },
  { term: "ログ出力", english: "logging", expect: "/docs/logging" },
  { term: "トレーシング", english: "tracing", expect: "/docs/tracing" },
  { term: "トレース", english: "tracing", expect: "/docs/tracing" },
  { term: "メトリクス", english: "metrics", expect: "/docs/metrics" },
  { term: "監視", english: "metrics", expect: "/docs/metrics" },
  { term: "エラー処理", english: "errors", expect: "/docs/errors" },
  { term: "エラーハンドリング", english: "errors", expect: "/docs/errors" },
  { term: "例外処理", english: "errors", expect: "/docs/errors" },
  { term: "コントラクトテスト", english: "contract tests", expect: "/docs/testing" },
  { term: "テスト", english: "testing", expect: "/docs/testing" },
  { term: "型付きクライアント", english: "typed client", expect: "/docs/typed-client" },
  { term: "クライアント", english: "typed client", expect: "/docs/typed-client" },
  { term: "apiドキュメント", english: "openapi", expect: "/docs/openapi" },
  { term: "ページネーション", english: "pagination", expect: "/docs/pagination" },
  { term: "ページング", english: "pagination", expect: "/docs/pagination" },
  { term: "冪等", english: "idempotency", expect: "/docs/idempotency" },
  { term: "キャッシュ", english: "response cache", expect: "/docs/response-cache" },
  { term: "アップロード", english: "multipart upload", expect: "/docs/multipart" },
  { term: "ストリーミング", english: "streaming", expect: "/docs/streaming" },
  { term: "スケジューラ", english: "scheduler", expect: "/docs/scheduler" },
  { term: "定期実行", english: "scheduler", expect: "/docs/scheduler" },
  { term: "ジョブ", english: "jobs", expect: "/docs/jobs" },
  { term: "データベース", english: "databases", expect: "/docs/databases" },
  { term: "マルチテナント", english: "multitenancy", expect: "/docs/multitenancy" },
  { term: "同時実行", english: "concurrency limit", expect: "/docs/concurrency-limit" },
  { term: "決済", english: "payment integrations", expect: "/docs/payments" },
  { term: "メール", english: "email", expect: "/docs/email" },
  { term: "プラグイン", english: "plugins", expect: "/docs/plugins" },
  { term: "アダプタ", english: "adapters", expect: "/docs/adapters" },
  { term: "ファイアウォール", english: "waf", expect: "/docs/waf" },
  { term: "ボット", english: "bot guard", expect: "/docs/bot-guard" },
  { term: "クローラ", english: "bot guard", expect: "/docs/bot-guard" },
  { term: "ジオブロック", english: "geo block", expect: "/docs/geo-block" },
  { term: "地域ブロック", english: "geo block", expect: "/docs/geo-block" },
  { term: "相互tls", english: "mtls", expect: "/docs/mtls" },
  { term: "リクエスト署名", english: "http signatures", expect: "/docs/http-signatures" },
  { term: "http署名", english: "http signatures", expect: "/docs/http-signatures" },
  { term: "ハッシュ", english: "hashing", expect: "/docs/security/hashing" },
  { term: "リダイレクト", english: "safe redirect", expect: "/docs/security/safe-redirect" },
  { term: "ヘルスチェック", english: "health check", expect: "/docs/security/lifecycle-health" },
  { term: "シャットダウン", english: "graceful shutdown", expect: "/docs/security/lifecycle-health" },
  { term: "セキュリティヘッダ", english: "secure headers", expect: "/docs/security/secure-defaults" },
  { term: "セキュアバイデフォルト", english: "secure defaults", expect: "/docs/security/secure-defaults" },
  { term: "解凍", english: "decompression", expect: "/docs/request-decompression" },
  { term: "圧縮", english: "compression", expect: "/docs/security/compression" },
  { term: "ウェブフック", english: "webhook", expect: "/docs/webhook-delivery" },
  { term: "バージョニング", english: "api versioning", expect: "/docs/api-versioning" },
  { term: "ライフサイクル", english: "api lifecycle", expect: "/docs/api-lifecycle" },
  { term: "エージェント", english: "agent", expect: "/docs/tutorials/agent-loop" },
  { term: "モノリス", english: "modular monolith", expect: "/docs/architecture/modular-monolith" },
  { term: "リトライ", english: "retry fetch resilience", expect: "/docs/fetch-resilience" },
  { term: "再試行", english: "retry fetch resilience", expect: "/docs/fetch-resilience" },
  { term: "サーキットブレーカ", english: "circuit breaker", expect: "/docs/fetch-resilience" },
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

/**
 * French (accent-free, lowercase; elided articles fold to separate words,
 * so "chaîne d’approvisionnement" is "chaine d approvisionnement") → English.
 * Like Spanish, French developers keep most English terms ("middleware",
 * "token", "endpoint"), so this lists only translations and the cognates the
 * ranker cannot link.
 */
export const FR_GLOSSARY: readonly GlossaryEntry[] = [
  { term: "routage", english: "routing", expect: "/docs/routing" },
  { term: "deploiement", english: "deployment", expect: "/docs/deployment" },
  { term: "deployer", english: "deployment", expect: "/docs/deployment" },
  { term: "authentification", english: "authentication", expect: "/docs/auth" },
  { term: "autorisation", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "limitation de debit", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "limite de debit", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "intergiciel", english: "middleware", expect: "/docs/api-reference/middleware" },
  { term: "journalisation", english: "logging", expect: "/docs/logging" },
  { term: "journaux", english: "logging", expect: "/docs/logging" },
  { term: "tracage", english: "tracing", expect: "/docs/tracing" },
  { term: "metriques", english: "metrics", expect: "/docs/metrics" },
  { term: "erreurs", english: "errors", expect: "/docs/errors" },
  { term: "idempotence", english: "idempotency", expect: "/docs/idempotency" },
  { term: "base de donnees", english: "databases", expect: "/docs/databases" },
  { term: "bases de donnees", english: "databases", expect: "/docs/databases" },
  { term: "courriel", english: "email", expect: "/docs/email" },
  { term: "paiements", english: "payment integrations", expect: "/docs/payments" },
  { term: "adaptateurs", english: "adapters", expect: "/docs/adapters" },
  { term: "dependances", english: "dependencies supply chain", expect: "/docs/security/supply-chain" },
  { term: "chaine d approvisionnement", english: "supply chain", expect: "/docs/security/supply-chain" },
  { term: "taches planifiees", english: "scheduler", expect: "/docs/scheduler" },
  { term: "planificateur", english: "scheduler", expect: "/docs/scheduler" },
  { term: "arriere plan", english: "jobs", expect: "/docs/jobs" },
  { term: "televersement", english: "multipart upload", expect: "/docs/multipart" },
  { term: "envoi de fichiers", english: "multipart upload", expect: "/docs/multipart" },
  { term: "en tetes securises", english: "secure headers", expect: "/docs/security/secure-defaults" },
  { term: "multilocataire", english: "multitenancy", expect: "/docs/multitenancy" },
  { term: "multi locataire", english: "multitenancy", expect: "/docs/multitenancy" },
  { term: "variables d environnement", english: "environment variables config", expect: "/docs/config" },
  { term: "premiers pas", english: "getting started", expect: "/docs/getting-started" },
  { term: "client type", english: "typed client", expect: "/docs/typed-client" },
  { term: "nouvelles tentatives", english: "retry fetch resilience", expect: "/docs/fetch-resilience" },
  { term: "disjoncteur", english: "circuit breaker", expect: "/docs/fetch-resilience" },
  { term: "versionnage", english: "api versioning", expect: "/docs/api-versioning" },
  { term: "gestion des versions", english: "api versioning", expect: "/docs/api-versioning" },
  { term: "arret propre", english: "graceful shutdown", expect: "/docs/security/lifecycle-health" },
  { term: "controle de sante", english: "health check", expect: "/docs/security/lifecycle-health" },
  { term: "tests de contrat", english: "contract tests", expect: "/docs/testing" },
  { term: "mise en cache", english: "response cache", expect: "/docs/response-cache" },
  { term: "concurrence", english: "concurrency limit", expect: "/docs/concurrency-limit" },
];

/**
 * Brazilian Portuguese (accent-free, lowercase) → English. Brazilian
 * developers keep "deploy", "middleware", "cache" and "token" in English, so
 * this lists only translations and cognates. Words already in
 * {@link ES_GLOSSARY} with the same meaning (adaptadores, metricas,
 * dependencias, cliente tipado, segundo plano…) are not repeated: Spanish,
 * French and Portuguese share one matcher.
 */
export const PT_GLOSSARY: readonly GlossaryEntry[] = [
  { term: "validacao", english: "validation", expect: "/docs/validation" },
  { term: "autenticacao", english: "authentication", expect: "/docs/auth" },
  { term: "autorizacao", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "roteamento", english: "routing", expect: "/docs/routing" },
  { term: "rotas", english: "routing", expect: "/docs/routing" },
  { term: "implantacao", english: "deployment", expect: "/docs/deployment" },
  { term: "instalacao", english: "installation", expect: "/docs/installation" },
  { term: "testes", english: "testing", expect: "/docs/testing" },
  { term: "testes de contrato", english: "contract tests", expect: "/docs/testing" },
  { term: "cadeia de suprimentos", english: "supply chain", expect: "/docs/security/supply-chain" },
  { term: "sessao", english: "session", expect: "/docs/security/session" },
  { term: "sessoes", english: "session", expect: "/docs/security/session" },
  { term: "rastreamento", english: "tracing", expect: "/docs/tracing" },
  { term: "erros", english: "errors", expect: "/docs/errors" },
  { term: "paginacao", english: "pagination", expect: "/docs/pagination" },
  { term: "banco de dados", english: "databases", expect: "/docs/databases" },
  { term: "bancos de dados", english: "databases", expect: "/docs/databases" },
  { term: "pagamentos", english: "payment integrations", expect: "/docs/payments" },
  { term: "limitacao de taxa", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "limite de taxa", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "limite de requisicoes", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "concorrencia", english: "concurrency limit", expect: "/docs/concurrency-limit" },
  { term: "tarefas agendadas", english: "scheduler", expect: "/docs/scheduler" },
  { term: "agendador", english: "scheduler", expect: "/docs/scheduler" },
  { term: "upload de arquivos", english: "multipart upload", expect: "/docs/multipart" },
  { term: "cabecalhos seguros", english: "secure headers", expect: "/docs/security/secure-defaults" },
  { term: "injecao de sql", english: "sql injection", expect: "/docs/security/sql-injection" },
  { term: "injecao de comandos", english: "command injection", expect: "/docs/security/command-injection" },
  { term: "multilocatario", english: "multitenancy", expect: "/docs/multitenancy" },
  { term: "configuracao", english: "config", expect: "/docs/config" },
  { term: "variaveis de ambiente", english: "environment variables config", expect: "/docs/config" },
  { term: "primeiros passos", english: "getting started", expect: "/docs/getting-started" },
  { term: "novas tentativas", english: "retry fetch resilience", expect: "/docs/fetch-resilience" },
  { term: "disjuntor", english: "circuit breaker", expect: "/docs/fetch-resilience" },
  { term: "compressao", english: "compression", expect: "/docs/security/compression" },
  { term: "descompressao", english: "decompression", expect: "/docs/request-decompression" },
  { term: "redirecionamento", english: "safe redirect", expect: "/docs/security/safe-redirect" },
  { term: "versionamento", english: "api versioning", expect: "/docs/api-versioning" },
  { term: "desligamento gracioso", english: "graceful shutdown", expect: "/docs/security/lifecycle-health" },
  { term: "verificacao de saude", english: "health check", expect: "/docs/security/lifecycle-health" },
];

/**
 * Modern Standard Arabic → English. Terms are stored folded (lib/arabic.ts:
 * no diacritics, ا for every alef form, ي for ى, ه for ة) and match as
 * substrings of the folded query, longest first, because the article and
 * prepositions attach to the word ("التوجيه", "بالتوجيه"). Arabic developers
 * also keep many English terms ("API", "middleware"), so this lists the
 * established Arabic ones.
 */
export const AR_GLOSSARY: readonly GlossaryEntry[] = [
  { term: "البرمجيات الوسيطه", english: "middleware", expect: "/docs/api-reference/middleware" },
  { term: "وسيط", english: "middleware", expect: "/docs/api-reference/middleware" },
  { term: "تحديد المعدل", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "تحديد معدل", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "معدل الطلبات", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "اعاده التوجيه", english: "safe redirect", expect: "/docs/security/safe-redirect" },
  { term: "توجيه", english: "routing", expect: "/docs/routing" },
  { term: "مسارات", english: "routing", expect: "/docs/routing" },
  { term: "التحقق من الهويه", english: "authentication", expect: "/docs/auth" },
  { term: "مصادقه", english: "authentication", expect: "/docs/auth" },
  { term: "تحقق", english: "validation", expect: "/docs/validation" },
  { term: "تفويض", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "صلاحيات", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "جلسات", english: "session", expect: "/docs/security/session" },
  { term: "جلسه", english: "session", expect: "/docs/security/session" },
  { term: "النشر", english: "deployment", expect: "/docs/deployment" },
  { term: "تثبيت", english: "installation", expect: "/docs/installation" },
  { term: "البدء السريع", english: "getting started", expect: "/docs/getting-started" },
  { term: "بدء الاستخدام", english: "getting started", expect: "/docs/getting-started" },
  { term: "اختبارات العقد", english: "contract tests", expect: "/docs/testing" },
  { term: "اختبار", english: "testing", expect: "/docs/testing" },
  { term: "سلسله التوريد", english: "supply chain", expect: "/docs/security/supply-chain" },
  { term: "سلسله الامداد", english: "supply chain", expect: "/docs/security/supply-chain" },
  { term: "تبعيات", english: "dependencies supply chain", expect: "/docs/security/supply-chain" },
  { term: "السجلات", english: "logging", expect: "/docs/logging" },
  { term: "تسجيل الاحداث", english: "logging", expect: "/docs/logging" },
  { term: "التتبع", english: "tracing", expect: "/docs/tracing" },
  { term: "مقاييس", english: "metrics", expect: "/docs/metrics" },
  { term: "اخطاء", english: "errors", expect: "/docs/errors" },
  { term: "ترقيم الصفحات", english: "pagination", expect: "/docs/pagination" },
  { term: "قواعد البيانات", english: "databases", expect: "/docs/databases" },
  { term: "قاعده البيانات", english: "databases", expect: "/docs/databases" },
  { term: "قاعده بيانات", english: "databases", expect: "/docs/databases" },
  { term: "البريد الالكتروني", english: "email", expect: "/docs/email" },
  { term: "مدفوعات", english: "payment integrations", expect: "/docs/payments" },
  { term: "بوابه الدفع", english: "payment integrations", expect: "/docs/payments" },
  { term: "اضافات", english: "plugins", expect: "/docs/plugins" },
  { term: "محولات", english: "adapters", expect: "/docs/adapters" },
  { term: "التخزين المؤقت", english: "response cache", expect: "/docs/response-cache" },
  { term: "رفع الملفات", english: "multipart upload", expect: "/docs/multipart" },
  { term: "المهام المجدوله", english: "scheduler", expect: "/docs/scheduler" },
  { term: "جدوله", english: "scheduler", expect: "/docs/scheduler" },
  { term: "مهام الخلفيه", english: "jobs", expect: "/docs/jobs" },
  { term: "تعدد المستاجرين", english: "multitenancy", expect: "/docs/multitenancy" },
  { term: "حقن sql", english: "sql injection", expect: "/docs/security/sql-injection" },
  { term: "حقن الاوامر", english: "command injection", expect: "/docs/security/command-injection" },
  { term: "متغيرات البيئه", english: "environment variables config", expect: "/docs/config" },
  { term: "الاعدادات", english: "config", expect: "/docs/config" },
  { term: "اعاده المحاوله", english: "retry fetch resilience", expect: "/docs/fetch-resilience" },
  { term: "قاطع الدائره", english: "circuit breaker", expect: "/docs/fetch-resilience" },
  { term: "الضغط", english: "compression", expect: "/docs/security/compression" },
  { term: "اداره الاصدارات", english: "api versioning", expect: "/docs/api-versioning" },
  { term: "الايقاف الامن", english: "graceful shutdown", expect: "/docs/security/lifecycle-health" },
  { term: "فحص الصحه", english: "health check", expect: "/docs/security/lifecycle-health" },
  { term: "رؤوس الامان", english: "secure headers", expect: "/docs/security/secure-defaults" },
  { term: "التزامن", english: "concurrency limit", expect: "/docs/concurrency-limit" },
];

/**
 * Russian → English. Russian inflects by case, so terms are stored as stems
 * (one per word) and match the start of consecutive query words. Stems stop
 * before a consonant cluster that gains a vowel in the genitive plural
 * ("установ" covers установка and установок; "ошиб" covers ошибка and
 * ошибок). Example:
 * "ограничен частот" matches "ограничение частоты" and "ограничения
 * частоты запросов". Folded: lowercase, ё as е. Russian developers keep many
 * English terms ("middleware", "deploy"), so this lists the established
 * Russian ones.
 */
export const RU_GLOSSARY: readonly GlossaryEntry[] = [
  { term: "маршрутизац", english: "routing", expect: "/docs/routing" },
  { term: "маршрут", english: "routing", expect: "/docs/routing" },
  { term: "промежуточн", english: "middleware", expect: "/docs/api-reference/middleware" },
  { term: "ограничен частот", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "ограничен скорост", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "лимит запрос", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "валидац", english: "validation", expect: "/docs/validation" },
  { term: "провер данн", english: "validation", expect: "/docs/validation" },
  { term: "аутентификац", english: "authentication", expect: "/docs/auth" },
  { term: "авторизац", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "сесси", english: "session", expect: "/docs/security/session" },
  { term: "развертыван", english: "deployment", expect: "/docs/deployment" },
  { term: "деплой", english: "deployment", expect: "/docs/deployment" },
  { term: "установ", english: "installation", expect: "/docs/installation" },
  { term: "быстр старт", english: "getting started", expect: "/docs/getting-started" },
  { term: "контрактн тест", english: "contract tests", expect: "/docs/testing" },
  { term: "тестирован", english: "testing", expect: "/docs/testing" },
  { term: "тест", english: "testing", expect: "/docs/testing" },
  { term: "цепоч постав", english: "supply chain", expect: "/docs/security/supply-chain" },
  { term: "зависимост", english: "dependencies supply chain", expect: "/docs/security/supply-chain" },
  { term: "логирован", english: "logging", expect: "/docs/logging" },
  { term: "журналирован", english: "logging", expect: "/docs/logging" },
  { term: "трассиров", english: "tracing", expect: "/docs/tracing" },
  { term: "метрик", english: "metrics", expect: "/docs/metrics" },
  { term: "ошиб", english: "errors", expect: "/docs/errors" },
  { term: "пагинац", english: "pagination", expect: "/docs/pagination" },
  { term: "идемпотентност", english: "idempotency", expect: "/docs/idempotency" },
  { term: "баз данн", english: "databases", expect: "/docs/databases" },
  { term: "электронн почт", english: "email", expect: "/docs/email" },
  { term: "платеж", english: "payment integrations", expect: "/docs/payments" },
  { term: "оплат", english: "payment integrations", expect: "/docs/payments" },
  { term: "плагин", english: "plugins", expect: "/docs/plugins" },
  { term: "адаптер", english: "adapters", expect: "/docs/adapters" },
  { term: "кеширован", english: "response cache", expect: "/docs/response-cache" },
  { term: "кэширован", english: "response cache", expect: "/docs/response-cache" },
  { term: "загруз файл", english: "multipart upload", expect: "/docs/multipart" },
  { term: "поток передач", english: "streaming", expect: "/docs/streaming" },
  { term: "стриминг", english: "streaming", expect: "/docs/streaming" },
  { term: "планировщик", english: "scheduler", expect: "/docs/scheduler" },
  { term: "фонов задач", english: "jobs", expect: "/docs/jobs" },
  { term: "мультитенантн", english: "multitenancy", expect: "/docs/multitenancy" },
  { term: "мультиарендн", english: "multitenancy", expect: "/docs/multitenancy" },
  { term: "sql инъекц", english: "sql injection", expect: "/docs/security/sql-injection" },
  { term: "инъекц команд", english: "command injection", expect: "/docs/security/command-injection" },
  { term: "переменн окружен", english: "environment variables config", expect: "/docs/config" },
  { term: "конфигурац", english: "config", expect: "/docs/config" },
  { term: "повторн попыт", english: "retry fetch resilience", expect: "/docs/fetch-resilience" },
  { term: "предохранител", english: "circuit breaker", expect: "/docs/fetch-resilience" },
  { term: "сжат", english: "compression", expect: "/docs/security/compression" },
  { term: "распаков", english: "decompression", expect: "/docs/request-decompression" },
  { term: "редирект", english: "safe redirect", expect: "/docs/security/safe-redirect" },
  { term: "перенаправлен", english: "safe redirect", expect: "/docs/security/safe-redirect" },
  { term: "версионирован", english: "api versioning", expect: "/docs/api-versioning" },
  { term: "корректн завершен", english: "graceful shutdown", expect: "/docs/security/lifecycle-health" },
  { term: "провер работоспособност", english: "health check", expect: "/docs/security/lifecycle-health" },
  { term: "заголов безопасност", english: "secure headers", expect: "/docs/security/secure-defaults" },
  { term: "конкурентност", english: "concurrency limit", expect: "/docs/concurrency-limit" },
  { term: "типизированн клиент", english: "typed client", expect: "/docs/typed-client" },
];

/**
 * Standard German → English. German writes compounds as one word
 * ("Ratenbegrenzung", "Lieferkettensicherheit"), so terms match as
 * substrings of the folded query (lowercase, umlauts without dots, ß as ss),
 * longest first: "lieferkette" also finds "Lieferkettensicherheit". German
 * developers keep many English terms ("Routing", "Deployment", "Middleware"),
 * so this lists the German ones.
 */
export const DE_GLOSSARY: readonly GlossaryEntry[] = [
  { term: "ratenbegrenz", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "ratenlimit", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "anfragelimit", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "drosselung", english: "rate limit", expect: "/docs/security/rate-limit-redis" },
  { term: "weiterleitung", english: "safe redirect", expect: "/docs/security/safe-redirect" },
  { term: "validier", english: "validation", expect: "/docs/validation" },
  { term: "authentifizier", english: "authentication", expect: "/docs/auth" },
  { term: "autorisier", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "berechtigung", english: "authorization", expect: "/docs/security/resource-authorization" },
  { term: "sitzung", english: "session", expect: "/docs/security/session" },
  { term: "bereitstellung", english: "deployment", expect: "/docs/deployment" },
  { term: "installier", english: "installation", expect: "/docs/installation" },
  { term: "erste schritte", english: "getting started", expect: "/docs/getting-started" },
  { term: "vertragstest", english: "contract tests", expect: "/docs/testing" },
  { term: "lieferkette", english: "supply chain", expect: "/docs/security/supply-chain" },
  { term: "abhangigkeit", english: "dependencies supply chain", expect: "/docs/security/supply-chain" },
  { term: "protokollierung", english: "logging", expect: "/docs/logging" },
  { term: "nachverfolgung", english: "tracing", expect: "/docs/tracing" },
  { term: "metriken", english: "metrics", expect: "/docs/metrics" },
  { term: "fehlerbehandlung", english: "errors", expect: "/docs/errors" },
  { term: "fehler", english: "errors", expect: "/docs/errors" },
  { term: "paginierung", english: "pagination", expect: "/docs/pagination" },
  { term: "seitennummerierung", english: "pagination", expect: "/docs/pagination" },
  { term: "idempotenz", english: "idempotency", expect: "/docs/idempotency" },
  { term: "datenbank", english: "databases", expect: "/docs/databases" },
  { term: "zahlung", english: "payment integrations", expect: "/docs/payments" },
  { term: "erweiterung", english: "plugins", expect: "/docs/plugins" },
  { term: "zwischenspeicher", english: "response cache", expect: "/docs/response-cache" },
  { term: "dateiupload", english: "multipart upload", expect: "/docs/multipart" },
  { term: "datei upload", english: "multipart upload", expect: "/docs/multipart" },
  { term: "geplante aufgab", english: "scheduler", expect: "/docs/scheduler" },
  { term: "zeitplan", english: "scheduler", expect: "/docs/scheduler" },
  { term: "hintergrundjob", english: "jobs", expect: "/docs/jobs" },
  { term: "hintergrundauftr", english: "jobs", expect: "/docs/jobs" },
  { term: "mandant", english: "multitenancy", expect: "/docs/multitenancy" },
  { term: "sql injektion", english: "sql injection", expect: "/docs/security/sql-injection" },
  { term: "befehlsinjektion", english: "command injection", expect: "/docs/security/command-injection" },
  { term: "umgebungsvariabl", english: "environment variables config", expect: "/docs/config" },
  { term: "konfiguration", english: "config", expect: "/docs/config" },
  { term: "wiederholung", english: "retry fetch resilience", expect: "/docs/fetch-resilience" },
  { term: "leistungsschalter", english: "circuit breaker", expect: "/docs/fetch-resilience" },
  { term: "dekomprimierung", english: "decompression", expect: "/docs/request-decompression" },
  { term: "komprimierung", english: "compression", expect: "/docs/security/compression" },
  { term: "versionierung", english: "api versioning", expect: "/docs/api-versioning" },
  { term: "herunterfahren", english: "graceful shutdown", expect: "/docs/security/lifecycle-health" },
  { term: "zustandsprufung", english: "health check", expect: "/docs/security/lifecycle-health" },
  { term: "sicherheitsheader", english: "secure headers", expect: "/docs/security/secure-defaults" },
  { term: "nebenlaufigkeit", english: "concurrency limit", expect: "/docs/concurrency-limit" },
  { term: "typisierter client", english: "typed client", expect: "/docs/typed-client" },
];

/** Upper bound on glossary expansions applied to one query. */
export const MAX_GLOSSARY_MATCHES = 8;

/** One applied mapping, for transparency in tool output. */
export type GlossaryMatch = { source: string; english: string };

/** German terms, longest first ("dekomprimierung" before "komprimierung"). */
const DE_BY_LENGTH = [...DE_GLOSSARY].sort((a, b) => b.term.length - a.term.length);

/** German folding: lowercase, umlauts without dots, ß as ss, words single-spaced. */
function foldGerman(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/** Russian terms as stem lists, most words first, then longest. */
const RU_TERMS = [...RU_GLOSSARY]
  .map((entry) => ({ entry, stems: entry.term.split(" ") }))
  .sort((a, b) => b.stems.length - a.stems.length || b.entry.term.length - a.entry.term.length);

/** Longest first, so "اعاده التوجيه" (redirect) is consumed before "توجيه" (routing). */
const AR_BY_LENGTH = [...AR_GLOSSARY].sort((a, b) => b.term.length - a.term.length);

/**
 * Chinese and Japanese share the substring matcher. Longest terms first, so
 * "速率限制" and "コントラクトテスト" win over anything shorter inside them.
 */
const CJK_BY_LENGTH = [...ZH_GLOSSARY, ...JA_GLOSSARY].sort(
  (a, b) => [...b.term].length - [...a.term].length,
);
/** Spanish, French and Portuguese share the accent-free whole-word matcher. */
const LATIN_BY_LENGTH = [...ES_GLOSSARY, ...FR_GLOSSARY, ...PT_GLOSSARY].sort(
  (a, b) => b.term.length - a.term.length,
);

/** Lowercase, accents stripped, every non-letter/digit run as one space. */
function foldLatin(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/**
 * Find glossary terms in a query and return the English keywords to search
 * for. Chinese, Japanese and Arabic terms match as substrings (longest first,
 * each span used once; Japanese after NFKC, Arabic after folding); Spanish,
 * French and Portuguese terms match as accent-insensitive whole words or
 * phrases.
 * At most {@link MAX_GLOSSARY_MATCHES} mappings apply.
 *
 * @param query - Raw query (already length-capped by the caller).
 * @returns The applied mappings, in the order found.
 */
export function glossaryMatches(query: string): GlossaryMatch[] {
  const matches: GlossaryMatch[] = [];

  // Chinese and Japanese: NFKC folds full-width Latin and half-width
  // katakana; dropping spaces lets "sql 注入" and "SQL インジェクション" match.
  let zh = query.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  for (const entry of CJK_BY_LENGTH) {
    if (matches.length >= MAX_GLOSSARY_MATCHES) return matches;
    if (zh.includes(entry.term)) {
      matches.push({ source: entry.term, english: entry.english });
      zh = zh.split(entry.term).join("\u0000");
    }
  }

  // Arabic: fold spelling variants, keep single spaces (multi-word terms).
  let ar = ` ${foldArabic(query.toLowerCase()).replace(/\s+/g, " ").trim()} `;
  for (const entry of AR_BY_LENGTH) {
    if (matches.length >= MAX_GLOSSARY_MATCHES) return matches;
    if (ar.includes(entry.term)) {
      matches.push({ source: entry.term, english: entry.english });
      ar = ar.split(entry.term).join("\u0000");
    }
  }

  // Russian: each stem must start consecutive query words; matched words are
  // consumed so a shorter term ("маршрут") cannot re-match "маршрутизация".
  const ruWords = foldCyrillic(query.toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  for (const { entry, stems } of RU_TERMS) {
    if (matches.length >= MAX_GLOSSARY_MATCHES) return matches;
    for (let i = 0; i + stems.length <= ruWords.length; i++) {
      if (stems.every((stemPart, k) => ruWords[i + k]!.startsWith(stemPart))) {
        matches.push({ source: entry.term, english: entry.english });
        for (let k = 0; k < stems.length; k++) ruWords[i + k] = "\u0000";
        break;
      }
    }
  }

  // German: substrings, so compounds ("Ratenbegrenzung") match their parts.
  let de = foldGerman(query);
  for (const entry of DE_BY_LENGTH) {
    if (matches.length >= MAX_GLOSSARY_MATCHES) return matches;
    if (de.includes(entry.term)) {
      matches.push({ source: entry.term, english: entry.english });
      de = de.split(entry.term).join("\u0000");
    }
  }

  let es = foldLatin(query);
  for (const entry of LATIN_BY_LENGTH) {
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
 * Spanish, French, Portuguese and German function words. Once the glossary
 * has recognised such a query, these are dropped from the English-side search:
 * "de" or "la" would only match stray words in English pages and push the
 * right page down.
 */
const LATIN_STOPWORDS = new Set([
  // Spanish
  "a", "al", "como", "con", "de", "del", "el", "en", "es", "hacer", "la", "las", "lo", "los",
  "mi", "mis", "o", "para", "por", "que", "se", "su", "sus", "un", "una", "y",
  // French (elisions fold to "l" and "d")
  "au", "aux", "ce", "cette", "comment", "d", "dans", "des", "du", "est", "et", "faire", "l",
  "le", "les", "ma", "mes", "mon", "ou", "pour", "qui", "sa", "ses", "son", "sur", "une", "avec",
  // Portuguese
  "as", "com", "da", "das", "do", "dos", "e", "em", "fazer", "meu", "minha", "na", "nas", "no",
  "nos", "os", "pela", "pelo", "seu", "sua", "um", "uma",
  // German (folded: für → fur)
  "auf", "bei", "das", "dem", "den", "der", "des", "die", "ein", "eine", "einem", "einen",
  "einer", "fur", "ich", "im", "mit", "oder", "und", "von", "wie", "zu", "zum", "zur",
]);

/**
 * The query to rank the English docs with: the glossary's English keywords
 * first (so the term cap in `tokenize` never drops them), then the rest of
 * the original query (which may carry English words such as "zod"), minus
 * Spanish, French and Portuguese function words and the words already
 * translated.
 *
 * @param query - Raw query.
 * @param matches - Result of {@link glossaryMatches}.
 * @returns The expanded English query, or the original when nothing matched.
 */
export function englishSearchQuery(query: string, matches: readonly GlossaryMatch[]): string {
  if (matches.length === 0) return query;
  // Words already translated by a Latin-script match carry nothing for English.
  const translated = new Set(matches.flatMap((match) => match.source.split(" ")));
  const rest = query
    .split(/\s+/)
    .filter((word) => {
      const folded = foldLatin(word).trim();
      return !LATIN_STOPWORDS.has(folded) && !translated.has(folded);
    })
    .join(" ");
  return [...new Set(matches.map((match) => match.english)), rest].join(" ").trim();
}
