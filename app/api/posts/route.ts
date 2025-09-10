// routes/posts.ts
import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { withLogging, createSpan, createManualLogger } from '@/lib/logger-tracing';
import { ObjectId } from 'mongodb';

// ---------------- GET: 게시글 목록 조회 ----------------
export async function GET(req: NextRequest) {
  return withLogging('posts.list', async (logger) => {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB || 'app');
    const posts = db.collection('posts');

    logger.info('게시글 목록 조회 시작');

    const list = await posts
      .find({}, { projection: { content: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    logger.info('게시글 목록 조회 완료', { count: list.length });

    // 수동 span 생성 및 로그 연동
    await createSpan('posts.list.result', async (span, traceId) => {
      const spanLogger = createManualLogger(traceId);
      spanLogger.info('게시글 결과 span 기록', { count: list.length });
      span.setAttribute('posts.count', list.length);
    });

    return NextResponse.json({ items: list });
  });
}

// ---------------- POST: 게시글 작성 ----------------
export async function POST(req: NextRequest) {
  return withLogging('posts.create', async (logger) => {
    const user = getUserFromRequest(req);
    if (!user) {
      logger.warn('게시글 작성 시도: 인증되지 않은 사용자');
      return NextResponse.json({ message: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { title, content } = await req.json();
    logger.info('게시글 작성 시도', { titleLength: title?.length, contentLength: content?.length });

    if (!title || !content) {
      logger.warn('게시글 작성 실패: 필수 필드 누락', { hasTitle: !!title, hasContent: !!content });
      return NextResponse.json({ message: '제목/내용이 필요합니다.' }, { status: 400 });
    }

    const client = await clientPromise;
    const posts = client.db(process.env.MONGODB_DB || 'app').collection('posts');

    const now = new Date();
    const doc = { title, content, authorId: user.id, authorEmail: user.email, createdAt: now, updatedAt: now };
    
    // DB 삽입 단계는 수동 span 사용
    const result = await createSpan('posts.create.db', async (span, traceId) => {
      const spanLogger = createManualLogger(traceId);
      const res = await posts.insertOne(doc);
      spanLogger.info('게시글 DB 삽입 완료', { postId: String(res.insertedId) });
      span.addEvent('posts.inserted', { insertedId: String(res.insertedId) });
      return res;
    });

    logger.info('게시글 작성 완료', { postId: String(result.insertedId), title: title.substring(0, 50) });
    return NextResponse.json({ ok: true, id: result.insertedId });
  });
}

// ---------------- DELETE: 게시글 삭제 ----------------
export async function DELETE(req: NextRequest) {
  return withLogging('posts.deleteAll', async (logger) => {
    const user = getUserFromRequest(req);
    if (!user) {
      logger.warn('게시글 삭제 시도: 인증되지 않은 사용자');
      return NextResponse.json({ message: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { ids } = await req.json();
    logger.info('게시글 삭제 시도', {
      deleteType: ids?.length ? 'selected' : 'all',
      deleteCount: ids?.length || 'all'
    });

    const client = await clientPromise;
    const posts = client.db(process.env.MONGODB_DB || 'app').collection('posts');

    // 삭제 단계 수동 span으로 계측
    const result = await createSpan('posts.delete.db', async (span, traceId) => {
      const spanLogger = createManualLogger(traceId);
      let res;
      if (ids?.length) {
        const objectIds = ids.map((id: string) => new ObjectId(id));
        res = await posts.deleteMany({ _id: { $in: objectIds }, authorId: user.id });
      } else {
        res = await posts.deleteMany({ authorId: user.id });
      }
      spanLogger.info('게시글 삭제 완료', { deletedCount: res.deletedCount, deleteType: ids?.length ? 'selected' : 'all' });
      span.addEvent('posts.deleted', { deletedCount: res.deletedCount, userId: user.id });
      return res;
    });

    return NextResponse.json({
      ok: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount}개의 게시글이 삭제되었습니다.`
    });
  });
}
