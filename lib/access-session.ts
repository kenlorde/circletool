export const ACCESS_COOKIE = 'circletool_access';
export async function verifyDerivToken(token: string): Promise<boolean> {
  if (!token || token.length > 8192) return false;
  const host = process.env.NEXT_PUBLIC_DERIV_ENV === 'preview' ? 'https://staging-api.derivws.com' : 'https://api.derivws.com';
  try {
    const response = await fetch(host + '/trading/v1/options/accounts', {
      headers: { Authorization: 'Bearer ' + token, 'Deriv-App-ID': process.env.NEXT_PUBLIC_DERIV_APP_ID ?? '' },
      cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data.data) && data.data.length > 0;
  } catch { return false; }
}
