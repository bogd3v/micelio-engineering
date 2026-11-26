import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import { todoNamesIssue } from '../src/todo-names-issue.js'

const tester = new RuleTester()

describe('micelio/todo-names-issue', () => {
  it('accepts TODO(#123): and rejects a bare TODO', () => {
    tester.run('todo-names-issue', todoNamesIssue, {
      valid: [
        '// TODO(#123): split the parser',
        '/* TODO(bogd3v/micelio-cms#45): read the new field */',
        '/**\n * Reads the file.\n * TODO(#7): cache it\n */\nexport {}',
        '// The TODOs of a file are counted elsewhere',
        'const note = "TODO: in a string, not a comment"',
      ],
      invalid: [
        {
          code: '// TODO: split the parser',
          errors: [{ messageId: 'missingIssue', line: 1, column: 4, endColumn: 8 }],
        },
        { code: '// TODO split the parser', errors: [{ messageId: 'missingIssue' }] },
        { code: '// TODO(#123) without the colon', errors: [{ messageId: 'missingIssue' }] },
        { code: '// TODO(123): without the hash', errors: [{ messageId: 'missingIssue' }] },
        {
          code: '// TODO(micelio#123): without the owner',
          errors: [{ messageId: 'missingIssue' }],
        },
        {
          code: 'const a = 1\n/*\n * TODO(#1): fine\n * TODO: not fine\n */',
          errors: [{ messageId: 'missingIssue', line: 4, column: 4 }],
        },
        {
          code: '// TODO: one, TODO: two',
          errors: [{ messageId: 'missingIssue' }, { messageId: 'missingIssue' }],
        },
      ],
    })
  })
})
