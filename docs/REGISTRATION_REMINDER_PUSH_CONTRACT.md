# Registration Reminder Push Contract

Status: RC / backend integration pending

## Goal
Reuse the existing BXH CALL Firebase Web Push registration. A player opts in per tournament; no second notification permission or FCM token store is introduced.

## Preference document
Logical key: `registrationReminders/{uid_eventId}`

Required fields:
- `uid: string`
- `eventId: string`
- `enabled: boolean`
- `reminderMinutes: 60 | 30 | 10 | 0`
- `registrationOpenAt: timestamp`
- `updatedAt: server timestamp`

Server-owned delivery fields:
- `sentForOpenAt: timestamp | null`
- `sentAt: timestamp | null`

## Delivery eligibility
Send only when all are true:
1. enabled is true.
2. registrationOpenAt is still the tournament's current authoritative registration-open time.
3. now is at/after registrationOpenAt - reminderMinutes and before registrationOpenAt + 5 minutes.
4. sentForOpenAt != registrationOpenAt.
5. the player still has at least one valid registered Web Push token from the existing BXH CALL push registration.

If registrationOpenAt changes, the new timestamp forms a new delivery cycle. Disabling the preference prevents future sends.

## FCM data payload
All values are strings.

- kind: `registration-reminder`
- title: `BXH 報名提醒`
- body: event-specific copy
- eventId
- openAt: ISO-8601
- reminderMinutes: `60|30|10|0`
- url: same-origin ARENA tournament deep link

The Service Worker must reject cross-origin click URLs through its existing same-origin guard.

## Idempotency
Canonical dedupe key:
`registration-reminder:{uid}:{eventId}:{registrationOpenAtMillis}:{reminderMinutes}`

The backend must atomically claim/send a reminder so scheduler retries cannot generate duplicate pushes.

## Compatibility
Court-call payloads remain unchanged. Unknown/missing kind defaults to court-call behavior.
