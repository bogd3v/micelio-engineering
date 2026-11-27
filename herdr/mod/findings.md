# What a mod of the Herdr desktop app can read and do on the factory host

Findings of issue #296, part of the epic #294 (the factory mod). Questions 1 to 14 were run on the factory host on 2026-11-23, with `herdr-app` 0.1.17 and `hc` 0.1.22, in a Linux session (KDE, Wayland), from the worker's terminal, which runs inside its own slice (`factory-worker_296.slice`). The mod was a throwaway folder `~/.config/herdr-app/mods/factory-spike/` (`mod.json` `{"place":"none"}`, opened with `herdr-app do mod.open --name factory-spike`); it is removed. A helper `out(name, value)` of the spike wrote each result as JSON to a results folder under the worker's scratchpad, outside the maintainer's configuration and outside the repository (copied to the packet's `logs/spike/`; an `exec` of `sh -c 'printf %s "$1" > "$2"'`). The app's own reference is `~/.config/herdr-app/AGENTS.md` and the type files `herdr.d.ts` and `gpui-kit.d.ts` beside it (read on 2026-11-23). Question 15 was run later, for issue #512; its section says when, with what and what it changed.

The findings state what was run and what came out. They recommend nothing. What could not be run, and why, is written in the section that asks it.

Three things the spike changed outside its own folder, and what was done about each:

- `localStorage` and `shared` wrote `~/.config/herdr-app/data/factory-spike/` (removed) and the key `factory-spike.k` of `shared.json`, which was set to `null` and stays as a `null` entry: the app owns that file and rewrites it.
- Zooming in and back (`app.zoom_in`, `app.zoom_reset`, question 8) made the app add `terminal_line_height`, `terminal_cell_width` and `terminal_scroll_speed` (each `1.0`) to `settings.json`; the file was restored to its earlier content afterwards.
- Opening and closing overlays, a notification and two tabs (all closed) happened in the maintainer's window.

Nothing was sent to the master's session or to a worker: the sends of question 5 went to a throwaway terminal that printed OSC 7501 reports, started and removed by the spike.

## 1. The versions of `herdr-app` and `hc`, and the lowest version the mod must ask for

```sh
herdr-app --version
hc --version
herdr-core --version
hc server status
```

```js
// in a mod: the app's own report
import { updates } from 'herdr'
out('versions', { app: updates().app, core: updates().core, checks: updates().checks })
```

```text
herdr-app 0.1.17
hc 0.1.22
hc 0.1.22                      # herdr-core --version prints the same line as hc
{"core":{"id":"2d3dae9ce5240734e8262fa03d3b8ff8","name":"ultramarine"},"finished":4,"holder":{"current":true,...},"installed_by":null,"keeps_running_after_logout":true,"live":4,"logout_linger_user":"alejo9420","pid":1294906,"uptime_ms":1585987,"version":"0.1.22"}
# updates() in the mod:
{ "app": { "version": "0.1.17", "ready": null, "updates": true },
  "core": { "version": "0.1.22", "managed": null, "ready": null, "updating": false, "error": null },
  "checks": true }
```

The app reference lists the keys of `mod.json` (`place`, `size`, `title`, `overlay`, `link_handlers`, `focusable`); none of them names a version, and `herdr.d.ts` has no call that compares versions. A mod therefore cannot ask for a minimum; what was run is `herdr-app` 0.1.17 with `herdr-core` 0.1.22. Nothing was run on an older or a newer version. The app updates itself (`updates().checks` is `true`, `ready` is `null`: no update was waiting).

## 2. `exec` from a mod: `herdr/factory-slot.sh status` and `gh api`

```js
import { exec } from 'herdr'
await exec('sh', [
  '-c',
  'pwd; id -un; echo HOME=$HOME; echo PATH=$PATH; env | cut -d= -f1 | sort | tr "\\n" " "; echo; echo FACTORY_SLOT=${FACTORY_SLOT-unset}; echo HC=${HC_TERMINAL_ID-unset}; echo DISPLAY=${DISPLAY-unset}',
])
await exec('bash', ['herdr/factory-slot.sh', 'status'], {
  cwd: '/home/alejo9420/Git/micelio-engineering',
})
await exec('gh', ['api', 'repos/bogd3v/micelio-engineering/issues/230/comments'])
await exec('gh', ['api', 'user', '--jq', '.login'])
// each call timed with Date.now() before and after; the two slow ones five more times
```

```text
exec sh (no cwd option), 11 ms, code 0:
/home/alejo9420
alejo9420
HOME=/home/alejo9420
PATH=/home/alejo9420/.local/bin:/home/alejo9420/bin:/usr/local/bin:/usr/bin:/bin
_ DBUS_SESSION_BUS_ADDRESS DEBUGINFOD_IMA_CERT_PATH DEBUGINFOD_URLS DESKTOP_SESSION DISPLAY EDITOR GDK_CORE_DEVICE_EVENTS HISTCONTROL HISTSIZE HOME HOSTNAME ICEAUTHORITY INVOCATION_ID _JAVA_AWT_WM_NONREPARENTING JOURNAL_STREAM KDE_APPLICATIONS_AS_SCOPE KDEDIRS KDE_FULL_SESSION KDE_SESSION_UID KDE_SESSION_VERSION LANG LANGUAGE LESSOPEN LOGNAME LS_COLORS MAIL MANAGERPID MANAGERPIDFDID MEMORY_PRESSURE_WATCH MEMORY_PRESSURE_WRITE MOZ_GMP_PATH OLDPWD PAM_KWALLET5_LOGIN PATH PWD QT_WAYLAND_RECONNECT SDL_VIDEO_MINIMIZE_ON_FOCUS_LOSS SESSION_MANAGER SHELL SHLVL SSH_ASKPASS SSH_AUTH_SOCK STARSHIP_CONFIG STEAM_FRAME_FORCE_CLOSE SYSTEMD_EXEC_PID USER WAYLAND_DISPLAY XAUTHORITY XDG_CONFIG_DIRS XDG_CURRENT_DESKTOP XDG_DATA_DIRS XDG_MENU_PREFIX XDG_RUNTIME_DIR XDG_SEAT XDG_SEAT_PATH XDG_SESSION_CLASS XDG_SESSION_DESKTOP XDG_SESSION_ID XDG_SESSION_PATH XDG_SESSION_TYPE XDG_VTNR XKB_DEFAULT_LAYOUT
FACTORY_SLOT=unset
HC=unset
DISPLAY=:0

factory-slot.sh status (cwd: the main checkout of micelio-engineering): code 0, 483 ms
  runs of 6: 493, 483, 483, 483, 483, 493 ms
  stdout: two lines, "workers<TAB>worker-296<TAB>worker-296<TAB>-<TAB>2026-11-23T16:57:41-0500<TAB>-<TAB>-" and the same for worker-300; stderr empty

gh api repos/bogd3v/micelio-engineering/issues/230/comments: code 0, 585 ms, 69284 bytes, 30 comments, first author micelio-bot[bot]
  runs of 6: 585, 684, 604, 604, 735, 684 ms
gh api user --jq .login: code 0, 514 ms, stdout: ale9420
```

