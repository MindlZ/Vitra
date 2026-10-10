// usage: node scripts/typecheck.mjs [node|web]
// the real tsconfigs fail under TS 7 (baseUrl, composite), so this checks against patched copies in the temp dir
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..').replaceAll('\\', '/')
const only = process.argv[2]
const dir = mkdtempSync(join(tmpdir(), 'vitra-tsc-'))

function patched(name) {
  const config = JSON.parse(readFileSync(join(root, name), 'utf8'))
  const opts = config.compilerOptions
  opts.composite = false
  delete opts.baseUrl
  opts.paths = Object.fromEntries(
    Object.entries(opts.paths ?? {}).map(([k, v]) => [k, v.map((p) => `${root}/${p}`)])
  )
  if (opts.types?.includes('node')) opts.typeRoots = [`${root}/node_modules/@types`]
  config.include = config.include.map((p) => `${root}/${p}`)
  const out = join(dir, name)
  writeFileSync(out, JSON.stringify(config))
  return out
}

let failed = false
for (const [label, name] of [['node', 'tsconfig.node.json'], ['web', 'tsconfig.web.json']]) {
  if (only && only !== label) continue
  const r = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', patched(name), '--pretty', 'false'], {
    encoding: 'utf8'
  })
  const out = (r.stdout + r.stderr).trim()
  console.log(`${label}: ${r.status === 0 ? 'ok' : 'errors'}${out ? '\n' + out : ''}`)
  if (r.status !== 0) failed = true
}
rmSync(dir, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
