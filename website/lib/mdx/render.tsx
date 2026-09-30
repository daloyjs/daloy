import { evaluate } from "@mdx-js/mdx";
import type { MDXComponents } from "mdx/types";
import type { Route } from "next";
import Link from "next/link";
import type { ComponentProps } from "react";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";

import { AuthRole, IdpBoundary } from "@/components/auth-role";
import { AutoTypeTable } from "@/components/auto-type-table";
import { Callout } from "@/components/callout";
import { Card, Cards } from "@/components/cards";
import { CodeBlock } from "@/components/code-block";
import { BranchDiagram, Diagram, FlowDiagram, LayerStack, SequenceDiagram } from "@/components/diagram";
import { File, Files, Folder } from "@/components/files";
import { PackageInstall } from "@/components/package-install";
import { SiteApiReference } from "@/components/site-api-reference";
import { Step, Steps } from "@/components/steps";
import { TypeTable } from "@/components/type-table";
import { UseCaseGuide } from "@/components/use-case-guide";

import remarkDaloy from "./remark-daloy";

/**
 * Markdown links: internal paths go through `next/link` (client navigation and
 * prefetch); external ones open in a new tab without leaking the opener.
 */
function MdxLink({ href = "", children, ...rest }: ComponentProps<"a">) {
  if (href.startsWith("/")) {
    return (
      <Link href={href as Route} {...rest}>
        {children}
      </Link>
    );
  }
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/**
 * Components available to every MDX page without an import. Adding a docs
 * component here makes it usable as `<Name />` in any `content/**\/*.mdx` file.
 */
export const mdxComponents: MDXComponents = {
  a: MdxLink,
  AuthRole,
  AutoTypeTable,
  BranchDiagram,
  Callout,
  Card,
  Cards,
  CodeBlock,
  Diagram,
  File,
  Files,
  FlowDiagram,
  Folder,
  IdpBoundary,
  LayerStack,
  Link,
  PackageInstall,
  SequenceDiagram,
  SiteApiReference,
  Step,
  Steps,
  TypeTable,
  UseCaseGuide,
};

/**
 * Compile and render an MDX body on the server.
 *
 * Security: MDX compiles to JavaScript that is executed here, so this must
 * only ever receive **repository-authored** content (files under
 * `website/content`). Never pass request data, user input, or fetched text.
 *
 * @param props.source - MDX source (frontmatter already removed).
 * @param props.file - Source path, for error messages.
 * @returns The rendered page body.
 * @throws {Error} When the MDX fails to compile; the message names the file.
 */
export async function MdxContent({ source, file }: { source: string; file: string }) {
  let Content;
  try {
    ({ default: Content } = await evaluate(source, {
      ...runtime,
      remarkPlugins: [remarkGfm, remarkDaloy],
      development: false,
    }));
  } catch (error) {
    throw new Error(`MDX compile failed in ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return <Content components={mdxComponents} />;
}
