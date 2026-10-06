'use client';
import { useEffect, useRef, useState } from 'react';
import { Account, copyConnection, copyParameters, CopySocket } from '@/lib/copy-trading';

export function NewCopyTrading() {
  const [appId, setAppId] = useState(process.env.NEXT_PUBLIC_DERIV_APP_ID ?? '');
  const [followerToken, setFollowerToken] = useState('');
  const [traderToken, setTraderToken] = useState('');
  const [followers, setFollowers] = useState<Account[]>([]);
  const [traders, setTraders] = useState<Account[]>([]);
  const [followerId, setFollowerId] = useState('');
  const [traderId, setTraderId] = useState('');
  const [stake, setStake] = useState('1');
  const [budget, setBudget] = useState('10');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const session = useRef<{ generation: number; running: boolean; sockets: CopySocket[] }>({ generation: 0, running: false, sockets: [] });
  const log = (text: string) => setMessages(old => [text, ...old].slice(0, 20));
  const stop = () => {
    session.current.running = false; session.current.generation++;
    session.current.sockets.forEach(socket => socket.close()); session.current.sockets = [];
    setActive(false);
  };
  useEffect(() => {
    const hidden = () => { if (document.hidden && session.current.running) { stop(); log('Copying stopped because this page was backgrounded. Check history for any purchase already sent.'); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); session.current.running = false; session.current.generation++; session.current.sockets.forEach(s => s.close()); };
  }, []);

  async function loadAccounts() {
    setBusy(true); stop(); setFollowers([]); setTraders([]); setFollowerId(''); setTraderId('');
    try {
      const [f, t] = await Promise.all([copyConnection(appId.trim(), followerToken.trim()), copyConnection(appId.trim(), traderToken.trim())]);
      setFollowers(f.accounts); setTraders(t.accounts);
      // Require explicit account selection, especially for real accounts.
      log('Accounts verified. Select the trader and follower accounts.');
    } catch (error) { log(error instanceof Error ? error.message : 'Connection failed.'); }
    finally { setBusy(false); }
  }

  async function start() {
    const follower = followers.find(a => a.id === followerId), trader = traders.find(a => a.id === traderId);
    const limit = Number(stake), total = Number(budget);
    if (!follower || !trader) return log('Connect and select both accounts first.');
    if (follower.id === trader.id || follower.type !== trader.type || follower.currency !== trader.currency) return log('Select different accounts with matching currency and account type.');
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(total) || total < limit) return log('Set positive limits; session stake budget must cover one maximum stake.');
    stop(); const generation = session.current.generation;
    session.current.running = true; setBusy(true);
    const current = () => session.current.running && session.current.generation === generation;
    let spent = 0, purchasing = false;
    const seen = new Set<string>();
    try {
      const urls = await Promise.all([copyConnection(appId.trim(), followerToken.trim(), follower.id), copyConnection(appId.trim(), traderToken.trim(), trader.id)]);
      if (!current()) return;
      for (const result of urls) {
        const socket = await CopySocket.open(result.url);
        if (!current()) { socket.close(); return; }
        session.current.sockets.push(socket);
      }
      const [followerSocket, traderSocket] = session.current.sockets;
      const fail = () => { if (current()) { stop(); log('Connection lost. Copying stopped. Check account history before restarting.'); } };
      followerSocket.onDisconnect = traderSocket.onDisconnect = fail;
      // Confirm that both authenticated sessions accept account commands.
      await followerSocket.request({ balance: 1 });
      traderSocket.onPacket = packet => {
        if (!current()) return;
        if (packet.error) { stop(); log('Trader stream rejected by Deriv. Copying stopped.'); return; }
        const tx = packet.transaction;
        if (!tx || tx.action !== 'buy' || !tx.contract_id) return;
        const id = String(tx.contract_id);
        if (seen.has(id)) return;
        seen.add(id);
        if (seen.size > 10000) { stop(); log('Session event limit reached. Copying stopped.'); return; }
        if (purchasing) { log(`Trader contract ${id} skipped: another copy is in progress.`); return; }
        purchasing = true;
        void (async () => {
          let sent = false;
          try {
            const details = await traderSocket.request({ proposal_open_contract: 1, contract_id: Number(id) });
            if (!current()) return;
            const parameters = copyParameters(details.proposal_open_contract ?? {}, follower.currency, limit);
            if (spent + parameters.amount > total + 1e-8) { stop(); log('Session stake budget reached. Copying stopped.'); return; }
            const quote = await followerSocket.request({ proposal: 1, ...parameters });
            if (!current()) return;
            const price = Number(quote.proposal?.ask_price);
            if (!quote.proposal?.id || !Number.isFinite(price) || price <= 0 || price > limit || Math.abs(price - parameters.amount) > 1e-8) throw Error('Quote exceeds the allowed stake or does not match the requested amount.');
            if (Date.now() / 1000 - Number(details.proposal_open_contract.purchase_time) > 10) throw Error('Quote arrived too late; copy skipped.');
            spent += price; sent = true;
            const receipt = await followerSocket.request({ buy: quote.proposal.id, price });
            if (!receipt.buy?.contract_id) throw Error('Purchase confirmation missing.');
            log(`Deriv confirmed copied contract ${receipt.buy.contract_id}. Stake ${price} ${follower.currency}; session stake ${spent.toFixed(2)} / ${total}. Check this follower account’s history for settlement.`);
          } catch (error) {
            if (sent) { if (current()) stop(); log('Purchase result is uncertain. Copying stopped; check follower history before restarting. No automatic retry.'); }
            else if (current()) log(error instanceof Error ? error.message : 'Copy skipped.');
          } finally { purchasing = false; }
        })();
      };
      await traderSocket.request({ transaction: 1, subscribe: 1 });
      if (current()) { setActive(true); log(`Connected: copying future supported trades from ${trader.id} to ${follower.id} (${follower.type}).`); }
    } catch (error) { if (current()) { stop(); log(error instanceof Error ? error.message : 'Could not start copying.'); } }
    finally { setBusy(false); }
  }

  const locked = busy || active;
  const invalidate = () => { setFollowers([]); setTraders([]); setFollowerId(''); setTraderId(''); };
  return <section className="copy-trading-panel">
    <h1>Copy Trading</h1>
    <p>Connect your new Deriv App ID. Copies future digit and barrier-free Rise/Fall purchases while this page stays open. Entries and results can differ from the trader’s.</p>
    <div className="copy-trading-fields">
      <label hidden style={{ display: 'none' }}>Deriv App ID<input disabled={locked} value={appId} autoComplete="off" spellCheck={false} onChange={e => { setAppId(e.target.value); invalidate(); }} placeholder="Your registered App ID (letters and numbers)" /></label>
      <label>Your follower personal access token<input disabled={locked} type="password" autoComplete="off" value={followerToken} onChange={e => { setFollowerToken(e.target.value); invalidate(); }} placeholder="New-platform token with trade scope" /></label>
      <label>Trader’s authorised personal access token<input disabled={locked} type="password" autoComplete="off" value={traderToken} onChange={e => { setTraderToken(e.target.value); invalidate(); }} placeholder="New-platform token with trade scope" /></label>
      <p>The new authenticated trader connection requires trade scope. Only use a trader account whose owner authorises this access. Circletool sends purchases only through the follower connection.</p>
      <button disabled={locked} type="button" onClick={loadAccounts}>Connect accounts</button>
      <label>Follower account<select disabled={locked} value={followerId} onChange={e => setFollowerId(e.target.value)}><option value="">Select account</option>{followers.map(a => <option key={a.id} value={a.id}>{a.id} · {a.type} · {a.currency}</option>)}</select></label>
      <label>Trader account<select disabled={locked} value={traderId} onChange={e => setTraderId(e.target.value)}><option value="">Select account</option>{traders.map(a => <option key={a.id} value={a.id}>{a.id} · {a.type} · {a.currency}</option>)}</select></label>
      <label>Maximum stake per copy<input disabled={locked} type="number" min="0.01" step="0.01" value={stake} onChange={e => setStake(e.target.value)} /></label>
      <label>Total session stake budget<input disabled={locked} type="number" min="0.01" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} /></label>
    </div>
    <div className="copy-trading-actions"><button disabled={locked || !followerId || !traderId} onClick={start}>Start copying</button><button onClick={() => { stop(); log('Stopped new copies. Purchases already sent and open contracts may still finish.'); }}>Stop copying</button></div>
    <p role="status">{active ? 'Connected — waiting for the trader’s next supported purchase.' : busy ? 'Connecting…' : 'Copying stopped.'}</p>
    <ul aria-live="polite">{messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
    <p className="copy-trading-footnote">Test with two demo accounts first. Reloading, leaving this page or backgrounding your iPhone stops new copies. Early closes and contract changes are not copied. Unsupported or stale entries are skipped. Tokens are not saved and are used only for Deriv authentication. Session budget limits total stakes, not net losses. No MT5 trades are copied.</p>
  </section>;
}
