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
