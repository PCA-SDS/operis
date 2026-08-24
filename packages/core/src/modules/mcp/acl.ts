// Feature ids are persisted in role ACL rows — see BACKWARD_COMPATIBILITY.md.
// Renaming one is a data migration, not a refactor.
export const features = [
  {
    id: 'mcp.connect',
    title: 'Connect an MCP client to this account',
    module: 'mcp',
  },
  {
    id: 'mcp.clients.manage',
    title: 'Register and revoke MCP OAuth clients',
    module: 'mcp',
    dependsOn: ['mcp.connect'],
  },
]

export default features
