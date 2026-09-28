export async function disposeContainer(container: unknown): Promise<void> {
  try {
    const disposable = container as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  } catch {
    // Ignore disposal errors
  }
}
