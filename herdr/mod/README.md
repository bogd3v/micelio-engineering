# The factory mod for the Herdr desktop app

The mod of the epic "the maintainer runs the factory from a Herdr mod". The approved designs are in [`design/`](design/README.md); this folder holds what is built from them.

## The agent cats

A mod draws an image from a file under the app's configuration folder (`image("mods/<name>/…svg")`), so every cat the panel shows exists as a file. The source of all of them is [`design/cats.json`](design/cats.json) (the figures, the states, the crops and the badges) with the colours of [`design/tokens.json`](design/tokens.json).

```bash
node herdr/mod/build-cats.mjs              # writes herdr/mod/factory/cats/
node herdr/mod/build-cats.mjs --out <dir>  # writes them to <dir>
```

It reads only those two files, uses Node built-ins only and writes `<role>-<state>-<crop>-<theme>.svg`: 6 roles (`planner`, `master`, `worker`, `reviewer`, `verifier`, `scribe`), 5 states (`working`, `needs`, `idle`, `held`, `red`), 2 crops (`full`, `head`) and 2 themes (`dark`, `light`), 120 files, each with `viewBox="0 0 100 100"`. The same input gives the same bytes. `herdr/mod/factory/cats/` is in `.gitignore`: the files are generated, never committed.

Each file draws, in the order of the source: the silhouette (the role's body, stroked with the state's outline), the collar, the bell, the object's fill, the ink, then the eyes and the marks of the state. The `head` crop adds the role's round badge. The colours of the outline, the bell and the pause mark are the theme's tokens, so a file exists once per theme; the body, the ink and the collar are the role's own (the reviewer's ink and collar are `#e8f0ff`, the others' `#0b0c10`).

The glow of "needs you" is not in the files: the panel draws it.

`catFile(role, state, size, theme)` in [`factory/lib/cat.js`](factory/lib/cat.js) gives the name of the file to draw: the `head` crop under 32 px, the `full` crop from 32 px, and `undefined` for a name that has no role.

## The model

Every screen of the mod shows the same facts, so they are read once, by plain functions in [`factory/lib/`](factory/lib/) that import only each other and that vitest runs (`test/herdr-mod-model.test.ts`, with the recordings in `test/fixtures/herdr-mod/`). No function reads the clock, a file or the network: the time, the texts and the fetched JSON are arguments, and the calls that fetch them are the mod's own.

| Module       | Reads                                                                                                                                         | From                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `slots.js`   | the heavy slots, the leases, the queue, the orphans, `paused` and the maintainer's hold                                                       | the text of `herdr/factory-slot.sh status` (`status.txt`, `status-paused.txt`); the script prints no queue line today, and a `queue` line is read when it does     |
| `machine.js` | the 1-minute load, the memory in use (`MemTotal` minus `MemAvailable`), a CPU temperature; saturated when the load is above the core count    | the texts of `/proc/loadavg`, `/proc/meminfo` and each `hwmon` `name` with its `temp1_input`, and the core count (`herdr/mod/findings.md`, question 3)             |
| `gates.js`   | an issue's rounds, the six marks of its track (passed, running, needs you, held, red, not reached, omitted by lane), its lane and calibration | the issue's comments as `gh api repos/<repo>/issues/<n>/comments` returns them: only the maintainer's login counts, as in `factory-tools metrics` (`--maintainer`) |
| `issues.js`  | a milestone's issues as rows: the track, the lane, the age of the wait and what blocks a blocked issue                                        | the milestone's issues as REST returns them and each one's comments; a `## Depends on` item that is an open issue of the milestone blocks it                       |
| `agents.js`  | each agent's name, role, status and space                                                                                                     | the rows of Herdr's `terminals()`, never `agents()` (findings, question 4)                                                                                         |
| `state.js`   | all of it, with an age per source and a `stale` mark on a source whose last read failed (it keeps its last value)                             | what the other modules read, as one `fetched` object                                                                                                               |

The gate comments are those of `herdr/master.md`: `**Gate 1 …**` with a `lane: <lane>` line (and `(calibration: full)`), `**Gate 2, round K …**`, `**Gate 3, round K (reviewer-N)** · K Blocking …` and `**Gate 4, round K …** · M mismatches`. A comment with a Blocking above 0, a mismatch above 0 or `not ready` marks its gate red until a later round of that gate passes; `express` omits G3 and G4. G5 needs the maintainer once the gates before it passed, G5 is passed from the `Progress updated … pull request #N opened` comment and a closed issue has every gate passed. The `held` mark is read from the line that issue #303 defines; until then no issue is held.

