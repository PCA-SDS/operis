'use client'
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ProfilePasswordForm } from '../../../components/ProfilePasswordForm'

export default function ProfileChangePasswordPage() {
  const t = useT()
  return (
    <Page>
      <PageBody>
        <ProfilePasswordForm
          title={t('auth.changePassword.title', 'Change Password')}
          className="max-w-2xl"
        />
      </PageBody>
    </Page>
  )
}
