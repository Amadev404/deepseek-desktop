import { describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_BALANCE_URL, queryDeepSeekBalance } from '../packages/companion/src/balance.js'

describe('queryDeepSeekBalance', () => {
  it('queries only the official endpoint and returns sanitized balances', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer secret-value' })
      return new Response(JSON.stringify({
        is_available: true,
        balance_infos: [{
          currency: 'CNY',
          total_balance: '12.34',
          granted_balance: '2.00',
          topped_up_balance: '10.34'
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const result = await queryDeepSeekBalance({}, async () => ({ value: 'secret-value' }), fetcher)

    expect(fetcher).toHaveBeenCalledWith(DEEPSEEK_BALANCE_URL, expect.any(Object))
    expect(result).toMatchObject({
      status: 'ready',
      available: true,
      balances: [{ currency: 'CNY', totalBalance: '12.34' }]
    })
    expect(JSON.stringify(result)).not.toContain('secret-value')
  })

  it('does not send a credential to a custom API endpoint', async () => {
    const resolveCredential = vi.fn(async () => ({ value: 'secret-value' }))
    const fetcher = vi.fn<typeof fetch>()

    await expect(queryDeepSeekBalance(
      { baseURL: 'https://gateway.example.com' },
      resolveCredential,
      fetcher
    )).resolves.toEqual({ status: 'unsupported' })
    expect(resolveCredential).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports an absent credential without making a request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(queryDeepSeekBalance({}, async () => undefined, fetcher))
      .resolves.toEqual({ status: 'unconfigured' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects malformed provider responses', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '<script>' }]
    }), { status: 200 }))

    await expect(queryDeepSeekBalance({}, async () => ({ value: 'secret' }), fetcher))
      .resolves.toEqual({ status: 'error', kind: 'invalid-response' })
  })
})
