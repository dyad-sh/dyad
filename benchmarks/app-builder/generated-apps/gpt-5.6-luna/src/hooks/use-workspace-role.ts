'use client';
import { useEffect, useState } from 'react';
export function useWorkspaceRole() { const [role,setRole]=useState<string>(''); useEffect(()=>{fetch('/api/me').then(r=>r.json()).then(data=>{const active=data.memberships?.find((m:{workspaceId:string})=>m.workspaceId===data.activeWorkspaceId);setRole(active?.role||'')});},[]); return { role, canWrite: role==='owner'||role==='member', isOwner: role==='owner' }; }
