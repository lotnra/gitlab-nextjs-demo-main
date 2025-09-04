// logging.ts (단일 파일 통합 예시)
import pino from 'pino';
import { trace } from './tracing';
import type { Span } from '@opentelemetry/api';

// ---- OTLP Logs (선택적) ----
let otelEmit: ((level: string, message: string, attrs?: Record<string, any>) => void) | null = null;

(function initOtelLogs() {
  if (process.env.OTEL_LOGS_ENABLE !== 'true') return;
  try {
    const { LoggerProvider, logs, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
    const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
    const { Resource } = require('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

    const endpoint = process.env.OTEL_LOGS_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
    const exporter = new OTLPLogExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/logs` });

    const provider = new LoggerProvider({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'gitlab-demo-app',
      }),
    });
    provider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter));
    logs.setGlobalLoggerProvider(provider);
    const otelLogger = logs.getLogger('gitlab-demo-app');

    otelEmit = (level, message, attrs) => {
      otelLogger.emit({ body: message, attributes: { level, ...attrs } });
    };
  } catch {
    otelEmit = null;
  }
})();

// ---- Pino ----
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const log = {
  debug: (message: string, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;

    logger.debug({ traceId, spanId, ...extra }, message);
    otelEmit?.('debug', message, { traceId, spanId, ...extra });
  },

  info: (message: string, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;

    logger.info({ traceId, spanId, ...extra }, message);
    otelEmit?.('info', message, { traceId, spanId, ...extra });
  },

  warn: (message: string, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;

    logger.warn({ traceId, spanId, ...extra }, message);
    otelEmit?.('warn', message, { traceId, spanId, ...extra });
  },

  error: (message: string, error?: Error, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;

    logger.error({
      traceId,
      spanId,
      error: error ? { name: error.name, message: error.message, stack: error.stack } : undefined,
      ...extra,
    }, message);

    otelEmit?.('error', message, {
      traceId,
      spanId,
      error_name: error?.name,
      error_message: error?.message,
      ...extra,
    });
  },
};

export function createRequestLogger(requestId: string, userId?: string) {
  return {
    debug: (m: string, e?: Record<string, any>) => log.debug(m, { requestId, userId, ...e }),
    info: (m: string, e?: Record<string, any>) => log.info(m, { requestId, userId, ...e }),
    warn: (m: string, e?: Record<string, any>) => log.warn(m, { requestId, userId, ...e }),
    error: (m: string, err?: Error, e?: Record<string, any>) => log.error(m, err, { requestId, userId, ...e }),
  };
}

export async function withLogging<T>(
  operation: string,
  fn: (logger: ReturnType<typeof createRequestLogger>) => Promise<T>
): Promise<T> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const requestLogger = createRequestLogger(requestId);

  return trace.getTracer('gitlab-demo-app').startActiveSpan(operation, async (span: Span) => {
    try {
      requestLogger.info(`Starting ${operation}`);
      const result = await fn(requestLogger);
      requestLogger.info(`Completed ${operation}`);
      span.setStatus({ code: 1 });
      return result;
    } catch (error) {
      requestLogger.error(`Failed ${operation}`, error as Error);
      span.setStatus({ code: 2, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}

export default logger;