# feat(page): reading time, excerpt and path of a page

## Problem

Editors cannot see how long a page is, or what its excerpt and path will be, before they publish it.

## What changes

`src/page.mjs` gains `readingMinutes`, `excerpt` and `pagePath`, exported from `src/index.mjs`.

## For review

One module, no dependencies.

## Tests

The command, run in the project root:

```text
$ npm test
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

## Instructions that were wrong or missing

Nothing.

## What I could not verify

Nothing.

Closes #1
