import pino from 'pino';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getCurrentTraceId } from './tracing';

// ---- Pino: 파일 로깅 설정 ----

/**
 * 로그 디렉토리가 존재하지 않으면 생성하는 유틸리티 함수
 * @param dirPath 생성할 디렉토리 경로
 */
function ensureDirectoryExists(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 로그 파일 설정
const logDirectory = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const logFileName = process.env.LOG_FILE || 'app.log';
const logFilePath = path.join(logDirectory, logFileName);

ensureDirectoryExists(logDirectory);

// Pino 로거 설정 (파일 출력용)
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

/**
 * Loki 인증 헤더를 생성하는 함수
 * @returns 인증 헤더 객체
 */
function getAuthHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (LOKI_USERNAME && LOKI_PASSWORD) {
    const token = Buffer.from(`${LOKI_USERNAME}:${LOKI_PASSWORD}`).toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }
  return headers;
}

/**
 * 현재 시간을 나노초 단위 문자열로 변환하는 함수
 * @returns 나노초 단위 타임스탬프 문자열
 */
function nowInNano(): string {
  const ms = Date.now();
  const ns = BigInt(ms) * 1000000n;
  return ns.toString();
}

/**
 * 로그 수집 시점에서 traceID를 추출하는 함수
 * 여러 소스에서 traceID를 찾아 반환 (우선순위 순)
 * @param extra 추가 데이터 객체
 * @returns traceID 문자열 또는 undefined
 */
function getTraceIdForLogging(extra?: Record<string, any>): string | undefined {
  // 1. 먼저 현재 활성 span에서 traceID를 가져옴
  const currentTraceId = getCurrentTraceId();
  console.log('getTraceIdForLogging - currentTraceId:', currentTraceId);
  
  if (currentTraceId) {
    return currentTraceId;
  }

  // 2. 없으면 extra에서 찾기
  if (!extra) return undefined;

  console.log('getTraceIdForLogging - extra:', extra);
  
  // direct fields
  if (typeof extra.traceId === 'string' && extra.traceId) return extra.traceId;
  if (typeof (extra as any).traceID === 'string') return (extra as any).traceID;

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

/**
 * 로그를 Loki로 전송하는 함수
 * @param level 로그 레벨
 * @param message 로그 메시지
 * @param extra 추가 데이터
 */
async function pushToLoki(level: string, message: string, extra?: Record<string, any>) {
  try {
    const traceId = getTraceIdForLogging(extra);
    
    // 디버깅용 로그 추가
    console.log('pushToLoki - traceId:', traceId);
    console.log('pushToLoki - extra:', extra);

    const labels: Record<string, string> = {
      job: LOKI_JOB,
      level,
      app: LOKI_APP,
      env: LOKI_ENV,
    };
    
    // traceID가 있을 때만 labels에 추가
    if (traceId) {
      labels['traceID'] = traceId;
    }
    
    const fields = { ...(extra || {}) };
    // extra에 traceID가 없을 때만 추가 (중복 방지)
    if (traceId && !fields.traceID) {
      fields.traceID = traceId;
    }

    const fieldsText = Object.keys(fields).length ? ` | ${JSON.stringify(fields)}` : '';
    const line = `${message}${fieldsText}`;

    // 디버깅용 로그 추가
    console.log('pushToLoki - final fields:', fields);
    console.log('pushToLoki - final line:', line);

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

/**
 * 로그 객체 - 파일과 Loki에 동시 로깅
 * 각 레벨별로 traceID를 자동으로 추출하여 로깅
 */
export const log = {
  /**
   * 디버그 레벨 로그
   * @param message 로그 메시지
   * @param extra 추가 데이터
   */
  debug: (message: string, extra?: Record<string, any>) => {
    const traceId = getTraceIdForLogging(extra);
    logger.debug({ traceID: traceId, ...extra }, message);
    void pushToLoki('debug', message, extra);
  },

  /**
   * 정보 레벨 로그
   * @param message 로그 메시지
   * @param extra 추가 데이터
   */
  info: (message: string, extra?: Record<string, any>) => {
    const traceId = getTraceIdForLogging(extra);
    logger.info({ traceID: traceId, ...extra }, message);
    void pushToLoki('info', message, extra);
  },

  /**
   * 경고 레벨 로그
   * @param message 로그 메시지
   * @param extra 추가 데이터
   */
  warn: (message: string, extra?: Record<string, any>) => {
    const traceId = getTraceIdForLogging(extra);
    logger.warn({ traceID: traceId, ...extra }, message);
    void pushToLoki('warn', message, extra);
  },

  /**
   * 에러 레벨 로그
   * @param message 로그 메시지
   * @param error 에러 객체
   * @param extra 추가 데이터
   */
  error: (message: string, error?: Error, extra?: Record<string, any>) => {
    const traceId = getTraceIdForLogging(extra);
    const errObj = error
      ? { name: error.name, message: error.message, stack: error.stack }
      : undefined;

    logger.error({ traceID: traceId, error: errObj, ...extra }, message);
    void pushToLoki('error', message, { error: errObj, ...extra });
  },
};

/**
 * 요청별 로거를 생성하는 함수
 * requestId, userId, traceID를 자동으로 포함한 로거 반환
 * @param requestId 요청 ID
 * @param userId 사용자 ID (선택사항)
 * @param traceId 추적 ID (선택사항, 없으면 현재 활성 span에서 추출)
 * @returns 요청별 로거 객체
 */
export function createRequestLogger(requestId: string, userId?: string, traceId?: string) {
  // traceId가 제공되지 않으면 현재 활성 span에서 추출
  const actualTraceId = traceId || getCurrentTraceId();
  
  return {
    debug: (m: string, e?: Record<string, any>) => log.debug(m, { requestId, userId, traceID: actualTraceId, ...e }),
    info:  (m: string, e?: Record<string, any>) => log.info(m,  { requestId, userId, traceID: actualTraceId, ...e }),
    warn:  (m: string, e?: Record<string, any>) => log.warn(m,  { requestId, userId, traceID: actualTraceId, ...e }),
    error: (m: string, err?: Error, e?: Record<string, any>) => log.error(m, err, { requestId, userId, traceID: actualTraceId, ...e }),
  };
}

/**
 * 로깅과 함께 비동기 작업을 실행하는 헬퍼 함수
 * 작업 시작/완료/실패를 자동으로 로깅
 * @param operation 작업 이름
 * @param fn 실행할 비동기 함수
 * @returns 함수 실행 결과
 */
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
