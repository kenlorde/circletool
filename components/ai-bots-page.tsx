'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Search, Bot, ArrowLeft } from 'lucide-react';
import { Header } from '@/components/custom/header';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { SmartAIBot } from './smart-ai-bot';
import styles from './ai-bots-page.module.css';
const bots = [
  { id: 'master', name: 'Master AI', barrier: '7', description: 'Under 7 · winning digits 0–6. Choose your volatility index, ticks, fixed stake and session limits.', ribbon: 'UNDER 7', isNew: false },
  { id: 'expert', name: 'Expert AI', barrier: '8', description: 'Under 8 · winning digits 0–7. Choose your volatility index, ticks, fixed stake and session limits.', ribbon: 'NEW', isNew: true },
] as const;
type Category = 'all' | 'automated' | 'new';
export function AIBotsPage() {
  const { auth } = useDerivWSContext();
  const logoSrc = useLogoSrc();
  const sessionLock = useRef(false);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<(typeof bots)[number] | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const visible = bots.filter(bot => (category !== 'new' || bot.isNew) && `${bot.name} Under ${bot.barrier}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <main className={styles.page}>
    <Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={auth.login} onSignUp={auth.signUp} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} appName="Circletool" />
    <div className={styles.spacer} />
    <nav className={styles.nav} aria-label="Bot sections"><Link href="/dashboard">Dashboard</Link><Link href="/bot-editor">Bot Builder</Link><span className={styles.current} aria-current="page"><Bot size={21} aria-hidden /> Smart AI</span><Link href="/copy-trading">Copy Trading</Link></nav>
    <div className={styles.content}>
      {selected ? <>
        <button className={styles.back} disabled={running} onClick={() => { if (!sessionLock.current) setSelected(null); }}><ArrowLeft size={18} aria-hidden /> All bots</button>
        <SmartAIBot key={selected.id} barrier={selected.barrier} sessionLock={sessionLock} onRunStateChange={setRunning} />
      </> : <>
        <h1 className={styles.heading}>Smart AI bots</h1>
        <label className={styles.search}><Search size={23} aria-hidden /><span className="sr-only">Search bots</span><input type="search" placeholder="Search bots…" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className={styles.filters} aria-label="Bot categories">{[{id:'all',label:'All Bots',count:bots.length},{id:'automated',label:'Automated',count:bots.length},{id:'new',label:'New',count:bots.filter(bot=>bot.isNew).length}].map(filter => <button key={filter.id} aria-pressed={category === filter.id} className={category === filter.id ? styles.active : ''} onClick={() => setCategory(filter.id as Category)}>{filter.label}<span>{filter.count}</span></button>)}</div>
        <div className={styles.cards}>{visible.map(bot => <article key={bot.id} className={`${styles.card} ${bot.id === 'master' ? styles.master : styles.expert}`}>
          <span className={styles.ribbon}>{bot.ribbon}</span>
          <h2>{bot.name}</h2><p>{bot.description}</p>
          <div className={styles.cardBottom}><span>Fixed stake · one contract at a time</span><button onClick={() => setSelected(bot)} aria-label={`Load ${bot.name}`}>Load Bot</button></div>
        </article>)}</div>
        {!visible.length && <p className={styles.empty} role="status">No bots match your search.</p>}
        <p className={styles.note}>Load a bot to review its settings. Purchases begin only when you press Start. Trading can lose money.</p>
      </>}
    </div>
  </main>;
}
