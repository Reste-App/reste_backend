# Stayca Backend Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Expo + React Native                      │
│                    (Frontend - Supabase Auth)                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ JWT Token in Authorization header
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                     Supabase Edge Functions                      │
│                      (10 TypeScript endpoints)                   │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Places     │  │   Stays      │  │   Elo        │          │
│  │   Proxy      │  │   Manager    │  │   System     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                   │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐          │
│  │   Feed       │  │   Posts      │  │   Follow     │          │
│  │   Stream     │  │   & Social   │  │   System     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                   │
└────────────┬────────────────┬──────────────────────────────────┘
             │                │
             │                │ Service Role Key (for system writes)
             │                │
┌────────────▼────────────────▼──────────────────────────────────┐
│                      Supabase Postgres                          │
│                         (with RLS)                              │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐               │
│  │  profiles  │  │   stays    │  │ elo_ratings│               │
│  └────────────┘  └────────────┘  └────────────┘               │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐               │
│  │   posts    │  │   follows  │  │ feed_events│               │
│  └────────────┘  └────────────┘  └────────────┘               │
│                                                                  │
│  ┌────────────┐  ┌────────────┐                                │
│  │place_cache │  │elo_matches │                                │
│  └────────────┘  └────────────┘                                │
│                                                                  │
└────────────┬─────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────┐
│                     Google Places API                          │
│              (search, details - cached 7 days)                 │
└────────────────────────────────────────────────────────────────┘
```

## Data Flow Examples

### 1. Marking Hotel as "BEEN"

```
User Action → Frontend
              ↓
         PUT /stays/:place_id
         { status: "BEEN", sentiment: "LIKED" }
              ↓
         JWT Verification (utils.ts)
              ↓
         Upsert stays table (RLS enforces user_id)
              ↓
         Initialize elo_ratings (default 1500)
              ↓
         Create feed_event (service role)
              ↓
         Return success
```

### 2. Elo Battle Match

```
User taps "Compare Hotels" → Frontend
                               ↓
                          POST /elo-battle-pair
                               ↓
                          Get BEEN hotels with ratings
                               ↓
                          Select pair: low games_played + close ratings
                               ↓
                          Fetch place_cache for details
                               ↓
                          Return { placeA, placeB }
                               ↓
User picks winner → Frontend
                               ↓
                          POST /elo-submit-match
                          { placeAId, placeBId, winnerPlaceId }
                               ↓
                          Call PostgreSQL function (atomic)
                          ↓                    ↓
                   Lock both ratings    Calculate new Elo
                          ↓                    ↓
                   Update both rows     Increment games_played
                          ↓
                   Insert elo_matches record
                          ↓
                   Create feed_event
                          ↓
                   Return updated ratings + score10
```

### 3. Activity Feed

```
User opens Feed → Frontend
                    ↓
               GET /feed?limit=20
                    ↓
               Get followed users (follows table)
                    ↓
               Query feed_events where actor_id IN (followed)
                    ↓
               Order by created_at DESC
                    ↓
               Return events + next_cursor
```

### 4. Google Places Search (with caching)

```
User searches "Marriott NYC" → Frontend
                                  ↓
                             GET /places-search?query=...
                                  ↓
                             JWT Verification
                                  ↓
                             Call Google Places Text Search API
                                  ↓
                             Transform results
                                  ↓
                             Opportunistic cache: upsert place_cache
                             (basic info, used for feed events)
                                  ↓
                             Return array of places
                                  ↓
User taps hotel details → Frontend
                                  ↓
                             GET /places-details?place_id=...
                                  ↓
                             Check place_cache
                                  ↓
                        ┌─────────┴─────────┐
                    Cache hit           Cache miss/expired
                  (< 7 days old)        (> 7 days old)
                        │                     │
                Return cached          Call Google Places Details
                                              ↓
                                       Upsert place_cache (full details)
                                              ↓
                                       Return fresh data
```

## Security Model

### Authentication Flow

```
1. User signs in via Expo app
   ↓
2. Supabase Auth returns JWT
   ↓
