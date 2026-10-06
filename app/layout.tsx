import { AccessGate } from '@/components/custom/access-gate';
import type { Metadata } from 'next';
import { buildFaviconUri } from '@/lib/build-favicon-uri';
import { getLogoSrc } from '@/lib/get-logo-src';
import { inter, FONT_CLASS_MAP } from '@/lib/fonts';
import { TemplateLayout } from '@/components/custom/template-layout';
import { LogoSrcProvider } from '@/components/custom/logo-src-provider';
import { TemplateI18nProvider } from '../lib/i18n/provider';
import '@/app/globals.css';
import './globals.css';
import './custom.css';

export function generateMetadata(): Metadata {
  const faviconUri = buildFaviconUri();
  return {
    title: process.env.NEXT_PUBLIC_DERIV_APP_NAME?.trim() || 'Circletool',
    description: 'A white-label trading application powered by Deriv',
    applicationName: 'Circletool',
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, title: 'Circletool', statusBarStyle: 'default' },
    icons: {
      ...(faviconUri ? { icon: faviconUri } : {}),
      apple: [{ url: '/circletool-app-icon.png', type: 'image/png', sizes: '1254x1254' }],
    },
  };
}

const fontClass =
  FONT_CLASS_MAP[process.env.NEXT_PUBLIC_FONT_FAMILY ?? 'Inter'] ??
  inter.className;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const logoSrc = getLogoSrc();
  return (
    <html lang="en" className="h-full lg:h-auto" suppressHydrationWarning>
      <body
        className={`${fontClass} bg-background flex min-h-dvh flex-col overflow-hidden max-lg:h-dvh max-lg:overflow-hidden lg:block lg:h-auto lg:min-h-screen lg:overflow-x-hidden lg:overflow-y-auto`}
      >
        <TemplateI18nProvider>
          <TemplateLayout>
            <LogoSrcProvider logoSrc={logoSrc}><AccessGate>{children}</AccessGate></LogoSrcProvider>
          </TemplateLayout>
        </TemplateI18nProvider>
      </body>
    </html>
  );
}
