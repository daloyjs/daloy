import type { TranslatedPagesCopy } from "./types";

/**
 * Brazilian Portuguese (pt-BR) copy for the translated pages under `/pt`. See
 * {@link TranslatedPagesCopy} for the English sources it mirrors. The landing
 * page body lives in `components/home/home-copy-pt.tsx`.
 *
 * Style: Brazilian usage ("você", "banco de dados", "requisição"), with the
 * English terms Brazilian developers keep ("deploy", "middleware", "token"),
 * and no em dashes. Portuguese is offered only through the header language
 * menu (see `PROMOTED_LOCALES` in lib/i18n.ts).
 */
export const PAGES_COPY_PT: TranslatedPagesCopy = {
  listSeparator: ", ",
  end: ".",
  home: {
    title:
      "APIs REST em TypeScript orientadas a contrato e seguras por padrão, feitas para equipes que desenvolvem com IA",
    description:
      "Configurações seguras por padrão, recusa em iniciar em produção com configuração incorreta, zero dependências e clientes tipados OpenAPI 3.1 de um contrato.",
    keywords: [
      "DaloyJS em português",
      "framework TypeScript",
      "API REST TypeScript",
      "seguro por padrão",
      "OpenAPI 3.1",
      "cliente tipado",
      "cadeia de suprimentos",
      "zero dependências",
      "servidor MCP",
    ],
    ogFooter: "Seguro por padrão · Zero dependências em tempo de execução",
  },
  about: {
    title: "Sobre o DaloyJS",
    description:
      "O que é o DaloyJS, quem o mantém e como este framework TypeScript open source, orientado a contrato e seguro por padrão, é licenciado e publicado no npm e JSR.",
    keywords: ["sobre o DaloyJS", "equipe do DaloyJS", "mantenedor do DaloyJS", "Devlin Duldulao"],
    heading: "Sobre o DaloyJS",
    paragraphs: [
      "O DaloyJS é um framework web em TypeScript orientado a contrato e portável entre ambientes de execução. Uma única definição de rota é a fonte da verdade para a validação, o OpenAPI 3.1, os clientes tipados e o handler HTTP. O runtime não tem nenhuma dependência do npm, traz configurações seguras por padrão (limites de tamanho do corpo, timeouts de requisição, sanitização de cabeçalhos, listas de algoritmos JWT permitidos, comparações em tempo constante, parsers protegidos contra poluição de protótipo e um wrapper de fetch opcional protegido contra SSRF) e executa o mesmo aplicativo em Node.js, Bun, Deno, Cloudflare Workers e Vercel.",
      "O projeto é open source sob a licença MIT. O framework é publicado como @daloyjs/core no npm e como @daloyjs/daloy no JSR, a partir do mesmo código-fonte TypeScript. Crie um novo aplicativo com pnpm create daloy@latest. O código-fonte, o rastreador de issues, o changelog e a política de segurança ficam no repositório do GitHub, em github.com/daloyjs/daloy.",
      "Daloy significa “fluxo” em tagalo e se pronuncia da-loy. O nome lembra que requisições, respostas, contratos, tipos e clientes gerados devem seguir um único fluxo, em vez de se separarem entre camadas. Há uma nota mais longa sobre o nome em /pt/about-the-name.",
      "O DaloyJS é mantido por Devlin Duldulao, desenvolvedor fullstack filipino que mora na Noruega, junto com colaboradores voluntários. É um projeto de software, não uma empresa registrada com escritório aberto ao público. Dúvidas técnicas, patrocínio e relatos de segurança passam pela página de contato. Os primeiros passos, a instalação e o tutorial da documentação estão traduzidos para o português; o restante da documentação técnica e o blog estão em inglês.",
    ],
    more: {
      label: "Mais:",
      links: [
        { href: "/pt/contact", label: "contato" },
        { href: "/pt/privacy", label: "privacidade" },
        { href: "/pt/about-the-name", label: "sobre o nome" },
        { href: "/pt/docs", label: "a documentação em português" },
      ],
      lastSeparator: " e ",
    },
  },
  aboutTheName: {
    title: "Sobre o nome",
    description:
      "O que significa Daloy, como se pronuncia e por que este framework TypeScript leva esse nome em tagalo, que quer dizer “fluxo”, como marca da sua identidade.",
    keywords: ["significado de Daloy", "pronúncia de Daloy", "nome DaloyJS", "fluxo em tagalo"],
    heading: "Sobre o nome",
    body: (
      <>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          <span className="font-medium text-foreground">Daloy</span> significa{" "}
          <strong>fluxo</strong> em tagalo. Pronunciamos{" "}
          <strong>da-loy</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          A escrita em baybayin{" "}
          <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔ </span> faz
          parte da identidade do projeto, mas na prática o nome do framework
          continua simples:{" "}
          <strong className="text-foreground">DaloyJS</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          O nome combina com o produto: requisições, respostas, contratos, tipos
          e clientes gerados seguem um único fluxo orientado a contrato, em vez
          de se separarem em camadas distintas.
        </p>
      </>
    ),
  },
  contact: {
    title: "Contato com o DaloyJS",
    description:
      "E-mail, issues no GitHub e o canal privado para relatar vulnerabilidades no DaloyJS: veja como falar com os mantenedores do projeto e sobre quais assuntos.",
    keywords: ["contato DaloyJS", "e-mail DaloyJS", "contato de segurança DaloyJS", "daloyjs@gmail.com"],
    heading: "Contato com o DaloyJS",
    paragraphs: [
      "A forma mais rápida de falar com os mantenedores do DaloyJS é por e-mail: daloyjs@gmail.com. Use esse endereço para erros na documentação, dúvidas sobre versões, patrocínio e qualquer assunto que não seja uma vulnerabilidade. A caixa de entrada é atendida em inglês. Este site não tem telefone nem chat; o e-mail é o canal que realmente chega a uma pessoa.",
      "Para bugs, dúvidas sobre a API e pedidos de funcionalidades, abra uma issue no GitHub em github.com/daloyjs/daloy. As issues são públicas, pesquisáveis e ficam ligadas ao código, o que as torna um arquivo melhor do que uma caixa de entrada privada para o trabalho no produto. Pull requests são bem-vindos quando incluem testes e não enfraquecem nenhuma configuração segura padrão.",
      "Para relatar uma possível vulnerabilidade, não abra uma issue pública com os detalhes do exploit. Use o relato privado de vulnerabilidades do GitHub em github.com/daloyjs/daloy/security/advisories/new, ou escreva para daloyjs@gmail.com com informações suficientes para reproduzir o problema e sem uma prova de conceito maior do que o necessário. A política de segurança, as versões suportadas e os prazos de correção estão no SECURITY.md, no repositório, e em /.well-known/security.txt.",
      "Perfis sociais e de pacotes, caso você queira confirmar que este site corresponde ao mesmo projeto: GitHub (github.com/daloyjs/daloy), npm (@daloyjs/core), JSR (@daloyjs/daloy), Open Collective (opencollective.com/daloyjs), X/Twitter (@daloyjs), Bluesky (daloyjs.dev), Mastodon (@daloyjs@mastodon.social) e dev.to/daloyjs. A política de privacidade em /pt/privacy explica o que este site coleta quando você o visita.",
    ],
    directLabel: "Links diretos:",
    issues: "issues no GitHub",
    advisory: "alerta de segurança privado",
    privacyLabel: ". Privacidade: ",
  },
  privacy: {
    title: "Política de privacidade do DaloyJS",
    description:
      "Quais dados o site daloyjs.dev coleta, quais fornecedores processam o tráfego e como falar com os mantenedores sobre qualquer questão de privacidade.",
    keywords: ["privacidade DaloyJS", "política de privacidade daloyjs.dev", "análise de tráfego DaloyJS"],
    heading: "Política de privacidade do DaloyJS",
    updated: "Última atualização: 29 de outubro de 2026",
    appliesTo: "Aplica-se a",
    courtesy: {
      before: "Esta é uma tradução oferecida para facilitar a leitura. Em caso de divergência, vale a ",
      link: "versão em inglês",
      after: ".",
    },
    paragraphs: [
      "Esta política de privacidade se aplica ao site de apresentação e documentação do DaloyJS em daloyjs.dev. Ela não se aplica aos aplicativos que você cria com o framework @daloyjs/core: esses aplicativos são seus, e você é o controlador dos dados dos usuários deles. O site é um site de documentação estático. Não tem contas de usuário, login, pagamentos nem banco de dados de visitantes no servidor.",
      "Quando você carrega uma página, recebemos os metadados de requisição que qualquer servidor HTTPS vê: endereço IP, user agent, URL solicitada e página de origem. A hospedagem e a entrega rodam na Vercel. A Vercel pode processar esses metadados para operar o serviço, absorver abusos e gerar estatísticas agregadas de tráfego. Também carregamos o Vercel Analytics e o Vercel Speed Insights, que medem visitas e Core Web Vitals sem um perfil publicitário separado. O Google Analytics (propriedade G-DSBFBZT7RQ) é usado para relatórios agregados de tráfego. O servidor MCP da documentação em /mcp conta, no Vercel Analytics, quantas pesquisas são escritas em um idioma diferente do inglês e se encontraram alguma página; ele não armazena nem envia o texto da pesquisa, seu endereço IP ou cookies. Esses fornecedores atuam como operadores de dados para este site. Não vendemos dados pessoais, não usamos pixel de remarketing e não adicionamos dados de visitantes a nenhuma lista de marketing.",
      "O site salva no navegador uma preferência de tema (claro, escuro ou o do sistema) por meio do next-themes, para que a interface não pisque ao recarregar. Um service worker em /sw.js pode armazenar em cache páginas já abertas para a página offline em /offline. Os dois ficam no seu dispositivo. Se você escrever para daloyjs@gmail.com, pelo GitHub ou pelo Open Collective, os termos e as regras de retenção desse terceiro se aplicam à mensagem enviada; guardamos a correspondência apenas pelo tempo necessário para responder a você ou manter um registro de segurança.",
      "Como o mantenedor mora na Noruega, adotamos as normas europeias de proteção de dados como referência, mesmo sendo um pequeno projeto open source. Você pode perguntar quais dados temos sobre você, pedir que apaguemos a correspondência ou se opor à análise de tráfego escrevendo para daloyjs@gmail.com. Você também pode bloquear a análise de tráfego no seu navegador e ler este site em Markdown (Accept: text/markdown) ou via /llms.txt sem executar nosso JavaScript. Esta política foi atualizada pela última vez em 29 de outubro de 2026. Se ela mudar de forma relevante, vamos datar a nova versão aqui.",
    ],
    questions: "Dúvidas sobre privacidade:",
    otherContact: ". Outras formas de contato: ",
  },
  docsIndex: {
    title: "Documentação em português",
    description:
      "Comece a usar o DaloyJS em português: instalação, primeira rota orientada a contrato e um tutorial completo. O restante da documentação está em inglês.",
    keywords: ["documentação DaloyJS", "DaloyJS em português", "tutorial API TypeScript", "primeiros passos DaloyJS"],
    heading: "Documentação em português",
    intro:
      "Estas páginas levam você de uma pasta vazia a uma API tipada e testada. São traduções da documentação original em inglês; o restante da documentação técnica (segurança, adaptadores, referência da API e outros) existe, por enquanto, apenas em inglês.",
  },
};
