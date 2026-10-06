'use client';

import { useState } from 'react';
import { Localize } from '@deriv-com/translations';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { LANGUAGE_LOCALES } from '@/lib/i18n';
import { useAppTranslations } from '@/components/custom/i18n-provider';
import { LanguageSwitcher } from '@/components/custom/language-switcher';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import type { AuthState, DerivAccount } from '@deriv/core';
import { useDerivWSContext } from './deriv-ws-provider';

interface HeaderProps {
  authState: AuthState;
  accounts: DerivAccount[];
  activeAccount: DerivAccount | null;
  onLogin: () => Promise<void>;
  onLogout: () => void;
  onSwitchAccount: (accountId: string) => Promise<void>;
  /** When provided, a Sign up button is rendered to the right of the Log in button. */
  onSignUp?: () => Promise<void>;
  /** Logo source URL or data URL. When omitted, a placeholder badge is shown until
   *  the user provides a logo via the app builder (passed as a data URL via PREVIEW_BRANDING). */
  logoSrc?: string;
  /** App name used for the header text and the fallback logo letter when no logoSrc
   *  is provided. Prefers the live preview / Customise name, then
   *  NEXT_PUBLIC_DERIV_APP_NAME, then 'Deriv Trading'. */
  appName?: string;
  /**
   * When false, hide the name text next to the logo. Defaults to the
   * NEXT_PUBLIC_DERIV_SHOW_APP_NAME env var (true when unset).
   */
  showAppName?: boolean;
  /** Optional controls rendered to the left of the login/logout button (e.g. a theme toggle). */
  actions?: React.ReactNode;
}

