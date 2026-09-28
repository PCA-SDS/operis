import { Loader2 } from 'lucide-react'

export function AiConfigLoading({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{message}</span>
    </div>
  )
}