The program gets the user's real environment of the desktop session, not the terminal's: the working directory is the home when no `cwd` is given (`cwd` is an option of `exec`), and `PATH` is `~/.local/bin:~/bin:/usr/local/bin:/usr/bin:/bin`. No `FACTORY_*` or `HC_*` variable is set, and no variable named like a token appears in the names of the list. `gh` answered with the maintainer's login (`ale9420`) and the issue's 30 comments with no token read or passed by the mod: it found its own login. The script's `status` ran from the main checkout of `micelio-engineering`; a lease line per worker, none held. The program started with a `cwd` that does not exist rejects (`herdr.d.ts`: "Rejects when it can't start (… no such folder …)"); that was not run.

## 3. The 1-minute load, the memory in use and a temperature

```js
import { readTextFile, exec } from 'herdr'
await readTextFile('/proc/loadavg')
;(await readTextFile('/proc/meminfo')).split('\n').slice(0, 3)
await readTextFile('/sys/class/hwmon/hwmon0/temp1_input')
await exec('sensors', ['-u'])
```

```sh
for h in /sys/class/hwmon/hwmon*; do echo "$h $(cat $h/name) $(cat $h/temp1_input 2>/dev/null)"; done
ls /sys/class/thermal
```

```text
readTextFile /proc/loadavg:  "0.98 1.04 1.08 1/1928 1328654\n"
readTextFile /proc/meminfo, first lines:
  MemTotal:       16264964 kB
  MemFree:          740900 kB
  MemAvailable:    8695228 kB
readTextFile /sys/class/hwmon/hwmon0/temp1_input: "35850\n"
exec sensors -u: code 0, begins "amdgpu-pci-0a00 / Adapter: PCI adapter / vddgfx: in0_input: 0.881 / fan1: ... / edge: temp1_input: 42.000 ..."
# shell:
/sys/class/hwmon/hwmon0 nvme 35850
/sys/class/hwmon/hwmon1 nvme 34850
/sys/class/hwmon/hwmon2 amdgpu 41000
/sys/class/hwmon/hwmon3 k10temp 35625
/sys/class/hwmon/hwmon4 asus
/sys/class/hwmon/hwmon5 hidpp_battery_0
/sys/class/thermal: cooling_device0 ... cooling_device21 (no thermal_zone)
```

A mod can read all three, by file (`readTextFile`, which reads `/proc` and `/sys` files) and by `exec` (`cat`, `sensors -u`, both code 0). The 1-minute load is the first field of `/proc/loadavg`; memory in use is `MemTotal` minus `MemAvailable` (7,569,736 kB in that read), both in `/proc/meminfo`. A temperature: `hwmon<N>/temp1_input` in millidegrees, with the sensor named by `hwmon<N>/name`; on this host `hwmon0` is an NVMe disk and the CPU is `k10temp` at `hwmon3`, so the number of the CPU's sensor is found by name. There is no `thermal_zone` here. `exec` of `cat /proc/loadavg` took 10 to 11 ms (five runs: 11, 10, 10, 11, 10).

## 4. `agents()`: its fields, the name, the space, the status, the context and the model

```js
import { agents, terminals, spaces, panes } from 'herdr'
out('probe-b', {
  agents: agents(),
  agents_keys: Object.keys(agents()[0]),
  terminals_keys: Object.keys(terminals()[0]),
  terminals: terminals().map((t) => ({
    address: t.address,
    name: t.name,
    parent: t.parent,
    state: t.state,
    status: t.status,
    report: t.report,
    foreground: t.foreground?.argv,
    title: t.title,
    labels: t.labels,
  })),
})
// and a throwaway agent that reports a status
// hc run --bg --name spike-blocked --no-notify -- sh -c "printf '\033]7501;app=fake:state=blocked\033\\\\'; sleep 120"
// in the mod: terminals().filter((t) => t.name === "spike-blocked") ; agents().map((x) => x.address)
```

```text
agents().length: 1 (only t2p, the master). Its keys:
  address pane space space_name tab tab_index tab_name pane_name status app program title seq pinned focused
  { address: "t2p", space_name: "micelio-engineering", tab_name: "1", pane_name: null, status: "working", app: "claude-code", program: { key: "claude", name: "Claude Code", icon: "icons/claude.svg", ... }, title: "master", seq: 3, pinned: false, focused: true }
terminals() keys:
  address argv cols created_ms cwd die_with_parent exit_code finished_ms foreground identity keep labels name notify parent pid reason rows screen signal state records status_ms template title turn status program report selection
terminals() rows (three live agents then):
  t2p  name: null          parent: null  status: "working"  report: {app: "claude-code", state: "working", msg: "2 shells still running"}  foreground: [claude --agent master]            labels: {herdr.seen, herdr.space: sp42747..., herdr.tab: tb17068..., where}
  t4k  name: "worker-296"  parent: "t2p" status: "working"  report: {app: "claude-code", state: "working", msg: "Running cd ~/.config/herdr-app/mods/fact..."}  foreground: [claude --agent worker --model sonnet]  labels: {where: "micelio-engineering / 1"}
  t4m  name: "worker-300"  parent: "t2p" status: "working"  (same shape)
panes() keys: pane terminal tab title name cwd branch status app program focused zoomed movable scroll
throwaway agent started with `app=fake:state=blocked`:
  terminals(): { status: "blocked", report: {app: "fake", state: "blocked"}, parent: "t4k", program: { key: "agent", name: "fake", icon: "icons/agent.svg", ... } } ; agents(): ["t2p"] ; spaces()[0].status: "working"
herdr-app ls: tab 1 of the space lists terminal t2p with "sub_agents": ["t4k","t4m"]
```

