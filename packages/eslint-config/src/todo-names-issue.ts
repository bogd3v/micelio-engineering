import type { Rule } from 'eslint'

/** The marker as a word: the plural and a longer identifier that starts with it are other words. */
const TODO = /\bTODO\b/g

/** What follows the marker when it names its issue: `(#123):` or `(owner/repo#123):`. */
const NAMES_ISSUE = /^\((?:[\w.-]+\/[\w.-]+)?#\d+\):/

/**
 * The rule `micelio/todo-names-issue`: every to-do marker in a comment is written `TODO(#123):` or
 * `TODO(owner/repo#123):`, with the number of its issue (standard, TypeScript profile, section 4,
 * "Comments and suppressions").
 *
 * @remarks
 * It reads every comment of the file, line and block, and reports each marker that is not followed
 * by its issue, so a comment with two of them can fail twice.
 */
export const todoNamesIssue: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require every TODO comment to name its issue: TODO(#123): or TODO(owner/repo#123):',
    },
    schema: [],
    messages: {
      missingIssue:
        'A TODO names its issue: write TODO(#123): or TODO(owner/repo#123): (standard, TypeScript profile, section 4).',
    },
  },
  create(context) {
    return {
      Program() {
        const { sourceCode } = context
        for (const comment of sourceCode.getAllComments()) {
          // The value starts after the `//` or `/*` that opens the comment.
          const valueStart = (comment.range ?? [0])[0] + 2
          for (const match of comment.value.matchAll(TODO)) {
            const end = match.index + match[0].length
            if (NAMES_ISSUE.test(comment.value.slice(end))) continue
            context.report({
              loc: {
                start: sourceCode.getLocFromIndex(valueStart + match.index),
                end: sourceCode.getLocFromIndex(valueStart + end),
              },
              messageId: 'missingIssue',
            })
          }
        }
      },
    }
  },
}
