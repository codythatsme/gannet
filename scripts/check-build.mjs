// The content script is loaded as a classic script, so it must not contain ES module syntax.
import { readFileSync, copyFileSync, existsSync } from 'node:fs'
const content = readFileSync('dist/content.js', 'utf8')
if (/^\s*import[\s{*]|^\s*export\s/m.test(content)) {
  console.error('dist/content.js contains import/export statements; keep src/content/jira.ts free of imports.')
  process.exit(1)
}
if (!existsSync('dist/manifest.json')) copyFileSync('public/manifest.json', 'dist/manifest.json')

// package.json and the manifest each carry a version; releases are tagged from the manifest's.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version
const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8')).version
if (pkg !== manifest) {
  console.error(`Version mismatch: package.json is ${pkg} but public/manifest.json is ${manifest}.`)
  process.exit(1)
}
console.log('build ok: load the dist/ folder as an unpacked extension')