`agents()` carries the address, pane, space id and name, tab, status, `app` and the terminal's title, and no field for a name given with `hc run --name`. On this host it listed only the master: the two workers (and a reviewer started later) started by the master with `hc run` are sub-agents, which `agents()` leaves out and `terminals()` lists, each with `name` (`worker-296`), `parent` (`t2p`), `status` and `report`. A sub-agent has no `herdr.space` label, so its space is that of its parent (`herdr-app ls` shows it under `sub_agents`, and the app's own agent list draws it under the master). The status values are the words `working`, `blocked`, `idle`, `done` and `error` that the program reports by OSC 7501; the reference says `blocked` means a person is needed (permission or a question). No real worker was made to wait for the maintainer: the throwaway agent reported `blocked` by an OSC 7501 record of the form `ESC ] 7501 ; app=<name> : state=<state> ESC \` (the forms `blocked`, `state=blocked;app=fake` and a JSON object were tried and reported nothing), and `terminals()` showed `status: "blocked"` for it. A context size is in no field of `agents()` or `terminals()`; the model appears only as the argument `--model sonnet` of `foreground.argv`; `report.msg` is the program's own short text.

## 5. Sending a line of text to one named agent's terminal from a mod

```sh
# a throwaway terminal that echoes its input and reports a status
hc run --bg --name spike-agent --no-notify -- sh -c "printf '\033]7501;app=fake:state=idle\033\\\\'; cat"
hc send spike-agent "line one via bash"          # from the worker's shell
hc keys spike-agent h i                          # no Enter
hc read spike-agent --lines 0
hc send spike-blocked "hello"; echo "rc=$?"      # a terminal that reported blocked
hc send --force spike-blocked "forced"; echo "rc=$?"
```

```js
import { hc, exec } from 'herdr'
await hc(['send', 'spike-agent', 'from the mod, with Enter'])
await hc(['keys', 'spike-agent', 'n', 'o', 'space', 'e', 'n', 't', 'e', 'r'])
await hc(['send', '--json', 'spike-agent', '--if', 'idle', 'guarded by idle'])
await hc(['read', 'spike-agent', '--lines', '0'])
await exec('sh', ['-c', 'echo HC_TERMINAL_ID=${HC_TERMINAL_ID-unset}'])
```

```text
hc send from the worker's shell: {"started":false,"status":"idle","turn":0}
screen of spike-agent after it and `hc keys ... h i`:
  <hc from="t4k worker-296">line one via bash</hc>
  hi
