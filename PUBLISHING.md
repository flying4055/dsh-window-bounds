# Releasing dsh-window-bounds

The package is installable straight from GitHub, which is the supported channel;
publishing to the npm registry is optional and only shortens the install spec.

## Install from GitHub (current channel)

```sh
dsh plugin --profile <profile> add flying4055/dsh-window-bounds
```

## One-time setup for npm

```sh
npm login            # the account that will own the package
gh repo create dsh-window-bounds --public --source . --push
```

`dsh-window-bounds` was unclaimed on npm when this package was prepared. If it has
been taken since, either publish under a scope (`@you/dsh-window-bounds`, which
also needs `publishConfig.access: public`) or rename the package here and in
`cordis.patch.yml`.

## Every release

```sh
node --test tests/geometry.spec.js tests/host.spec.js
npm pack --dry-run                    # inspect the tarball before publishing
npm version patch                     # or minor / major
npm publish                           # only if publishing to npm
git push --follow-tags
```

`prepublishOnly` runs the test suite again, so a broken tarball cannot be
published.

A GitHub-only release is `npm version` plus `git push --follow-tags`; the install
spec `flying4055/dsh-window-bounds` follows the default branch, and a tag lets
users pin one (`flying4055/dsh-window-bounds#v0.1.1`).

## After publishing to npm

The plugin installs by package name instead of the GitHub spec:

```sh
dsh plugin --profile <profile> add dsh-window-bounds
```

For the desktop application, whose profile the CLI refuses to operate on, install
through the application's own plugin surface (Plugins → Add plugin) and enter the
spec.

## Versioning

The package targets the desktop shell's public surfaces only: the
`webserver/index-inject` event with its `{ kind: 'script' }` row, and
`window.resizeTo` / `window.moveTo` in the renderer. A shell release that removes
either needs a plugin release; the `peerDependencies` range records the framework
floor, not the shell version.
