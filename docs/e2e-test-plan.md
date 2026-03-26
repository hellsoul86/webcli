# E2E Test Plan — WebCLI

## Current Coverage

### workbench.spec.ts (11 tests)
1. Workspace create → thread open → send message → approval replay after reload
2. Settings defaults update + command palette file search
3. Markdown + media rendering in timeline
4. Streaming delta incremental display
5. Raw response items + terminal interactions
6. Decision center: typed request-user-input
7. Realtime transcript + audio panel
8. Code preview modal (relative path)
9. Code preview modal (absolute /srv path)
10. Monaco dispose error regression
11. Outside-home derived workspace grouping + dismiss

### wave1-parity.spec.ts (4 tests)
1. Thread + decision flows
2. File preview flows
3. Review + remote diff
4. Settings + integration capabilities

---

## Missing Coverage — Test Plan

### P0: Session Architecture (New)

**test: session lifecycle via REST API**
- `POST /api/sessions` → creates session, returns sessionId + status "idle"
- `GET /api/sessions` → lists sessions including the new one
- `GET /api/sessions/:id` → returns session details
- `DELETE /api/sessions/:id` → removes session, 204
- `DELETE /api/sessions/nonexistent` → 404
- Platform: Both

**test: per-session WebSocket connects and receives events**
- Create session via API
- Connect WebSocket to `/ws/sessions/:id`
- Verify receives `runtime.statusChanged` notification
- Send `thread.list` RPC → receives response with items
- Platform: Both

**test: session persists across page reload**
- Load page → session created in localStorage
- Reload page → same session reused (no duplicate create)
- Platform: Both

### P0: Mobile Layout

**test: mobile shows hamburger menu and hides sidebar**
- Set viewport 375x812
- Page loads → sidebar hidden, conversation area visible
- ☰ button visible in header
- Platform: Mobile only

**test: mobile drawer opens on hamburger click**
- Click ☰ → sidebar drawer slides in from left
- Overlay backdrop visible behind drawer
- Thread list displayed in drawer
- Platform: Mobile only

**test: mobile drawer closes on overlay click**
- Open drawer → click overlay backdrop
- Drawer closes, conversation area visible again
- Platform: Mobile only

**test: mobile drawer closes on thread select**
- Open drawer → click a thread
- Drawer closes automatically
- Thread content loads in conversation area
- Platform: Mobile only

**test: mobile composer toolbar shows model selectors**
- Verify model selector visible above input (not hidden)
- Verify reasoning effort selector visible
- Verify approval policy selector visible
- Platform: Mobile only

**test: mobile composer sticks to bottom**
- Scroll conversation up
- Composer textarea stays at bottom of viewport
- Platform: Mobile only

**test: desktop layout unaffected by mobile code**
- Set viewport 1280x800
- Sidebar always visible (no ☰ button)
- Sidebar + content side by side
- Resizer handle visible and functional
- Platform: Desktop only

### P1: Conversation Core

**test: create new thread from sidebar**
- Click "+" compose button next to workspace
- New thread created, composer focused
- Conversation area shows ready state
- Platform: Both

**test: switch between threads preserves state**
- Open thread A, send message
- Switch to thread B
- Switch back to thread A → previous messages visible
- Platform: Both

**test: send message and receive streaming response**
- Type prompt, click send
- User message appears in timeline
- Streaming response appears incrementally (partial text visible before complete)
- Platform: Both

**test: interrupt active turn**
- Send prompt that triggers long response
- Click interrupt button while streaming
- Response stops, turn marked as interrupted
- Platform: Both

**test: load older messages**
- Open thread with many messages
- Click "Load older" button
- Older messages prepend above current ones
- Scroll position maintained
- Platform: Both

### P1: Composer Controls

**test: change model selection**
- Click model dropdown in composer toolbar
- Select different model
- Verify selection persists
- Platform: Both

**test: change reasoning effort**
- Click reasoning dropdown
- Select different level
- Verify change applied
- Platform: Both

**test: change approval policy**
- Click approval policy dropdown
- Switch between on-request/never/etc
- Platform: Both

**test: toggle speed mode**
- Click speed toggle switch in header
- Verify mode changes between Standard/Fast
- Platform: Both

**test: switch language**
- Click globe icon
- Select zh-CN or en-US
- Verify UI labels change
- Platform: Both

### P1: Git Workbench

**test: view git status in composer**
- Open thread in git workspace
- File count, additions, deletions visible in composer bar
- Current branch displayed
- Platform: Desktop (mobile hides git tree)

