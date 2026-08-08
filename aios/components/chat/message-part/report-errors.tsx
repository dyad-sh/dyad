import type { DataPart } from '@/ai/messages/data-parts'
import { BugIcon } from 'lucide-react'
import { ToolHeader } from '../tool-header'
import { ToolMessage } from '../tool-message'
import { Streamdown } from 'streamdown'

export function ReportErrors({
  message,
}: {
  message: DataPart['report-errors']
}) {
  return (
    <ToolMessage>
      <ToolHeader>
        <BugIcon className="w-3.5 h-3.5" />
        <span>Auto-detected errors</span>
      </ToolHeader>
      <div className="relative min-h-5">
        <Streamdown>{message.summary}</Streamdown>
      </div>
    </ToolMessage>
  )
}
