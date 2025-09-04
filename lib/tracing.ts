import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('gitlab-demo-app');

export { trace }; // trace를 export 추가

export function createSpan(name: string, fn: (span: any) => Promise<any>) {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      span.setStatus({ code: 2, message: error.message }); // ERROR
      throw error;
    } finally {
      span.end();
    }
  });
}