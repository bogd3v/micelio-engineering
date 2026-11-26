// The members of the `herdr` module the mod calls, and the fields it reads of what they answer. The
// Herdr app writes the module's full types to `herdr.d.ts` in its configuration folder on each start;
// neither the repository nor CI has that file, so these are the minimum of it (herdr-app 0.1.18, hc
// 0.1.22). Where the app says `any` or `unknown`, the type here names what the mod reads. A member the
// mod starts to use is added from that file.

declare module 'herdr' {
  export interface ExecResult {
    code: number
    stdout: string
    stderr: string
  }

  /** A row of `terminals()`: the fields of `hc ls --json` the mod reads, `status` as a plain word. */
  export interface TerminalRow {
    address: string
    name?: string | null
    parent?: string | null
    status?: string
    foreground?: { argv?: string[] } | null
    labels?: Record<string, string>
  }

  export interface PaneInfo {
    pane: string
    mod?: string
    tab: string
    name: string | null
    focused: boolean
  }

  export interface OverlaySpec {
    mod?: string
    props?: Record<string, unknown>
    kind?: 'dialog' | 'popup' | 'window'
    width?: number
    height?: number
  }

  export function exec(
    command: string,
    args?: string[],
    options?: { cwd?: string; on?: string | null; timeout?: number }
  ): Promise<ExecResult>
  export function hc(args: string[]): Promise<ExecResult>
  export function home(): string
  export function checking(): boolean
  export function readTextFile(
    path: string,
    options?: { on?: string | null }
  ): Promise<string | null>
  export function playSound(sound: string): null
  export function run(name: string, args?: Record<string, unknown>): null
  export function panes(): PaneInfo[]
  export function terminals(): TerminalRow[]
  export function window(): { visible: boolean } | null
  export function theme(): Record<string, string>
  export function settings(): Record<string, unknown>
  export function keys(): { section: string; keys: string; action: string }[]
  export function openOverlay(spec: OverlaySpec): string
  export function closeOverlay(id: string): null
  export function notify(n: {
    title: string
    body?: string
    level?: 'info' | 'success' | 'warning' | 'error'
    action?: { name: string; args?: Record<string, unknown> }
  }): string
  export function props(): Record<string, unknown> | undefined
  export function shared(key: string): unknown
  export function setShared(key: string, value: unknown): null
  export function nextCommand(): Promise<string>
}
