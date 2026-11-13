**metrics** · "Micelio · Fábrica" · 2026-10-24

| Issue | Times returned at gate 1 | Gate 3 rounds | Blocking findings | Verifier mismatches | False reds, gate 3 | False reds, gate 4 |
| --- | --- | --- | --- | --- | --- | --- |
| #34 | 1 | 0 | 0 | 0 | 0 | 0 |
| #35 | 0 | 5 | 4 | 1 | 0 | 0 |
| #36 | 1 | 4 | 2 | 0 | 2 | 0 |
| #37 | 0 | 4 | 0 | 0 | 0 | 1 |
| #38 | 2 | 3 | 2 | 0 | 0 | 0 |
| #39 | 0 | 0 | 0 | 0 | 0 | 0 |
| #40 | 1 | 2 | 1 | 3 | 0 | 0 |
| #41 | 0 | 0 | 0 | 0 | 0 | 0 |
| #42 | 0 | 1 | 0 | 0 | 0 | 0 |
| #43 | 0 | 0 | 0 | 0 | 0 | 0 |
| #44 | 0 | 0 | 0 | 0 | 0 | 0 |
| #45 | 0 | 0 | 0 | 0 | 0 | 0 |
| #9052 | 0 | 2 | 0 | 1 | 0 | 0 |
| Total | 5 | 21 | 9 | 5 | 2 | 1 |

| Pull request | Issue | Changed lines | Maintainer corrections | Red required checks | Findings with no log row (any kind) | Defects after merge | Minutes, diff | Minutes, report | Minutes, Docker or test | Silent approvals | Reports read first | Tokens, by role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #46 | #35 | 18 | 0 | 0 | 0 | 0 | 2 | 0 | — | 0 | 0 | worker 225000 (cache 1400000), reviewer 89000 (cache 400000) |
| #47 | #35 | 405 | 0 | 0 | 0 | 0 | 10 | 0 | — | 0 | 0 | worker 225000 (cache 1400000), reviewer 89000 (cache 400000) |
| #48 | #36 | 1804 | 0 | 0 | 0 | 0 | 12 | 0 | — | 0 | 0 | worker 190000 (cache 1200000), verifier 57000 (cache 300000) |
| #49 | #37 | 466 | 0 | 0 | 0 | 0 | 7 | 0 | — | 0 | 0 | worker 112000 (cache 700000) |
| #9053 | #9052 | 40 | 0 | 0 | 2 | 0 | — | — | — | 0 | — | — |
| Total |  | 2733 | 0 | 0 | 2 | 0 | 31 | 0 | 0 | 0 | 0 |  |

| Category of the Blocking findings | Findings |
| --- | --- |
| Correctness | 5 |
| uncategorised | 4 |

| Correction log rows | With a destination | Learnings converted |
| --- | --- | --- |
| 45 | 0 | 0 |

| Tokens of the milestone, by role | Input | Output | Cache reads | Input plus output |
| --- | --- | --- | --- | --- |
| worker | 420000 | 107000 | 3300000 | 527000 |
| verifier | 50000 | 7000 | 300000 | 57000 |
| reviewer | 80000 | 9000 | 400000 | 89000 |
| Total | 550000 | 123000 | 4000000 | 673000 |

**Tokens per merged pull request without a later fix:** 134600 (673000 tokens over 5 merged pull requests without a defect after merge)

**Tokens per merged pull request without a later fix, with cache reads:** 934600 (4673000 tokens over 5 merged pull requests without a defect after merge)
