# P7.11A｜Event Info V2 Compatibility Layer

## Goal

Introduce a structured event-information model for AI Create, templates, venue navigation and poster parsing without replacing the existing BXH ARENA tournament engine.

## Authority during P7.11A

- `state.meta` remains the runtime source of truth.
- `state.eventInfo` is a structured shadow model.
- Before persistence, legacy values are mirrored into Event Info V2.
- No existing match, bracket, referee, ladder, registration or public rendering flow reads Event Info V2 yet.
- Applying Event Info V2 back to legacy fields requires an explicit call to `applyEventInfoV2ToLegacy()`; P7.11A never calls it automatically.

## Schema

`state.eventInfo.schemaVersion = "bxh.event-info.v2"`

Sections:

- `basic`: name, date, organizer
- `schedule`: check-in start/end, event start/end
- `venue`: venue name, address, Google Maps URL, navigation flag, legacy location text
- `registration`: enabled, open/close time, capacity, waitlist, fee, target group
- `prizes`: future structured prize list
- `content`: custom event description and special notes
- `standardTemplate`: enabled, templateId, version, immutable snapshot
- `source`: manual/text/poster source metadata for future AI workflows

## Legacy mapping

P7.11A mirrors the currently-supported legacy fields:

- `meta.name -> eventInfo.basic.name`
- `meta.date -> eventInfo.basic.date`
- `meta.location -> eventInfo.venue`
- `meta.checkin -> eventInfo.schedule.checkInStart`
- `meta.startTime -> eventInfo.schedule.startAt`
- registration fields -> `eventInfo.registration`
- `meta.eventDescription -> eventInfo.content.customDescription`

Existing `location` values using `店家｜地址` are conservatively split into venue name and address. A one-part legacy value remains the venue name and is preserved as `legacyText`.

## Security / public exposure

P7.11A does not add Event Info V2 to public top-level fields or change Firestore rules. The public mirror remains on its existing explicit whitelist.

Future public exposure must go through a dedicated `buildPublicEventInfo()` whitelist rather than spreading the private Event Info object.

## Next steps

- P7.11B: BXH Standard Template CMS (super_admin write only)
- P7.11C: AI suggestion / correction proposals with explicit host acceptance
- P7.12: structured venue + Google Maps / Apple Maps navigation
- P7.13: poster upload and multimodal extraction
- P7.14: public tournament detail reads from the structured public event-info projection
