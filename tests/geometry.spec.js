/**
 * Tests for the injected window-bounds script and the geometry policy it
 * mirrors. The script's own `resolve` is exercised through a stubbed window,
 * because that copy — not `geometry.js` — is what the shell actually runs.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveBounds, parseStored } from '../src/geometry.js'
import { windowBoundsScript } from '../src/script.js'

const POLICY = {
  minWidth: 480,
  minHeight: 360,
  maxPosition: 8000,
  restorePosition: true,
}

/**
 * Stub the browser globals the script touches, then run the injected source.
 *
 * `SCREEN` mirrors the fixture display: any case that omits a field reads the
 * same value in the script and in the `geometry.js` comparison.
 */
const SCREEN = { availWidth: 1920, availHeight: 1040, availLeft: 0, availTop: 0 }

function install(stored, { screenInfo = {}, enabled = true, config = {} } = {}) {
  const applied = []
  const writes = []
  const listeners = new Map()
  const posts = []
  const sandbox = {
    window: {
      resizeTo: (width, height) => applied.push({ kind: 'resize', width, height }),
      moveTo: (x, y) => applied.push({ kind: 'move', x, y }),
      screenX: 10,
      screenY: 20,
      outerWidth: 1280,
      outerHeight: 820,
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
    screen: {
      ...SCREEN,
      ...screenInfo,
    },
    localStorage: {
      getItem: () => (stored === undefined ? null : JSON.stringify(stored)),
      setItem: (_key, value) => writes.push(JSON.parse(value)),
    },
    setTimeout: (fn) => {
      fn()
      return 0
    },
    clearTimeout: () => {},
  }
  const source = windowBoundsScript({
    storageKey: 'dsh-window-bounds:v1',
    saveDelayMs: 400,
    restorePosition: true,
    remember: true,
    trace: false,
    traceUrl: '/window-bounds/trace',
    minWidth: POLICY.minWidth,
    minHeight: POLICY.minHeight,
    maxPosition: POLICY.maxPosition,
    enabled,
    ...config,
  })
  const run = new Function(
    'window',
    'screen',
    'localStorage',
    'setTimeout',
    'clearTimeout',
    'JSON',
    'Math',
    'isFinite',
    'fetch',
    'location',
    source,
  )
  run(
    sandbox.window,
    sandbox.screen,
    sandbox.localStorage,
    sandbox.setTimeout,
    sandbox.clearTimeout,
    JSON,
    Math,
    isFinite,
    (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) })
      return Promise.resolve()
    },
    { href: 'dsh-app://app/' },
  )
  return { applied, writes, listeners, posts }
}

test('restores a saved size and position', () => {
  const { applied } = install({ x: 120, y: 90, width: 1000, height: 700 })
  assert.deepEqual(applied, [
    { kind: 'resize', width: 1000, height: 700 },
    { kind: 'move', x: 120, y: 90 },
  ])
})

test('shrinks a saved size that no longer fits the work area', () => {
  const { applied } = install(
    { x: 10, y: 10, width: 2400, height: 1400 },
    { screenInfo: { availWidth: 1280, availHeight: 720 } },
  )
  assert.deepEqual(applied, [{ kind: 'resize', width: 1280, height: 720 }])
})

test('keeps the size but drops a position on an unattached display', () => {
  const { applied } = install({ x: 2600, y: 40, width: 900, height: 600 })
  assert.deepEqual(applied, [{ kind: 'resize', width: 900, height: 600 }])
})

test('drops a position outside the work area when the taskbar moved', () => {
  const { applied } = install(
    { x: 700, y: 8, width: 900, height: 600 },
    { screenInfo: { availWidth: 1280, availHeight: 1040, availLeft: 0, availTop: 40 } },
  )
  assert.deepEqual(applied, [{ kind: 'resize', width: 900, height: 600 }])
})

test('applies nothing when the saved size is below the minimum', () => {
  const { applied } = install({ x: 0, y: 0, width: 300, height: 200 })
  assert.deepEqual(applied, [])
})

test('applies nothing when storage is empty or corrupt', () => {
  assert.deepEqual(install(undefined).applied, [])
  assert.deepEqual(install('{not json').applied, [])
  assert.deepEqual(install([1, 2, 3]).applied, [])
  assert.deepEqual(install({ width: '1000', height: 700 }).applied, [])
})

test('restores size only when position restore is off', () => {
  const { applied } = install({ x: 120, y: 90, width: 1000, height: 700 }, { config: { restorePosition: false } })
  assert.deepEqual(applied, [{ kind: 'resize', width: 1000, height: 700 }])
})

