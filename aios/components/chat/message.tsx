import type { ChatUIMessage } from './types'
import { MessagePart } from './message-part'
import { BotIcon, UserIcon } from 'lucide-react'
import { memo, createContext, useContext, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  message: ChatUIMessage
}

interface ReasoningContextType {
  expandedReasoningIndex: number | null
  setExpandedReasoningIndex: (index: number | null) => void
}

const ReasoningContext = createContext<ReasoningContextType | null>(null)

export const useReasoningContext = () => useContext(ReasoningContext)

export const Message = memo(function Message({ message }: Props) {
  const [expandedReasoningIndex, setExpandedReasoningIndex] = useState<
    number | null
  >(null)

  const reasoningParts = message.parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.type === 'reasoning')

  useEffect(() => {
    if (reasoningParts.length > 0) {
      setExpandedReasoningIndex(
        reasoningParts[reasoningParts.length - 1].index
      )
    }
  }, [reasoningParts])

  const isUser = message.role === 'user'

  return (
    <ReasoningContext.Provider
      value={{ expandedReasoningIndex, setExpandedReasoningIndex }}
    >
      <div className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
        {/* Role label */}
        <div
          className={cn(
            'flex items-center gap-1.5 text-xs font-mono font-semibold',
            isUser ? 'text-cyan-400/70 flex-row-reverse' : 'text-slate-500'
          )}
        >
          {isUser ? (
            <UserIcon className="w-3 h-3" />
          ) : (
            <BotIcon className="w-3 h-3" />
          )}
          <span>{isUser ? 'You' : `Assistant${message.metadata?.model ? ` · ${message.metadata.model}` : ''}`}</span>
        </div>

        {/* Message parts */}
        <div
          className={cn(
            'space-y-1.5 w-full',
            isUser ? 'pl-8' : 'pr-6'
          )}
        >
          {message.parts.map((part, index) => (
            <div
              key={index}
              className={cn(isUser && part.type === 'text' ? 'chat-bubble-user' : '')}
            >
              <MessagePart part={part} partIndex={index} />
            </div>
          ))}
        </div>
      </div>
    </ReasoningContext.Provider>
  )
})
