import pino from 'pino';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getCurrentTraceId } from './tracing';

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

// ns 타임스탬프 문자열
function nowInNano(): string {
  const ms = Date.now();
  const ns = BigInt(ms) * 1000000n;
  return ns.toString();
}

// 로그 수집 시점에서 traceID 확인
function getTraceIdForLogging(extra?: Record<string, any>): string | undefined {
  // 1. 먼저 현재 활성 span에서 traceID를 가져옴
  const currentTraceId = getCurrentTraceId();
  if (currentTraceId) {
    return currentTraceId;
  }

  // 2. 없으면 extra에서 찾기
  if (!extra) return undefined;

  // direct fields
  if (typeof extra.traceId === 'string' && extra.traceId) return extra.traceId;
  if (typeof (extra as any).traceID === 'string') return (extra as any).traceID;
  if (typeof (extra as any).trace_id === 'string') return (extra as any).trace_id;

  // headers object 내에서 찾기
  const headers = (extra as any).headers || (extra as any).req?.headers;
  const fromHeaders = (k: string) => headers?.[k] || headers?.[k.toLowerCase()];
  const hTraceId = fromHeaders?.('traceid') || fromHeaders?.('x-trace-id') || fromHeaders?.('x-b3-traceid');
  if (typeof hTraceId === 'string' && hTraceId) return hTraceId;

  // W3C traceparent: version-traceid-spanid-flags
  const traceparent = (extra as any).traceparent || fromHeaders?.('traceparent');
  if (typeof traceparent === 'string') {
    const parts = traceparent.split('-');
    if (parts.length >= 2 && /^[0-9a-f]{16,32}$/i.test(parts[1])) return parts[1];
  }

  // B3 single header: traceid-spanid-sampled-...
  const b3 = (extra as any).b3 || fromHeaders?.('b3');
  if (typeof b3 === 'string') {
    const tid = b3.split('-')[0];
    if (tid && /^[0-9a-f]{16,32}$/i.test(tid)) return tid;
  }

  return undefined;
}

async function pushToLoki(level: string, message: string, extra?: Record<string, any>) {
  try {
    const traceId = getTraceIdForLogging(extra);

    const labels: Record<string, string> = {
      job: LOKI_JOB,
      level,
      app: LOKI_APP,
      env: LOKI_ENV,
    };
    
    // traceID가 있을 때만 labels에 추가
    if (traceId) {
      labels['trace_id'] = traceId;
    }
    
    const fields = { ...(extra || {}) };
    if (traceId && !fields.traceId) {
      fields.traceId = traceId; // 라인 내용에도 포함(검색/가시성 향상용)
    }

    const fieldsText = Object.keys(fields).length ? ` | ${JSON.stringify(fields)}` : '';
    const line = `${message}${fieldsText}`;

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
  } catch (_) {
    // 실패는 앱 흐름에 영향 주지 않음
  }
}

export const log = {
  debug: (message: string, extra?: Record<string, any>) => {
    const traceId = getTraceIdForLogging(extra);
    logger.debug({ traceId, ...extra }, message);
    void pushToLoki('debug', message, { ...extra, traceId });
  },

  info: (message: string, extra?: Record<string, any>) => {
    const traceId = getTraceIdForLogging(extra);
    logger.info({ traceId, ...extra }, message);
    void pushToLoki('info', message, { ...extra, traceId });
  },

  warn: (message: string, extra?: Record<string, any>) => {
    const traceId = getTraceIdForLogging(extra);
    logger.warn({ traceId, ...extra }, message);
    void pushToLoki('warn', message, { ...extra, traceId });
  },

  error: (message: string, error?: Error, extra?: Record<string, any>) => {
    const traceId = getTraceIdForLogging(extra);
    const errObj = error
      ? { name: error.name, message: error.message, stack: error.stack }
      : undefined;

    logger.error({ traceId, error: errObj, ...extra }, message);
    void pushToLoki('error', message, { error: errObj, ...extra, traceId });
  },
};

export function createRequestLogger(requestId: string, userId?: string, traceId?: string) {
  // traceId가 제공되지 않으면 현재 활성 span에서 추출
  const actualTraceId = traceId || getCurrentTraceId();
  
  return {
    debug: (m: string, e?: Record<string, any>) => log.debug(m, { requestId, userId, traceId: actualTraceId, ...e }),
    info:  (m: string, e?: Record<string, any>) => log.info(m,  { requestId, userId, traceId: actualTraceId, ...e }),
    warn:  (m: string, e?: Record<string, any>) => log.warn(m,  { requestId, userId, traceId: actualTraceId, ...e }),
    error: (m: string, err?: Error, e?: Record<string, any>) => log.error(m, err, { requestId, userId, traceId: actualTraceId, ...e }),
  };
}

export async function withLogging<T>(
  operation: string,
  fn: (logger: ReturnType<typeof createRequestLogger>) => Promise<T>
): Promise<T> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const traceId = getCurrentTraceId(); // 현재 traceID 추출
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
