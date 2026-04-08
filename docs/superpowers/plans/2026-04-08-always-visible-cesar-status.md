# Always-Visible Cesar Status + Tab Plan Mode Toggle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cesar's activity/confidence always visible (no toggle), then repurpose Tab for plan mode toggle.

**Architecture:** Convert the BTW panel from a toggled overlay into a permanent status strip. Show confidence, current activity, engine status, and last action at all times. Tab becomes the plan mode toggle instead of BTW toggle.

**Tech Stack:** KERN lang, Ink/React components

---

### Task 1: Convert BTW Panel to Always-Visible Cesar Status Strip

**Files:**
- Modify: `packages/cli/src/kern/ui-app.kern` (lines ~688-710, remove btwExpanded toggle, always render)
- Modify: `packages/cli/src/kern/ui-status.kern` (or `components.js` — wherever BtwPanel is defined)

- [ ] **Step 1: Read current BtwPanel implementation**

Read `packages/cli/src/kern/ui-status.kern` and find the BtwPanel component. Understand what it currently shows:
- Engine progress (spinning/done status per engine)
- Active spinner info
- Background jobs
- Last activity timestamp
- Stream snippet (last line of Cesar's output)

- [ ] **Step 2: Create CesarStatusStrip component**

Replace BtwPanel with a compact, always-visible strip. Design:

```
◆ cesar 89% │ thinking… 12s │ ◆claude: building ◆codex: done │ last: "checking auth patterns…"
```

Fields:
- **Confidence badge**: `◆ cesar XX%` with color based on tier (green 93%+, yellow 72-92%, red <72%)
- **Activity**: current action (thinking, brainstorming, forging, idle)
- **Engine status**: per-engine dots when multi-engine ops running
- **Last snippet**: last meaningful line from Cesar's output (truncated)
- **Plan indicator**: when plan mode active, show `◈ PLAN` badge

The strip should be:
- 1 line tall (not a panel)
- Always visible above the status bar (or replace it)
- Dimmed when idle, bright when active
- Uses existing `liveSpinner`, `liveProgress`, `streamingText` state

- [ ] **Step 3: Remove btwExpanded toggle from input handler**

In `ui-app.kern`, the Tab handler (line ~469-472) currently toggles `btwExpanded`:
```javascript
if (replState !== 'idle') { setBtwExpanded((prev: boolean) => !prev); return; }
```

Remove this — BTW is always visible now. Tab during idle stays as ghost completion.

- [ ] **Step 4: Show CesarStatusStrip always**

In `ui-app.kern`, replace the conditional BTW render (line ~707):
```javascript
{btwExpanded && <BtwPanel ... />}
```
With always-visible:
```javascript
{replState !== 'idle' && <CesarStatusStrip ... />}
```

Or always show but dim when idle.

- [ ] **Step 5: Track Cesar's last confidence**

Add state to ui-app.kern:
```kern
state name=cesarConfidence type=number initial=0
```

Update when Cesar reports confidence — find where confidence is parsed in `handlers-cesar-brain.kern` and dispatch an event that updates this state. Use the existing `response-meta` output event or add a `confidence-update` event.

- [ ] **Step 6: Compile, build, test**

```bash
npx kern compile packages/cli/src/kern/ui-app.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/ui-status.kern --outdir=packages/cli/src/generated
npm run build
npm run test
```

- [ ] **Step 7: Commit**

```bash
git add -u packages/
git commit -m "feat(ui): always-visible Cesar status strip replacing BTW toggle"
```

---

### Task 2: Repurpose Tab for Plan Mode Toggle

**Files:**
- Modify: `packages/cli/src/kern/ui-app.kern` (input handler, Tab keybinding)
- Modify: `packages/cli/src/kern/app-dispatch.kern` (handle plan toggle from Tab)

- [ ] **Step 1: Change Tab behavior when not idle**

In the input handler, Tab currently toggles BTW when `replState !== 'idle'`. Change it:

When input is empty and `replState === 'idle'`:
- Tab with ghost text → complete ghost (existing behavior)
- Tab without ghost text → toggle plan mode

```javascript
      if ((key.tab || input === '\t') && !slashPickerOpen && !enginePickerOpen && !questionState && !reviewEvent) {
        // Ghost completion first
        const ghost = getGhostCompletion(inputValue, allSlashCommands, registry.availableIds());
        if (ghost) { setInputValue(inputValue + ghost + ' '); setInputKey((k: number) => k + 1); return; }
        // No ghost → toggle plan mode
        if (replState === 'idle' && !inputValue.trim()) {
          if (activePlan && ['planning', 'awaiting_approval', 'running', 'paused'].includes(activePlan.state)) {
            // Exit plan mode
            const { cancelCesarPlan } = await import('@agon/core');
            setActivePlan(cancelCesarPlan(activePlan));
            dispatch({ type: 'info', message: 'Plan mode off' } as any);
          } else {
            // Enter plan mode — prompt user for task
            dispatch({ type: 'info', message: 'Plan mode on — type your task and press Enter' } as any);
            // Set a flag so next submit enters plan mode
            (ctx as any)._planModeQueued = true;
          }
          return;
        }
      }
```

Actually, simpler: Tab toggles a `planModeQueued` flag. When the user types and submits, if `planModeQueued` is true, route as `/plan <task>` instead of normal chat. This keeps it clean — Tab flips the mode indicator, Enter submits the task into plan mode.

- [ ] **Step 2: Add planModeQueued state**

```kern
state name=planModeQueued type=boolean initial=false
```

- [ ] **Step 3: Update submit handler**

In `handleSubmit`, if `planModeQueued` and input has text:
```javascript
      if (planModeQueued && input.trim() && !input.startsWith('/')) {
        setPlanModeQueued(false);
        handleSubmit(`/plan ${input}`);
        return;
      }
```

- [ ] **Step 4: Update input area to show plan mode queued indicator**

When `planModeQueued` is true, show the `◈ PLAN` badge and change prompt color to purple, even before the task is submitted. This gives immediate visual feedback when Tab is pressed.

- [ ] **Step 5: Compile, build, test**

```bash
npx kern compile packages/cli/src/kern/ui-app.kern --outdir=packages/cli/src/generated
npm run build
npm run test
```

- [ ] **Step 6: Commit**

```bash
git add -u packages/
git commit -m "feat(ui): Tab toggles plan mode, always-visible status shows Cesar confidence"
```

---

### Task 3: Confidence Event Pipeline

**Files:**
- Modify: `packages/cli/src/kern/handler-types.kern` (add confidence-update event)
- Modify: `packages/cli/src/kern/handlers-cesar-brain.kern` (dispatch confidence event)
- Modify: `packages/cli/src/kern/app-output.kern` (handle confidence-update)
- Modify: `packages/cli/src/kern/ui-app.kern` (update cesarConfidence state)

- [ ] **Step 1: Add confidence-update output event**

In `handler-types.kern`:
```kern
  variant name=confidence-update
    field name=value type=number
    field name=engineId type=string
```

- [ ] **Step 2: Dispatch confidence from cesar-brain**

In `handlers-cesar-brain.kern`, wherever `parsedConfidence` is set (after `parseConfidence` calls), dispatch:
```javascript
      dispatch({ type: 'confidence-update', value: parsedConfidence, engineId: cesarEngineId } as any);
```

- [ ] **Step 3: Handle in app-output and update UI state**

In `app-output.kern`:
```javascript
      case 'confidence-update':
        if (actions.setCesarConfidence) actions.setCesarConfidence(event.value);
        break;
```

Wire `setCesarConfidence` through `outputActions` in `ui-app.kern`.

- [ ] **Step 4: CesarStatusStrip reads cesarConfidence**

The strip component uses `cesarConfidence` state for the confidence badge display.

- [ ] **Step 5: Compile all, build, test, commit**

```bash
npx kern compile packages/cli/src/kern/handler-types.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/handlers-cesar-brain.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/app-output.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/ui-app.kern --outdir=packages/cli/src/generated
npm run build && npm run test
git add -u packages/
git commit -m "feat(ui): confidence event pipeline for always-visible Cesar status"
```

---

### Task 4: Polish and Integration

- [ ] **Step 1: Verify the full UX flow**

- Idle: strip shows `◆ cesar idle` dimmed
- Tab pressed: `◈ PLAN` badge appears, prompt turns purple
- User types task, presses Enter: plan mode activates, strip shows `◆ cesar 78% │ thinking…`
- Cesar brainstorms: strip shows engine activity `◆claude: drafting ◆codex: drafting`
- Plan proposed: strip shows `◈ PLAN review`
- Plan approved: strip shows `◈ PLAN executing… │ Step 2/3 │ $0.18`
- Plan done: strip fades, `◈ PLAN` disappears

- [ ] **Step 2: Full test suite**

```bash
npm run test
npm run typecheck
```

- [ ] **Step 3: Commit and push**
