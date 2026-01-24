# Stayca API Reference

Quick reference for all backend endpoints.

## Base URL

```
Production: https://your-project.supabase.co/functions/v1
Local: http://localhost:54321/functions/v1
```

## Authentication

All endpoints require JWT token from Supabase Auth:

```
Authorization: Bearer <jwt_token>
```

## Endpoints

### Places

#### `GET /places-search`
Search hotels via Google Places

**Query Params:**
- `query` (string, optional): Search text
- `location` (string, optional): `lat,lng`
- `radius` (number, optional): Meters, default 5000
- `type` (string, optional): Default "lodging"

**Response:** Array of place results with basic info

---

#### `GET /places-details`
Get detailed hotel information

**Query Params:**
- `place_id` (string, required): Google Place ID

**Response:** Full place details (cached for 7 days)

---

### Stays

#### `PUT /stays/:place_id`
Add or update hotel in user's list

**Body:**
```json
{
  "status": "WANT" | "BEEN",
  "sentiment": "LIKED" | "FINE" | "DISLIKED" | null,
  "stayed_at": "ISO8601" | null
}
```

**Rules:**
- `status: "BEEN"` → sentiment required
- `status: "WANT"` → sentiment must be null

---

### Elo System

#### `POST /elo-battle-pair`
Get two hotels for pairwise comparison

**Body:** None

**Response:**
```json
{
  "placeAId": "string",
  "placeBId": "string",
  "placeA": { "name": "...", "city": "..." },
  "placeB": { "name": "...", "city": "..." }
}
```

---

#### `POST /elo-submit-match`
Submit comparison result

**Body:**
```json
{
  "placeAId": "string",
  "placeBId": "string",
  "winnerPlaceId": "string"
}
```

**Response:** Updated ratings and score10 for both places

---

#### `GET /rankings-me`
Get user's ranked list of BEEN hotels

**Response:**
```json
{
  "rankings": [
    {
      "place_id": "string",
      "name": "string",
      "rating": 1500,
      "score10": 5.7,
      "sentiment": "LIKED",
      "games_played": 10
    }
  ]
}
```

---

### Social

#### `POST /posts`
Create a review post

**Body:**
```json
{
  "place_id": "string",
  "text": "string (max 2000)",
  "tags": ["string"] | null
}
```

---

#### `POST /follow/:userId`
Follow a user

**URL Param:** `userId` (UUID)

---

#### `DELETE /follow/:userId`
Unfollow a user

**URL Param:** `userId` (UUID)

---

#### `GET /profile/:userId`
Get user profile and stats

**URL Param:** `userId` (UUID)

**Response:**
```json
{
  "profile": {
    "id": "uuid",
    "username": "string",
    "stats": {
      "been_count": 15,
      "want_count": 8,
      "followers_count": 42,
      "following_count": 35
    },
    "is_following": true,
    "is_own_profile": false
  }
}
```

---

#### `PATCH /profile`
Update own profile

**Body:**
```json
{
  "username": "string (3-30 chars, alphanumeric + _)",
  "avatar_url": "string (URL)"
}
```

---

#### `GET /feed`
Get activity feed from followed users

**Query Params:**
- `limit` (number, optional): Default 20
- `cursor` (ISO8601, optional): For pagination

**Response:**
```json
{
  "events": [
    {
      "id": "uuid",
      "actor_id": "uuid",
      "event_type": "MARK_BEEN" | "POST" | "ELO_MATCH" | "FOLLOW" | "WISHLIST",
      "payload": {},
      "created_at": "ISO8601"
    }
  ],
  "next_cursor": "ISO8601" | null
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message"
}
```

**Common Status Codes:**
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid/missing JWT)
- `404` - Not Found
- `405` - Method Not Allowed
- `500` - Internal Server Error

---

## Score Calculation (Beli-Style Tiers)

### Elo Rating
- Default: 1500
- K-factor: 24
- Range: 0-3000 (typical: 1000-2000)

### Three Tiers (Like Beli)
Sentiment determines which tier, Elo determines position within tier:

```
LIKED:    6.7 - 10.0  (top tier - "I liked it!")
FINE:     3.4 - 6.6   (middle tier - "It was fine")
DISLIKED: 0.0 - 3.3   (bottom tier - "I didn't like it")
```

### Formula
```
normalizedElo = clamp((rating - 1000) / 1000, 0, 1)
score10 = tier.min + (normalizedElo * tierRange)
```

### Examples
| Elo   | Sentiment | Tier Range | Normalized | Final |
|-------|-----------|------------|------------|-------|
| 1000  | LIKED     | 6.7-10.0   | 0.0        | 6.7   |
| 1500  | LIKED     | 6.7-10.0   | 0.5        | 8.4   |
| 2000  | LIKED     | 6.7-10.0   | 1.0        | 10.0  |
| 1500  | FINE      | 3.4-6.6    | 0.5        | 5.0   |
| 1500  | DISLIKED  | 0.0-3.3    | 0.5        | 1.7   |
| 1200  | DISLIKED  | 0.0-3.3    | 0.2        | 0.7   |

### Key Behavior
- All LIKED hotels always score above 6.7
- All FINE hotels always score between 3.4-6.6
- All DISLIKED hotels always score below 3.3
- Elo battles only affect ranking within the same tier

---

## TypeScript Types

```typescript
type Status = 'WANT' | 'BEEN'
type Sentiment = 'LIKED' | 'FINE' | 'DISLIKED'
type EventType = 'FOLLOW' | 'POST' | 'ELO_MATCH' | 'MARK_BEEN' | 'WISHLIST'

interface Stay {
  id: string
  user_id: string
  place_id: string
  status: Status
  sentiment: Sentiment | null
  stayed_at: string | null
  created_at: string
  updated_at: string
}

interface EloRating {
  user_id: string
  place_id: string
  rating: number
  games_played: number
  updated_at: string
}

interface RankedHotel {
  place_id: string
  name: string
  rating: number
  score10: number
  sentiment: Sentiment
  tier: 'LIKED' | 'FINE' | 'DISLIKED'  // Beli-style tier
  games_played: number
  city?: string
  country?: string
  chain?: string
}
```
