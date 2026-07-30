'use client';
import { useRouter } from 'next/navigation';
export function CompanyDeleteButton({ id }: { id: string }) { const router = useRouter(); return <button onClick={async () => { if (window.confirm('Delete this company?')) { await fetch(`/api/companies/${id}`, { method: 'DELETE' }); router.push('/companies'); router.refresh(); } }} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Delete company</button>; }
