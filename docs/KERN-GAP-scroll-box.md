# KERN-GAP: `<scroll-box>` and `<alternate-screen>` primitives

Status: **spec — unimplemented**
Consumer: Agon CLI (this repo) — blocked on these primitives for Claude-Code-grade transcript UX.
Reference source: Claude Code leak at `https://github.com/tanbiralam/claude-code/tree/main/src/ink` (their forked Ink).

## Why

Upstream Ink (5.x) ships `<Static>` (append-only, immutable, terminal-scrollback-backed) and `<Box>` (flex layout, no scroll). Neither supports the pattern needed by an interactive chat/agent CLI:
- Committed history rows that **can still re-render** on state change (e.g. `Ctrl+E` toggles tool-output expansion retroactively).
- Alt-screen lifecycle that survives signal exits and doesn't leak a pre-alt-screen frame.
- DOM-level scroll state so wheel/keys don't force React re-renders of 1000+ rows.

Claude Code solved this by **forking Ink** and adding:
- `dom.ts` fields: `scrollTop`, `scrollHeight`, `scrollViewportHeight`, `scrollViewportTop`, `pendingScrollDelta`, `stickyScroll`, `scrollAnchor`, `scrollClampMin/Max`, `altScreenActive`.
- Reconciler hooks to commit scroll state.
- A `log-update.ts` fork aware of alt-screen state (keeps cursor inside viewport, prevents cursor-restore LF from scrolling content).
- Two React components: `<AlternateScreen>` and `<ScrollBox>`.

