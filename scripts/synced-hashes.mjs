// Writes the SHA-256 of every file `.github/standard-sync.json` syncs (read from `template/`) into
// the `files` key of packages/eslint-config/standard-hashes.json, next to the standard's. Run it
// after changing a synced file; the tests fail when the file and the hashes disagree.
//
//   node scripts/synced-hashes.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashOf } from '../packages/eslint-config/dist/standard.js'
import { ROOT, syncedFiles } from './synced-files.mjs'

const HASHES = join(ROOT, 'packages/eslint-config/standard-hashes.json')

const files = {}
for (const path of syncedFiles()) {
  files[path] = hashOf(readFileSync(join(ROOT, 'template', path)))
}
const current = JSON.parse(readFileSync(HASHES, 'utf8'))
writeFileSync(HASHES, `${JSON.stringify({ ...current, files }, null, 2)}\n`)
console.log(`${Object.keys(files).length} synced files hashed`)
