// OpenTelemetry 자동 계측 설정 파일
// HTTP 요청을 자동으로 추적하고 OTLP 엔드포인트로 전송

import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

// ---- OTLP Trace Exporter 설정 ----
/**
 * OTLP HTTP 프로토콜을 사용하여 trace 데이터를 외부 수집기로 전송하는 exporter
 * Jaeger, Zipkin, Grafana Tempo 등과 호환되는 표준 프로토콜
 */
const exporter = new OTLPTraceExporter({
  // OTLP 엔드포인트 URL (환경변수 또는 기본값)
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  // 추가 HTTP 헤더 (인증 등)
  headers: {},
  // 동시 전송 제한 (성능 최적화)
  concurrencyLimit: 10,
});

// ---- Node.js Tracer Provider 설정 ----
/**
 * Node.js 환경에서 trace를 생성하고 관리하는 핵심 컴포넌트
 * 서비스 정보, span 처리기, 샘플링 전략을 설정
 */
const provider = new NodeTracerProvider({
  // 서비스 리소스 정보 설정
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.PROJECT_NAME || "gitlab-demo-app",
  }),
  // Span 처리기 설정 (SimpleSpanProcessor: 동기식 처리)
  spanProcessors: [new SimpleSpanProcessor(exporter)],
  // 샘플링 전략: 10%의 요청만 추적 (성능과 관찰성의 균형)
  sampler: new TraceIdRatioBasedSampler(0.1),
});

// ---- OpenTelemetry 초기화 ----
// NodeTracerProvider를 전역적으로 등록하여 API가 사용할 수 있도록 설정
provider.register();

// ---- HTTP 자동 계측 설정 ----
/**
 * HTTP 요청/응답을 자동으로 추적하는 계측기 등록
 * 수동으로 span을 생성하지 않아도 HTTP 요청이 자동으로 추적됨
 */
registerInstrumentations({
  instrumentations: [
    new HttpInstrumentation({
      /**
       * 무시할 HTTP 요청을 결정하는 훅
       * 정적 파일이나 Next.js 내부 요청은 추적하지 않음 (성능 최적화)
       * @param req HTTP 요청 객체
       * @returns true면 추적하지 않음, false면 추적함
       */
      ignoreIncomingRequestHook: (req) => {
        const url = req.url || '';
        return (
          // Next.js 내부 요청 (빌드 파일, 개발 서버 등)
          url.startsWith('/_next/') ||
          // 정적 파일 요청
          url.startsWith('/static/') ||
          // 이미지 파일들
          url.endsWith('.png') ||
          url.endsWith('.jpg') ||
          url.endsWith('.jpeg') ||
          url.endsWith('.ico')
        );
      },
      
      /**
       * HTTP 요청 span을 커스터마이징하는 훅
       * span 이름과 속성을 설정하여 더 유용한 정보 제공
       * @param span 생성된 HTTP span
       * @param request HTTP 요청 객체
       */
      requestHook: (span, request) => {
        const method = request.method || 'UNKNOWN';
        const url = request.url || '';
        
        // span 이름을 "METHOD URL" 형식으로 설정 (가독성 향상)
        span.updateName(`${method} ${url}`);
        
        // HTTP 관련 표준 속성 설정 (OpenTelemetry 시맨틱 컨벤션)
        span.setAttribute('http.method', method);           // HTTP 메서드
        span.setAttribute('http.url', url);                 // 전체 URL
        span.setAttribute('http.route', url.split('?')[0]); // 쿼리 파라미터 제외한 경로
      }
    }),
  ],
});

// ---- 초기화 완료 로그 ----
console.log(`OpenTelemetry initialized with 10% sampling for project: ${process.env.PROJECT_NAME || "gitlab-demo-app"}`);
