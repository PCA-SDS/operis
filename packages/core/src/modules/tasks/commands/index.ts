// Importing a command file registers its handlers with the command bus, so the
// module's DI registrar imports this barrel once at startup.
import './projects'
import './tasks'
import './milestones'
import './comments'
import './docs'
import './labels'
