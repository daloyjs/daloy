import Link from "next/link";
import type { Route } from "next";

import { ORGANIZATION_EMAIL, PRIVACY_PARAGRAPHS } from "@/lib/trust-content";
import { buildMetadata, SITE_URL } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "DaloyJS privacy policy",
  description:
    "What the daloyjs.dev website collects, which vendors process traffic, and how to reach the maintainers about privacy.",
  path: "/privacy",
  keywords: [
    "DaloyJS privacy",
    "daloyjs.dev privacy policy",
    "DaloyJS analytics",
  ],
  type: "article",
});

export default function PrivacyPage() {
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <p className="text-sm text-muted-foreground">
          Last updated 21 August 2026 · Applies to {SITE_URL}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">
          DaloyJS privacy policy
        </h1>
        {PRIVACY_PARAGRAPHS.map((paragraph) => (
          <p
            key={paragraph.slice(0, 24)}
            className="mt-6 text-lg leading-8 text-muted-foreground"
          >
            {paragraph}
          </p>
        ))}
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          Privacy questions:{" "}
          <a className="underline underline-offset-4" href={`mailto:${ORGANIZATION_EMAIL}`}>
            {ORGANIZATION_EMAIL}
          </a>
          {". Other contact options: "}
          <Link className="underline underline-offset-4" href={"/contact" as Route}>
            /contact
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
