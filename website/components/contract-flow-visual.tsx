const FLOW_STEPS = [
  { label: "route", detail: "GET /books/:id" },
  { label: "schema", detail: "z.object(...)" },
  { label: "OpenAPI", detail: "3.1 spec" },
  { label: "client", detail: "typed fetch" },
];

const PATH_A = "M 36 112 C 170 30, 260 190, 392 112 S 620 35, 864 112";
const PATH_B = "M 36 112 C 170 194, 260 34, 392 112 S 620 190, 864 112";

/**
 * Spark dots ride the flow lines via SMIL `animateMotion` inside the same
 * stretched SVG user space as the paths themselves — CSS `offset-path` on
 * HTML siblings cannot follow a `preserveAspectRatio="none"` SVG, so the
 * dots would drift off the lines at most viewport sizes. SMIL ignores
 * `prefers-reduced-motion`, so reduced-motion hides the sparks in CSS.
 */
function Spark({
  path,
  dur,
  begin,
  reverse = false,
  r = 4.5,
}: {
  path: string;
  dur: string;
  begin: string;
  reverse?: boolean;
  r?: number;
}) {
  return (
    <g className="contract-flow-visual__spark">
      <animateMotion
        dur={dur}
        begin={begin}
        repeatCount="indefinite"
        path={path}
        keyPoints={reverse ? "1;0" : "0;1"}
        keyTimes="0;1"
        calcMode="linear"
      />
      <circle r={r * 2} fill="currentColor" opacity="0.16" />
      <circle r={r} fill="currentColor" opacity="0.95" />
    </g>
  );
}

export function ContractFlowVisual() {
  return (
    <div
      className="contract-flow-visual float-up mx-auto w-full max-w-5xl"
      style={{ animationDelay: "430ms" }}
    >
      <div className="contract-flow-visual__shell">
        <div className="contract-flow-visual__glow" />
        <div className="contract-flow-visual__topline">
          <span>contract flow</span>
          <span>Request -&gt; Response</span>
        </div>

        <div className="contract-flow-visual__stage">
          <svg
            aria-hidden
            className="contract-flow-visual__paths"
            viewBox="0 0 900 220"
            preserveAspectRatio="none"
            fill="none"
          >
            <defs>
              <linearGradient
                id="contract-flow-main"
                x1="0"
                x2="1"
                y1="0"
                y2="0"
              >
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
                <stop offset="45%" stopColor="currentColor" stopOpacity="0.9" />
                <stop
                  offset="100%"
                  stopColor="currentColor"
                  stopOpacity="0.12"
                />
              </linearGradient>
            </defs>
            <path
              className="contract-flow-visual__path contract-flow-visual__path-a"
              d={PATH_A}
              stroke="url(#contract-flow-main)"
            />
            <path
              className="contract-flow-visual__path contract-flow-visual__path-b"
              d={PATH_B}
              stroke="url(#contract-flow-main)"
            />
            <Spark path={PATH_A} dur="5.8s" begin="0s" />
            <Spark path={PATH_B} dur="7.2s" begin="-2.4s" reverse />
            <Spark path={PATH_A} dur="8.4s" begin="-4.8s" r={3.5} />
          </svg>

          <div className="contract-flow-visual__nodes">
            {FLOW_STEPS.map((step, index) => (
              <div
                className="contract-flow-visual__node"
                key={step.label}
                style={{ animationDelay: `${index * 180}ms` }}
              >
                <span className="contract-flow-visual__node-index">
                  0{index + 1}
                </span>
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
