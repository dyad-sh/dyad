import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  redirect((await getCurrentUser()) ? '/contacts' : '/auth/sign-in');
}
