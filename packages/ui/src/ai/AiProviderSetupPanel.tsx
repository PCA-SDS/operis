"use client"

/**
 * Shared "no AI provider configured" notice.
 *
 * Rendered wherever an AI surface would otherwise open a chat that cannot
 * stream — the global launcher picker, per-page assistant sheets, the dock —
 * so the operator gets an actionable setup prompt instead of a 503 mid-stream.
 *
 * Built on the `Alert` primitive (same contract as the sibling
 * `LoopDisabledBanner`) so the icon badge, spacing and status tokens match
 * every other warning in the product. `style="lighter"` rather than the
 * `light` default because this fills a whole sheet/dock body — the heavier
 * tint reads as alarming at that size.
 *
 * Backend-only by design: it names environment variables, so customer-facing
 * portal surfaces hide their AI triggers outright rather than render this.
 */

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '../primitives/alert'
import { Button } from '../primitives/button'

export const AI_ASSISTANT_DOCS_URL = 'https://docs.openmercato.com/framework/ai-assistant/overview'
export const AI_ASSISTANT_SETTINGS_DOCS_URL = 'https://docs.openmercato.com/framework/ai-assistant/settings'

/**
 * One pairing per supported provider. Kept as data so every line renders with
 * identical spacing and a new provider is a one-line addition.
 */
const PROVIDER_ENV_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['OM_AI_PROVIDER=anthropic', 'ANTHROPIC_API_KEY=...'],
  ['OM_AI_PROVIDER=openai', 'OPENAI_API_KEY=...'],
  ['OM_AI_PROVIDER=google', 'GOOGLE_GENERATIVE_AI_API_KEY=...'],
]

export interface AiProviderSetupPanelProps {
  /**
   * `inline` (default) sits in normal document flow — the launcher picker
   * list. `fill` stretches to own a flex-column body (assistant sheets, the
   * dock) and scrolls internally so long content never pushes the sheet.
   */
  variant?: 'inline' | 'fill'
  className?: string
}

export function AiProviderSetupPanel({ variant = 'inline', className }: AiProviderSetupPanelProps) {
  const t = useT()
  return (
    <div
      className={cn('p-4', variant === 'fill' && 'min-h-0 min-w-0 flex-1 overflow-y-auto', className)}
      data-ai-provider-setup=""
      data-ai-provider-setup-variant={variant}
      data-ai-launcher-provider-setup=""
    >
      <Alert status="warning" style="lighter" size="default">
        <AlertTitle>
          {t('ai_assistant.launcher.setup.title', 'Configure an AI provider to use assistants')}
        </AlertTitle>
        <AlertDescription className="text-muted-foreground">
          {t(
            'ai_assistant.launcher.setup.body',
            'AI assistants are installed, but no provider key is configured. Set OM_AI_PROVIDER and one matching API key in your .env file, then restart the app.',
          )}
        </AlertDescription>
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-xs leading-5 text-foreground">
          <code>
            {PROVIDER_ENV_SAMPLES.map(([providerLine, keyLine], index) => (
              <React.Fragment key={providerLine}>
                {index > 0 ? <span className="text-muted-foreground">{'\n# or\n'}</span> : null}
                {`${providerLine}\n${keyLine}\n`}
              </React.Fragment>
            ))}
          </code>
        </pre>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={AI_ASSISTANT_DOCS_URL} target="_blank" rel="noreferrer">
              {t('ai_assistant.launcher.setup.docs', 'AI assistant docs')}
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={AI_ASSISTANT_SETTINGS_DOCS_URL} target="_blank" rel="noreferrer">
              {t('ai_assistant.launcher.setup.settingsDocs', 'Provider settings')}
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        </div>
      </Alert>
    </div>
  )
}

export default AiProviderSetupPanel
