/**
 * Fields carrying operator-written prose. Declaring them lets the Translation
 * Manager offer per-locale copies, which matters for projects and doc pages
 * shared across a multilingual tenant.
 *
 * Task titles are deliberately absent: they are working notes with a short
 * life, and translating each one would cost more than it returns.
 */
export const translatableFields: Record<string, string[]> = {
  'tasks:tasks_project': ['name', 'description'],
  'tasks:tasks_milestone': ['name', 'description'],
  'tasks:tasks_project_doc': ['title', 'body'],
  'tasks:tasks_label': ['name'],
}

export default translatableFields