screen after the three calls of the mod (cat echoes every line twice: the terminal's echo, then cat):
  hifrom the mod, with Enter
  no enterguarded by idle
each hc call of the mod: code 0, stdout {"started":false,"status":"idle","turn":0} (send) or {"status":"idle","turn":0} (keys)
exec sh in the mod: HC_TERMINAL_ID=unset
hc send spike-blocked "hello": rc=9  {"error":{"hint":"typing would answer its dialog; read its screen first (hc read t54), or --force","kind":"blocked","message":"t54 is blocked (waiting)"}}
hc send --force spike-blocked "forced": rc=0 {"started":false,"status":"blocked","turn":0}
```

`hc send <name> <text>` does it, in one call: it pastes the text and presses Enter; `hc keys <name> <keys...>` types keys with no Enter (`space` is the key for a blank), so a line without the final Enter is a `keys` call, and the text then stays in the input until another call presses `enter`; the mod's `hc(["send", ...])` and `hc(["keys", ...])` did both. Sent from the worker's shell, the line arrives wrapped as `<hc from="t4k worker-296">…</hc>` (the sender's address and name); sent from the mod, it arrives as the bare text, because a mod's `exec` and `hc` have no `HC_TERMINAL_ID`. `hc send` refuses a terminal that reported `blocked` (exit 9) unless `--force`, and `--if idle|working` sends only in that status. A program run by an agent can make the same call: `hc` is on the `PATH` of the worker's shell, the first call above was one, and it asked for no permission of the app. What the master's own session receives was not tried: nothing was sent to it; the throwaway terminal stood for it.

## 6. `image()` of an SVG of about 12 kB at 16, 24, 48 and 96 px, 30 on screen, and a glow

The cat is the worker's from `herdr/mod/design/cats.json`, full crop (viewBox `120 132 760 760`), drawn in the order of its `note` (silhouette with fill `#f4f4ee` and a 10-unit stroke, collar, wrench fill, ink with `fill-rule="evenodd"`, open eyes, the wave marks): `mods/factory-spike/cat.svg`, 11,011 bytes. `cat-idle.svg` (10,514 bytes) is the same with closed eyes and `opacity=".55"` on the root. The glow files are a 311-byte radial-gradient circle (`glow.svg`) and a 294-byte rounded square with `feGaussianBlur` (`glow-blur.svg`), both magenta `#ff2bd6`.

```js
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
const CAT = "mods/factory-spike/cat.svg", IDLE = "mods/factory-spike/cat-idle.svg";
row(size, count, src) { const r = h_flex().gap(6).items_center(); for (let i = 0; i < count; i++) r.child(image(src).w(size).h(size).flex_none()); return r; }
// 10 at 16 px, 8 at 24, 6 at 48, 4 at 96, 2 idle at 96 = 30
// glow row: image(CAT) | div().rounded(14).shadow_lg().child(image(CAT)) |
//   div().relative().w(64).h(64).child(image("…/glow.svg").absolute().left(-24).top(-24).w(112).h(112)).child(image(CAT).absolute()…) | the same with glow-blur.svg
```

```sh
PID=$(pgrep -x herdr-app); awk '{print $14+$15}' /proc/$PID/stat   # utime+stime ticks, before and after sleep 10 (100 ticks per second, 8 cores)
herdr-app shot <file>.png
```

```text
herdr-app check . : check passed
30 cats on screen, shot of the window: all 30 drawn in colour, the idle two dimmed; the 16 and 24 px ones legible as a cat with a raised paw
glow row: no glow | shadow_lg: a grey, square-cornered shadow, no colour | glow.svg behind: a magenta round halo | glow-blur.svg behind: a magenta soft halo, a little smaller
process CPU of herdr-app over 10 s (utime+stime ticks):
  mod closed:     36, 32, 31 (runs of 3)
  30 cats open:   42, 35, 33 (runs of 3)
describe time of render() in the mod (Date.now before and after): 0 ms
resident memory of herdr-app: 175540 kB with the mod open (one run), 175540 kB after closing it (one run)
```

All 30 images are drawn, with their fills, the stroke and the opacity of the idle file, at the four sizes. The process used 31 to 36 ticks per 10 s with the mod closed and 33 to 42 with it open (the GPU was not measured). `shadow_lg` and the other `shadow_*` of `gpui-kit.d.ts` are fixed presets with no colour argument, and the shot shows a grey shadow around the box, not around the figure; the magenta glow around the cat was drawn by a second `image()` behind it. A `glow` with `filter: drop-shadow` as in the design's CSS was not tried (the mod has no CSS).

## 7. Whether a mod can change the icons of Herdr's own agent list

```js
import { agents } from 'herdr'
const a = agents()[0]
r.before = a.program.icon
a.program.icon = 'mods/factory-spike/cat.svg'
r.after_mutation_same_call = a.program.icon
r.fresh_call = agents()[0].program.icon
```

```sh
ls ~/.config/herdr-app/programs.json
grep -n -E 'image\(|svg\(' ~/.config/herdr-app/mods/agents/main.js
```

```text
{ "before": "icons/claude.svg", "after_mutation_same_call": "mods/factory-spike/cat.svg", "fresh_call": "icons/claude.svg" }
ls: cannot access '/home/alejo9420/.config/herdr-app/programs.json': No such file or directory
81:  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
```

Changing the object `agents()` returns changes only that call's copy; the list is drawn by the shipped `agents` mod from `program.icon` of its own `agents()` call. The reference says the shipped mods are replaced on every start and cannot be edited, that a mod cannot change another mod's code at run time, and that the table of icons is `programs.json` of the home folder (`"icon": "<path in the home folder>"`, `"match"`), which does not exist on this host. A mod could in principle write that file (`writeTextFile`, here only) or a clone of the `agents` mod could be put in a cloned layout; neither was tried, because both write a file of the maintainer's configuration (`programs.json`, `layouts/`) that this spike may not edit. The icons of the list were therefore not changed.

## 8. A `fonts/` folder with Chakra Petch and JetBrains Mono

Files downloaded into a scratch folder, then copied to `mods/factory-spike/fonts/`: `ChakraPetch-Medium.ttf`, `-SemiBold.ttf` and `-Bold.ttf` (`github.com/google/fonts`, `ofl/chakrapetch`) and `JetBrainsMono-Regular.ttf`, `-Medium.ttf` and `-Bold.ttf` (`github.com/JetBrains/JetBrainsMono`, `fonts/ttf`).

```js
import { fonts } from "herdr";
out("fonts", { count: fonts().length, matching: fonts().filter((n) => /chakra|jetbrains|petch/i.test(n)) });
div().font_family("Chakra Petch").font_semibold().text_size(20).child("// SPACES Needs you 0123");
div().font_family("TH Chakra Petch")…   div().font_family("JetBrains Mono").font_bold()…   div().font_family("No Such Font")…
```

```sh
for f in *.ttf; do fc-scan --format '%{file}: family=%{family} style=%{style}\n' $f; done
fc-list | grep -i -E 'chakra|jetbrains'
herdr-app do app.zoom_in; herdr-app do app.zoom_reset      # a look change
# in a scratch repository: REUSE.toml, LICENSES/MIT-0.txt and the six fonts under herdr/mod/fonts/
reuse lint; reuse download OFL-1.1; reuse lint     # the second lint after two [[annotations]] with OFL-1.1
```

```text
fc-scan: ChakraPetch-Medium.ttf family=Chakra Petch,Chakra Petch Medium style=Medium,Regular ; -SemiBold family=Chakra Petch,Chakra Petch SemiBold ; -Bold family=Chakra Petch style=Bold
         JetBrainsMono-Regular.ttf family=JetBrains Mono ; -Medium family=JetBrains Mono,JetBrains Mono Medium ; -Bold family=JetBrains Mono
fc-list on the host: "TH Chakra Petch" (Regular, Italic, Bold, Bold Italic), no JetBrains Mono
fonts() before the copy: count 145, matching ["JetBrains Mono", "TH Chakra Petch"]
fonts() after copying the files, mod reloaded and reopened: count 145, the same
fonts() after app.zoom_in and app.zoom_reset: count 146, matching ["Chakra Petch", "JetBrains Mono", "TH Chakra Petch"]
shot after the look change: "Chakra Petch" in Medium, SemiBold and Bold drawn as Chakra Petch; "TH Chakra Petch" drawn small and in another face; "JetBrains Mono" in Medium and Bold drawn; "No Such Font" drawn in the interface font
font files' name table (nameID 0 and 13): "Copyright 2018 The Chakra Petch Project Authors (https://github.com/m4rc1e/Chakra-Petch.git)", "Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)"; both "licensed under the SIL Open Font License, Version 1.1"
reuse lint, before the annotations: rc 0, "Licencias utilizadas: MIT-0", 7 / 7 files with licence (the fonts counted as MIT-0)
reuse lint, after two annotations and LICENSES/OFL-1.1.txt: rc 0, "Licencias utilizadas: MIT-0, OFL-1.1", 7 / 7
```

A mod names a font by the family of its file, as a string in `font_family("Chakra Petch")`, and picks the weight with `font_medium()`, `font_semibold()` and `font_bold()` (the three files of Chakra Petch gave three faces). The files were not loaded when the mod reloaded after they were copied; they were when the app's look changed (the reference says the folder loads "at start and on the next look change"). `JetBrains Mono` is shipped with Herdr (the reference says so) and was found before the copy; a font that does not exist falls back to the interface font. What `REUSE.toml` needs for the font files, run with `reuse` 6.2.0 (installed with `uv tool install reuse==6.2.0` in a scratch folder) on a scratch repository that held a copy of `REUSE.toml`, `LICENSES/MIT-0.txt` and the six font files under `herdr/mod/fonts/`: with the file as it is, `reuse lint` passes and reports the fonts as MIT-0, because the `path = "**"` annotation covers them (a wrong licence that passes). With two `[[annotations]]` placed after it (the file says later annotations win), `path = "herdr/mod/**/fonts/ChakraPetch-*.ttf"` with `SPDX-FileCopyrightText = "2018 The Chakra Petch Project Authors"` and `path = "herdr/mod/**/fonts/JetBrainsMono-*.ttf"` with `SPDX-FileCopyrightText = "2020 The JetBrains Mono Project Authors"`, both `SPDX-License-Identifier = "OFL-1.1"`, and `reuse download OFL-1.1` (which wrote `LICENSES/OFL-1.1.txt`; today `LICENSES/` holds only `MIT-0.txt`), `reuse lint` passes and lists the licences used as `MIT-0, OFL-1.1`. The fonts are binary files that carry no comment, which is why the licence is given in `REUSE.toml`.

## 9. `cx.timer.every` at 5 s and at 60 s: hidden, and how `close(cx)` stops it

```js
init(_p, cx) {
  cx.timer.every(5000, (cx) => { log(`tick5 ${this.id}`); });
  cx.timer.every(60000, (cx) => { log(`tick60 ${this.id}`); });
}
async close(cx) { await log(`close ${this.id}`); }
// log(line): exec sh -c 'echo "$(date +%s.%N) $1" >> timers.log'
```

```sh
herdr-app do mod.open --name factory-spike
herdr-app do overlay.close --id mod-factory-spike
herdr-app do tab.new --name spike-tab --mod factory-spike --focus false    # a tab that was never shown
herdr-app do tab.select --id <spike tab>      # shown 7 s
herdr-app do tab.select --id <master's tab>   # the spike tab now hidden, 75 s
herdr-app do tab.close --id <spike tab> --confirmed true
```

```text
as an overlay (props {overlay: "mod-factory-spike"}):
  1795471561.196 init   1795471566.203 tick5   …571.203 tick5   …576.203 tick5   …581.203 tick5
  overlay.close at 1795471584.939 → close at 1795471584.940, no tick after it (14 s watched)
tab never shown: 5 s after tab.new, timers.log empty (no init)
tab shown at 1795471616.113: init 1795471616.119, ticks every 5.000 s (…621.125, …626.125, …)
tab hidden again at 1795471623.121 (the master's tab selected): ticks kept coming every 5 s; tick60 at 1795471676.125 (60.006 s after init)
tab.close: last tick …701.128, close at 1795471703.832, no tick after it
```

The 5 s timer fires every 5.000 s (±0.002 s in the log) and the 60 s timer 60.006 s after `init`. Both kept running while the mod's tab was not the shown one (80 s watched: 17 ticks of 5 s and one of 60 s); a tab created with `focus false` starts its mod only when first shown. `close(cx)` runs once when the overlay or the tab goes (the 250 ms bound was not stressed: the call logged within 1 ms), and the timers stop with it. A hidden copy does not get `close(cx)` (the reference). Not run: the window minimised or covered (`window.minimize` has no command to restore it and would hide the maintainer's window), and the app's quit.

