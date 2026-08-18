import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPluginRecovery,
  markPluginRecoveryVerifying,
  pluginRecoveryRoot,
  readPluginRecovery,
  restorePluginRecovery,
  type PluginInstallRecoveryState,
} from '../src/plugin-install-recovery.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('plugin install recovery', () => {
  it('restores the exact profile files after a failed startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-plugin-recovery-'))
    roots.push(root)
    const userData = join(root, 'user-data')
    const dshHome = join(root, 'dsh')
    const profile = join(dshHome, 'profiles', 'web')
    const recovery = pluginRecoveryRoot(userData)
    await mkdir(join(recovery, 'backup'), { recursive: true })
    await mkdir(profile, { recursive: true })
    await writeFile(join(recovery, 'backup', 'package.json'), '{"before":true}\n')
    await writeFile(join(profile, 'package.json'), '{"after":true}\n')
    await writeFile(join(profile, 'pnpm-lock.yaml'), 'new lock\n')
    const state: PluginInstallRecoveryState = {
      version: 1,
      phase: 'awaiting-restart',
      receiptId: 'receipt_test',
      packageName: 'example-plugin',
      packageVersion: '1.0.0',
      files: [
        { name: 'package.json', present: true, mode: 0o600 },
        { name: 'pnpm-lock.yaml', present: false },
        { name: 'pnpm-workspace.yaml', present: false },
      ],
    }
    await writeFile(join(recovery, 'state.json'), JSON.stringify(state))

    const loaded = await readPluginRecovery(userData)
    expect(loaded).toEqual(state)
    await markPluginRecoveryVerifying(userData, loaded!)
    await restorePluginRecovery(userData, dshHome, { ...loaded!, phase: 'verifying' })

    await expect(readFile(join(profile, 'package.json'), 'utf8')).resolves.toBe('{"before":true}\n')
    await expect(readFile(join(profile, 'pnpm-lock.yaml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readPluginRecovery(userData)).resolves.toMatchObject({ phase: 'rolled-back' })
    await clearPluginRecovery(userData)
    await expect(readPluginRecovery(userData)).resolves.toBeUndefined()
  })
})
