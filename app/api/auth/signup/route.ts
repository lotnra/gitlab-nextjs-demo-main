import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
	try {
		const { email, password } = await req.json();
		if (!email || !password) {
			return NextResponse.json({ message: '이메일/비밀번호가 필요합니다.' }, { status: 400 });
		}

		const client = await clientPromise;
		const dbName = process.env.MONGODB_DB || 'app';
		const db = client.db(dbName);
		const users = db.collection('users');

		await users.createIndex({ email: 1 }, { unique: true });

		const existing = await users.findOne({ email });
		if (existing) {
			return NextResponse.json({ message: '이미 존재하는 이메일입니다.' }, { status: 409 });
		}

		const hash = await bcrypt.hash(password, 10);
		const now = new Date();
		await users.insertOne({ email, password: hash, createdAt: now, updatedAt: now });

		return NextResponse.json({ ok: true });
	} catch (e: any) {
		return NextResponse.json({ message: '서버 오류', error: e?.message }, { status: 500 });
	}
}
