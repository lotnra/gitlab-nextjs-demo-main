// logging.ts (단일 파일 통합 예시)
import pino from 'pino';
import { trace } from './tracing';
import fs from 'fs';
import path from 'path';

// ---- Pino: 파일 로깅 설정 ----
function ensureDirectoryExists(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

const logDirectory = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const logFileName = process.env.LOG_FILE || 'app.log';
const logFilePath = path.join(logDirectory, logFileName);

ensureDirectoryExists(logDirectory);

const destination = pino.destination({ dest: logFilePath, sync: false });

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
}, destination);

export const log = {
  debug: (message: string, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;

    logger.debug({ traceId, spanId, ...extra }, message);
  },

  info: (message: string, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;

    logger.info({ traceId, spanId, ...extra }, message);
  },

  warn: (message: string, extra?: Record<string, any>) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const spanId = span?.spanContext().spanId;

    logger.warn({ traceId, spanId, ...extra }, message);
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

  return trace.getTracer('gitlab-demo-app').startActiveSpan(operation, async (span) => {
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