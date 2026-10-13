/**
 * Tests for the host half: config validation, the schema the settings surface
 * reads, and the injection row the shell applies.
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  Config,
  DEFAULTS,
  STORAGE_KEY,
  TRACE_ROUTE,
  apply,
  configJsonSchema,
  inject,
  name,
  profileDir,
  traceLogPath,
  validateConfig,
} from '../lib/index.js'

/** Minimal Cordis context capturing what the plugin registers. */
function stubContext() {
  const listeners = []
  const routes = []
  return {
    listeners,
    routes,
    ctx: {
      effect: (register) => register(),
      on: (event, listener) => {
        listeners.push({ event, listener })
        return () => {}
      },
      webServer: {
        register: (route) => {
          routes.push(route)
          return () => {}
        },
      },
    },
  }
}

/**
 * Run one injected script against a stub page.
 *
 * @param text - the injected source.
 * @returns everything the script did.
 */
function runInjected(text) {
  const applied = []
  const listeners = new Map()
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
    text,
  )
  run(
    {
      resizeTo: (width, height) => applied.push({ kind: 'resize', width, height }),
      moveTo: (x, y) => applied.push({ kind: 'move', x, y }),
      screenX: 10,
      screenY: 20,
      outerWidth: 1280,
      outerHeight: 820,
      innerWidth: 1280,
      innerHeight: 820,
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
    { availWidth: 1920, availHeight: 1040, availLeft: 0, availTop: 0 },
    {
      getItem: () => JSON.stringify({ x: 120, y: 90, width: 1000, height: 700 }),
      setItem: () => {},
    },
    (fn) => {
      fn()
      return 0
    },
    () => {},
    JSON,
    Math,
    isFinite,
    () => Promise.resolve(),
    { href: 'dsh-app://app/' },
  )
  return { applied, listeners }
}

test('exports the Cordis plugin shape the loader needs', () => {
  assert.equal(name, 'dsh-window-bounds')
  assert.deepEqual(inject, ['webServer'])
  assert.equal(typeof apply, 'function')
  assert.equal(typeof Config['~standard'].validate, 'function')
})

test('the schema is a Standard Schema and a JSON Schema projection', () => {
  assert.equal(Config['~standard'].version, 1)
  const result = Config['~standard'].validate({ remember: false })
  assert.equal(result.issues, undefined)
  assert.deepEqual(result.value, { ...DEFAULTS, remember: false })
  const json = configJsonSchema()
  assert.equal(json.type, 'object')
  assert.equal(json.additionalProperties, false)
  assert.deepEqual(Object.keys(json.properties).sort(), Object.keys(DEFAULTS).sort())
  assert.equal(json.properties.minWidth.default, DEFAULTS.minWidth)
})

test('Config stays invisible to the settings service selection rule', () => {
  // @deepseek-ai/dsh-settings picks a plugin schema with exactly this test and
  // then treats the result as a schemastery schema, reading `.meta.volatile` and
  // `.dict`. A plain object that exposes `toJSON` passes the selection and then
  // throws inside `settings/describe` — a failed Remote call that takes the
  // desktop shell's welcome window down with it. This plugin has no schemastery
  // to offer, so it must stay unselected.
  const selectSchema = (config) => (config !== undefined && 'toJSON' in config ? config : undefined)
  assert.equal(selectSchema(Config), undefined)
  assert.equal('toJSON' in Config, false)
  // And the crash signature it would produce, for the record.
  assert.throws(
    () => selectSchema(Object.assign({ '~standard': Config['~standard'] }, { toJSON: () => ({}) })).meta.volatile,
    { name: 'TypeError' },
  )
})

test('validation fills every default when nothing is configured', () => {
  assert.deepEqual(validateConfig(undefined), DEFAULTS)
  assert.deepEqual(validateConfig(null), DEFAULTS)
  assert.deepEqual(validateConfig({}), DEFAULTS)
})

test('validation accepts every field at its bounds', () => {
  const configured = {
    enabled: false,
    remember: false,
    restorePosition: false,
    minWidth: 200,
    minHeight: 20000,
    maxPosition: 0,
    saveDelayMs: 60000,
    trace: true,
  }
  assert.deepEqual(validateConfig(configured), configured)
})

test('validation reports the offending field through the schema', () => {
  const cases = [
    [{ remember: 'yes' }, 'remember', 'must be a boolean'],
    [{ minWidth: 199 }, 'minWidth', 'must be between 200 and 20000'],
    [{ saveDelayMs: 1.5 }, 'saveDelayMs', 'must be an integer'],
    [{ maxPosition: 100001 }, 'maxPosition', 'must be between 0 and 100000'],
  ]
  for (const [input, field, message] of cases) {
    assert.throws(() => validateConfig(input), new RegExp(message), JSON.stringify(input))
    const { issues, value } = Config['~standard'].validate(input)
    assert.equal(value, undefined)
    assert.equal(issues.length, 1)
    assert.deepEqual(issues[0].path, [field])
    assert.match(issues[0].message, new RegExp(message))
  }
  assert.throws(() => validateConfig([]), /config must be an object/u)
  assert.throws(() => validateConfig('x'), /config must be an object/u)
})

test('apply pushes exactly one head-script row', () => {
  const { ctx, listeners, routes } = stubContext()
  apply(ctx, undefined)
  assert.equal(listeners.length, 1)
  assert.equal(listeners[0].event, 'webserver/index-inject')
  assert.equal(routes.length, 0, 'the trace route stays unclaimed while tracing is off')
  const table = []
  listeners[0].listener(table)
  assert.equal(table.length, 1)
  assert.equal(table[0].kind, 'script')
  assert.equal(table[0].placement, 'head')
  assert.match(table[0].text, /localStorage/u)
  assert.match(table[0].text, /resizeTo/u)
  assert.match(table[0].text, new RegExp(`"storageKey":"${STORAGE_KEY}"`))
  assert.match(table[0].text, /"trace":false/u)
  assert.doesNotThrow(() => new Function(table[0].text))
  assert.deepEqual(runInjected(table[0].text).applied, [
    { kind: 'resize', width: 1000, height: 700 },
    { kind: 'move', x: 120, y: 90 },
  ])
})

test('an invalid entry config fails the plugin instead of running a silent default', () => {
  const { ctx } = stubContext()
  assert.throws(() => apply(ctx, { minWidth: 10 }), /must be between/u)
})

test('tracing claims the trace route and turns the reporter on', () => {
  const { ctx, listeners, routes } = stubContext()
  apply(ctx, { trace: true })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, TRACE_ROUTE)
  const table = []
  listeners[0].listener(table)
  assert.match(table[0].text, /"trace":true/u)
})

test('a disabled policy still mounts but resizes nothing', () => {
  const { ctx, listeners } = stubContext()
  apply(ctx, { enabled: false })
  const table = []
  listeners[0].listener(table)
  assert.deepEqual(runInjected(table[0].text).applied, [])
})

test('the trace log sits in the profile that hosts the plugin', () => {
  const logPath = traceLogPath()
  assert.ok(!logPath.includes('..'), 'the path is resolved, not relative')
  assert.equal(logPath, join(profileDir(), 'window-bounds-trace.log'))
  // A package resolves its profile as `<profile>/node_modules/<name>/lib/..`.
  assert.equal(profileDir(), resolve(import.meta.dirname, '..', '..', '..'))
})