3. Frontend includes: Authorization: Bearer <JWT>
   ↓
4. Edge function calls verifyAuth(req)
   ↓
5. utils.ts: supabase.auth.getUser(token)
   ↓
6. Extract user.id (NEVER trust req.body.user_id)
   ↓
7. Create two Supabase clients:
   - supabase: user-scoped (respects RLS)
   - supabaseAdmin: service role (bypasses RLS)
   ↓
8. Use supabase for user data operations
9. Use supabaseAdmin for system writes (feed, cache)
```

### RLS Policy Pattern

```sql
-- Read: All authenticated users
CREATE POLICY "stays_read"
  ON stays FOR SELECT
  USING (auth.role() = 'authenticated');

-- Write: Owner only
CREATE POLICY "stays_write"
  ON stays FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- System tables (feed_events, place_cache)
-- No user write policies → only service role
```

## Score Calculation Pipeline

```
User's BEEN hotels
    ↓
┌───┴────────────────────────────────────┐
│                                         │
│  Hotel A                 Hotel B        │
│  ├─ Elo: 1650           ├─ Elo: 1450   │
│  ├─ Sentiment: LIKED    ├─ Sentiment: FINE
│  └─ Games: 12           └─ Games: 8     │
│                                         │
└───┬────────────────────────────────────┘
    ↓
Calculate base score (from Elo)
    ↓
base10 = (rating - 1000) / 100
    ↓
┌───┴────────────────────────┐
│                             │
│  Hotel A: (1650-1000)/100   │  Hotel B: (1450-1000)/100
│         = 6.5               │         = 4.5
│                             │
└───┬────────────────────────┘
    ↓
Apply sentiment offset
    ↓
┌───┴────────────────────────┐
│                             │
│  Hotel A: 6.5 + 0.7 = 7.2  │  Hotel B: 4.5 + 0.0 = 4.5
│  (LIKED = +0.7)             │  (FINE = +0.0)
│                             │
└───┬────────────────────────┘
    ↓
Clamp to [0, 10]
    ↓
Final Rankings Display:
  1. Hotel A - Score: 7.2/10 ⭐
  2. Hotel B - Score: 4.5/10
```

## Elo Update Algorithm (K=24)

```
Before Match:
  Hotel A: rating = 1500, games = 5
  Hotel B: rating = 1480, games = 3

User picks Hotel A as winner
    ↓
Calculate expected scores:
  Expected_A = 1 / (1 + 10^((1480-1500)/400))
            = 1 / (1 + 10^(-0.05))
            ≈ 0.54

  Expected_B = 1 / (1 + 10^((1500-1480)/400))
            = 1 / (1 + 10^(0.05))
            ≈ 0.46
    ↓
Actual scores:
  Actual_A = 1.0 (winner)
  Actual_B = 0.0 (loser)
    ↓
Rating changes:
  ΔRating_A = 24 × (1.0 - 0.54) = 24 × 0.46 ≈ 11
  ΔRating_B = 24 × (0.0 - 0.46) = 24 × -0.46 ≈ -11
    ↓
New ratings:
  Hotel A: 1500 + 11 = 1511, games = 6
  Hotel B: 1480 - 11 = 1469, games = 4
```

## Battle Pair Selection Strategy

```
Get all BEEN hotels
    ↓
For each hotel:
  score = games_played + random(0, 5)
    ↓
Sort by score (ascending)
    ↓
Take top 5 candidates
    ↓
Among top 5, find pair with:
  - Closest rating difference
  - At least one has games_played < 10
    ↓
Return selected pair
```

**Why this works:**
- Low `games_played` → exploration (learn about new hotels)
- Random factor → variety
- Close ratings → competitive, meaningful comparisons
- Prefers under-sampled hotels → converges to true rankings faster

## Caching Strategy

### Place Cache TTL

```
Day 0: User searches "Marriott"
  ↓
places-search calls Google API
  ↓
Upsert place_cache (basic info)
  updated_at = Day 0

Day 3: User requests details
  ↓
places-details checks cache
  ↓
