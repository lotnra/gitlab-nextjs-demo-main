import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { createSpan } from '@/lib/tracing';

// 게시글 목록 조회
export async function GET() {
  return createSpan('posts.list', async (span) => {
    try {
      const client = await clientPromise;
      const db = client.db(process.env.MONGODB_DB || 'app');
      const posts = db.collection('posts');

      const list = await posts
        .find({}, { projection: { content: 0 } })
        .sort({ createdAt: -1 })
        .toArray();

      span.setAttribute('posts.count', list.length);
      return NextResponse.json({ items: list });
    } catch (e: any) {
      span.recordException(e);
      return NextResponse.json({ message: '서버 오류', error: e?.message }, { status: 500 });
    }
  });
}

// 게시글 작성
export async function POST(req: NextRequest) {
  return createSpan('posts.create', async (span) => {
    try {
      const user = getUserFromRequest(req);
      if (!user) {
        span.setAttribute('auth', 'unauthenticated');
        return NextResponse.json({ message: '로그인이 필요합니다.' }, { status: 401 });
      }
      const { title, content } = await req.json();
      span.setAttributes({
        'posts.title.length': (title || '').length,
        'posts.content.length': (content || '').length,
        'user.id': user.id,
        'user.email': user.email,
      });

      if (!title || !content) {
        return NextResponse.json({ message: '제목/내용이 필요합니다.' }, { status: 400 });
      }

      const client = await clientPromise;
      const db = client.db(process.env.MONGODB_DB || 'app');
      const posts = db.collection('posts');

      const now = new Date();
      const doc = { title, content, authorId: user.id, authorEmail: user.email, createdAt: now, updatedAt: now };
      const r = await posts.insertOne(doc);

      span.addEvent('posts.inserted', { insertedId: String(r.insertedId) });
      return NextResponse.json({ ok: true, id: r.insertedId });
    } catch (e: any) {
      span.recordException(e);
      return NextResponse.json({ message: '서버 오류', error: e?.message }, { status: 500 });
    }
  });
}