## 10. A form in an overlay, a floating block, and `notify` with an action

```js
const dialog = openOverlay({
  mod: 'factory-spike',
  props: { form: true },
  kind: 'dialog',
  width: 420,
  height: 260,
})
const win = openOverlay({
  mod: 'factory-spike',
  props: { win: true },
  kind: 'window',
  key: 'spike-win',
  width: 260,
  height: 90,
  at: { x: 700, y: 520 },
})
const note = notify({
  title: 'Spike notify',
  body: 'Click opens the panel',
  level: 'info',
  timeout: 20000,
  action: { name: 'mod.open', args: { name: 'factory-spike' } },
})
// the form (init): this.state = InputState.new({ placeholder: "Type here" }); this.state.on("change", …); this.state.on("submit", …); this.state.set_value("set by script");
// render: v_flex()….track_focus(this.h).on_key_down((e, cx) => log(e)).child(Input.new(this.state))
//   .child(Button.new("send").child("Send").bg(t.solid).on_click(() => …)).child(Button.new("cancel")….on_click(() => closeOverlay(this.p.overlay)))
```

```text
herdr-app check . : check passed
ids: { "dialog": "o1", "window": "o2", "notify": "o3" }
herdr-app status: overlays ["factory-spike", "factory-spike", "factory-spike", "toast"], errors []
form log: ["value after set_value: set by script"]   (no "change" entry)
shot: a dialog "Log a correction" with the input showing "set by script", a filled "Send" button and an outlined "Cancel"; a white toast at the bottom right "Spike notify / Click opens the panel"; the kind "window" overlay not visible (it sits under dialogs)
the action: `herdr-app do mod.open --name factory-spike`, the same command, opened the mod as an overlay (status listed "factory-spike")
all closed with `herdr-app do overlay.close` (repeated) and `--id o2`, `--id o3`; status overlays [], errors []
```

A form with an `Input`, a primary and an outlined `Button`, keyboard handling (`track_focus`, `on_key_down`) and `closeOverlay` renders in a dialog overlay; `notify` posts a toast with the title, the body and the level, and its `action` is an app command (`mod.open` with `{name}`). What nobody can drive from outside the window was not run: typing into the input, a click on a button or on the toast, and a key reaching `on_key_down`; setting the value by script did not fire a `change` handler. A floating block (`"floating"` in a layout) was not run: it exists only in a layout file, and a layout of the maintainer's must not be edited here (question 11). `placement()` is `null` for a mod that does not float; `herdr-app status` shows `"floats": {}`.