test('does nothing at all when disabled', () => {
  const { applied, listeners } = install({ x: 120, y: 90, width: 1000, height: 700 }, { enabled: false })
  assert.deepEqual(applied, [])
  assert.equal(listeners.size, 0)
})

test('persists the settled bounds from a resize event', () => {
  const { writes, listeners } = install(undefined)
  assert.equal(typeof listeners.get('resize'), 'function')
  listeners.get('resize')()
  assert.deepEqual(writes, [{ x: 10, y: 20, width: 1280, height: 820 }])
})

test('geometry.js agrees with the injected policy on every case', () => {
  const cases = [
    [{ x: 120, y: 90, width: 1000, height: 700 }, {}],
    [{ x: 10, y: 10, width: 2400, height: 1400 }, { availWidth: 1280, availHeight: 720 }],
    [{ x: 2600, y: 40, width: 900, height: 600 }, {}],
    [{ x: 700, y: 8, width: 900, height: 600 }, { availTop: 40 }],
    [{ width: 300, height: 200 }, {}],
    [{ width: '1000', height: 700 }, {}],
    [{ x: NaN, y: 0, width: 900, height: 600 }, {}],
    [{ x: 9000, y: 0, width: 900, height: 600 }, {}],
  ]
  for (const [stored, screenInfo] of cases) {
    const { applied } = install(stored, { screenInfo })
    const expected = resolveBounds(stored, { ...SCREEN, ...screenInfo }, POLICY)
    const resize = applied.find(step => step.kind === 'resize')
    const move = applied.find(step => step.kind === 'move')
    const actual = resize === undefined
      ? null
      : {
          width: resize.width,
          height: resize.height,
          ...(move === undefined ? {} : { x: move.x, y: move.y }),
        }
    const label = `${JSON.stringify(stored)} ${JSON.stringify(screenInfo)}`
    if (expected === null) {
      assert.equal(actual, null, label)
      continue
    }
    assert.deepEqual(actual, expected, label)
  }
})

test('restores but stops saving when remember is off', () => {
  const { applied, listeners, writes } = install(
    { x: 120, y: 90, width: 1000, height: 700 },
    { config: { remember: false } },
  )
  assert.deepEqual(applied, [
    { kind: 'resize', width: 1000, height: 700 },
    { kind: 'move', x: 120, y: 90 },
  ])
  assert.equal(listeners.size, 0)
  assert.deepEqual(writes, [])
})

test('tracing reports what the page measured before and after the resize', () => {
  const { posts, applied } = install(
    { x: 120, y: 90, width: 1000, height: 700 },
    { config: { trace: true } },
  )
  assert.deepEqual(applied.length, 2)
  assert.equal(posts.length, 2)
  assert.equal(posts[0].url, '/window-bounds/trace')
  assert.equal(posts[0].body.phase, 'boot')
  assert.deepEqual(posts[0].body.detail.stored, { x: 120, y: 90, width: 1000, height: 700 })
  assert.deepEqual(posts[0].body.detail.target, { x: 120, y: 90, width: 1000, height: 700 })
  assert.equal(posts[0].body.geometry.outerWidth, 1280)
  assert.deepEqual(posts[0].body.screen, SCREEN)
  assert.equal(posts[1].body.phase, 'settled')
})

test('tracing reports a disabled plugin instead of staying silent', () => {
  const { posts } = install(undefined, { enabled: false, config: { trace: true } })
  assert.equal(posts.length, 1)
  assert.equal(posts[0].body.phase, 'skipped')
  assert.equal(posts[0].body.detail.reason, 'disabled')
})

test('no trace posts are made while tracing is off', () => {
  assert.deepEqual(install({ x: 1, y: 1, width: 900, height: 600 }).posts, [])
})

test('parseStored rejects everything that is not a JSON object', () => {
  assert.equal(parseStored(null), null)
  assert.equal(parseStored('null'), null)
  assert.equal(parseStored('[]'), null)
  assert.equal(parseStored('"x"'), null)
  assert.deepEqual(parseStored('{"width":900}'), { width: 900 })
})

test('windowBoundsScript embeds the configuration and stays parseable', () => {
  const source = windowBoundsScript({
    enabled: true,
    storageKey: 'dsh-window-bounds:v1',
    saveDelayMs: 400,
    restorePosition: true,
    minWidth: 480,
    minHeight: 360,
    maxPosition: 8000,
  })
  assert.match(source, /^\(function \(defaults\)/)
  assert.doesNotThrow(() => new Function(source))
  assert.match(source, /"storageKey":"dsh-window-bounds:v1"/)
})
