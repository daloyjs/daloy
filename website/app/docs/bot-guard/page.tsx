import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Bot / User-Agent management",
  description:
    "Block empty or known-abusive User-Agent strings and verify declared crawlers (Googlebot/Bingbot) with reverse-DNS + forward-confirm using botGuard(): the in-app equivalent of Nginx/WAF bot rules. Opt-in, allowlist-friendly, zero runtime dependencies.",
  path: "/docs/bot-guard",
  keywords: [
    "bot management",
    "user-agent",
    "botGuard",
    "Googlebot verification",
    "reverse DNS",
    "WAF",
    "crawler",
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Bot / User-Agent management</h1>
      <p>
        DaloyJS ships <code>botGuard()</code>,
        the in-app equivalent of the bot rules Nginx, Cloudflare, and other WAFs
        run at the edge, but inside the app where the framework already owns
        request parsing and client-IP resolution. It does three opt-in jobs:
      </p>
      <ul>
        <li>
          <strong>
            Block empty / missing <code>User-Agent</code>
          </strong>{" "}
          (a common signature of crude scrapers and vulnerability scanners, on
          by default).
        </li>
        <li>
          <strong>
            Block known-abusive <code>User-Agent</code> strings
          </strong>{" "}
          (your own substrings or <code>RegExp</code>s).
        </li>
        <li>
          <strong>Verify declared crawlers</strong>: when a request{" "}
          <em>claims</em> to be Googlebot or Bingbot, confirm it via reverse-DNS
          + forward-confirm (the method Google and Bing themselves document) so
          a spoofed <code>User-Agent</code> can&apos;t impersonate a trusted
          crawler.
        </li>
      </ul>
      <p>
        Every check is opt-in and allowlist-friendly, and the middleware is
        dependency-free and runtime-portable.
      </p>

      <FlowDiagram
        title="Decision order"
        steps={[
          {
            label: "On allowUserAgents?",
            detail: "consulted first; bypasses every other rule",
            eyebrow: "allowlist",
            tone: "success",
          },
          {
            label: "Empty / missing UA?",
            detail: "blockEmptyUserAgent (on by default) -> 403",
            tone: "danger",
          },
          {
            label: "Matches blockedUserAgents?",
            detail: "substring or RegExp -> 403",
            tone: "danger",
          },
          {
            label: "Claims a verified crawler?",
            detail: "reverse-DNS + forward-confirm; spoofed / unverifiable -> 403",
            tone: "danger",
          },
          {
            label: "Allowed -> handler",
            detail: "log mode never blocks; only fires onBlock",
            tone: "success",
          },
        ]}
        caption="The allowlist wins first. After that an empty User-Agent, a blocked pattern, or a crawler that fails reverse-DNS plus forward-confirm is rejected with a 403 by default, so a spoofed Googlebot cannot impersonate a trusted crawler."
      />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        language="ts"
        code={`import { createApp } from "@daloyjs/core";
import { botGuard, WELL_KNOWN_BOTS } from "@daloyjs/core";

const app = createApp();

app.use(
  botGuard({
    trustProxyHeaders: true, // needed to read the client IP for crawler checks
    blockedUserAgents: [/sqlmap/i, /nikto/i, "masscan"],
    verifiedBots: WELL_KNOWN_BOTS, // a spoofed Googlebot/Bingbot → 403
  }),
);`}
      />
      <p>
        Mount it with <code>app.use()</code> so it runs in{" "}
        <code>beforeHandle</code> before your handlers. A blocked request is
        rejected with <code>403 Forbidden</code> RFC 9457 problem+json.
      </p>

      <h2 id="blocking-empty-and-abusive-user-agents">Blocking empty &amp; abusive User-Agents</h2>
      <p>
        <code>blockEmptyUserAgent</code> defaults to <code>true</code>. A plain
        string in <code>blockedUserAgents</code> matches case-insensitively as a
        substring; a <code>RegExp</code> is tested as-is.
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(
  botGuard({
    blockEmptyUserAgent: true,
    blockedUserAgents: ["masscan", "zgrab", /\\bnmap\\b/i],
  }),
);`}
      />

      <h2 id="allowlist-wins">Allowlist wins</h2>
      <p>
        <code>allowUserAgents</code> is consulted first and bypasses{" "}
        <strong>every</strong> other rule (including empty-UA blocking and
        crawler verification), handy for your own monitoring agents or a
        partner&apos;s integration.
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(
  botGuard({
    blockedUserAgents: ["curl"],
    allowUserAgents: ["MyUptimeBot/1.0", /internal-scanner/i],
  }),
);`}
      />

      <h2 id="verifying-declared-crawlers">Verifying declared crawlers</h2>
      <p>
        Spoofing <code>User-Agent: Googlebot</code> is trivial. The only
        reliable check is the one Google and Bing publish: reverse-DNS the
        client IP, make sure the PTR hostname is on an official domain, then
        forward-resolve that hostname back to the same IP.{" "}
        <code>botGuard()</code> ships <code>GOOGLEBOT</code> and{" "}
        <code>BINGBOT</code> rules (bundled as <code>WELL_KNOWN_BOTS</code>) and
        you can add your own:
      </p>
      <CodeBlock
        language="ts"
        code={`import { botGuard, GOOGLEBOT } from "@daloyjs/core";

app.use(
  botGuard({
    trustProxyHeaders: true,
    verifiedBots: [
      GOOGLEBOT,
      {
        name: "MyPartnerCrawler",
        userAgent: /partnercrawler/i,
        // Leading dot enforces a subdomain boundary so evil-partner.com
        // cannot satisfy .partner.example.
        domains: [".partner.example"],
      },
    ],
  }),
);`}
      />
      <p>
        Because <code>verifiedBots</code> needs the client IP, the middleware{" "}
        <strong>refuses to construct</strong> unless you supply{" "}
        <code>resolveIp</code> or set <code>trustProxyHeaders</code>. A request
        that claims to be a crawler but can&apos;t be verified (no client IP,
        or a DNS failure) is blocked by default (
        <code>blockUnverifiableBots</code>, the secure-by-default posture). Set
        it to <code>false</code> to fail open. Verification results are cached
        per IP (default 1 h via <code>cacheTtlMs</code>) so DNS stays off the
        hot path.
      </p>

      <h2 id="monitor-mode-and-callbacks">Monitor mode &amp; callbacks</h2>
      <p>
        Roll it out safely with <code>mode: &quot;log&quot;</code>: nothing is
        blocked, but every match fires <code>onBlock</code> so you can measure
        impact before enforcing.
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(
  botGuard({
    mode: "log",
    trustProxyHeaders: true,
    verifiedBots: WELL_KNOWN_BOTS,
    onBlock: (event) =>
      log.warn(
        { reason: event.reason, ua: event.userAgent, ip: event.ip, bot: event.botName },
        "botGuard match",
      ),
  }),
);`}
      />
      <p>
        The <code>reason</code> is one of{" "}
        <code>&quot;empty-user-agent&quot;</code>,{" "}
        <code>&quot;blocked-user-agent&quot;</code>,{" "}
        <code>&quot;spoofed-bot&quot;</code>, or{" "}
        <code>&quot;unverifiable-bot&quot;</code>.
      </p>

      <h2 id="custom-dns-resolver">Custom DNS resolver</h2>
      <p>
        The default resolver lazily imports <code>node:dns/promises</code>. On a
        runtime without it (Workers, Deno without <code>--allow-net</code>) or
        in tests, supply your own <code>BotResolver</code>:
      </p>
      <CodeBlock
        language="ts"
        code={`import type { BotResolver } from "@daloyjs/core/bot-guard";

const resolver: BotResolver = {
  reverse: (ip) => myDns.reverse(ip),
  forward: (hostname) => myDns.resolve(hostname),
};

app.use(botGuard({ trustProxyHeaders: true, verifiedBots: WELL_KNOWN_BOTS, resolver }));`}
      />
    </>
  );
}
