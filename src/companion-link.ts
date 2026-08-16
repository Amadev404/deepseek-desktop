import { lstat, mkdir, readlink, rmdir, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export async function ensureCompanionLink(dshHome: string, companionDir: string): Promise<string> {
  const link = join(dshHome, 'profiles', 'node_modules', '@deepseek-desktop', 'companion')
  const target = resolve(companionDir)
  await mkdir(dirname(link), { recursive: true })

  try {
    const stat = await lstat(link)
    if (!stat.isSymbolicLink()) {
      throw new Error(`DeepSeek Desktop Companion path is a real directory and will not be overwritten:\n${link}`)
    }
    if (resolve(await readlink(link)) === target) return link
    await rmdir(link)
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  return link
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
