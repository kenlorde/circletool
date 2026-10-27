import { CategoryToolPage } from '@/components/custom/category-tool-page';
export default function TickAnalysisPage() {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return <CategoryToolPage src={`${base}/tick-analysis/index.html`} title="Deriv Over and Under Tick Analysis" />;
}
