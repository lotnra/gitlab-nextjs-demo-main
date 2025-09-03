'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Post = { _id: string; title: string; authorEmail?: string; createdAt?: string };

export default function PostsPage() {
  const [items, setItems] = useState<Post[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  async function load() {
    const res = await fetch('/api/posts', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items || []);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    if (res.ok) {
      setTitle('');
      setContent('');
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data?.message || '작성 실패 (로그인 필요)');
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    alert('로그아웃 되었습니다.');
    location.href = '/';
  }

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">게시판</h1>
        <div className="space-x-3">
          <Link href="/" className="underline text-sm">메인</Link>
          <Link href="/login" className="underline text-sm">로그인</Link>
          <button onClick={logout} className="underline text-sm">로그아웃</button>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-3 border rounded-md p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
          className="w-full rounded-md border px-3 py-2"
          required
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="내용"
          className="w-full rounded-md border px-3 py-2 min-h-[120px]"
          required
        />
        <button type="submit" className="rounded-md bg-foreground text-background px-4 py-2">
          작성
        </button>
      </form>

      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p._id} className="border rounded-md p-4">
            <div className="font-semibold">{p.title}</div>
            <div className="text-xs text-gray-500">{p.authorEmail || '익명'} • {p.createdAt ? new Date(p.createdAt).toLocaleString() : ''}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
