#!/usr/bin/env node
import { lintStandard } from './standard.js'

// `micelio-lint-standard [root]`: the `lint:standard` script of every Micelio repository.
const result = lintStandard(process.argv[2] ?? process.cwd())
if (result.ok) {
  process.stdout.write(`${result.message}\n`)
} else {
  console.error(`error: ${result.message}`)
  process.exitCode = 1
}
