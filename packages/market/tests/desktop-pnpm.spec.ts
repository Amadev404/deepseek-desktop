import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopMarketPnpm } from '../src/desktop-pnpm.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('desktop market package manager', () => {
  it('snapshots an install and can restore it by receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-market-pnpm-'))
    roots.push(root)
    const profile = join(root, 'profile')
    const recovery = join(root, 'recovery')
    const cli = join(root, 'fake-dsh.mjs')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), '{"before":true}\n')
    await writeFile(cli, "import {writeFileSync} from 'node:fs';import {join} from 'node:path';writeFileSync(join(process.cwd(),'package.json'),'{\"after\":true}\\n')")
    const pnpm = new DesktopMarketPnpm(process.execPath, cli, root, profile, recovery)
    const handle = await pnpm.runPluginInstall(
      ['add', 'example-plugin@1.0.0'],
      profile,
      { packageName: 'example-plugin', packageVersion: '1.0.0', receiptId: 'receipt_test' },
    )
    handle.stdout.resume()
    handle.stderr.resume()
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    await expect(readFile(join(recovery, 'state.json'), 'utf8')).resolves.toContain('awaiting-restart')
    await expect(pnpm.rollbackPluginInstall('receipt_test')).resolves.toBe(true)
    await expect(readFile(join(profile, 'package.json'), 'utf8')).resolves.toBe('{"before":true}\n')
  })
})
