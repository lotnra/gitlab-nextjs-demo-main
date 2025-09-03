import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { getUserFromRequest } from '@/lib/auth';
import { ObjectId } from 'mongodb';

// 게시글 상세 조회
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB || 'app');
    const posts = db.collection('posts');

    const post = await posts.findOne({ _id: new ObjectId(params.id) });
    if (!post) {
      return NextResponse.json({ message: '게시글을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ post });
  } catch (e: any) {
    return NextResponse.json({ message: '서버 오류', error: e?.message }, { status: 500 });
  }
}

// 게시글 수정
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
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

    const post = await posts.findOne({ _id: new ObjectId(params.id) });
    if (!post) {
      return NextResponse.json({ message: '게시글을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (post.authorId !== user.id) {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }

    await posts.updateOne(
      { _id: new ObjectId(params.id) },
      { $set: { title, content, updatedAt: new Date() } }
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ message: '서버 오류', error: e?.message }, { status: 500 });
  }
}

// 게시글 삭제
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ message: '로그인이 필요합니다.' }, { status: 401 });
    }

    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB || 'app');
    const posts = db.collection('posts');

    const post = await posts.findOne({ _id: new ObjectId(params.id) });
    if (!post) {
      return NextResponse.json({ message: '게시글을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (post.authorId !== user.id) {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }

    await posts.deleteOne({ _id: new ObjectId(params.id) });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ message: '서버 오류', error: e?.message }, { status: 500 });
  }
}
