import type { Command, CommandLog } from './types'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import z from 'zod/v3'

interface Props {
  command: Command
  onLog: (data: { sandboxId: string; cmdId: string; log: CommandLog }) => void
  onCompleted: (data: Command) => void
}

export function CommandLogs({ command, onLog, onCompleted }: Props) {
  const ref = useRef<Awaited<ReturnType<typeof getCommandLogs>>>(null)

  useEffect(() => {
    if (!ref.current) {
      const iterator = getCommandLogs(command.sandboxId, command.cmdId)
      ref.current = iterator
      ;(async () => {
        for await (const log of iterator) {
          onLog({
            sandboxId: command.sandboxId,
            cmdId: command.cmdId,
            log,
          })
        }

        const log = await getCommand(command.sandboxId, command.cmdId)
        onCompleted({
          sandboxId: log.sandboxId,
          cmdId: log.cmdId,
          startedAt: log.startedAt,
          exitCode: log.exitCode ?? 0,
          command: command.command,
          args: command.args,
        })
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <pre className={cn('whitespace-pre-wrap font-mono text-sm', {})}>
      {logContent(command)}
    </pre>
  )
}

function logContent(command: Command) {
  const date = new Date(command.startedAt).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const line = `${command.command} ${command.args.join(' ')}`
  const body = command.logs?.map((log) => log.data).join('') || ''
  return `[${date}] ${line}\n${body}`
}

const logSchema = z.object({
  data: z.string(),
  stream: z.enum(['stdout', 'stderr']),
  timestamp: z.number(),
})

async function* getCommandLogs(sandboxId: string, cmdId: string) {
  const response = await fetch(
    `/api/sandboxes/${sandboxId}/cmds/${cmdId}/logs`,
    { headers: { 'Content-Type': 'application/json' } }
  )

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let line = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    line += decoder.decode(value, { stream: true })
    const lines = line.split('\n')
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i]) {
        const logEntry = JSON.parse(lines[i])
        yield logSchema.parse(logEntry)
      }
    }
    line = lines[lines.length - 1]
  }
}

const cmdSchema = z.object({
  sandboxId: z.string(),
  cmdId: z.string(),
  startedAt: z.number(),
  exitCode: z.number().optional(),
})

async function getCommand(sandboxId: string, cmdId: string) {
  const response = await fetch(`/api/sandboxes/${sandboxId}/cmds/${cmdId}`)
  const json = await response.json()
  return cmdSchema.parse(json)
}
