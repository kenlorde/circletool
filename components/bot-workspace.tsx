'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FileCode2, FolderOpen, Save, Upload, Undo2, Redo2, ZoomIn, ZoomOut, LayoutDashboard, Bot, Play, Square } from 'lucide-react';
import { Header } from '@/components/custom/header';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { MAX_BOT_BYTES, botBlocks, botFilename, parseBotXml, setBotBlockDisabled, updateBotField } from '@/lib/bot-xml';

import { compileBotXml, runBotSession, QUICK_DIGIT_BOT } from '@/lib/bot-runtime';
import type { BotProgress } from '@/lib/bot-runtime';

interface SavedBot { id: string; name: string; xml: string; updatedAt: string }
const STORAGE_KEY = 'circletool.bot-library.v1';
const control = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';
const button = `${control} inline-flex items-center justify-center gap-2 disabled:opacity-40`;
export function BotWorkspace() {
  const { auth, ws, isConnected } = useDerivWSContext();
  const logoSrc = useLogoSrc();
  const inputRef = useRef<HTMLInputElement>(null);
  const [xml, setXml] = useState('');
  const [name, setName] = useState('My bot.xml');
  const [id, setId] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [library, setLibrary] = useState<SavedBot[]>([]);
  const [tab, setTab] = useState<'fields' | 'source'>('fields');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BotProgress>({ message: 'Bot is not running', trades: 0, profit: 0 });
  const [maxTrades, setMaxTrades] = useState('10');
  const [maxStake, setMaxStake] = useState('1');
  const [lossLimit, setLossLimit] = useState('5');
  const session = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const accountRef = useRef({ ws, id: auth.activeAccountId, authenticated: !!auth.wsUrl, isConnected });
  accountRef.current = { ws, id: auth.activeAccountId, authenticated: !!auth.wsUrl, isConnected };
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) session.current?.abort(); };
    document.addEventListener('visibilitychange', hide);
    return () => { mounted.current = false; session.current?.abort(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(() => { session.current?.abort(); }, [ws, auth.activeAccountId, auth.wsUrl, isConnected]);
  async function run() {
    if (session.current || busy) return;
    try {
      if (!ws || !isConnected || !auth.wsUrl || !auth.activeAccountId || !auth.activeAccount?.currency) throw new Error('Connect a Deriv account before running a bot.');
      const program = compileBotXml(xml);
      const limits = { maxTrades: Number(maxTrades), maxStake: Number(maxStake), lossLimit: Number(lossLimit) };
      const accountId = auth.activeAccountId;
      const controller = new AbortController(); session.current = controller; setRunning(true);
      setStatus('');
      await runBotSession({
        program, ws, currency: auth.activeAccount.currency, limits, signal: controller.signal,
        isAccountCurrent: () => accountRef.current.ws === ws && accountRef.current.id === accountId && accountRef.current.authenticated && accountRef.current.isConnected && ws.isConnected,
        onProgress: next => { if (mounted.current) setProgress(next); },
      });
    } catch (error) {
      if (mounted.current) {
        const message = error instanceof Error ? error.message : 'Bot stopped.';
        setStatus(message); setProgress(previous => ({ ...previous, message }));
      }
    } finally { session.current = null; if (mounted.current) setRunning(false); }
  }
  function quickStrategy() {
    if (session.current || busy || !canReplace()) return;
    resetHistory(); setXml(QUICK_DIGIT_BOT); setName('Circletool digit starter.xml'); setId(null); setSavedSnapshot(''); setTab('fields'); setSearch('');
    setStatus('Starter loaded: Under 7, 1 tick, stake 1. Review the settings and session limits before Run.');
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('bot') !== 'smart-ai') return;
    const controller = new AbortController();
    setBusy(true);
    fetch('/bots/smart-ai.xml', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Could not load Smart AI.'); return response.text(); })
      .then(source => {
        parseBotXml(source);
        setXml(source); setName('Smart AI.xml'); setId(null);
        setSavedSnapshot(JSON.stringify(['Smart AI.xml', source]));
        setStatus('Smart AI loaded. This XML uses Rise/Fall and custom blocks; the current digit runner cannot execute it. You can edit or download the original XML.');
      })
      .catch(error => { if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'Could not load Smart AI.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);
  const [zoom, setZoom] = useState(1);
  const [showLibrary, setShowLibrary] = useState(false);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  function editXml(next: string) {
    if (session.current || next === xml) return;
    undoStack.current = [...undoStack.current.slice(-49), xml];
    redoStack.current = [];
    setXml(next); setHistoryVersion(value => value + 1);
  }
  function history(direction: 'undo' | 'redo') {
    if (session.current) return;
    const from = direction === 'undo' ? undoStack.current : redoStack.current;
    const to = direction === 'undo' ? redoStack.current : undoStack.current;
    const next = from.pop();
    if (next === undefined) return;
    to.push(xml); setXml(next); setHistoryVersion(value => value + 1);
  }
  function resetHistory() { undoStack.current = []; redoStack.current = []; setHistoryVersion(value => value + 1); }
  const blockTitle = (type: string) => ({
    trade_definition: '1. Trade parameters', trade: '1. Trade parameters',
    trade_definition_market: 'Market', trade_definition_tradetype: 'Trade type',
    trade_definition_contracttype: 'Contract type', trade_definition_candleinterval: 'Default candle interval',
    trade_definition_restartbuysell: 'Restart buy/sell on error',
    trade_definition_restartonerror: 'Restart last trade on error',
    trade_definition_tradeoptions: 'Trade options',
    before_purchase: '2. Purchase conditions', purchase: 'Purchase',
    during_purchase: '3. Sell conditions', after_purchase: '4. Restart conditions',
    variables_set: 'Set variable', variables_get: 'Variable',
    math_number: 'Number', logic_boolean: 'Boolean',
  } as Record<string, string>)[type] ?? type.replace(/_/g, ' ');
  const dirty = !!xml && JSON.stringify([name, xml]) !== savedSnapshot;
  const analysis = useMemo(() => {
    if (!xml) return { blocks: [], error: '', valid: false };
    try { return { blocks: botBlocks(parseBotXml(xml)), error: '', valid: true }; }
    catch (error) { return { blocks: [], error: error instanceof Error ? error.message : 'Invalid bot XML.', valid: false }; }
  }, [xml]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved)) setLibrary(saved.filter((bot): bot is SavedBot => !!bot && typeof bot.id === 'string' && typeof bot.name === 'string' && typeof bot.xml === 'string' && typeof bot.updatedAt === 'string').slice(0, 10));
    } catch { setStatus('Saved bots could not be read on this device. You can still upload and download XML.'); }
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const guardLink = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor || anchor.hasAttribute('download')) return;
      if (!window.confirm('This bot has unsaved changes. Leave the workspace? Save or download it first to keep your changes.')) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guardLink, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guardLink, true); };
  }, [dirty]);
  const canReplace = () => !session.current && (!dirty || window.confirm('This bot has unsaved changes. Replace it? Download or save it first if you want to keep them.'));
  async function upload(file: File | undefined) {
    if (!file || session.current || busy || !canReplace()) return;
    setBusy(true); setStatus('');
    try {
      if (!/\.xml$/i.test(file.name)) throw new Error('Choose a bot file ending in .xml.');
      if (file.size > MAX_BOT_BYTES) throw new Error('Choose an XML file smaller than 2 MB.');
      const source = await file.text();
      parseBotXml(source);
      resetHistory(); setXml(source); setName(botFilename(file.name)); setId(null); setSavedSnapshot(''); setTab('fields'); setSearch('');
      setStatus('Bot uploaded. Review its fields and session limits, then Check bot before Run.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not upload this bot.'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  function persist(next: SavedBot[]) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setLibrary(next); return true; }
    catch { setStatus('Device storage is unavailable or full. Download your XML to keep this bot.'); return false; }
  }
  function save() {
    if (!analysis.valid) return;
    if (!id && library.length >= 10) { setStatus('You have 10 saved bots. Remove one or download this bot instead.'); return; }
    const record: SavedBot = { id: id ?? crypto.randomUUID(), name: botFilename(name), xml, updatedAt: new Date().toISOString() };
    const next = [record, ...library.filter(item => item.id !== record.id)];
    if (persist(next)) { setId(record.id); setName(record.name); setSavedSnapshot(JSON.stringify([record.name, xml])); setStatus('Bot saved on this device.'); }
  }
  function download() {
    if (!analysis.valid) return;
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = botFilename(name); document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus('XML download started.');
  }
  function open(bot: SavedBot) {
    if (!canReplace()) return;
    resetHistory(); setXml(bot.xml); setName(bot.name); setId(bot.id); setSavedSnapshot(JSON.stringify([bot.name, bot.xml])); setTab('fields'); setSearch(''); setStatus('Saved bot opened.');
  }
  function changeField(path: number[], value: string) {
    try { editXml(updateBotField(xml, path, value)); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not edit field.'); }
  }
  const visibleBlocks = analysis.blocks.filter(block => `${block.type} ${block.fields.map(field => `${field.name} ${field.value}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()));

  return <main className="bot-builder h-dvh overflow-y-auto bg-background text-foreground lg:h-auto lg:min-h-screen">
    <Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={auth.login} onSignUp={auth.signUp} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} appName="Circletool" />
    <div className="h-[76px] shrink-0" />
    <nav className="builder-nav" aria-label="Bot sections"><Link href="/dashboard"><LayoutDashboard size={20} />Dashboard</Link><span aria-current="page"><Bot size={20} />Bot Builder</span><Link href="/smart-ai">Free Bots</Link><Link href="/academy">Academy</Link></nav>
    <div className="mx-auto w-full px-3 py-4 pb-32">
      <Link href="/dashboard" className="text-sm underline">← Dashboard</Link>
      <div className="my-5 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Bot Builder</h1><p className="mt-2 text-sm text-muted-foreground">Upload, edit, and run supported digit XML bots inside Circletool.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{dirty ? 'Unsaved changes' : xml ? 'Saved' : 'XML editor'}</span></div>
      <section id="upload" className="mb-5 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-5" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); upload(event.dataTransfer.files[0]); }} aria-label="Upload XML bot">
        <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><FolderOpen className="text-primary" size={30} aria-hidden /><div><h2 className="font-semibold">Upload your bot</h2><p className="text-sm text-muted-foreground">Choose an XML file from Files, or drag it here. Up to 2 MB.</p></div></div><button className={button} type="button" disabled={busy || running} onClick={() => inputRef.current?.click()}><Upload size={17} aria-hidden />{busy ? 'Reading…' : 'Choose XML file'}</button><button className={button} type="button" disabled={busy || running} onClick={quickStrategy}>Quick strategy</button></div>
        <input ref={inputRef} type="file" accept=".xml,application/xml,text/xml" className="sr-only" aria-label="Choose XML bot file" onChange={event => upload(event.target.files?.[0])} />
      </section>
      {status && <p role="status" className="mb-4 rounded-lg border border-border p-3 text-sm">{status}</p>}
      <div className="builder-body">
        <aside className="builder-tools" aria-label="Workspace tools">
          <button type="button" title="Upload XML" aria-label="Upload XML" onClick={() => inputRef.current?.click()}><FolderOpen size={23} /></button>
          <button type="button" title="My saved bots" aria-label="Show saved bots" aria-pressed={showLibrary} onClick={() => setShowLibrary(value => !value)}><Save size={23} /></button>
          <button type="button" title="Undo" aria-label="Undo edit" disabled={running || !undoStack.current.length} onClick={() => history('undo')}><Undo2 size={23} /></button>
          <button type="button" title="Redo" aria-label="Redo edit" disabled={running || !redoStack.current.length} onClick={() => history('redo')}><Redo2 size={23} /></button>
          <button type="button" title="Zoom in" aria-label="Zoom in" disabled={zoom >= 1.5} onClick={() => setZoom(value => Math.min(1.5, value + .1))}><ZoomIn size={23} /></button>
          <button type="button" title="Zoom out" aria-label="Zoom out" disabled={zoom <= .6} onClick={() => setZoom(value => Math.max(.6, value - .1))}><ZoomOut size={23} /></button>
        </aside>
        <div className="min-w-0 flex-1">
        <aside hidden={!showLibrary} className="mb-4 rounded-xl border border-border p-4"><h2 className="font-semibold">My saved bots</h2><p className="mt-1 text-xs text-muted-foreground">Stored in this browser on this device. Download a copy to move it elsewhere.</p><div className="mt-4 flex flex-col gap-3">{library.length ? library.map(bot => <div key={bot.id} className={`rounded-lg border p-3 ${id === bot.id ? 'border-primary' : 'border-border'}`}><button type="button" className="w-full break-words text-left text-sm font-medium underline" onClick={() => open(bot)}>{bot.name}</button><p className="mt-1 text-xs text-muted-foreground">{new Date(bot.updatedAt).toLocaleDateString()}</p><button className="mt-2 text-xs text-destructive underline" type="button" onClick={() => { if (window.confirm(`Remove ${bot.name} from this device?`) && persist(library.filter(item => item.id !== bot.id))) { if (id === bot.id) { setId(null); setSavedSnapshot(''); } setStatus('Saved copy removed.'); } }}>Remove saved copy</button></div>) : <p className="text-sm text-muted-foreground">Upload a bot and tap Save on device to add it here.</p>}</div></aside>
        <section className="min-w-0 rounded-xl border border-border p-4" aria-label="Bot editor">
          <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">Bot filename<input className={`${control} mt-1 w-full`} maxLength={110} value={name} onChange={event => setName(event.target.value)} /></label><button type="button" className={button} disabled={!analysis.valid || busy} onClick={save}><Save size={16} aria-hidden />Save on device</button><button type="button" className={button} disabled={!analysis.valid || busy} onClick={download}><Download size={16} aria-hidden />Download XML</button></div>
          <div className="my-4 flex flex-wrap gap-2" role="group" aria-label="Editor view"><button type="button" className={`${button} ${tab === 'fields' ? 'border-primary bg-primary/10' : ''}`} aria-pressed={tab === 'fields'} onClick={() => setTab('fields')}>Block editor</button><button type="button" className={`${button} ${tab === 'source' ? 'border-primary bg-primary/10' : ''}`} aria-pressed={tab === 'source'} onClick={() => setTab('source')}><FileCode2 size={16} aria-hidden />XML source</button></div>
          {analysis.error && <p role="alert" className="mb-4 text-sm text-destructive">{analysis.error}</p>}
          {!xml ? <div className="py-16 text-center text-muted-foreground"><FileCode2 size={38} className="mx-auto mb-3" aria-hidden /><p>Your bot will appear here after upload.</p></div> : tab === 'source' ? <><label className="text-sm" htmlFor="bot-xml-source">Full bot XML</label><textarea id="bot-xml-source" className={`${control} mt-2 min-h-[440px] w-full resize-y font-mono text-xs leading-6`} spellCheck={false} autoCapitalize="off" autoCorrect="off" readOnly={running} value={xml} onChange={event => editXml(event.target.value)} /><p className="mt-2 text-xs text-muted-foreground">Edit blocks, variables, and connections here. Only valid XML can be saved or downloaded.</p></> : <>
            <label className="text-sm">Find a block or setting<input type="search" className={`${control} my-2 w-full`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Stake, duration, prediction, NUM…" /></label>
            <p className="mb-4 text-xs text-muted-foreground">{analysis.blocks.length} blocks · Edit values below. Keep dropdown values and variable names consistent with your bot. Use XML source to change the block structure.</p>
            <div className="builder-canvas" aria-label="Visual XML block workspace">
              <div style={{ zoom }} data-history={historyVersion}>
                {visibleBlocks.map((block, index) => <section key={block.path.join('.')} className={`builder-block ${block.depth === 0 || /^(trade_definition|before_purchase|during_purchase|after_purchase)$/.test(block.type) ? 'builder-section' : 'builder-setting'} ${block.disabled ? 'builder-disabled' : ''}`} style={{ marginLeft: Math.min(block.depth, 5) * 22 }}>
                  <div className="builder-block-title">{blockTitle(block.type)}</div>
                  <div className="builder-block-fields">{block.fields.map(field => <label key={field.path.join('.')}><span>{field.name.replace(/_/g, ' ').toLowerCase()}</span><input aria-label={field.name + ' in ' + blockTitle(block.type)} disabled={running} value={field.value} onChange={event => changeField(field.path, event.target.value)} /></label>)}
                  <label className="builder-enabled"><input type="checkbox" disabled={running} checked={!block.disabled} onChange={event => { try { editXml(setBotBlockDisabled(xml, block.path, !event.target.checked)); } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not change block.'); } }} />Enabled</label></div>
                </section>)}
                {analysis.valid && !visibleBlocks.length && <p>{search ? 'No matching blocks.' : 'No blocks found. Open XML source to inspect the bot.'}</p>}
                {!xml && <button type="button" className="builder-upload" onClick={() => inputRef.current?.click()}>Upload XML to display your bot blocks</button>}
              </div>
            </div>
          </>}

        </section>
        </div>
      </div>
    </div>
    <section className="mx-4 mb-44 rounded-xl border border-border p-4" aria-label="Bot session settings">
      <h2 className="font-semibold">Trading session</h2>
      <p className="mt-2 text-sm">{auth.activeAccount ? `Account: ${auth.activeAccount.account_type} · ${auth.activeAccountId} · ${auth.activeAccount.currency}` : 'Connect your Deriv account to trade.'}</p>
      <p className="mt-2 text-sm text-muted-foreground">Run places trades on this account. Start with a demo account. Each contract must settle before the next purchase. Stop prevents new purchases and waits for the open contract to settle.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Maximum trades (1–100)<input className={control + ' mt-1 w-full'} type="number" min="1" max="100" step="1" value={maxTrades} disabled={running} onChange={event => setMaxTrades(event.target.value)} /></label>
        <label className="text-sm">Maximum stake ({auth.activeAccount?.currency ?? 'account currency'})<input className={control + ' mt-1 w-full'} type="number" min="0.01" step="0.01" value={maxStake} disabled={running} onChange={event => setMaxStake(event.target.value)} /></label>
        <label className="text-sm">Session loss limit<input className={control + ' mt-1 w-full'} type="number" min="0.01" step="0.01" value={lossLimit} disabled={running} onChange={event => setLossLimit(event.target.value)} /></label>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">A purchase is blocked when its full stake could exceed the loss limit. Supported: digit contracts, 1–10 ticks, variables, arithmetic, comparisons, conditional purchases, win/loss checks, and Trade again. Tick indicators, sell rules, payout-based stakes, legacy XML and automatic error retries are not supported. Unsupported blocks are rejected before trading.</p>
      <p className="mt-3 text-sm">Trades: {progress.trades} · Session profit/loss: {progress.profit.toFixed(2)} {auth.activeAccount?.currency ?? ''} · <Link href="/reports" className="underline">Trade history</Link></p>
    </section>
    <div className="builder-runbar">
      {running ? <button type="button" onClick={() => { session.current?.abort(); setProgress(previous => ({ ...previous, message: 'Stopping. An open contract will still settle.' })); }}><Square size={23} />Stop</button> : <button type="button" disabled={!analysis.valid || busy || !isConnected || !auth.wsUrl} onClick={run}><Play size={23} />Run</button>}
      <button type="button" disabled={running || busy} onClick={() => { try { const program = compileBotXml(xml); setStatus(`Ready: ${program.preview.contract_type} on ${program.preview.symbol}, ${program.preview.duration} tick(s), stake ${program.preview.amount}. Review your account and limits before Run.`); } catch (error) { setStatus(error instanceof Error ? error.message : 'Invalid bot.'); } }}>Check bot</button>
      <div role="status" aria-live="polite"><strong>{running ? 'Bot session active' : 'Bot is not running'}</strong><small>{progress.message}</small></div>
    </div>
    <style>{`
      .builder-nav{display:flex;gap:0;overflow-x:auto;background:#172029;color:#d9e5eb;white-space:nowrap}
      .builder-nav a,.builder-nav>span{display:flex;align-items:center;gap:9px;padding:20px;font-weight:700}
      .builder-nav>span{background:#04180c;color:white}
      .builder-body{display:flex;gap:14px;min-width:0}
      .builder-tools{width:48px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;background:#eee8d7;padding:6px;border-radius:8px;align-self:flex-start;position:sticky;top:85px}
      .builder-tools button{display:flex;justify-content:center;padding:12px 0;border-radius:12px;background:#e3ddd0;color:#15354c}
      .builder-tools button:disabled{opacity:.35}
      .builder-canvas{min-height:520px;overflow:auto;background:#fff;padding:28px 18px 80px;color:#13202a}
      .builder-block{width:max-content;max-width:none;margin-bottom:3px;border:1px solid #bbb;position:relative}
      .builder-section{background:#085775;color:white;border-color:#174e63;border-radius:7px 7px 3px 3px;margin-top:30px;padding:12px 18px;min-width:340px}
      .builder-section:first-child{margin-top:0}
      .builder-setting{background:#e7e7e7;color:#18232c;padding:10px 12px;border-radius:5px;min-width:270px}
      .builder-setting:before{content:'';position:absolute;left:14px;top:-1px;width:22px;height:8px;background:white;clip-path:polygon(0 0,100% 0,70% 100%,30% 100%)}
      .builder-block-title{font-weight:600;margin-bottom:6px}
      .builder-block-fields{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .builder-block-fields label{display:flex;align-items:center;gap:8px;font-size:14px}
      .builder-block-fields input:not([type=checkbox]){background:white;color:#17212a;border:1px solid #b4b4b4;border-radius:24px;padding:7px 12px;max-width:230px;min-width:55px}
      .builder-enabled{font-size:11px!important;opacity:.75}
      .builder-disabled{opacity:.45}
      .builder-runbar{position:fixed;bottom:0;left:0;right:0;display:flex;gap:8px;align-items:center;padding:12px;background:#f7f4e9;color:#172029;border-top:1px solid #ddd;z-index:40}
      .builder-runbar>button{display:flex;gap:8px;align-items:center;background:#329d9b;color:white;padding:15px;border-radius:5px;font-weight:700}
      .builder-runbar>button:disabled{opacity:.5}
      .builder-runbar>div{flex:1;background:#edf7f0;border:1px solid #9dbfaf;border-radius:6px;padding:9px}
      .builder-runbar small{display:block;font-size:11px;margin-top:4px}
      @media(max-width:600px){.builder-tools{width:40px}.builder-body{gap:5px}.builder-canvas{padding:18px 8px 70px}.builder-runbar{padding:8px}.builder-runbar>button{padding:10px;font-size:12px}}
    `}</style>
  </main>;
}

