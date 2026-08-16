export const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'
const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'

export interface BalanceEntry {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export type BalanceResult =
  | { status: 'ready'; available: boolean; balances: BalanceEntry[]; fetchedAt: number }
  | { status: 'unconfigured' }
  | { status: 'unsupported' }
  | { status: 'error'; kind: 'unauthorized' | 'forbidden' | 'unavailable' | 'network' | 'invalid-response' }

export interface DeepSeekSettings {
  apiKeyEnv?: unknown
  baseURL?: unknown
}

interface CredentialValue {
  value: string
}

interface WireBalanceEntry {
  currency?: unknown
  total_balance?: unknown
  granted_balance?: unknown
  topped_up_balance?: unknown
}

interface WireBalance {
  is_available?: unknown
  balance_infos?: unknown
}

interface ValidWireBalanceEntry {
  currency: string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

export async function queryDeepSeekBalance(
  settings: DeepSeekSettings,
  resolveCredential: (ref: string) => Promise<CredentialValue | undefined>,
  fetcher: typeof fetch = fetch
): Promise<BalanceResult> {
  if (!isOfficialEndpoint(settings.baseURL)) return { status: 'unsupported' }

  const ref = typeof settings.apiKeyEnv === 'string' && settings.apiKeyEnv.trim()
    ? settings.apiKeyEnv.trim()
    : DEFAULT_API_KEY_REF
  const credential = await resolveCredential(ref)
  if (!credential?.value) return { status: 'unconfigured' }

  let response: Response
  try {
    response = await fetcher(DEEPSEEK_BALANCE_URL, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${credential.value}`
      },
      signal: AbortSignal.timeout(8_000)
    })
  } catch {
    return { status: 'error', kind: 'network' }
  }

  if (!response.ok) {
    if (response.status === 401) return { status: 'error', kind: 'unauthorized' }
    if (response.status === 403) return { status: 'error', kind: 'forbidden' }
    return { status: 'error', kind: 'unavailable' }
  }

  let wire: WireBalance
  try {
    wire = await response.json() as WireBalance
  } catch {
    return { status: 'error', kind: 'invalid-response' }
  }

  if (typeof wire.is_available !== 'boolean' || !Array.isArray(wire.balance_infos)) {
    return { status: 'error', kind: 'invalid-response' }
  }

  const balances: BalanceEntry[] = []
  for (const value of wire.balance_infos) {
    if (!isWireBalanceEntry(value)) return { status: 'error', kind: 'invalid-response' }
    balances.push({
      currency: value.currency,
      totalBalance: value.total_balance,
      grantedBalance: value.granted_balance,
      toppedUpBalance: value.topped_up_balance
    })
  }

  return {
    status: 'ready',
    available: wire.is_available,
    balances,
    fetchedAt: Date.now()
  }
}

function isOfficialEndpoint(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'api.deepseek.com'
      && (url.port === '' || url.port === '443')
      && (url.pathname === '/' || url.pathname === '')
      && url.search === ''
      && url.hash === ''
  } catch {
    return false
  }
}

function isWireBalanceEntry(value: unknown): value is ValidWireBalanceEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as WireBalanceEntry
  return typeof entry.currency === 'string'
    && /^[A-Z]{3}$/.test(entry.currency)
    && isAmount(entry.total_balance)
    && isAmount(entry.granted_balance)
    && isAmount(entry.topped_up_balance)
}

function isAmount(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)
}
