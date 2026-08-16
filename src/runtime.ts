import { createServer } from 'node:net'

const HARNESS_URL = /(?:^|\s)dsh web: (http:\/\/127\.0\.0\.1:(\d+))(?:\s|$)/

export function parseHarnessUrl(line: string): string | undefined {
  const match = HARNESS_URL.exec(line)
  if (!match) return undefined

  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  return match[1]
}

export function isTrustedHarnessUrl(candidate: string, harnessUrl: string): boolean {
  try {
    return new URL(candidate).origin === new URL(harnessUrl).origin
  } catch {
    return false
  }
}

export async function chooseHarnessPort(preferredPort = 3080): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', () => resolve(0))
    probe.listen({ host: '127.0.0.1', port: preferredPort, exclusive: true }, () => {
      probe.close((error) => resolve(error ? 0 : preferredPort))
    })
  })
}
