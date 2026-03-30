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

### session-architecture.spec.ts (6 tests)
1. Session CRUD lifecycle via REST API (create, list, get, delete)
2. DELETE nonexistent session returns 404
3. Per-session WebSocket connects and receives runtime.statusChanged + thread.list RPC
4. WebSocket to nonexistent session closes with code 4004
5. Session persists across page reload
6. Multiple sessions can coexist independently

### mobile.spec.ts (9 tests)
1. Hides sidebar and shows hamburger menu on mobile
2. Opens sidebar drawer on hamburger click
3. Closes drawer on overlay click
4. Closes drawer on thread select
5. Composer toolbar shows model selectors on mobile
6. Sends message and sees response on mobile
7. Composer sticks to bottom when scrolling
8. Decision center works on mobile
9. Desktop shows persistent sidebar without hamburger (desktop layout block)

### conversation.spec.ts (5 tests)
1. Creates new thread from sidebar
2. Switches between threads preserves messages
3. Sends message and receives streaming response
4. Shows plan card with steps
5. Thread title shows in header

### composer-controls.spec.ts (5 tests)
1. Model selector is visible and opens dropdown
2. Toggles thinking mode
3. Changes approval policy
4. Toggles speed mode
5. Switches language locale

### workspace-thread.spec.ts (6 tests)
1. Creates workspace with name and path
2. Edits workspace settings
3. Renames thread from header
4. Archives and restores thread
5. Forks thread from context menu
6. Selects 'all workspaces' view

### settings-errors.spec.ts (7 tests)
1. Opens settings overlay and navigates tabs
2. Settings account tab shows auth info
3. Settings defaults tab persists model config
4. Settings integrations tab shows MCP servers
5. Settings extensions tab shows skills and plugins
6. Settings history tab shows archived threads
7. No console errors during normal interaction

### git-workbench.spec.ts (5 tests)
1. Shows git status in composer bar
2. Opens review panel with grouped file tree
3. Selects file and shows diff viewer
4. Branch selector shows current branch and opens menu
5. Closes review panel and returns to conversation

---

## Missing Coverage — Test Plan

### ~~P0: Session Architecture~~ ✅ Covered in session-architecture.spec.ts

~~All 3 tests implemented + 3 additional (404, WebSocket 4004, multi-session).~~

### ~~P0: Mobile Layout~~ ✅ Covered in mobile.spec.ts

~~All 7 tests implemented (hamburger, drawer open/close/thread-select, composer toolbar, sticky bottom, desktop layout).~~

### ~~P1: Conversation Core~~ ✅ Covered in conversation.spec.ts

~~5 tests: new thread, switch threads, streaming response, plan card, thread title.~~

### P1: Conversation Core (remaining)
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

| Category | Planned | Implemented | Status |
|----------|---------|-------------|--------|
| Session Architecture | 3 | 6 | ✅ Done (session-architecture.spec.ts) |
| Mobile Layout | 7 | 9 | ✅ Done (mobile.spec.ts) |
| Conversation Core | 5 | 5 | ✅ Done (conversation.spec.ts) |
| Composer Controls | 5 | 5 | ✅ Done (composer-controls.spec.ts) |
| Git Workbench | 5 | 5 | ✅ Done (git-workbench.spec.ts) |
| Workspace Mgmt | 3 | 6 | ✅ Done (workspace-thread.spec.ts) |
| Settings | 3 | 7 | ✅ Done (settings-errors.spec.ts) |
| Wave1 Parity | — | 4 | ✅ Done (wave1-parity.spec.ts) |
| Workbench Core | — | 11 | ✅ Done (workbench.spec.ts) |
| Decision Center | 4 | — | Remaining |
| Thread Mgmt | 3 | — | Remaining |
| Error Handling | 2 | — | Remaining |
| Code/Image Preview | 2 | — | Remaining |
| Realtime | 2 | — | Remaining |
| Plugins | 1 | — | Remaining |
| Config Migration | 1 | — | Remaining |
| **Total** | **46** | **58** | **79% planned, 58 actual** |
