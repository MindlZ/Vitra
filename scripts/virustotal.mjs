// scans a file on VirusTotal and prints the release-notes line.
//   node scripts/virustotal.mjs dist/Vitra-Setup-X.Y.Z.exe
// key from the VT_API_KEY environment variable (never in the repo: it's public).
// a file VirusTotal already knows is just looked up, not re-uploaded

import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { basename } from 'path'

const API = 'https://www.virustotal.com/api/v3'
// public api: 4 requests a minute
const POLL_MS = 30000
const MAX_POLLS = 40

const file = process.argv[2]
const key = process.env.VT_API_KEY
if (!file) {
  console.error('usage: node scripts/virustotal.mjs <file>')
  process.exit(1)
}
if (!key) {
  console.error('VT_API_KEY is not set')
  process.exit(1)
}

const headers = { 'x-apikey': key }
const data = readFileSync(file)
const sha = createHash('sha256').update(data).digest('hex')
const link = `https://www.virustotal.com/gui/file/${sha}`
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function api(path, init = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers }
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

async function report() {
  const { status, body } = await api(`/files/${sha}`)
  if (status === 404) return null
  if (status !== 200) throw new Error(`lookup failed: ${status} ${body.error?.message ?? ''}`)
  return body.data.attributes
}

console.log(`${basename(file)}\nSHA-256 ${sha}`)

let attributes = await report()
if (!attributes) {
  console.log('Uploading...')
  // over 32 MB needs a one-off upload url
  const { body: urlBody } = await api('/files/upload_url')
  const form = new FormData()
  form.append('file', new Blob([data]), basename(file))
  const { status, body } = await api(urlBody.data, { method: 'POST', body: form })
  if (status !== 200) throw new Error(`upload failed: ${status} ${body.error?.message ?? ''}`)
  const analysis = body.data.id

  for (let i = 0; i < MAX_POLLS; i++) {
    await wait(POLL_MS)
    const { body: poll } = await api(`/analyses/${analysis}`)
    const state = poll.data?.attributes?.status
    process.stdout.write(`  ${state ?? 'waiting'}\n`)
    if (state === 'completed') break
  }
  attributes = await report()
}

const stats = attributes?.last_analysis_stats
if (!stats) {
  console.log(`No result yet; check ${link}`)
  process.exit(1)
}
const detections = stats.malicious
const engines = stats.malicious + stats.suspicious + stats.undetected + stats.harmless
console.log(`Detections ${detections} / ${engines}${stats.suspicious ? ` (${stats.suspicious} suspicious)` : ''}`)
console.log('')
console.log(`VirusTotal: [${detections} / ${engines} detections](${link})`)
