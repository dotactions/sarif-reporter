# SARIF Reporter

Turns any SARIF file (Trivy, Semgrep, CodeQL, Grype, …) into readable feedback, without GitHub Advanced Security:

- **Tracking issue for scheduled scans**: with `manage-issue`, one issue is opened when findings appear, updated while they persist, and closed when they're gone. Nightly scans have no PR to comment on; this is where their results go. It only acts on `schedule`, `push` and `workflow_dispatch` runs on the default branch (anything else logs a warning and skips), finds its issue by a hidden marker derived from `comment-tag` (removing the label doesn't orphan it), and fails the step if a GitHub API call fails.
- **Sticky PR comment**: one comment per `comment-tag`, updated in place on every push.
- **Job summary** with a shields.io badge and a findings table.
- Optionally **fails the job** on findings.

## Usage

```yaml
- name: Run Trivy
  uses: aquasecurity/trivy-action@<sha> # v0.36.0
  with:
      format: sarif
      output: trivy.sarif

- name: Report
  uses: dotactions/sarif-reporter@v1
  if: always() && hashFiles('trivy.sarif') != ''
  with:
      title: "Trivy Vulnerability Report"
      sarif-file: "trivy.sarif"
      comment-tag: "trivy"
      fail-on-findings: ${{ github.event_name == 'pull_request' }}
      manage-issue: ${{ github.event_name == 'schedule' }}
```

For a ready-made Trivy workflow, see [`dotactions/security`](https://github.com/dotactions/security).

## Permissions Required

```yaml
permissions:
    contents: read
    pull-requests: write # for sticky PR comments
    issues: write # for automated issue management
```

## Inputs

| Name               | Description                                           | Required | Default                                              |
| :----------------- | :---------------------------------------------------- | :------- | :--------------------------------------------------- |
| `sarif-file`       | Path to SARIF output file                             | Yes      | -                                                    |
| `title`            | Header title in report                                | No       | `"Security Scan Report"`                             |
| `comment-tag`      | Identifier tag for sticky PR comments & issue markers | No       | `"security-report"`                                  |
| `badge-label`      | Label text for shields.io badge                       | No       | `"Security"`                                         |
| `github-token`     | Token with PR and issues write permissions            | No       | `${{ github.token }}`                                |
| `fail-on-findings` | Fail step if findings are detected                    | No       | `"false"`                                            |
| `manage-issue`     | Create/update/close issue; default-branch audits only | No       | `"false"`                                            |
| `issue-title`      | Title of automated GitHub issue                       | No       | `"[Security Audit] Active Vulnerabilities Detected"` |

## Outputs

| Name             | Description                                      |
| :--------------- | :----------------------------------------------- |
| `total-findings` | Total number of non-suppressed findings detected |
| `report-file`    | Path to the generated Markdown report file       |

## Versioning

Pin the **full commit SHA** of a release tag, with the version in a comment, or a floating tag:

```yaml
uses: dotactions/sarif-reporter@<40-char-sha> # v1.0.0
uses: dotactions/sarif-reporter@v1
```

Resolve a SHA with `git ls-remote https://github.com/dotactions/sarif-reporter 'refs/tags/v1.0.0^{}'`. Pin release-tag SHAs, not `main` SHAs.

| Ref | Moves on | Use |
| :-- | :-- | :-- |
| `@<sha>` | never | **Recommended**: immutable, full reproducibility |
| `@v1` | every `1.x` release | Features and fixes, no breaking changes |
| `@v1.0.0` | never (tag can be moved) | Readable, but tags are mutable |

Release notes: [GitHub Releases](https://github.com/dotactions/sarif-reporter/releases).

## Releasing (maintainers)

This action is listed on the GitHub Marketplace, so releases are made in the web UI (the Marketplace checkbox only exists there), not with a Release workflow.

1. Merge to `main` with conventional-commit PR titles; they become the release notes.
2. Go to **Releases → Draft a new release**, create the tag `vX.Y.Z` on `main`, click **Generate release notes**, tick **Publish this Action to the GitHub Marketplace** and publish. For a pre-release (`vX.Y.Z-rc.1`), tick **Set as a pre-release** instead.
3. `internal-floating-tags.yml` then moves `v1` to the new tag (forward only; pre-releases move nothing).

The tagged commit is the plain `main` commit, so `dist/` must be up to date there (`internal-check-dist.yml` guards that) and the repo must never gain `@main` self-references: nothing rewrites them.

Bump the **major** version for breaking changes, the **minor** for features, the **patch** for fixes.
