import { auth } from '@/lib/auth/server';

export default auth.middleware({ loginUrl: '/auth/sign-in' });

export const config = {
  matcher: ['/((?!api|auth/sign-in|auth/sign-up|_next/static|_next/image|favicon.ico).*)'],
};
