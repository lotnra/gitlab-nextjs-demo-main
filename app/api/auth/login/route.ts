import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/database';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { log, withLogging } from '@/lib/logging';

export async function POST(req: NextRequest) {
  return withLogging('auth.login', async (logger) => {
    try {
      const { email, password } = await req.json();
      
      logger.info('로그인 시도', { email });
      
      if (!email || !password) {
        logger.warn('로그인 실패: 필수 필드 누락', { email: !!email, password: !!password });
        return NextResponse.json({ message: '이메일/비밀번호가 필요합니다.' }, { status: 400 });
      }

      const client = await clientPromise;
      const dbName = process.env.MONGODB_DB || 'app';
      const db = client.db(dbName);
      const users = db.collection('users');

      logger.debug('사용자 조회 중', { email });
      const user = await users.findOne({ email });
      
      if (!user) {
        logger.warn('로그인 실패: 존재하지 않는 사용자', { email });
        return NextResponse.json({ message: '존재하지 않는 계정입니다.' }, { status: 401 });
      }

      logger.debug('비밀번호 검증 중', { userId: String(user._id) });
      const valid = await bcrypt.compare(password, user.password);
      
      if (!valid) {
        logger.warn('로그인 실패: 잘못된 비밀번호', { userId: String(user._id), email });
        return NextResponse.json({ message: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
      }

      const token = signToken({ id: String(user._id), email: user.email });
      
      logger.info('로그인 성공', { 
        userId: String(user._id), 
        email: user.email 
      });

      const res = NextResponse.json({ ok: true });
      res.cookies.set('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
      return res;
    } catch (error) {
      logger.error('로그인 처리 중 오류 발생', error as Error, { 
        email: (await req.json().catch(() => ({}))).email 
      });
      return NextResponse.json({ message: '서버 오류', error: (error as Error)?.message }, { status: 500 });
    }
  });
}