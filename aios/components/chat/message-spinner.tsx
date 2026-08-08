import { PulseLoader } from 'react-spinners'
import { cn } from '@/lib/utils'

export function MessageSpinner({ className }: { className?: string }) {
  return <PulseLoader className={cn('opacity-60', className)} size={5} />
}
