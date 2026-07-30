import { auth } from '@/lib/auth/server';
export default auth.middleware({ loginUrl: '/auth/sign-in' });
export const config={matcher:['/','/contacts/:path*','/companies/:path*','/workspaces/:path*','/settings/:path*','/invites/:path*','/deals/:path*']};
