'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Activity, ArrowDown, ArrowRight, BarChart3, Bot, BriefcaseBusiness, House, Monitor, Share2 } from 'lucide-react';
import { Header } from '@/components/custom/header';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';

const actions = [
  { title: 'Upload Bot', description: 'Upload your XML bot into Circletool.', emoji: '📂', color: '#ff7456', href: '/bot-editor#upload', external: false },
  { title: 'Free Bots', description: 'Explore Circletool’s ready-made Under 7 bot.', emoji: '🤖', color: '#36e987', href: '/smart-ai', external: false },
  { title: 'Bot Editor', description: 'Edit bot fields and XML inside Circletool.', emoji: '🧩', color: '#b68aff', href: '/bot-editor', external: false },
  { title: 'Quick Strategy', description: 'Set your market, stake, and limits in Smart AI.', emoji: '⚡', color: '#ffc94a', href: '/smart-ai', external: false },
];
const sections = [
  { href: '/dashboard', title: 'Dashboard', icon: House },
  { href: '/', title: 'Manual Trader', icon: Monitor },
  { href: '/smart-ai', title: 'Smart AI', icon: Bot },
  { href: '/copy-trading', title: 'Copy Trading', icon: BriefcaseBusiness },
  { href: '/tick-analysis', title: 'Tick Analysis', icon: Activity },
  { href: '/charts', title: 'Charts', icon: BarChart3 },
];
export function CircletoolDashboard() {
  const { auth } = useDerivWSContext();
  const logoSrc = useLogoSrc();
  const [greeting, setGreeting] = useState('Welcome to Circletool');
  const [showMore, setShowMore] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    const update = () => {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' }).format(new Date())) % 24;
      setGreeting(hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
    };
    update(); const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, []);
  async function share() {
    if (sharing) return;
    setSharing(true); setShareStatus('');
    const url = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/dashboard`;
    try {
      if (navigator.share) await navigator.share({ title: 'Circletool', text: 'Explore Circletool’s trading tools.', url });
      else { await navigator.clipboard.writeText(url); setShareStatus('Invitation link copied.'); }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setShareStatus(`Copy this invitation link: ${url}`);
    } finally { setSharing(false); }
  }
  return <main className="circle-dashboard">
    <Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={auth.login} onSignUp={auth.signUp} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} appName="Circletool" />
    <div className="dashboard-header-spacer" />
    <nav className="dashboard-nav" aria-label="Trading sections">
      {sections.map(section => <Link key={section.href} href={section.href} className={section.href === '/dashboard' ? 'selected' : ''} aria-current={section.href === '/dashboard' ? 'page' : undefined}><section.icon size={23} aria-hidden />{section.title}</Link>)}
    </nav>
    <div className="dashboard-content">
      <section className="dashboard-welcome" aria-label="Welcome"><h1>{greeting}</h1><p>“The trend is your friend — until it ends.”</p></section>
      <section className="dashboard-actions" aria-labelledby="dashboard-actions-title">
        <h2 id="dashboard-actions-title">Quick actions</h2>
        <div className="dashboard-action-grid">
          {actions.map(action => <Link key={action.title} href={action.href} target={action.external ? '_blank' : undefined} rel={action.external ? 'noopener noreferrer' : undefined} className="dashboard-action-card" style={{ '--action-accent': action.color } as CSSProperties} aria-label={`${action.title}${action.external ? ' — opens Deriv Bot in a new tab' : ''}`}>
            <div className="dashboard-card-top"><span className="dashboard-card-icon" aria-hidden>{action.emoji}</span><span className="dashboard-card-arrow"><ArrowRight size={19} aria-hidden /></span></div>
            <h3>{action.title}</h3><p>{action.description}</p>
            <div className="dashboard-card-open">Open <ArrowRight size={17} aria-hidden />{action.external && <small>Deriv Bot ↗</small>}</div>
          </Link>)}
        </div>
      </section>
      <section className="dashboard-referral" aria-labelledby="dashboard-referral-title">
        <span className="dashboard-referral-eyebrow">Partner referral</span><h2 id="dashboard-referral-title">Share Circletool</h2><span className="dashboard-referral-tag">Invite traders</span>
        <p>Give a friend access to Manual Trader, Smart AI, and live tick analysis through your Circletool invitation.</p>
        <button className="dashboard-more" type="button" aria-expanded={showMore} aria-controls="dashboard-referral-details" onClick={() => setShowMore(previous => !previous)}>{showMore ? 'Show less' : 'Show more'} <ArrowDown size={18} className={showMore ? 'expanded' : ''} aria-hidden /></button>
        <div id="dashboard-referral-details" className="dashboard-referral-details" hidden={!showMore}><p>Your invitation opens Circletool’s dashboard. Your guest can use Log in or Sign up to connect their own Deriv account.</p><p>Upload and edit your XML bots in Circletool’s Bot workspace.</p></div>
        <button className="dashboard-share" type="button" disabled={sharing} onClick={share}>{sharing ? 'Opening share…' : 'Invite a trader'} <Share2 size={19} aria-hidden /></button>
        {shareStatus && <p className="dashboard-share-status" role="status">{shareStatus}</p>}
      </section>
      <footer className="dashboard-footer">Circletool · Your trading workspace</footer>
    </div>
    <Link href="/smart-ai" className="dashboard-ai-orb" aria-label="Open Smart AI"><span>AI</span><i aria-hidden /></Link>
  </main>;
}
