// The titles of the tests of a source file, read without running it: the rule of `lint-draft` on
// the tests an issue's criteria name (`packages/factory-tools/README.md`, `lint-draft`).

/** The value of the escape that starts at `text[i]` (after the backslash) and where it ends. */
function unescape(text: string, i: number): { value: string; end: number } {
  const c = text[i] ?? ''
  const simple: Record<string, string> = {
    n: '\n',
    t: '\t',
    r: '\r',
    b: '\b',
    f: '\f',
    v: '\v',
    '0': '\0',
  }
  if (c === 'x' && /^[0-9a-fA-F]{2}/.test(text.slice(i + 1, i + 3))) {
    return { value: String.fromCharCode(parseInt(text.slice(i + 1, i + 3), 16)), end: i + 3 }
  }
  if (c === 'u') {
    const braced = /^\{([0-9a-fA-F]+)\}/.exec(text.slice(i + 1))
    if (braced) {
      return {
        value: String.fromCodePoint(parseInt(braced[1] ?? '0', 16)),
        end: i + 1 + braced[0].length,
      }
    }
    if (/^[0-9a-fA-F]{4}/.test(text.slice(i + 1, i + 5))) {
      return { value: String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16)), end: i + 5 }
    }
  }
  return { value: simple[c] ?? c, end: i + 1 }
}

/**
 * The string literal that starts at `source[at]` (a quote) when it is the whole first argument: its
 * value and the index after it, or `null` for a template with `${`, or a literal that is followed
 * by anything but `,` or `)`.
 */
function stringLiteralAt(source: string, at: number): { value: string; end: number } | null {
  const quote = source[at]
  let value = ''
  let i = at + 1
  while (i < source.length) {
    const c = source[i] ?? ''
    if (c === '\\') {
      const escape = unescape(source, i + 1)
      value += escape.value
      i = escape.end
      continue
    }
    if (c === quote) {
      const after = /^\s*([,)])/.exec(source.slice(i + 1))
      return after ? { value, end: i + 1 } : null
    }
    if (quote === '`' && c === '$' && source[i + 1] === '{') return null
    if (c === '\n' && quote !== '`') return null
    value += c
    i++
  }
  return null
}

/** The index after the bracket group that opens at `source[at]`, skipping the strings in it; `-1` when it never closes. */
function skipGroup(source: string, at: number): number {
  let depth = 0
  for (let i = at; i < source.length; i++) {
    const c = source[i] ?? ''
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++
    } else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c) && --depth === 0) return i + 1
  }
  return -1
}

/**
 * The titles of the tests of a file: the first argument, when it is a string literal, of each call
 * `it(`, `test(`, `it.each(…)(` and `test.each(…)(`; `.skip`, `.todo` and the rest are not read.
 *
 * @param source - The text of a test file.
 */
export function testTitles(source: string): string[] {
  const titles: string[] = []
  for (const call of source.matchAll(/(?<![\w$.])(?:it|test)(\.each)?\s*(?=[(`])/g)) {
    let at = (call.index ?? 0) + call[0].length
    if (call[1] !== undefined) {
      at = skipGroup(source, at)
      if (at === -1) continue
      while (/\s/.test(source[at] ?? '')) at++
    }
    if (source[at] !== '(') continue
    at++
    while (/\s/.test(source[at] ?? '')) at++
    if (!'\'"`'.includes(source[at] ?? '\0')) continue
    const literal = stringLiteralAt(source, at)
    if (literal) titles.push(literal.value)
  }
  return titles
}
