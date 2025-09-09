import { trace } from '@opentelemetry/api';

// 애플리케이션용 Tracer 인스턴스 생성
const tracer = trace.getTracer('gitlab-demo-app');

// OpenTelemetry trace API를 외부로 export
export { trace };

/**
 * 새로운 span을 생성하고 비동기 함수를 실행하는 헬퍼 함수
 * span의 생명주기를 자동으로 관리하고 성공/실패 상태를 설정
 * 
 * @param name span 이름
 * @param fn span 내에서 실행할 비동기 함수 (span 객체를 매개변수로 받음)
 * @returns Promise<any> - 함수 실행 결과
 * 
 * @example
 * ```typescript
 * const result = await createSpan('database.query', async (span) => {
 *   span.setAttribute('query.type', 'SELECT');
 *   return await db.query('SELECT * FROM users');
 * });
 * ```
 */
export function createSpan(name: string, fn: (span: any) => Promise<any>) {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      // 비즈니스 로직 실행
      const result = await fn(span);
      // 성공 상태 설정 (code: 1 = OK)
      span.setStatus({ code: 1 });
      return result;
    } catch (error) {
      // 에러 상태 설정 (code: 2 = ERROR)
      span.setStatus({ code: 2, message: error.message });
      throw error;
    } finally {
      // span 종료 (반드시 실행)
      span.end();
    }
  });
}

/**
 * 현재 활성화된 span에서 trace ID를 추출하는 함수
 * 로깅이나 다른 목적으로 trace ID가 필요할 때 사용
 * 
 * @returns string | undefined - 현재 trace ID 또는 undefined
 * 
 * @example
 * ```typescript
 * const traceId = getCurrentTraceId();
 * if (traceId) {
 *   console.log(`Current trace ID: ${traceId}`);
 * }
 * ```
 */
export function getCurrentTraceId(): string | undefined {
  try {
    // 현재 활성화된 span 가져오기
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      // span context에서 trace ID 추출
      const spanContext = activeSpan.spanContext();
      return spanContext.traceId;
    }
  } catch (error) {
    // 에러 발생 시 undefined 반환 (앱 흐름에 영향 주지 않음)
    return undefined;
  }
  return undefined;
}
