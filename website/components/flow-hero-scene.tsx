"use client";

import { useEffect, useRef, type CSSProperties } from "react";

type FlowStyle = CSSProperties & {
  [key: `--${string}`]: string;
};

export function FlowHeroScene() {
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (prefersReducedMotion.matches) return;

    const pointer = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };
    let frame = 0;

    const update = () => {
      eased.x += (pointer.x - eased.x) * 0.08;
      eased.y += (pointer.y - eased.y) * 0.08;

      const rect = scene.getBoundingClientRect();
      const scrollProgress = Math.max(-1, Math.min(1, (window.innerHeight / 2 - rect.top) / window.innerHeight));

      scene.style.setProperty("--flow-x", eased.x.toFixed(3));
      scene.style.setProperty("--flow-y", eased.y.toFixed(3));
      scene.style.setProperty("--flow-rotate", `${(eased.x * 5).toFixed(3)}deg`);
      scene.style.setProperty("--flow-rotate-inverse", `${(eased.x * -5).toFixed(3)}deg`);
      scene.style.setProperty("--flow-scroll", `${(scrollProgress * -18).toFixed(3)}px`);
      scene.style.setProperty("--flow-scroll-grid", `${(scrollProgress * -42).toFixed(3)}px`);
      scene.style.setProperty("--flow-scroll-river", `${(scrollProgress * -34).toFixed(3)}px`);
      scene.style.setProperty("--flow-x-strong", `${(eased.x * 28).toFixed(3)}px`);
      scene.style.setProperty("--flow-y-strong", `${(eased.y * 18).toFixed(3)}px`);
      scene.style.setProperty("--flow-x-medium", `${(eased.x * 18).toFixed(3)}px`);
      scene.style.setProperty("--flow-y-medium", `${(eased.y * 10).toFixed(3)}px`);
      scene.style.setProperty("--flow-x-inverse", `${(eased.x * -24).toFixed(3)}px`);
      scene.style.setProperty("--flow-y-inverse", `${(eased.y * -16).toFixed(3)}px`);
      scene.style.setProperty("--flow-x-river", `${(eased.x * -22).toFixed(3)}px`);
      scene.style.setProperty("--flow-y-river", `${(eased.y * -12).toFixed(3)}px`);
      scene.style.setProperty("--flow-x-back", `${(eased.x * -12).toFixed(3)}px`);
      scene.style.setProperty("--flow-y-back", `${(eased.y * -8).toFixed(3)}px`);

      frame = window.requestAnimationFrame(update);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    frame = window.requestAnimationFrame(update);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={sceneRef}
      aria-hidden
      className="interactive-flow pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        "--flow-x": "0",
        "--flow-y": "0",
        "--flow-scroll": "0px",
        "--flow-scroll-grid": "0px",
        "--flow-scroll-river": "0px",
        "--flow-rotate": "0deg",
        "--flow-rotate-inverse": "0deg",
        "--flow-x-strong": "0px",
        "--flow-y-strong": "0px",
        "--flow-x-medium": "0px",
        "--flow-y-medium": "0px",
        "--flow-x-inverse": "0px",
        "--flow-y-inverse": "0px",
        "--flow-x-river": "0px",
        "--flow-y-river": "0px",
        "--flow-x-back": "0px",
        "--flow-y-back": "0px",
      } as FlowStyle}
    >
      <div className="flow-aurora flow-aurora-a" />
      <div className="flow-aurora flow-aurora-b" />
      <div className="flow-grid" />

      <svg className="flow-river" viewBox="0 0 1440 720" preserveAspectRatio="none" fill="none">
        <defs>
          <linearGradient id="daloy-current" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="28%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="50%" stopColor="currentColor" stopOpacity="0.72" />
            <stop offset="72%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="daloy-current-strong" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="45%" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="flow-river-layer flow-river-layer-back text-primary/35">
          <path className="flow-current flow-current-slow" d="M -120 160 C 140 70, 330 260, 560 150 S 920 40, 1190 150 S 1530 250, 1600 125" stroke="url(#daloy-current)" strokeWidth="1.5" />
          <path className="flow-current flow-current-medium" d="M -120 305 C 160 205, 330 420, 590 300 S 960 165, 1210 300 S 1510 415, 1600 290" stroke="url(#daloy-current)" strokeWidth="1.2" />
          <path className="flow-current flow-current-fast" d="M -120 485 C 175 390, 365 570, 610 470 S 960 340, 1220 465 S 1510 575, 1600 455" stroke="url(#daloy-current)" strokeWidth="1.5" />
        </g>
        <g className="flow-river-layer flow-river-layer-front text-foreground/35">
          <path className="flow-current flow-current-fast" d="M -100 230 C 180 125, 405 310, 660 215 S 1050 110, 1290 225 S 1510 315, 1600 210" stroke="url(#daloy-current-strong)" strokeWidth="1" />
          <path className="flow-current flow-current-medium" d="M -100 390 C 195 295, 420 485, 675 375 S 1050 270, 1290 385 S 1510 485, 1600 370" stroke="url(#daloy-current-strong)" strokeWidth="1" />
        </g>
      </svg>

    </div>
  );
}