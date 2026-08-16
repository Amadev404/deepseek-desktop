import { lstat, mkdir, mkdtemp, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureCompanionLink } from '../src/companion-link.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-desktop-link-'))
  roots.push(root)
  return root
}

describe('ensureCompanionLink', () => {
  it('creates and reuses the profile module Junction', async () => {
    const root = await tempRoot()
    const target = join(root, 'app', 'companion')
    await mkdir(target, { recursive: true })

    const link = await ensureCompanionLink(join(root, '.dsh'), target)
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(resolve(await readlink(link))).toBe(resolve(target))
    await expect(ensureCompanionLink(join(root, '.dsh'), target)).resolves.toBe(link)
  })

  it('refuses to overwrite a real directory', async () => {
    const root = await tempRoot()
    const target = join(root, 'app', 'companion')
    const conflict = join(root, '.dsh', 'profiles', 'node_modules', '@deepseek-desktop', 'companion')
    await mkdir(target, { recursive: true })
    await mkdir(conflict, { recursive: true })

    await expect(ensureCompanionLink(join(root, '.dsh'), target)).rejects.toThrow('real directory')
  })
})
