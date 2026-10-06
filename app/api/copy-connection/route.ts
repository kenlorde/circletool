import { NextRequest, NextResponse } from 'next/server';

// Fixed upstream paths only. Credentials are never stored or returned.
export async function POST(request: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.headers.get('origin') !== request.nextUrl.origin) return reply({ error: 'Forbidden' }, 403);
  try {
    const { appId, token, accountId } = await request.json();
    if (typeof appId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(appId) || typeof token !== 'string' || !token || token.length > 8192 || /[\r\n]/.test(token)) return reply({ error: 'Enter a valid App ID and token.' }, 400);
    if (accountId !== undefined && (typeof accountId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId))) return reply({ error: 'Invalid account ID.' }, 400);
    const upstream = await fetch('https://api.derivws.com/trading/v1/options/accounts' + (accountId ? `/${encodeURIComponent(accountId)}/otp` : ''), {
      method: accountId ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Deriv-App-ID': appId },
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) return reply({ error: `Deriv rejected the connection (${upstream.status}). Check App ID, token trade scope and account access.` }, upstream.status);
    const body = await upstream.json();
    if (accountId) {
      const url = new URL(body.data?.url);
      if (url.protocol !== 'wss:' || url.hostname !== 'api.derivws.com' || !/^\/trading\/v1\/options\/ws\/(real|demo)$/.test(url.pathname)) throw Error('Invalid WebSocket URL');
      return reply({ url: url.toString() });
    }
    if (!Array.isArray(body.data)) throw Error('Invalid account response');
    return reply({ accounts: body.data.filter((a: { status: string }) => a.status === 'active').map((a: { account_id: string; currency: string; account_type: string }) => ({ id: a.account_id, currency: a.currency, type: a.account_type })) });
  } catch { return reply({ error: 'Could not establish the Deriv connection. No trade was placed.' }, 502); }
}
