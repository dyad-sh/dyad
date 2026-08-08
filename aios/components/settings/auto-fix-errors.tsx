import { useFixErrors } from '@/components/settings/use-settings'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

export function AutoFixErrors() {
  const [fixErrors, setFixErrors] = useFixErrors()
  return (
    <div
      className="flex items-center justify-between cursor-pointer hover:bg-accent/50 rounded p-2 -m-2"
      onClick={() => setFixErrors(!fixErrors)}
    >
      <div className="space-y-1 flex-1 pointer-events-none">
        <Label className="text-sm text-foreground" htmlFor="auto-fix">
          Auto-fix errors
        </Label>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Automatically detects and fixes errors in generated code.
        </p>
      </div>
      <Checkbox
        id="auto-fix"
        className="ml-3 pointer-events-none"
        checked={fixErrors}
        onCheckedChange={(checked) =>
          setFixErrors(checked === 'indeterminate' ? false : checked)
        }
      />
    </div>
  )
}
