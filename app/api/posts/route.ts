import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { createSpan } from '@/lib/tracing';
import { log, createRequestLogger } from '@/lib/logging';
import { ObjectId } from 'mongodb';

// 게시글 목록 조회
export async function GET(req: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const requestLogger = createRequestLogger(requestId);
  
  return createSpan('posts.list', async (span) => {
    try {
      requestLogger.info('게시글 목록 조회 시작');
      
      const client = await clientPromise;
      const db = client.db(process.env.MONGODB_DB || 'app');
      const posts = db.collection('posts');

      const list = await posts
        .find({}, { projection: { content: 0 } })
        .sort({ createdAt: -1 })
        .toArray();

      requestLogger.info('게시글 목록 조회 완료', { 
        count: list.length 
      });

      span.setAttribute('posts.count', list.length);
      return NextResponse.json({ items: list });
    } catch (error) {
      requestLogger.error('게시글 목록 조회 실패', error as Error);
      span.recordException(error as Error);
      return NextResponse.json({ message: '서버 오류', error: (error as Error)?.message }, { status: 500 });
    }
  });
}

// 게시글 작성
export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const requestLogger = createRequestLogger(requestId, user?.id);
  
  return createSpan('posts.create', async (span) => {
    try {
      if (!user) {
        requestLogger.warn('게시글 작성 시도: 인증되지 않은 사용자');
        span.setAttribute('auth', 'unauthenticated');
        return NextResponse.json({ message: '로그인이 필요합니다.' }, { status: 401 });
      }

      const { title, content } = await req.json();
      
      requestLogger.info('게시글 작성 시도', { 
        titleLength: (title || '').length,
        contentLength: (content || '').length 
      });

      span.setAttributes({
        'posts.title.length': (title || '').length,
        'posts.content.length': (content || '').length,
        'user.id': user.id,
        'user.email': user.email,
      });

      if (!title || !content) {
        requestLogger.warn('게시글 작성 실패: 필수 필드 누락', { 
          hasTitle: !!title, 
          hasContent: !!content 
        });
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

      requestLogger.info('게시글 작성 완료', { 
        postId: String(result.insertedId),
        title: title.substring(0, 50) + (title.length > 50 ? '...' : '')
      });

      span.addEvent('posts.inserted', { insertedId: String(result.insertedId) });
      return NextResponse.json({ ok: true, id: result.insertedId });
    } catch (error) {
      requestLogger.error('게시글 작성 실패', error as Error);
      span.recordException(error as Error);
      return NextResponse.json({ message: '서버 오류', error: (error as Error)?.message }, { status: 500 });
    }
  });
}

// 게시글 삭제
export async function DELETE(req: NextRequest) {
  const user = getUserFromRequest(req);
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const requestLogger = createRequestLogger(requestId, user?.id);
  
  return createSpan('posts.deleteAll', async (span) => {
    try {
      if (!user) {
        requestLogger.warn('게시글 삭제 시도: 인증되지 않은 사용자');
        span.setAttribute('auth', 'unauthenticated');
        return NextResponse.json({ message: '로그인이 필요합니다.' }, { status: 401 });
      }

      const { ids } = await req.json();
      
      requestLogger.info('게시글 삭제 시도', { 
        deleteType: ids && Array.isArray(ids) && ids.length > 0 ? 'selected' : 'all',
        deleteCount: ids?.length || 'all'
      });

      const client = await clientPromise;
      const db = client.db(process.env.MONGODB_DB || 'app');
      const posts = db.collection('posts');

      let result;
      if (ids && Array.isArray(ids) && ids.length > 0) {
        // 선택 삭제
        const objectIds = ids.map((id: string) => new ObjectId(id));
        result = await posts.deleteMany({ 
          _id: { $in: objectIds },
          authorId: user.id
        });
        span.setAttribute('posts.deleted.count', result.deletedCount);
        span.setAttribute('posts.deleted.type', 'selected');
      } else {
        // 전체 삭제 (본인 게시글만)
        result = await posts.deleteMany({ authorId: user.id });
        span.setAttribute('posts.deleted.count', result.deletedCount);
        span.setAttribute('posts.deleted.type', 'all');
      }

      requestLogger.info('게시글 삭제 완료', { 
        deletedCount: result.deletedCount,
        deleteType: ids && Array.isArray(ids) && ids.length > 0 ? 'selected' : 'all'
      });

      span.addEvent('posts.deleted', { 
        deletedCount: result.deletedCount,
        userId: user.id 
      });
      
      return NextResponse.json({ 
        ok: true, 
        deletedCount: result.deletedCount,
        message: `${result.deletedCount}개의 게시글이 삭제되었습니다.`
      });
    } catch (error) {
      requestLogger.error('게시글 삭제 실패', error as Error);
      span.recordException(error as Error);
      return NextResponse.json({ message: '서버 오류', error: (error as Error)?.message }, { status: 500 });
    }
  });
}