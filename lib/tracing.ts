import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('gitlab-demo-app');

export { trace };

export function createSpan(name: string, fn: (span: any) => Promise<any>) {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: 1 });
      return result;
    } catch (error) {
      span.setStatus({ code: 2, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function getCurrentTraceId(): string | undefined {
  try {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      const spanContext = activeSpan.spanContext();
      return spanContext.traceId;
    }
  } catch (error) {
    return undefined;
  }
  return undefined;
}
