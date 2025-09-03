import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

// 게시글 목록 조회
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB || 'app');
    const posts = db.collection('posts');
    
    const list = await posts
      .find({}, { projection: { content: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    
    return NextResponse.json({ items: list });
  } catch (e: any) {
    return NextResponse.json({ message: '서버 오류', error: e?.message }, { status: 500 });
  }
}

// 게시글 작성
export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ message: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { title, content } = await req.json();
    if (!title || !content) {
      return NextResponse.json({ message: '제목/내용이 필요합니다.' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB || 'app');
    const posts = db.collection('posts');

    const now = new Date();
    const doc = {
      title,
      content,
      authorId: user.id,
      authorEmail: user.email,
      createdAt: now,
      updatedAt: now
    };
    
    const result = await posts.insertOne(doc);
    return NextResponse.json({ ok: true, id: result.insertedId });
  } catch (e: any) {
    return NextResponse.json({ message: '서버 오류', error: e?.message }, { status: 500 });
  }
}