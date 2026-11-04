export type PerformancePlatform = "android" | "ios" | "web" | string;
export type PerformanceTrigger = "login" | "session_restore" | "refresh";
export type PerformanceStage =
  | "authentication"
  | "context"
  | "operations"
  | "contractors"
  | "data_total"
  | "render"
  | "total";

type PendingMetric = {
  stage: PerformanceStage;
  durationMs: number;
  details?: Record<string, unknown>;
};

export type PerformanceTrace = {
  id: string;
  trigger: PerformanceTrigger;
  platform: PerformancePlatform;
  role: string | null;
  startedAt: number;
  pending: PendingMetric[];
};

export type PerformanceMetric = PendingMetric & {
  traceId: string;
  trigger: PerformanceTrigger;
  platform: PerformancePlatform;
  role: string;
  recordedAt: string;
};

declare global {
  // Available from browser DevTools and React Native debugging consoles.
  // eslint-disable-next-line no-var
  var __SUPPORT_PERFORMANCE_METRICS__: PerformanceMetric[] | undefined;
}

let traceSequence = 0;

export function performanceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function createPerformanceTrace(
  trigger: PerformanceTrigger,
  platform: PerformancePlatform,
): PerformanceTrace {
  traceSequence += 1;
  return {
    id: `${Date.now()}-${traceSequence}`,
    trigger,
    platform,
    role: null,
    startedAt: performanceNow(),
    pending: [],
  };
}

function emit(trace: PerformanceTrace, metric: PendingMetric) {
  if (!trace.role) return;
  const entry: PerformanceMetric = {
    traceId: trace.id,
    trigger: trace.trigger,
    platform: trace.platform,
    role: trace.role,
    stage: metric.stage,
    durationMs: Number(metric.durationMs.toFixed(2)),
    details: metric.details,
    recordedAt: new Date().toISOString(),
  };
  const metrics = globalThis.__SUPPORT_PERFORMANCE_METRICS__ ?? [];
  metrics.push(entry);
  if (metrics.length > 200) metrics.splice(0, metrics.length - 200);
  globalThis.__SUPPORT_PERFORMANCE_METRICS__ = metrics;
  console.info("[SUPPORT_PERF]", JSON.stringify(entry));
}

export function setPerformanceTraceRole(trace: PerformanceTrace, role: string) {
  trace.role = role;
  const pending = trace.pending.splice(0);
  pending.forEach((metric) => emit(trace, metric));
}

export function finishPerformanceStage(
  trace: PerformanceTrace,
  stage: PerformanceStage,
  startedAt: number,
  details?: Record<string, unknown>,
) {
  const metric = {
    stage,
    durationMs: Math.max(0, performanceNow() - startedAt),
    details,
  };
  if (trace.role) emit(trace, metric);
  else trace.pending.push(metric);
}

export async function measurePerformanceStage<T>(
  trace: PerformanceTrace,
  stage: PerformanceStage,
  task: () => Promise<T>,
  details?: Record<string, unknown>,
): Promise<T> {
  const startedAt = performanceNow();
  try {
    return await task();
  } finally {
    finishPerformanceStage(trace, stage, startedAt, details);
  }
}

export function finishPerformanceTrace(trace: PerformanceTrace) {
  finishPerformanceStage(trace, "total", trace.startedAt);
}
