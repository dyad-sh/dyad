import type { DataPart } from '@/ai/messages/data-parts'
import { Link2Icon, ExternalLinkIcon } from 'lucide-react'
import { TaskCard, TaskCheck, TaskSpinner } from '../task-card'

export function GetSandboxURL({ message }: { message: DataPart['get-sandbox-url'] }) {
  const isLoading = message.status === 'loading'
  const status = isLoading ? 'loading' : 'done'

  return (
    <TaskCard
      status={status}
      icon={<Link2Icon className="w-3.5 h-3.5" />}
      title="Sandbox URL"
      badge={isLoading ? 'RESOLVING' : 'LIVE'}
    >
      <div className="flex items-center gap-2 mt-0.5">
        {isLoading ? <TaskSpinner /> : <TaskCheck />}
        {message.url ? (
          <a
            href={message.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-cyan-300 hover:text-cyan-200 transition-colors text-xs break-all group"
          >
            <span className="underline underline-offset-2 decoration-cyan-500/40 group-hover:decoration-cyan-400">
              {message.url}
            </span>
            <ExternalLinkIcon className="w-3 h-3 flex-shrink-0 opacity-60" />
          </a>
        ) : (
          <span className="text-xs text-slate-500">Resolving sandbox URL…</span>
        )}
      </div>
    </TaskCard>
  )
}
