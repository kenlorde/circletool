import Link from 'next/link';

export default function TickAnalysisPage() {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return (
    <main className="min-h-dvh bg-[#0a1220] text-white">
      <nav aria-label="Tick analysis navigation" className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <Link href="/" className="rounded-lg px-3 py-2 text-sm hover:bg-white/10">Back to Circletool</Link>
        <span className="text-sm font-medium">Tick Analysis · Over / Under</span>
      </nav>
      <iframe src={`${base}/tick-analysis/index.html`} title="Deriv Over and Under Tick Analysis" className="block w-full border-0" style={{ height: 'calc(100dvh - 66px)', minHeight: 500 }} />
    </main>
  );
}
