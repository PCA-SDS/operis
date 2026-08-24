export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.pipelines.manage'],
  pageTitle: 'Pipeline Stages',
  pageTitleKey: 'customers.config.nav.pipelineStages',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 4,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Pipeline Stages', labelKey: 'customers.config.nav.pipelineStages' },
  ],
} as const
