# dsh-window-bounds

Remember the DeepSeek Harness **desktop** window size and position, so the window
reopens where you left it instead of at the shell's fixed 1280x820.

[中文](README.md) | English

## Why a plugin has to do this

The official desktop shell (`@deepseek-ai/dsh-desktop`, Electron) creates its main
window in `lib/main.js` with hardcoded `width: 1280, height: 820`, and exposes no
IPC channel for window geometry — the preload bridge carries updates, shortcuts,
browser views, and the directory picker, but nothing that reads or writes the main
window bounds. There is also no `DSH_DESKTOP_*` environment variable for it.

The one surface that remains is the window itself: a page loaded on the
`dsh-app://app` origin may call `window.resizeTo()` / `window.moveTo()`. The
shipped [`dsh-ui-scale`](https://github.com/juliankang4/dsh-ui-scale) plugin uses
exactly that path for its own window-size feature, and this plugin reuses it.

## How it works

1. The host half listens on the webserver's `webserver/index-inject` event and
   pushes one `{ kind: 'script', placement: 'head' }` row.
2. The desktop shell boots by fetching that injection table from the host
   (`ctx.webServer.collectIndexInjections()`) and running it before its
   application bundle mounts — so the resize happens while the window is still
   hidden, with no visible jump.
3. The injected script reads the saved geometry from `localStorage`
   (`dsh-window-bounds:v1` on the `dsh-app://app` origin), resolves it against the
   current display, applies it, then debounces `resize`/`move` events back into
   storage.
4. Saving is debounced rather than done on unload, because closing the desktop
   window **hides it to the tray** instead of quitting; an unload handler would
   never run for the common case.

Rejected geometry never hides the window: a size below the minimum, a coordinate
beyond the position bound, or a spot that no longer lies inside the current
display's work area all fall back to the shell default (a still-valid size is kept
when only the position is rejected).

## Install

```sh
dsh plugin --profile <profile> add flying4055/dsh-window-bounds
```

The package declares `dsh.bundle.patch`, so `dsh plugin add` installs it, appends
it to the profile's `dsh.profile.bundles`, and mounts its `cordis.patch.yml`; the
matching `remove` takes it back out. Restart the profile afterwards.

### Desktop app

The desktop profile is owned by the Electron application, which refuses CLI
operations on it. Install into it through the application's own plugin surface
(Plugins → Add plugin) and enter `flying4055/dsh-window-bounds`.

### By hand

For a profile nothing else manages, place the package in its `node_modules` and
add one insert entry to the profile patch:

```sh
cp -r dsh-window-bounds "$DSH_HOME/profiles/desktop/node_modules/"   # or %USERPROFILE%\.dsh\...
```

```yaml
- insert:
    - id: window-bounds
      name: dsh-window-bounds
```

Nothing else is needed: the plugin is enabled by default, and it loads no
packages of its own (the desktop profile has no `@deepseek-ai` packages, and the
runtime keeps its dependency tree inside `app.asar`, so the plugin validates its
own configuration instead of importing a schema library). This repository ships
`install.mjs`, which performs the copy and the patch edit for the local desktop
profile and can undo both.

## Configure

Configuration is the entry's `config` in the profile patch:

```yaml
- insert:
    - id: window-bounds
      name: dsh-window-bounds
      config:
        remember: true
        restorePosition: true
```

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Restore and save geometry at all. |
| `remember` | `true` | Persist changed bounds for the next launch. `false` restores but never overwrites. |
| `restorePosition` | `true` | Apply a saved position, not only the size. |
| `minWidth` / `minHeight` | `480` / `360` | Smallest restorable size. |
| `maxPosition` | `8000` | Absolute pixel bound for a restorable `x` or `y`. |
| `saveDelayMs` | `400` | Debounce delay before persisting changed bounds. |
| `trace` | `false` | Append what the page measured to `window-bounds-trace.log` in the profile. |

An invalid value fails the plugin load with the offending field named, instead of
running a policy nobody wrote.

### Why the plugin panel shows no form

**This is deliberate — never add `toJSON` to `Config`.** The DSH 0.2.0-rc.2
settings service decides whether a plugin's Config is renderable with
`Config !== undefined && 'toJSON' in Config`, and then treats whatever it selected
as a **schemastery schema**, reading `schema.meta.volatile` and `schema.dict`
directly. So:

- a plain object that merely looks schema-like passes that test and then throws
  `TypeError: Cannot read properties of undefined (reading 'volatile')` inside
  `settings/describe`;
- that Remote call fails as a whole, and the desktop shell's welcome window dies
  with `desktop welcome: Web RPC failed` — **the application crashes at startup**.

A real schemastery schema is out of reach from here too: the runtime keeps its
dependency tree inside `app.asar`, where Node's resolver cannot find
`@deepseek-ai/schemastery` from a plugin on disk. This plugin therefore exports
only `~standard` (so the loader still validates `config`) and **no** `toJSON`, so
the panel has no fields to render and `settings/describe` skips it safely.
`tests/host.spec.js` asserts that invariant.

`configJsonSchema()` still exports the JSON Schema projection for documentation,
or for a caller that renders its own form, but it is **not** attached to `Config`.

To forget the saved geometry, resize the window and let it settle, or remove the
key on the `dsh-app://app` origin in the desktop app's DevTools:

```js
localStorage.removeItem('dsh-window-bounds:v1')
```

## Verify

Set `trace: true` in the config and relaunch. The plugin then serves a
`/window-bounds/trace` endpoint that the injected script posts to, and the
profile gains a `window-bounds-trace.log`:

```json
{"phase":"boot","geometry":{"x":632,"y":290,"outerWidth":1296,"outerHeight":828}, ...,
 "detail":{"stored":{"x":303,"y":214,"width":1707,"height":1053},
           "target":{"width":1707,"height":1053,"x":303,"y":214}}}
{"phase":"settled","geometry":{"x":295,"y":214,"outerWidth":1739,"outerHeight":1069}, ...}
```

`boot` is what the script found before it acted, `settled` what the window became.
Equal `target` and settled `geometry` mean the shell honoured the resize; a
still-default geometry means it did not. Use this instead of the console when the
packaged shell gives you no console to open.

Without tracing, the same numbers are one call away in DevTools:

```js
({ outer: [window.outerWidth, window.outerHeight], at: [window.screenX, window.screenY] })
```

## Test

```sh
node --test tests/geometry.spec.js tests/host.spec.js
```

`tests/geometry.spec.js` runs the injected script's own resolution logic — the
copy the shell executes — against the same cases as `src/geometry.js`, so the two
cannot drift. `tests/host.spec.js` covers config validation, the Standard Schema
projection, and the injection row.

## Limitations

- **Size and position only.** Maximized and fullscreen states are not restored;
  the shell's own state after `resizeTo` is what the OS reports.
- **One display's work area.** A saved spot is restored only when it still fits
  the current display; a position on a disconnected display is dropped while the
  size is kept.
- **The shell is the authority.** A future shell release could ignore
  renderer-initiated resizes or add a first-class geometry setting; this plugin
  exists because the current shell does neither.
