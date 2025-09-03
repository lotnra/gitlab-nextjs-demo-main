export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">GitLab 데모용 애플리케이션</h1>
      <a
        href="/login"
        className="rounded-full bg-foreground text-background px-6 py-3 text-base font-medium hover:opacity-90 transition"
      >
        로그인
      </a>
    </main>
  );
}