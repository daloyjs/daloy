"use client";

import dynamic from "next/dynamic";

const FlowHeroScene = dynamic(
  () => import("./flow-hero-scene").then((module) => module.FlowHeroScene),
  { ssr: false }
);

const ContractFlowVisual = dynamic(
  () => import("./contract-flow-visual").then((module) => module.ContractFlowVisual),
  {
    ssr: false,
    loading: () => <div className="w-full max-w-5xl min-h-[18rem] rounded-lg border border-border/70 bg-muted/30" aria-hidden />,
  }
);

export function HomepageHeroBackground() {
  return <FlowHeroScene />;
}

export function HomepageContractFlowVisual() {
  return <ContractFlowVisual />;
}