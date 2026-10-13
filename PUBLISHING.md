# Releasing dsh-window-bounds

## One-time setup

```sh
npm login            # the account that will own the package
gh repo create dsh-window-bounds --public --source . --push
```

`dsh-window-bounds` was unclaimed on npm when this package was prepared. If it has
been taken since, either publish under a scope (`@you/dsh-window-bounds`, which
also needs `publishConfig.access: public`) or rename the package here and in
`cordis.patch.yml`.

Update `repository.url` in `package.json` to the repository you created.

## Every release

```sh
node --test tests/geometry.spec.js tests/host.spec.js
npm pack --dry-run                    # inspect the tarball before publishing
npm version patch                     # or minor / major
npm publish
git push --follow-tags
```

`prepublishOnly` runs the test suite again, so a broken tarball cannot be
published.

## After publishing

The plugin installs like any other bundle package:

```sh
dsh plugin --profile <profile> add dsh-window-bounds
```

For the desktop application, whose profile the CLI refuses to operate on, install
through the application's own plugin surface (Plugins → Add plugin) and enter
`dsh-window-bounds`.

## Versioning

The package targets the desktop shell's public surfaces only: the
`webserver/index-inject` event with its `{ kind: 'script' }` row, and
`window.resizeTo` / `window.moveTo` in the renderer. A shell release that removes
either needs a plugin release; the `peerDependencies` range records the framework
floor, not the shell version.
