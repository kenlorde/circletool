'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FileCode2, FolderOpen, Save, Upload } from 'lucide-react';
import { Header } from '@/components/custom/header';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { MAX_BOT_BYTES, botBlocks, botFilename, parseBotXml, setBotBlockDisabled, updateBotField } from '@/lib/bot-xml';

interface SavedBot { id: string; name: string; xml: string; updatedAt: string }
const STORAGE_KEY = 'circletool.bot-library.v1';
const control = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';
const button = `${control} inline-flex items-center justify-center gap-2 disabled:opacity-40`;
export function BotWorkspace() {
  const { auth } = useDerivWSContext();
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
  const canReplace = () => !dirty || window.confirm('This bot has unsaved changes. Replace it? Download or save it first if you want to keep them.');
  async function upload(file: File | undefined) {
    if (!file || busy || !canReplace()) return;
    setBusy(true); setStatus('');
    try {
      if (!/\.xml$/i.test(file.name)) throw new Error('Choose a bot file ending in .xml.');
      if (file.size > MAX_BOT_BYTES) throw new Error('Choose an XML file smaller than 2 MB.');
      const source = await file.text();
      parseBotXml(source);
      setXml(source); setName(botFilename(file.name)); setId(null); setSavedSnapshot(''); setTab('fields'); setSearch('');
      setStatus('Bot uploaded. Edit its fields or XML, then save or download your changes.');
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
    setXml(bot.xml); setName(bot.name); setId(bot.id); setSavedSnapshot(JSON.stringify([bot.name, bot.xml])); setTab('fields'); setSearch(''); setStatus('Saved bot opened.');
  }
  function changeField(path: number[], value: string) {
    try { setXml(updateBotField(xml, path, value)); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not edit field.'); }
  }
  const visibleBlocks = analysis.blocks.filter(block => `${block.type} ${block.fields.map(field => `${field.name} ${field.value}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()));

  return <main className="h-dvh overflow-y-auto bg-background text-foreground lg:h-auto lg:min-h-screen">
    <Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={auth.login} onSignUp={auth.signUp} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} appName="Circletool" />
    <div className="h-[76px] shrink-0" />
    <div className="mx-auto w-full max-w-6xl px-4 py-5 pb-16">
      <Link href="/dashboard" className="text-sm underline">← Dashboard</Link>
      <div className="my-5 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Bot workspace</h1><p className="mt-2 text-sm text-muted-foreground">Upload, edit, and download your XML bots inside Circletool.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{dirty ? 'Unsaved changes' : xml ? 'Saved' : 'XML editor'}</span></div>
      <section id="upload" className="mb-5 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-5" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); upload(event.dataTransfer.files[0]); }} aria-label="Upload XML bot">
        <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><FolderOpen className="text-primary" size={30} aria-hidden /><div><h2 className="font-semibold">Upload your bot</h2><p className="text-sm text-muted-foreground">Choose an XML file from Files, or drag it here. Up to 2 MB.</p></div></div><button className={button} type="button" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={17} aria-hidden />{busy ? 'Reading…' : 'Choose XML file'}</button></div>
        <input ref={inputRef} type="file" accept=".xml,application/xml,text/xml" className="sr-only" aria-label="Choose XML bot file" onChange={event => upload(event.target.files?.[0])} />
      </section>
      {status && <p role="status" className="mb-4 rounded-lg border border-border p-3 text-sm">{status}</p>}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border p-4"><h2 className="font-semibold">My saved bots</h2><p className="mt-1 text-xs text-muted-foreground">Stored in this browser on this device. Download a copy to move it elsewhere.</p><div className="mt-4 flex flex-col gap-3">{library.length ? library.map(bot => <div key={bot.id} className={`rounded-lg border p-3 ${id === bot.id ? 'border-primary' : 'border-border'}`}><button type="button" className="w-full break-words text-left text-sm font-medium underline" onClick={() => open(bot)}>{bot.name}</button><p className="mt-1 text-xs text-muted-foreground">{new Date(bot.updatedAt).toLocaleDateString()}</p><button className="mt-2 text-xs text-destructive underline" type="button" onClick={() => { if (window.confirm(`Remove ${bot.name} from this device?`) && persist(library.filter(item => item.id !== bot.id))) { if (id === bot.id) { setId(null); setSavedSnapshot(''); } setStatus('Saved copy removed.'); } }}>Remove saved copy</button></div>) : <p className="text-sm text-muted-foreground">Upload a bot and tap Save on device to add it here.</p>}</div></aside>
        <section className="min-w-0 rounded-xl border border-border p-4" aria-label="Bot editor">
          <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">Bot filename<input className={`${control} mt-1 w-full`} maxLength={110} value={name} onChange={event => setName(event.target.value)} /></label><button type="button" className={button} disabled={!analysis.valid || busy} onClick={save}><Save size={16} aria-hidden />Save on device</button><button type="button" className={button} disabled={!analysis.valid || busy} onClick={download}><Download size={16} aria-hidden />Download XML</button></div>
          <div className="my-4 flex flex-wrap gap-2" role="group" aria-label="Editor view"><button type="button" className={`${button} ${tab === 'fields' ? 'border-primary bg-primary/10' : ''}`} aria-pressed={tab === 'fields'} onClick={() => setTab('fields')}>Bot fields</button><button type="button" className={`${button} ${tab === 'source' ? 'border-primary bg-primary/10' : ''}`} aria-pressed={tab === 'source'} onClick={() => setTab('source')}><FileCode2 size={16} aria-hidden />XML source</button></div>
          {analysis.error && <p role="alert" className="mb-4 text-sm text-destructive">{analysis.error}</p>}
          {!xml ? <div className="py-16 text-center text-muted-foreground"><FileCode2 size={38} className="mx-auto mb-3" aria-hidden /><p>Your bot will appear here after upload.</p></div> : tab === 'source' ? <><label className="text-sm" htmlFor="bot-xml-source">Full bot XML</label><textarea id="bot-xml-source" className={`${control} mt-2 min-h-[440px] w-full resize-y font-mono text-xs leading-6`} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={xml} onChange={event => setXml(event.target.value)} /><p className="mt-2 text-xs text-muted-foreground">Edit blocks, variables, and connections here. Only valid XML can be saved or downloaded.</p></> : <>
            <label className="text-sm">Find a block or setting<input type="search" className={`${control} my-2 w-full`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Stake, duration, prediction, NUM…" /></label>
            <p className="mb-4 text-xs text-muted-foreground">{analysis.blocks.length} blocks · Edit values below. Keep dropdown values and variable names consistent with your bot. Use XML source to change the block structure.</p>
            <div className="flex flex-col gap-3">{visibleBlocks.map((block, index) => <details key={block.path.join('.')} open={block.fields.length > 0} className="rounded-lg border border-border bg-muted/20 p-3" style={{ marginLeft: Math.min(block.depth, 3) * 8 }}><summary className="cursor-pointer break-words text-sm font-semibold">{index + 1}. {block.type.replace(/_/g, ' ')}{block.disabled ? ' · disabled' : ''}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{block.fields.map(field => <label key={field.path.join('.')} className="min-w-0 text-xs text-muted-foreground">{field.name}<input className={`${control} mt-1 w-full`} value={field.value} onChange={event => changeField(field.path, event.target.value)} /></label>)}</div>{block.fields.length === 0 && <p className="mt-2 text-xs text-muted-foreground">This block’s values are in its connected blocks or XML attributes.</p>}<label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={!block.disabled} onChange={event => { try { setXml(setBotBlockDisabled(xml, block.path, !event.target.checked)); } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not change this block.'); } }} />Block enabled</label></details>)}{analysis.valid && !visibleBlocks.length && <p className="text-sm text-muted-foreground">{search ? 'No matching blocks.' : 'No blocks found. You can edit the complete XML in XML source.'}</p>}</div>
          </>}
          {xml && <p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">This workspace edits XML; it does not run imported bots. Saving checks XML structure, not whether the trading strategy is valid.</p>}
        </section>
      </div>
    </div>
  </main>;
}
