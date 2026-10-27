'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, BarChart3, Bot, BriefcaseBusiness, House, Monitor, BookOpen, FolderOpen, FileText } from 'lucide-react';

const sections = [
  { href: '/dashboard', title: 'Dashboard', icon: House },
  { href: '/', title: 'Manual Trader', icon: Monitor },
  { href: '/smart-scanner', title: 'Smart Scanner', icon: Bot },
  { href: '/smart-ai', title: 'Smart AI', icon: Bot },
  { href: '/multi-ai', title: 'Multi AI', icon: Bot },
  { href: '/copy-trading', title: 'Copy Trading', icon: BriefcaseBusiness },
  { href: '/tick-analysis', title: 'Tick Analysis', icon: Activity },
  { href: '/charts', title: 'Charts', icon: BarChart3 },
  { href: '/academy', title: 'Academy', icon: BookOpen },
  { href: '/bot-editor', title: 'Bot Builder', icon: FolderOpen },
  { href: '/reports', title: 'Transactions', icon: FileText },
];
export function CircleNav() {
  const pathname = usePathname();
  return <nav className="circle-category-nav" aria-label="Circletool categories">{sections.map(section => <Link key={section.href} href={section.href} aria-current={pathname === section.href ? 'page' : undefined}><section.icon size={23} aria-hidden />{section.title}</Link>)}</nav>;
}