## 11. A mod as a tab or a pane, and a layout cloned from `main` with a mod docked right at 380 px

```sh
R=$(herdr-app do tab.new --name spike-tab --mod factory-spike --props '{"win":true}' --focus false); echo "$R"
herdr-app do pane.split --direction right --pane <mod pane> --mod factory-spike --props '{"win":true}'
herdr-app do pane.split --direction down  --pane <mod pane> --argv '["sh","-c","echo terminal in split; sleep 30"]'
herdr-app ls
herdr-app do tab.select --id <spike tab>; herdr-app shot tabpane.png
herdr-app do tab.close --id <spike tab> --confirmed true
```

```text
{ "space": "sp42747bf52f4284cd02331a5a18197630", "tab": "tbdb0c67af47bd8ef3e3b07e2811aa9dc8", "pane": "p85f6e4c9daeedb653fbb876f500d0ce2" }
pane.split right, mod:     { "pane": "p42000d8310fed07f5649aab847f56686" }
pane.split down, terminal: { "pane": "p64b626d9b64edbd951f404b9b709738d", "terminal": "t53" }
herdr-app ls, tab "spike-tab": terminals: [ t53 ] only (mod panes are not terminals and are not listed)
herdr-app status after closing the tab: tab = the master's tab, errors []
```

A mod is a tab (`tab.new {mod, props}`: a tab whose only pane is the mod) and a pane (`pane.split {mod, props}`) beside a terminal, and both closed cleanly. The props reach the mod (`props().win` was true). Not run: `layout.clone {"name":"main","as":"spike"}` and a copy of the mod docked on the right at 380 px (`mod.json` `{"place":"right","size":380}`, or a block `{"size":{"px":380}}` in the cloned layout). `layout.clone` writes `layouts/<name>.json` and switches the maintainer's window to it, and a `mod.json` with a place docks a copy into the shown layout the first time its folder is seen; both are edits of the maintainer's layouts, which this issue forbids. The reference says a layout is a row of `{ "size": { "px": 240 } }` blocks, that a shipped layout (`main`) takes only look and click fields through `layout.set`, and that `herdr-app check` does not lay a mod out.

## 12. `localStorage` and `shared`: what survives a restart of the app

```js
const n = Number(localStorage.getItem('n') ?? 0)
localStorage.setItem('n', String(n + 1))
const before = shared('factory-spike.k')
setShared('factory-spike.k', 'set-by-' + this.id)
```

```sh
ls -la ~/.config/herdr-app/data/factory-spike
cat ~/.config/herdr-app/data/factory-spike/*
python3 -c "import json;d=json.load(open('/home/alejo9420/.config/herdr-app/shared.json'));print({k:v for k,v in d.items() if k.startswith('factory')})"
```

```text
first init (overlay):  localStorage.n_before=0 shared_before=null
second init (overlay opened again after close): localStorage.n_before=1 shared_before=set-by-sfn6
init in a tab (props null): localStorage.n_before=0 shared_before=set-by-ecrq
data/factory-spike/store.json                    {"n": "1"}        (the copy with props null)
data/factory-spike/store-ad1c5ce33764ce22.json   {"n": "2"}        (the copies with props {overlay: "mod-factory-spike"})
shared.json: {'factory-spike.k': 'set-by-7nbq'}
```

Both are written to files as they are set: `localStorage` as one file per mod and per set of props under `data/<mod>/` (the same mod with other props has its own store), and `shared` as a key of `shared.json`. Both survived closing and reopening the mod, a mod reload and a new copy. A restart of the app was not run: `herdr-app --skill` says not to stop, signal or restart the person's app. The type file says `localStorage` "survives a restart", and the reference says shared state is "saved atomically in the background", with `shared.json.corrupt-<time>` kept if the file is invalid.

## 13. `herdr-app check <folder>` and `herdr-app shot` from a worker inside its slice

```sh
cat /proc/self/cgroup
herdr-app check ~/.config/herdr-app/mods/factory-spike
env -u DISPLAY -u WAYLAND_DISPLAY herdr-app check ~/.config/herdr-app/mods/factory-spike
env -u DISPLAY -u WAYLAND_DISPLAY HERDR_APP_HOME=<an empty folder> herdr-app check ~/.config/herdr-app/mods/factory-spike
herdr-app shot <file>.png
HERDR_APP_HOME=<an empty folder> herdr-app shot <file>.png
herdr-app check <a folder with main.js that does not parse>
```

```text
0::/user.slice/user-1000.slice/user@1000.service/factory.slice/factory-worker_296.slice/run-p1302915-i1319223.scope
FACTORY_AGENT=worker-296 FACTORY_SLICE=factory-worker_296.slice DISPLAY=:0 WAYLAND=wayland-1 XDG_RUNTIME_DIR=/run/user/1000
check passed: /home/alejo9420/.config/herdr-app/mods/factory-spike      rc=0 (0.126 s)
check passed: …                                                         rc=0 (no DISPLAY, no WAYLAND_DISPLAY)
check passed: …                                                         rc=0 (no display variables and an empty HERDR_APP_HOME; the folder stayed empty)
shot: wrote a 1408 x 902 RGBA PNG and printed its path, rc=0
shot with the empty home: "herdr-app: no Herdr window at …/emptyhome/herdr-app.sock: path must be shorter than SUN_LEN"   rc=2
broken main.js: "Unexpected end of input at …/broken/main.js?v=1:1:33 … check failed: …"   rc=1
```

A worker inside its slice runs both: the worker's terminal is started by `factory-agent.sh enter worker-296` and its cgroup is `factory-worker_296.slice`, and `check` and `shot` ran from it. `check` needs no window and no display: it passed with `DISPLAY` and `WAYLAND_DISPLAY` unset and with an empty `HERDR_APP_HOME`; it prints the parse error of a broken mod and exits 1. `shot` needs the running window: it talks to `herdr-app.sock` of the home folder and fails without it (the failure above is the path being longer than a socket path allows; a short empty home was not tried, and no window of another home was started). `check` runs `init()` for real: the probe mod's `exec` ran during the check (`WARN … mod exec'd sh; the child runs for real`), so a mod must guard it with `checking()`.

