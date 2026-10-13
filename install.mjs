/**
 * Install dsh-window-bounds into the desktop profile of this machine.
 *
 * The desktop profile is owned by the Electron application, which refuses CLI
 * operations on it (`dsh plugin --profile desktop`), so installation here means
 * exactly what the plugin marketplace does: place the package in the profile's
 * node_modules and add one insert entry to the profile patch layer.
 *
 * Idempotent, and it backs up `cordis.patch.yml` before the first change.
 *
 * Usage:
 *   node install.mjs                 # %USERPROFILE%\.dsh or $DSH_HOME
 *   node install.mjs --uninstall     # remove the entry, keep the backup
 *   node install.mjs --profile-dir <path>
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Marker lines bounding the entry this script owns in the patch layer. */
const BEGIN = '# >>> dsh-window-bounds (installed by plugins/dsh-window-bounds/install.mjs)'
const END = '# <<< dsh-window-bounds'

/** The entry the profile patch layer mounts. */
const ENTRY = `${BEGIN}
- insert:
    - id: window-bounds
      name: dsh-window-bounds
${END}
`

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

const options = parseArgs(process.argv.slice(2))
const profileDir = options.profileDir === undefined
  ? join(dshHome(), 'profiles', 'desktop')
  : resolve(options.profileDir)
const patchPath = join(profileDir, 'cordis.patch.yml')
const packageDir = join(profileDir, 'node_modules', 'dsh-window-bounds')
const backupPath = `${patchPath}.before-dsh-window-bounds`

if (!existsSync(patchPath)) {
  console.error(`no profile patch at ${patchPath}`)
  console.error('Pass --profile-dir, or start the desktop app once so it creates the profile.')
  process.exit(1)
}

const current = readFileSync(patchPath, 'utf8')
const { text: withoutEntry, removed } = stripEntry(current)

if (options.uninstall) {
  if (removed) writeFileSync(patchPath, withoutEntry)
  rmSync(packageDir, { recursive: true, force: true })
  console.log(removed ? `removed the entry from ${patchPath}` : `no entry found in ${patchPath}`)
  console.log(`removed ${packageDir}`)
  process.exit(0)
}

if (!existsSync(backupPath)) {
  copyFileSync(patchPath, backupPath)
  console.log(`backed up ${patchPath} -> ${backupPath}`)
}

rmSync(packageDir, { recursive: true, force: true })
mkdirSync(packageDir, { recursive: true })
for (const entry of ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'lib', 'src']) {
  const from = join(import.meta.dirname, entry)
  if (!existsSync(from)) throw new Error(`missing plugin file: ${from}`)
  cpSync(from, join(packageDir, entry), { recursive: true })
}
console.log(`installed ${packageDir}`)

const next = withoutEntry.endsWith('\n') || withoutEntry === '' ? withoutEntry : `${withoutEntry}\n`
writeFileSync(patchPath, `${next}${ENTRY}`)
console.log(`mounted the entry in ${patchPath}`)
console.log('Restart the DeepSeek Harness desktop app, then resize the window and relaunch to verify.')
