/**
 * Copy for the trust-anchor pages (`/about`, `/contact`, `/privacy`).
 *
 * AI agents look for these three URLs, with real prose (not a stub), before
 * they will treat a project as a legitimate publisher. Keep each body well
 * over 500 characters and factual: no invented phone numbers or street
 * addresses.
 */

export { ORGANIZATION_EMAIL } from "@/lib/seo";

export const ABOUT_PARAGRAPHS = [
  "DaloyJS is a runtime-portable, contract-first TypeScript web framework. One route definition is the source of truth for validation, OpenAPI 3.1, typed clients, and the HTTP handler. The runtime has zero npm dependencies, ships secure-by-default guardrails (body limits, request timeouts, header sanitization, JWT algorithm allowlists, timing-safe comparisons, prototype-pollution-safe parsers, SSRF-safe fetch), and runs the same app on Node.js, Bun, Deno, Cloudflare Workers, and Vercel.",
  "The project is open source under the MIT license. The framework publishes as @daloyjs/core on npm and as @daloyjs/daloy on JSR from the same TypeScript source. Scaffold a new app with pnpm create daloy@latest. The source, issue tracker, changelog, and security policy live in the GitHub repository at github.com/daloyjs/daloy.",
  "Daloy means flow in Tagalog, pronounced da-loy. The name is a reminder that requests, responses, contracts, types, and generated clients should move through one flow instead of drifting apart across layers. A longer note on the name is at /about-the-name.",
  "DaloyJS is maintained by Devlin Duldulao, a Filipino fullstack developer based in Norway, together with volunteer contributors. It is a software project, not a registered company with a public walk-in office. Technical questions, sponsorship, and security reports all go through the contact page.",
] as const;

export const CONTACT_PARAGRAPHS = [
  "The fastest way to reach the DaloyJS maintainers is email: daloyjs@gmail.com. Use that address for documentation mistakes, release questions, sponsorship, and anything that is not a vulnerability. We read it in English. There is no phone line and no chat widget on this site; email is the channel that actually reaches a human.",
  "For bugs, API questions, and feature requests, open a GitHub issue on github.com/daloyjs/daloy. Issues stay public, searchable, and attached to the code, which is a better archive than a private inbox for product work. Pull requests are welcome when they include tests and do not weaken a security default.",
  "To report a suspected vulnerability, do not open a public issue with exploit details. Use GitHub private vulnerability reporting at github.com/daloyjs/daloy/security/advisories/new, or email daloyjs@gmail.com with enough information to reproduce and no proof-of-concept that is larger than it needs to be. The security policy, supported versions, and patch SLAs are in SECURITY.md in the repository and at /.well-known/security.txt.",
  "Social and package profiles, if you want to verify that this site matches the same project: GitHub (github.com/daloyjs/daloy), npm (@daloyjs/core), JSR (@daloyjs/daloy), Open Collective (opencollective.com/daloyjs), X/Twitter (@daloyjs), Bluesky (daloyjs.dev), Mastodon (@daloyjs@mastodon.social), and dev.to/daloyjs. The privacy policy at /privacy explains what this website itself collects when you visit.",
] as const;

export const PRIVACY_PARAGRAPHS = [
  "This privacy policy applies to the DaloyJS marketing and documentation website at daloyjs.dev. It does not apply to applications you build with the @daloyjs/core framework: those are yours, and you are the controller for their users. The website is a static documentation site. It has no user accounts, no login, no paid checkout, and no server-side database of visitors.",
  "When you load a page we receive the request metadata any HTTPS server sees: IP address, user agent, requested URL, and referrer. Hosting and delivery run on Vercel. Vercel may process that metadata to operate the service, absorb abuse, and produce aggregate traffic statistics. We also load Vercel Analytics and Vercel Speed Insights, which measure visits and Core Web Vitals without a separate advertising profile. Google Analytics (property G-DSBFBZT7RQ) is used for aggregated traffic reports. Those vendors act as processors for this site. We do not sell personal data, we do not run a remarketing pixel, and we do not append visitor data to a marketing list.",
  "The site stores a theme preference (light, dark, or system) in the browser via next-themes so the UI does not flash on reload. A service worker at /sw.js may cache previously opened pages for the offline fallback at /offline. Both of those stay on your device. If you email daloyjs@gmail.com, GitHub, or Open Collective, that third party's terms and retention rules apply to the message you sent; we keep correspondence only as long as it is needed to answer you or to keep a security record.",
  "Because the maintainer is based in Norway, European data-protection rules are the baseline we hold ourselves to even though this is a small open-source project. You can ask what we hold about you, ask us to delete correspondence, or object to analytics by emailing daloyjs@gmail.com. You can also block analytics in your browser, and you can read this site as Markdown (Accept: text/markdown) or via /llms.txt without executing our JavaScript. This policy was last updated on 21 August 2026. If it changes in a material way we will date the new version here.",
] as const;

/**
 * Count the visible characters in a trust page's body copy.
 *
 * @param paragraphs - Body paragraphs in order.
 */
export function trustPageCharacterCount(
  paragraphs: readonly string[],
): number {
  return paragraphs.join("").length;
}
