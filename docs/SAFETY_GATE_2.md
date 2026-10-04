# BXH ARENA Safety Gate 2.0

Safety Gate 2.0 keeps the Production runtime checks blocking while avoiding unnecessary browser and emulator work for isolated changes.

## Automatic risk levels

| Level | Typical changes | Required checks |
| --- | --- | --- |
| LOW | Documentation, text records, isolated non-E2E tests | Production invariants and fixed Critical Regression |
| MEDIUM | Low-coupling JavaScript, CSS, HTML, visual assets | LOW checks plus Desktop, iPhone, and Android UI Smoke |
| HIGH | Core, Auth, Cloud/Firebase, Rules, bracket/scoring, dependencies, E2E, workflows | MEDIUM checks plus Critical Emulator E2E and Deep Emulator E2E |

Unknown or empty change lists fail safe to HIGH. A manual override is available only through workflow dispatch for acceptance testing.

## Failure handling

UI Smoke, Critical Emulator E2E, and Deep Emulator E2E each receive one controlled retry.

- First failure followed by success: recorded as `TEST_FLAKY_RECOVERED`.
- Two consecutive failures: blocking `CODE_FAIL_OR_INFRA_FAIL`.
- A newer run supersedes an older run through workflow concurrency.

## Deployment boundary

Production Pages remains a single-writer resource. Deployment starts only after the risk-appropriate Validate workflow succeeds, checks that the validated commit is still the current `main` HEAD, and verifies the public `version.json`, `index.html`, Core, and cloud runtime SHA-256 values after deployment.

Nightly and manual full Deep Emulator regression remain available independently.
