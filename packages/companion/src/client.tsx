import type { IApiClient, ModelReasoningEffort, SessionId, SessionModels } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext, ConversationSnapshot, ISessions, ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import type { BalanceResult } from './balance.js'
import whaleAvatar from '../assets/whale-avatar.png'
import maidWork from '../assets/maid-work.webp'
import { PetOverlaySync, PetSettings, usePetController, type PetUseSessions } from './pet.js'

export const inject = ['connection', 'sessions', 'slots']

interface DesktopBridge {
  quit(): void
}

declare global {
  interface Window {
    deepseekDesktop?: DesktopBridge
  }
}

interface TokenUsageProjection {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

interface ReasoningUsageProjection {
  reasoningTokens: number
}

interface InjectedProps {
  api: IApiClient
  sessions: ISessions
}

type DesktopMenuProps = PropsRuntime<'sidebar.footer.action'> & InjectedProps
type ModelState =
  | { phase: 'idle' | 'loading'; value?: SessionModels; error?: undefined }
  | { phase: 'ready' | 'selecting'; value: SessionModels; error?: undefined }
  | { phase: 'error'; value?: SessionModels; error: string }

const BALANCE_PATH = '/deepseek-desktop/api/balance'
const BALANCE_CACHE_MS = 5 * 60_000
const EMPTY_SUBSCRIBE = (): (() => void) => () => {}
const EMPTY_SNAPSHOT = (): undefined => undefined
const CSS = `
.dsd-root{position:relative;width:100%;min-width:0;margin-bottom:2px}
.dsd-trigger{box-sizing:border-box;width:100%;height:40px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;gap:9px;padding:0 10px;text-align:left;font:inherit;outline:none}
.dsd-trigger:hover,.dsd-trigger:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dsd-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsd-trigger.dsd-rail{width:36px;height:36px;padding:0;justify-content:center;border-radius:50%}
.dsd-avatar{width:24px;height:24px;border-radius:50%;background:linear-gradient(145deg,#5b8cff,#275de7);color:#fff;display:grid;place-items:center;flex:none;font-size:12px;font-weight:700;box-shadow:inset 0 0 0 1px #ffffff42;overflow:hidden}
.dsd-avatarImage{width:100%;height:100%;display:block;object-fit:cover}
.dsd-triggerCopy{display:flex;align-items:center;gap:7px;min-width:0;flex:1}
.dsd-triggerName{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsd-triggerBalance{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap}
.dsd-chevron{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .15s ease}
.dsd-chevronOpen{transform:rotate(180deg)}
.dsd-popover{position:fixed;z-index:120;box-sizing:border-box;border:1px solid var(--dsw-alias-border-inverted);border-radius:14px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv3);padding:8px;max-height:min(620px,calc(100vh - 32px));overflow:auto;animation:dsd-in .16s ease-out}
@keyframes dsd-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.dsd-account{display:flex;align-items:center;gap:10px;padding:8px 8px 10px}
.dsd-account .dsd-avatar{width:30px;height:30px;font-size:14px}
.dsd-accountCopy{min-width:0;display:flex;flex-direction:column}
.dsd-accountTitle{font-size:14px;font-weight:600;line-height:20px}
.dsd-accountSub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsd-section{border-top:1px solid var(--dsw-alias-border-l2);padding:9px 8px}
.dsd-sectionTitle{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.dsd-sectionTitle svg{width:15px;height:15px}
.dsd-refresh{margin-left:auto;width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:grid;place-items:center;outline:none}
.dsd-refresh:hover,.dsd-refresh:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsd-refresh:disabled{opacity:.45;cursor:default}
.dsd-refresh svg{width:14px;height:14px}
.dsd-topUp{display:inline-flex;align-items:center;height:26px;padding:0 8px;border-radius:7px;color:var(--dsw-alias-label-primary);text-decoration:none;white-space:nowrap}
.dsd-topUp:hover,.dsd-topUp:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dsd-spin{animation:dsd-spin .8s linear infinite}
@keyframes dsd-spin{to{transform:rotate(360deg)}}
.dsd-balance{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.dsd-money{font-size:22px;line-height:30px;font-weight:650;letter-spacing:-.3px}
.dsd-balanceState{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsd-balanceList{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsd-muted,.dsd-error{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsd-error{color:var(--dsw-alias-state-error-primary)}
.dsd-usageGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.dsd-stat{border-radius:9px;background:var(--dsw-alias-bg-module-platform);padding:7px 8px;min-width:0}
.dsd-statValue{font-size:14px;font-weight:600;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsd-statLabel{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsd-effortHeader{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.dsd-effortModel{font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsd-effortValue{font-size:12px;font-weight:600;white-space:nowrap}
.dsd-slider{width:100%;height:20px;margin:0;accent-color:#3c72e6;cursor:pointer}
.dsd-slider:disabled{cursor:default;opacity:.45}
.dsd-scale{display:flex;justify-content:space-between;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsd-scale span{flex:1;text-align:center}.dsd-scale span:first-child{text-align:left}.dsd-scale span:last-child{text-align:right}
.dsd-actions{border-top:1px solid var(--dsw-alias-border-l2);padding-top:6px}
.dsd-action{width:100%;height:38px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;gap:9px;padding:0 9px;text-align:left;font:inherit;font-size:13px;outline:none}
.dsd-action:hover,.dsd-action:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dsd-action svg{width:16px;height:16px;color:var(--dsw-alias-label-secondary)}
.dsd-actionDanger{color:var(--dsw-alias-state-error-primary)}
.dsd-actionDanger svg{color:currentColor}
.dsd-character{display:block;visibility:hidden;position:fixed;z-index:1;right:max(20px,4vw);bottom:0;width:min(30vw,420px);max-height:78vh;object-fit:contain;object-position:bottom;opacity:0;transform:translateY(6px);pointer-events:none;user-select:none;filter:drop-shadow(0 14px 24px rgba(21,45,83,.16));transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}
body:has([data-phase='hero']) .dsd-character,body:has([data-phase='active']) .dsd-character{visibility:visible;transform:none;transition-delay:0s}
body:has([data-phase='hero']) .dsd-character{opacity:.82}
body:has([data-phase='active']) .dsd-character{right:max(12px,2vw);width:min(24vw,340px);max-height:68vh;opacity:.34}
body:has([data-phase='hero']) [data-phase='hero']{background:transparent}
body:has([data-phase='hero']) [data-phase='hero'] > *{position:relative;z-index:1}
@media(max-width:1179px){.dsd-character{display:none!important}}
@media(prefers-reduced-motion:reduce){.dsd-popover,.dsd-chevron,.dsd-spin,.dsd-character{animation:none;transition:none}}
`

installStyles()

export function apply(ctx: ClientContext): void {
  const connection = (ctx as ClientContext & { connection: { api: IApiClient } }).connection
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'deepseek-desktop.account-menu',
    order: 100
  }, (props) => <DesktopMenu {...props} api={connection.api} sessions={ctx.sessions as unknown as ISessions} />))
}

