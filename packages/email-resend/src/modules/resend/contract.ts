import { defineModuleContract } from '@open-mercato/shared/modules/contract'
import type { SendEmailOptions } from '@open-mercato/shared/lib/email/send'

export type ResendEmailScope = {
  tenantId: string
  organizationId: string
}

export type ResendEmailMessage = Omit<SendEmailOptions, 'apiKey' | 'from'>

export type ResendEmailService = {
  send(scope: ResendEmailScope, message: ResendEmailMessage): Promise<void>
}

export const contract = defineModuleContract({
  moduleId: 'resend',
})

export default contract
