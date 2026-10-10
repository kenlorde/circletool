'use client';

import { useState } from 'react';
import { NewCopyTrading } from './new-copy-trading';

type CopyAction = 'copy_start' | 'copy_stop';

/** The legacy Options copy API attaches the relationship on Deriv's side. */
function sendCopyCommand(appId: string, followerToken: string, traderToken: string, action: CopyAction, maxStake: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`);
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error('Deriv did not respond in time.')), 20000);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      socket.close();
      if (error) reject(error); else resolve();
    }
    socket.onopen = () => socket.send(JSON.stringify({ authorize: followerToken, req_id: 1 }));
    socket.onerror = () => finish(new Error('Could not connect to Deriv’s copy trading API.'));
    socket.onclose = () => { if (!settled) finish(new Error('Deriv closed the connection.')); };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { req_id?: number; error?: { message?: string }; msg_type?: string; authorize?: { is_virtual?: number | boolean } };
        if (data.error) {
          const message = data.error.message ?? 'Deriv rejected the request.';
          finish(new Error(message.split(followerToken).join('[hidden]').split(traderToken).join('[hidden]')));
          return;
        }
        if (data.req_id === 1 && data.msg_type === 'authorize') {
          if (action === 'copy_start' && data.authorize?.is_virtual !== 0 && data.authorize?.is_virtual !== false) { finish(new Error('Automated copying requires a verified real account. Demo accounts are not supported.')); return; }
          socket.send(JSON.stringify({ [action]: traderToken, ...(action === 'copy_start' ? { max_trade_stake: maxStake } : {}), req_id: 2 }));
        } else if (data.req_id === 2 && data.msg_type === action) {
          finish();
        }
      } catch {
        finish(new Error('Deriv returned an unexpected response.'));
      }
    };
  });
}

function LegacyCopyTradingPanel() {
  const [appId, setAppId] = useState(/^\d+$/.test(process.env.NEXT_PUBLIC_DERIV_APP_ID ?? '') ? process.env.NEXT_PUBLIC_DERIV_APP_ID! : '');
  const [followerToken, setFollowerToken] = useState('');
  const [traderToken, setTraderToken] = useState('');
  const [maxStake, setMaxStake] = useState('1');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [active, setActive] = useState(false);

  async function run(action: CopyAction) {
    setMessage('');
    if (!/^\d+$/.test(appId.trim()) || !followerToken.trim() || !traderToken.trim()) {
      setMessage('Enter the app ID and both API tokens.');
      return;
    }
    const limit = Number(maxStake);
    if (action === 'copy_start' && (!Number.isFinite(limit) || limit <= 0)) {
      setMessage('Set a maximum stake greater than zero.');
      return;
    }
    setBusy(true);
    try {
      await sendCopyCommand(appId.trim(), followerToken.trim(), traderToken.trim(), action, limit);
      setActive(action === 'copy_start');
      setMessage(action === 'copy_start' ? 'Deriv confirmed copying is active for this trader.' : 'Deriv confirmed copying has stopped for this trader.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Copy trading request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="copy-trading-panel">
      <h1>Copy Trading</h1>
      <p>Copy a trader’s future Options trades automatically through Deriv. The trader must enable copiers and give you a <strong>read-only token</strong>. Use your own <strong>trade-enabled token</strong> for the account that will copy.</p>
      <div className="copy-trading-fields">
        <label hidden style={{ display: 'none' }}>Legacy Deriv app ID<input inputMode="numeric" autoComplete="off" value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="Your registered numeric app ID" /></label>
        <label>Your follower account API token<input type="password" autoComplete="off" spellCheck={false} value={followerToken} onChange={(event) => setFollowerToken(event.target.value)} placeholder="Token with trade scope" /></label>
        <label>Trader’s read-only API token<input type="password" autoComplete="off" spellCheck={false} value={traderToken} onChange={(event) => setTraderToken(event.target.value)} placeholder="Token shared by the trader" /></label>
        <label>Maximum stake per copied trade (account currency)<input type="number" inputMode="decimal" min="0.01" step="0.01" value={maxStake} onChange={(event) => setMaxStake(event.target.value)} /></label>
      </div>
      <div className="copy-trading-actions">
        <button type="button" disabled={busy} onClick={() => run('copy_start')}>Start copying</button>
        <button type="button" disabled={busy} onClick={() => run('copy_stop')}>Stop copying</button>
      </div>
      {message && <p className="copy-trading-status" role="status">{message}</p>}
      {active && <p className="copy-trading-active">Copying enabled on Deriv. Use Stop copying to end future copies.</p>}
      <p className="copy-trading-footnote">Tokens stay in this browser tab’s memory and are sent directly to Deriv over an encrypted WebSocket when you press Start or Stop. Reloading clears the fields; Deriv may continue copying until you stop it with the same trader token. This legacy Options API does not copy MT5 trades. A numeric legacy app ID and eligible Deriv accounts are required.</p>
    </section>
  );
}

export function CopyTradingPanel() {
  const [mode, setMode] = useState('new');
  return <><div className="copy-trading-actions"><button onClick={() => setMode('new')} disabled={mode === 'new'}>New App ID</button><button onClick={() => setMode('legacy')} disabled={mode === 'legacy'}>Legacy numeric App ID</button></div>{mode === 'new' ? <NewCopyTrading /> : <LegacyCopyTradingPanel />}</>;
}
