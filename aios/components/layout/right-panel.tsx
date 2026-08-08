'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Preview } from '@/app/preview'
import { FileExplorer } from '@/app/file-explorer'
import { Logs } from '@/app/logs'
import { cn } from '@/lib/utils'
import {
  MonitorIcon,
  Code2Icon,
  TerminalIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from 'lucide-react'

type View = 'preview' | 'code'

const VALID_VIEWS: View[] = ['preview', 'code']

export function RightPanel() {
  const params = useSearchParams()
  const requested = params.get('app')
  const initialView: View = VALID_VIEWS.includes(requested as View)
    ? (requested as View)
    : 'preview'
  const [activeView, setActiveView] = useState<View>(initialView)
  const [logsOpen, setLogsOpen] = useState(false)

  return (
    <div className="flex flex-col h-full w-full">
      {/* Lovable-style prominent top bar */}
      <div className="flex items-stretch flex-shrink-0 h-10 border-b border-white/8 bg-[#080c12]">
        <div className="flex items-stretch overflow-x-auto">
          <ViewTab
            active={activeView === 'preview'}
            onClick={() => setActiveView('preview')}
            icon={<MonitorIcon className="w-4 h-4" />}
            label="Preview"
          />
          <ViewTab
            active={activeView === 'code'}
            onClick={() => setActiveView('code')}
            icon={<Code2Icon className="w-4 h-4" />}
            label="Code"
          />
        </div>

        <div className="flex-1" />

        {/* Terminal toggle — only in code view */}
        {activeView === 'code' && (
          <button
            type="button"
            onClick={() => setLogsOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-4 h-full text-[0.7rem] font-mono font-bold uppercase tracking-wider transition-all duration-200 border-l border-white/5',
              logsOpen
                ? 'text-emerald-400 bg-emerald-500/8'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
            )}
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            Terminal
            {logsOpen ? (
              <ChevronDownIcon className="w-3 h-3 ml-0.5" />
            ) : (
              <ChevronUpIcon className="w-3 h-3 ml-0.5" />
            )}
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="relative flex-1 min-h-0">
        {/* Preview panel */}
        <ViewLayer active={activeView === 'preview'}>
          <Preview className="h-full" />
        </ViewLayer>

        {/* Code panel — file explorer + collapsible terminal */}
        <ViewLayer active={activeView === 'code'} flexCol>
          <div className="flex-1 min-h-0">
            <FileExplorer className="h-full" />
          </div>
          <div
            className={cn(
              'flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out border-t border-white/5',
              logsOpen ? 'h-48' : 'h-0'
            )}
          >
            <Logs className="h-48" />
          </div>
        </ViewLayer>
      </div>
    </div>
  )
}

function ViewLayer({
  active,
  flexCol,
  children,
}: {
  active: boolean
  flexCol?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'absolute inset-0 transition-all duration-300 ease-in-out',
        flexCol && 'flex flex-col',
        active
          ? 'z-20 opacity-100 scale-100'
          : 'z-10 opacity-[0.13] scale-[0.972] pointer-events-none blur-[1.5px]'
      )}
    >
      {children}
    </div>
  )
}

function ViewTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-5 h-full text-sm font-semibold tracking-tight transition-all duration-200 border-b-2 relative whitespace-nowrap',
        active
          ? 'text-cyan-300 border-b-cyan-400 bg-[#0d1117]'
          : 'text-slate-500 border-b-transparent hover:text-slate-300 hover:bg-white/5'
      )}
    >
      {icon}
      {label}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-500/0 via-cyan-400 to-cyan-500/0" />
      )}
    </button>
  )
}
