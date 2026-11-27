/**
 * The large set of issue #512, generated and seeded, never recorded from live issues: four pairs
 * with the issue counts and body lengths measured on 2026-11-27 (83 issues, 39 of them open, 728793
 * characters of bodies, the largest 21997), each open body with a `## Depends on` and a
 * `### Progress` section as the factory writes them, and the 1500 comments and 1.9 MB of the grown
 * set of issue #486, whose fifth pair's comments are with `micelio` milestone 18.
 */

/** The moment of the set's reads. */
export const NOW = Date.parse('2026-11-24T16:00:00Z')
export const MAINTAINER = 'ale9420'
const MIN = 60_000

interface Size {
  space: string
  repo: string
  milestone: number
  issues: number
  open: number
  chars: number
  largest: number
  comments: number
  commentChars: number
  commentLargest: number
}
const size = (
  space: string,
  repo: string,
  milestone: number,
  bodies: [issues: number, open: number, chars: number, largest: number],
  comments: [comments: number, chars: number, largest: number]
): Size => ({
  space,
  repo: `bogd3v/${repo}`,
  milestone,
  issues: bodies[0],
  open: bodies[1],
  chars: bodies[2],
  largest: bodies[3],
  comments: comments[0],
  commentChars: comments[1],
  commentLargest: comments[2],
})
const SIZES = [
  size('cms', 'micelio-cms', 12, [45, 32, 371_996, 21_997], [840, 1_100_000, 25_958]),
  size('micelio', 'micelio', 18, [16, 3, 134_422, 15_774], [430, 550_000, 11_131]),
  size('plugin', 'micelio-plugin-core', 8, [16, 1, 139_758, 17_095], [90, 80_000, 5_422]),
  size('plugin', 'micelio-plugin-core', 4, [6, 3, 82_617, 19_810], [140, 170_000, 19_475]),
]

export const SPACES = ['cms', 'micelio', 'plugin'].map((name) => {
  const pairs = SIZES.filter((s) => s.space === name).map((s, i) => ({
    repo: s.repo,
    milestone: s.milestone,
    epic: null,
    tag: i === 0 ? '' : 'two',
  }))
  return { name, repo: pairs[0]!.repo, milestone: pairs[0]!.milestone, pairs }
})

export interface SeededIssue {
  number: number
  open: boolean
  updated_at: string
  text: string
}
export interface SeededComment {
  id: number
  updated_at: string
  created_at: string
  text: string
}
export type LargeSet = ReturnType<typeof largeSet>

/** `count` lengths that add up to `total`, the first one `largest`, the others varying in pairs. */
function lengths(count: number, total: number, largest: number, random: () => number): number[] {
  const each = Math.floor((total - largest) / (count - 1))
  const made = [largest]
  let swing = 0
  for (let i = 1; i < count; i += 1) {
    let length = each
    if (i < count - 1 && i % 2 === 1) {
      swing = Math.floor(random() * each * 0.5)
      length += swing
    } else {
      length -= swing
      swing = 0
    }
    made.push(length)
  }
  made[count - 1]! += total - made.reduce((sum, n) => sum + n, 0)
  return made
}

const pad = (head: string, line: string, length: number): string =>
  `${head}${line.repeat(Math.ceil(length / line.length))}`.slice(0, length)

/** An issue's body of exactly `length` characters; an open one ends with the factory's sections. */
function bodyOf(number: number, open: boolean, depends: number, length: number): string {
  const line = 'A line of what to build, with `code` and a list, as the planner writes it.\n'
  if (!open) return pad('## Why\n\n', line, length)
  const tail =
    `\n## Depends on\n\n- #${depends} (what it needs first)\n\n### Progress\n\n` +
    `- Worker started on 2026-11-24: worktree \`~/Git/wt-${number}\`, packet directory ` +
    `\`~/.cache/factory/packets/${number}\`, branch \`fix/factory-${number}\`, draft ` +
    `\`~/.cache/factory/packets/${number}/draft.md\`.\n`
  return `${pad('## Why\n\n', line, length - tail.length)}${tail}`
}

/** The first lines of one issue's comments: a sign-off, a decision, a held check or an open pull request. */
const story = (kind: number, number: number): string[] =>
  [
    [
      '**Gate 1 (master): pass**\n\nlane: full\nthe reason of the lane',
      '**Gate 2, round 1 (worker)** · pass',
      '**Gate 3, round 1 (reviewer)** · 0 Blocking, 1 Important',
      '**Gate 4, round 1 (verifier)** · 0 mismatches',
    ],
    [
      '**Gate 1 (master): pass**\n\nlane: normal',
      `**Decision needed** · #${number}\nWhich one?\n- A: one\n- B: two`,
    ],
    [
      '**Gate 1 (master): pass**\n\nlane: normal',
      `held | 2026-11-24 | #${number} | G4 | 3 tests timed out`,
    ],
    [
      '**Gate 1 (master): pass**\n\nlane: express',
      '**Gate 2, round 1 (worker)** · pass',
      'Progress updated by the master:\n\npull request #9 opened',
    ],
  ][kind]!

