# Screenflare Capture

A [Raycast](https://raycast.com) extension for [Screenflare](https://screenflare.app) — take screenshots and screen
recordings, and browse your Screenflare library, without leaving Raycast.

## Commands

| Command | Description |
| --- | --- |
| Capture Area Screenshot | Drag out a region, then copy it to the clipboard |
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

Two consequences worth knowing:

- **Accessibility permission is required** for Raycast (System Settings ▸ Privacy & Security ▸ Accessibility) so it can
  press Screenflare's menus.
- **Capture Area** borrows the `⌘⇧4` chord, because Screenflare starts its region selection from a global hotkey rather
  than a menu item. This lands on Screenflare when the matching macOS shortcut is switched off in
  Keyboard ▸ Keyboard Shortcuts ▸ Screenshots — the same setup Screenflare's onboarding asks for. If you leave the
  system shortcut on, you get the standard macOS capture instead.

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
- [Screenflare](https://screenflare.app) installed in `/Applications`

## License

MIT
