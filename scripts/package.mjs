// Zips dist/ into release/gannet-v<version>.zip for "Load unpacked" installs.
// manifest.json sits at the root of the zip, so the same file can go to the Chrome Web Store later.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

if (!existsSync('dist/manifest.json')) {
  console.error('dist/ is missing: run `npm run build` first.')
  process.exit(1)
}
const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'))
const out = resolve(`release/gannet-v${version}.zip`)
mkdirSync('release', { recursive: true })
rmSync(out, { force: true })
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', '*.map', '*.DS_Store'], { cwd: 'dist', stdio: 'inherit' })
console.log(`packaged ${out}`)
