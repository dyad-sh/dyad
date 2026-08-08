import type { DataPart } from '@/ai/messages/data-parts'
import { BoxIcon } from 'lucide-react'
import { TaskCard, TaskCheck, TaskError, TaskSpinner } from '../task-card'

export function CreateSandbox({ message }: { message: DataPart['create-sandbox'] }) {
  const status =
    message.status === 'done' ? 'done'
    : message.status === 'error' ? 'error'
    : 'loading'

  const badge =
    status === 'loading' ? 'INITIALIZING'
    : status === 'done' ? 'READY'
    : 'FAILED'

  const label =
    status === 'loading' ? 'Initializing sandbox environment…'
    : status === 'done' ? 'Sandbox environment ready'
    : 'Failed to initialize sandbox'

  return (
    <TaskCard status={status} icon={<BoxIcon className="w-3.5 h-3.5" />} title="Create Sandbox" badge={badge}>
      <div className="flex items-center gap-2 mt-0.5">
        {status === 'loading' && <TaskSpinner />}
        {status === 'done'    && <TaskCheck />}
        {status === 'error'   && <TaskError />}
        <span>{label}</span>
      </div>
    </TaskCard>
  )
}
