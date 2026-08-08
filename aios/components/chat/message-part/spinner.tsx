import { Loader } from '@/components/ai-elements/loader'
import { cn } from '@/lib/utils'

export function Spinner({
  className,
  loading,
  children,
}: {
  className?: string
  loading: boolean
  children?: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-5 h-5',
        className
      )}
    >
      {loading ? <Loader /> : children}
    </span>
  )
}
