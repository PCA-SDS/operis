import { parseBooleanWithDefault } from '../boolean'

export function isEmailDeliveryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    parseBooleanWithDefault(env.OM_DISABLE_EMAIL_DELIVERY, false) ||
    parseBooleanWithDefault(env.OM_TEST_MODE, false)
  )
}