KERN should provide these as first-class primitives so every KERN `target=ink` consumer gets the pattern without hand-rolling a React-level equivalent (like Agon's current `HistoryView`).

## Primitive 1 — `<alternate-screen>`

### KERN syntax (proposed)

```
alternate-screen mouse-tracking=true
  // children
```

Or as a block wrapper inside a `screen target=ink`:

```
screen name=App target=ink
  render
    handler <<<
      return (
        <alternate-screen mouseTracking>
          <Box flexDirection="column">...</Box>
        </alternate-screen>
      );
    >>>
```

### Semantics

On mount (via `useInsertionEffect`, NOT `useLayoutEffect` — see why below):
1. Write `ESC[?1049h ESC[2J ESC[H` + (optional) `ESC[?1000h ESC[?1002h ESC[?1006h`
2. Notify Ink instance via `setAltScreenActive(true, mouseTracking)`
3. Children render inside a `<Box height={terminalRows} width="100%" flexShrink={0}>`

On unmount:
1. Notify Ink instance `setAltScreenActive(false)`
2. Clear any active text selection
3. Write disable-mouse + `ESC[?1049l`

### Why `useInsertionEffect` (critical detail)

React-reconciler fires `resetAfterCommit` between mutation and layout commit phases. Ink's `resetAfterCommit` triggers `onRender`. If alt-screen enter runs in `useLayoutEffect`, the first `onRender` fires BEFORE the effect → Ink writes a full frame to the MAIN screen with `altScreenActive=false`. That frame is preserved when we then enter alt-screen and revealed on exit as a broken view.

`useInsertionEffect` fires during the mutation phase, BEFORE `resetAfterCommit`, so `ENTER_ALT_SCREEN` reaches the terminal before the first frame.

Cleanup timing is unchanged: both insertion and layout effect cleanup run in the mutation phase on unmount, before `resetAfterCommit`.

### Required Ink-level changes

- Add `setAltScreenActive(active: boolean, mouseTracking?: boolean)` on the Ink instance.
- Track `altScreenActive` in the renderer so `log-update` keeps the cursor inside the constrained viewport (otherwise the cursor-restore LF scrolls content).
- Signal-exit cleanup should call `setAltScreenActive(false)` + write `EXIT_ALT_SCREEN` even if the component's unmount doesn't run (prevents a stuck alt-screen buffer on Ctrl-C).
- SGR mouse tracking parser: wheel → `ParsedKey` events; click/drag → update Ink instance's selection state (exposed via `clearTextSelection()`).

## Primitive 2 — `<scroll-box>`

### KERN syntax (proposed)

```
scroll-box sticky-scroll=true flex-grow=1
  // children — all rendered at full Yoga-computed height
  // viewport culling happens at render time
```

### Semantics

A `<Box>` with `overflow: scroll` and an **imperative scroll API**.

Children are laid out at their **full Yoga-computed height** inside a constrained container. At render time, only children intersecting the visible window `(scrollTop..scrollTop+height)` are rendered → viewport culling. Content is translated by `-scrollTop` and clipped to the box bounds.

Props:
- `stickyScroll?: boolean` — when true, scroll auto-pins to the bottom when content grows. Cleared by manual `scrollTo`/`scrollBy`. Re-set by `scrollToBottom()`.
- `flexGrow`, `flexShrink`, etc. — standard Box layout props.
- Refs expose an imperative handle:
  - `scrollTo(y: number)`
  - `scrollBy(dy: number)`
  - `scrollToElement(el, offset?)` — defers position read to render time (deterministic vs stale)
  - `scrollToBottom()`
  - `getScrollTop() / getScrollHeight() / getFreshScrollHeight() / getViewportHeight() / getViewportTop()`
  - `isSticky()`
  - `subscribe(listener)` — imperative-scroll events (NOT sticky auto-follow)
  - `setClampBounds(min, max)` — for virtualized scroll ranges

### Why this is hard at the React level (and why we need it at the Ink level)

Hand-rolling at React level (Agon's current `HistoryView`) has three costs:
1. **Every state change re-renders the slice.** Keystroke in composer → re-computes `visibleRows`, rebuilds React tree, logUpdate rewrites all visible rows. 1000-row session = laggy.
2. **Wheel events = React state changes.** Can't coalesce cheaply.
3. **`stickyScroll` has to be computed from state.** Race-prone during rapid content growth.

Claude Code's fix:
- `scrollTop`/`pendingScrollDelta` live on the DOM node, not React state.
- Wheel handler mutates DOM + marks dirty + queues a microtask render. No React re-render.
- `stickyScroll` is a renderer-level attribute the renderer reads during `onRender`, not React state.
- Viewport culling happens inside the render pass — children outside `[scrollTop, scrollTop+height]` are skipped at the node-to-output step.

### Required Ink-level changes

- `dom.ts`: add `scrollTop`, `scrollHeight`, `scrollViewportHeight`, `scrollViewportTop`, `pendingScrollDelta`, `stickyScroll`, `scrollAnchor`, `scrollClampMin`, `scrollClampMax` fields to DOM nodes.
- Reconciler: commit scroll state from props on each update.
- Renderer (node-to-output): when a node has `overflow: scroll`, compute visible window, emit only intersecting children, translate by `-scrollTop`, clip to box bounds. Drain `pendingScrollDelta` at a capped rate (Claude Code uses rate-limited drain for smooth fast flicks).
- Sticky follow: when `stickyScroll=true` and content grew past prev `scrollTop+height`, update `scrollTop` to new `scrollHeight - height` during render.
- `markDirty` + `scheduleRenderFrom` path for wheel events that bypass React.

## Agon-specific consumer plan (what we'd migrate)

After the primitives land in KERN, Agon replaces:

- `createInkStdoutProxy` (with its `stdout.rows = 10000` hack + ESC[3J filter) → `<alternate-screen>` wrapping the app root.
- `terminalEnterSequence` / `terminalExitSequence` functions → deleted (primitive owns this).
- `HistoryView` + `visibleWindow` memo + `currentVisibleRowBudget` memo + `scrollOffset` state + wheel handler + scroll keybindings → replaced by:
  ```
  scroll-box sticky-scroll flex-grow=1
    {outputBlocks.map((b) => <OutputBlockView event={b.event} toolOutputExpanded=... />)}
  ```

Result:
- Ctrl+E re-renders all tool blocks (they're real React children, ScrollBox re-renders naturally).
- Single scroll control (the ScrollBox).
- Native mouse wheel support (mouseTracking on AlternateScreen).
- No double scrollbar (terminal's main buffer is hidden by alt-screen; the only visible scroll is the ScrollBox's).
- Performance scales: only visible rows emit Yoga+stdout on each frame.

## Testing criteria

1. Mount an `<alternate-screen>` at startup — first paint lands at top of alt-screen buffer, not mid-viewport.
2. Ctrl-C during render exits alt-screen cleanly (no stuck buffer on shell).
3. `<scroll-box sticky-scroll>` with 10,000 children: initial render only lays out visible ~40 children per Yoga metrics. Scroll via `scrollToBottom()` renders the last 40.
4. Wheel events (SGR mouse) mutate scrollTop without triggering React re-render (verify via devtools render count).
5. `stickyScroll` auto-follows content growth unless user manually scrolled up.
6. Ctrl+E tool-expand toggling re-renders past tool blocks (ScrollBox re-renders its children via React; old `scrollTop` preserved).
7. Resize: on terminal resize, `scrollTop` clamps to new max, `stickyScroll` preserved.

## Non-goals for v1

- Horizontal scroll (`overflow-x`).
- Scrollbar visual (terminal's default is fine for v1; can be a separate `show-scrollbar` prop later).
- Scroll-to-element animation (snap is enough).

## Reference implementation files in the leak

- `src/ink/components/AlternateScreen.tsx`
- `src/ink/components/ScrollBox.tsx`
- `src/ink/dom.ts` (for the extended fields — search `scrollTop`, `stickyScroll`)
- `src/ink/reconciler.ts` (scroll commit hooks)
- `src/ink/log-update.ts` (alt-screen-aware cursor handling)
- `src/ink/components/App.tsx` (wiring)

## Tracking

Once KERN 3.x ships these primitives:
1. Bump Agon's `@kernlang/cli` pin.
2. Replace `HistoryView` call sites in `packages/cli/src/kern/surfaces/app.kern` with `<scroll-box>`.
3. Replace `createInkStdoutProxy` + `terminalEnterSequence` wiring with `<alternate-screen>`.
4. Delete `scrollOffset` state, `wheelDeltaRef`, `currentVisibleRowBudget`, `maxScrollOffset`, `visibleWindow`, `historyViewportTop`, `historyNeedsViewportFill` memos.
5. Remove `// Scroll keys intentionally unbound` block from `keyboard.kern` and wire scroll keys to `scroll-box`'s imperative API via a ref (if desired at all — most users scroll via wheel).
