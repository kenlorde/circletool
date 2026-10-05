import Link from 'next/link';

export default function ChartsPage() {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return (
    <main className="min-h-dvh bg-[#0b1420] text-white">
      <nav aria-label="Charts navigation" className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <Link href="/" className="rounded-lg px-3 py-2 text-sm hover:bg-white/10">Back to Circletool</Link>
        <span className="text-sm font-medium">Charts · Gold Signals</span>
      </nav>
      <iframe src={`${base}/gold-signals/index.html`} title="XAUUSD Gold Signals" className="block w-full border-0" style={{ height: 'calc(100dvh - 66px)', minHeight: 500 }} />
    </main>
  );
}
