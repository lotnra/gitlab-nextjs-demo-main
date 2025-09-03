import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

const exporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  headers: {},
  concurrencyLimit: 10,
});

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.PROJECT_NAME || "gitlab-demo-app",
  }),
  spanProcessors: [new SimpleSpanProcessor(exporter)],
  // 10% 샘플링 설정
  sampler: new TraceIdRatioBasedSampler(0.1),
});

// Initialize the OpenTelemetry APIs to use the NodeTracerProvider bindings
provider.register();

registerInstrumentations({
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) => {
        const url = req.url || '';
        return (
          url.startsWith('/_next/') ||
          url.startsWith('/static/') ||
          url.endsWith('.png') ||
          url.endsWith('.jpg') ||
          url.endsWith('.jpeg') ||
          url.endsWith('.ico')
        );
      },
      // 요청 경로와 메서드를 스팬에 추가
      requestHook: (span, request) => {
        const method = request.method || 'UNKNOWN';
        const url = request.url || '';
        
        // 스팬 이름 업데이트 (METHOD + URL 형식으로)
        span.updateName(`${method} ${url}`);
        
        // 추가 속성으로 요청 정보 저장
        span.setAttribute('http.method', method);
        span.setAttribute('http.url', url);
        span.setAttribute('http.route', url.split('?')[0]);
      }
    }),
  ],
});

console.log(`OpenTelemetry initialized with 10% sampling for project: ${process.env.PROJECT_NAME || "gitlab-demo-app"}`);