## 14. The `herdr` commands the runbook uses, next to `hc`

```sh
command -v herdr; echo "rc=$?"
herdr agent start
ls ~/.local/bin
find ~/.local ~/.cargo/bin /usr/local/bin /usr/bin -maxdepth 2 -name 'herdr*'
herdr-app commands | python3 -c "import json,sys; [print(c['name'],[a['name'] for a in c['args']]) for c in json.load(sys.stdin) if c['name'] in ('pane.split','tab.new','terminal.open','agent.focus')]"
hc --help | sed -n 1,30p
```

```text
command -v herdr: rc=1 (no output)
herdr agent start: not found
~/.local/bin: claude claude-desktop claude-desktop-rpm hc herdr-app herdr-core uv uvx
find: /home/alejo9420/.local/bin/herdr-app, /home/alejo9420/.local/bin/herdr-core (and ~/.local/share/herdr-app, ~/.local/state/herdr-core)
pane.split ['direction', 'pane', 'argv', 'mod', 'props']
tab.new ['name', 'space', 'folder', 'argv', 'task', 'mod', 'props', 'focus']
terminal.open (reference): argv, folder, place, name
agent.focus ['terminal']
hc run <cmd> --bg --name <name> --cwd <dir> --label k=v --no-notify ; hc send <t> <text> [--wait --timeout <seconds>] ; hc read <t> --lines N ; hc wait <t> ; hc keys ; hc interrupt ; hc kill ; hc ls ; hc get
```

On the host that runs the desktop app there is no program named `herdr`: `herdr agent start`, `herdr agent prompt` and `herdr pane split` of `herdr/master.md` do not exist here. The programs are `herdr-app` (the window: `do pane.split`, `do tab.new`, `ls`, `status`, `commands`, `check`, `shot`) and `hc`/`herdr-core` (terminals and agents). The nearest calls on the host: starting a named agent is `hc run --bg --name <name> -- <command>` (or `herdr-app do tab.new --argv … --name …`); a prompt is `hc send <name> <text>` (`--wait`, with `--timeout` in seconds); a read is `hc read <name> --lines <n>`; a split is `herdr-app do pane.split --direction right|down [--pane <id>] [--argv …]`, whose arguments are `direction`, `pane`, `argv`, `mod` and `props` (no working directory, no `--no-focus`; `terminal.open` has `folder`). Not run: those equivalents with the runbook's flags, and a Herdr installed on another host.

## 15. What interrupts a mod's script, after how long, and what the view shows

Run for issue #512 on 2026-11-27 with `herdr-app` 0.1.18 and `hc` 0.1.22, from the worker's terminal, on a host with 12 threads (`nproc --all`; AMD Ryzen 5 5600X). Two throwaway mods, `~/.config/herdr-app/mods/factory-spike15/` and `factory-spike15b/` (`mod.json` `{"place":"none"}`, opened with `herdr-app do mod.open --name <mod>`, closed with `herdr-app do overlay.close`); both are removed. The first reads a command from a file under the worker's scratchpad (`{"id", "where", "ms"}`) and spins for `ms` in the place asked: in `render()` after a `cx.notify()`, in a `cx.timer.every` callback, in a `cx.spawn` task, or in such a task after an `await`. A `cx.timer.every` of 200 ms writes, with an `exec`, how far the loop got. Their sources and the whole record (`out.jsonl`) are in the packet's `logs/spike15/`.

```js
busy(ms, rec) {
  const t0 = Date.now()
  rec.started = true
  let spent = 0
  while (spent < ms) {
    spent = Date.now() - t0
    rec.reached = spent // an interrupt leaves the last value
  }
  rec.ended = true
}
```

The load was 11 loops, each `timeout <seconds> bash -c 'while :; do :; done'`, started through `herdr/factory-slot.sh run`; they ran in the worker's slice (`cpu.max` 800000 100000, so at most 8 of the 12 threads) while the app runs in `app.slice`. The 1-minute load was 1.27 to 2.35 during the runs marked idle and 10.79 to 12.40 during those marked loaded.

```text
              place              runs  completed (longest)  interrupted (`reached`)
idle          render              28    12 (50 ms)           16 (50 to 51 ms)
idle          timer callback      17    11 (500 ms)           6 (500 ms)
idle          task                17    11 (500 ms)           6 (500 to 501 ms)
idle          task after await    17    11 (500 ms)           6 (500 to 501 ms)
loaded        render              23     9 (50 ms)           14 (50 to 51 ms)
loaded        timer callback       6     2 (500 ms)           4 (500 to 501 ms)
loaded        task                 6     2 (500 ms)           4 (500 to 501 ms)
loaded        task after await     6     2 (500 ms)           4 (500 to 501 ms)
```

The first interrupted `render` (`i100`, a run of 100 ms), the state after it, the `cx.notify()` that followed and the state after that:

```text
{"event":"result","id":"i100","where":"render","ms":100,"started":true,"reached":51,"ended":false,"after":false,"renders":4,"ticks":{"driver":32,"probe":25}}
{"event":"state","id":"s1","renders":4,"ticks":{"driver":48,"probe":38}}
{"event":"notify","id":"n1","renders":4}
{"event":"state","id":"s2","renders":5,"ticks":{"driver":74,"probe":59}}
```

What the window showed (`herdr-app shot`):

```text
after an interrupted render:   a red rule and "This view could not be re-rendered; showing the last version that worked",
                               "interrupted" and "Copy details", above the last view that was drawn; `herdr-app status`: errors []
after the next cx.notify():    the view drawn again (render #5), the notice gone (loaded: the counter of renders went from 107 to 108; no shot)
after interrupted callbacks and tasks:  no notice; the view as before, and the interrupted timer fired again at its next time
```

`factory-spike15b` spins for 200 ms in its first `render` only and calls `cx.notify()` every 4 s. Two runs (1-minute load 6.17 and 4.94), a shot 2 s and 11 s after opening:

