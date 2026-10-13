/**
 * Geometry policy for the window-bounds memory plugin.
 *
 * The injected head script needs this policy inline (it is serialized into the
 * served HTML and cannot import), so this module exists to own the rules as
 * testable code and to keep the script's copy honest. A unit test evaluates the
 * script's own `resolve` against the same table used here.
 *
 * @module dsh-window-bounds/geometry
 */

/** One saved window geometry as read back from storage. */
export const STORED_FIELDS = ['x', 'y', 'width', 'height']

/** Display work area the saved geometry is resolved against. */
export const SCREEN_FIELDS = ['availWidth', 'availHeight', 'availLeft', 'availTop']

/**
 * Whether a stored value can be trusted as a finite coordinate or length.
 *
 * @param value - value read from storage.
 * @returns true when the value is a finite number.
 */
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Parse raw storage text into a candidate geometry, or `null` when the text is
 * absent, not JSON, or not an object.
 *
 * @param raw - the raw `localStorage` value.
 * @returns the parsed candidate, or `null`.
 */
export function parseStored(raw) {
  if (typeof raw !== 'string') return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed
}

/**
 * Resolve a stored geometry against the current display.
 *
 * Size is kept only above the configured minimum and is shrunk to fit the work
 * area; position is kept only when the saved spot still lies inside the work
 * area, so a disconnected or rearranged display cannot hide the window. A
 * missing or unusable size yields `null`, which leaves the shell default.
 *
 * @param stored - candidate geometry from storage.
 * @param screenInfo - current display work area.
 * @param options - restore policy.
 * @param options.minWidth - smallest restorable width.
 * @param options.minHeight - smallest restorable height.
 * @param options.maxPosition - absolute pixel bound for a restorable x or y.
 * @param options.restorePosition - whether a saved position is applied.
 * @returns the geometry to apply, or `null` when nothing is restorable.
 */
export function resolveBounds(stored, screenInfo, options) {
  if (stored === null || typeof stored !== 'object') return null
  if (!isFiniteNumber(stored.width) || !isFiniteNumber(stored.height)) return null
  if (stored.width < options.minWidth || stored.height < options.minHeight) return null

  const availWidth = isFiniteNumber(screenInfo?.availWidth) && screenInfo.availWidth > 0
    ? screenInfo.availWidth
    : null
  const availHeight = isFiniteNumber(screenInfo?.availHeight) && screenInfo.availHeight > 0
    ? screenInfo.availHeight
    : null

  const bounds = {
    width: availWidth === null ? stored.width : Math.min(stored.width, availWidth),
    height: availHeight === null ? stored.height : Math.min(stored.height, availHeight),
  }

  if (!options.restorePosition) return bounds
  if (!isFiniteNumber(stored.x) || !isFiniteNumber(stored.y)) return bounds
  if (Math.abs(stored.x) > options.maxPosition || Math.abs(stored.y) > options.maxPosition) {
    return bounds
  }

  const availLeft = isFiniteNumber(screenInfo?.availLeft) ? screenInfo.availLeft : 0
  const availTop = isFiniteNumber(screenInfo?.availTop) ? screenInfo.availTop : 0
  const left = stored.x - availLeft
  const top = stored.y - availTop
  if (left < 0 || top < 0) return bounds
  if (availWidth !== null && left + bounds.width > availWidth) return bounds
  if (availHeight !== null && top + bounds.height > availHeight) return bounds

  return { x: stored.x, y: stored.y, ...bounds }
}