function formatBalance(balance: string, locale: string): string {
  return Number(balance).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function AccountLabel({ type }: { type: 'demo' | 'real' }) {
  return (
    <span
      className={cn(
        'text-sm font-medium',
        type === 'demo' ? 'text-orange-500' : 'text-emerald-600'
      )}
    >
      {type === 'demo' ? (
        <Localize i18n_default_text="Demo account" />
      ) : (
        <Localize i18n_default_text="Real account" />
      )}
    </span>
  );
}

function resolveHeaderAppName(appName?: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_DERIV_APP_NAME?.trim();
  return appName?.trim() || fromEnv || 'Deriv Trading';
}

function resolveShowAppName(showAppName?: boolean): boolean {
  if (typeof showAppName === 'boolean') return showAppName;
  return process.env.NEXT_PUBLIC_DERIV_SHOW_APP_NAME !== 'false';
}

export function Header({
  authState,
  accounts,
  activeAccount,
  onLogin,
  onLogout,
  onSwitchAccount,
  onSignUp,
  logoSrc,
  appName,
  showAppName,
  actions,
}: HeaderProps) {
  const { balanceSync } = useDerivWSContext();
  const { currentLang, localize } = useAppTranslations();
  const numberLocale = LANGUAGE_LOCALES[currentLang];
  const [logoError, setLogoError] = useState(false);
  const resolvedName = resolveHeaderAppName(appName);
  const shouldShowName = resolveShowAppName(showAppName);
  const logoLetter = resolvedName.charAt(0).toUpperCase() || 'D';
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isAuthenticated = authState === 'authenticated';
  const isAuthenticating = authState === 'authenticating';

  return (
    <header className="circletool-header fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 border-b bg-background/80 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {!logoSrc || logoError ? (
          <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
            {logoLetter}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- next/image is avoided here intentionally: it errors in the optimizer when /logo.png is absent locally; a plain img with onError gives the same silent fallback behaviour
          <img
            src={logoSrc}
            alt={localize('App Logo')}
            className="h-8 w-auto object-contain"
            onError={() => setLogoError(true)}
          />
        )}
        {shouldShowName && (
          <h1 className="text-lg font-semibold text-foreground hidden sm:block">
            {resolvedName}
          </h1>
        )}
        <button type="button" className="mobile-menu-button inline-flex items-center justify-center w-9 h-10 xl:hidden" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="hidden xl:inline-flex text-sm font-medium hover:underline">Dashboard</Link>
        <Link href="/" className="hidden xl:inline-flex text-sm font-medium hover:underline">Manual Trader</Link>
        <Link href="/smart-ai" className="hidden xl:inline-flex text-sm font-medium hover:underline">Smart AI</Link>
        <Link href="/copy-trading" className="hidden xl:inline-flex text-sm font-medium hover:underline">Copy Trading</Link>
        <Link href="/tick-analysis" className="hidden xl:inline-flex text-sm font-medium hover:underline">Tick Analysis</Link>
        <Link href="/charts" className="hidden xl:inline-flex text-sm font-medium hover:underline">Charts</Link>
        <Link href="/academy" className="hidden xl:inline-flex text-sm font-medium hover:underline">Academy</Link>
        <div className="hidden sm:block">{actions}</div>
        <div className="hidden sm:block"><LanguageSwitcher /></div>
        {isAuthenticated && activeAccount && (
          <Popover open={accountSwitcherOpen} onOpenChange={setAccountSwitcherOpen}>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg border border-border px-3 hover:bg-muted/50 transition-colors">
                <div className="circletool-account-summary text-left">
                  <AccountLabel type={activeAccount.account_type} />
                  <p className="circletool-account-balance text-base font-bold text-foreground"><span className="sm:hidden" aria-hidden>🇺🇸 </span>
                    {formatBalance(activeAccount.balance, numberLocale)} {activeAccount.currency}
                  </p>
                  {balanceSync.error && <p className="text-xs text-amber-500" title={balanceSync.error}>Balance not verified</p>}
                </div>
                <svg
                  className={cn(
                    'w-4 h-4 text-muted-foreground transition-transform',
                    accountSwitcherOpen && 'rotate-180'
                  )}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="z-[100] w-64 p-2">
              <div className="space-y-1">
                {accounts.map((account) => (
                  <button
                    key={account.account_id}
                    onClick={() => {
                      onSwitchAccount(account.account_id);
                      setAccountSwitcherOpen(false);
                    }}
                    className={cn(
                      'w-full text-left rounded-lg px-3 py-2.5 transition-colors',
                      account.account_id === activeAccount.account_id
                        ? 'bg-muted'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <AccountLabel type={account.account_type} />
                    <p className="text-base font-bold text-foreground">
                      {formatBalance(account.balance, numberLocale)} {account.currency}
                    </p>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {isAuthenticated ? (
          <Button className="hidden sm:inline-flex" variant="outline" onClick={onLogout}>
            <Localize i18n_default_text="Log out" />
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onLogin} disabled={isAuthenticating}>
              {isAuthenticating ? (
                <Localize i18n_default_text="Logging in..." />
              ) : (
                <Localize i18n_default_text="Log in" />
              )}
            </Button>
            {onSignUp && (
              <Button size="sm" onClick={onSignUp} disabled={isAuthenticating}>
                <Localize i18n_default_text="Sign up" />
              </Button>
            )}
          </div>
        )}
      </div>
      {mobileMenuOpen && (
        <div className="mobile-header-menu absolute top-full left-0 right-0 grid gap-3 p-4 border-b bg-background shadow-lg xl:hidden">
          <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)}>Dashboard</Link>
          <Link href="/" onClick={() => setMobileMenuOpen(false)}>Manual Trader</Link>
          <Link href="/smart-ai" onClick={() => setMobileMenuOpen(false)}>Smart AI</Link>
          <Link href="/copy-trading" onClick={() => setMobileMenuOpen(false)}>Copy Trading</Link>
          <Link href="/tick-analysis" onClick={() => setMobileMenuOpen(false)}>Tick Analysis</Link>
          <Link href="/charts" onClick={() => setMobileMenuOpen(false)}>Charts</Link>
          <Link href="/academy" onClick={() => setMobileMenuOpen(false)}>Academy</Link>
          <div className="flex items-center justify-between gap-3"><span>{localize('Appearance')}</span>{actions}</div>
          <div className="flex items-center justify-between gap-3"><span>{localize('Language')}</span><LanguageSwitcher /></div>
          {isAuthenticated && <Button variant="outline" onClick={() => { onLogout(); setMobileMenuOpen(false); }}><Localize i18n_default_text="Log out" /></Button>}
        </div>
      )}
    </header>
  );
}
