import { auth } from '@/lib/auth/server';

export default auth.middleware({
  loginUrl: '/auth/sign-in',
});

export const config = {
  matcher: [
    '/contacts/:path*',
    '/companies/:path*',
    '/deals/:path*',
    '/workspaces/:path*',
    '/settings/:path*',
    '/invites/:path*',
  ],
};
