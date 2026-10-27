'use client';
import { Header } from '@/components/custom/header';
import { CircleNav } from '@/components/custom/circle-nav';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';

export function CategoryToolPage({ src, title }: { src: string; title: string }) {
  const { auth } = useDerivWSContext();
  const logoSrc = useLogoSrc();
  return <main className="category-tool-page">
    <Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={auth.login} onSignUp={auth.signUp} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} appName="Circletool" />
    <div className="category-tool-spacer" /><CircleNav />
    <iframe src={src} title={title} className="category-tool-frame" />
  </main>;
}
