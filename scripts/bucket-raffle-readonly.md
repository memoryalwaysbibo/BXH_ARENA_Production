# Independent raffle source capture

Run in authenticated Cloud Shell with active project bxh-arena:

```sh
python3 -B bucket-raffle-readonly.py
```

The helper GETs previewTournamentRaffle, drawTournamentRaffle and
updateTournamentRaffleWinner in asia-east1, downloads their generation-pinned
source ZIPs, then verifies each Function's full metadata is unchanged across
the download. It prints the review ZIP path. The report contains identities,
hashes and safe errors; no tokens or raw environment values are printed.
Source archives contain deployed application code and belong in the private
review input, not a public repository commit.

It does not read or write Firestore documents, modify a trigger/configuration,
deploy code or enable bucket rooms. A complete capture is only source evidence;
writerInventoryComplete and acceptanceCompleted remain false. The capture
failure status distinguishes wrong-active-project from other controlled errors.

Return the generated bxh-raffle-sources-*.zip for source review. The verified
raffle input reader remains unconnected until these independently deployed
entrypoints are reconciled and their integration receives acceptance.

```sh
python3 -B tests/four-court-buckets/raffle-readonly.py
```
