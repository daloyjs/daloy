export function FlowHeroScene() {
  return (
    <div
      aria-hidden
      className="interactive-flow pointer-events-none absolute inset-0 overflow-hidden"
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