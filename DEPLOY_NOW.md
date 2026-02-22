# Deployment Guide — Pending Changes

This document covers all edge function changes made across two sessions that
need to be deployed to Supabase before they take effect.

---

## What Needs Deploying

Only **Supabase edge functions** require explicit deployment. Frontend changes
(React Native / Expo) take effect on the next app build or dev reload — no
Supabase action needed for those.

### Functions to deploy

| Function | Change | Breaking? |
|---|---|---|
| `places-search` | Added `verifyAuth` (was unauthenticated) | Yes — callers must send `Authorization: Bearer <token>` |
| `places-search-cities` | Added `verifyAuth` (was unauthenticated) | Yes |
| `places-details` | Added `verifyAuth` call (import existed but was never called) | Yes |
| `hotel-lookup` | Added `verifyAuth` (was unauthenticated) | Yes |
| `vibe-summary` | Removed silent auth try/catch; now explicitly public (no auth attempted) | No — was already public in practice |
| `rank-finalize-placement` | Removed `displayScore` from response; only returns `{ status, rankInTier, totalInTier }` | No — frontend doesn't read `displayScore` from this endpoint |

---

## Deploy Commands

Run from the `reste_backend` directory:

```bash
# Deploy all changed functions in one go
npx supabase functions deploy places-search
npx supabase functions deploy places-search-cities
npx supabase functions deploy places-details
npx supabase functions deploy hotel-lookup
npx supabase functions deploy vibe-summary
npx supabase functions deploy rank-finalize-placement
```

Or use the updated `deploy.sh` (now lists all current functions):

```bash
./deploy.sh
```

> **Note:** `deploy.sh` was previously deploying deleted Elo functions
> (`elo-battle-pair`, `elo-submit-match`) and missing several new ones. It has
> been updated in this session to reflect the current function list.

---

## Breaking Change Warning — Auth on 4 Endpoints

`places-search`, `places-search-cities`, `places-details`, and `hotel-lookup`
now require a valid Supabase JWT. Requests without an `Authorization` header
will receive `401 Unauthorized`.

The frontend already sends the token on all these calls (via the Supabase JS
client and the `verifyAuth` pattern), so **no frontend change is needed**.
However, if you have any scripts, Postman collections, or other tools hitting
these endpoints directly, they will need to include a token.

`vibe-summary` remains intentionally public — no token required. It aggregates
guest responses for the hotel detail page which is visible without login.

---

## What Does NOT Need Deploying

These are frontend-only changes (Expo/React Native):

| File | Change |
|---|---|
| `src/hooks/usePlacementComparison.ts` | New hook — binary search placement flow |
| `src/screens/RatingComparisonModal.tsx` | Rewritten to use `usePlacementComparison`; removed Skip/Too Tough buttons |
| `src/context/RankingsContext.tsx` | Removed dead `elo_ratings` fallback; removed unused `supabase` import |

These take effect immediately in the dev build (`npx expo start`) or on the
next production build via EAS.

---

## No Database Migrations Required

All schema changes (adding `rank_in_tier`, `rank_updated_at` to `stays`;
adding `vibe_summaries`, `place_cache` tables; dropping `elo_ratings`) were
applied in earlier sessions and are already live.
