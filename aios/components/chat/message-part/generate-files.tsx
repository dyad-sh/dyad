import type { DataPart } from '@/ai/messages/data-parts'
import { CloudUploadIcon } from 'lucide-react'
import { TaskCard, TaskCheck, TaskError, TaskSpinner, type TaskStatus } from '../task-card'

export function GenerateFiles({ message, className }: {
  className?: string
  message: DataPart['generating-files']
}) {
  const isActive = ['generating', 'uploading'].includes(message.status)
  const isError = message.status === 'error'
  const isDone = message.status === 'done'

  const status: TaskStatus = isActive ? 'loading' : isDone ? 'done' : 'error'

  const doneFiles = isActive
    ? message.paths.slice(0, -1)
    : message.paths

  const activeFile = isActive
    ? message.paths[message.paths.length - 1] ?? null
    : null

  const total = message.paths.length
  const done = doneFiles.length

  const badge = isDone
    ? `${total} FILES`
    : isError
    ? 'ERROR'
    : `${done}/${total || '…'}`

  return (
    <TaskCard
      status={status}
      icon={<CloudUploadIcon className="w-3.5 h-3.5" />}
      title={isDone ? 'Files Uploaded' : 'Generating Files'}
      badge={badge}
      className={className}
    >
      <div className="space-y-0.5 mt-0.5">
        {doneFiles.map((path, i) => (
          <div key={i} className="flex items-center gap-1.5 task-file-row" style={{ animationDelay: `${i * 40}ms` }}>
            <TaskCheck />
            <span className="text-emerald-400/80 text-xs truncate">{path}</span>
          </div>
        ))}
        {activeFile && (
          <div className="flex items-center gap-1.5">
            {isError ? <TaskError /> : <TaskSpinner />}
            <span className={`text-xs truncate ${isError ? 'text-red-400/80' : 'text-cyan-300/80'}`}>
              {activeFile}
              {!isError && <span className="task-cursor ml-0.5" />}
            </span>
          </div>
        )}
      </div>
    </TaskCard>
  )
}
