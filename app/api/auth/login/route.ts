import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/database';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { createManualLogger, withLogging, createSpan } from '@/lib/logger-tracing';

export async function POST(req: NextRequest) {
  return withLogging('auth.login', async (logger) => {
    const { email, password } = await req.json().catch(() => ({}));
    logger.info('로그인 시도', { email });

    if (!email || !password) {
      logger.warn('로그인 실패: 필수 필드 누락', { email, password });
      return NextResponse.json({ message: '이메일/비밀번호 필요', status: 400 });
    }

    // DB 조회
    const user = await createSpan('auth.login.fetchUser', async (span, traceId) => {
      const spanLogger = createManualLogger(traceId);
      spanLogger.debug('사용자 조회 중', { email });
      const client = await clientPromise;
      const db = client.db(process.env.MONGODB_DB || 'app');
      const users = db.collection('users');
      return await users.findOne({ email });
    });

    if (!user) return NextResponse.json({ message: '존재하지 않는 계정', status: 401 });

    // 비밀번호 검증
    const valid = await createSpan('auth.login.verifyPassword', async (span, traceId) => {
      const spanLogger = createManualLogger(traceId);
      spanLogger.debug('비밀번호 검증 중', { userId: String(user._id) });
      return await bcrypt.compare(password, user.password);
    });

    if (!valid) return NextResponse.json({ message: '비밀번호 불일치', status: 401 });

    // 토큰 발급
    const token = signToken({ id: String(user._id), email: user.email });
    logger.info('로그인 성공', { userId: String(user._id) });

    const res = NextResponse.json({ ok: true });
    res.cookies.set('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  });
}

