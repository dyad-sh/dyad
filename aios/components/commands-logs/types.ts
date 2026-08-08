export interface Command {
  background?: boolean
  sandboxId: string
  cmdId: string
  startedAt: number
  command: string
  args: string[]
  exitCode?: number
  logs?: CommandLog[]
}

export interface CommandLog {
  data: string
  stream: 'stdout' | 'stderr'
  timestamp: number
}
