import pino from 'pino';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getCurrentTraceId } from './tracing';

// ---- Pino 설정 ----
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
    formatters: { level: (label: string) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  destination
);

// ---- Loki 설정 ----
const LOKI_URL = process.env.LOKI_URL || 'http://localhost:3100/loki/api/v1/push';
const LOKI_APP = process.env.LOKI_APP || 'my-app';
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
  const ns = BigInt(ms) * 1000000n;
  return ns.toString();
}

async function pushToLoki(level: string, message: string, fields?: Record<string, any>) {
  try {
    const labels: Record<string, string> = {
      job: LOKI_JOB,
      level,
      app: LOKI_APP,
      env: LOKI_ENV,
    };

    const text = fields && Object.keys(fields).length ? ` | ${JSON.stringify(fields)}` : '';
    const line = `${message}${text}`;
    const body = { streams: [{ stream: labels, values: [[nowInNano(), line]] }] };

    await axios.post(LOKI_URL, body, { headers: getAuthHeaders(), timeout: 5000 });
  } catch (_) {}
}

// ---- 리팩토링된 로그 ----
export const log = {
  debug: (message: string, extra?: Record<string, any>, traceId?: string) => {
    const fields = { ...extra };
    if (traceId) fields.trace_id = traceId;
    logger.debug(fields, message);
    void pushToLoki('debug', message, fields);
  },
  info: (message: string, extra?: Record<string, any>, traceId?: string) => {
    const fields = { ...extra };
    if (traceId) fields.trace_id = traceId;
    logger.info(fields, message);
    void pushToLoki('info', message, fields);
  },
  warn: (message: string, extra?: Record<string, any>, traceId?: string) => {
    const fields = { ...extra };
    if (traceId) fields.trace_id = traceId;
    logger.warn(fields, message);
    void pushToLoki('warn', message, fields);
  },
  error: (message: string, error?: Error, extra?: Record<string, any>, traceId?: string) => {
    const fields: Record<string, any> = { ...extra };
    if (traceId) fields.trace_id = traceId;
    if (error) fields.error = { name: error.name, message: error.message, stack: error.stack };
    logger.error(fields, message);
    void pushToLoki('error', message, fields);
  },
};

// ---- 수동 계측용 Logger 생성 ----
export function createManualLogger(traceId?: string) {
  return {
    debug: (m: string, e?: Record<string, any>) => log.debug(m, e, traceId),
    info: (m: string, e?: Record<string, any>) => log.info(m, e, traceId),
    warn: (m: string, e?: Record<string, any>) => log.warn(m, e, traceId),
    error: (m: string, err?: Error, e?: Record<string, any>) => log.error(m, err, e, traceId),
  };
}

// ---- withLogging 헬퍼 (수동 계측 전용) ----
export async function withLogging<T>(
  operation: string,
  fn: (logger: ReturnType<typeof createManualLogger>) => Promise<T>
): Promise<T> {
  // 수동 계측에서 traceId 추출
  const traceId = getCurrentTraceId(); 
  const logger = createManualLogger(traceId);

  try {
    logger.info(`Starting ${operation}`);
    const result = await fn(logger);
    logger.info(`Completed ${operation}`);
    return result;
  } catch (error) {
    logger.error(`Failed ${operation}`, error as Error);
    throw error;
  }
}

export default logger;
