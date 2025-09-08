// logging.ts (단일 파일 통합 예시)
import pino from 'pino';
import axios from 'axios';
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

// ---- Loki 전송 설정 ----
const LOKI_URL = process.env.LOKI_URL || 'http://localhost:3100/loki/api/v1/push';
const LOKI_APP = process.env.LOKI_APP || 'gitlab-nextjs-demo';
const LOKI_ENV = process.env.LOKI_ENV || process.env.NODE_ENV || 'development';
const LOKI_USERNAME = process.env.LOKI_USERNAME;
const LOKI_PASSWORD = process.env.LOKI_PASSWORD;
const LOKI_BEARER_TOKEN = process.env.LOKI_BEARER_TOKEN;

function getAuthHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (LOKI_BEARER_TOKEN) {
    headers['Authorization'] = `Bearer ${LOKI_BEARER_TOKEN}`;
  } else if (LOKI_USERNAME && LOKI_PASSWORD) {
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

// tracer 또는 extra에서 traceId 추출
function extractTraceId(extra?: Record<string, any>): string | undefined {
  if (!extra) return undefined;
  if (typeof extra.traceId === 'string') return extra.traceId;
  const tracer = (extra as any).tracer;
  try {
    const span = tracer?.getActiveSpan?.();
    const tid = span?.spanContext?.().traceId;
    if (typeof tid === 'string' && tid.length > 0) return tid;
  } catch (_) {}
  return undefined;
}

async function pushToLoki(level: string, message: string, extra?: Record<string, any>) {
  try {
    const traceId = extractTraceId(extra);
    const labels: Record<string, string> = {
      app: LOKI_APP,
      env: LOKI_ENV,
      level,
    };
    if (traceId) {
      labels['trace_id'] = traceId;
    }

    // line: 메시지와 필드를 합쳐 단일 문자열(JSON)로 전송
    const payloadLine = JSON.stringify({
      msg: message,
      ...extra,
      level,
      traceId,
      time: new Date().toISOString(),
    });

    const body = {
      streams: [
        {
          stream: labels,
          values: [[nowInNano(), payloadLine]],
        },
      ],
    };

    await axios.post(LOKI_URL, body, {
      headers: getAuthHeaders(),
      timeout: 2000,
      validateStatus: () => true,
    });
  } catch (_) {
    // Loki 전송 실패는 애플리케이션 흐름을 막지 않음
  }
}

export const log = {
  debug: (message: string, extra?: Record<string, any>) => {
    const traceId = extractTraceId(extra);
    logger.debug({ traceId, ...extra }, message);
    void pushToLoki('debug', message, { ...extra, traceId });
  },

  info: (message: string, extra?: Record<string, any>) => {
    const traceId = extractTraceId(extra);
    logger.info({ traceId, ...extra }, message);
    void pushToLoki('info', message, { ...extra, traceId });
  },

  warn: (message: string, extra?: Record<string, any>) => {
    const traceId = extractTraceId(extra);
    logger.warn({ traceId, ...extra }, message);
    void pushToLoki('warn', message, { ...extra, traceId });
  },

  error: (message: string, error?: Error, extra?: Record<string, any>) => {
    const traceId = extractTraceId(extra);
    const errObj = error
      ? { name: error.name, message: error.message, stack: error.stack }
      : undefined;

    logger.error({ traceId, error: errObj, ...extra }, message);
    void pushToLoki('error', message, { error: errObj, ...extra, traceId });
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

// 트레이싱 제거: withLogging은 단순 로깅 래퍼로 동작
export async function withLogging<T>(
  operation: string,
  fn: (logger: ReturnType<typeof createRequestLogger>) => Promise<T>
): Promise<T> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const requestLogger = createRequestLogger(requestId);

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