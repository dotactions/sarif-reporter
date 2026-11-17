# Agents Rules for dotactions/sarif-reporter

A JavaScript action, listed on the GitHub Marketplace, that turns any SARIF file into a job summary with a badge and a sticky PR comment, and opens or closes a tracking issue for scheduled scans. Strangers depend on it, so correctness and API stability outrank convenience.

## CRITICAL INSTRUCTIONS

1. **The Ponytail Workflow (Default Execution Mode)**:
    - Climb the senior dev ladder: YAGNI -> Reuse -> Stdlib -> Platform -> Deps -> Simplicity -> Minimal Diff.
    - Deletion over addition. Boring over clever.
    - Mark intentional simplifications with `ponytail:` comments (`# ponytail:` in YAML/shell/PowerShell, `// ponytail:` in TypeScript) naming the known ceiling and upgrade path.
    - Non-trivial logic must leave behind at least one runnable check (see [Testing](#testing)).

2. **Commit Policy**:
    - AI assistants are strictly prohibited from generating, suggesting, or running git commits, pushes, tags, or releases under any circumstance. Commits and releases are human-only.

3. **Plan Execution Policy**:
    - **Never** proceed to code changes or implementation commands directly from a plan unless the human developer explicitly replies with direct authorization (e.g., "go ahead", "approved", "execute").
    - A plan is strictly for review. Keep your hands off the files until permission is explicitly given.

4. **Comments & Standards**:
    - Strictly NO inline comments explaining syntax or obvious actions. Comments explain _why_ (constraints, GitHub quirks, security reasons), never _what_.
    - Ceiling of 300 lines per file (excluding `README.md`, lockfiles, fixtures and `dist/`). Always ask before performing major file splits or autonomous refactoring.
    - Package manager is strictly `pnpm`.

## Repository Layout

| Path | Purpose |
| :--- | :--- |
| `action.yml` | The action. Must stay at the repo root (Marketplace requirement) |
| `src/` → `dist/index.cjs` | TypeScript source, bundled by `tsup` into committed `dist/` |
| `README.md` | Also the Marketplace listing page |
| `.github/workflows/internal-test.yml` | Tests the action via `uses: ./` against `tests/fixtures/*.sarif` |
| `.github/workflows/internal-check-dist.yml` | Fails when `dist/` drifts from `src/` |
| `.github/workflows/internal-security-audit.yml` | Trivy scan of this repo, reported with `uses: ./` |
| `.github/workflows/internal-*.yml` | Other thin callers of `dotactions/tooling` |

## Pinning & References

- Every third-party `uses:` is pinned to a full commit SHA with a version comment: `uses: owner/repo@<40-char-sha> # vX.Y.Z`. Resolve SHAs with `git ls-remote --tags`; never guess or invent one. If you cannot resolve it, stop and ask.
- Another `dotactions` repo is pinned the same way, to the commit of its **release tag** (`git ls-remote https://github.com/dotactions/<repo> 'refs/tags/vX.Y.Z^{}'`), never to a `main` SHA: only release commits have their own `@main` self-references rewritten. `internal-check-refs.yml` fails on anything else.
- This repo's only action is the root one, tested via `uses: ./`. It has no `@main` self-references.

## Shared CI (`dotactions/tooling`)

- `internal-release.yml`, `internal-check-refs.yml`, `internal-actionlint.yml`, `internal-lint.yml` are thin callers of `dotactions/tooling/.github/workflows/*.yml`. They only hold `on:`/`paths:`, `permissions:` and `with:`. Logic changes go to `tooling`, not here.
- Callers never declare `concurrency:`; the called workflow does, and an identical group in caller and callee deadlocks.

## Security

- Never interpolate `${{ }}` directly into `run:`. Pass values through `env:` and reference `"$VAR"`.
- Validate inputs early and fail with `core.setFailed` / `::error::` messages naming the allowed values.
- Workflows declare `permissions: contents: read` at the top level and widen per job only where required.
- The action needs only the permissions it documents (`pull-requests: write` for the comment, `issues: write` for `manage-issue`). Never widen that.

## TypeScript

- After changing anything in `src/`, run `pnpm build` and include the regenerated `dist/`. `internal-check-dist.yml` fails on drift.
- Run `pnpm check-types` before finishing. No `any` without a `// ponytail:` justification.

## Public API & Versioning

- Inputs, outputs, input defaults, the comment marker (`comment-tag`) format and the issue title/body matching are public API. Changing any of them is a **breaking change**: flag it explicitly so the human can bump the major version.
- Every public input/output change must be reflected in `README.md` (tables + usage examples).
- Releases are cut only by the human via the `Release` workflow (`internal-release.yml`), which also publishes to the Marketplace. Never create or move tags.

## Testing

- Behaviour is tested via `uses: ./` in `internal-test.yml`, with assertions on outputs and the report file. Add a case (and a SARIF fixture if needed) for every behavioural change.
- Local checks before finishing (run whichever apply):
    - `pnpm check-types && pnpm build` (no diff in `dist/`)
    - `pnpm prettier --check .`
    - `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12` for workflow changes
- Report honestly which checks ran and which could not (PR comment and issue handling only run in CI).
