import { performance } from "node:perf_hooks";
import pino from "pino";

const DEFAULT_LOG_DEST = process.platform === "win32" ? "NUL" : "/dev/null";
const LOG_DEST = process.env.LOG_DEST ?? DEFAULT_LOG_DEST;

const logger = pino(
  {
    level: "info",
    base: null,
  },
  pino.destination({ dest: LOG_DEST, sync: false })
);

export function accessLogStart(): number {
  return performance.now();
}

export function writeAccessLog(
  framework: string,
  method: string,
  path: string,
  statusCode: number,
  startedAt: number
): void {
  logger.info(
    {
      framework,
      method,
      path,
      statusCode,
      durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
    },
    "request completed"
  );
}
