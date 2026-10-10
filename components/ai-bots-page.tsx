'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, Bot, ArrowLeft } from 'lucide-react';
import { Header } from '@/components/custom/header';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { SmartAIBot } from './smart-ai-bot';
import { readBotTransactions, saveBotTransaction, upsertBotTransaction, type BotTransaction } from '@/lib/bot-transactions';
import styles from './ai-bots-page.module.css';
const bots = [
  { id: 'master', name: 'Master AI', barrier: '7', description: 'Under 7 · winning digits 0–6. Choose your volatility index, ticks, fixed stake and session limits.', ribbon: 'UNDER 7', isNew: false, xml: false },
  { id: 'expert', name: 'Expert AI', barrier: '8', description: 'Under 8 · winning digits 0–7. Choose your volatility index, ticks, fixed stake and session limits.', ribbon: 'NEW', isNew: true, xml: false },
  { id: 'smart', name: 'Smart AI', barrier: '', description: 'Uploaded XML strategy. Open the original bot in Bot Builder to review and edit its settings.', ribbon: 'NEW', isNew: true, xml: true },
] as const;
type Category = 'all' | 'automated' | 'new';
export function AIBotsPage() {
  const { auth } = useDerivWSContext();
  const logoSrc = useLogoSrc();
  const sessionLock = useRef(false);
  const pageRef = useRef<HTMLElement>(null);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<Extract<(typeof bots)[number], { xml: false }> | null>(null);
  const accountId = auth.activeAccount?.account_id;
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const [transactions, setTransactions] = useState<BotTransaction[]>([]);
  const [storageError, setStorageError] = useState('');
  const [view, setView] = useState<'setup' | 'transactions'>('setup');
  useEffect(() => { pageRef.current?.scrollTo({ top: 0 }); }, [view, selected?.id]);
  useEffect(() => { setTransactions(accountId ? readBotTransactions(accountId) : []); setStorageError(''); }, [accountId]);
  function recordTransaction(transaction: BotTransaction) {
    try {
      const rows = saveBotTransaction(transaction);
      if (accountRef.current === transaction.accountId) setTransactions(rows);
    } catch {
      if (accountRef.current === transaction.accountId) {
        setTransactions(previous => upsertBotTransaction(previous,transaction));
        setStorageError('Transactions are visible for this session, but could not be saved on this device.');
      }
    }
  }
  const botTransactions = transactions.filter(x => x.accountId === accountId && x.botId === selected?.id);
  const totals = botTransactions.filter(x => x.status !== 'open').reduce<Record<string, number>>((s,x) => { s[x.currency] = (s[x.currency] ?? 0) + (x.profit ?? 0); return s; },{});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const visible = bots.filter(bot => (category !== 'new' || bot.isNew) && `${bot.name} Under ${bot.barrier}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <main ref={pageRef} className={styles.page}>
    <Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={auth.login} onSignUp={auth.signUp} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} appName="Circletool" />
    <div className={styles.spacer} />
    <nav className={styles.nav} aria-label="Bot sections"><Link href="/dashboard">Dashboard</Link><Link href="/bot-editor">Bot Builder</Link><span className={styles.current} aria-current="page"><Bot size={21} aria-hidden /> Smart AI</span><Link href="/copy-trading">Copy Trading</Link></nav>
    <div className={styles.content}>
      {selected ? <>
        <button className={styles.back} disabled={running} onClick={() => { if (!sessionLock.current) setSelected(null); setView('setup'); }}><ArrowLeft size={18} aria-hidden /> All bots</button>
        <div className={styles.views} aria-label="Bot pages"><button aria-pressed={view === 'setup'} onClick={() => setView('setup')}>Bot settings</button><button aria-pressed={view === 'transactions'} onClick={() => setView('transactions')}>Transactions <span>{botTransactions.length}</span></button></div>
        <div hidden={view !== 'setup'}><SmartAIBot key={selected.id} barrier={selected.barrier} sessionLock={sessionLock} onRunStateChange={setRunning} onTransaction={recordTransaction} /></div>
        {view === 'setup' && <button className={styles.next} onClick={() => setView('transactions')}>Next: Transactions →</button>}
        {view === 'transactions' && <section className={styles.transactions} aria-labelledby="transaction-title">
          <h1 id="transaction-title">{selected.name} transactions</h1>
          <p>Account: {accountId ?? 'Not logged in'}{running ? ' · Bot running' : ' · Bot stopped'}</p>
          <div className={styles.summary}><span>Contracts <b>{botTransactions.length}</b></span><span>Wins <b>{botTransactions.filter(x=>x.status === 'won').length}</b></span><span>Losses <b>{botTransactions.filter(x=>x.status === 'lost').length}</b></span>{Object.entries(totals).map(([currency,total]) => <span key={currency}>Net profit <b className={total < 0 ? styles.loss : styles.win}>{total.toFixed(2)} {currency}</b></span>)}</div>
          {storageError && <p role="status">{storageError}</p>}
          {!botTransactions.length ? <p className={styles.empty}>No transactions recorded for this bot yet. New purchases will appear here automatically.</p> : <ol className={styles.transactionList}>{botTransactions.map(x => <li key={x.contractId}>
            <div className={styles.transactionTop}><strong>Under {x.barrier} · {x.symbol}</strong><span className={x.status === 'lost' ? styles.loss : x.status === 'open' ? '' : styles.win}>{x.status === 'break-even' ? 'Break even' : x.status === 'open' ? 'Open' : x.status === 'won' ? 'Won' : 'Lost'}</span></div>
            <small>Contract #{x.contractId} · {new Date(x.purchasedAt).toLocaleString('en-KE',{timeZone:'Africa/Nairobi'})} EAT</small>
            <div className={styles.transactionAmounts}><span>Stake <b>{x.stake.toFixed(2)} {x.currency}</b></span><span>Duration <b>{x.ticks} {x.ticks === 1 ? 'tick' : 'ticks'}</b></span><span>Profit / loss <b className={x.status === 'lost' ? styles.loss : styles.win}>{x.profit === undefined ? 'Pending' : `${x.profit > 0 ? '+' : ''}${x.profit.toFixed(2)} ${x.currency}`}</b></span></div>
          </li>)}</ol>}
          <p className={styles.note}>Records cover this bot’s purchases captured on this device after this update. Earlier bot sessions are not included. Open contracts remain pending until settlement is verified.</p>
          <button className={styles.back} onClick={() => setView('setup')}>← Back to bot settings</button>
        </section>}
      </> : <>
        <h1 className={styles.heading}>Smart AI bots</h1>
        <label className={styles.search}><Search size={23} aria-hidden /><span className="sr-only">Search bots</span><input type="search" placeholder="Search bots…" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className={styles.filters} aria-label="Bot categories">{[{id:'all',label:'All Bots',count:bots.length},{id:'automated',label:'Automated',count:bots.length},{id:'new',label:'New',count:bots.filter(bot=>bot.isNew).length}].map(filter => <button key={filter.id} aria-pressed={category === filter.id} className={category === filter.id ? styles.active : ''} onClick={() => setCategory(filter.id as Category)}>{filter.label}<span>{filter.count}</span></button>)}</div>
        <div className={styles.cards}>{visible.map(bot => <article key={bot.id} className={`${styles.card} ${bot.id === 'master' ? styles.master : styles.expert}`}>
          <span className={styles.ribbon}>{bot.ribbon}</span>
          <h2>{bot.name}</h2><p>{bot.description}</p>
          <div className={styles.cardBottom}><span>{bot.xml ? 'XML bot · editable settings' : 'Fixed stake · one contract at a time'}</span>{bot.xml ? <Link href="/bot-editor?bot=smart-ai" aria-label={`Load ${bot.name}`}>Load Bot</Link> : <button onClick={() => setSelected(bot)} aria-label={`Load ${bot.name}`}>Load Bot</button>}</div>
        </article>)}</div>
        {!visible.length && <p className={styles.empty} role="status">No bots match your search.</p>}
        <p className={styles.note}>Load a bot to review its settings. Purchases begin only when you press Start. Trading can lose money.</p>
      </>}
    </div>
  </main>;
}
