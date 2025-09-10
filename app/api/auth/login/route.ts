import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/database';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { createManualLogger, withLogging, createSpan } from '@/lib/logger-tracing';

export async function POST(req: NextRequest) {
  return withLogging('auth.login', async (logger) => {
    const body = await req.json().catch(() => ({}));
    const { email, password } = body;

    logger.info('로그인 시도', { email });

    if (!email || !password) {
      logger.warn('로그인 실패: 필수 필드 누락', { email: !!email, password: !!password });
      return NextResponse.json({ message: '이메일/비밀번호가 필요합니다.' }, { status: 400 });
    }

    // DB 조회는 수동 span으로 계측
    const user = await createSpan('auth.login.fetchUser', async (span, traceId) => {
      span.setAttribute('email', email);
      logger.debug('사용자 조회 중', { email, trace_id: traceId });

      const client = await clientPromise;
      const db = client.db(process.env.MONGODB_DB || 'app');
      const users = db.collection('users');
      const u = await users.findOne({ email });

      if (!u) {
        logger.warn('로그인 실패: 존재하지 않는 사용자', { email, trace_id: traceId });
      }

      return u;
    });

    if (!user) {
      return NextResponse.json({ message: '존재하지 않는 계정입니다.' }, { status: 401 });
    }

    // 비밀번호 검증도 span으로 계측 가능
    const valid = await createSpan('auth.login.verifyPassword', async (span, traceId) => {
      logger.debug('비밀번호 검증 중', { userId: String(user._id), trace_id: traceId });
      return await bcrypt.compare(password, user.password);
    });

    if (!valid) {
      logger.warn('로그인 실패: 잘못된 비밀번호', { userId: String(user._id), email });
      return NextResponse.json({ message: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    // 토큰 발급
    const token = signToken({ id: String(user._id), email: user.email });
    logger.info('로그인 성공', { userId: String(user._id), email });

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
