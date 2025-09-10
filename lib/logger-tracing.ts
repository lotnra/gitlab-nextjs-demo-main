import pino from 'pino';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { trace, Span } from '@opentelemetry/api';

export const tracer = trace.getTracer('my-app');

// createSpan: 수동 계측용 span 생성
export async function createSpan<T>(name: string, fn: (span: Span, traceId: string) => Promise<T>): Promise<T> {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) return fn(activeSpan, activeSpan.spanContext().traceId);

  return tracer.startActiveSpan(name, async (span) => {
    const traceId = span.spanContext().traceId;
    try {
      const result = await fn(span, traceId);
      span.setStatus({ code: 1 });
      return result;
    } catch (error: any) {
      span.setStatus({ code: 2, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

// 로그 파일 설정
const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, process.env.LOG_FILE || 'app.log');
const destination = pino.destination({ dest: logFile, sync: false });
const logger = pino({ level: process.env.LOG_LEVEL || 'info', timestamp: pino.stdTimeFunctions.isoTime }, destination);

// Loki config
const LOKI_URL = process.env.LOKI_URL || 'http://localhost:3100/loki/api/v1/push';
const LOKI_APP = process.env.LOKI_APP || 'my-app';
const LOKI_ENV = process.env.LOKI_ENV || process.env.NODE_ENV || 'development';
const LOKI_JOB = process.env.LOKI_JOB || LOKI_APP;
const LOKI_USERNAME = process.env.LOKI_USERNAME;
const LOKI_PASSWORD = process.env.LOKI_PASSWORD;

function getAuthHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (LOKI_USERNAME && LOKI_PASSWORD) headers['Authorization'] = `Basic ${Buffer.from(`${LOKI_USERNAME}:${LOKI_PASSWORD}`).toString('base64')}`;
  return headers;
}

function nowInNano() { return (BigInt(Date.now()) * 1000000n).toString(); }

async function pushToLoki(level: string, message: string, fields?: Record<string, any>) {
  try {
    const labels = { job: LOKI_JOB, level, app: LOKI_APP, env: LOKI_ENV };
    const line = fields && Object.keys(fields).length ? `${message} | ${JSON.stringify(fields)}` : message;
    await axios.post(LOKI_URL, { streams: [{ stream: labels, values: [[nowInNano(), line]] }] }, { headers: getAuthHeaders(), timeout: 5000 });
  } catch {}
}

// 수동 계측 전용 logger
function logMessage(level: 'debug' | 'info' | 'warn' | 'error', message: string, fields?: Record<string, any>, traceId?: string, error?: Error) {
  const data: Record<string, any> = { ...fields };
  if (traceId) data.trace_id = traceId;
  if (error) data.error = { name: error.name, message: error.message, stack: error.stack };
  logger[level](data, message);
  void pushToLoki(level, message, data);
}

export function createManualLogger(traceId?: string) {
  return {
    debug: (msg: string, fields?: Record<string, any>) => logMessage('debug', msg, fields, traceId),
    info: (msg: string, fields?: Record<string, any>) => logMessage('info', msg, fields, traceId),
    warn: (msg: string, fields?: Record<string, any>) => logMessage('warn', msg, fields, traceId),
    error: (msg: string, err?: Error, fields?: Record<string, any>) => logMessage('error', msg, fields, traceId, err),
  };
}

// withLogging 헬퍼: 자동 span + 수동 계측 traceID 로그
export async function withLogging<T>(operation: string, fn: (logger: ReturnType<typeof createManualLogger>) => Promise<T>): Promise<T> {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
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
