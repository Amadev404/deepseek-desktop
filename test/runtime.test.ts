import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { chooseHarnessPort, isTrustedHarnessUrl, parseHarnessUrl } from '../src/runtime.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function listen(port = 0): Promise<{ server: Server; port: number }> {
  const server = createServer()
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port }, resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.')
  return { server, port: address.port }
}

describe('parseHarnessUrl', () => {
  it('extracts the official loopback startup URL', () => {
    expect(parseHarnessUrl('dsh web: http://127.0.0.1:3080')).toBe('http://127.0.0.1:3080')
  })

  it('accepts the official LAN suffix while returning only the local URL', () => {
    expect(parseHarnessUrl('dsh web: http://127.0.0.1:49152 (LAN: http://192.0.2.1:49152)'))
      .toBe('http://127.0.0.1:49152')
  })

  it('rejects non-loopback and invalid ports', () => {
    expect(parseHarnessUrl('dsh web: http://0.0.0.0:3080')).toBeUndefined()
    expect(parseHarnessUrl('dsh web: http://127.0.0.1:70000')).toBeUndefined()
  })
})

describe('isTrustedHarnessUrl', () => {
  const harnessUrl = 'http://127.0.0.1:3080'

  it('allows only the current Harness origin', () => {
    expect(isTrustedHarnessUrl('http://127.0.0.1:3080/session/1', harnessUrl)).toBe(true)
    expect(isTrustedHarnessUrl('http://127.0.0.1:3081/session/1', harnessUrl)).toBe(false)
    expect(isTrustedHarnessUrl('https://example.com', harnessUrl)).toBe(false)
    expect(isTrustedHarnessUrl('not a url', harnessUrl)).toBe(false)
  })
})

describe('chooseHarnessPort', () => {
  it('keeps an available preferred port', async () => {
    const reservation = await listen()
    await new Promise<void>((resolve) => reservation.server.close(() => resolve()))
    servers.splice(servers.indexOf(reservation.server), 1)
    await expect(chooseHarnessPort(reservation.port)).resolves.toBe(reservation.port)
  })

  it('falls back to an OS-assigned port when the preferred port is occupied', async () => {
    const reservation = await listen()
    await expect(chooseHarnessPort(reservation.port)).resolves.toBe(0)
  })
})