**test: open git review panel**
- Click "Review" button
- Git review panel expands
- File tree visible with changed files grouped by status
- Platform: Desktop

**test: select file and view diff**
- Click file in git tree
- Diff viewer shows inline diff or patch
- File path displayed above diff
- Platform: Desktop

**test: switch git branch**
- Click branch dropdown
- Select different branch
- Git status refreshes
- Platform: Desktop

**test: close git review panel**
- Click back/close button in git panel
- Returns to normal conversation view
- Platform: Desktop

### P1: Decision Center

**test: command execution approval shows and resolves**
- Trigger command approval (via fake runtime)
- Approval card appears in decision center
- Click "Accept" → approval resolves
- Platform: Both

**test: file change approval**
- Trigger file change approval
- Shows reason and affected files
- Accept/Decline works
- Platform: Both

**test: user input request form**
- Trigger input request
- Form fields rendered (text, select, password)
- Submit answers → resolves request
- Platform: Both

**test: decline approval**
- Trigger any approval
- Click "Decline" → approval resolves with decline
- Platform: Both

### P1: Workspace Management

**test: create workspace with name and path**
- Click create workspace button
- Fill name and path in modal
- Submit → workspace appears in sidebar
- Platform: Both

**test: edit workspace settings**
- Click gear icon on workspace
- Change name or default model
- Save → changes reflected
- Platform: Both

**test: delete workspace**
- Open edit modal
- Click delete
- Workspace removed from sidebar
- Platform: Both

### P2: Thread Management

**test: rename thread**
- Click thread menu → Rename (or click edit icon in header)
- Type new name
- Press Enter → name updated in sidebar and header
- Platform: Both

**test: fork thread**
- Click thread menu → Fork
- New thread created as copy
- Platform: Both

**test: archive and unarchive thread**
- Click thread menu → Archive
- Thread disappears from active list
- Go to settings → History → thread visible in archived list
- Click Restore → thread back in active list
- Platform: Both

### P2: Settings

**test: open settings overlay**
- Click gear icon
- Settings panel opens with tabs
- Platform: Both

**test: navigate settings tabs**
- Click each tab: Account, General, Defaults, Integrations, Extensions, History
- Tab content changes appropriately
- Platform: Both

**test: view account info**
- Account tab shows authentication status
- Email and plan type displayed if authenticated
- Platform: Both

### P2: Error Handling

**test: error toast auto-dismisses**
- Trigger an error (e.g., thread.read on invalid thread)
- Error toast appears
- After 5 seconds, toast automatically disappears
- Platform: Both

**test: WebSocket reconnects on disconnect**
- Connect successfully
- Simulate disconnect (server restart or network drop)
- Client reconnects automatically with backoff
- Platform: Both

### P2: Code & Image Preview

**test: code link opens preview dialog**
- Click code reference link in conversation
- Code preview modal opens with syntax highlighting
- Modal dismisses on close
- Platform: Both

**test: image click opens preview modal**
- Click image in conversation
- Full-size image preview opens
- Modal dismisses on close
- Platform: Both

### P3: Realtime Sessions

**test: realtime session panel displays**
- Trigger realtime session start
- Panel appears with status indicator
- Transcript items populate
- Platform: Both

**test: realtime audio playback**
- Trigger realtime with audio chunks
- Audio player appears with controls
- Platform: Both

### P3: Plugins & Extensions

**test: list and install plugin**
- Open settings → Extensions
- Plugin marketplace listed
- Click install → plugin installed
- Platform: Desktop

### P3: External Config Migration

**test: detect and import external agent config**
- Open settings → Integrations
- Click detect → finds existing configs
- Select and import → migration completes
- Platform: Desktop

---

## Execution Matrix

| Category | Tests | Desktop | Mobile |
|----------|-------|---------|--------|
| Session Architecture | 3 | ✓ | ✓ |
| Mobile Layout | 7 | - | ✓ |
| Conversation Core | 5 | ✓ | ✓ |
| Composer Controls | 5 | ✓ | ✓ |
| Git Workbench | 5 | ✓ | - |
| Decision Center | 4 | ✓ | ✓ |
| Workspace Mgmt | 3 | ✓ | ✓ |
| Thread Mgmt | 3 | ✓ | ✓ |
| Settings | 3 | ✓ | ✓ |
| Error Handling | 2 | ✓ | ✓ |
| Code/Image Preview | 2 | ✓ | ✓ |
| Realtime | 2 | ✓ | ✓ |
| Plugins | 1 | ✓ | - |
| Config Migration | 1 | ✓ | - |
| **Total** | **46** | **42** | **27** |
