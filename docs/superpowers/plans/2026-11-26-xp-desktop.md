# Área de trabalho do XP — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single Explorer window into a simulated XP computer: wallpaper, desktop icons, taskbar, Start menu, real minimize/maximize/close, zoom inside windows, logon/shutdown screens, tray balloons, XP tooltips and synthesized sounds.

**Architecture:** A pure window reducer (`src/lib/windows.ts`) is the single source of truth for open windows; a React context (`DeskProvider`) exposes it, plus `notify` for balloons. Each window kind renders through a generic `AppWindow` that reads its own state from `useWindow()`. A `Session` component above the desktop owns the boot / welcome / shutdown phases. Zoom and mute are tiny external stores persisted in `localStorage`.

**Tech Stack:** React 18, TypeScript 5.7, Vite 6, TanStack Query v5, xp.css 0.2.6. Tests: `apps/web/smoke.ts` run by `tsx` (assertions via `ok(cond, msg)`), plus checks in the browser pane.

**Spec:** `docs/superpowers/specs/2026-11-26-xp-desktop-design.md` (approved). Read it before any task.

## Global Constraints

- Never edit anything under `apps/api/`. No new npm dependencies.
- Never run git. The user commits; Task 9 hands over the commands.
- No Microsoft material: no Bliss photo, no Windows flag, no original sounds or icons. No *Windows XP Pixel Alt* font. UI font stays **Tahoma 11px**.
- Identifiers and comments in English; every UI string in pt-BR, exactly as written in this plan.
- No `fetch` in components; never call `/disk/format` on its own (CLAUDE.md item 10).
- Must work in mock mode and against the real backend. Validate the real backend only with an isolated pair (`FAT_DISK_PATH` on a scratch file, ports 8001/5175; 5174 is taken by the user's own front), never with `apps/api/fat_disk.img`.
- Target browsers: Chrome/Edge and Firefox ≥ 126 (CSS `zoom`, `Element.currentCSSZoom`).
- Values from the spec: taskbar 30 px, gradient `#245EDC` → `#3F8CF3`; Start `#3C8A2E`; inactive title bar `#7A96DF` → `#A6C3F0`; tooltip and balloon `#FFFFE1` with 1 px black border; tooltip delay ~500 ms; balloon ~6 s; minimize animation ~200 ms; boot ~3 s; grayscale fade ~1 s; zoom steps 75, 90, 100, 110, 125, 150, 175, 200%.
- `npm run check` (from the repo root) must pass at the end of every task.

## Review Focus

1. **Keys reaching a hidden window**: with a file selected, minimizing the Explorer or clicking the desktop and then pressing Delete must do nothing. (Task 1: `takesKeys` tests; Task 3: browser check.)
2. **Zoomed coordinates**: at 200%, 150% and 75%, the context menu opens at the pointer, the rename error balloon hangs under the field, dialogs cover the whole screen, and keyboard scrolling in the list keeps the row in view. (Task 5: browser checks.)
3. **Format remounts the Explorer** (`key={disk}` in `Explorer.tsx`): the window must keep its position and maximized state, and the taskbar button must survive. (Task 3: browser check after a format.)
4. **The demo script still holds**: after logon the Explorer opens in A:\, the nine steps of `docs/demo/roteiro.md` give the same numbers, and with no disk the format dialog of tela 17 still appears. (Task 9.)
5. **Bad stored state**: a `localStorage` zoom of `"abc"` or `"3"` falls back to 100%; reloading a tab that already logged on skips the boot; `?sem-boot` works together with `?sem-disco`. (Task 2 and Task 6 tests.)

---

### Task 1: Window rules (pure)

**Files:**
- Create: `apps/web/src/lib/windows.ts`
- Test: `apps/web/smoke.ts` (new section 23, before the final `console.log`)

**Interfaces:**
- Produces:
  ```ts
  export type WindowKind = 'explorer' | 'recycle'
  export type Point = { x: number; y: number }
  export type Size = { width: number; height: number }
  export type Win = { id: string; kind: WindowKind; title: string; pos: Point; z: number; minimized: boolean; maximized: boolean; data?: string }
  export type Desk = { windows: Win[]; activeId: string | null; nextId: number; nextZ: number }
  export type DeskAction =
    | { type: 'open'; kind: WindowKind; pos: Point; data?: string }
    | { type: 'activate' | 'minimize' | 'toggleMaximize' | 'close' | 'taskbar'; id: string }
    | { type: 'deactivate' }
    | { type: 'move'; id: string; pos: Point }
    | { type: 'retitle'; id: string; title: string }
    | { type: 'clampAll'; viewport: Size }
  export const TASKBAR_HEIGHT = 30, TITLE_HEIGHT = 28, KEEP_VISIBLE = 120
  export const SINGLE_INSTANCE: Record<WindowKind, boolean>   // both true
  export const WINDOW_SIZE: Record<WindowKind, Size>          // explorer 860x620, recycle 420x300
  export const DEFAULT_TITLE: Record<WindowKind, string>      // 'Simulador FAT', 'Lixeira'
  export const EMPTY_DESK: Desk                               // nextId 1, nextZ 1
  export function deskReducer(desk: Desk, action: DeskAction): Desk
  export function topVisible(desk: Desk): Win | null
  export function takesKeys(desk: Desk, id: string): boolean  // active and not minimized
  export function initialPos(kind: WindowKind, viewport: Size, openCount: number): Point
  export function clampPos(pos: Point, size: Size, viewport: Size): Point
  ```
  `viewport` is always the desktop area: `{ width: innerWidth, height: innerHeight - TASKBAR_HEIGHT }`.

**Deviation from the spec:** the spec gives `Win` a single `state: 'normal' | 'minimized' | 'maximized'`. The plan uses two booleans so that a maximized window comes back maximized after a minimize. It changes nothing the user sees.

Rules the reducer must follow (spec, "Gerenciador de janelas"):
- `open` of a single-instance kind that exists: un-minimize, activate, raise; `pos` ignored. Otherwise append `{ id: \`${kind}-${nextId}\`, title: DEFAULT_TITLE[kind] }`, active, on top.
- `activate`: un-minimize, set active, `z = nextZ++`.
- `minimize`: if it was active, `activeId = topVisible(after)?.id ?? null`.
- `taskbar`: active and visible → behaves as `minimize`; otherwise → `activate`.
- `toggleMaximize` flips `maximized` and activates. Restoring a minimized window keeps `maximized`.
- `move` is ignored while maximized; the stored `pos` is the normal-state position.
- `close`: remove; if it was active, activate `topVisible`.
- `clampAll`: `clampPos` on every window.
- `initialPos`: Explorer centred, `Math.max(0, Math.round((viewport − size) / 2))`; other kinds the same plus `24 × openCount` on both axes.
- `clampPos`: the rule in `ExplorerWindow.tsx` today, using `viewport`:
  - `x` ∈ [`KEEP_VISIBLE − width`, `viewport.width − KEEP_VISIBLE`]
  - `y` ∈ [0, `viewport.height − TITLE_HEIGHT`]

- [ ] **Step 1: Write section 23 of the smoke test**

```ts
  console.log('\n23. Janelas (area de trabalho XP)')
  const vp = { width: 1280, height: 690 }
  let d = deskReducer(EMPTY_DESK, { type: 'open', kind: 'explorer', pos: initialPos('explorer', vp, 0) })
  const ex = d.windows[0]
  ok(d.windows.length === 1 && d.activeId === ex.id && ex.title === 'Simulador FAT', 'abrir o Explorer: uma janela, ativa')
  ok(ex.pos.x === 210 && ex.pos.y === 35, 'Explorer centralizado acima da barra de tarefas')
  d = deskReducer(d, { type: 'open', kind: 'explorer', pos: { x: 0, y: 0 } })
  ok(d.windows.length === 1 && d.windows[0].pos.x === 210, 'instancia unica: reabrir nao cria outra')
  d = deskReducer(d, { type: 'open', kind: 'recycle', pos: initialPos('recycle', vp, 1) })
  const rc = d.windows[1]
  ok(d.activeId === rc.id && rc.z > ex.z, 'Lixeira abre ativa e no topo')
  ok(takesKeys(d, rc.id) && !takesKeys(d, ex.id), 'so a janela ativa recebe teclas')
  d = deskReducer(d, { type: 'taskbar', id: rc.id })
  ok(d.windows[1].minimized && d.activeId === ex.id, 'botao da ativa minimiza e ativa a proxima')
  ok(!takesKeys(d, rc.id), 'minimizada nao recebe teclas')
  d = deskReducer(d, { type: 'taskbar', id: rc.id })
  ok(!d.windows[1].minimized && d.activeId === rc.id, 'botao da minimizada restaura e ativa')
  d = deskReducer(d, { type: 'activate', id: ex.id })
  ok(d.windows[0].z > d.windows[1].z, 'ativar traz para o topo')
  d = deskReducer(d, { type: 'toggleMaximize', id: ex.id })
  d = deskReducer(d, { type: 'move', id: ex.id, pos: { x: 5, y: 5 } })
  ok(d.windows[0].maximized && d.windows[0].pos.x === 210, 'maximizada nao arrasta')
  d = deskReducer(d, { type: 'minimize', id: ex.id })
  d = deskReducer(d, { type: 'taskbar', id: ex.id })
  ok(d.windows[0].maximized && !d.windows[0].minimized, 'restaurar volta maximizada')
  d = deskReducer(d, { type: 'retitle', id: ex.id, title: 'A:\\DOCS (Simulador FAT)' })
  ok(d.windows[0].title === 'A:\\DOCS (Simulador FAT)', 'titulo acompanha a pasta')
  d = deskReducer(d, { type: 'deactivate' })
  ok(d.activeId === null && !takesKeys(d, ex.id), 'clique na area de trabalho desativa todas')
  d = deskReducer(d, { type: 'activate', id: ex.id })
  d = deskReducer(d, { type: 'close', id: ex.id })
  ok(d.windows.length === 1 && d.activeId === rc.id, 'fechar a ativa ativa a proxima visivel')
  d = deskReducer(d, { type: 'minimize', id: rc.id })
  ok(d.activeId === null && topVisible(d) === null, 'tudo minimizado: nenhuma ativa')
  const lim = clampPos({ x: -5000, y: 5000 }, { width: 860, height: 620 }, vp)
  ok(lim.x === 120 - 860 && lim.y === 690 - 28, 'barra de titulo sempre alcancavel acima da barra de tarefas')
  d = deskReducer({ ...d, windows: d.windows.map((w) => ({ ...w, pos: { x: 3000, y: 3000 } })) }, { type: 'clampAll', viewport: vp })
  ok(d.windows[0].pos.x === 1280 - 120 && d.windows[0].pos.y === 690 - 28, 'janela fora da tela volta ao redimensionar')
```

Add `import { EMPTY_DESK, clampPos, deskReducer, initialPos, takesKeys, topVisible } from './src/lib/windows'` at the top of `smoke.ts`.

- [ ] **Step 2: Run it and see it fail** — `cd apps/web && npx tsx smoke.ts`. Expected: a module-not-found error for `./src/lib/windows`.
- [ ] **Step 3: Implement `src/lib/windows.ts`** with the interface and rules above. No React import.
- [ ] **Step 4: Run it and see it pass** — `cd apps/web && npx tsx smoke.ts`. Expected: section 23 all `ok`, `TUDO OK`.

### Task 2: Zoom steps, stored preferences, sound

**Files:**
- Create: `apps/web/src/lib/zoom.ts`, `apps/web/src/lib/prefs.ts`, `apps/web/src/hooks/usePref.ts`, `apps/web/src/lib/sound.ts`
- Test: `apps/web/smoke.ts` (new section 24)

**Interfaces:**
- Produces:
  ```ts
  // lib/zoom.ts
  export const ZOOM_STEPS: readonly number[]               // [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
  export function stepZoom(z: number, dir: 1 | -1): number // nearest step strictly beyond z; stays at the ends
  export function parseZoom(stored: string | null): number // a value in ZOOM_STEPS, else 1
  export function formatZoom(z: number): string            // '150%'
  // lib/prefs.ts — external store; localStorage wrapped in try/catch, memory fallback (node, private mode)
  export type Pref<T> = { get(): T; set(v: T): void; subscribe(fn: () => void): () => void }
  export function createPref<T>(key: string, parse: (s: string | null) => T, serialize: (v: T) => string): Pref<T>
  export const zoomPref: Pref<number>   // key 'fatxp.zoom', parseZoom
  export const mutePref: Pref<boolean>  // key 'fatxp.mute', default false
  // hooks/usePref.ts
  export function usePref<T>(pref: Pref<T>): [T, (v: T) => void]   // useSyncExternalStore
  // lib/sound.ts — Web Audio oscillators, no files; no-op when muted or AudioContext is missing
  export type SoundName = 'logon' | 'logoff' | 'error' | 'balloon'
  export function playSound(name: SoundName): void
  ```
  - Sounds (spec, "Sons"): `logon` is a rising chord, `logoff` a falling one, `error` a single "ding", `balloon` a short pop.
  - One shared `AudioContext`, created lazily on the first play.

- [ ] **Step 1: Write section 24 of the smoke test**

```ts
  console.log('\n24. Zoom e preferencias')
  ok(stepZoom(1, 1) === 1.1 && stepZoom(1, -1) === 0.9, 'um passo para cada lado')
  ok(stepZoom(2, 1) === 2 && stepZoom(0.75, -1) === 0.75, 'para nos extremos 75% e 200%')
  ok(stepZoom(1.3, 1) === 1.5 && stepZoom(1.3, -1) === 1.25, 'valor fora da lista vai ao passo vizinho')
  ok(parseZoom('1.5') === 1.5 && parseZoom('abc') === 1 && parseZoom('3') === 1 && parseZoom(null) === 1, 'zoom guardado invalido volta a 100%')
  ok(formatZoom(1.5) === '150%' && formatZoom(0.9) === '90%', 'porcentagem')
  zoomPref.set(1.25)
  ok(zoomPref.get() === 1.25, 'preferencia funciona sem localStorage')
  zoomPref.set(1)
  ok(mutePref.get() === false, 'som comeca ligado')
```

Add `import { formatZoom, parseZoom, stepZoom } from './src/lib/zoom'` and `import { mutePref, zoomPref } from './src/lib/prefs'` at the top of `smoke.ts`.

- [ ] **Step 2: Run it and see it fail** — `cd apps/web && npx tsx smoke.ts`. Expected: module not found.
- [ ] **Step 3: Implement the four files.** `playSound` must not throw under node, because smoke imports modules that call it.
- [ ] **Step 4: Run it and see it pass** — `npx tsx smoke.ts` → `TUDO OK`; then `npm run typecheck -w apps/web` from the root → no errors.

### Task 3: Desktop context, generic window, real caption buttons

**Files:**
- Create:
  - `apps/web/src/components/desktop/DeskContext.tsx`
  - `apps/web/src/components/shell/AppWindow.tsx`
  - `apps/web/src/lib/balloons.ts`: only the `BalloonInput` type for now, so `smoke.ts` can import Task 7's functions without pulling in React
- Modify:
  - `apps/web/src/components/shell/TitleBar.tsx`: real buttons; double-click toggles maximize
  - `apps/web/src/components/shell/Desktop.tsx`: renders the windows
  - `apps/web/src/App.tsx`
  - `apps/web/src/components/explorer/Explorer.tsx`: `ExplorerWindow` → `AppWindow`; shortcuts gated
  - `apps/web/src/styles/app.css`: `.desk-area`, maximized, inactive title bar
- Delete: `apps/web/src/components/shell/ExplorerWindow.tsx`, once nothing imports it

**Interfaces:**
- Consumes: Task 1, all of it.
- Produces:
  ```ts
  // lib/balloons.ts
  export type BalloonInput = { title: string; text: string; icon: 'ok' | 'warning' | 'drive' }
  // DeskContext.tsx
  export type DeskApi = { desk: Desk; dispatch(a: DeskAction): void; open(kind: WindowKind, data?: string): void; notify(b: BalloonInput): void; balloon: BalloonInput | null; dismissBalloon(): void }
  export function DeskProvider(props: { children: ReactNode }): JSX.Element   // starts with the Explorer open (initialPos)
  export function useDesk(): DeskApi
  export type WindowApi = Win & { active: boolean; takesKeys: boolean; minimize(): void; toggleMaximize(): void; close(): void; activate(): void; move(p: Point): void }
  export const WindowContext: React.Context<WindowApi | null>
  export function useWindow(): WindowApi
  // AppWindow.tsx
  export function AppWindow(props: { title: string; icon: IconName; children: ReactNode }): JSX.Element
  ```
  - `notify` and `balloon` can be stubs here; Task 7 implements them.
  - `AppWindow`:
    - takes its size from `WINDOW_SIZE[kind]`
    - dispatches `retitle` when `title` changes
    - is `display: none` while minimized, but stays mounted
    - activates on any pointerdown inside it, in the capture phase
    - drags by the title bar using `clampPos` (logic moved from `ExplorerWindow`)
    - dispatches `clampAll` on `resize`
    - sets `data-window-id`
    - draws the class `inactive` when not active: the title bar gradient, plus faded title text and caption buttons. The selected row turns `#D4D4D4` by itself, because the list loses focus.
    - wraps `children` in the body div (`.explorer-body`) that Task 5 zooms
  - `Desktop` renders `.desk-area` (`inset: 0 0 30px 0`; windows are positioned inside it) and maps each `Win` through `WindowContext.Provider` to a component chosen by kind (`explorer` → `Explorer`, `recycle` arrives in Task 4). A pointerdown on the empty `.desk-area` dispatches `deactivate`.
  - Maximized window: `left: 0; top: 0; width: 100%; height: 100%` of `.desk-area`. The Maximize button gets `aria-label="Restore"` (xp.css draws it).
  - **Layers:** `.desk-area` is its own stacking context (`z-index: 1`), and the taskbar layer sits above it (`z-index: 2`). Window `z` values therefore never compete with the taskbar, however high they grow.
  - **Modals cover the taskbar** (spec, layer 5): `.desk-area:has(.dialog-overlay) { z-index: 3 }`, and the window that holds the overlay goes above its siblings with `.app-window:has(.dialog-overlay) { z-index: 2147483000 !important }` (`!important` beats the inline `z`).
  - `Explorer.tsx`: `useWindowShortcuts(..., !modal && win.takesKeys)`.
  - `App.tsx`: `<div className="xp"><DeskProvider><Desktop /></DeskProvider></div>` for now; Task 6 puts `Session` here.

- [ ] **Step 1: Implement the context, `AppWindow`, `TitleBar`, `Desktop` and `App`; move `Explorer` to `AppWindow`; delete `ExplorerWindow.tsx`.** A temporary 30 px placeholder strip stands where the taskbar will be.
- [ ] **Step 2: Typecheck and smoke** — `npm run check` from the root. Expected: `69 passed`, `TUDO OK`, no `error TS`.
- [ ] **Step 3: Browser check, mock (http://localhost:5173, the user's dev server)**:
  - **minimize:** the window vanishes. There is no taskbar yet, so restore it by reloading.
  - **maximize:** fills the area above the strip, and the button becomes Restore.
  - **title bar double-click:** toggles maximize.
  - **close:** the window vanishes.
  - **inactive:** click the desktop; the title bar turns to the inactive gradient.
  - **Delete blocked (Review Focus 1):** select a file, click the desktop, press Delete; no confirmation dialog opens. Click the window and press Delete; the dialog opens.
  - **modal on top:** with Propriedades open, the overlay also covers the placeholder strip, and clicking the strip does nothing.
- [ ] **Step 4: Browser check, format remount (Review Focus 3)** — maximize, then run Disco › Formatar… › Iniciar › Formatar. The window stays maximized and no second window appears.

### Task 4: Wallpaper, desktop icons, taskbar, tray, Lixeira

**Files:**
- Create:
  - `apps/web/src/components/desktop/Taskbar.tsx`
  - `apps/web/src/components/desktop/Tray.tsx`
  - `apps/web/src/components/desktop/DesktopIcons.tsx`
  - `apps/web/src/components/desktop/RecycleBin.tsx`
- Modify:
  - `apps/web/src/components/common/Icon.tsx`: new names, plus a per-name `viewBox` record replacing the ternary
  - `apps/web/src/components/shell/Desktop.tsx`: wallpaper, icons and taskbar; drop `desktop-mock-badge`; register `recycle`
  - `apps/web/src/styles/app.css`

**Interfaces:**
- Consumes: `useDesk()`, `useWindow()`, `AppWindow` (Task 3); `USANDO_MOCK` from `src/api`; `usePref(mutePref)` (Task 2).
- Produces:
  - New `IconName`s:
    - 32 px: `'computer' | 'recycle' | 'user' | 'logoff' | 'shutdown'`
    - 16 px: `'start' | 'speaker' | 'speakerOff' | 'mock'`
  - `Taskbar` renders `data-task-id={win.id}` on each window button; Task 8 animates towards it.
  - `KIND_ICON: Record<WindowKind, IconName>` in `Taskbar.tsx`: `explorer` → `folderOpen`, `recycle` → `recycle`. Each taskbar button shows the icon and then the title.
  - `Taskbar` has a Start-button slot `onStart?: () => void`, filled in Task 6.

Copy (exact):
- **Desktop icons:** "Meu computador" (top left) opens `explorer`; "Lixeira" (bottom right, above the taskbar) opens `recycle`.
- **Start button:** "Iniciar" in white bold italic, with the `start` icon, on `#3C8A2E` with rounded right corners. There is no Windows flag.
- **Taskbar buttons:** the window's `title`. A button is pressed when its window is active and visible; a click dispatches `taskbar`.
- **Tray:**
  - **speaker:** tooltip "Som ligado" or "Som desligado"; a click toggles `mutePref`.
  - **mock icon:** shown only when `USANDO_MOCK`; tooltip "Modo mock: os dados ficam só neste navegador."
  - **clock:** `HH:MM`, from `toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })`; tooltip from `toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })`.
- **Lixeira window:** status bar "0 objetos"; centred in the white area, "A Lixeira está vazia." and, in grey, "No simulador, excluir libera os clusters na hora: nada passa pela Lixeira."

- [ ] **Step 1: Implement**:
  - **wallpaper:** CSS on `.desktop`: a sky gradient, a green hill drawn with an inline SVG or an ellipse pseudo-element, and soft clouds from radial gradients.
  - **icons:** selected on click (blue label), opened on double-click or Enter, deselected on a click on empty space.
  - **taskbar:** 30 px, `#245EDC` → `#3F8CF3`; buttons shrink when space runs out.
  - **tray:** light blue, with a bevelled edge.
- [ ] **Step 2: `npm run check`** → green.
- [ ] **Step 3: Browser check, mock**:
  - **taskbar button:** minimize from the title bar; the window returns from its taskbar button. Clicking the button of the active window minimizes it.
  - **reopen:** close the Explorer; "Meu computador" reopens it in A:\.
  - **Lixeira:** opens on top as the active window, with two taskbar buttons.
  - **clock and tooltip:** the clock shows the time, and its tooltip shows the date.
  - **mute:** the speaker toggles, and the choice survives a reload.
  - **mock badge:** the corner badge is gone and the mock icon sits in the tray.

### Task 5: Zoom inside windows

**Files:**
- Modify:
  - `apps/web/src/components/shell/AppWindow.tsx`: zoom on the body; Ctrl+wheel; Ctrl +/−/0
  - `apps/web/src/components/explorer/Explorer.tsx`: Exibir menu; status bar field
  - `apps/web/src/components/shell/StatusBar.tsx`: optional 4th field
  - `apps/web/src/components/desktop/RecycleBin.tsx`: the same zoom field on its status bar
  - `apps/web/src/lib/zoom.ts`: `clampMenu`
  - `apps/web/src/lib/dom.ts`: `effectiveZoom`, and `revealIn` made zoom-aware
  - `apps/web/src/components/shell/ContextMenu.tsx`: its clamp becomes `clampMenu`
  - `apps/web/src/components/explorer/RenameField.tsx`
- Test: `apps/web/smoke.ts`, section 24 (append)

**Interfaces:**
- Consumes: `zoomPref`, `stepZoom`, `formatZoom` (Task 2); `useWindow().takesKeys` (Task 3).
- Produces:
  - `export function effectiveZoom(el: Element): number` in `lib/dom.ts`:
    - `currentCSSZoom` when the browser has it (read through `'currentCSSZoom' in el`, since the TS DOM lib may lack it)
    - otherwise `getBoundingClientRect().width / offsetWidth`
    - otherwise `1`, when `offsetWidth` is 0
  - `export function clampMenu(at: Point, size: Size, viewport: Size, zoom: number): Point` in `lib/zoom.ts`:
    - **Inputs:** `at` (pointer), `size` (menu) and `viewport` are screen px.
    - **Flip rule:** today's rule in `ContextMenu`. When the menu would overflow, it opens to the left or upwards: `Math.max(0, at − size)`.
    - **Output:** CSS px for `left` / `top` inside the zoom, so the result is divided by `zoom`.
    - **Types:** `Point` and `Size` come from `lib/windows`.
  - `StatusBar` gains the prop `zoom?: ReactNode`, rendered as a 4th sunken field only when set.

Behaviour (spec, "Zoom"):
- **Where it applies:** `style={{ zoom }}` on the `AppWindow` body. The title bar stays unzoomed.
- **Ctrl+wheel:** a native `wheel` listener on the window root with `{ passive: false }`. With `ctrlKey` it calls `preventDefault` and sets `stepZoom(z, deltaY < 0 ? 1 : -1)`.
- **Keys:** a `keydown` listener on `window`, capture phase, active only while `takesKeys`. Ctrl with "+" or "=" zooms in, Ctrl with "-" zooms out, Ctrl+0 resets to 1. Each one calls `preventDefault`.
- **Exibir menu:** add, after "Detalhes", a separator, then "Ampliar" (shortcut `Ctrl++`), "Reduzir" (`Ctrl+−`) and "Tamanho normal" (`Ctrl+0`).
- **Status bar:** `zoom={z !== 1 ? \`Zoom: ${formatZoom(z)}\` : undefined}`.
- **Coordinates:** `clientX`, `clientY` and `getBoundingClientRect` are screen px; `left`, `top`, `scrollTop` and `clientHeight` are CSS px inside the zoom. Divide or multiply by `effectiveZoom` of the element being positioned:
  - **`ContextMenu`:** `at` and the clamp against `innerWidth` / `innerHeight`.
  - **`RenameField`:** the balloon position.
  - **`revealIn`:** the scroll deltas.

- [ ] **Step 1: Append to section 24 of the smoke test**

```ts
  const tela = { width: 1280, height: 720 }
  const sem = clampMenu({ x: 100, y: 100 }, { width: 200, height: 300 }, tela, 1)
  ok(sem.x === 100 && sem.y === 100, 'menu cabe: abre no ponteiro')
  const z2 = clampMenu({ x: 1100, y: 600 }, { width: 200, height: 300 }, tela, 2)
  ok(z2.x === 450 && z2.y === 150, 'zoom 200%: vira para a esquerda e para cima, em px CSS')
  const z2ok = clampMenu({ x: 300, y: 200 }, { width: 200, height: 300 }, tela, 2)
  ok(z2ok.x === 150 && z2ok.y === 100, 'zoom 200%: ponteiro dividido pelo zoom')
```

  (For `z2`: 1100 + 200 > 1280 gives x = 900 screen px, which is 450 CSS px; 600 + 300 > 720 gives y = 300 screen px, which is 150 CSS px.) Add `clampMenu` to the `./src/lib/zoom` import in `smoke.ts`.

- [ ] **Step 2: Run it and see it fail** — `npx tsx smoke.ts` → `clampMenu` is not exported.
- [ ] **Step 3: Implement the above.**
- [ ] **Step 4: `npm run check`** → green.
- [ ] **Step 5: Browser check, mock, at 200%, 150% and 75% (Review Focus 2)**:
  - **context menu:** opens with its corner within 2 px of the pointer.
  - **rename error:** renaming to a duplicate name shows the error balloon right under the field.
  - **dialogs:** Propriedades and Formatar are centred, grow with the zoom, and their overlay blocks clicks everywhere.
  - **keyboard scrolling:** arrow keys keep the selected row visible in a long folder.
  - **cluster map:** at 200% in the normal (not maximized) window, the map and the list scroll instead of overflowing the window.
  - **wheel inside:** Ctrl+wheel over the window does not change the browser zoom.
  - **wheel outside:** Ctrl+wheel over the wallpaper still zooms the browser.
  - **status bar:** shows "Zoom: 150%".
  - **reload:** keeps the level.

### Task 6: Session (boot, Bem-vindo, logoff, shutdown) and Start menu

**Files:**
- Create:
  - `apps/web/src/lib/session.ts`
  - `apps/web/src/components/session/Session.tsx`
  - `apps/web/src/components/session/BootScreen.tsx`
  - `apps/web/src/components/session/WelcomeScreen.tsx`
  - `apps/web/src/components/session/ShutdownDialog.tsx`
  - `apps/web/src/components/desktop/StartMenu.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/desktop/Taskbar.tsx`, `apps/web/src/styles/app.css`
- Test: `apps/web/smoke.ts`, section 24 (append)

**Interfaces:**
- Consumes: `DeskProvider`, `useDesk().open` (Task 3); `playSound` (Task 2).
- Produces:
  ```ts
  // lib/session.ts
  export type Phase = 'boot' | 'welcome' | 'desktop' | 'standby' | 'shutting' | 'off'
  export const SIGNED_IN_KEY = 'fatxp.signedIn'   // sessionStorage
  export function startPhase(search: string, signedIn: boolean): Phase   // 'desktop' if signedIn or the URL has sem-boot, else 'boot'
  // Session.tsx
  export function useSession(): { logoff(): void; requestShutdown(): void }
  ```
  `App.tsx` becomes `<div className="xp"><Session /></div>`. `Session` mounts `DeskProvider` and `Desktop` in phases `desktop`, `standby` and `shutting`. Logoff, Desligar and Reiniciar unmount them, so a later logon starts fresh with the Explorer in A:\.

Phase transitions and copy (exact):
- **boot**: black screen, the text "Simulador FAT", a segmented blue bar running for ~3 s → `welcome`. Any key or click skips.
- **welcome**:
  - left side: "Simulador FAT" and "Para começar, clique no seu nome de usuário"
  - right side: one user tile, "Usuário", with the `user` icon
  - clicking the tile:
    - plays `logon`
    - sets `SIGNED_IN_KEY`
    - shows "Bem-vindo" for ~1 s
    - goes to `desktop`
- **Start menu** (from the Iniciar button; closes on Esc, an outside click or a pick):
  - header: the `user` icon and "Usuário"
  - white column: "Simulador FAT" → `open('explorer')`
  - light-blue column: "Meu computador" → `open('explorer')`, "Lixeira" → `open('recycle')`
  - footer: "Fazer logoff" → `logoff()`, "Desligar o computador" → `requestShutdown()`
- **logoff**: plays `logoff`, clears `SIGNED_IN_KEY`, goes to `welcome`.
- **requestShutdown**: the desktop gets class `fading` (`filter: grayscale(1)`, transition ~1 s) and `ShutdownDialog` opens, titled "Desligar o computador". Its buttons:
  - **"Em espera"** → `standby`: a black overlay above the mounted desktop; a click or key returns to `desktop` and the colour comes back.
  - **"Desligar"** → plays `logoff`, clears the key, goes to `shutting` ("Desligando…", ~1.5 s), then `off`. The `off` screen is black with "Clique para ligar o computador"; a click goes to `boot`.
  - **"Reiniciar"** → clears the key and goes to `boot`.
  - **"Cancelar"** → closes the dialog and removes `fading`.
- None of this calls the API.

- [ ] **Step 1: Append to section 24 of the smoke test**

```ts
  ok(startPhase('', false) === 'boot' && startPhase('?sem-boot', false) === 'desktop', 'inicializacao: ?sem-boot pula')
  ok(startPhase('', true) === 'desktop', 'ja logado nesta aba vai direto')
  ok(startPhase('?sem-disco&sem-boot', false) === 'desktop' && startPhase('?sem-disco', false) === 'boot', 'sem-boot convive com sem-disco')
```

Add `import { startPhase } from './src/lib/session'` at the top of `smoke.ts`.

- [ ] **Step 2: Run it and see it fail** — `cd apps/web && npx tsx smoke.ts` → `session` module not found.
- [ ] **Step 3: Implement** the session module, the screens, the Start menu and the wiring in `App`.
- [ ] **Step 4: `npm run check`** → green.
- [ ] **Step 5: Browser check, mock** (in a new tab, without `?sem-boot`):
  - **boot and logon:** boot → Bem-vindo → clicking the tile plays the sound and opens the desktop with the Explorer in A:\.
  - **reload:** goes straight to the desktop.
  - **logoff:** returns to Bem-vindo.
  - **shutdown dialog:** Desligar o computador fades to grey. Cancelar restores the colour; Em espera goes black, and a click comes back with the windows as they were.
  - **Desligar:** shows "Desligando…", then the off screen, then a click boots.
  - **Reiniciar:** boots.
  - **?sem-boot:** skips both screens.

### Task 7: Tray balloons and error sound

**Files:**
- Create: `apps/web/src/lib/balloons.ts`, `apps/web/src/components/desktop/Balloon.tsx`
- Modify:
  - `apps/web/src/components/desktop/DeskContext.tsx`: real `notify`, 6 s timer, `playSound('balloon')`
  - `apps/web/src/components/desktop/Tray.tsx`: renders `Balloon` anchored above the tray
  - `apps/web/src/components/explorer/Explorer.tsx`: `onFormatted(info)` → `notify(formattedBalloon(info))`; `CheckReport onResult`
  - `apps/web/src/components/inspector/CheckReport.tsx`: optional `onResult?: (r: DiskCheck) => void` after each completed run, the first one and "again"
  - `apps/web/src/components/dialogs/ErrorDialog.tsx`: `playSound('error')` on mount
- Test: `apps/web/smoke.ts`, new section 25

**Interfaces:**
- Consumes: `BalloonInput` (Task 3); `DiskInfo`, `DiskCheck` from `src/api`; `formatCount` from `src/lib/content`.
- Produces:
  ```ts
  export function formattedBalloon(info: DiskInfo): BalloonInput   // { title: 'Disco formatado', text: `${variante} · ${formatCount(clustersLivres)} clusters livres`, icon: 'drive' }
  export function checkBalloon(r: DiskCheck): BalloonInput         // title 'Verificação concluída'; icon 'ok' or 'warning'
  ```
  `checkBalloon` texts: "Nenhum problema encontrado." when `consistente`, "1 problema encontrado." for one error, and `${n} problemas encontrados.` for more.
  - `ExplorerBody`'s prop becomes `onFormatted: (info: DiskInfo) => void`.
  - **Balloon look:** `#FFFFE1`, rounded corners, a tail pointing down at the tray, a bold title with its icon, and a × button.
  - **Replacement:** a new `notify` replaces the current balloon.

- [ ] **Step 1: Write section 25 of the smoke test**

```ts
  console.log('\n25. Baloes da bandeja')
  const info32 = await mockApi.formatDisk({ variante: 'fat32', cluster_size: 512, num_clusters: 1024 })
  ok(formattedBalloon(info32).text === 'FAT32 · 1.023 clusters livres', 'balao de formatacao com os numeros do disco')
  ok(checkBalloon({ consistente: true, erros: [] }).text === 'Nenhum problema encontrado.', 'verificacao limpa')
  ok(checkBalloon({ consistente: false, erros: ['a'] }).text === '1 problema encontrado.' &&
     checkBalloon({ consistente: false, erros: ['a', 'b'] }).text === '2 problemas encontrados.', 'singular e plural')
  ok(checkBalloon({ consistente: false, erros: ['a'] }).icon === 'warning', 'problema usa icone de aviso')
```

Add `import { checkBalloon, formattedBalloon } from './src/lib/balloons'` at the top of `smoke.ts`. A fresh FAT32 disk of 1024 clusters has 1023 free ones, because the root takes one (smoke, sections 2 and 3).

- [ ] **Step 2: Run it and see it fail** — `npx tsx smoke.ts` → `balloons` module not found.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm run check`** → green.
- [ ] **Step 5: Browser check, mock**:
  - **format:** the "Disco formatado" balloon shows the numbers of the new disk and disappears after ~6 s.
  - **check:** Verificar disco shows the report and the "Verificação concluída" balloon.
  - **error sound:** an error dialog plays the ding; with mute on there is no sound.

### Task 8: Minimize animation and XP tooltips

**Files:**
- Create: `apps/web/src/lib/ghost.ts`, `apps/web/src/components/desktop/TooltipLayer.tsx`
- Modify:
  - `apps/web/src/components/shell/AppWindow.tsx`: keeps its last visible rect in a ref; on the minimized change it flies the ghost to or from `[data-task-id="<id>"]`
  - `apps/web/src/App.tsx`: mounts `TooltipLayer` once, outside `Session`
  - `apps/web/src/styles/app.css`

**Interfaces:**
- Produces:
  - `export function flyGhost(from: DOMRect, to: DOMRect): void`: a `position: fixed` div in the title bar colour, animated with `element.animate` over ~200 ms and removed when it ends. It does nothing under `prefers-reduced-motion`.
  - `TooltipLayer`: document-level listeners.
    - **On `mouseover`:** take `closest('[title]')`, move `title` into `data-tip` (so the native tooltip never shows), and show the XP tooltip after ~500 ms near the pointer (`clientX`, `clientY + 20`, clamped to the viewport).
    - **On `mouseout` of that element:** restore `title` and hide.
    - **On `mousedown`, `keydown` and `wheel`:** hide.
    - **Look:** rendered outside any zoom, in screen px: `#FFFFE1`, 1 px black border, Tahoma 11 px, light shadow.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: `npm run check`** → green.
- [ ] **Step 3: Browser check, mock**:
  - **ghost:** minimizing and restoring fly a ghost between the window and its button.
  - **tooltips:** hovering a cluster on the map shows the yellow tooltip, and the native one never appears.
  - **zoom:** at 150% the tooltip still sits next to the pointer.

### Task 9: Validation against the real backend, docs, handover

**Files:**
- Modify:
  - `docs/demo/roteiro.md`, "Antes de começar": after `npm run dev`, click "Usuário" on Bem-vindo (or open with `?sem-boot`); the Explorer opens in A:\
  - `CLAUDE.md`, "Estado atual": one line on `src/lib/windows.ts`, `components/desktop/` and `components/session/`

- [ ] **Step 1: Leave the user's servers alone.** Terminal tabs `c1` (backend on 8000, real `fat_disk.img`) and `c2` (front on 5174) were started for the video. They stay up and are not used for checks.
- [ ] **Step 2: Start the isolated pair** (CLAUDE.md, "Comandos"), on other ports because 5174 is taken:
  - **backend:** port 8001, with `FAT_DISK_PATH` on a scratch `.img`
  - **front:** `VITE_MOCK=0 VITE_API_URL=http://localhost:8001`, port 5175 with `--strictPort`
- [ ] **Step 3: Run the demo script on the isolated pair (Review Focus 4)**:
  - **logon:** log on, then do steps 1 to 9 of `docs/demo/roteiro.md`; the clusters and messages match the table exactly.
  - **missing disk:** delete the scratch `.img`, restart the backend and log on; the format dialog of tela 17 appears.
  - **windows:** repeat the Task 3 Delete check and the Task 5 zoom checks once on this pair.
- [ ] **Step 4: Run `npm run check`** → `69 passed`, `TUDO OK`, no `error TS`. Then `npm run build -w apps/web` → finishes with no error (the deploy is front-only).
- [ ] **Step 5: Cleanup**:
  - stop the isolated pair, and confirm ports 8001 and 5175 are free
  - `apps/api/fat_disk.img` still has its old `LastWriteTime`
  - `apps/web/.env.development` still reads `VITE_MOCK=1`
- [ ] **Step 6: Hand the user the git commands** (never run them), each in its own `powershell` block:
  - `git add apps/web docs/demo/roteiro.md docs/superpowers CLAUDE.md`
  - a `git commit` titled `feat: área de trabalho do XP`, with a body and the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer
  - `git push`
