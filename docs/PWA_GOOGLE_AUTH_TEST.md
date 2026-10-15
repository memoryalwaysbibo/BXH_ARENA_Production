# iOS PWA Google Auth Test

This is a separate Firebase Hosting site for validating Google sign-in in iOS
standalone PWA mode. It does not change GitHub Pages or the `arena.bxh.com.tw`
DNS record. The test site uses the existing `bxh-arena` Firebase project and
its production backend; perform sign-in verification with the designated test
account only.

## One-time Hosting setup

Run these commands from a local checkout of this branch:

```sh
npm install
npx firebase login
npx firebase hosting:sites:create bxh-arena-pwa-auth-test --project bxh-arena
npx firebase target:apply hosting pwa-auth-test bxh-arena-pwa-auth-test --project bxh-arena
npx firebase deploy --only hosting:pwa-auth-test --project bxh-arena
```

The deploy target is `bxh-arena-pwa-auth-test.web.app`; it is separate from the
default Firebase Hosting site and from the production custom domain.

## Google Auth console setup

Before testing, add `bxh-arena-pwa-auth-test.web.app` to Firebase
Authentication's Authorized domains. In the Google OAuth client used by Firebase,
add this exact redirect URI:

`https://bxh-arena-pwa-auth-test.web.app/__/auth/handler`

Do not add or change custom domains or DNS records.

## Test

1. Open `https://bxh-arena-pwa-auth-test.web.app` in Safari and confirm the
   test site loads.
2. Add that URL to the iPhone Home Screen and open the installed app.
3. Use the designated linked Google test account. In standalone mode the app
   uses full-page redirect and serves Firebase's reserved auth helper from the
   same origin.
4. Confirm the user returns to the app and the existing account profile loads.
5. Separately confirm Safari browser sign-in still uses the popup flow.
6. Do not use Beta or deploy this target to the production custom domain.

## Rollback

This Hosting site is independent. It can be removed with
`npx firebase hosting:sites:delete bxh-arena-pwa-auth-test --project bxh-arena`;
no production DNS record needs to be reverted.
