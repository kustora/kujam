# Security Policy

This policy covers the `@kujam/*` packages in `packages/`, the examples in `examples/` (including the sample Hocuspocus server), and the playground in `apps/playground` (BOARD-2007).

## Supported versions

| Version                                  | Supported                  |
| ---------------------------------------- | -------------------------- |
| `main` branch (not yet published to npm) | Yes                        |
| `0.x` after release: latest minor        | Yes, fixes ship in a patch |
| Older `0.x`                              | No                         |

Until `1.0`, security fixes are made only for the latest minor release. After `1.0`, the latest major and the previous major receive fixes for six months.

## Reporting a vulnerability

**Do not open a public issue, pull request, or discussion for a vulnerability.**

1. Report it privately on GitHub: open the **Security** tab, then **Report a vulnerability** ([create a report](https://github.com/kustora/kujam/security/advisories/new)). Only maintainers can see the report.
2. If you cannot use GitHub, send a direct message to the packages' technical owner, [@riziq](https://github.com/riziq) (ADR-002), and ask for a private channel. Do not share technical details on a public channel.

Include, where available:

- the affected package and version or commit;
- the kind of issue (for example XSS through rich text, unvalidated peer data, a read-only mode bypass) and its impact;
- minimal reproduction steps, or the document or update that triggers it;
- a suggested fix or mitigation, if any.

## Process

| Stage                             | Target                              |
| --------------------------------- | ----------------------------------- |
| Acknowledge the report            | 3 business days                     |
| Initial assessment and severity   | 7 business days                     |
| Fix for critical or high severity | 30 days                             |
| Fix for medium or low severity    | Next minor release, at most 90 days |

Severity follows CVSS 3.1. Reporters hear from us at every stage. Once a fix is released, we publish a GitHub Security Advisory (with a CVE when appropriate), note it in `CHANGELOG.md`, and credit the reporter if they wish. We ask for coordinated disclosure: details stay private until a fix is available or 90 days after the report, whichever comes first.

## Scope

In scope:

- script or HTML execution that gets past sanitization (rich text, `render.html`, SVG export, iframe embeds);
- peer or server data that bypasses validation (`validateBoardRecord`, presence validation, `maxUpdateBytes`);
- read-only clients or view-only tokens that can change a document;
- leaking element data without access through resolvers, export, search, or thumbnails;
- vulnerabilities in dependencies that are actually exploitable through these packages.

Out of scope:

- application code that uses the API unsafely, for example a plugin that inserts unsanitized HTML;
- the sample server running with its development-only mock tokens;
- attacks that require an already compromised device or browser.

The full threat model is in [ADR-009](docs/adr/ADR-009-threat-model.md), and Content Security Policy guidance is in [docs/csp.md](docs/csp.md).

## Dependencies

Dependabot checks npm (pnpm) dependencies, GitHub Actions, and the sample server's Docker image every week (`.github/dependabot.yml`). Dependabot security alerts open pull requests immediately, outside that schedule. License and bundle-size checks for new dependencies in CI are planned in BOARD-108 and BOARD-109 but are not active yet.
