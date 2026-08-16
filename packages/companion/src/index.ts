import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { queryDeepSeekBalance, type BalanceResult, type DeepSeekSettings } from './balance.js'

export const name = 'deepseek-desktop-companion'
export const inject = ['webServer', 'credentials', 'settings']

const BALANCE_PATH = '/deepseek-desktop/api/balance'
const CACHE_MS = 5 * 60_000
const DEEPSEEK_SETTINGS = settingsNamespace('llm-deepseek')

interface ReasoningUsageProjection {
  reasoningTokens: number
}

interface ReasoningSample {
  turn: number
  step: number
  reasoningTokens: number
}

interface ReasoningUsageState {
  total: number
  last: ReasoningSample | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    desktopReasoningUsage: ReasoningUsageProjection
  }
}

const reasoningUsageDefinition: ProjectionDefinition<'desktopReasoningUsage', ReasoningUsageState> = {
  key: 'desktopReasoningUsage',
  schema: z.object({ reasoningTokens: z.number().int().nonnegative() }).strict(),
  init: () => ({ total: 0, last: null }),
  apply: (state, event) => foldReasoningUsage(state, event),
  view: (state) => ({ reasoningTokens: state.total }),
  stateVersion: 1
}

export function apply(ctx: Context): void {
  const webServer = (ctx as Context & { webServer: WebServer }).webServer
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(reasoningUsageDefinition)
  })

  let cached: { value: BalanceResult; expiresAt: number } | undefined
  let pending: Promise<BalanceResult> | undefined
  const invalidate = (): void => {
    cached = undefined
  }

  ctx.on('credentials/updated', invalidate)
  ctx.on('settings/updated', (namespace) => {
    if (namespace === DEEPSEEK_SETTINGS) invalidate()
  })

  const readBalance = (force = false): Promise<BalanceResult> => {
    if (force) cached = undefined
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
    if (pending) return pending

    const settings = (ctx.settings.get(DEEPSEEK_SETTINGS) ?? {}) as DeepSeekSettings
    pending = queryDeepSeekBalance(
      settings,
      async (ref) => ctx.credentials.resolve(credentialRef(ref))
    ).then((value) => {
      if (value.status === 'ready') cached = { value, expiresAt: Date.now() + CACHE_MS }
      return value
    }).finally(() => {
      pending = undefined
    })
    return pending
  }

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: BALANCE_PATH,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' })
        response.end()
        return
      }

      const force = new URL(request.url ?? BALANCE_PATH, 'http://127.0.0.1').searchParams.get('refresh') === '1'
      const body = JSON.stringify(await readBalance(force))
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'",
        'content-type': 'application/json; charset=utf-8',
        'x-content-type-options': 'nosniff'
      })
      response.end(request.method === 'HEAD' ? undefined : body)
    }
  }), 'deepseek-desktop: balance route')
}

function foldReasoningUsage(state: ReasoningUsageState, event: SessionEvent): ReasoningUsageState {
  let turn: number
  let step: number
  let usage: TokenUsage | undefined

  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    ({ turn, step } = event.data)
    usage = event.data.chunk.usage
  } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    ({ turn, step, usage } = event.data)
  } else {
    return state
  }

  if (!usage) return state
  const reasoningTokens = usage.reasoningTokens ?? 0
  const previous = state.last?.turn === turn && state.last.step === step ? state.last.reasoningTokens : 0
  if (state.last?.turn === turn && state.last.step === step && previous === reasoningTokens) return state

  return {
    total: state.total - previous + reasoningTokens,
    last: { turn, step, reasoningTokens }
  }
}
