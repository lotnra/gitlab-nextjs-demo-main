'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Post = { _id: string; title: string; authorEmail?: string; createdAt?: string };

export default function PostsPage() {
  const [items, setItems] = useState<Post[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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

  async function deleteSelected() {
    if (selectedIds.length === 0) {
      alert('삭제할 게시글을 선택해주세요.');
      return;
    }

    if (!confirm(`선택한 ${selectedIds.length}개의 게시글을 삭제하시겠습니까?`)) {
      return;
    }

    const res = await fetch('/api/posts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds }),
    });

    if (res.ok) {
      const data = await res.json();
      alert(data.message);
      setSelectedIds([]);
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data?.message || '삭제 실패');
    }
  }

  async function deleteAll() {
    if (!confirm('모든 게시글을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      return;
    }

    const res = await fetch('/api/posts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (res.ok) {
      const data = await res.json();
      alert(data.message);
      setSelectedIds([]);
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data?.message || '삭제 실패');
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => 
      prev.includes(id) 
        ? prev.filter(selectedId => selectedId !== id)
        : [...prev, id]
    );
  }

  function toggleSelectAll() {
    if (selectedIds.length === items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map(item => item._id));
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

      {/* 삭제 버튼들 */}
      {items.length > 0 && (
        <div className="flex gap-2 p-4 border rounded-md bg-gray-50">
          <button
            onClick={toggleSelectAll}
            className="px-3 py-1 text-sm border rounded hover:bg-gray-200"
          >
            {selectedIds.length === items.length ? '전체 해제' : '전체 선택'}
          </button>
          <button
            onClick={deleteSelected}
            disabled={selectedIds.length === 0}
            className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            선택 삭제 ({selectedIds.length})
          </button>
          <button
            onClick={deleteAll}
            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
          >
            전체 삭제
          </button>
        </div>
      )}

      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p._id} className="border rounded-md p-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.includes(p._id)}
                onChange={() => toggleSelect(p._id)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-semibold">{p.title}</div>
                <div className="text-xs text-gray-500">
                  {p.authorEmail || '익명'} • {p.createdAt ? new Date(p.createdAt).toLocaleString() : ''}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}