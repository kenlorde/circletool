import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  // Only this site's browser may submit a token exchange.
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'invalid_origin' }, { status: 403, headers });
  }
  const params = new URLSearchParams(await request.text());
  const clientId = process.env.NEXT_PUBLIC_DERIV_APP_ID ?? '';
  const redirectUri = process.env.NEXT_PUBLIC_DERIV_REDIRECT_URI ?? '';
  const grant = params.get('grant_type');
  if (!clientId || params.get('client_id') !== clientId ||
      (grant !== 'authorization_code' && grant !== 'refresh_token')) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers });
  }
  const body = new URLSearchParams({ grant_type: grant, client_id: clientId });
  if (grant === 'authorization_code') {
    const code = params.get('code') ?? '';
    const verifier = params.get('code_verifier') ?? '';
    if (!code || code.length > 8192 || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
        params.get('redirect_uri') !== redirectUri) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers });
    }
    body.set('code', code);
    body.set('code_verifier', verifier);
    body.set('redirect_uri', redirectUri);
  } else {
    const refreshToken = params.get('refresh_token') ?? '';
    if (!refreshToken || refreshToken.length > 8192) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers });
    }
    body.set('refresh_token', refreshToken);
  }
  const authHost = process.env.NEXT_PUBLIC_DERIV_ENV === 'preview'
    ? 'https://staging-auth.deriv.com' : 'https://auth.deriv.com';
  try {
    const response = await fetch(authHost + '/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'token_exchange_failed' }, { status: response.status, headers });
    }
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !data.access_token) {
      return NextResponse.json({ error: 'invalid_token_response' }, { status: 502, headers });
    }
    return NextResponse.json(data, { headers });
  } catch {
    return NextResponse.json({ error: 'deriv_connection_failed' }, { status: 502, headers });
  }
}
