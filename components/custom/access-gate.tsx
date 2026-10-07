'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAuthInfo } from '@deriv/core';
import { LockKeyhole, ArrowRight, ShieldCheck, Zap, BarChart3 } from 'lucide-react';
import { useDerivWSContext } from './deriv-ws-provider';
import { useLogoSrc } from './logo-src-provider';
import { Header } from './header';

const sections = [['/dashboard', 'Dashboard'], ['/', 'Manual Trader'], ['/smart-ai', 'Free Bots'], ['/bot-editor', 'Bot Editor'], ['/copy-trading', 'Copy Trading'], ['/tick-analysis', 'Tick Analysis'], ['/charts', 'Charts']];
export function AccessGate({ children }: { children: React.ReactNode }) {
  const { auth } = useDerivWSContext();
  const logoSrc = useLogoSrc();
  const pathname = usePathname();
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const eligible = auth.authState === 'authenticated' && !!auth.wsUrl;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    if (!eligible) { setVerified(false); setChecking(false); setError(''); return; }
    const verify = async () => {
      setChecking(true);
      try {
        const info = getAuthInfo();
        if (!info?.access_token) throw new Error('Your session expired. Please log in again.');
        const response = await fetch('/api/access-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: info.access_token }), signal: controller.signal });
        if (!response.ok) throw new Error('Unable to verify access. Please try again or log in again.');
        if (!cancelled) { setVerified(true); setError(''); }
      } catch {
        if (!cancelled) { setVerified(false); setError('You are signed in, but access to protected services could not be refreshed. Please retry.'); }
      } finally { if (!cancelled) setChecking(false); }
    };
    void verify();
    const timer = setInterval(() => { void verify(); }, 300000);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); };
  }, [eligible, retry]);
  useEffect(() => {
    if (!verified || auth.authState !== 'authenticated' || pathname !== '/login') return;
    const next = new URLSearchParams(window.location.search).get('next');
    const target = next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !next.startsWith('/login') ? next : '/dashboard';
    router.replace(target);
  }, [verified, auth.authState, pathname, router]);
  // The provider owns login status. The cookie refresh protects server APIs;
  // failure of that secondary check must not relabel a logged-in user as logged out.
  if (auth.authState === 'authenticated' && pathname !== '/login') return <>
    {children}
    {error && <div role="status" className="fixed bottom-20 left-4 right-4 z-40 rounded-lg border bg-background p-3 text-sm">{error} <button className="underline" disabled={checking} onClick={() => setRetry(value => value + 1)}>{checking ? 'Retrying…' : 'Retry'}</button></div>}
  </>;
  const busy = auth.authState === 'authenticating' || auth.authState === 'authenticated';
  async function start(signUp = false) {
    setError('');
    try { await (signUp ? auth.signUp() : auth.login()); }
    catch { setError('Could not open Deriv login. Please try again.'); }
  }
  if (busy) return <main className="circle-access">
    <Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={() => start()} onSignUp={() => start(true)} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} appName="Circletool" />
    <section className="access-card" role="status" aria-live="polite"><h1>{auth.authState === 'authenticated' ? 'You’re signed in.' : 'Restoring your session…'}</h1><p>{error || 'Please wait while Circletool connects to your account.'}</p>{error && <button className="access-login" disabled={checking} onClick={() => setRetry(value => value + 1)}>{checking ? 'Retrying…' : 'Retry connection'}</button>}</section>
  </main>;
  return <main className="circle-access">
    <Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={() => start()} onSignUp={() => start(true)} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} appName="Circletool" />
    <nav className="access-nav" aria-label="Circletool sections">{sections.map(([href, name]) => <Link href={href} key={href}>{name} <LockKeyhole size={13} aria-hidden /></Link>)}</nav>
    <section className="access-card" aria-labelledby="access-heading">
      <div className="access-lock"><LockKeyhole size={38} aria-hidden /></div>
      <span className="access-label">Restricted access</span>
      <h1 id="access-heading">Welcome back.</h1>
      <p>Log in to your <strong>Deriv</strong> account to unlock Circletool.</p>
      <button className="access-login" disabled={busy} onClick={() => start()}>{busy ? 'Verifying your session…' : 'Log in to continue'} {!busy && <ArrowRight size={23} aria-hidden />}</button>
      <p className="access-signup">Don’t have an account? <button disabled={busy} onClick={() => start(true)}>Create one now</button></p>
      {(error || auth.error) && <div role="alert" className="access-error">{error || 'Your session could not be restored. Please log in again.'}{eligible && <button onClick={() => setRetry(value => value + 1)}>Try again</button>}</div>}
      <div className="access-benefits"><span><ShieldCheck aria-hidden />Secure access</span><span><Zap aria-hidden />Live market data</span><span><BarChart3 aria-hidden />Trading tools</span></div>
    </section>
  </main>;
}