A role comes from a terminal's `name` (`worker-<N>`, `reviewer-<N>`, `reviewer-<N>-r<K>`, `verifier-<N>`, `verifier-<N>-r<K>`, `scribe`) or, with no name, from `--agent master` or `--agent planner` in `foreground.argv`. Its status is the terminal's `status`, and `blocked` means it needs the maintainer. Its space is that of its root terminal (the one with no `parent`), from that root's `herdr.space` label. The state carries no context size and no model: no field of `agents()` or `terminals()` gives a context size, and the model is only an argument of a command. The issue detail reads it where it is, with `modelOf` of `agents.js`: the argument after `--model` in a terminal's `foreground.argv`, `--` for a terminal that was started with none (the master's).

## The panel

[`factory/`](factory/) is the mod: a panel docked on the right of the window (`mod.json`: `place: right`, 380 px) that shows the state of the factory and changes nothing. No command it runs writes and no control of it sends anything; it reads no token and stores none (`gh` finds its own login). `main.js` puts the reads of [`adapters.js`](factory/adapters.js) through the model above and the sections of [`factory/lib/panel.js`](factory/lib/panel.js) into one description, which one file of [`factory/views/`](factory/views/) per section draws: `header.js`, `strip.js`, `banners.js`, `machine.js`, `slots.js`, `leases.js`, `milestones.js` (with `legend.js`), `stacks.js` and `orphans.js`, and `detail.js` for the overlay of an issue.

### The issue detail

The id of an issue row in Milestones (and `herdr-app do factory.detail:<number>`) opens an overlay of the same mod, a dialog 760 px wide, with `detail` in its props (`main.js` draws [`views/detail.js`](factory/views/detail.js) when it has it; what it shows is computed by [`factory/lib/detail.js`](factory/lib/detail.js) and run by `test/herdr-mod-detail.test.ts`). It reads and sends nothing:

- The header: the space's badge, the lane tag, the repository and number, the branch, the stack (`stack up: <name>` when `docker compose ls` lists a stack that ends with the issue's number, else `no stack up`: the design's "no stack needed" would need a source for what the issue needs, and none is given), the lines added and removed, and the title. The branch and the lines are read from the worktree named in the issue's `### Progress` (`git rev-parse --abbrev-ref HEAD` and `git diff --numstat` against the merge base with `origin/main`, nothing that writes; a file that is not tracked yet is not counted).
- "Gates by round": one row per round, six cells G1 to G6. A cell holds the first line of the gate comment of that round, after `Gate N, round K (agent)`; a gate the lane omits is dashed in every row. A gate with no comment yet shows what its mark says (`running`, `needs you`, `waits`), and in the earlier rounds `--`.
- "Agents on this issue": the issue's agents (`worker-<N>`, `reviewer-<N>`, `verifier-<N>` and their reread names) and the space's master, each with its cat, model, state and tokens: input plus output summed from the `tokens |` lines of the issue's comments (`herdr/master.md`, "The tokens record"; the maintainer's login only, the issue's number only, one total for each role). An agent that has ended has no terminal any more: its row is made from its tokens line, state `done`. The design's Context column is left out, and so is the line under it that depends on it: no field of `terminals()` gives a context size (`findings.md`, question 4).
- "Packet": the worktree, the draft, the decisions file (`<packet>/r<K>/decisions.md`, K the latest round) and the commit message (`<packet>/commit-message.txt`), from the code spans after `worktree`, `packet directory`, `draft` and `branch` in the `### Progress` section of the issue (`herdr/master.md`, "The review packet"). A path opens its file in a pane running `less`; an agent's name opens a pane running `watch -n 2 hc read <terminal> --lines 40`, so the keys go to `watch` and never to the worker. Each closes the overlay.

The design's "Decision for you" block (issue #304) and its "Log a correction" link (issue #306) are not in it.

### Install

```bash
herdr/mod/install.sh --maintainer <your GitHub login> --spaces <spaces.json>
```

It builds the cats and copies the mod to `${HERDR_APP_DIR:-$HOME/.config/herdr-app}/mods/factory/` and the layout to `layouts/factory.json` (Herdr's `main` with the panel on the right; `layout.switch {name: "factory"}`, or `ctrl-shift-l`, shows it). It never overwrites a file it did not write: it records the hash of each file it writes in `factory-mod-install.json` of that folder, and when a file it would write exists with another hash (one it did not write, or one it wrote and you then edited) it writes nothing, names the file and exits 1. Run again, it replaces what it wrote. `--theme dark|light|follow` sets the theme the panel starts in and `--fixture <folder>` (repeatable) makes it read recordings, as below. Herdr loads the `fonts/` folder at start and at the next look change, not when the mod reloads: a first install shows the interface font until then.

### Configure

The block's props in `layouts/factory.json` (`install.sh` writes them):

| Prop         | Meaning                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout`   | this repository's checkout, where `herdr/factory-slot.sh` is (`install.sh` sets it to the one it ran from)                                                           |
| `maintainer` | the login whose comments are the master's gate comments (`--maintainer`, else `$FACTORY_MAINTAINER`)                                                                 |
| `spaces`     | one `{ "name", "repo", "milestone", "epic" }` per space: the Herdr space's name, its repository, the milestone's number and the epic's number (left out of the rows) |
| `theme`      | `dark`, `light` or `follow` until the maintainer picks one with the toggle in the header                                                                             |
| `fixture`    | a folder, or a list of folders (the first that has a file gives it): the panel reads their recordings and runs nothing                                               |

A section folds with a click on its heading; the fold and the theme (Dark, Light or Follow Herdr) are kept in the mod's `localStorage`. Whether they survive a restart of the app was not run (`findings.md`, question 12). The commands `factory.top` and `factory.reveal:<section>` (`herdr-app do factory.reveal:milestones`) only scroll the panel, and `factory.detail:<number>` opens the overlay of an issue.

### What each section reads

| Section       | Reads                                                                                                                                                                                                                                                | Every |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Header, strip | the age of the freshest read; the counts of the other sections (needs: the issues that wait for you and the agents asking, with no issue)                                                                                                            | 5 s   |
| Machine       | `/proc/loadavg`, `/proc/meminfo`, `/sys/class/hwmon/*` and `nproc`; the load of the last 15 minutes is the panel's own record of what it read                                                                                                        | 5 s   |
| Heavy slots   | `herdr/factory-slot.sh status`                                                                                                                                                                                                                       | 5 s   |
| Worker leases | the same text; the letter is the space of the agent that holds it                                                                                                                                                                                    | 5 s   |
| Milestones    | `gh api repos/<repo>/issues?milestone=<n>&state=all` and, for each open issue, its comments; the agents of each issue from `terminals()`. `PRs a/b` is the closed issues over all of them (the factory closes an issue with its merged pull request) | 60 s  |
| Stacks up     | `docker compose ls --format json`; a stack belongs to the agent whose issue number ends its name (`wt-792`: `worker-792`)                                                                                                                            | 5 s   |
| Orphans       | the `orphan` lines of `factory-slot.sh status`                                                                                                                                                                                                       | 5 s   |

A failed `gh` makes GitHub stale: the banner gives its age, Milestones keeps its last rows dimmed, and the other sections go on. The panel shows no context size (no field of `terminals()` gives one, `findings.md`, question 4), no memory per stack and no age of a stack: `docker compose ls` gives neither. A `blocked` terminal is shown as an agent that may need you, as the model reads it ("needs the maintainer"), with a caveat: `hc get` reported `blocked` for a worker that was only running a long shell command, so a needs-you cat, mark or count can be a false alarm; the note says "is blocked: it may need you". The rows of Milestones are built at each redraw from the agents of the last 5 s read and the last 60 s read of GitHub, so an agent that starts, stops or blocks shows within 5 s. The design's "Needs you", the buttons and the keys are not in the panel yet.

### Fonts

`factory/fonts/` holds Chakra Petch (Medium, SemiBold, Bold) and JetBrains Mono (Regular, Medium, Bold) with the OFL text of each; the views name them by family and pick the weight with `font_medium()`, `font_semibold()` and `font_bold()`. They are SIL OFL 1.1 (`REUSE.toml`, [`THIRD-PARTY.md`](../../THIRD-PARTY.md)).

### Reproducing a screen

With `fixture` set, the panel reads `test/fixtures/herdr-mod/` (`normal/`, `saturated/` and `stale/` hold what differs): `now.txt` is its clock, and `github-error.txt` makes every GitHub read after the first fail. `test/herdr-mod-panel.test.ts` runs the same files through the same functions.
