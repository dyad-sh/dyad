'use client'

import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type TaskStatus = 'loading' | 'running' | 'done' | 'error'

const STATUS_META: Record<TaskStatus, {
  card: string
  accent: string
  scan: string
  icon: string
  badge: string
  dot: string
}> = {
  loading: {
    card: 'task-card-loading',
    accent: 'task-accent-loading',
    scan: 'task-scanline',
    icon: 'task-icon-cyan',
    badge: 'task-badge-cyan',
    dot: 'task-dot-cyan',
  },
  running: {
    card: 'task-card-running',
    accent: 'task-accent-running',
    scan: 'task-scanline task-scanline-purple',
    icon: 'task-icon-purple',
    badge: 'task-badge-purple',
    dot: 'task-dot-purple',
  },
  done: {
    card: 'task-card-done',
    accent: 'task-accent-done',
    scan: '',
    icon: 'task-icon-green',
    badge: 'task-badge-green',
    dot: 'task-dot-green',
  },
  error: {
    card: 'task-card-error',
    accent: 'task-accent-error',
    scan: '',
    icon: 'task-icon-red',
    badge: 'task-badge-red',
    dot: 'task-dot-red',
  },
}

const BADGE_LABELS: Record<string, Record<TaskStatus, string>> = {}

interface Props {
  status: TaskStatus
  icon: ReactNode
  title: string
  badge: string
  children: ReactNode
  className?: string
}

export function TaskCard({ status, icon, title, badge, children, className }: Props) {
  const m = STATUS_META[status]
  const isActive = status === 'loading' || status === 'running'

  return (
    <div className={cn('task-card', m.card, className)}>
      {isActive && <div className={m.scan} />}
      <div className={cn('task-accent', m.accent)} />
      <div className="task-body">
        <div className="task-header">
          <span className={cn('task-header-icon', m.icon)}>{icon}</span>
          <span className="task-title">{title}</span>
          <span className={cn('task-badge ml-auto', m.badge)}>
            <span className={cn('task-dot', m.dot)} />
            {badge}
          </span>
        </div>
        <div className="task-content">{children}</div>
      </div>
    </div>
  )
}

export function TaskSpinner() {
  return (
    <span className="task-spinner flex-shrink-0">
      <span className="task-spinner-outer" />
      <span className="task-spinner-inner" />
    </span>
  )
}

export function TaskCheck() {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.3" />
      <path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function TaskError() {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0 text-red-400" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.3" />
      <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
