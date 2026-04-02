# WebCLI Design System

Design reference for the WebCLI workbench UI. All visual changes must align with these principles.

**Figma**: [WebCLI Design System](https://www.figma.com/design/xlN1MA3siQPBKSZXTD7FS3)

## Design Goal

Replicate Codex Desktop's visual language in the browser. The user should feel no downgrade moving from the native app to WebCLI.

## Principles

1. **Content-first** — UI chrome fades into the background. Conversation and code are the focus.
2. **Dark by default** — Deep dark backgrounds (`#0A0B0F`) with high-contrast text for extended coding sessions.
3. **Quiet until needed** — Interactive controls use low-opacity white overlays. Only the accent color (`#7FCDFF`) and status colors demand attention.
4. **Compact density** — Optimized for information-dense screens. No unnecessary whitespace, no oversized padding.
5. **Consistent hierarchy** — Three visual layers: sidebar (mid-gray), content area (near-black), panels/overlays (elevated dark).

## Color Palette

### Backgrounds

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-app` | `#0A0B0F` | Main content area, conversation background |
| `--bg-panel` | `#101116` | Right rail, modals, elevated panels |
| `--bg-panel-soft` | `#151821` | Header toolbar, composer area |
| `--bg-panel-strong` | `#0D0F13` | Deepest panels |
| Body | `#2F3137` | Document body, behind all panels |
| `--bg-sidebar` | `#3A3C43` | Sidebar background |
| `--bg-sidebar-soft` | `#44474F` | Sidebar hover states |

### Accent & Semantic

| Token | Hex | Usage |
|-------|-----|-------|
| `--accent` | `#7FCDFF` | Links, focus rings, active indicators |
| `--green` | `#59CF86` | Success, running status |
| `--amber` | `#D8A05C` | Warnings, pending states |
| `--danger` | `#F06D65` | Errors, destructive actions |

### Text

| Token | Hex | Usage |
|-------|-----|-------|
| `--text` | `#F3F4F7` | Primary text, headings |
| `--muted-strong` | `#D0D3DB` | Secondary text |
| `--muted` | `#A2A7B5` | Tertiary text, labels, metadata |
| Disabled | `#6B7080` | Disabled controls |

### Interactive States

All interactive states use white overlays on the existing background:

| State | Value | Usage |
|-------|-------|-------|
| Hover | `rgba(255,255,255, 0.06)` | Button/row hover |
| Active | `rgba(255,255,255, 0.10)` | Button pressed, active tab |
| Border | `rgba(255,255,255, 0.08)` | Default borders |
| Border Strong | `rgba(255,255,255, 0.14)` | Focus borders, dividers |

## Typography

Font stack: `"SF Pro Text", "PingFang SC", "Helvetica Neue", "IBM Plex Sans", sans-serif`
Mono: `"IBM Plex Mono", "SF Mono", monospace`

| Style | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| Hero | 28px | 625 | 1.04 | -0.04em | Page title (empty state) |
| Title | 19px | 610 | 1.12 | -0.03em | Thread title in header |
| Section | 16px | 590 | 1.28 | -0.02em | Settings section headers |
| Body | 15px | 460 | 1.72 | -0.012em | Conversation messages, descriptions |
| Body Compact | 14px | 470 | 1.52 | -0.01em | Timeline entries, inline content |
| Label | 14px | 560 | 1.24 | -0.018em | Composer controls, button text |
| Meta | 13px | 500 | 1.34 | -0.005em | Timestamps, file stats, badges |
| Code | 14px | 470 | 1.68 | 0 | Terminal output, inline code |
| Eyebrow | 11px | 560 | 1.2 | 0.12em | Brand label, section eyebrows |

## Spacing

8px base unit. Use multiples: 2, 4, 6, 8, 12, 16, 20, 24.

| Scale | Value | Usage |
|-------|-------|-------|
| xs | 2px | Icon-to-label gap |
| sm | 4px | Tight inner padding |
| md | 8px | Standard gap between elements |
| lg | 12px | Section gap, card padding |
| xl | 16px | Major section separation |
| 2xl | 20px | Content area padding |
| 3xl | 24px | Modal/overlay padding |

## Border Radius

| Scale | Value | Usage |
|-------|-------|-------|
| sm | 4px | Inputs, inline code |
| md | 8px | Buttons, small cards |
| lg | 12px | Panels, thread rows |
| xl | 16px | Modals, large cards |
| pill | 999px | Badges, status chips |

## Layout

### Desktop (>768px)

```
+----------+--+-----------------------------+
| Sidebar  |R | Header Toolbar              |
| 260px    |e |-----------------------------+
|          |s | Conversation    | Right     |
| Brand    |i | Timeline        | Rail      |
| Projects |z |                 | Decision  |
| Threads  |e |                 | Center    |
| Search   |r |                 |           |
|          |  |-----------------+-----------+
| Archived |  | Composer Bar                |
+----------+--+-----------------------------+
```

- **Sidebar**: 260px default, resizable. Content flows top-to-bottom: brand, project list, search, workspace tree, archived count.
- **Sidebar rule**: No `flex-grow` on content sections. Content stays compact at natural height; sidebar scrolls when content overflows.
- **Header**: Fixed 50px. Thread title + CWD pill + usage stats + speed toggle + locale + terminal/review buttons + settings gear.
- **Conversation**: Flex-grow fills remaining space. Timeline scrolls vertically. Composer sticks to bottom.
- **Right Rail**: Collapsible. Decision Center + Command Panel.
- **Composer**: Fixed bottom. Input field + model select + reasoning + approval + sandbox controls.

### Mobile (<768px)

- Sidebar becomes a drawer (slide from left with overlay backdrop).
- Header shows hamburger menu button.
- Right rail hidden (decision center floats above composer).
- Composer toolbar wraps below input.

## Components

### Buttons

| Variant | Style | Usage |
|---------|-------|-------|
| Ghost | Transparent bg, text color, hover overlay | Most buttons (sidebar, toolbar, controls) |
| Pill | Border + subtle bg, rounded corners | Header toolbar actions (Terminal, Code Review) |
| Primary | Accent bg gradient, white text | Send button, submit actions |
| Danger | Red-tinted bg, red text | Stop/terminate, destructive |

### Thread Row

- Height: auto (content-based)
- States: default, hover (overlay), active (accent left border or bg)
- Content: status indicator (dot) + title (bold) + relative time
- Actions: context menu trigger ("..." icon) on hover

### Context Menu

- Opens below trigger button
- Items: Rename, Fork, Archive/Restore, Compact, Undo last turn
- Width: auto, min 140px

### Workspace Row

- Icon (folder) + name (bold) + subtitle (muted)
- Actions: settings gear + compose button
- Expand/collapse for nested thread list

### Composer

- Textarea with placeholder, auto-grow
- Bottom bar: model dropdown, thinking toggle, approval policy, sandbox mode
- Git bar (when workspace has git): branch dropdown, file stats, "Review" button
- Send/interrupt button (right side)

### Settings Panel

- Full-screen overlay with tabs
- Tabs: Account, General, Defaults, Integrations, Extensions, History
- Each tab is a vertical stack of cards

### Command Panel

- Appears in right rail when inspector tab = "command"
- Command input + run/stop button
- Terminal output (monospace, dark bg, auto-scroll)
- Stdin input row (when process is running + allows stdin)

## Shadows & Elevation

Three levels:

| Level | Shadow | Usage |
|-------|--------|-------|
| Base | none | Flat elements (sidebar, content area) |
| Elevated | `0 16px 34px rgba(0,0,0,0.24)` | Dropdowns, context menus |
| Overlay | `0 28px 70px rgba(0,0,0,0.35)` | Modals, settings panel |

## Transitions

- **Background/opacity**: `150ms ease`
- **Transform**: `120-150ms ease`
- **Drawer slide**: `250ms cubic-bezier(0.4, 0, 0.2, 1)`
- **Rule**: No transition on layout-affecting properties (width, height, padding). Only visual properties (color, opacity, transform, box-shadow).

## Icons

- 20x20 viewbox, stroke-based (currentColor)
- Stroke weight: 1.3-1.5 for UI icons, 2 for emphasis (checkmark)
- All icons have `aria-hidden="true"`
- Use existing icon set in `workbench-icons.tsx`. Do not add icon fonts or external icon libraries.

## Anti-patterns

Do NOT:
- Add `flex-grow: 1` to sidebar content sections (causes layout gaps with few items)
- Put workbench-level actions (terminal, code review) in the git-specific bar
- Duplicate button labels across different actions ("Review" used for both git diff and code review)
- Use `display: grid` with equal row distribution for sidebar sections (children should auto-size)
- Add padding/margin > 24px anywhere (keeps the density compact)
- Use shadows on flat elements (sidebar, conversation area are shadowless)
