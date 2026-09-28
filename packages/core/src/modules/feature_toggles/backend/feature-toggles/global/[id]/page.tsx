"use client"
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import { FormHeader } from "@open-mercato/ui/backend/forms";
import * as React from 'react'
import { useFeatureToggleItem } from "@open-mercato/core/modules/feature_toggles/components/hooks/useFeatureToggleItem";
import { FeatureToggleDetailsCard } from "@open-mercato/core/modules/feature_toggles/components/FeatureToggleDetailsCard";
import { FeatureToggleOverrideCard } from "@open-mercato/core/modules/feature_toggles/components/FeatureToggleOverrideCard";

export default function FeatureToggleDetailsPage({ params }: { params?: { id?: string } }) {
  const id = params?.id ?? ''
  const { data: featureToggleItem } = useFeatureToggleItem(id)

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref="/backend/feature-toggles/global"
        title={featureToggleItem?.name ?? '\u00a0'}
      />
      <PageBody>
        <FeatureToggleDetailsCard featureToggleItem={featureToggleItem ?? undefined} />
        {id && <FeatureToggleOverrideCard toggleId={id} />}
      </PageBody>
    </Page>
  )
}

