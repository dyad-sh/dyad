import type { TextUIPart } from 'ai'
import { Streamdown } from 'streamdown'

export function Text({ part }: { part: TextUIPart }) {
  return (
    <div className="text-sm px-3.5 py-3 border border-cyan-500/10 bg-slate-900/50 text-slate-200 rounded-xl leading-relaxed">
      <Streamdown>{part.text}</Streamdown>
    </div>
  )
}
