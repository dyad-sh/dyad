'use client'

import { CommandsLogs } from '@/components/commands-logs/commands-logs'
import { useSandboxStore } from './state'

export function Logs(props: { className?: string }) {
  const { commands } = useSandboxStore()
  return <CommandsLogs className={props.className} commands={commands} />
}
