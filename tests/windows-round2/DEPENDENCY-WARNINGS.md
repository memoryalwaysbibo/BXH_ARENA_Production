# Warning review before isolated Windows round 2

Actual first-round logs: Node 22.23.2 Windows, npm10.9.8. These warnings were not audit findings or proof of exploitation.

Runtime/tool dependencies:
- Firebase CLI14.27.0 -> tar6.2.1 directly (^6.1.11); node-gyp also has a separate tar7.5.23. tar6 warning explicitly mentions known vulnerabilities. CLI source imports tar in archiveDirectory.js, a tool/archive path, not ARENA scoring SDK. This test uses repository-controlled synthetic source and a separately SHA256-verified JAR; no untrusted application archive supplied. No claim that CLI is vulnerability-free.
- glob10.5.0 is used by CLI appUtils/listFiles and archiver-utils, exegesis, rimraf. Warning mentions known vulnerabilities; current local scope uses trusted repository fixture paths, no user-supplied patterns or shell invocation of glob. Not an advisory-level exploitability assessment.
- json-ptr3.1.1 via exegesis is unsupported.
- uuid8.3.2 (CLI root) and uuid9.0.1 (gaxios), node-domexception1.0.0 are deprecated. Function candidate also has uuid9.0.1/node-domexception1.0.0. They are not solely CI setup actions.
- The Node22-compatible override is restricted to functions candidate database-compat2.1.7/database1.1.5. No production dependencies changed.

Setup-only warnings:
- setup-java v4 deprecated; action code and checkout/setup-node/upload-artifact v4 target Node20 but hosted runner forces actions themselves to Node24. This is distinct from test application process Node22.23.2, verified by inspect.cjs. Round2 uses the same reviewed SHA-pinned actions; no unrelated upgrades bundled.
- punycode/URL parsing warnings originate in action processes; not evidence that the demo app ran on Node24.

Boundary: no newly confirmed exploit blocker from these warnings alone; not a security clearance. Review current advisories and supported CLI/action migration before any distributable or release. This isolated test starts only fixed demo loopback services, no credentials/cloud data and no external clients.

CLI source getLatestSDKVersion spawns npm show firebase-functions --json=true. The documented npm_config_offline=true is set before CLI startup, so this optional lookup can only use its genuine cache or fail nonfatally. The approved Firebase MOTD GET remains normal; no fake cache, CLI patch, endpoint reroute, or online npm metadata retry is used.
