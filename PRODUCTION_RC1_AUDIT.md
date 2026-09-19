# BXH ARENA Production Frontend RC1

- Target Firebase project: `bxh-arena`
- Target domain: `arena.bxh.com.tw`
- Authentication at launch: Email/Password only
- Self-service player creation: `role=player`
- Google OAuth runtime: disabled
- Tester accounts: managed sandbox only
- Firestore Rules / Cloud Functions: maintained in the separate Production backend repository
- Background scheduled business actions remain gated by `systemSettings/releaseControls.backgroundJobsEnabled === true`

The frontend source in this repository was generated from the validated Production RC1 candidate and has not enabled background jobs.
