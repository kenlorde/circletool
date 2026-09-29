'use client';

import Link from 'next/link';
import { Header } from '@/components/custom/header';
import { ThemeToggle } from '@/components/custom/theme-toggle';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { CopyTradingPanel } from '@/components/copy-trading-panel';

export default function CopyTradingPage() {
  const { auth } = useDerivWSContext();
  const logoSrc = useLogoSrc();
  return (
    <main className="copy-trading-page">
      <Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={auth.login} onSignUp={auth.signUp} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} actions={<ThemeToggle />} />
      <div className="h-[76px] shrink-0" />
      <div className="copy-trading-content">
        <Link href="/" className="copy-trading-back">← Manual Trader</Link>
        <CopyTradingPanel />
      </div>
    </main>
  );
}
