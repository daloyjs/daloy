import type { BenchmarkChartsCopy } from "@/components/benchmark-charts";
import type { HomeCopy } from "./home-copy";

const HELLO_WORLD = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

// new App() は requestId() と secureHeaders() を自動で適用します。
// ここでの明示的な呼び出しは、デフォルト設定のカスタマイズ（置き換え）用です。
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // デフォルトはクライアント IP 単位。プロキシの背後では behindProxy か keyGenerator を設定

app.get(
  "/books/:id",
  {
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "見つかりました", body: z.object({ id: z.string(), title: z.string() }) },
      404: { description: "見つかりません" },
    },
  },
  async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`書籍 \${params.id}\` },
  }),
);

serve(app, { port: 3000 });`;

const MCP_SERVER_SNIPPET = `import { App, bearerAuth, createMcpHandler, mcpRoutes } from "@daloyjs/core";

const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  tools: [/* 入力スキーマを検証するあなたのツール */],
});

const app = new App();
app.use(bearerAuth({ validate: checkToken })); // 認証フックがなければ本番環境では起動を拒否
for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route); // これであなたの API は MCP サーバーにもなります
}`;

/** Japanese strings for the benchmark charts (plain data: crosses to the client). */
const BENCHMARK_CHARTS_JA: BenchmarkChartsCopy = {
  heading: "DaloyJS の実力",
  intro:
    "リポジトリに含まれるベンチマークスイートの実測データです。どの指標でも選んで表示できますが、これらは厳密な同条件比較ではないため、下の注意事項もあわせてお読みください。",
  tabs: {
    deps: {
      trigger: "依存パッケージ数",
      title: "インストールされる推移的依存の数",
      description:
        "インストールで取り込まれるパッケージは、どれも誰かが信頼しなければならない攻撃対象です。推移的依存をまったく取り込まないのは DaloyJS と Hono だけです。",
      takeaway:
        "DaloyJS がインストールする推移的依存は 0 個で、サプライチェーンの攻撃対象の小ささは Hono と並んで最小です。一方、安全に構成した NestJS アプリは 86 個を取り込みます。",
      soWhat:
        "信頼すべきパッケージが少ないほど CVE も減り、予期しない postinstall スクリプトに出くわすこともありません。依存ゼロとは、フレームワーク自体がサプライチェーンに新たな穴を開けないという意味です。残りの依存ツリーは引き続きご自身で確認してください。",
    },
    install: {
      trigger: "インストールサイズ",
      title: "ディスク使用量",
      description:
        "hello world アプリが node_modules に書き込む合計メガバイト数。最小構成と、セキュリティを強化した（セキュア同等の）構成で比較しています。",
      takeaway:
        "DaloyJS のディスク使用量は約 2.4 MB で、セキュア構成にしても増えません。強化機能が最初からコアに含まれているからです。Fastify と NestJS は同等のプラグインを追加すると大きく膨らみます。",
      soWhat:
        "インストールサイズが小さいほど、CI は速く、Docker イメージは軽く、サーバーレスやエッジ環境でのコールドスタートも速くなります。",
    },
    bundle: {
      trigger: "バンドルサイズ",
      title: "バンドルして gzip 圧縮した成果物",
      description:
        "単一ファイルの本番ビルドを gzip 圧縮したサイズです。小さいほどエッジへのデプロイもコールドスタートも速くなります。",
      takeaway:
        "DaloyJS は圧縮後、最小構成で約 61 kB、セキュア構成で約 67 kB と Hono に次ぐ小ささで、Express や Nest のバンドルのごく一部にすぎず、しかもデフォルトで備える機能はより多くなっています。",
      soWhat:
        "バンドルが小さいほどコールドスタート後の起動が速くなり、エッジ関数やサーバーレスのエンドポイントに最初にアクセスしたユーザーの待ち時間が短くなります。",
    },
    throughput: {
      trigger: "スループット",
      title: "1 秒あたりのリクエスト数（ミドルウェアスタックあり）",
      description:
        "2 つのフレームワークが同じルートで同等のミドルウェアスタックを動かし、100 の同時接続で計測しました。これがスループットを公平に問う方法です。両者が実際の処理をこなすとき、どれだけのコストがかかるのか。",
      takeaway:
        "同等のミドルウェア構成では、DaloyJS はすべてのシナリオで Hono を上回りました。静的ルートで約 25.2k 対 19.7k リクエスト/秒（約 28% 上回る）、ボディ付き POST ルートで約 22.5k 対 14.3k（約 58% 上回る）で、しかも Zod でリクエストボディを検証しています。セキュリティと検証をデフォルトで有効にしても、もうベンチマークで負けることはありません。",
      soWhat:
        "フレームワークの層では、セキュリティと検証はほぼ無料です。本当のボトルネックはデータベースとネットワークであり、DaloyJS ではありません。",
    },
  },
  seriesMinimal: "最小構成",
  seriesSecure: "セキュア同等",
  depsUnit: "個の依存",
  scenarios: {
    "Static route": "静的ルート",
    "Dynamic route": "動的ルート",
    "POST + body": "POST + ボディ",
  },
  soWhatLabel: "あなたにとっての意味：",
  takeawayLabel: "結論：",
  ranAt: "2026年10月",
  sourceIn: "ソースコード：",
  caveatsTitle: "同条件の比較ではない理由",
  caveatsIntro:
    "これらのフレームワークは同じ種類の道具ではないため、並べた比較グラフは公平な競争というより、りんごとオレンジを比べるようなものです。数字が何を示し、何を示さないかを率直に説明します。",
  notes: [
    "同条件ではなく、りんごとオレンジの比較です。これらの道具は別物で、こなす仕事の量も違います。DaloyJS はリクエストごとに、Zod または Valibot のスキーマでリクエストボディを検証し、セキュリティヘッダー、リクエスト ID、ボディサイズ上限、リクエストタイムアウトを最初から適用します。他のフレームワークの「最小構成」アプリはこれらをほとんど行わず、「セキュア同等」構成でも一つひとつ揃えることはまれです。つまり DaloyJS の数字には、本来ご自身で実装するはずのセキュリティと検証の作業が含まれています。",
    "サイズの数え方が異なります。DaloyJS は依存ゼロの単一パッケージですが、他のフレームワークは推移的な依存ツリーを解決する必要があり、その正確なサイズは lockfile がいつ生成されたかによって変わります。",
    "スループットは負荷の形に左右されます。双方のミドルウェアスタックが同等の場合、DaloyJS はこれらの GET ルートで Hono を約 27%、ボディ付き POST ルートで約 58% 上回り、しかも DaloyJS は Zod によるボディ検証も行っています。実際のサービスはフレームワークのディスパッチではなく、データベースや I/O の時間に律速されることが多いため、こうしたマイクロベンチマークの数字が本番環境の性能を予測することはまれです。",
    "想定ランタイムが異なります。Elysia など一部のフレームワークは Bun 向けに最適化されていますが、ここでは公平な単一ランタイムの基準を得るため、すべて Node アダプターで計測しました。",
    "1 台のマシン、1 つの時点での計測です。Apple M3 Max、Node v26.4.0、2026年10月、@daloyjs/core 1.5.4 で、マシンには他のバックグラウンド負荷もありました（2 つのフレームワークは続けて計測したため、絶対値より相対比較のほうが信頼できます）。ハードウェア、ランタイム、バージョンが変われば数字も変わります。",
  ],
};

