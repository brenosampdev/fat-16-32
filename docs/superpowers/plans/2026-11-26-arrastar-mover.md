# Arrastar para mover — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move files and folders by holding the left button on list rows and dropping them on a folder of the list or the tree, through the same `POST /file/move` the paste uses.

**Architecture:** A pure rule (`src/lib/dragMove.ts`) decides whether a folder accepts the dragged paths. A hook (`src/hooks/useDragMove.ts`) owns the mouse tracking, the 4 px threshold, the ghost (a React portal on `<body>`, outside the window zoom), the cursor, the target highlight and Esc; on release it hands `(paths, target)` to the Explorer, which reuses `moveAll`. Rows and tree nodes only mark themselves as targets with `data-drop-path`.

**Tech Stack:** React 18, TypeScript 5.7, Vite 6, TanStack Query v5, xp.css 0.2.6. Tests: `apps/web/smoke.ts` run by `tsx` (assertions via `ok(cond, msg)`), plus checks in the browser pane.

**Spec:** `docs/superpowers/specs/2026-11-26-arrastar-mover-design.md` (approved). Read it before any task.

## Global Constraints

- Never edit anything under `apps/api/`. No new npm dependencies (`react-dom`'s `createPortal` is already there).
- Never run git. The user commits; the controller hands over the commands.
- Identifiers and comments in English; every UI string in pt-BR, exactly as written in this plan.
- No `fetch` in components: moves go through `useMove` via the Explorer's `moveAll`.
- Errors show the backend `detail` as it came, in the existing failure dialog; never infer a cause from the message text.
- Names are case-sensitive: never `toLowerCase()` when comparing paths.
- Must work in mock mode and against the real backend. Browser checks only on http://localhost:5173 (mock) and on the isolated pair 8001/5175 (`FAT_DISK_PATH` on a scratch file). Never 5174 or 8000: they are the user's real disk.
- Target browsers: Chrome/Edge and Firefox ≥ 126.
- Values: drag threshold **4 px** of screen; drop-target highlight `#316AC5` with white text (the focused selection colour of the list); ghost opacity **0.7**, top-left **8 px** right of and below the pointer.
- `npm run check` (from the repo root) must pass at the end of every task.

## Review Focus

1. **Multi-selection survives the press**: with three files selected, pressing on one of them and dragging carries all three; pressing and releasing without moving leaves only that one selected. (Task 1, browser check.)
2. **Clicks stay clicks**: a click, a double-click (open) and the slow click that renames behave exactly as before; a press that moves less than 4 px never moves anything; after a real drag no rename starts. (Task 1, browser check.)
3. **Zoom**: at 200 % and 75 % the ghost sits at the pointer and the highlighted folder is the one under the pointer. (Task 1, browser check.)
4. **Backend refusals**: a name that already exists in the destination, and a full FAT16 root, show the backend `detail` as it came; what moved before the error stays moved and both folders show fresh listings; the mock gives the same text. (Task 3.)
5. **Abandoned drags**: Esc mid-drag, releasing outside any folder, releasing over another window, or the browser losing focus mid-drag: nothing moves, the ghost is gone, the cursor and highlight reset, and the next click works normally. (Task 1, browser check.)

---

### Task 1: Drag rows onto folders

**Files:**
- Create: `apps/web/src/lib/dragMove.ts`
- Create: `apps/web/src/hooks/useDragMove.ts`
- Create: `apps/web/src/components/explorer/DragGhost.tsx`
- Modify: `apps/web/src/components/explorer/FileList.tsx`
- Modify: `apps/web/src/components/explorer/TreeItem.tsx`, `apps/web/src/components/explorer/FolderTree.tsx`
- Modify: `apps/web/src/components/explorer/Explorer.tsx`
- Modify: `apps/web/src/components/desktop/TooltipLayer.tsx`
- Modify: `apps/web/src/styles/app.css`
- Test: `apps/web/smoke.ts` (new section 26, before the final `console.log`)

**Interfaces:**
- Consumes: `isAncestor(ancestral, descendente)` and `basename` from `src/api`; the Explorer's `moveAll(from, target, onMoved?)`, `fail(e, retry?)`, `setBusy`, `canEdit`, `renaming`, `clipboard`/`setClipboard`, `selection`.
- Produces:
  - `canDrop(paths: readonly string[], target: string, current: string): boolean`
  - `dragLabel(names: readonly string[]): string`
  - `type DragItem = { path: string; name: string; isDir: boolean }`
  - `useDragMove(opts: { enabled: boolean; current: string; onDrop: (paths: string[], target: string) => void }): { begin: (e: React.MouseEvent, items: DragItem[]) => void; ghost: ReactNode }`
  - `FileList` prop `onDragBegin?: (e: MouseEvent, items: DragItem[]) => void`; `TreeItem` prop `dropPath?: string`

- [ ] **Step 1: Write the failing tests** (smoke §26, import `canDrop`, `dragLabel` from `./src/lib/dragMove`)

```ts
  console.log('\n26. Arrastar para mover')
  ok(canDrop(['/a.txt'], '/docs', '/'), 'arquivo vai para uma pasta')
  ok(!canDrop(['/a.txt'], '/', '/'), 'a pasta mostrada nao recebe')
  ok(!canDrop(['/docs'], '/docs', '/'), 'pasta nao vai para si mesma')
  ok(!canDrop(['/docs'], '/docs/sub', '/'), 'pasta nao vai para dentro de si')
  ok(canDrop(['/docs2'], '/docs', '/') && canDrop(['/docs'], '/docs2', '/'), 'prefixo de nome nao e ancestral')
  ok(canDrop(['/Docs'], '/docs', '/'), 'nomes diferem por maiuscula')
  ok(canDrop(['/docs/a.txt', '/docs/b.txt'], '/', '/docs'), 'varios vao para a raiz pela arvore')
  ok(!canDrop(['/docs/a.txt', '/docs/sub'], '/docs/sub/x', '/docs'), 'um item invalido barra o grupo')
  ok(!canDrop([], '/docs', '/'), 'nada arrastado, nada aceito')
  ok(dragLabel(['a.txt']) === 'a.txt' && dragLabel(['a.txt', 'b']) === '2 itens', 'rotulo do fantasma')
```

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/web && npx tsx smoke.ts`
Expected: fails to import `./src/lib/dragMove`.

- [ ] **Step 3: Implement `canDrop` and `dragLabel` in `src/lib/dragMove.ts`**

`canDrop` is false for an empty list, for `target === current`, and when any path `p` has `isAncestor(p, target)`; true otherwise. `dragLabel` gives the single name, or `` `${n} itens` ``.

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && npx tsx smoke.ts`
Expected: section 26 all `ok`, `TUDO OK`.

- [ ] **Step 5: Implement `useDragMove` and `DragGhost`**

- `begin` records the press point and the items; window `mousemove`/`mouseup` listeners do the rest. Nothing happens until the pointer has moved `DRAG_THRESHOLD = 4` px (screen) from the press with the left button held.
- When the drag starts: `document.body` gets `drag-moving` (default cursor, no text selection, any page selection cleared); the ghost appears (icon `folder` or `file` of the first item, label `dragLabel(names)`), rendered through `createPortal` into `document.body` with its content set once, and its position updated through a ref on each move, not through React state.
- Target: `document.elementFromPoint(x, y)?.closest('[data-drop-path]')`. When `canDrop(paths, target, current)` holds, that element gets the class `drop-target` (removed from the previous one) and the body loses `drag-no-drop`; otherwise no element is highlighted and the body gets `drag-no-drop`.
- `mouseup` over a valid target calls `onDrop(paths, target)`. Any other ending moves nothing: `mouseup` elsewhere, `Escape` (capture phase; the key reaches no other handler), the window `blur`, `enabled` turning false, or the component unmounting.
- After a drag that started, the `click` produced by the same `mouseup` is swallowed in the capture phase. Remove that listener on the next tick.
- Every ending removes the ghost, both body classes, the `drop-target` class and the listeners.

- [ ] **Step 6: Wire the list**

- Folder rows carry `data-drop-path={path}`.
- A plain left press (no Ctrl/Meta/Shift) on a row that is not being renamed calls `onDragBegin(e, items)`. `items` are all selected rows in list order when the pressed row is selected, else only the pressed row.
- A plain press on a selected row while more than one row is selected no longer calls `onPick` at mousedown. The row's `click` (which a drag swallows) does `onPick(path)` instead. Every other press keeps today's behaviour.

- [ ] **Step 7: Wire the tree**

`TreeItem` puts `data-drop-path={dropPath}` on `.tree-row` when given. `FolderNode` passes its `path`, root included. The placeholder nodes shown while loading or with no disk pass nothing.

- [ ] **Step 8: Wire the Explorer**

- Call `useDragMove({ enabled: canEdit && !renaming, current, onDrop })` and render its `ghost`.
- `onDrop` behaves like `paste`:
  - It runs `setBusy(true)`, then `moveAll(paths, target, onMoved)` that tracks what is still pending.
  - On success it clears the selection.
  - On error it calls `fail(e, () => void onDrop([...pending], target))`.
  - Finally it removes every moved path from the clipboard (the clipboard becomes `null` when empty) and runs `setBusy(false)`.
- Pass `onDragBegin={drag.begin}` to `FileList`.

- [ ] **Step 9: Styles and tooltips**

- In `app.css`:
  - `.filelist tr.drop-target .name-text` and `.tree-row.drop-target .tree-text`: background `#316AC5`, white text.
  - `.drag-ghost`: `position: fixed`, `pointer-events: none`, opacity 0.7, Tahoma 11px, icon and label in one line, z-index `2147483646` (the minimize ghost's).
  - `body.drag-moving`: `cursor: default !important` and `user-select: none` on everything.
  - `body.drag-no-drop`: `cursor: no-drop !important` on everything.
- `TooltipLayer` shows no tip while `document.body` has `drag-moving`.

- [ ] **Step 10: Run the full check**

Run: `npm run check` (repo root)
Expected: 69 passed, `TUDO OK`, no `error TS`.

- [ ] **Step 11: Browser checks on http://localhost:5173/?sem-boot (mock)**

- A file dragged onto a folder row leaves the list and appears inside the folder. A folder dragged onto a tree node moves the same way. Two selected files dragged onto `A:\` from a subfolder both move.
- Review Focus 1, 2, 3 and 5, each as written above.
- Hovering the dragged folder itself, its own subfolder in the tree, or the current folder shows `no-drop` with no highlight.
- With a file cut (Ctrl+X) and then dragged elsewhere, Ctrl+V does nothing and shows no error.
- Reset the viewport and the zoom (Ctrl+0) at the end.

- [ ] **Step 12: Commit**

None (no-git rule). The controller hands the user the commands at the end.

---

### Task 2: A failed rename is never cleared in silence

**Files:**
- Modify: `apps/web/src/components/explorer/Explorer.tsx` (the leave-folder cancel next to `setRenaming`, and `commitRename`)

**Interfaces:**
- Consumes: `fail`, `setFailure`, `renamingRef`, `commitRename` as they are.
- Produces: nothing new.

Today, `if (renaming && renaming.dir !== current && !renaming.busy) setRenaming(null)` cancels a rename when the folder changes. That includes a rename whose last answer was an error: the client validation balloon, or a backend refusal that arrived after Acima/Voltar. The error is then never seen, and the typed name is lost without notice.

- [ ] **Step 1: Implement**

- When the folder changes and the rename being dropped carries an `error`, the failure dialog opens with title `Erro` and that error text as it was.
- When a rename that was in flight fails after its folder has stopped being the current one, the failure dialog opens with the backend detail through `fail(e)`, and no rename field is left behind.
- A rename without an error still cancels quietly, as today.
- Do not set state of another component during render: move the cancel into an effect if it needs to open the dialog.

- [ ] **Step 2: Run the full check**

Run: `npm run check`
Expected: green, as in Task 1.

- [ ] **Step 3: Browser checks on http://localhost:5173/?sem-boot (mock)**

- F2 on a file, type `a/b`, then click Acima. The dialog "Erro" reads `Um nome não pode conter o caractere /.` and the file keeps its name.
- F2 on a file, type the name of a file next to it, then click Acima. The dialog shows the mock's detail as it came, and both files keep their names.
- F2, type a free name, then click Acima. The rename is committed and no dialog appears.

- [ ] **Step 4: Commit**

None (no-git rule).

---

### Task 3: Validation against the real backend, docs

**Files:**
- Modify: `CLAUDE.md` ("Estado atual")
- Modify: `docs/build-frontend.md` (the paragraph "Drag-and-drop entre pastas…", near line 886)

**Interfaces:** none.

- [ ] **Step 1: Record the baseline**

Record the mtime and size of `apps/api/fat_disk.img`, the PIDs on 8000/5173/5174, and that 8001/5175 are free.

- [ ] **Step 2: Start the isolated pair**

Use the two commands in `CLAUDE.md` with `FAT_DISK_PATH` on a scratch file in your workspace, ports 8001/5175. Confirm that the first format creates the scratch file and leaves `fat_disk.img` untouched.

- [ ] **Step 3: Run the checks on http://localhost:5175/?sem-boot**

1. Format FAT16, 512 B, 256 clusters.
2. Create folders `DOCS` and `OUTRA` and two small files in `A:\`.
3. Drag one file onto `DOCS` in the list, drag `OUTRA` onto `DOCS` in the tree, then drag both remaining files at once onto `DOCS`. Each time, compare the listing with `GET /ls` on 8001.
4. Name conflict: put a file with the same name in `DOCS`, then drag the root one onto it. The dialog shows `'<nome>' já existe no destino '/DOCS'.` as it came, and nothing moves.
5. FAT16 root full: fill the root to its 64 entries through the API on 8001 (read `apps/api/api.py` for the create endpoint), then drag a file from `DOCS` onto `A:\`. The dialog shows `Destino cheio (limite FAT16).`
6. Repeat 4 and 5 on 5173 (mock). The text must match. Any difference is a mock bug: report it, do not work around it.

- [ ] **Step 4: Clean up**

Stop only the processes you started. Delete the scratch disk. Confirm that the baseline from Step 1 is unchanged.

- [ ] **Step 5: Docs**

- `CLAUDE.md`, "Estado atual", new bullet after the desktop one: "- Arrastar para mover: regra do destino em `src/lib/dragMove.ts`, ponteiro e fantasma em `src/hooks/useDragMove.ts`". In the `smoke.ts` line, change the desktop range to cover section 26.
- `docs/build-frontend.md`: replace the "Drag-and-drop entre pastas…" paragraph with: "Arrastar para mover está feito (`docs/superpowers/specs/2026-11-26-arrastar-mover-design.md`): arquivos e pastas da lista vão para uma pasta da lista ou da árvore, pelo mesmo `POST /file/move` do Colar."

- [ ] **Step 6: Run the full check**

Run: `npm run check`
Expected: green.

- [ ] **Step 7: Commit**

None (no-git rule). The controller hands the user the git commands.
