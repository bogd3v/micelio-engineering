#!/usr/bin/env node
import { lintEe } from './ee.js'

// `micelio-lint-ee [--allow <path>]... [root]`: the `lint:ee` script of a repository born from `template/`.
const allow: string[] = []
let root = process.cwd()
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string
  if (arg === '--allow') {
    const path = args[++i]
    if (path === undefined) {
      console.error('error: --allow needs a path')
      process.exit(2)
    }
    allow.push(path)
  } else {
    root = arg
  }
}
const result = lintEe(root, allow)
if (result.ok) {
  process.stdout.write(`${result.message}\n`)
} else {
  for (const failure of result.failures) console.error(`error: ${failure}`)
  console.error(result.message)
  process.exitCode = 1
}
