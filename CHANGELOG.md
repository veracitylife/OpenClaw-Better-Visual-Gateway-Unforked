# Changelog

All notable changes to `@thisisjeron/better-gateway` will be documented in this file.

## [1.1.0] - 2026-02-10

### ✨ Added
- Embedded IDE workflow in Better Gateway (`/better-gateway/ide`) with Monaco-based editing.
- Toolbar improvements including **Open Folder** and restored **Refresh** action for file tree sync.
- Enhanced Gateway navigation integration for IDE/split-view usage.
- Improved README docs highlighting IDE and reliability value props.

### 🔌 Chat + Context UX
- Integrated chat transport work for IDE-side workflows (Ticket 12 completion).
- `@file` mention/chip workflow completed (Ticket 13 completion).
- File blocks rendered as collapsible chips in chat history for cleaner context display.

### 🐛 Fixed
- Multiple `@file` mention edge cases:
  - Enter key interception while mention picker is active.
  - Prevent accidental sends during active mention selection.
  - Correct mention payload handling and active mention inference.
  - Ensure attached references include actual file contents.

### 🧪 Quality
- Updated test assertions for toolbar controls (including refresh button).
- General stability/polish updates for mention handling and transport behavior.

---

## [1.0.1] - Previous
- Baseline plugin release with Gateway auto-reconnect enhancements.
