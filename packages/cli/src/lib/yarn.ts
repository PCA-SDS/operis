export function resolveYarnBinary(): string {
  return process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
}
