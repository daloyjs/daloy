import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "About the name",
  description:
    "Learn what Daloy means, how to pronounce it, and why the framework uses the name.",
  path: "/about-the-name",
  keywords: [
    "Daloy meaning",
    "Daloy pronunciation",
    "DaloyJS name",
    "Tagalog flow",
  ],
  type: "article",
});

export default function AboutTheNamePage() {
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <h1 className="text-4xl font-bold tracking-tight">About the name</h1>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          <span className="font-medium text-foreground">Daloy</span> means{" "}
          <strong>flow</strong> in Tagalog. We pronounce it{" "}
          <strong>da-loy</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          The Baybayin spelling{" "}
          <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔ </span> is part of
          the project&apos;s identity, but the framework name stays simple in
          practice:{" "}
          <strong className="text-foreground">DaloyJS</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          The name fits the product: requests, responses, contracts, types, and
          generated clients all move through one contract-first flow instead of
          drifting apart across separate layers.
        </p>
      </section>
    </main>
  );
}
