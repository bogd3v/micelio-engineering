// The members of `gpui-kit` and `gpui-base` the mod calls. The Herdr app writes the full types to
// `gpui-kit.d.ts` in its configuration folder (gpui-shell 0.7.1, herdr-app 0.1.18); neither the
// repository nor CI has that file, so these are the minimum of it, looser in two places: an element
// method answers `this`, and a colour is any string (the app asks for `#...`, and the mod's colours
// reach it from `theme()` as strings). A method the mod starts to use is added from that file.

declare module 'gpui-kit' {
  import type { ScrollHandle } from 'gpui-base'

  /** Pixels as a number, or `<n>px`, `<n>rem`, `<n>%`. */
  export type DefiniteLength = number | `${number}px` | `${number}rem` | `${number}%`
  export type Length = DefiniteLength | 'auto'
  export type AbsoluteLength = number | `${number}px` | `${number}rem`

  export interface ClickEvent {
    click_count: number
  }

  export interface Modifiers {
    shift: boolean
    control: boolean
    alt: boolean
    platform: boolean
  }

  export interface KeyEvent {
    key: string
    modifiers: Modifiers
  }

  export interface FocusHandle {
    focus(): void
  }

  export interface Task {
    cancel(): void
  }

  export interface Timer {
    every(ms: number, handler: (cx: AsyncContext) => void): Task
  }

  export interface Context {
    notify(): void
    focus_handle(): FocusHandle
    spawn(body: (cx: AsyncContext) => unknown): Task
    sleep(ms?: number): Promise<void>
    readonly timer: Timer
  }

  export type AsyncContext = Context

  export type ClickHandler = (event: ClickEvent, cx: Context) => void

  export type Child = NativeElement | string | number | boolean

  export interface NativeElement {
    id(name: string): this
    child(child: Child): this
    children(children: Iterable<Child>): this
    tooltip(text: string): this
    on_click(handler: ClickHandler): this
    on_key_down(handler: (event: KeyEvent, cx: Context) => void): this
    on_mouse_down(button: 'left' | 'right' | 'middle', handler: () => void): this
    track_focus(handle: FocusHandle): this
    track_scroll(handle: ScrollHandle): this
    absolute(): this
    relative(): this
    flex(): this
    flex_1(): this
    flex_col(): this
    flex_none(): this
    flex_wrap(): this
    flex_grow(value: number): this
    items_baseline(): this
    items_center(): this
    items_end(): this
    items_start(): this
    justify_between(): this
    justify_center(): this
    gap(value: DefiniteLength): this
    w(value: Length): this
    w_full(): this
    min_w(value: Length): this
    h(value: Length): this
    h_full(): this
    min_h(value: Length): this
    size_full(): this
    top(value: Length): this
    left(value: Length): this
    p(value: DefiniteLength): this
    px(value: DefiniteLength): this
    py(value: DefiniteLength): this
    pt(value: DefiniteLength): this
    pb(value: DefiniteLength): this
    pl(value: DefiniteLength): this
    mt(value: Length): this
    mb(value: Length): this
    mx(value: Length): this
    bg(value: string): this
    opacity(value: number): this
    text_color(value: string): this
    text_size(value: AbsoluteLength): this
    font_bold(): this
    font_semibold(): this
    font_family(value: string): this
    line_through(): this
    truncate(): this
    whitespace_nowrap(): this
    border_1(): this
    border_b(value: AbsoluteLength): this
    border_l(value: AbsoluteLength): this
    border_r(value: AbsoluteLength): this
    border_t(value: AbsoluteLength): this
    border_color(value: string): this
    border_dashed(): this
    cursor_pointer(): this
    overflow_hidden(): this
    overflow_x_scrollbar(): this
    overflow_y_scrollbar(): this
  }

  export abstract class View {
    init?(props: Record<string, unknown> | undefined, cx: AsyncContext): void
    abstract render(cx: Context): NativeElement
  }

  export function div(): NativeElement
  export function image(path: string): NativeElement
}

declare module 'gpui-base' {
  import type { Context, NativeElement } from 'gpui-kit'

  export interface ScrollHandle {
    scroll_to_item(index: number): void
  }

  export interface InputState {
    value(): string
    set_value(next: string): void
    on(
      event: 'change' | 'submit' | 'focus' | 'blur',
      handler: (event: unknown, cx: Context) => void
    ): boolean
  }

  export type TextareaState = InputState

  export function h_flex(): NativeElement
  export function v_flex(): NativeElement
  export const ScrollHandle: { new: () => ScrollHandle }
  export const InputState: {
    new: (options?: { placeholder?: string; value?: string }) => InputState
  }
  export const TextareaState: {
    new: (options?: { placeholder?: string; value?: string; rows?: number }) => TextareaState
  }
  export const Input: { new: (state: InputState) => NativeElement }
  export const Textarea: { new: (state: TextareaState) => NativeElement }
}
