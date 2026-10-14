'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Share, Smartphone } from 'lucide-react';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
const Installation = createContext<{
  prompt: InstallPrompt | null;
  installed: boolean;
  ios: boolean;
  clearPrompt: () => void;
}>({ prompt: null, installed: false, ios: false, clearPrompt: () => {} });

export function AppInstallationProvider({ children }: { children: React.ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const detect = () => setInstalled(display.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    detect();
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const beforeInstall = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const didInstall = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', didInstall);
    display.addEventListener('change', detect);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', didInstall);
      display.removeEventListener('change', detect);
    };
  }, []);
  return <Installation.Provider value={{ prompt, installed, ios, clearPrompt: () => setPrompt(null) }}>{children}</Installation.Provider>;
}

export function InstallApp() {
  const { prompt, installed, ios, clearPrompt } = useContext(Installation);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function install() {
    if (!prompt || busy) return;
    setBusy(true); setMessage('');
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(choice.outcome === 'accepted' ? 'Installation accepted. Look for Circletool on your Home Screen.' : 'You can install later using your browser menu.');
    } catch { setMessage('Open your browser menu and choose Install app or Add to Home Screen.'); }
    finally { clearPrompt(); setBusy(false); }
  }
  return <main className="install-page">
    <Link href="/dashboard" className="install-back">← Back to Circletool</Link>
    <section className="install-card" aria-labelledby="install-title">
      {/* The same icon is used by the phone installer. */}
      <img src="/app-icons/icon-192.png" width="96" height="96" alt="Circletool" className="install-logo" />
      <h1 id="install-title">Circletool on your phone</h1>
      <p>Open Circletool from your Home Screen in its own app window.</p>
      {installed ? <div className="install-ready"><strong>Circletool is installed.</strong><Link href="/dashboard">Open Circletool</Link></div> : <>
        {prompt && !ios && <button className="install-primary" disabled={busy} onClick={install}><Download size={20} aria-hidden />{busy ? 'Opening installer…' : 'Install Circletool'}</button>}
        <div className="install-steps">
          <section><h2><Share size={20} aria-hidden />iPhone</h2><ol><li>Open this page in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li><li>Keep <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.</li></ol></section>
          <section><h2><Smartphone size={20} aria-hidden />Android</h2><ol><li>Open this page in <strong>Chrome</strong>.</li><li>Tap <strong>Install Circletool</strong> above, or open the <strong>⋮ menu</strong>.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm.</li></ol></section>
        </div>
      </>}
      {message && <p role="status">{message}</p>}
      <p className="install-note">Free to install. An internet connection is required for prices, login and trading.</p>
    </section>
  </main>;
}
