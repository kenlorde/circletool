import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, verifyDerivToken } from '@/lib/access-session';
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/login' || (path === '/' && request.nextUrl.searchParams.has('code') && request.nextUrl.searchParams.has('state'))) return NextResponse.next();
  if (await verifyDerivToken(request.cookies.get(ACCESS_COOKIE)?.value ?? '')) {
    const response = NextResponse.next();
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  const url = new URL('/login', request.url);
  url.searchParams.set('next', path + request.nextUrl.search);
  const response = NextResponse.redirect(url);
  response.cookies.delete(ACCESS_COOKIE);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export const config = { matcher: ['/', '/dashboard/:path*', '/bot-editor/:path*', '/smart-ai/:path*', '/copy-trading/:path*', '/charts/:path*', '/reports/:path*', '/tick-analysis/:path*', '/gold-signals/:path*'] };
