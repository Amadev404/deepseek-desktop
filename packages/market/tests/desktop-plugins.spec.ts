import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopMarketPlugins } from '../src/desktop-plugins.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('desktop plugin inventory', () => {
  it('reads the official profile bundle list without making it mutable', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'deepseek-market-profile-'))
    roots.push(profile)
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'example-plugin', '../invalid'] } },
    }))
    const inventory = new DesktopMarketPlugins(profile).list()
    expect(inventory.map((item) => item.packageName)).toEqual(['@deepseek-ai/dsh-base', 'example-plugin'])
    expect(inventory.every((item) => item.status === 'active' && item.mutable === false)).toBe(true)
    expect(new DesktopMarketPlugins(profile).list()).toEqual(inventory)
  })
})
