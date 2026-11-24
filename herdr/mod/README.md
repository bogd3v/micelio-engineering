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

A role comes from a terminal's `name` (`worker-<N>`, `reviewer-<N>`, `reviewer-<N>-r<K>`, `verifier-<N>`, `verifier-<N>-r<K>`, `scribe`) or, with no name, from `--agent master` or `--agent planner` in `foreground.argv`. Its status is the terminal's `status`, and `blocked` means it needs the maintainer. Its space is that of its root terminal (the one with no `parent`), from that root's `herdr.space` label. The state carries no context size and no model: no field of `agents()` or `terminals()` gives a context size, and the model is only an argument of a command that the master's did not have.
