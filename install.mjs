/**
 * Install dsh-window-bounds into the desktop profile of this machine.
 *
 * Prefer `dsh plugin --profile <profile> add flying4055/dsh-window-bounds`, or
 * the app's plugin panel, when the profile is not the Electron-owned desktop
 * one: that path installs the package, appends it to `dsh.profile.bundles`, and
 * its own `cordis.patch.yml` contributes the one mount row. This script exists
 * for the desktop profile, which the CLI refuses to operate on, and for
 * developing the plugin from a working tree.
 *
 * It registers the plugin exactly one way. A profile that already lists the
 * package in `dsh.profile.bundles` gets no patch entry, because the bundle's own
 * patch layer already inserts the row: two inserts compose the same entry twice
 * and the Cordis loader rejects the tree with
 * `duplicate loader entry id: window-bounds`. Only a profile without that bundle
 * gets the marker-delimited entry.
 *
 * Idempotent, and it backs up `cordis.patch.yml` before the first change.
 *
 * Usage:
 *   node install.mjs                 # %USERPROFILE%\.dsh or $DSH_HOME
 *   node install.mjs --uninstall     # remove the entry and the package, keep the backup
 *   node install.mjs --profile-dir <path>
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Marker lines bounding the entry this script owns in the patch layer. */
const BEGIN = '# >>> dsh-window-bounds (installed by plugins/dsh-window-bounds/install.mjs)'
const END = '# <<< dsh-window-bounds'

/** The entry a profile without the bundle needs. */
const ENTRY = `${BEGIN}
- insert:
    - id: window-bounds
      name: dsh-window-bounds
${END}
`

/** The package name this script installs and mounts. */
const PACKAGE = 'dsh-window-bounds'

/**
 * Resolve the dsh home the way the harness does.
 *
 * @returns the absolute dsh home directory.
 */
function dshHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured.trim() !== '' ? configured : join(homedir(), '.dsh')
}

/**
 * Read the command line.
 *
 * @param argv - process arguments after the script path.
 * @returns the requested mode and profile directory.
 */
function parseArgs(argv) {
  const options = { uninstall: false, profileDir: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--uninstall') options.uninstall = true
    else if (arg === '--profile-dir') {
      index += 1
      options.profileDir = argv[index]
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node install.mjs [--uninstall] [--profile-dir <path>]')
      process.exit(0)
    } else if (arg !== undefined) {
      console.error(`unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return options
}

/**
 * Remove this installer's entry from a patch document.
 *
 * @param text - current patch file text.
 * @returns the text without the entry, and whether anything was removed.
 */
function stripEntry(text) {
  const start = text.indexOf(BEGIN)
  if (start < 0) return { text, removed: false }
  const end = text.indexOf(END, start)
  if (end < 0) throw new Error('patch file has the dsh-window-bounds marker without its closing line')
  return { text: text.slice(0, start) + text.slice(end + END.length + 1), removed: true }
}

/**
 * Whether the profile already carries the plugin as a bundle layer.
 *
 * @param dir - profile directory.
 * @returns true when `dsh.profile.bundles` lists the package.
 */
function bundlesPlugin(dir) {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return false
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`${manifestPath} is not valid JSON`, { cause: error })
  }
  const bundles = manifest?.dsh?.profile?.bundles
  return Array.isArray(bundles) && bundles.includes(PACKAGE)
}

/**
 * Drop the package from `dsh.profile.bundles`.
 *
 * @param dir - profile directory.
 * @returns true when the manifest changed.
 */
function removeBundle(dir) {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return false
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.includes(PACKAGE)) return false
  manifest.dsh.profile.bundles = bundles.filter(name => name !== PACKAGE)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return true
}

const options = parseArgs(process.argv.slice(2))
const profileDir = options.profileDir === undefined
  ? join(dshHome(), 'profiles', 'desktop')
  : resolve(options.profileDir)
const patchPath = join(profileDir, 'cordis.patch.yml')
const manifestPath = join(profileDir, 'package.json')
const packageDir = join(profileDir, 'node_modules', PACKAGE)
const backupPath = `${patchPath}.before-dsh-window-bounds`

if (!existsSync(patchPath)) {
  console.error(`no profile patch at ${patchPath}`)
  console.error('Pass --profile-dir, or start the desktop app once so it creates the profile.')
  process.exit(1)
}

const current = readFileSync(patchPath, 'utf8')
const { text: withoutEntry, removed } = stripEntry(current)
const asBundle = bundlesPlugin(profileDir)

if (options.uninstall) {
  if (removed) writeFileSync(patchPath, withoutEntry)
  // Only an entry this script owns marks the registration as its own. A profile
  // the managed path registered (`dsh plugin add`, the app's plugin panel) keeps
  // its bundle list untouched.
  const unbundled = removed ? removeBundle(profileDir) : false
  rmSync(packageDir, { recursive: true, force: true })
  console.log(removed ? `removed the entry from ${patchPath}` : `no entry found in ${patchPath}`)
  if (unbundled) console.log(`removed ${PACKAGE} from ${manifestPath} bundles`)
  console.log(`removed ${packageDir}`)
  process.exit(0)
}

if (!existsSync(backupPath)) {
  copyFileSync(patchPath, backupPath)
  console.log(`backed up ${patchPath} -> ${backupPath}`)
}

rmSync(packageDir, { recursive: true, force: true })
mkdirSync(packageDir, { recursive: true })
for (const entry of ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'lib', 'locale', 'src']) {
  const from = join(import.meta.dirname, entry)
  if (!existsSync(from)) throw new Error(`missing plugin file: ${from}`)
  cpSync(from, join(packageDir, entry), { recursive: true })
}
console.log(`installed ${packageDir}`)

if (asBundle) {
  // The bundle layer's own patch already mounts the plugin. Writing the marker
  // entry as well would compose the entry twice.
  if (removed) {
    const trimmed = withoutEntry.replace(/\n{3,}/gu, '\n\n')
    writeFileSync(patchPath, trimmed)
    console.log(`removed the redundant patch entry from ${patchPath}`)
  }
  console.log(`mounted through ${manifestPath} bundles (${PACKAGE}); no patch entry written`)
} else {
  const next = withoutEntry.endsWith('\n') || withoutEntry === '' ? withoutEntry : `${withoutEntry}\n`
  writeFileSync(patchPath, `${next}${ENTRY}`)
  console.log(`mounted the entry in ${patchPath}`)
  console.log(`note: adding "${PACKAGE}" to dsh.profile.bundles in ${manifestPath} is the managed way to register it`)
}
console.log('Restart the DeepSeek Harness desktop app, then resize the window and relaunch to verify.')
