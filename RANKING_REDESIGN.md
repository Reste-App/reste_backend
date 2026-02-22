# Ranking System Redesign

## Overview

Replace the Elo rating system with a direct ordered-list approach per sentiment tier.
Binary search is used to place new hotels. Display scores are computed on read from
rank position. No floating-point ratings, no match history, no post-processing.

---

## Why Replace Elo

| Problem | Detail |
|---|---|
| Approximate placement | Elo caps at 4 comparisons and approximates rank — correct placement not guaranteed |
| N+1 DB writes | Every match triggers a full recompute + individual UPDATE per hotel |
| Sentiment inconsistency | Stored sentiment (user's label) and computed tier (from rating) could diverge |
| Can't rollback mid-placement | Every comparison immediately mutates ratings for both hotels |
| Dead code | Binary search bounds in `elo-battle-pair` are computed but never used |
| 3 extra tables | `elo_ratings`, `elo_matches`, `placement_sessions` all exist to support one feature |

---

## Core Concept

Each user maintains **three independent ordered lists**, one per sentiment tier:

```
LIKED:     [hotel_A, hotel_C, hotel_F, hotel_B]   → scores 6.7, 7.8, 8.9, 10.0
FINE:      [hotel_E, hotel_D]
DISLIKED:  [hotel_G]
```

- Position in the list is the source of truth — stored as `rank_in_tier INTEGER`
- Display score is derived from position at read time — never stored
- Adding a hotel = binary search comparisons to find its position, then insert
- All positions above the insertion point shift up by 1 (single bulk UPDATE)
- **Binary search state lives on the client only** — nothing is written to the DB
  until placement is fully complete. Abandon mid-placement = nothing recorded.

---

## Score Bands

Unchanged from the current system:

| Tier | Score Range |
|---|---|
| LIKED | 6.7 – 10.0 |
| FINE | 3.4 – 6.7 |
| DISLIKED | 0.0 – 3.4 |

### Display Score Formula (computed on read)

```
score = band.min + (rank_in_tier / max(1, total_in_tier - 1)) * (band.max - band.min)
```

- `rank_in_tier` is 0-indexed (0 = lowest in tier, n-1 = highest)
- `total_in_tier` is the count of placed hotels in that tier for this user
- Single hotel in a tier: `rank=0`, `total=1` → score = band midpoint
- No rounding surprises: scores are computed from integers

### Examples

3 LIKED hotels, ranks 0, 1, 2:
```
rank 0 → 6.7 + (0/2) * 3.3 = 6.7
rank 1 → 6.7 + (1/2) * 3.3 = 8.35
rank 2 → 6.7 + (2/2) * 3.3 = 10.0
```

---

## Comparisons — No Artificial Cap

Binary search runs to natural convergence (`low >= high`). No hard comparison limit.
The number of comparisons is determined entirely by the size of the tier list:

| Hotels already in tier | Comparisons needed |
|---|---|
| 0 | 0 (placed immediately) |
| 1 | 1 |
| 2–3 | 2 |
| 4–7 | 3 |
| 8–15 | 4 |
| 16–31 | 5 |
| 32–63 | 6 |
| 64–127 | 7 |

Formula: `ceil(log2(n + 1))` where `n` is the number of already-placed hotels in the tier.

6 comparisons already handles 64 hotels in a single tier, which is an extreme
edge case in practice. There is no reason to cap this — the natural growth of
`log2` keeps comparisons low even at large scale. Artificially capping at 4
(as Elo did) trades correctness for no real UX benefit.

---

## Data Model

### Changes to `stays` table

Add two columns:

```sql
ALTER TABLE stays ADD COLUMN rank_in_tier INTEGER;
ALTER TABLE stays ADD COLUMN rank_updated_at TIMESTAMPTZ;

-- rank_in_tier is NULL until placement is complete
-- Unique within (user_id, sentiment) for placed hotels
CREATE UNIQUE INDEX idx_stays_rank_in_tier
  ON stays (user_id, sentiment, rank_in_tier)
  WHERE rank_in_tier IS NOT NULL;

CREATE INDEX idx_stays_tier_rank
  ON stays (user_id, sentiment, rank_in_tier)
  WHERE status = 'BEEN' AND rank_in_tier IS NOT NULL;
```

`rank_in_tier = NULL` means the hotel has no placement yet. The frontend treats
these as unranked and shows a prompt to finish ranking.

### Tables to delete

```
elo_ratings          ← replaced by stays.rank_in_tier
elo_matches          ← match history no longer needed
placement_sessions   ← no longer needed (placement state is client-side only)
```

SQL functions to delete:
```
update_elo_ratings()       (migration 003)
get_rank_position()        (migration 005)
update_placement_session() (migration 005)
```

No new tables are needed.

---

## Placement Flow

All binary search logic runs on the client. The server is only called twice per
placement: once to get the tier list, once to commit the final position.

```
1. User marks hotel BEEN + sentiment
         ↓
2. Client calls POST /rank-begin-placement
   → server returns ordered tier list (place IDs + metadata)
         ↓
3. Client initialises: low = 0, high = total_in_tier - 1
         ↓
4. Loop while low < high:
     mid = floor((low + high) / 2)
     show comparison: new hotel vs tierList[mid]
     user picks winner:
       new hotel wins → low = mid + 1
       opponent wins  → high = mid
         ↓
5. Converged: insertion point = low
         ↓
6. Client calls POST /rank-finalize-placement with rankInTier = low
   → server atomically shifts + inserts
         ↓
7. Done. DB written once.
```

If the user abandons at any point between steps 3 and 6, nothing has been
written to the DB. The hotel stays at `rank_in_tier = NULL`.

---

## Edge Functions

### Existing functions to delete

| Function | Reason |
|---|---|
| `elo-battle-pair` | Replaced by `rank-begin-placement` |
| `elo-submit-match` | Replaced by `rank-finalize-placement` |
| `recalculate-scores` | No longer needed — scores computed on read |
| `reset-hotel-placement` | Replaced by `rank-reset` |

### New functions

---

#### `POST /rank-begin-placement`

Called when a user marks a hotel as BEEN. Returns the tier list the client
needs to run binary search locally.

**Request:**
```json
{
  "placeId": "ChIJ...",
  "sentiment": "LIKED"
}
```

**Logic:**
1. Verify hotel is in user's BEEN list with matching sentiment
2. Fetch all placed hotels in this tier, ordered by `rank_in_tier ASC`
3. If `total == 0`: skip binary search, immediately finalize at rank 0, return placed

**Response (tier has existing hotels):**
```json
{
  "status": "comparing",
  "tierList": [
    { "placeId": "...", "name": "Four Seasons Tokyo", "photo": "..." },
    { "placeId": "...", "name": "Ace Hotel NY",       "photo": "..." },
    { "placeId": "...", "name": "The Ritz Paris",     "photo": "..." }
  ],
  "totalInTier": 3,
  "newHotel": { "placeId": "...", "name": "Mandarin Oriental", "photo": "..." }
}
```

`tierList` is ordered rank ascending (index 0 = lowest ranked, index n-1 = highest).
The client uses this list directly to run binary search: `tierList[mid]` is the
opponent at each step.

**Response (first hotel in tier):**
```json
{ "status": "placed", "rankInTier": 0, "displayScore": 8.35 }
```

---

#### `POST /rank-finalize-placement`

Called once, when the client's binary search converges. Atomically inserts the
hotel at the correct rank position.

**Request:**
```json
{
  "placeId":    "ChIJ...",
  "sentiment":  "LIKED",
  "rankInTier": 2
}
```

**Logic:**
1. Validate `rankInTier` is in range `[0, total_in_tier]`
2. Execute atomic transaction:

```sql
-- Shift all hotels at rank >= insertion point up by 1
UPDATE stays
SET rank_in_tier = rank_in_tier + 1
WHERE user_id = $userId
  AND sentiment = $sentiment
  AND status = 'BEEN'
  AND rank_in_tier >= $rankInTier;

-- Assign rank to the new hotel
UPDATE stays
SET rank_in_tier = $rankInTier,
    rank_updated_at = NOW()
WHERE user_id = $userId
  AND place_id = $placeId;
```

**Response:**
```json
{
  "status": "placed",
  "rankInTier": 2,
  "totalInTier": 6,
  "displayScore": 8.02
}
```

---

#### `GET /rankings-me` (updated, not replaced)

Unchanged in interface. Updated to read from `stays.rank_in_tier` instead of
`elo_ratings`. Display score computed inline from rank.

**Logic:**
1. Fetch all BEEN stays joined with `place_cache`
2. Group by sentiment tier, count total placed per tier
3. Compute display score: `band.min + (rank / max(1, total-1)) * (band.max - band.min)`
4. Sort: LIKED descending by rank, then FINE, then DISLIKED

Unplaced hotels (`rank_in_tier IS NULL`) are returned at the end with
`displayScore: null` so the frontend can show a "finish ranking" prompt.

---

#### `POST /rank-reset` (replaces `reset-hotel-placement`)

Removes a placed hotel's rank so it can be re-ranked from scratch. Sets
`rank_in_tier = NULL` and shifts all hotels above it down by 1.

**Request:**
```json
{ "placeId": "ChIJ..." }
```

**Logic:**
```sql
-- Shift hotels above the removed rank down by 1
UPDATE stays
SET rank_in_tier = rank_in_tier - 1
WHERE user_id = $userId
  AND sentiment = $sentiment
  AND status = 'BEEN'
  AND rank_in_tier > $oldRank;

-- Clear the rank
UPDATE stays
SET rank_in_tier = NULL, rank_updated_at = NOW()
WHERE user_id = $userId AND place_id = $placeId;
```

---

## Edge Cases

### First hotel in a tier
`total_in_tier == 0` → server finalizes immediately at rank 0, no comparisons needed.
`rank-begin-placement` returns `{ status: "placed" }` directly.

### Sentiment change after placement
User changes a placed hotel from LIKED to FINE:
1. Remove from LIKED list: shift all hotels with `rank_in_tier > old_rank` down by 1, set hotel's `rank_in_tier = NULL`
2. Update `stays.sentiment = 'FINE'`
3. Client calls `rank-begin-placement` with new sentiment, begins placement in FINE tier

### Sentiment change mid-placement (client has tier list, hasn't finalized)
Client discards local binary search state. Nothing was written to DB.
Client calls `rank-begin-placement` with the new sentiment.

### Hotel removed from BEEN list
1. Capture `old_rank` and `sentiment` before deletion
2. Delete or update the `stays` row
3. Shift all hotels in the same tier with `rank_in_tier > old_rank` down by 1

### App closes mid-placement
Binary search state was client-only. On next open the hotel is still at
`rank_in_tier = NULL`. User sees the "finish ranking" prompt and starts fresh.
Since max comparisons is at most ~6 even for large lists, restarting is not a
meaningful penalty.

### Tier list changes between begin and finalize
Another device could finalize a different hotel in the same tier between the
client's `rank-begin-placement` and `rank-finalize-placement` calls. The server
should validate that `rankInTier <= current_total_in_tier` and clamp if needed.
In practice this is rare (single user, same tier, two devices simultaneously),
but the atomic shift handles it gracefully.

---

## Migration Plan

### Step 1 — Add new columns (non-breaking)
```sql
-- Migration 012
ALTER TABLE stays ADD COLUMN rank_in_tier INTEGER;
ALTER TABLE stays ADD COLUMN rank_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX idx_stays_rank_in_tier
  ON stays (user_id, sentiment, rank_in_tier)
  WHERE rank_in_tier IS NOT NULL;

CREATE INDEX idx_stays_tier_rank
  ON stays (user_id, sentiment, rank_in_tier)
  WHERE status = 'BEEN' AND rank_in_tier IS NOT NULL;
```

### Step 2 — Backfill existing data
Convert existing `elo_ratings` into `rank_in_tier` values per user per tier:

```sql
-- Migration 013
UPDATE stays s
SET rank_in_tier = r.elo_rank
FROM (
  SELECT
    s.user_id,
    s.place_id,
    -- 0-indexed rank within each (user, sentiment) group, ordered by Elo rating ascending
    ROW_NUMBER() OVER (
      PARTITION BY s.user_id, s.sentiment
      ORDER BY er.rating ASC
    ) - 1 AS elo_rank
  FROM stays s
  JOIN elo_ratings er ON er.user_id = s.user_id AND er.place_id = s.place_id
  WHERE s.status = 'BEEN' AND s.sentiment IS NOT NULL
) r
WHERE s.user_id = r.user_id AND s.place_id = r.place_id;
```

### Step 3 — Deploy new edge functions
Deploy `rank-begin-placement`, `rank-finalize-placement`, `rank-reset`,
and updated `rankings-me`. Keep old Elo functions running in parallel.

### Step 4 — Update frontend
Switch frontend to use new ranking endpoints. Keep old endpoints alive until
all clients have updated (no old clients hitting old endpoints).

### Step 5 — Delete old tables and functions
```sql
-- Migration 014 (after cutover confirmed)
DROP TABLE elo_ratings;
DROP TABLE elo_matches;
DROP TABLE placement_sessions;
DROP FUNCTION update_elo_ratings;
DROP FUNCTION get_rank_position;
DROP FUNCTION update_placement_session;
```

Delete edge functions: `elo-battle-pair`, `elo-submit-match`,
`recalculate-scores`, `reset-hotel-placement`.

---

## Summary of Changes

| | Before | After |
|---|---|---|
| Placement correctness | Approximate (hard 4-comparison cap) | Exact (binary search to convergence) |
| Comparison count | Always 4 regardless of list size | `ceil(log2(n+1))` — grows to 6 at 63 hotels |
| DB writes per placement | N individual updates after every comparison | 1 bulk shift + 1 row update, once at the end |
| Rollback | Delete matches + recalculate ratings | Nothing — DB was never touched |
| Mid-placement state | Stored in `placement_sessions` | Client memory only |
| Display score | Stored float, recomputed after every match | Computed on read from integer rank |
| Tables removed | — | `elo_ratings`, `elo_matches`, `placement_sessions` |
| New tables | — | None |
| Edge functions | 4 ranking functions | 3 ranking functions |
| Sentiment consistency | Rating-derived tier could diverge from stored sentiment | Rank always lives under the user's stored sentiment |
