import type { DataPart } from '@/ai/messages/data-parts'
import { SquareChevronRightIcon } from 'lucide-react'
import { TaskCard, TaskCheck, TaskError, TaskSpinner, type TaskStatus } from '../task-card'
import { Streamdown } from 'streamdown'

export function RunCommand({ message }: { message: DataPart['run-command'] }) {
  const isActive = message.status === 'executing' || message.status === 'waiting'
  const isBackground = message.status === 'running'
  const isError = message.status === 'error' || (message.status === 'done' && (message.exitCode ?? 0) > 0)
  const isDone = message.status === 'done' && !isError

  const status: TaskStatus =
    isBackground ? 'running'
    : isActive ? 'loading'
    : isDone ? 'done'
    : 'error'

  const badge =
    isActive ? 'EXECUTING'
    : isBackground ? 'BACKGROUND'
    : isDone ? 'DONE'
    : 'ERROR'

  const cmd = `${message.command} ${message.args.join(' ')}`

  return (
    <TaskCard status={status} icon={<SquareChevronRightIcon className="w-3.5 h-3.5" />} title="Run Command" badge={badge}>
      <div className="flex items-start gap-2 mt-0.5">
        {isActive    && <TaskSpinner />}
        {isBackground && <TaskSpinner />}
        {isDone      && <TaskCheck />}
        {isError     && <TaskError />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-cyan-300/70 text-xs mb-0.5">
            <span className="text-cyan-500">$</span>
            <code className="break-all">{cmd}</code>
            {isActive && <span className="task-cursor" />}
          </div>
          {isBackground && (
            <div className="text-purple-400/70 text-xs flex items-center gap-1.5">
              <span className="task-dot task-dot-purple" />
              Running in background
            </div>
          )}
          {isError && message.exitCode != null && (
            <div className="text-red-400/80 text-xs mt-0.5">exit code {message.exitCode}</div>
          )}
        </div>
      </div>
    </TaskCard>
  )
}
