import type { ReasoningUIPart } from 'ai'
import { BrainIcon, ChevronDownIcon } from 'lucide-react'
import { useReasoningContext } from '../message'
import { Streamdown } from 'streamdown'

export function Reasoning({ part, partIndex }: { part: ReasoningUIPart; partIndex: number }) {
  const context = useReasoningContext()
  const isExpanded = context?.expandedReasoningIndex === partIndex

  if (part.state === 'done' && !part.text) return null

  const text = part.text || '_Thinking…_'
  const isStreaming = part.state === 'streaming'
  const firstLine = text.split('\n')[0].replace(/\*\*/g, '')
  const hasMore = text.includes('\n') || text.length > 80

  const handleClick = () => {
    if (hasMore && context) {
      context.setExpandedReasoningIndex(isExpanded ? null : partIndex)
    }
  }

  return (
    <div
      className={`reasoning-card ${isStreaming ? 'reasoning-card-streaming' : 'reasoning-card-done'}`}
      onClick={handleClick}
    >
      {isStreaming && <div className="reasoning-scanline" />}

      <div className="reasoning-header">
        <div className="flex items-center gap-1.5">
          <BrainIcon className={`w-3.5 h-3.5 ${isStreaming ? 'text-purple-400' : 'text-slate-500'}`} />
          <span className="reasoning-title">
            {isStreaming ? 'Thinking' : 'Reasoning'}
          </span>
          {isStreaming && (
            <div className="reasoning-dots">
              <span /><span /><span />
            </div>
          )}
        </div>
        {hasMore && (
          <ChevronDownIcon
            className={`w-3.5 h-3.5 text-slate-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        )}
      </div>

      <div className="reasoning-body">
        {isExpanded || !hasMore ? (
          <Streamdown>{text}</Streamdown>
        ) : (
          <div className="truncate opacity-60">{firstLine}</div>
        )}
      </div>
    </div>
  )
}