Cache age = 3 days < 7 days TTL
  ↓
Return cached data ✓

Day 8: Another user requests details
  ↓
places-details checks cache
  ↓
Cache age = 8 days > 7 days TTL
  ↓
Call Google API, refresh cache
  ↓
Return fresh data
```

### Why 7 days?

- **Balance**: Hotels don't change frequently
- **Quota savings**: Typical app reuses popular hotels
- **Freshness**: New reviews/ratings updated weekly
- **Cost**: Reduce Places API calls by ~80-90%

## Edge Functions Dependencies

```
_shared/utils.ts (imported by all)
    ↓
    ├─ verifyAuth() → Extract user from JWT
    ├─ ApiError → Custom error class
    ├─ jsonResponse() → Standard JSON response
    ├─ errorResponse() → Error handling
    └─ corsHeaders, handleCors() → CORS support

All functions follow pattern:
  1. handleCors(req) → return early if OPTIONS
  2. verifyAuth(req) → get userId + clients
  3. Validate input (Zod schema)
  4. Business logic
  5. Return jsonResponse() or errorResponse()
```

## Database Indexes

```sql
-- Hot paths optimized:

stays:
  - user_id (frequent: my stays)
  - place_id (frequent: join with cache)
  - (user_id, status) (frequent: BEEN list)

elo_ratings:
  - user_id (frequent: my ratings)
  - (user_id, rating DESC) (frequent: rankings)

follows:
  - follower_id (frequent: who I follow)
  - following_id (frequent: my followers)

feed_events:
  - actor_id (frequent: user's activity)
  - created_at DESC (frequent: recent events)

place_cache:
  - place_id (PK, frequent lookups)
  - updated_at (frequent: cache expiry check)
```

## Deployment Flow

```
Local Development:
  ├─ Edit functions locally
  ├─ supabase functions serve <name>
  └─ Test with curl/Postman

Ready to Deploy:
  ├─ Run ./deploy.sh
  │   ↓
  │   For each function:
  │     - Package TypeScript
  │     - Upload to Supabase
  │     - Deploy to edge network
  │
  ├─ Set secrets (if first time):
  │   - GOOGLE_PLACES_API_KEY
  │   - SUPABASE_SERVICE_ROLE_KEY
  │
  └─ Verify: https://your-project.supabase.co/functions/v1/<name>

Database Changes:
  ├─ Create migration: supabase migration new <name>
  ├─ Edit SQL in migrations/
  └─ Deploy: supabase db push
```

## Environment Variables

```
Frontend (.env in Expo):
  SUPABASE_URL          → Public, used by client
  SUPABASE_ANON_KEY     → Public, used by client

Backend (Supabase secrets):
  GOOGLE_PLACES_API_KEY       → Private, server only
  SUPABASE_SERVICE_ROLE_KEY   → Private, bypasses RLS
  SUPABASE_URL                → Auto-injected by platform
  SUPABASE_ANON_KEY           → Auto-injected by platform
```

---

## Quick Reference: Key Files

| File | Purpose |
|------|---------|
| `001_schema.sql` | All tables, constraints, triggers |
| `002_rls_policies.sql` | Row Level Security policies |
| `003_elo_function.sql` | Atomic Elo update transaction |
| `_shared/utils.ts` | Auth verification, helpers |
| `places-*.ts` | Google Places proxy + caching |
| `stays/index.ts` | Add/update hotel status |
| `elo-*.ts` | Battle pair selection + match submission |
| `rankings-me/index.ts` | Sorted BEEN list with score10 |
| `feed/index.ts` | Social activity stream |
| `follow/index.ts` | Follow/unfollow users |
| `posts/index.ts` | Create reviews |
| `profile/index.ts` | User profile CRUD |

---

**Architecture Principles:**
- ✅ Security first (JWT + RLS)
- ✅ Caching for performance
- ✅ Atomic operations (Elo)
- ✅ Type safety (TypeScript + Zod)
- ✅ Scalable (Supabase edge network)
- ✅ Developer-friendly (clear separation, good docs)
