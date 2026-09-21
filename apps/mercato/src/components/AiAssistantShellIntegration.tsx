'use client'

import * as React from 'react'
import { createLogger } from '@open-mercato/shared/lib/logger'

const aiAssistantShellLogger = createLogger('ai-assistant-shell')


type AiAssistantIntegrationComponent = React.ComponentType<{
  tenantId: string | null
  organizationId: string | null
  children: React.ReactNode
}>

type AiAssistantShellIntegrationProps = {
  tenantId: string | null
  organizationId: string | null
  children: React.ReactNode
}

const AiAssistantIntegrationFallback: AiAssistantIntegrationComponent = ({ children }) => <>{children}</>

export function AiAssistantShellIntegration({
  tenantId,
  organizationId,
  children,
}: AiAssistantShellIntegrationProps) {
  const [IntegrationComponent, setIntegrationComponent] = React.useState<AiAssistantIntegrationComponent | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void import('@open-mercato/ai-assistant/frontend')
      .then((module) => {
        if (cancelled) return
        setIntegrationComponent(() => module.AiAssistantIntegration)
      })
      .catch((error) => {
        if (cancelled) return
        aiAssistantShellLogger.error('Failed to load AI assistant integration', {
          error: error instanceof Error ? error.message : String(error),
        })
        setIntegrationComponent(() => AiAssistantIntegrationFallback)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!IntegrationComponent) return null

  return (
    <IntegrationComponent tenantId={tenantId} organizationId={organizationId}>
      {children}
    </IntegrationComponent>
  )
}
