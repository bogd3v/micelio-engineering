#!/usr/bin/env node
import { run } from './run.js'

// `factory-tools <command> …`: the bin of the package, `run` with the process around it.
const { code, stdout, stderr } = await run(process.argv.slice(2))
process.stdout.write(stdout)
process.stderr.write(stderr)
process.exitCode = code
