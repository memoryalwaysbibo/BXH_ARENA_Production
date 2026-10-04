# BXH ARENA Firebase Auth same-origin proxy

This Cloudflare Worker forwards only Firebase Auth helper requests for BXH ARENA.
It is required before switching the production Firebase `authDomain` from
`bxh-arena.firebaseapp.com` to `arena.bxh.com.tw` for iOS PWA redirect sign-in.

## Important deployment order

1. Confirm `bxh.com.tw` is managed by Cloudflare and `arena.bxh.com.tw` is
   proxied through Cloudflare. Do not change DNS records or the Pages origin.
2. Deploy this Worker to the two routes in `wrangler.toml`.
3. Verify these same-origin endpoints return Firebase helper content:
   - `https://arena.bxh.com.tw/__/auth/iframe`
   - `https://arena.bxh.com.tw/__/firebase/init.json`
4. In Firebase Authentication, add `arena.bxh.com.tw` to Authorized domains.
5. In the Google OAuth client used by Firebase, add
   `https://arena.bxh.com.tw/__/auth/handler` as an authorized redirect URI.
6. Only after those checks pass, update the app's `authDomain` to
   `arena.bxh.com.tw` and enable redirect sign-in for iOS standalone PWA.
7. Test Safari browser and installed PWA independently before production rollout.

The worker is intentionally not wired into the production app yet. Changing
`authDomain` before the worker and provider settings are ready can break the
currently working Safari web flow.

## Deploy

From this directory, with Cloudflare Wrangler authenticated to the BXH zone:

```sh
npx wrangler deploy
```

The worker has no secrets or environment variables. Its upstream is fixed to
`https://bxh-arena.firebaseapp.com`, and every other path is rejected.
