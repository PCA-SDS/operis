import {
  defineModuleExtensionPoints,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

/**
 * Surfaces this module opens to other modules.
 *
 * Both hosts sit where cross-module context is genuinely useful — the task
 * detail's properties rail (attachments, linked CRM records, anything about
 * *this* task) and the project detail's footer (reports, integrations, anything
 * about *this* project). The call sites read the ids from here rather than
 * repeating the literal, which is what keeps the declaration bound.
 */
export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'tasks',
  hosts: {
    taskPanelSidebar: injectionExtensionHost({
      family: 'generic',
      spotId: 'tasks:task-panel:sidebar',
      supported: ['render-widget'],
      source: 'components/TaskPanel.tsx',
    }),
    projectDetailFooter: injectionExtensionHost({
      family: 'generic',
      spotId: 'tasks:project-detail:footer',
      supported: ['render-widget'],
      source: 'components/ProjectDetailView.tsx',
    }),
  },
})

export default extensionPoints
