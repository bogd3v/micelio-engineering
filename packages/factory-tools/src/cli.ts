#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { runBackfill } from './fields.js'
import { runLintDraft } from './lint-draft.js'
import { defaultGh, runReady } from './ready.js'
import { run } from './run.js'

// `factory-tools <command> …`: the bin of the package, `run` with the process around it.
const argv = process.argv.slice(2)
const { code, stdout, stderr } = await (argv[0] === 'issue-ready'
  ? runReady(argv)
  : argv[0] === 'lint-draft'
    ? runLintDraft(argv)
    : argv[0] === 'project-fields-backfill'
      ? runBackfill(argv, { gh: defaultGh, readText: (path) => readFile(path, 'utf8') })
      : run(argv))
process.stdout.write(stdout)
process.stderr.write(stderr)
process.exitCode = code
