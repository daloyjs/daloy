import type { TranslatedPagesCopy } from "./types";

/**
 * Japanese (ja) copy for the translated pages under `/ja`. See
 * {@link TranslatedPagesCopy} for the English sources it mirrors. The landing
 * page body lives in `components/home/home-copy-ja.tsx`.
 *
 * Style: polite です・ます form, full-width punctuation, a half-width space
 * between Japanese text and Latin words or numbers, katakana for established
 * loanwords (ミドルウェア, ルーター), and no em dashes.
 */
export const PAGES_COPY_JA: TranslatedPagesCopy = {
  listSeparator: "、",
  end: "。",
  home: {
    title: "AI を活用する開発チームのための、コントラクトファーストでセキュアバイデフォルトな TypeScript REST API フレームワーク",
    description:
      "安全なデフォルト設定、本番環境での既知の設定ミスによる起動拒否、ランタイム依存ゼロ、そして 1 つのルート定義から OpenAPI 3.1 と型付きクライアントを生成します。",
    keywords: [
      "DaloyJS 日本語",
      "TypeScript フレームワーク",
      "TypeScript REST API",
      "セキュアバイデフォルト",
      "OpenAPI 3.1",
      "型付きクライアント",
      "サプライチェーンセキュリティ",
      "依存ゼロ",
      "MCP サーバー",
    ],
    ogFooter: null,
  },
  about: {
    title: "DaloyJS について",
    description:
      "DaloyJS とは何か、誰がメンテナンスしているか、そしてこのコントラクトファーストでセキュアなオープンソース TypeScript フレームワークのライセンスと配布方法。",
    keywords: ["DaloyJS について", "DaloyJS チーム", "DaloyJS メンテナー", "Devlin Duldulao"],
    heading: "DaloyJS について",
    paragraphs: [
      "DaloyJS は、コントラクトファーストでランタイム間を移植できる TypeScript の Web フレームワークです。1 つのルート定義が、バリデーション、OpenAPI 3.1、型付きクライアント、HTTP ハンドラーの唯一の情報源になります。ランタイムの npm 依存は 1 つもなく、安全なデフォルト（リクエストボディのサイズ上限、リクエストタイムアウト、ヘッダーのサニタイズ、JWT アルゴリズムの許可リスト、定数時間比較、プロトタイプ汚染に強いパーサー、オプションの SSRF 対策付き fetch ラッパー）を備え、同じアプリを Node.js、Bun、Deno、Cloudflare Workers、Vercel で動かせます。",
      "本プロジェクトは MIT ライセンスのオープンソースです。フレームワークは npm では @daloyjs/core、JSR では @daloyjs/daloy として公開されており、どちらも同じ TypeScript ソースから作られています。新しいアプリは pnpm create daloy@latest で作成できます。ソースコード、Issue トラッカー、変更履歴、セキュリティポリシーは GitHub リポジトリ github.com/daloyjs/daloy にあります。",
      "Daloy はタガログ語で「流れ」を意味し、ダロイ（da-loy）と発音します。この名前には、リクエスト、レスポンス、コントラクト、型、生成されたクライアントが、層ごとにばらばらになるのではなく、1 つの流れに沿って進むべきだという考えが込められています。名前について詳しくは /ja/about-the-name をご覧ください。",
      "DaloyJS は、ノルウェー在住のフィリピン人フルスタック開発者 Devlin Duldulao とボランティアのコントリビューターによってメンテナンスされています。これはソフトウェアプロジェクトであり、一般向けの窓口を持つ登記法人ではありません。技術的な質問、スポンサーシップ、セキュリティ報告はお問い合わせページからご連絡ください。ドキュメントのうち、はじめに、インストール、チュートリアルは日本語に翻訳されています。その他の技術ドキュメントとブログは英語です。",
    ],
    more: {
      label: "関連ページ：",
      links: [
        { href: "/ja/contact", label: "お問い合わせ" },
        { href: "/ja/privacy", label: "プライバシー" },
        { href: "/ja/about-the-name", label: "名前の由来" },
        { href: "/ja/docs", label: "日本語ドキュメント" },
      ],
      lastSeparator: "、",
    },
  },
  aboutTheName: {
    title: "名前の由来",
    description:
      "Daloy の意味と発音、そしてこの TypeScript フレームワークが「流れ」を意味するタガログ語の名前を選んだ理由。",
    keywords: ["Daloy 意味", "Daloy 発音", "DaloyJS 名前", "タガログ語 流れ"],
    heading: "名前の由来",
    body: (
      <>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          <span className="font-medium text-foreground">Daloy</span>{" "}
          はタガログ語で<strong>「流れ」</strong>を意味します。発音は{" "}
          <strong>da-loy</strong>（ダロイ）です。
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          バイバイン文字による表記{" "}
          <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔ </span>
          はプロジェクトのアイデンティティの一部ですが、実際に使うフレームワークの名前はシンプルに{" "}
          <strong className="text-foreground">DaloyJS</strong> です。
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          この名前はプロダクトそのものを表しています。リクエスト、レスポンス、コントラクト、型、生成されたクライアントが、別々の層に分かれるのではなく、コントラクトファーストという 1 つの流れに沿って進みます。
        </p>
      </>
    ),
  },
  contact: {
    title: "DaloyJS へのお問い合わせ",
    description:
      "DaloyJS のメール、GitHub の Issue、非公開の脆弱性報告の窓口と、プロジェクトのメンテナーへの連絡方法。",
    keywords: ["DaloyJS お問い合わせ", "DaloyJS メール", "DaloyJS セキュリティ 連絡先", "daloyjs@gmail.com"],
    heading: "DaloyJS へのお問い合わせ",
    paragraphs: [
      "DaloyJS のメンテナーに最も早く連絡できる方法は、daloyjs@gmail.com へのメールです。ドキュメントの誤り、リリースに関する質問、スポンサーシップなど、セキュリティ脆弱性以外のことであればこのアドレスをお使いください。メールは英語で対応します。このサイトには電話もライブチャットもありません。実際に人に届く窓口はメールです。",
      "バグの報告、API に関する質問、機能のリクエストは、GitHub の github.com/daloyjs/daloy で Issue を作成してください。Issue は公開され、検索でき、コードとも紐づくため、プロダクトの作業記録としては個人の受信箱よりも適しています。テストが付いていて、安全なデフォルトを弱めないものであれば、プルリクエストも歓迎します。",
      "セキュリティ脆弱性の疑いを報告する場合は、公開の Issue に攻撃の詳細を書かないでください。GitHub の非公開脆弱性報告 github.com/daloyjs/daloy/security/advisories/new を使うか、daloyjs@gmail.com に再現に十分な情報を送ってください。概念実証は必要最小限にとどめてください。セキュリティポリシー、サポート対象のバージョン、対応期限は、リポジトリの SECURITY.md と /.well-known/security.txt に記載されています。",
      "このサイトと以下のアカウントが同じプロジェクトのものか確認したい場合は、次のソーシャルとパッケージのページをご覧ください：GitHub（github.com/daloyjs/daloy）、npm（@daloyjs/core）、JSR（@daloyjs/daloy）、Open Collective（opencollective.com/daloyjs）、X/Twitter（@daloyjs）、Bluesky（daloyjs.dev）、Mastodon（@daloyjs@mastodon.social）、dev.to/daloyjs。このサイトを訪問したときに収集される情報は、/ja/privacy のプライバシーポリシーで説明しています。",
    ],
    directLabel: "直接リンク：",
    issues: "GitHub の Issue",
    advisory: "非公開のセキュリティアドバイザリー",
    privacyLabel: "。プライバシー：",
  },
  privacy: {
    title: "DaloyJS プライバシーポリシー",
    description:
      "daloyjs.dev のウェブサイトが収集するデータ、サイトのトラフィックを処理する事業者、そしてプライバシーについてメンテナーに連絡する方法。",
    keywords: ["DaloyJS プライバシー", "daloyjs.dev プライバシーポリシー", "DaloyJS アクセス解析"],
    heading: "DaloyJS プライバシーポリシー",
    updated: "最終更新日：2026年10月29日",
    appliesTo: "適用対象",
    courtesy: {
      before: "このページは参考のための翻訳です。内容に相違がある場合は",
      link: "英語版",
      after: "が優先されます。",
    },
    paragraphs: [
      "このプライバシーポリシーは、daloyjs.dev にある DaloyJS の紹介・ドキュメントサイトに適用されます。@daloyjs/core フレームワークで構築したアプリケーションには適用されません。それらのアプリはあなたのものであり、そのユーザーデータの管理者はあなたです。このサイトは静的なドキュメントサイトで、ユーザーアカウント、ログイン、決済、訪問者の情報を保存するサーバー側のデータベースはありません。",
      "ページを読み込むと、どの HTTPS サーバーでも受け取るリクエストのメタデータ（IP アドレス、ユーザーエージェント、リクエストされた URL、参照元ページ）を受け取ります。サイトのホスティングと配信は Vercel 上で行われています。Vercel はサービスの運用、不正利用の防止、集計されたトラフィック統計のためにこのメタデータを処理することがあります。また、訪問数と Core Web Vitals を計測するために Vercel Analytics と Vercel Speed Insights を読み込んでいますが、個別の広告プロファイルは作成しません。Google Analytics（プロパティ G-DSBFBZT7RQ）は集計されたトラフィックレポートに使用しています。/mcp にあるドキュメント用 MCP サーバーは、英語以外の言語による検索の件数と、その検索でページが見つかったかどうかを Vercel Analytics で集計します。検索内容、IP アドレス、Cookie は保存も送信もしません。これらの事業者は、このサイトのデータ処理者として機能します。私たちは個人データを販売せず、リターゲティング用のピクセルも使わず、訪問者のデータをマーケティングリストに追加することもありません。",
      "サイトは、再読み込み時に画面がちらつかないように、next-themes を使ってテーマの設定（ライト、ダーク、システム）を 1 つブラウザに保存します。/sw.js の Service Worker は、オフラインページ /offline のために、以前に開いたページをキャッシュすることがあります。どちらもあなたのデバイス上にのみ保存されます。daloyjs@gmail.com、GitHub、Open Collective にメッセージを送った場合、そのメッセージには各サービスの規約と保存ルールが適用されます。私たちはやり取りを、返信やセキュリティ記録の保持に必要な期間だけ保管します。",
      "メンテナーがノルウェーに住んでいるため、小さなオープンソースプロジェクトではありますが、ヨーロッパのデータ保護ルールを自らの基準としています。daloyjs@gmail.com にメールすれば、私たちがあなたについてどんな情報を持っているかを尋ねたり、やり取りの削除を求めたり、アクセス解析に異議を申し立てたりできます。ブラウザで解析スクリプトをブロックすることも、私たちの JavaScript を実行せずに Markdown（Accept: text/markdown）や /llms.txt でこのサイトを読むこともできます。このポリシーの最終更新日は 2026年10月29日です。重要な変更がある場合は、ここに新しい版の日付を記載します。",
    ],
    questions: "プライバシーに関するご質問：",
    otherContact: "。その他の連絡方法：",
  },
  docsIndex: {
    title: "日本語ドキュメント",
    description:
      "日本語で DaloyJS を始めましょう。インストール、最初のコントラクトファーストなルート、そして完全なチュートリアル。その他のドキュメントは現在英語です。",
    keywords: ["DaloyJS ドキュメント", "DaloyJS 日本語", "TypeScript API チュートリアル", "DaloyJS はじめに"],
    heading: "日本語ドキュメント",
    intro:
      "これらのページでは、空のフォルダーから、型付きでテスト済みの API までを順に案内します。英語の公式ドキュメントを翻訳したもので、その他の技術ドキュメント（セキュリティ、アダプター、API リファレンスなど）は現在英語のみです。",
  },
};
