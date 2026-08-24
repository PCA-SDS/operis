import { redirect } from 'next/navigation'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { isAutoLoginEnabled } from '@open-mercato/core/modules/auth/lib/autologin'

// The home route is a pure router: it never renders. Authenticated visitors go
// into the app, everyone else straight to the login form. The developer start
// page is still there on /start for anyone who wants the module inventory and
// the database status, but it is no longer what the front door opens onto.
export default async function Home() {
  const auth = await getAuthFromCookies()

  // Demo autologin: when OM_AUTOLOGIN_* credentials are configured and there is
  // no active session, hand off to the autologin route which signs the visitor
  // in and drops them into the app. Fully gated behind env vars — with them
  // unset, behavior below is unchanged. The route falls back to /login when the
  // credentials are invalid, so a misconfigured demo can never loop.
  if (!auth && isAutoLoginEnabled()) {
    redirect('/api/auth/autologin')
  }

  redirect(auth ? '/backend' : '/login')
}
