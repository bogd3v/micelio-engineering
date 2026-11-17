# Design of the factory mod for the Herdr desktop app

The designs the maintainer approved for the Herdr mod of the factory (epic "Epic: the maintainer runs the factory from a Herdr mod"). An issue of that epic names, under `## Designs`, the files of this folder it builds or is verified against. The canvas they were exported from is the maintainer's (<https://claude.ai/artifact/BttBBw2qviYwYWYPDGoxTd>); an agent cannot open it, so this folder is the copy an agent reads. When the canvas changes, the maintainer's planner session exports it again in a `docs(herdr)` pull request; nobody edits these files by hand.

## What is here

| File                    | What it is                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screens/<Name>.png`    | One screen at its real size, exported on 2026-11-17 with Chakra Petch and JetBrains Mono. What an agent looks at                                                           |
| `source/<Name>.dc.html` | The markup of that screen: every text, order, size and colour as inline styles, and the sample data in its script. What an agent reads for exact values. Not runnable here |
| `tokens.json`           | The colours of the dark and the light theme by name, what each means, and the two typefaces                                                                                |
| `cats.json`             | The source of the agent cats: the paths of each role's figure, the eyes and marks of each state, the crops and the badge icons                                             |

## The screens

| Screen                      | Shows                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Main`, `MainLight`         | The window: Herdr's spaces and panes, the factory panel docked on the right (380 px) and a desktop alert, in the dark and the light theme                                                                                                                               |
| `Panel`, `PanelLight`       | The side panel, every section open: header (sync age, theme toggle, Customize), summary strip (load, heavy, workers, needs, orphans), Pause new workers, Reserve a slot, Needs you, Machine, Heavy slots and queue, Worker leases, Milestones, Stacks up, Orphans, keys |
| `PanelSaturated`            | The same panel with the machine saturated: the alarm, three heavy slots taken, a queue, six leases, and a check held because it failed only on timeouts, with "Retry when load < 24"                                                                                    |
| `PanelStale`                | The same panel when GitHub cannot be read: the stale banner, the age of the data, and the sections that depend on it dimmed                                                                                                                                             |
| `IssueDetail`               | One issue: lane, branch and size, the gates by round, the maintainer's decision with its options and a note for the master, the agents on the issue, the packet's paths                                                                                                 |
| `TimeForm`                  | The time form at sign-off: what was read first, the minutes, the hands-on check, a remark, and the two lines it sends to the master                                                                                                                                     |
| `TimeLog`                   | The same form on an open pull request that has no `time:` note                                                                                                                                                                                                          |
| `LogForm`                   | Log a correction: the issue, what was wrong, one of the six categories, and the `factory-log` line the master posts                                                                                                                                                     |
| `Board`                     | The Board tab: the summary, the space and lane filters, and one column per stage (Ready, G2 to G6, Merged today) with a card per issue                                                                                                                                  |
| `Customize`                 | Theme, where the mod shows, the panel's sections (order and visibility), the alerts and the keys                                                                                                                                                                        |
| `CatSheet`, `CatSheetLight` | The agent cats: six roles by five states, the sizes, and three places they are used                                                                                                                                                                                     |

`source/Cat.dc.html` is the cat as one component (role, state, size); it has no screen of its own.

## Rules the screens share

1. **Colour carries one meaning** (`tokens.json`, `meaning`): cyan is running, magenta is something that needs the maintainer, red is a red gate or an orphan, acid yellow is held or the saturation alarm. Glow only on running and needs-you marks, and only in the dark theme.
2. **Type.** Chakra Petch for headings, buttons and badges (uppercase, letter-spaced); JetBrains Mono for everything else. A section heading starts with `//`.
3. **Needs you comes first**, oldest first, each card with its age. It cannot be hidden while something waits.
4. **A lane tag on every issue**: `FULL` filled, `NORMAL` outlined, `EXPRESS` dashed. A gate the lane omits is drawn dashed, never as pending.
5. **A gate track** is six marks, G1 to G6: passed, running, needs you, held, red, not reached, omitted by lane (the legend is under Milestones in `Panel`).
6. **The agents are cats** (`cats.json`, `CatSheet`). The body's colour is the role and the object it holds says it again: planner blue with a scroll, master gold with a coin, worker white with a wrench, reviewer black with a magnifying glass, verifier green with a card with a check mark, scribe pink with a brush. The collar is black, white on the black cat. The paw is always up. Working: wave marks. Needs you: magenta bell and a glow. Idle: eyes closed, dimmed. Held: flat eyes and a pause mark. Red: flat eyes and a red outline. Under 32 px the cat is its head and the object is a round badge.
7. **Nothing in the mod answers a worker.** Every action of the maintainer is sent to the master of that space; a worker's pane opens read-only.

## Checking a build against a screen

The mod is drawn with Herdr's own elements, not with HTML, so a build is never equal to a screen pixel by pixel. An agent checks, against the screen and its source: the sections and their order; every label and sentence; which token colours each part in both themes; the states listed above; and the sizes that are named in an issue. A difference the Herdr elements force is written in the pull request draft under "For review", with the screen it departs from.

## Where the cats come from

The six figures were traced on 2026-11-17 from images the maintainer generated for this project, one per role, and are licensed like the rest of this repository (`REUSE.toml`).
