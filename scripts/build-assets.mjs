import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const companion = resolve(root, 'packages', 'companion')
const companionOut = resolve(companion, 'lib')

await rm(companionOut, { recursive: true, force: true })
await mkdir(companionOut, { recursive: true })

await build({
  entryPoints: [resolve(companion, 'src', 'index.ts')],
  outfile: resolve(companionOut, 'index.js'),
  bundle: true,
  external: ['@deepseek-ai/*'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none'
})

const client = await build({
  entryPoints: [resolve(companion, 'src', 'client.tsx')],
  bundle: true,
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*'],
  format: 'cjs',
  platform: 'browser',
  target: 'chrome142',
  loader: {
    '.png': 'dataurl',
    '.webp': 'dataurl'
  },
  write: false,
  sourcemap: false,
  legalComments: 'none'
})

const body = client.outputFiles[0].text
await writeFile(
  resolve(companionOut, 'client.js'),
  `window.__ModuleLoader__.load({\n  id: "@deepseek-desktop/companion",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${indent(body, 4)}\n    return module.exports;\n  }\n});\n`,
  'utf8'
)

await build({
  entryPoints: [resolve(root, 'src', 'preload.ts')],
  outfile: resolve(root, 'out', 'preload.cjs'),
  bundle: true,
  external: ['electron'],
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none'
})

const manifest = JSON.parse(await readFile(resolve(companion, 'package.json'), 'utf8'))
const desktopManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (manifest.version !== desktopManifest.version) {
  throw new Error(`Companion version ${manifest.version} must match DeepSeek Desktop ${desktopManifest.version}.`)
}

function indent(value, spaces) {
  const prefix = ' '.repeat(spaces)
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n')
}