/**
 * The set of a seed. Two seeds share no comment id and no `updated_at`, so that what the mod keeps
 * of one set is not what it reads of another.
 */
export function largeSet(seed: number) {
  // A linear congruential generator: the same set at every run.
  let state = seed
  const random = () => (state = (state * 48_271) % 2_147_483_647) / 2_147_483_647
  let id = seed * 10_000
  const stamp = new Date(NOW - 3000 * MIN + seed).toISOString()
  return SIZES.map((pair, p) => {
    const numbers = Array.from({ length: pair.issues }, (_, i) => p * 1000 + i + 1)
    const sizes = lengths(pair.issues, pair.chars, pair.largest, random)
    // The open issues come first; each names the next open one, the last the first closed one.
    const issues: SeededIssue[] = numbers.map((number, i) => ({
      number,
      open: i < pair.open,
      updated_at: stamp,
      text: bodyOf(number, i < pair.open, number + 1, sizes[i]!),
    }))
    const comments = new Map<number, SeededComment[]>(numbers.map((n) => [n, []]))
    const each = lengths(pair.comments, pair.commentChars, pair.commentLargest, random)
    for (let i = 0; i < pair.comments; i += 1) {
      const number = numbers[i % numbers.length]!
      const list = comments.get(number)!
      const filler = [
        'Progress updated by the master:\n',
        `tokens | 2026-11-24 | #${number} | worker | sonnet | 10 | 20 | 1`,
        'A note.\n',
      ]
      const head = story(number % 4, number)[list.length] ?? filler[i % filler.length]!
      const text = pad(
        `${head}\n`,
        '+ a line of the diff of the body, as a master posts it\n',
        each[i]!
      )
      const at = new Date(NOW - (2000 - i) * MIN + seed).toISOString()
      id += 1
      list.push({ id, updated_at: at, created_at: at, text })
    }
    return { pair, issues, comments }
  })
}

/** What the set holds: its counts and lengths, for the test that checks them. */
export function totals(set: LargeSet) {
  const issues = set.flatMap((g) => g.issues)
  const comments = set.flatMap((g) => [...g.comments.values()].flat())
  const sum = (list: { text: string }[]) => list.reduce((n, x) => n + x.text.length, 0)
  return {
    issues: issues.length,
    open: issues.filter((i) => i.open).length,
    chars: sum(issues),
    largest: Math.max(...issues.map((i) => i.text.length)),
    comments: comments.length,
    commentChars: sum(comments),
  }
}

/** How a set is turned into the objects a read of GitHub gives. */
export interface Make {
  issue: (issue: SeededIssue, repo: string) => object
  comment: (comment: SeededComment) => object
}

const fields = (issue: SeededIssue) => ({
  number: issue.number,
  title: `issue ${issue.number}`,
  state: issue.open ? 'open' : 'closed',
  created_at: new Date(NOW - 3000 * MIN).toISOString(),
  ...(issue.open ? {} : { closed_at: new Date(NOW - 60 * MIN).toISOString() }),
})

/** Objects of a read with no `updated_at`: nothing of them is kept, so each build is a fresh one. */
export const fresh: Make = {
  issue: (issue) => ({ ...fields(issue), body: issue.text }),
  comment: ({ id, created_at, text }) => ({
    id,
    created_at,
    user: { login: MAINTAINER },
    body: text,
  }),
}

/**
 * Objects of a read that count the reads of their bodies. `again` forgets the objects, so that the
 * next read gives new objects of the same issues and comments.
 */
export function counting() {
  const issueReads = new Map<string, number>()
  const commentReads = new Map<number, number>()
  const objects = new Map<string, object>()
  const once = (key: string, make: () => object): object => {
    const object = objects.get(key) ?? make()
    objects.set(key, object)
    return object
  }
  const make: Make = {
    issue: (issue, repo) => {
      const key = `${repo}#${issue.number}`
      return once(key, () => ({
        ...fields(issue),
        updated_at: issue.updated_at,
        get body() {
          issueReads.set(key, (issueReads.get(key) ?? 0) + 1)
          return issue.text
        },
      }))
    },
    comment: ({ text, ...keys }) =>
      once(String(keys.id), () => ({
        ...keys,
        user: { login: MAINTAINER },
        get body() {
          commentReads.set(keys.id, (commentReads.get(keys.id) ?? 0) + 1)
          return text
        },
      })),
  }
  return { make, issueReads, commentReads, again: () => objects.clear() }
}

/** The reads of the three spaces, as `buildGithub` takes them. */
export function readsOf(set: LargeSet, make: Make) {
  const part = (g: LargeSet[number]) => ({
    issues: g.issues.map((issue) => make.issue(issue, g.pair.repo)),
    comments: Object.fromEntries(
      [...g.comments].map(([number, list]) => [number, list.map((c) => make.comment(c))])
    ),
  })
  return Object.fromEntries(
    SPACES.map((space) => {
      const [first, ...others] = set.filter((g) => g.pair.space === space.name).map(part)
      const at = new Date(NOW).toISOString()
      return [space.name, { at, ...first!, maintainer: MAINTAINER, others }]
    })
  )
}