/** Japanese (ja) landing-page copy. Mirrors `HOME_COPY_EN`. */
export const HOME_COPY_JA: HomeCopy = {
  locale: "ja",
  links: {
    gettingStarted: "/ja/docs/getting-started",
    docs: "/ja/docs",
    installation: "/ja/docs/installation",
    tutorial: "/ja/docs/tutorials/bookstore",
    mcp: "/docs/mcp",
    openapi: "/ja/docs/openapi",
    blog: "/blog",
  },
  hero: {
    title: "AI を活用する開発チームのための、コントラクトファーストでセキュアバイデフォルトな TypeScript REST API",
    subtitle:
      "DaloyJS は安全なデフォルト設定を備え、本番環境で既知の設定ミスを見つけると起動を拒否し、ランタイム依存はゼロで、強化されたリリースパイプラインと署名付きの来歴証明を持っています。アプリを完全に安全にしたり、あらゆるサプライチェーン攻撃を防いだりできるフレームワークはありません。だからこそドキュメントでは、何がデフォルトで有効か、何をご自身で有効にする必要があるか、そして何のリスクが残るかを明記しています。",
    primaryCta: "はじめる：Daloy をインストール",
    secondaryCta: "ドキュメントを読む",
    contentLanguageNote:
      "はじめに、インストール、チュートリアルと主要ガイド（ルーティング、検証、エラー、OpenAPI、型付きクライアント、セキュリティ）は日本語で読めます。その他のドキュメントとブログは英語のみです。",
    factsLabel: "プロジェクトの概要",
    facts: [
      "3,000 件以上のフレームワークテストがすべて成功",
      "カバレッジ基準：行と関数 ≥90%、分岐 ≥92%",
      "ランタイム依存 0 個",
      "Node 24 LTS、Node 26+、Bun、Deno、Cloudflare",
      "MIT ライセンス",
    ],
    nameNote: (
      <>
        <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔</span> Daloy
        はタガログ語で<span className="text-foreground">「流れ」</span>を意味します（発音は{" "}
        <span className="whitespace-nowrap text-foreground">da-loy</span>）。
      </>
    ),
    aboutLabel: "概要",
    aboutHref: "/ja/about",
    nameLabel: "名前の由来",
    nameHref: "/ja/about-the-name",
    tutorialLabel: "チュートリアル：書店 API",
  },
  security: {
    eyebrow: "セキュリティとサプライチェーン",
    title: "セキュアバイデフォルト：AI が生成したコードの防護層",
    body: "コードを AI モデルが生成するようになった今、開発者のタイピング速度はもはやボトルネックではありません。本当に重要なのは、ランタイムのセキュリティとサプライチェーンの完全性です。DaloyJS はランタイムの層で防護を強制します。リクエストボディのサイズ上限、タイムアウト、プロトタイプ汚染の防止、5xx エラー詳細の秘匿、起動時の設定ミスの拒否、そして悪用されうる推移的依存はありません。",
  },
  features: {
    secureDefaults: {
      title: "セキュアバイデフォルトなランタイム設定",
      body: "基本的な防護をプラグインや手書きのエラールートに任せるフレームワークもありますが、DaloyJS のコアは最初から防護が有効です。リクエストボディのサイズ上限、リクエストタイムアウト、プロトタイプ汚染に強い JSON パース、正しい 405 Method Not Allowed レスポンス、そしてフェイルクローズドな 5xx エラー詳細の秘匿（明示的に宣言した開発・テスト環境以外では常に有効）。本番環境では、弱いセッションシークレットや、CSRF を有効にしていないセッション Cookie など、既知の設定ミスを見つけると起動を拒否します。",
      badges: [
        "ボディ上限（デフォルト 1 MiB）",
        "リクエストタイムアウト",
        "プロトタイプ汚染の防止",
        "RFC 9457 problem+json",
        "厳格なスキーマ検証",
        "起動時の設定チェック",
      ],
    },
    zeroDeps: {
      title: "ランタイム依存ゼロ",
      body: "@daloyjs/core をインストールしても、推移的依存パッケージは 1 つも増えません。監査すべき postinstall スクリプトも、選んだ覚えのない依存から突然現れる CVE もありません。フレームワーク自体は依存ツリーを持ち込みませんが、アプリのその他の依存は引き続きご自身で確認してください。",
      stat: {
        value: "0",
        label: "@daloyjs/core に含まれる推移的依存パッケージ",
      },
    },
    supplyChain: {
      title: "サプライチェーンを強化したプロジェクトテンプレート",
      body: "create-daloy で pnpm を選ぶと、pnpm-workspace.yaml は最初から強化済みです。ignoreScripts はインストールスクリプトに潜む悪意あるペイロードを遮断し（ただしインポート時に実行されるコードは防げません）、24 時間の minimumReleaseAge は公開直後に発見される悪意あるバージョンを避け、verifyStoreIntegrity はインストール結果の信頼性を確保します。オプションのセキュリティ一式には、強化された GitHub Actions、Dependabot、CODEOWNERS、SECURITY.md、lockfile の取得元検証、tini を使う非 root のコンテナテンプレート、そして本番設定をチェックする daloy doctor が加わります。",
      badges: [
        "ignoreScripts",
        "24 時間の minimumReleaseAge",
        "verifyStoreIntegrity",
        "SHA で固定した Actions",
        "daloy doctor による監査",
      ],
    },
    aiNative: {
      title: "AI のためのプロジェクトテンプレート",
      body: "create-daloy で作成するすべてのプロジェクトには AGENTS.md とコンテキスト用の skills が含まれ、これらのドキュメントは MCP からも読めます。AGENTS.md を読み込んだコーディングエージェントは、面倒なプロンプトエンジニアリングなしで、フレームワークの規約、ルーティングのルール、セキュリティの基本機能を把握します。",
      badges: ["AGENTS.md 同梱", "コンテキスト用 skills", "MCP で読み取り可能"],
    },
    streaming: {
      title: "ストリーミングとオブザーバビリティ",
      body: "バックプレッシャーに対応した SSE と NDJSON のユーティリティ、そしてセマンティック規約の属性を持つ HTTP サーバースパンを出力する OpenTelemetry のトレースフックを備えています。",
      badges: ["バックプレッシャー対応 SSE", "NDJSON ストリーミング", "OTel HTTP サーバースパン"],
    },
    portable: {
      title: "ランタイム間の移植性",
      body: "コアが扱うのは Request → Response だけです。アダプターは外側の層にあります。Node、Bun、Deno、Cloudflare Workers、Vercel、Fastly Compute、AWS Lambda で、同じアプリ、同じテストが動きます。",
      badges: ["Node 24+", "Bun", "Deno", "Cloudflare Workers", "Vercel", "AWS Lambda"],
    },
    contractFirst: {
      title: "コントラクトファーストの設計",
      body: "1 つのルート定義が、検証、型、OpenAPI 3.1、型付きクライアント、組み込みのコントラクトテストの唯一の情報源になり、食い違いが入り込む余地をなくします。",
      badges: ["ランタイム検証", "OpenAPI 3.1 仕様", "Hey API 型付きクライアント", "組み込みのコントラクトテスト"],
    },
    typedClients: {
      title: "Hey API 型付きクライアント",
      body: "pnpm gen を実行するだけで、実際の仕様から完全に型付けされた fetch SDK を生成でき、どんな呼び出し元、どんな TS プロジェクトでも使えます。プロセス内の型付きクライアントを使って、コード生成を完全に省くこともできます。",
      badges: ["pnpm gen", "設定不要", "エンドツーエンドで型付けされた fetch SDK"],
    },
    batteries: {
      title: "必要なものはすべて同梱",
      body: "エッジ対応のセッション、HTTP と同じレート制限枠を共有する WebSocket、構造化ログ、グレースフルシャットダウン。通常はプラグインを組み合わせて用意する本番向けの基盤がすべて含まれ、それでもランタイム依存はゼロです。",
      badges: ["エッジセッション", "WebSocket のレート制限", "構造化ログ", "グレースフルシャットダウン"],
    },
  },
  benchmarks: {
    eyebrow: "ベンチマークとパフォーマンス",
    title: "数字と、その注意事項",
    body: "AI エージェントがループでツールを呼び出し、高い並列度でリクエストを送るとき、スループットとコールドスタートの遅延は極めて重要になります。DaloyJS はセキュリティチェックをデフォルトで有効にしており、これらのベンチマークはすべての防護を有効にした状態での性能を測っています。",
    charts: BENCHMARK_CHARTS_JA,
  },
  mcp: {
    eyebrow: "機械のために：AI エージェントとツール向け",
    title: "DaloyJS は MCP に対応しています",
    intro: (
      <>
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noreferrer"
          hrefLang="en"
          className="underline underline-offset-4"
        >
          Model Context Protocol
        </a>
        （MCP）は、Claude、Cursor、VS Code などの AI エージェントがツールを呼び出し、ドキュメントを読むためのオープン標準です。DaloyJS
        は両方に対応しています。あなたのアプリは MCP サーバーになれますし、このサイトのドキュメント（英語）自体も MCP サーバーです。
      </>
    ),
    serverTitle: "あなたの API を MCP サーバーに",
    serverBody: (
      <>
        DaloyJS は <code>@daloyjs/core</code> だけで MCP サーバーを構築でき、SDK
        は不要です。Streamable HTTP トランスポート、入力スキーマの検証、そして本番環境の起動時ガードを備えています。MCP
        エンドポイントの処理チェーンに認証フックがなければ、起動を拒否します。このガードが確認するのは、フックが存在し、本番環境ですべてのリクエストに対して実行されたかどうかであり、実際に誰かを拒否したかどうかではありません。認証ロジックのテストも忘れずに行ってください。
      </>
    ),
    serverCta: "MCP サーバーを構築する →",
    serverSnippet: MCP_SERVER_SNIPPET,
    docsTitle: "このサイトのドキュメントを MCP で読む",
    docsBody: "公開された読み取り専用のエンドポイントです。AI コーディングアシスタントが直接検索して読めるので、コピー＆ペーストも API キーも不要です。",
    endpointTitle: "エンドポイント",
    endpointBody: "MCP 対応のクライアントをこの URL に向けてください：",
    tools: {
      search_docs: "すべてのドキュメントページをキーワードで検索し、関連度順に並べます。",
      get_doc: "ルートまたは slug を指定して、ページの全文を読みます。",
      list_docs: "1 回の呼び出しで、利用できるすべてのドキュメントページを一覧できます。",
    },
    configLabel: "MCP クライアントの設定に追加",
    stdioNote: "stdio にしか対応していないクライアントをお使いですか？ 次のようにブリッジできます：",
  },
  contracts: {
    eyebrow: "影響範囲を限定する",
    title: "コントラクトは飾りの構文ではなく、セキュリティの境界です",
    body: "AI ファーストのワークフローでは、コントラクトは人間のための見た目の飾りではなく、ハルシネーションで生まれたデータ構造がコンポーネント間に漏れ出すのを防ぐ、機械が強制する境界です。1 つのルートコントラクトがリクエストを厳格に検証し、レスポンスの内容を制約し、OpenAPI 3.1 仕様と型付きクライアントをその場で生成します。",
    flow: {
      title: "コントラクトの流れ",
      tagline: "一度定義すれば -> あとは自動生成",
      steps: [
        { label: "コントラクト", detail: "GET /books/:id + z.object(...)" },
        { label: "検証", detail: "ランタイム、双方向" },
        { label: "OpenAPI 3.1", detail: "ライブ仕様 + /docs UI" },
        { label: "型付きクライアント", detail: "pnpm gen -> fetch SDK" },
      ],
    },
    helloWorld: HELLO_WORLD,
  },
  scalar: {
    title: "Scalar API リファレンスを 1 行で",
    body: (
      <>
        Scalar は Swagger UI の現代的な後継です。高速でシンプル、ダークモードにネイティブ対応し、リクエストをその場で試せます。DaloyJS
        では、これはプラグインではなく<em>デフォルト</em>のドキュメント UI です。<code>App</code>{" "}
        のコンストラクターで <code>docs: true</code> を設定すると、<code>/docs</code>{" "}
        にこのページが自動でマウントされ、<code>/openapi.json</code> でライブの OpenAPI 3.1 仕様が提供されます。
      </>
    ),
    footer: "ルートコントラクトから自動生成され、追加のコードは不要です。Swagger UI や Redoc のほうがお好みなら、設定を 1 つ変えるだけです。",
    guideCta: "OpenAPI とドキュメント UI のガイド →",
  },
  comparison: {
    eyebrow: "エコシステムのトレードオフ",
    title: "各フレームワークの長所を取り入れ、妥協を減らす",
    body: "DaloyJS は 1 つの項目だけで勝とうとはしていません。目指しているのは、さまざまな良いアイデアの間をつなぐグルーコードを書く手間を、開発者から取り除くことです。",
    youWant: "求めるもの",
    todayPrefix: "現在：",
    todaysBest: "現時点での最適解",
    daloyGives: "DaloyJS が提供するもの",
    rows: [
      {
        want: "構築するアプリに移植可能なサプライチェーン強化",
        best: "pnpm のデフォルト設定 + ランタイム依存ゼロのコア",
        give: "強化された pnpm インストール設定、取得元を検証した lockfile、SBOM + npm の来歴証明",
      },
      {
        want: "サーバーレス / エッジ環境への適合",
        best: "Hono",
        give: "Web 標準ベースのコア、マルチランタイムのアダプター",
      },
      {
        want: "成熟した Node の運用機能とドキュメント",
        best: "Fastify",
        give: "カプセル化されたプラグイン、構造化ログ、グレースフルシャットダウン",
      },
      {
        want: "モダンな TS ファーストの開発体験、Bun 対応",
        best: "Elysia",
        give: "エンドツーエンドで型付けされたハンドラー、コンテキスト、クライアント",
      },
      {
        want: "最高の OpenAPI 体験",
        best: "FastAPI",
        give: "1 つのルート定義から OpenAPI 3.1 を組み込みで生成",
      },
      {
        want: "最高の型付きクライアントのコード生成",
        best: "Hey API",
        give: "pnpm gen → 完全に型付けされた fetch SDK",
      },
    ],
  },
  cta: {
    title: "セキュアバイデフォルトで出荷する準備はできましたか？",
    body: "数秒でプロジェクトを作成できます。パッケージマネージャーのインストール設定を強化し、インストールスクリプトを遮断する CI、バージョンを固定した GitHub Actions、Dependabot、CODEOWNERS、lockfile の取得元検証を生成します。アプリが成長してもコントラクトは一貫したまま、同じアプリが Node、Bun、Deno、Cloudflare Workers で動きます。",
    install: "DaloyJS をインストール",
    tutorial: "書店 API を構築する",
    source: "ソースコードを見る",
  },
  support: {
    eyebrow: "プロジェクトを支援する",
    title: "DaloyJS で時間を節約できたら、コーヒーを 1 杯ごちそうしてください",
    body: "DaloyJS は無料で、MIT ライセンスのオープンソースです。ドキュメント、記事、あるいはフレームワーク自体のおかげで少しでも楽に出荷できたなら、コーヒーを 1 杯ごちそうしていただくことが、この活動を続ける何よりの支えになります。",
    coffee: "コーヒーをごちそうする",
    blog: "ブログを読む（英語）",
  },
};
