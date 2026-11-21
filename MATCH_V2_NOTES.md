# Nookly Match 2.0 — scoring and retrieval

This update is applied only to the standalone accommodation PWA. It does not edit Nookly Mobile, Appwrite schema or GitHub.

## Scoring (0–100 preference alignment, **not a probability**)

- Budget: up to 40 points for comparable monthly budgets, no points for missing budgets.
- Lifestyle: up to 30 points, using a Jaccard ratio of normalized unique preferences. Missing values earn zero.
- Move-in: up to 15 points for close or explicitly flexible dates; missing/invalid dates earn zero.
- Intentions: up to 15 points for compatible search intentions. Missing values earn zero.
- `matchCoverage` shows how much of the weighted questionnaire can be evaluated on both profiles; do not interpret it as statistical confidence.
- Hard checks: self/hidden profiles, city match, mutually compatible gender and roommate-type preferences, valid budgets, and budget difference threshold.

## Candidate retrieval

First attempts an Appwrite `Query.contains('preferredLocation', value)` grouped by `Query.or`, including a few legacy institution aliases (e.g. BUSE/Bindura). On query validation failures (HTTP 400/422), falls back to the previous active-profile scan. Other errors are surfaced normally. Server-side local-city filtering can be faster if the collection's indexes support it, but performance must be tested on the real Appwrite deployment. The response reports whether results were truncated. No schema or index is created by this patch.

**Known limitation:** manual city matching recognizes a curated set of Zimbabwe cities. For proper nearby-suburb and multi-campus handling, migrate to explicit canonical locality fields with geospatial distance later. `Query.contains` is a stopgap; the long-term scalable solution is a normalized indexed city/area column.

## Security still requiring backend changes

The existing match profile schema includes email and phone fields. Hiding those details behind a UI button is not secure access control. Before production launch, separate public match-card data from private contacts and implement an authenticated, consent-based contact request through a server-verified Appwrite function. Review Appwrite collection/document permissions; this patch does not change them or claim to solve this issue.

## Test

From the PWA project root run:

```powershell
node --test .\tests\matching.test.cjs
npm run build
```

The unit tests mock Appwrite; they do not exercise your live collection permissions or index behavior.
