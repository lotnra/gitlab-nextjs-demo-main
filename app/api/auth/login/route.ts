import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
	try {
		const { email, password } = await req.json();
		if (!email || !password) {
			return NextResponse.json({ message: '이메일/비밀번호가 필요합니다.' }, { status: 400 });
		}

		const client = await clientPromise;
		const dbName = process.env.MONGODB_DB || 'app';
		const db = client.db(dbName);
		const users = db.collection('users');

		const user = await users.findOne({ email });
		if (!user) {
			return NextResponse.json({ message: '존재하지 않는 계정입니다.' }, { status: 401 });
		}

		const valid = await bcrypt.compare(password, user.password);
		if (!valid) {
			return NextResponse.json({ message: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
		}

		const token = signToken({ id: String(user._id), email: user.email });
		const res = NextResponse.json({ ok: true });
		res.cookies.set('token', token, {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			path: '/',
			maxAge: 60 * 60 * 24 * 7,
		});
		return res;
	} catch (e: any) {
		return NextResponse.json({ message: '서버 오류', error: e?.message }, { status: 500 });
	}
}