import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  className?: string
  children: ReactNode
}

export function Panel({ className, children }: Props) {
  return (
    <div className={cn('holo-panel flex flex-col relative w-full h-full', className)}>
      {children}
    </div>
  )
}

export function PanelHeader({ className, children }: Props) {
  return (
    <div className={cn('holo-panel-header text-sm flex items-center px-2.5 py-1.5', className)}>
      {children}
    </div>
  )
}
