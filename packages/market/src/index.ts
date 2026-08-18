import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  registerMarketRoutes,
  registerMarketSettings,
  type MarketDesktopPlugins,
} from './host/routes.js'
import { createRestrictedHttpClient } from './network/restricted-http.js'
import {
  createNpmRegistryVerifier,
  MarketInstallService,
} from './install/service.js'
import { DesktopMarketPnpm } from './desktop-pnpm.js'
import { DesktopMarketPlugins } from './desktop-plugins.js'

export const name = 'community-market'
export const inject = ['webServer', 'settings']

interface DesktopActionsCapability {
  openTerminal(): void
  requestRestart(): Promise<void>
}

const npmRegistryHttp = createRestrictedHttpClient({
  // This is a compiled-in official registry hostname, never provider input.
  syntheticProxyHostnames: ['registry.npmjs.org'],
})

export function apply(ctx: Context): void {
  const scope = registerMarketSettings(ctx)
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const profileDir = join(dshHome, 'profiles', 'web')
  const userData = process.env.DEEPSEEK_DESKTOP_USER_DATA?.trim()
  if (!userData) throw new Error('DeepSeek Desktop did not provide its user-data directory.')
  const pnpm = new DesktopMarketPnpm(
    process.execPath,
    process.argv[1] ?? '',
    dshHome,
    profileDir,
    join(userData, 'plugin-install-recovery'),
  )
  const installService = new MarketInstallService(
    scope,
    () => ({ name: 'web', dir: profileDir }),
    pnpm,
    createNpmRegistryVerifier(npmRegistryHttp),
  )
  const desktopActions: DesktopActionsCapability = {
    openTerminal: () => openTerminal(profileDir, dshHome),
    requestRestart: async () => { process.exit(75) },
  }
  const desktopPlugins: MarketDesktopPlugins = new DesktopMarketPlugins(profileDir)
  const installProvider = { get: () => installService }
  const desktopActionsProvider = { get: () => desktopActions }
  const desktopPluginsProvider = { get: () => desktopPlugins }
  ctx.effect(
    () => registerMarketRoutes(ctx, scope, installProvider, desktopActionsProvider, desktopPluginsProvider),
    'community-market: routes',
  )
  ctx.effect(() => () => installService.dispose(), 'community-market: install service')
}

function openTerminal(cwd: string, dshHome: string): void {
  const launch = (command: string, args: string[]) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, DSH_HOME: dshHome },
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.unref()
    return child
  }

  if (process.platform !== 'win32') {
    launch(process.env.SHELL || 'sh', []).once('error', () => {})
    return
  }

  launch('pwsh.exe', ['-NoExit']).once('error', () => {
    launch('powershell.exe', ['-NoExit']).once('error', () => {})
  })
}

export { marketRoutes } from './host/routes.js'
export { BUILT_IN_PROVIDERS, DefaultCatalogService } from './catalog/service.js'
export { dsh1024StoreAdapter } from './adapters/dsh-1024store.js'
export { dshfindAdapter } from './adapters/dshfind.js'
export type * from './api-types.js'
export * from './contracts/index.js'
