'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ContactForm } from '@/components/contact-form';
export default function EditContactPage({params}:{params:Promise<{id:string}>}){const [id,setId]=useState('');const [contact,setContact]=useState<any>();useEffect(()=>{params.then(p=>{setId(p.id);fetch(`/api/contacts/${p.id}`).then(r=>r.json()).then(setContact)})},[params]);if(!contact)return <main className="mx-auto max-w-6xl px-6 py-10"><p>Loading contact…</p></main>;return <main className="mx-auto max-w-6xl px-6 py-10"><Link href={`/contacts/${id}`} className="text-sm text-indigo-600 hover:underline">← Back to contact</Link><h1 className="mb-6 mt-5 text-3xl font-semibold">Edit contact</h1><ContactForm contact={contact} id={id}/></main>}
