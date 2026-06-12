# Releasing Arcora

Steps to cut a release. Two surfaces ship together: **published npm packages** (`@arcora/sdk`, `@arcora/sdk-react`) and the **hosted app** on Vercel.

> Git remote: `origin` points at **`github.com/arcoralabs/arcorapay`**. The Vercel project is still named `arc-fx-gateway` internally and its alias is unchanged — that's intentional; only the GitHub repo moved.

## 1. Pre-flight

```bash
git checkout plan-1-protocol
git pull --ff-only origin plan-1-protocol
pnpm install
pnpm -r build
pnpm -r test
```

All tests must pass before continuing.

## 2. Bump versions

For an x.y.z release, update `version` in:
- `packages/sdk/package.json`
- `packages/sdk-react/package.json`

Match versions across the two packages so a `npm i @arcora/sdk @arcora/sdk-react` always resolves a compatible pair. The `workspace:^` peer dependency on `@arcora/sdk` rewrites to a real version automatically at publish time.

## 3. Update CHANGELOG

Add a section to `CHANGELOG.md`:

```markdown
## [x.y.z] — YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...
```

## 4. Verify publish-ready

```bash
pnpm --filter @arcora/sdk publish --dry-run --no-git-checks
pnpm --filter @arcora/sdk-react publish --dry-run --no-git-checks
```

Confirm tarball contents include `dist/`, `LICENSE`, `README.md`, `package.json` and **nothing else**.

## 5. Commit + push

```bash
git add CHANGELOG.md packages/sdk/package.json packages/sdk-react/package.json
git commit -m "chore(release): vX.Y.Z"
git push origin plan-1-protocol
```

## 6. Publish to npm

First time only — create the npm org:

```bash
# user step, do once
npm login
# create the @arcora scope at https://www.npmjs.com/org/create
# enable 2FA on the account before publishing scoped packages
```

Then publish (requires 2FA on every release):

```bash
pnpm --filter @arcora/sdk publish --no-git-checks
pnpm --filter @arcora/sdk-react publish --no-git-checks
```

`pnpm` rewrites `workspace:^` to the actual version at publish time, so consumers receive a clean tarball with no `workspace:` references.

## 7. Deploy hosted app

GitHub is **not** connected to the Vercel project; the deploy is manual. The
project's Root Directory setting is `packages/app`, so run from the repo root
(running inside `packages/app` makes the CLI look for `packages/app/packages/app`):

```bash
vercel --prod --yes
```

The CLI reassigns the `arc-fx-gateway.vercel.app` alias to the new build. After the deploy:

- Hit `https://arc-fx-gateway.vercel.app` and confirm the version banner / commit SHA matches.
- Run a smoke invoice to verify the live deployment talks to the on-chain gateway and the VPS daemons pick it up.

## 8. Tag and GitHub release

```bash
git tag -a vX.Y.Z -m "Arcora vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG-X.Y.Z.md
```

(or copy the `## [x.y.z]` section out of `CHANGELOG.md` into the release body).

## 9. Verify

- `npm view @arcora/sdk version` matches the new tag.
- `npm view @arcora/sdk-react version` matches.
- The "Demo merchant" link in the README still works end-to-end (browser).

## Troubleshooting

- **`workspace:` shows up in the published tarball.** You used `npm publish` instead of `pnpm publish`. Re-publish with pnpm; npm doesn't rewrite workspace specifiers.
- **`403 Forbidden` from npm registry.** Either the `@arcora` scope isn't owned by your npm user, or 2FA wasn't supplied. Check `npm whoami` and `npm org ls arcora`.
- **Vercel deploy points at the wrong gateway address.** `.env.production.local` may carry a stale value; pull fresh with `vercel env pull --environment=production` before rebuilding VPS daemon `.env` files.
