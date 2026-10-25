#!/usr/bin/env node
import { runReady } from './ready.js'
import { run } from './run.js'

// `factory-tools <command> …`: the bin of the package, `run` with the process around it.
const argv = process.argv.slice(2)
const { code, stdout, stderr } = await (argv[0] === 'issue-ready' ? runReady(argv) : run(argv))
process.stdout.write(stdout)
process.stderr.write(stderr)
process.exitCode = code
