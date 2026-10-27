import { CategoryToolPage } from '@/components/custom/category-tool-page';
export default function ChartsPage() {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return <CategoryToolPage src={`${base}/gold-signals/index.html`} title="XAUUSD Gold Signals" />;
}
