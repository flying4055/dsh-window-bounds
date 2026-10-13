/**
 * Injected window-bounds script.
 *
 * This source is injected verbatim as an inline head script through the
 * `webserver/index-inject` table, and the desktop shell applies that table
 * before its application bundle mounts. It must therefore be self-contained
 * plain JavaScript: no imports, no bundler helpers, no optional chaining, and
 * no host objects beyond `window`, `screen`, and `localStorage`, all of which
 * the `dsh-app://app` origin has.
 *
 * The window object is the only available control surface. The official
 * desktop shell is a closed Electron application with no IPC channel for window
 * geometry, and it creates the main window at a fixed 1280x820; the renderer
 * resizing its own window through `resizeTo` / `moveTo` is the supported path,
 * the same one the shipped `dsh-ui-scale` plugin uses to restore geometry.
 *
 * Rejected inputs are dropped silently: a stale position, a geometry from a
 * display that is no longer attached, or corrupt storage must fall back to the
 * shell default rather than put the window somewhere invisible. The companion
 * `geometry.js` module owns that policy as testable Node code, and
 * `tests/geometry.spec.js` runs this script's own copy against the same cases.
 *
 * @module dsh-window-bounds/script
 */

/** Token replaced by the serialized plugin configuration. */
const CONFIG_TOKEN = '__DSH_WINDOW_BOUNDS_CONFIG__'

/**
 * Serialized source of the injected script, one IIFE receiving the plugin
 * configuration. Kept ES5-shaped because the text goes into the page as-is.
 */
export const INSTALL_WINDOW_BOUNDS = `(function (defaults) {
  var KEY = defaults.storageKey
  var MIN_WIDTH = defaults.minWidth
  var MIN_HEIGHT = defaults.minHeight
  var MAX_POSITION = defaults.maxPosition
  var SAVE_DELAY_MS = defaults.saveDelayMs
  var restorePosition = defaults.restorePosition === true
  var remember = defaults.remember !== false
  var restoring = true
  var timer = null

  function read() {
    try {
      var raw = localStorage.getItem(KEY)
      if (raw === null) return null
      var saved = JSON.parse(raw)
      if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return null
      return saved
    } catch (error) {
      return null
    }
  }

  function write(bounds) {
    try {
      localStorage.setItem(KEY, JSON.stringify(bounds))
    } catch (error) {
      /* Storage can be unavailable or full; geometry is best-effort. */
    }
  }

  function resolve(saved) {
    if (saved === null || saved === undefined) return null
    if (typeof saved !== 'object') return null
    function finite(value) {
      return typeof value === 'number' && isFinite(value)
    }
    if (!finite(saved.width) || !finite(saved.height)) return null
    if (saved.width < MIN_WIDTH || saved.height < MIN_HEIGHT) return null
    var availWidth = finite(screen.availWidth) && screen.availWidth > 0 ? screen.availWidth : null
    var availHeight = finite(screen.availHeight) && screen.availHeight > 0 ? screen.availHeight : null
    var out = {
      width: availWidth === null ? saved.width : Math.min(saved.width, availWidth),
      height: availHeight === null ? saved.height : Math.min(saved.height, availHeight)
    }
    if (restorePosition === false) return out
    if (!finite(saved.x) || !finite(saved.y)) return out
    if (Math.abs(saved.x) > MAX_POSITION || Math.abs(saved.y) > MAX_POSITION) return out
    /*
     * A saved spot comes back only while it still lies inside this display's
     * work area, so a disconnected or rearranged monitor cannot hide the window.
     */
    var availLeft = finite(screen.availLeft) ? screen.availLeft : 0
    var availTop = finite(screen.availTop) ? screen.availTop : 0
    var left = saved.x - availLeft
    var top = saved.y - availTop
    if (left < 0 || top < 0) return out
    if (availWidth !== null && left + out.width > availWidth) return out
    if (availHeight !== null && top + out.height > availHeight) return out
    out.x = saved.x
    out.y = saved.y
    return out
  }

  function apply(target) {
    if (target === null) return
    try {
      window.resizeTo(target.width, target.height)
      if (typeof target.x === 'number' && typeof target.y === 'number') window.moveTo(target.x, target.y)
    } catch (error) {
      /* A refused resize leaves the shell default in place. */
    }
  }

  function save() {
    if (restoring) return
    var bounds = {
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight
    }
    if (!(bounds.width >= MIN_WIDTH) || !(bounds.height >= MIN_HEIGHT)) return
    write(bounds)
  }

  function schedule() {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(function () {
      timer = null
      save()
    }, SAVE_DELAY_MS)
  }

  /*
   * Diagnostics for the trace endpoint. The shell offers no console access in a
   * packaged build, so the trace flag posts what this script observed to the
   * host, which appends it to a log file. Off unless the user asks for it.
   */
  function report(phase, extra) {
    if (defaults.trace !== true) return
    var payload = {
      phase: phase,
      href: location.href,
      geometry: {
        x: window.screenX,
        y: window.screenY,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      },
      screen: {
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        availLeft: screen.availLeft,
        availTop: screen.availTop
      },
      at: Date.now()
    }
    if (extra !== undefined) payload.detail = extra
    try {
      var body = JSON.stringify(payload)
      fetch(defaults.traceUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body
      }).catch(function () {
        /* A refused trace must not affect geometry handling. */
      })
    } catch (error) {
      /* Same. */
    }
  }

  if (defaults.enabled !== true) {
    report('skipped', { reason: 'disabled' })
    return
  }

  var stored = read()
  var target = resolve(stored)
  report('boot', { stored: stored, target: target })
  apply(target)
  /*
   * The programmatic resize above raises its own resize and move events;
   * persisting them is harmless but pointless, and the settled flag keeps the
   * first saved bounds equal to what the user actually left behind.
   */
  setTimeout(function () {
    restoring = false
    report('settled', { target: target })
  }, 300)
  if (remember === false) return
  window.addEventListener('resize', schedule)
  window.addEventListener('move', schedule)
  /*
   * The shell hides the window instead of quitting on close, so its unload
   * event is not the durable path: the debounced listeners above are. This
   * only flushes a pending change during a real teardown.
   */
  window.addEventListener('beforeunload', save)
})(${CONFIG_TOKEN})`

/**
 * Build the head-script source for one plugin configuration.
 *
 * @param config - validated plugin configuration.
 * @param config.enabled - whether geometry is restored and saved at all.
 * @param config.remember - whether changing bounds is persisted for next launch.
 * @param config.trace - whether the script reports what it observed to the host.
 * @param config.traceUrl - endpoint receiving trace payloads.
 * @param config.storageKey - `localStorage` key owning the saved geometry.
 * @param config.saveDelayMs - debounce delay for persisting bounds.
 * @param config.restorePosition - whether a saved position is applied.
 * @param config.minWidth - smallest restorable width.
 * @param config.minHeight - smallest restorable height.
 * @param config.maxPosition - absolute pixel bound for a restorable x or y.
 * @returns the JavaScript source of the injected IIFE.
 */
export function windowBoundsScript(config) {
  const defaults = {
    enabled: config.enabled,
    remember: config.remember,
    trace: config.trace,
    traceUrl: config.traceUrl,
    storageKey: config.storageKey,
    saveDelayMs: config.saveDelayMs,
    restorePosition: config.restorePosition,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    maxPosition: config.maxPosition,
  }
  return INSTALL_WINDOW_BOUNDS.replace(CONFIG_TOKEN, JSON.stringify(defaults))
}
