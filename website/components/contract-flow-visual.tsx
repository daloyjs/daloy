"use client";

import { useEffect, useRef, type CSSProperties } from "react";

const FLOW_STEPS = [
  { label: "route", detail: "GET /books/:id" },
  { label: "schema", detail: "z.object(...)" },
  { label: "OpenAPI", detail: "3.1 spec" },
  { label: "client", detail: "typed fetch" },
];

type FlowVisualStyle = CSSProperties & {
  [key: `--${string}`]: string;
};

export function ContractFlowVisual() {
  const visualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const visual = visualRef.current;
    if (!visual) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (prefersReducedMotion.matches) return;

    const onPointerMove = (event: PointerEvent) => {
      const rect = visual.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      const clampedX = Math.max(-0.5, Math.min(0.5, x));
      const clampedY = Math.max(-0.5, Math.min(0.5, y));

      visual.style.setProperty("--visual-tilt-x", `${(-clampedY * 6).toFixed(2)}deg`);
      visual.style.setProperty("--visual-tilt-y", `${(clampedX * 8).toFixed(2)}deg`);
      visual.style.setProperty("--visual-glow-x", `${(event.clientX - rect.left).toFixed(1)}px`);
      visual.style.setProperty("--visual-glow-y", `${(event.clientY - rect.top).toFixed(1)}px`);
    };

    const onPointerLeave = () => {
      visual.style.setProperty("--visual-tilt-x", "0deg");
      visual.style.setProperty("--visual-tilt-y", "0deg");
      visual.style.setProperty("--visual-glow-x", "50%");
      visual.style.setProperty("--visual-glow-y", "50%");
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return (
    <div
      ref={visualRef}
      className="contract-flow-visual float-up w-full max-w-5xl"
      style={
        {
          "--visual-tilt-x": "0deg",
          "--visual-tilt-y": "0deg",
          "--visual-glow-x": "50%",
          "--visual-glow-y": "50%",
          animationDelay: "430ms",
        } as FlowVisualStyle
      }
    >
      <div className="contract-flow-visual__shell">
        <div className="contract-flow-visual__glow" />
        <div className="contract-flow-visual__topline">
          <span>contract flow</span>
          <span>Request -&gt; Response</span>
        </div>

        <div className="contract-flow-visual__stage">
          <svg className="contract-flow-visual__paths" viewBox="0 0 900 220" preserveAspectRatio="none" fill="none">
            <defs>
              <linearGradient id="contract-flow-main" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
                <stop offset="45%" stopColor="currentColor" stopOpacity="0.9" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.12" />
              </linearGradient>
            </defs>
            <path
              className="contract-flow-visual__path contract-flow-visual__path-a"
              d="M 36 112 C 170 30, 260 190, 392 112 S 620 35, 864 112"
              stroke="url(#contract-flow-main)"
            />
            <path
              className="contract-flow-visual__path contract-flow-visual__path-b"
              d="M 36 112 C 170 194, 260 34, 392 112 S 620 190, 864 112"
              stroke="url(#contract-flow-main)"
            />
          </svg>

          <div className="contract-flow-visual__spark contract-flow-visual__spark-a" />
          <div className="contract-flow-visual__spark contract-flow-visual__spark-b" />
          <div className="contract-flow-visual__spark contract-flow-visual__spark-c" />

          <div className="contract-flow-visual__nodes">
            {FLOW_STEPS.map((step, index) => (
              <div className="contract-flow-visual__node" key={step.label} style={{ animationDelay: `${index * 180}ms` }}>
                <span className="contract-flow-visual__node-index">0{index + 1}</span>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}