```text
at 2 s:   "This view could not be rendered", "interrupted", "at render (…/mods/factory-spike15b/main.js?v=16:23:19)",
          "Fix the script and save; the view re-renders on the next change." and "Copy details"
at 11 s:  "first-render spike: drawn by render #3"
herdr-app check <the same mod, an earlier copy>:  "interrupted / at render (…/factory-spike15b/main.js?v=1:22:32)", "check failed"
```

So the app interrupts a script that runs too long: a `render` at 50 ms, the shortest interrupted time measured (runs of 50 ms completed, runs asked for 52 ms or more stopped at 50 or 51 ms), and a `cx.timer.every` callback or a `cx.spawn` task at 500 ms. The times were the same idle and loaded; whether they count wall-clock or CPU time was not told apart, since the loads left threads free. Not run: the limit of `init`, of an event handler (a click, a key, `nextCommand`) and of a mod docked in a layout or in a tab, loads above 12.4, a load that takes all 12 threads, and another version of the app.

Changed outside the two mods' folders: the app made the empty folders `data/factory-spike15/` and `data/factory-spike15b/` (removed) and listed both names in `seen.json`, which the app owns: the entries stay, as does that of `factory-spike15c`, a third throwaway mod of the same issue that only timed `lib/` (removed, with its data folder). `settings.json`, `shared.json`, `view.json` and the files of `layouts/` have the same `sha256sum` after as before. The overlays opened and closed in the maintainer's window, and the loads ended with their commands. Nothing was sent to a terminal.

## What the epic assumes

| Assumption (epic #294)                                                                                      | Result        | Where it was shown                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D6: a mod runs `herdr/factory-slot.sh status` with `exec` and reads its lines (about 0.5 s a call)          | holds         | 2: code 0, 483 to 493 ms, with `cwd` set (the default working directory is the home)                                                         |
| D6, D12: `gh` answers from a mod with the maintainer's login, the mod reading no token (about 0.6 s a call) | holds         | 2: code 0, 514 to 735 ms, login `ale9420`                                                                                                    |
| D3, D6: the load, the memory in use and a temperature can be read every 5 s, by file or by `exec`           | holds         | 3: `/proc/loadavg`, `/proc/meminfo`, `hwmon*/temp1_input` and `sensors -u`; the CPU's sensor is found by name                                |
| D3: a timer of 5 s and one of 60 s run, and stop when the mod closes                                        | holds         | 9: 5.000 s and 60.006 s; `close(cx)` stops both                                                                                              |
| D3: the timers keep running while the panel is not shown                                                    | holds         | 9: a tab that was not the shown one, 80 s; a minimised or covered window was not run                                                         |
| D9: `agents()` has the name the master gave (`worker-<N>`) of every agent                                   | does not hold | 4: `agents()` lists only the master and has no name field; the names are `name` in `terminals()`                                             |
| D9: `agents()` has the space of every agent, and its status                                                 | does not hold | 4: workers are sub-agents, left out of `agents()`; `terminals()` has their status and `parent`, whose space they share                       |
| D9: a worker that waits for the maintainer has a distinct Herdr status                                      | holds         | 4: `blocked`, shown with a throwaway agent that reported it; no real worker was made to wait                                                 |
| D9: the master's context size and model can be read from Herdr                                              | does not hold | 4: no field of `agents()` or `terminals()`; the model only as `--model` in `foreground.argv`                                                 |
| D4: a mod sends a line to one named agent's terminal, with or without Enter                                 | holds         | 5: `hc(["send", name, text])`, `hc(["keys", name, …])`; refused for a `blocked` terminal unless `--force`                                    |
| D4: a program run by an agent could make the same call                                                      | holds         | 5: `hc send` from the worker's shell, tagged `<hc from="t4k worker-296">`; the master's own session was not tried                            |
| D11: a figure of about 12 kB with fills, a stroke and an opacity draws at 16 to 96 px, 30 at once           | holds         | 6: all 30 drawn; the process used 33 to 42 ticks per 10 s open against 31 to 36 closed                                                       |
| D1, D11: a glow around one of them (rule 6)                                                                 | holds         | 6: with a second `image()` behind it; the `shadow_*` presets give a grey box shadow only                                                     |
| D11: the cats replace the icons of Herdr's own agent list                                                   | does not hold | 7: the list is drawn by the shipped `agents` mod; a mod's change to `agents()` stays in its own copy                                         |
| D8: Chakra Petch and JetBrains Mono come with the mod in a `fonts/` folder                                  | holds         | 8: named by their family; loaded at the next look change, not on reload; `REUSE.toml` needs an OFL-1.1 annotation and `LICENSES/OFL-1.1.txt` |
| D13: a form in an overlay (`Input`, `Button`, keys) and a `notify` with an action                           | holds         | 10: drawn and created; typing, a click and a key were not driven                                                                             |
| D5: a floating block for the mod                                                                            | not answered  | 10: needs a layout file; none was edited                                                                                                     |
| D5: the Board is a tab or a pane                                                                            | holds         | 11: `tab.new {mod}` and `pane.split {mod}`                                                                                                   |
| D5: a layout cloned from `main` with the mod docked on the right at 380 px                                  | not answered  | 11: `layout.clone` edits the maintainer's layouts; not run                                                                                   |
| D13: the mod's own settings survive a restart of the app                                                    | not answered  | 12: both files are written at once and survived a mod reload and reopening; the app was not restarted                                        |
| #300, #301: a worker inside its slice runs `herdr-app check` (no window needed) and `herdr-app shot`        | holds         | 13: both from the slice; `check` with no display and an empty home; `shot` needs the window                                                  |
| Runbook: `herdr agent start`, `herdr agent prompt` and `herdr pane split` exist on the host                 | does not hold | 14: no `herdr` program; `hc` and `herdr-app do` are the programs                                                                             |
| #512: a mod's `render` may run for as long as its view takes to build                                       | does not hold | 15: cut at 50 ms, idle and loaded (a callback or a task at 500 ms); the next `cx.notify()` draws it again                                    |
