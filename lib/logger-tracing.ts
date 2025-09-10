// logger-tracing.ts
import pino from 'pino';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { trace, Span } from '@opentelemetry/api';

// ----------------- Tracing -----------------
export const tracer = trace.getTracer('gitlab-demo-app');

/**
 * 수동 계측용 span 생성 및 실행 헬퍼
 */
export async function createSpan<T>(
  name: string,
  fn: (span: Span, traceId: string) => Promise<T>
): Promise<T> {
  // 무조건 새로운 span 생성
  return tracer.startActiveSpan(name, async (span) => {
    const traceId = span.spanContext().traceId;
    try {
      const result = await fn(span, traceId);
      span.setStatus({ code: 1 }); // 성공
      return result;
    } catch (error: any) {
      span.setStatus({ code: 2, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * 현재 span에서 traceID 추출
 */
export function getCurrentTraceId(span?: Span): string | undefined {
  return span ? span.spanContext().traceId : undefined;
}

// ----------------- Logger -----------------
function ensureDirectoryExists(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
ensureDirectoryExists(logDir);
const logFilePath = path.join(logDir, process.env.LOG_FILE || 'app.log');

const destination = pino.destination({ dest: logFilePath, sync: false });
const logger = pino({ level: process.env.LOG_LEVEL || 'info', timestamp: pino.stdTimeFunctions.isoTime }, destination);

// Loki 설정
const LOKI_URL = process.env.LOKI_URL || 'http://localhost:3100/loki/api/v1/push';
const LOKI_APP = process.env.LOKI_APP || 'my-app';
const LOKI_ENV = process.env.LOKI_ENV || process.env.NODE_ENV || 'development';
const LOKI_JOB = process.env.LOKI_JOB || LOKI_APP;
const LOKI_USERNAME = process.env.LOKI_USERNAME;
const LOKI_PASSWORD = process.env.LOKI_PASSWORD;

function getAuthHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (LOKI_USERNAME && LOKI_PASSWORD) {
    headers['Authorization'] = `Basic ${Buffer.from(`${LOKI_USERNAME}:${LOKI_PASSWORD}`).toString('base64')}`;
  }
  return headers;
}

function nowInNano(): string {
  return (BigInt(Date.now()) * 1000000n).toString();
}

async function pushToLoki(level: string, message: string, fields?: Record<string, any>) {
  try {
    const labels = { job: LOKI_JOB, level, app: LOKI_APP, env: LOKI_ENV };
    const line = fields && Object.keys(fields).length ? `${message} | ${JSON.stringify(fields)}` : message;
    const body = { streams: [{ stream: labels, values: [[nowInNano(), line]] }] };
    await axios.post(LOKI_URL, body, { headers: getAuthHeaders(), timeout: 5000 });
  } catch {}
}

// ----------------- 수동 계측 전용 Logger -----------------
function logMessage(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, any>,
  traceId?: string,
  error?: Error
) {
  const fields: Record<string, any> = { ...extra };
  if (traceId) fields.trace_id = traceId; // traceID는 수동계측에서만
  if (error) fields.error = { name: error.name, message: error.message, stack: error.stack };

  logger[level](fields, message);
  void pushToLoki(level, message, fields);
}

export function createManualLogger(traceId?: string) {
  return {
    debug: (msg: string, extra?: Record<string, any>) => logMessage('debug', msg, extra, traceId),
    info: (msg: string, extra?: Record<string, any>) => logMessage('info', msg, extra, traceId),
    warn: (msg: string, extra?: Record<string, any>) => logMessage('warn', msg, extra, traceId),
    error: (msg: string, err?: Error, extra?: Record<string, any>) => logMessage('error', msg, extra, traceId, err),
  };
}

// ----------------- withLogging 헬퍼 -----------------
export async function withLogging<T>(
  operation: string,
  fn: (logger: ReturnType<typeof createManualLogger>) => Promise<T>
): Promise<T> {
  const activeSpan = trace.getActiveSpan();
  const traceId = activeSpan ? activeSpan.spanContext().traceId : undefined; // 수동계측 traceID만
  const logger = createManualLogger(traceId);

  try {
    logger.info(`Starting ${operation}`);
    const result = await fn(logger);
    logger.info(`Completed ${operation}`);
    return result;
  } catch (error: any) {
    logger.error(`Failed ${operation}`, error);
    throw error;
  }
}

export default logger;
