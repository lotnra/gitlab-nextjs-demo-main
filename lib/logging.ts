import pino from 'pino';
import { trace } from './tracing'; // tracing.ts에서 import

// Pino 로거 인스턴스 생성
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // 개발 환경에서는 pretty print 사용
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
});

// 트레이스 컨텍스트와 연동된 로깅 함수들
export const log = {
  debug: (message: string, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;
    
    logger.debug({
      traceId,
      spanId,
      ...extra,
    }, message);
  },

  info: (message: string, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;
    
    logger.info({
      traceId,
      spanId,
      ...extra,
    }, message);
  },

  warn: (message: string, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;
    
    logger.warn({
      traceId,
      spanId,
      ...extra,
    }, message);
  },

  error: (message: string, error?: Error, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;
    
    logger.error({
      traceId,
      spanId,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
      ...extra,
    }, message);
  },
};

// 요청별 컨텍스트 로깅을 위한 헬퍼 함수
export function createRequestLogger(requestId: string, userId?: string) {
  return {
    debug: (message: string, extra?: Record<string, any>) => {
      log.debug(message, { requestId, userId, ...extra });
    },
    info: (message: string, extra?: Record<string, any>) => {
      log.info(message, { requestId, userId, ...extra });
    },
    warn: (message: string, extra?: Record<string, any>) => {
      log.warn(message, { requestId, userId, ...extra });
    },
    error: (message: string, error?: Error, extra?: Record<string, any>) => {
      log.error(message, error, { requestId, userId, ...extra });
    },
  };
}

// 비동기 작업을 위한 로깅 헬퍼 (tracing.ts와 유사한 패턴)
export function withLogging<T>(
  operation: string,
  fn: (logger: ReturnType<typeof createRequestLogger>) => Promise<T>
): Promise<T> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const requestLogger = createRequestLogger(requestId);
  
  return trace.getTracer('gitlab-demo-app').startActiveSpan(operation, async (span) => {
    try {
      requestLogger.info(`Starting ${operation}`);
      const result = await fn(requestLogger);
      requestLogger.info(`Completed ${operation}`);
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      requestLogger.error(`Failed ${operation}`, error as Error);
      span.setStatus({ code: 2, message: (error as Error).message }); // ERROR
      throw error;
    } finally {
      span.end();
    }
  });
}

export default logger;