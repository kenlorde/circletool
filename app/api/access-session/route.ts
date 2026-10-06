import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, verifyDerivToken } from '@/lib/access-session';
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  let token: unknown;
  try { token = (await request.json()).token; } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  if (typeof token !== 'string' || !(await verifyDerivToken(token))) return NextResponse.json({ error: 'Please log in to your Deriv account.' }, { status: 401 });
  const response = NextResponse.json({ authenticated: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(ACCESS_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 900 });
  return response;
}
export async function DELETE(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ACCESS_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