function DesktopMenu({ api, sessions, useSessions, wide }: DesktopMenuProps): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [balance, setBalance] = useState<BalanceResult | undefined>()
  const [balanceLoading, setBalanceLoading] = useState(false)
  const currentId = useSessions((snapshot) => snapshot.current)
  const conversation = useConversation(sessions, currentId)
  const usage = useProjection<TokenUsageProjection>(sessions, currentId, 'tokenUsage')
  const reasoning = useProjection<ReasoningUsageProjection>(sessions, currentId, 'desktopReasoningUsage')
  const [models, setModels] = useState<ModelState>({ phase: 'idle' })
  const modelGeneration = useRef(0)
  const balanceCacheExpiresAt = useRef(0)
  const pet = usePetController()

  const loadBalance = useCallback(async (force = false) => {
    if (!force && balanceCacheExpiresAt.current > Date.now()) return
    setBalanceLoading(true)
    try {
      const response = await fetch(`${BALANCE_PATH}${force ? '?refresh=1' : ''}`, { cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok) throw new Error(String(response.status))
      const value = await response.json() as BalanceResult
      balanceCacheExpiresAt.current = Date.now() + BALANCE_CACHE_MS
      setBalance(value)
    } catch {
      balanceCacheExpiresAt.current = Date.now() + BALANCE_CACHE_MS
      setBalance({ status: 'error', kind: 'network' })
    } finally {
      setBalanceLoading(false)
    }
  }, [])

  const loadModels = useCallback(async () => {
    const generation = ++modelGeneration.current
    if (!currentId || sessions.subagentAddress(currentId) !== undefined) {
      setModels({ phase: 'idle' })
      return
    }
    setModels((state) => ({ phase: 'loading', value: state.value }))
    try {
      const response = await api.sessions.models({ sessionId: currentId })
      if (generation !== modelGeneration.current) return
      if (!response.result.ok) {
        setModels({ phase: 'error', error: response.result.error.message })
        return
      }
      setModels({ phase: 'ready', value: response.result.value })
    } catch (error) {
      if (generation !== modelGeneration.current) return
      setModels({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }, [api, currentId, sessions])

  useEffect(() => {
    if (!open) return
    void loadBalance()
    void loadModels()
  }, [open, currentId, loadBalance, loadModels])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (target instanceof Element && target.closest('[data-dsd-pet-dialog]')) return
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const effort = effortState(models.value)
  const selectedEffort = effort.choices[effort.index]

  const chooseEffort = async (index: number): Promise<void> => {
    if (!currentId || !models.value) return
    const choice = effort.choices[index]
    if (!choice || choice.id === selectedEffort?.id || models.phase === 'selecting') return
    const generation = ++modelGeneration.current
    setModels({ phase: 'selecting', value: models.value })
    try {
      const response = await api.sessions.selectModel({
        sessionId: currentId,
        provider: models.value.current.provider,
        model: models.value.current.model,
        reasoningEffort: choice.id
      })
      if (generation !== modelGeneration.current) return
      if (!response.result.ok) {
        setModels({ phase: 'error', value: models.value, error: response.result.error.message })
        return
      }
      setModels({
        phase: 'ready',
        value: { ...models.value, current: response.result.value.selected }
      })
    } catch (error) {
      if (generation !== modelGeneration.current) return
      setModels({ phase: 'error', value: models.value, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const primaryBalance = balance?.status === 'ready' ? balance.balances[0] : undefined
  const popoverStyle = positionPopover(rootRef.current, wide)
  return (
    <>
      {createPortal(<img className="dsd-character" src={maidWork} alt="" aria-hidden="true" />, document.body)}
      <PetOverlaySync
        controller={pet}
        hasCurrentError={Boolean(conversation?.lastAgentError || conversation?.promptError)}
        openSession={(id) => sessions.open(id as SessionId)}
        useSessions={useSessions as PetUseSessions}
      />
      <div className="dsd-root" ref={rootRef}>
        <button
          type="button"
          className={`dsd-trigger${wide ? '' : ' dsd-rail'}`}
          aria-label="DeepSeek Desktop 账户与使用情况"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="dsd-avatar" aria-hidden="true"><img className="dsd-avatarImage" src={whaleAvatar} alt="" /></span>
          {wide && <span className="dsd-triggerCopy">
            <span className="dsd-triggerName">DeepSeek</span>
            {primaryBalance && <span className="dsd-triggerBalance">{formatMoney(primaryBalance.currency, primaryBalance.totalBalance)}</span>}
          </span>}
          {wide && <Glyph kind="chevron" className={`dsd-chevron${open ? ' dsd-chevronOpen' : ''}`} />}
        </button>
      </div>

      {open && createPortal(<div ref={popoverRef} className="dsd-popover" style={popoverStyle} role="dialog" aria-label="DeepSeek Desktop 账户菜单">
        <div className="dsd-account">
          <span className="dsd-avatar" aria-hidden="true"><img className="dsd-avatarImage" src={whaleAvatar} alt="" /></span>
          <span className="dsd-accountCopy">
            <span className="dsd-accountTitle">DeepSeek API</span>
            <span className="dsd-accountSub">由官方 Harness 安全连接</span>
          </span>
        </div>

        <PetSettings controller={pet} />

        <section className="dsd-section" aria-labelledby="dsd-balance-title">
          <div className="dsd-sectionTitle" id="dsd-balance-title">
            <Glyph kind="wallet" />账户余额
            <button
              type="button"
              className="dsd-refresh"
              aria-label="刷新余额"
              disabled={balanceLoading}
              onClick={() => void loadBalance(true)}
            >
              <Glyph kind="refresh" className={balanceLoading ? 'dsd-spin' : ''} />
            </button>
            <a
              className="dsd-topUp"
              href="https://platform.deepseek.com/top_up"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="充值（在浏览器打开 DeepSeek 官方充值页）"
              title="请登录当前 API Key 所属的 DeepSeek 官方账号，充值不适用于第三方 API。"
            >充值</a>
          </div>
          <BalanceView balance={balance} loading={balanceLoading} />
        </section>

        <section className="dsd-section" aria-labelledby="dsd-usage-title">
          <div className="dsd-sectionTitle" id="dsd-usage-title"><Glyph kind="chart" />当前会话使用情况</div>
          {currentId ? <UsageView usage={usage} reasoning={reasoning} /> : <div className="dsd-muted">选择一个会话后显示统计。</div>}
        </section>

        <section className="dsd-section" aria-labelledby="dsd-effort-title">
          <div className="dsd-sectionTitle" id="dsd-effort-title"><Glyph kind="spark" />思考强度</div>
          <div className="dsd-effortHeader">
            <span className="dsd-effortModel">{models.value?.current.model ?? '未选择会话'}</span>
            <span className="dsd-effortValue">{selectedEffort ? effortLabel(selectedEffort) : modelStatus(models)}</span>
          </div>
          <input
            className="dsd-slider"
            type="range"
            min={0}
            max={Math.max(0, effort.choices.length - 1)}
            step={1}
            value={effort.index}
            disabled={effort.choices.length < 2 || models.phase === 'loading' || models.phase === 'selecting'}
            aria-label="思考强度"
            aria-valuetext={selectedEffort ? effortLabel(selectedEffort) : modelStatus(models)}
            onChange={(event) => void chooseEffort(Number(event.currentTarget.value))}
          />
          <div className="dsd-scale" aria-hidden="true">
            {effort.choices.length > 0
              ? effort.choices.map((choice) => <span key={choice.id}>{effortLabel(choice)}</span>)
              : <><span>快速</span><span>深度</span><span>极强</span></>}
          </div>
          {models.phase === 'error' && <div className="dsd-error">模型设置失败：{models.error}</div>}
        </section>

        <div className="dsd-actions">
          <button type="button" className="dsd-action" onClick={() => openPluginMarket(setOpen)}>
            <Glyph kind="plugin" />插件市场
          </button>
          <button type="button" className="dsd-action" onClick={() => openSettings(setOpen)}>
            <Glyph kind="settings" />设置
          </button>
          <button type="button" className="dsd-action dsd-actionDanger" onClick={() => window.deepseekDesktop?.quit()}>
            <Glyph kind="power" />退出 DeepSeek Desktop
          </button>
        </div>
      </div>, document.body)}
    </>
  )
}

function BalanceView({ balance, loading }: { balance: BalanceResult | undefined; loading: boolean }): ReactNode {
  if (loading && !balance) return <div className="dsd-muted">正在读取官方账户余额…</div>
  if (!balance) return <div className="dsd-muted">打开菜单后读取余额。</div>
  if (balance.status === 'unconfigured') return <div className="dsd-muted">尚未配置 DeepSeek API Key。</div>
  if (balance.status === 'unsupported') return <div className="dsd-muted">自定义 API 地址不支持查询官方余额。</div>
  if (balance.status === 'error') return <div className="dsd-error">{balanceError(balance.kind)}</div>
  if (balance.balances.length === 0) return <div className="dsd-muted">账户未返回余额币种。</div>

  const primary = balance.balances[0]
  return <>
    <div className="dsd-balance">
      <span className="dsd-money">{formatMoney(primary.currency, primary.totalBalance)}</span>
      <span className="dsd-balanceState">{balance.available ? '可用' : '账户不可用'}</span>
    </div>
    <div className="dsd-balanceList">
      {balance.balances.slice(1).map((entry) => <span key={entry.currency}>{formatMoney(entry.currency, entry.totalBalance)}</span>)}
      <span>充值 {formatMoney(primary.currency, primary.toppedUpBalance)}</span>
      <span>赠送 {formatMoney(primary.currency, primary.grantedBalance)}</span>
    </div>
  </>
}

function UsageView({ usage, reasoning }: {
  usage: TokenUsageProjection | undefined
  reasoning: ReasoningUsageProjection | undefined
}): ReactNode {
  const input = usage
    ? usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    : 0
  const cached = usage ? usage.cacheReadTokens + usage.cacheWriteTokens : 0
  return <div className="dsd-usageGrid">
    <Stat label="输入 Token" value={formatTokens(input)} />
    <Stat label="输出 Token" value={formatTokens(usage?.outputTokens ?? 0)} />
    <Stat label="缓存 Token" value={formatTokens(cached)} />
    <Stat label="推理 Token" value={formatTokens(reasoning?.reasoningTokens ?? 0)} />
  </div>
}

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return <div className="dsd-stat"><div className="dsd-statValue">{value}</div><div className="dsd-statLabel">{label}</div></div>
}

function useProjection<T>(sessions: ISessions, sessionId: SessionId | undefined, key: string): T | undefined {
  const face = useMemo(() => {
    if (!sessionId) return undefined
    return sessions.binding(sessionId)?.session.projections.faceOf(key) as ObservableSnapshot<T> | undefined
  }, [key, sessionId, sessions])
  return useSyncExternalStore(
    face ? face.subscribe.bind(face) : EMPTY_SUBSCRIBE,
    face ? face.getSnapshot.bind(face) : EMPTY_SNAPSHOT,
    face ? face.getSnapshot.bind(face) : EMPTY_SNAPSHOT
  )
}

function useConversation(sessions: ISessions, sessionId: SessionId | undefined): ConversationSnapshot | undefined {
  const face = useMemo(() => sessionId ? sessions.binding(sessionId)?.session : undefined, [sessionId, sessions])
  return useSyncExternalStore(
    face ? face.subscribe.bind(face) : EMPTY_SUBSCRIBE,
    face ? face.getSnapshot.bind(face) : EMPTY_SNAPSHOT,
    face ? face.getSnapshot.bind(face) : EMPTY_SNAPSHOT
  )
}

function effortState(directory: SessionModels | undefined): { choices: ModelReasoningEffort[]; index: number } {
  if (!directory) return { choices: [], index: 0 }
  const model = directory.groups
    .find((group) => group.id === directory.current.provider)
    ?.models.find((entry) => entry.id === directory.current.model)
  const all = model?.reasoning?.efforts ?? []
  const deepSeekOrder = ['off', 'high', 'max']
    .map((id) => all.find((entry) => entry.id === id))
    .filter((entry): entry is ModelReasoningEffort => entry !== undefined)
  const choices = deepSeekOrder.length === 3 ? deepSeekOrder : all.slice(0, 3)
  const current = directory.current.reasoningEffort ?? model?.reasoning?.defaultEffort
  return { choices, index: Math.max(0, choices.findIndex((choice) => choice.id === current)) }
}

function effortLabel(effort: ModelReasoningEffort): string {
  if (effort.id === 'off') return '快速'
  if (effort.id === 'high') return '深度'
  if (effort.id === 'max') return '极强'
  return effort.name
}

function modelStatus(state: ModelState): string {
  if (state.phase === 'loading') return '读取中'
  if (state.phase === 'selecting') return '切换中'
  if (state.phase === 'error') return '不可用'
  return '未提供'
}

function balanceError(kind: Extract<BalanceResult, { status: 'error' }>['kind']): string {
  if (kind === 'unauthorized') return 'API Key 无效，无法读取余额。'
  if (kind === 'forbidden') return '当前 API Key 无权读取余额。'
  if (kind === 'invalid-response') return '官方余额响应格式无法识别。'
  return '暂时无法读取余额，请稍后重试。'
}

function formatMoney(currency: string, amount: string): string {
  const value = Number(amount)
  if (!Number.isFinite(value)) return `${amount} ${currency}`
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(value)
  } catch {
    return `${amount} ${currency}`
  }
}

function formatTokens(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${trim(value / 1_000)}K`
  return `${trim(value / 1_000_000)}M`
}

function trim(value: number): string {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.[0-9])0+$/, '')
}

function openSettings(setOpen: (open: boolean) => void): void {
  setOpen(false)
  requestAnimationFrame(() => {
    const seat = document.querySelector<HTMLElement>('[data-slot="sidebar.settings"]')
    seat?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click()
  })
}

function openPluginMarket(setOpen: (open: boolean) => void): void {
  openSettings(setOpen)
  let attempts = 0
  const select = (): void => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')]
    const market = buttons.find((button) => button.textContent?.trim() === '插件市场')
    if (market) {
      market.click()
      return
    }
    buttons.find((button) => button.textContent?.trim() === '插件')?.click()
    if (attempts++ < 20) setTimeout(select, 50)
  }
  setTimeout(select, 50)
}

function positionPopover(trigger: HTMLDivElement | null, wide: boolean): CSSProperties {
  const rect = trigger?.getBoundingClientRect()
  if (!rect) return { left: 12, bottom: 12, width: wide ? 260 : 300 }
  const width = Math.min(wide ? rect.width : 300, window.innerWidth - 24)
  return {
    left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
    bottom: Math.max(12, window.innerHeight - rect.top + 8),
    width
  }
}

function installStyles(): void {
  if (typeof document === 'undefined' || document.querySelector('style[data-plugin-css="deepseek-desktop-companion"]')) return
  const style = document.createElement('style')
  style.dataset.plugin = '@deepseek-desktop/companion'
  style.dataset.pluginCss = 'deepseek-desktop-companion'
  style.textContent = CSS
  document.head.appendChild(style)
}

function Glyph({ kind, className }: { kind: 'chart' | 'chevron' | 'plugin' | 'power' | 'refresh' | 'settings' | 'spark' | 'wallet'; className?: string }): ReactNode {
  const paths: Record<typeof kind, ReactNode> = {
    chart: <><path d="M4 18V9"/><path d="M10 18V5"/><path d="M16 18v-7"/></>,
    chevron: <path d="m5 8 5 5 5-5"/>,
    plugin: <><path d="M7 3h6v4h4v6h-4v4H7v-4H3V7h4V3Z"/><path d="M7 7h6v6H7z"/></>,
    power: <><path d="M10 3v8"/><path d="M6.1 5.5a7 7 0 1 0 7.8 0"/></>,
    refresh: <><path d="M17 7V3l-1.8 1.8A7 7 0 1 0 17 12"/><path d="M17 3h-4"/></>,
    settings: <><circle cx="10" cy="10" r="2.4"/><path d="M16.2 11.7l1.2 1-.9 1.6-1.5-.5a6.7 6.7 0 0 1-1.4.8l-.3 1.6h-1.8l-.3-1.6a6.7 6.7 0 0 1-1.4-.8l-1.5.5-.9-1.6 1.2-1a6.8 6.8 0 0 1 0-1.6l-1.2-1 .9-1.6 1.5.5a6.7 6.7 0 0 1 1.4-.8l.3-1.6h1.8l.3 1.6a6.7 6.7 0 0 1 1.4.8l1.5-.5.9 1.6-1.2 1a6.8 6.8 0 0 1 0 1.6Z"/></>,
    spark: <><path d="m10 2 1.2 4.2L15 8l-3.8 1.8L10 14l-1.2-4.2L5 8l3.8-1.8L10 2Z"/><path d="m16 13 .7 2.3L19 16l-2.3.7L16 19l-.7-2.3L13 16l2.3-.7L16 13Z"/></>,
    wallet: <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H17v12H5.5A2.5 2.5 0 0 1 3 13.5v-7Z"/><path d="M14 9h4v3h-4a1.5 1.5 0 0 1 0-3Z"/></>
  }
  return <svg className={className} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>
}
