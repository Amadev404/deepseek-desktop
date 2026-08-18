# DeepSeek Desktop

[中文](README.md) | [English](README.en.md)

DeepSeek Desktop is a lightweight Windows x64 desktop shell that runs the
official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
Web UI without modifying the official Harness source.

> This is an independent community project. It is not an official DeepSeek
> product and is not endorsed by DeepSeek. DeepSeek is a trademark of DeepSeek AI.

## v0.9.0 Features

- Bundles the official `@deepseek-ai/dsh@0.1.0-rc.6` runtime and Node.js 24.11.0.
- Displays the full Harness Web UI in a native Windows window.
- Reuses the models, sessions, workspaces, and plugin configuration in `~/.dsh`.
- Binds only to `127.0.0.1`, preferring port 3080 and falling back to a random port when needed.
- Keeps Node.js out of both the Harness and pet renderers and exposes only restricted desktop bridges.
- Stops the local Harness process when the desktop window closes.
- Warms up the official Harness and Web UI during installation to reduce first-launch delay.
- Adds a Codex-style account popover through the official `--patch` extension point without changing official source files.
- Includes a community plugin market adapted from Anywhere Labs' `dsh-community-market`.
- Aggregates the DSH 1024 Store and DSHFind catalogs with source, compatibility, version, and risk information.
- Verifies npm metadata, repository links, runtime compatibility, and lifecycle scripts before installation, then installs an exact version.
- Installs and uninstalls plugins through the official `plugin --profile web` command instead of editing Harness manifests directly.
- Stores installation receipts and supports uninstall, rollback, restart verification, automatic recovery, and a one-click DSH terminal.
- Reads the DeepSeek API key on the host side and displays the official account balance without exposing the raw key to the renderer.
- Shows input, output, cache, and reasoning token statistics for the active session.
- Provides three thinking-strength levels through the official `session.models/selectModel` API.
- Provides Harness settings and desktop-quit actions in the account popover.
- Preserves the native Harness visual language and keeps a work-themed whale-girl illustration visible in wide-screen new-session and chat views.
- Includes a DeepSeek pet using a Codex nine-state atlas and official playback timing, with task completion, failure, and pending-state notifications.
- Runs the pet in an independent transparent, frameless, always-on-top window that can move across monitors.
- Keeps the pet out of the taskbar and lets clicks pass through outside the character hit area; it uses separate window titles, IPC, and data directories from the Codex pet.
- Uses a quiet idle frame for the built-in pet; hover triggers only a short hop and ordinary clicks do not trigger extra actions.
- Starts the running animation only after horizontal dragging exceeds 4 px, follows screen coordinates smoothly, and clears the running state on release.
- Persists the pet position in `%APPDATA%\DeepSeek Desktop\deepseek-pet-window.json`, outside the Harness and Codex configuration.
- Does not enable global mouse tracking for the built-in pet; imported Codex V2 pets retain their original 16-direction tracking.
- Uses an elapsed-time `requestAnimationFrame` player that catches up after dropped frames.
- Coalesces drag events per display frame and updates the pet position directly instead of rerendering the whole React tree.
- Removes detached alpha residue from the built-in atlas and clears unused cells so rectangular artifacts do not appear on dark backgrounds.
- Decouples animation from window movement and performs one static center alignment per action row, avoiding end-of-loop compensation jumps.
- Reserves symmetric transparent safety margins for the maximum scale and both movement directions so tails and skirts are not clipped by the window edge.
- Updates the built-in whale-girl activity frames at approximately 12 FPS while imported Codex pets retain their original Codex timing.
- Clears stale interaction state when tasks change so completed sessions do not keep the pet moving.
- Keeps the DeepSeek pet in its own renderer, cookies, bridge, and `%APPDATA%\DeepSeek Desktop\pets` directory without creating or replacing a Codex pet window.
- Shows only a pet summary in the account popover; selection, animation, size, position, and import operations are handled in a dedicated manager window.
- Imports Codex V1 `1536x1872` and V2 `1536x2288` custom pet packages.
- Uses an isolated DeepSeek pet namespace and `%APPDATA%\DeepSeek Desktop\pets` directory.
- Uses the whale-girl artwork for the application, installer, shortcut, and account-menu icons.

The desktop shell does not copy, record, or manage API keys, and it does not
modify the official Harness source, Agent definitions, or Profile manifests.
The balance request is handled on the host side by the bundled Harness
Companion plugin. The renderer receives only the balance result and cannot
read the raw key. The desktop bridge exposed to trusted Harness pages is
limited to `quit()` and a restricted, app-owned pet-library API.

The official Harness initializes a missing Web Profile on first launch and
maintains its runtime junctions under `profiles/node_modules`. DeepSeek Desktop
only maintains its own `@deepseek-desktop/companion` and
`@deepseek-desktop/market` junctions in the fallback directory, and refuses to
overwrite a real directory at either location.

## Development

Requirements: Windows 10/11 x64, Node.js 24.11.0, and npm.

```powershell
npm install
npm run typecheck
npm test
npm run smoke:harness
npm start
```

## Packaging

```powershell
npm run package:dir
npm run dist:win
```

The installer is written to `dist/DeepSeek-Desktop-Setup-0.9.0-x64.exe`.
This build is not code-signed, so Windows SmartScreen may show an unknown
publisher warning.

## Data Directories

The application uses `DSH_HOME` when set and otherwise uses
`%USERPROFILE%\.dsh`. Uninstalling DeepSeek Desktop does not remove that
directory.

## Licensing and Attribution

DeepSeek Desktop program code is licensed under the MIT License. The whale-girl
application icon, account avatar, and work-themed illustration are separate
CC BY-NC-SA 4.0 assets and are restricted to non-commercial use with
attribution and ShareAlike terms. The bundled DeepSeek pet atlas is a separate
MIT-licensed work. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
`LICENSE`, and the files in `licenses/` for the complete attribution and
license chain.

This project is an unofficial community client and does not represent DeepSeek
or any upstream asset creator.
