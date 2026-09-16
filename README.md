# Screenflare Capture

A [Raycast](https://raycast.com) extension for [Screenflare](https://screenflare.app) — take screenshots and screen
recordings, and browse your Screenflare library, without leaving Raycast.

## Commands

| Command | Description |
| --- | --- |
| Capture Area Screenshot | Drag out a region, then copy it to the clipboard |
| Capture Window Screenshot | Pick a window and capture it |
| Scrolling Capture | Capture a whole page or thread as it scrolls |
| Capture Fullscreen Screenshot | Capture the whole display straight to the clipboard |
| Capture Text | Drag out a region and copy the text inside it (OCR) |
| Record Area | Start a screen recording of a region |
| Record Display | Start a screen recording of a display |
| Record Window | Pick a window to record |
| Toggle Recording | Stop the current recording, or start a new one |
| Show Capture Bar | Bring up Screenflare's Record or Capture bar |
| Browse Library | Browse recordings and screenshots from the Screenflare library |

## How it works

Screenflare has no URL scheme, no AppleScript dictionary, no CLI and no Shortcuts actions, so the only automation hook
is its menu bar. Commands drive Screenflare through `System Events` by pressing menu items directly, which stays
correct even if you rebind Screenflare's shortcuts.

**Accessibility permission is required** for Raycast (System Settings ▸ Privacy & Security ▸ Accessibility) so it can
press Screenflare's menus. No other setup is needed — commands never synthesise keystrokes, so they are unaffected by
how you have configured macOS' own screenshot shortcuts.

Captures still open in Screenflare's editor when they need your input (a region to drag, a text selection to confirm).

## Library

`Browse Library` reads `~/Screenflare/recordings` and `~/Screenflare/screenshots` directly, including each capture's
duration, resolution and thumbnail. Both folder locations can be overridden in the extension preferences if you moved
Screenflare's library.

## Development

```sh
npm install
npm run dev     # ray develop
npm run lint    # ray lint
npm run build   # ray build
```

## Requirements

- macOS 15 or later
- Screenflare 0.1.21 or later (for Capture Window and Scrolling Capture)
- [Screenflare](https://screenflare.app) installed in `/Applications`

## License

MIT
