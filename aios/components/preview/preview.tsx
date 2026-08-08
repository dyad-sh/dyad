'use client'

import { BarLoader } from 'react-spinners'
import {
  RefreshCwIcon,
  Maximize2Icon,
  Minimize2Icon,
  ExternalLinkIcon,
} from 'lucide-react'
import { Panel, PanelHeader } from '@/components/panels/panels'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  className?: string
  disabled?: boolean
  url?: string
}

export function Preview({ className, disabled, url }: Props) {
  const [currentUrl, setCurrentUrl] = useState(url)
  const [error, setError] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState(url || '')
  const [isLoading, setIsLoading] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any

  useEffect(() => {
    setCurrentUrl(url)
    setInputValue(url || '')
  }, [url])

  const refreshIframe = () => {
    if (iframeRef.current && currentUrl) {
      setIsLoading(true)
      setError(null)
      iframeRef.current.src = ''
      setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = currentUrl
      }, 10)
    }
  }

  const loadNewUrl = () => {
    if (iframeRef.current && inputValue) {
      if (inputValue !== currentUrl) {
        setIsLoading(true)
        setError(null)
        iframeRef.current.src = inputValue
      } else {
        refreshIframe()
      }
    }
  }

  const openInNewTab = () => {
    // Triggered by a direct user click, so it is not blocked by popup blockers.
    if (currentUrl) window.open(currentUrl, '_blank', 'noopener,noreferrer')
  }

  const toggleFullscreen = () => {
    const el = containerRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  return (
    <div ref={containerRef} className={cn('flex flex-col h-full', className)}>
    <Panel className="flex-1 h-full">
      <PanelHeader className="flex items-center gap-1 relative z-10">
        {/* Left controls */}
        <IconBtn
          onClick={openInNewTab}
          disabled={!currentUrl}
          title="Open preview in new tab"
        >
          <ExternalLinkIcon className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn
          onClick={refreshIframe}
          disabled={!currentUrl}
          title="Refresh preview"
          className={isLoading ? 'animate-spin' : ''}
        >
          <RefreshCwIcon className="w-3.5 h-3.5" />
        </IconBtn>

        {/* URL bar */}
        <div className="flex-1 flex justify-center px-2">
          {currentUrl && (
            <input
              type="text"
              className="font-mono text-xs h-6 border border-cyan-500/20 px-3 bg-black/40 text-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-cyan-500/40 w-full max-w-sm placeholder:text-slate-600"
              onChange={(e) => setInputValue(e.target.value)}
              onClick={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.currentTarget.blur(); loadNewUrl() }
              }}
              value={inputValue}
            />
          )}
        </div>

        {/* Right: fullscreen */}
        <IconBtn onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {isFullscreen
            ? <Minimize2Icon className="w-3.5 h-3.5" />
            : <Maximize2Icon className="w-3.5 h-3.5" />}
        </IconBtn>
      </PanelHeader>

      <div className="flex-1 relative overflow-hidden">
        {currentUrl && !disabled && (
          <>
            <iframe
              ref={iframeRef}
              src={currentUrl}
              className="absolute inset-0 w-full h-full border-0 bg-white"
              onLoad={() => { setIsLoading(false); setError(null) }}
              onError={() => { setIsLoading(false); setError('Failed to load') }}
              title="Preview"
              allow="cross-origin-isolated"
            />

            {isLoading && !error && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center flex-col gap-3 z-10">
                <BarLoader color="#00ccff" width={120} />
                <span className="text-cyan-500/70 text-xs font-mono tracking-wider">Loading preview…</span>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 bg-black/80 flex items-center justify-center flex-col gap-3 z-10">
                <span className="text-red-400 font-mono text-sm">Failed to load page</span>
                <button
                  className="text-cyan-400 hover:text-cyan-300 text-xs font-mono border border-cyan-500/20 px-3 py-1 rounded hover:bg-cyan-500/10 transition-all"
                  type="button"
                  onClick={() => {
                    if (currentUrl) {
                      setIsLoading(true)
                      setError(null)
                      const u = new URL(currentUrl)
                      u.searchParams.set('t', Date.now().toString())
                      setCurrentUrl(u.toString())
                    }
                  }}
                >
                  Try again
                </button>
              </div>
            )}
          </>
        )}

        {(!currentUrl || disabled) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-slate-600 font-mono text-xs uppercase tracking-widest">
              No preview available
            </span>
          </div>
        )}
      </div>
    </Panel>
    </div>
  )
}

function IconBtn({
  onClick,
  href,
  children,
  title,
  className,
  disabled,
}: {
  onClick?: () => void
  href?: string
  children: React.ReactNode
  title?: string
  className?: string
  disabled?: boolean
}) {
  const cls = cn(
    'flex items-center justify-center w-6 h-6 rounded transition-all',
    disabled
      ? 'text-slate-700 cursor-not-allowed opacity-50'
      : 'text-cyan-400 hover:text-cyan-200 hover:bg-cyan-500/15 cursor-pointer',
    className
  )
  if (href && !disabled) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={cls} title={title}>{children}</a>
  }
  return (
    <button type="button" onClick={onClick} className={cls} title={title} disabled={disabled}>
      {children}
    </button>
  )
}
