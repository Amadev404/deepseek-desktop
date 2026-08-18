import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  MarketDesktopPluginBundle,
  MarketDesktopPluginDisablePreview,
  MarketDesktopPluginEnablePreview,
  MarketDesktopPlugins,
} from './host/routes.js'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

export class DesktopMarketPlugins implements MarketDesktopPlugins {
  constructor(private readonly profileDir: string, private readonly profileName = 'web') {}

  list(): readonly MarketDesktopPluginBundle[] {
    const manifest = JSON.parse(readFileSync(join(this.profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = manifest.dsh?.profile?.bundles
    if (!Array.isArray(bundles)) return []
    return bundles
      .filter((name): name is string => typeof name === 'string' && PACKAGE_NAME.test(name))
      .map((packageName) => ({
        bundleId: `bundle_${createHash('sha256').update(packageName).digest('base64url').slice(0, 32)}`,
        packageName,
        status: 'active' as const,
        mutable: false,
      }))
  }

  previewDisable(_bundleId: string): MarketDesktopPluginDisablePreview {
    throw new Error(`Plugin disabling is not supported by the ${this.profileName} profile.`)
  }

  executeDisable(_previewId: string): Promise<{ readonly packageName: string }> {
    return Promise.reject(new Error(`Plugin disabling is not supported by the ${this.profileName} profile.`))
  }

  previewEnable(_bundleId: string): MarketDesktopPluginEnablePreview {
    throw new Error(`Plugin enabling is not supported by the ${this.profileName} profile.`)
  }

  executeEnable(_previewId: string): Promise<{ readonly packageName: string }> {
    return Promise.reject(new Error(`Plugin enabling is not supported by the ${this.profileName} profile.`))
  }

  isDisabled(_packageName: string): boolean {
    return false
  }

  disabledPackageNames(): readonly string[] {
    return []
  }
}
