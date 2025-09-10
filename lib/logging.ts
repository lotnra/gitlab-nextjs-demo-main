import pino from 'pino';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getCurrentTraceId } from './tracing';

// ---- 파일 로깅 설정 ----
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

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  destination
);

// ---- Loki 전송 설정 ----
const LOKI_URL = process.env.LOKI_URL || 'http://localhost:3100/loki/api/v1/push';
const LOKI_APP = process.env.LOKI_APP || 'gitlab-nextjs-demo';
const LOKI_ENV = process.env.LOKI_ENV || process.env.NODE_ENV || 'development';
const LOKI_JOB = process.env.LOKI_JOB || LOKI_APP;
const LOKI_USERNAME = process.env.LOKI_USERNAME;
const LOKI_PASSWORD = process.env.LOKI_PASSWORD;

function getAuthHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (LOKI_USERNAME && LOKI_PASSWORD) {
    const token = Buffer.from(`${LOKI_USERNAME}:${LOKI_PASSWORD}`).toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }
  return headers;
}

function nowInNano(): string {
  const ms = Date.now();
  return (BigInt(ms) * 1000000n).toString();
}

// ---- trace_id 추출 ----
function getTraceIdForLogging(extra?: Record<string, any>): string | undefined {
  const currentTraceId = getCurrentTraceId();
  if (currentTraceId) return currentTraceId;

  if (!extra) return undefined;

  // direct field
  if (typeof extra.trace_id === 'string' && extra.trace_id) return extra.trace_id;

  const headers = (extra as any).headers || (extra as any).req?.headers;
  const fromHeaders = (k: string) => headers?.[k] || headers?.[k.toLowerCase()];

  const hTraceId =
    fromHeaders?.('traceid') ||
    fromHeaders?.('x-trace-id') ||
    fromHeaders?.('x-b3-traceid');
  if (typeof hTraceId === 'string' && hTraceId) return hTraceId;

  const traceparent = (extra as any).traceparent || fromHeaders?.('traceparent');
  if (typeof traceparent === 'string') {
    const parts = traceparent.split('-');
    if (parts.length >= 2 && /^[0-9a-f]{16,32}$/i.test(parts[1])) return parts[1];
  }

  const b3 = (extra as any).b3 || fromHeaders?.('b3');
  if (typeof b3 === 'string') {
    const tid = b3.split('-')[0];
    if (tid && /^[0-9a-f]{16,32}$/i.test(tid)) return tid;
  }

  return undefined;
}

// ---- Loki 전송 함수 ----
async function pushToLoki(level: string, message: string, fields: Record<string, any>) {
  try {
    const labels: Record<string, string> = {
      job: LOKI_JOB,
      level,
      app: LOKI_APP,
      env: LOKI_ENV,
    };

    const text =
      fields && Object.keys(fields).length ? ` | ${JSON.stringify(fields)}` : '';
    const line = `${message}${text}`;

    const body = {
      streams: [
        {
          stream: labels,
          values: [[nowInNano(), line]],
        },
      ],
    };

    await axios.post(LOKI_URL, body, {
      headers: getAuthHeaders(),
      timeout: 5000,
    });
  } catch {
    // 전송 실패 무시
  }
}

// ---- 공통 로깅 함수 ----
function logWithTrace(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  fields?: Record<string, any>,
  error?: Error
) {
  const traceId = getTraceIdForLogging(fields);
  const baseFields: Record<string, any> = { trace_id: traceId, ...fields };

  if (error) {
    baseFields.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  logger[level](baseFields, message);
  void pushToLoki(level, message, baseFields);
}

// ---- 로그 객체 ----
export const log = {
  debug: (m: string, e?: Record<string, any>) => logWithTrace('debug', m, e),
  info: (m: string, e?: Record<string, any>) => logWithTrace('info', m, e),
  warn: (m: string, e?: Record<string, any>) => logWithTrace('warn', m, e),
  error: (m: string, err?: Error, e?: Record<string, any>) =>
    logWithTrace('error', m, e, err),
};

// ---- 요청별 로거 ----
export function createRequestLogger(
  requestId: string,
  userId?: string,
  traceId?: string
) {
  const actualTraceId = traceId || getCurrentTraceId();
  return {
    debug: (m: string, e?: Record<string, any>) =>
      log.debug(m, { requestId, userId, trace_id: actualTraceId, ...e }),
    info: (m: string, e?: Record<string, any>) =>
      log.info(m, { requestId, userId, trace_id: actualTraceId, ...e }),
    warn: (m: string, e?: Record<string, any>) =>
      log.warn(m, { requestId, userId, trace_id: actualTraceId, ...e }),
    error: (m: string, err?: Error, e?: Record<string, any>) =>
      log.error(m, err, { requestId, userId, trace_id: actualTraceId, ...e }),
  };
}

// ---- withLogging 유틸 ----
export async function withLogging<T>(
  operation: string,
  fn: (logger: ReturnType<typeof createRequestLogger>) => Promise<T>
): Promise<T> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const traceId = getCurrentTraceId();
  const requestLogger = createRequestLogger(requestId, undefined, traceId);

  try {
    requestLogger.info(`Starting ${operation}`);
    const result = await fn(requestLogger);
    requestLogger.info(`Completed ${operation}`);
    return result;
  } catch (error) {
    requestLogger.error(`Failed ${operation}`, error as Error);
    throw error;
  }
}

export default logger;
