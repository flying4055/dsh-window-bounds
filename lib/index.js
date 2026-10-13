/**
 * dsh-window-bounds — host half.
 *
 * The desktop shell creates its main window at a fixed size and offers no IPC
 * channel for window geometry, so the only place a plugin can restore a window
 * size is the renderer that owns the window. This half contributes the head
 * script that does it, through the webserver's structured index injection
 * table.
 *
 * Geometry lives in the page's `localStorage` under the `dsh-app://app` origin,
 * which survives restarts and shell updates. The only file this plugin owns is
 * the trace log described by {@link traceLogPath}.
 *
 * @module dsh-window-bounds
 */

import { appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { windowBoundsScript } from '../src/script.js'

/** Stable Cordis plugin name. */
export const name = 'dsh-window-bounds'

/** The injection table reaches the page through the webserver. */
export const inject = ['webServer']

/** Default geometry policy, used for every field a caller does not set. */
export const DEFAULTS = {
  enabled: true,
  remember: true,
  restorePosition: true,
  minWidth: 480,
  minHeight: 360,
  maxPosition: 8000,
  saveDelayMs: 400,
  trace: false,
}

/**
 * `localStorage` key owning the saved geometry on the `dsh-app://app` origin.
 */
export const STORAGE_KEY = 'dsh-window-bounds:v1'

/** Path the injected script posts trace payloads to. */
export const TRACE_ROUTE = '/window-bounds/trace'

/**
 * One field description, read both by {@link validateConfig} and by the JSON
 * Schema projection in {@link Config}. `type` is the JSON Schema spelling, so a
 * form renders from it without this plugin owning any presentation.
 */
const SCHEMA = {
  enabled: {
    type: 'boolean',
    default: DEFAULTS.enabled,
    description: 'Restore the saved window size and position at startup.',
  },
  remember: {
    type: 'boolean',
    default: DEFAULTS.remember,
    description: 'Save changed window bounds for the next launch.',
  },
  restorePosition: {
    type: 'boolean',
    default: DEFAULTS.restorePosition,
    description: 'Restore the saved window position, not only its size.',
  },
  minWidth: {
    type: 'integer',
    minimum: 200,
    maximum: 20000,
    default: DEFAULTS.minWidth,
    description: 'Smallest restorable window width in pixels.',
  },
  minHeight: {
    type: 'integer',
    minimum: 200,
    maximum: 20000,
    default: DEFAULTS.minHeight,
    description: 'Smallest restorable window height in pixels.',
  },
  maxPosition: {
    type: 'integer',
    minimum: 0,
    maximum: 100000,
    default: DEFAULTS.maxPosition,
    description: 'Largest absolute saved x or y; beyond it the position is dropped.',
  },
  saveDelayMs: {
    type: 'integer',
    minimum: 0,
    maximum: 60000,
    default: DEFAULTS.saveDelayMs,
    description: 'Debounce delay in milliseconds before changed bounds are saved.',
  },
  trace: {
    type: 'boolean',
    default: DEFAULTS.trace,
    description: 'Append what the page measured to window-bounds-trace.log.',
  },
}

/**
 * Profile directory this plugin was installed into, derived from its own
 * location (`<profile>/node_modules/dsh-window-bounds/lib/index.js`) so the same
 * package works in a profile another deployment names differently.
 *
 * @returns the absolute profile directory.
 */
export function profileDir() {
  return resolve(import.meta.dirname, '..', '..', '..')
}

/**
 * Path of the trace log written while `trace` is on.
 *
 * @returns the absolute trace log path.
 */
export function traceLogPath() {
  return join(profileDir(), 'window-bounds-trace.log')
}

/**
 * Apply the schema defaults and reject values the schema forbids.
 *
 * @param input - raw config from the loader.
 * @returns the validated config with every field present.
 * @throws {TypeError} when a supplied value does not fit its field.
 */
export function validateConfig(input) {
  const raw = input === undefined || input === null ? {} : input
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('config must be an object')
  const config = {}
  for (const [field, description] of Object.entries(SCHEMA)) {
    const value = raw[field]
    if (value === undefined) {
      config[field] = description.default
      continue
    }
    if (description.type === 'boolean') {
      if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`)
    } else if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${field} must be an integer`)
    } else if (value < description.minimum || value > description.maximum) {
      throw new TypeError(`${field} must be between ${description.minimum} and ${description.maximum}`)
    }
    config[field] = value
  }
  return config
}

/**
 * Standard Schema view of the configuration, which the loader validates against
 * and the settings surface projects into a form.
 *
 * This plugin declares its own schema instead of importing a schema library on
 * purpose: the desktop profile has no `@deepseek-ai` packages of its own, and the
 * runtime keeps its dependency tree inside `app.asar`, so a bare
 * `@deepseek-ai/schemastery` import would resolve through whatever global dsh
 * install happens to be on the machine.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-window-bounds',
    /**
     * Validate one raw config.
     *
     * @param input - raw config from the loader.
     * @returns the validated value, or issues naming the offending field.
     */
    validate(input) {
      try {
        return { value: validateConfig(input) }
      } catch (error) {
        const field = String(error.message).split(' ')[0]
        return { issues: [{ message: error.message, path: [field] }] }
      }
    },
  },
  /**
   * JSON Schema projection of the configuration.
   *
   * @returns the object schema with one property per field.
   */
  toJSON() {
    return { type: 'object', additionalProperties: false, properties: SCHEMA }
  },
}

/**
 * Record one trace payload the page posted.
 *
 * @param body - raw request body, expected to be JSON.
 * @param logPath - file to append the record to.
 * @returns a short outcome for the response body.
 */
export function recordTrace(body, logPath) {
  const line = typeof body === 'string' && body.trim() !== '' ? body.trim() : '<empty>'
  appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`)
  return 'recorded'
}

/**
 * Contribute the restore-and-save script to every served index response.
 *
 * While `trace` is on, the plugin also claims a route the script posts its
 * observations to. The packaged shell exposes no console, so that log is the
 * only way to see what the page actually measured.
 *
 * @param ctx - Cordis context with the required `webServer` service.
 * @param config - entry config from the loader, validated here.
 */
export function apply(ctx, config) {
  const policy = validateConfig(config)
  const script = windowBoundsScript({
    enabled: policy.enabled,
    remember: policy.remember,
    trace: policy.trace,
    traceUrl: TRACE_ROUTE,
    storageKey: STORAGE_KEY,
    saveDelayMs: policy.saveDelayMs,
    restorePosition: policy.restorePosition,
    minWidth: policy.minWidth,
    minHeight: policy.minHeight,
    maxPosition: policy.maxPosition,
  })
  ctx.effect(() => {
    /** Push this plugin's row into the per-response injection table. */
    return ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'script', placement: 'head', text: script })
    })
  }, 'dsh-window-bounds: index injection')
  if (!policy.trace) return
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TRACE_ROUTE,
    handler: (request, response) => {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        try {
          recordTrace(Buffer.concat(chunks).toString('utf8'), traceLogPath())
        } catch (error) {
          response.writeHead(500).end(String(error))
          return
        }
        response.writeHead(204).end()
      })
    },
  }), 'dsh-window-bounds: trace route')
}
