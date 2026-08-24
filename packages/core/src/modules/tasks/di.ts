import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DefaultCommentService } from './services/commentService'
import { DefaultDocService } from './services/docService'
import { DefaultLabelService } from './services/labelService'
import { DefaultMilestoneService } from './services/milestoneService'
import { DefaultMyTasksService } from './services/myTasksService'
import { DefaultProjectService } from './services/projectService'
import { DefaultQuickAddService } from './services/quickAddService'
import { DefaultTaskService } from './services/taskService'
import { DefaultTeamService } from './services/teamService'
import './commands'
import './mcp-scopes'

export function register(container: AppContainer) {
  container.register({
    tasksProjectService: asFunction(() => new DefaultProjectService()).singleton(),
    tasksTaskService: asFunction(() => new DefaultTaskService()).singleton(),
    tasksMilestoneService: asFunction(() => new DefaultMilestoneService()).singleton(),
    tasksCommentService: asFunction(() => new DefaultCommentService()).singleton(),
    tasksDocService: asFunction(() => new DefaultDocService()).singleton(),
    tasksLabelService: asFunction(() => new DefaultLabelService()).singleton(),
    tasksMyTasksService: asFunction(() => new DefaultMyTasksService()).singleton(),
    tasksTeamService: asFunction(() => new DefaultTeamService()).singleton(),
    tasksQuickAddService: asFunction(() => new DefaultQuickAddService()).singleton(),
  })
}
