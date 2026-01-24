# Stayca Backend

**"Beli for Hotels"** - Social hotel ranking app powered by Elo ratings and sentiment analysis.

## Architecture

- **TypeScript** backend on **Supabase Edge Functions** (Deno runtime)
- **Postgres** database with Row Level Security (RLS)
- **Supabase Auth** for user authentication (JWT verification)
- **Google Places API** proxy with intelligent caching
- **Elo rating system** for pairwise hotel comparisons
- **Activity feed** for social features

## Features

### 🏨 Hotel Management
- Add hotels to WANT or BEEN lists
- Mark sentiment when visited: LIKED, FINE, or DISLIKED
- Search hotels via Google Places (server-side proxy)
- Automatic caching to reduce API quota usage

### 📊 Elo Rating System
- Pairwise comparisons of visited hotels
- Dynamic Elo ratings (default 1500, K-factor 24)
- Smart battle-pair selection (prefers close ratings + low games played)
- Score out of 10.0 combining Elo + sentiment:
  - Base: `(rating - 1000) / 100` clamped to [0, 10]
  - Sentiment adjustments: LIKED +0.7, FINE +0.0, DISLIKED -0.7

### 🌐 Social Features
- Follow/unfollow users
- Create posts/reviews for hotels
- Activity feed showing friends' actions
- Public profiles with stats

## Setup

### Prerequisites
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) installed
- [Deno](https://deno.land/) installed (for local edge function testing)
- Google Places API key

### 1. Initialize Supabase Project

```bash
# Link to existing project or create new one
supabase link --project-ref your-project-ref

# Or start local development
supabase start
```

### 2. Environment Variables

Create a `.env` file or set environment variables:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Google Places API
GOOGLE_PLACES_API_KEY=your-google-places-api-key
```

**For Edge Functions**, set secrets using Supabase CLI:

```bash
supabase secrets set GOOGLE_PLACES_API_KEY=your-api-key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. Run Database Migrations

```bash
supabase db push
```

This will create all tables, RLS policies, and PostgreSQL functions.

### 4. Deploy Edge Functions

Deploy all functions:

```bash
supabase functions deploy places-search
supabase functions deploy places-details
supabase functions deploy stays
supabase functions deploy elo-battle-pair
supabase functions deploy elo-submit-match
supabase functions deploy rankings-me
supabase functions deploy feed
supabase functions deploy posts
supabase functions deploy follow
supabase functions deploy profile
```

Or deploy all at once:

```bash
for func in places-search places-details stays elo-battle-pair elo-submit-match rankings-me feed posts follow profile; do
  supabase functions deploy $func
done
```

## API Endpoints

All endpoints require `Authorization: Bearer <jwt_token>` header from Supabase Auth.

### Places Proxy

#### Search Hotels
```bash
GET /places-search?query=Marriott+New+York&location=40.7128,-74.0060&radius=5000
```

**Query Parameters:**
- `query` (optional): Search text
- `location` (optional): `lat,lng` format
- `radius` (optional): Meters, default 5000
- `type` (default: `lodging`)

**Response:**
```json
{
  "results": [
    {
      "place_id": "ChIJ...",
      "name": "Marriott New York",
      "address": "123 Main St",
      "rating": 4.5,
      "user_ratings_total": 250,
      "photo_reference": "CmRa...",
      "lat": 40.7128,
      "lng": -74.0060
    }
  ],
  "status": "OK"
}
```

#### Get Hotel Details
```bash
GET /places-details?place_id=ChIJ...
```

**Response:**
```json
{
  "place_id": "ChIJ...",
  "name": "Marriott New York",
  "address": "123 Main St",
  "phone": "+1 212-555-0123",
  "website": "https://marriott.com",
  "rating": 4.5,
  "price_level": 3,
  "photos": ["photo_ref_1", "photo_ref_2"],
  "chain": "Marriott",
  "city": "New York",
  "country": "United States",
  "cached": true
}
```

### Hotel Lists

#### Add/Update Hotel Status
```bash
PUT /stays/:place_id
Content-Type: application/json

{
  "status": "BEEN",
  "sentiment": "LIKED",
  "stayed_at": "2024-01-15T00:00:00Z"
}
```

**Validation:**
- `status: "BEEN"` requires `sentiment`
- `status: "WANT"` requires `sentiment` to be null/omitted

**Response:**
```json
{
  "success": true,
  "stay": {
    "id": "uuid",
    "user_id": "uuid",
    "place_id": "ChIJ...",
    "status": "BEEN",
    "sentiment": "LIKED",
    "stayed_at": "2024-01-15T00:00:00Z"
  }
}
```

### Elo Rankings

#### Get Battle Pair
```bash
POST /elo-battle-pair
```

Returns two hotels from user's BEEN list for comparison. Algorithm prefers:
- Hotels with fewer games played (exploration)
- Hotels with similar Elo ratings (competitive matches)

**Response:**
```json
{
  "placeAId": "ChIJ...",
  "placeBId": "ChIJ...",
  "placeA": {
    "name": "Hotel A",
    "city": "New York",
    "photo": "photo_ref"
  },
  "placeB": {
    "name": "Hotel B",
    "city": "Boston",
    "photo": "photo_ref"
  }
}
```

#### Submit Match Result
```bash
POST /elo-submit-match
Content-Type: application/json

{
  "placeAId": "ChIJ...",
  "placeBId": "ChIJ...",
  "winnerPlaceId": "ChIJ..."
}
```

Updates Elo ratings using K-factor of 24. Atomic transaction ensures consistency.

**Response:**
```json
{
  "success": true,
  "ratings": [
    {
      "place_id": "ChIJ...",
      "rating": 1524.5,
      "games_played": 5,
      "score10": 5.9
    },
    {
      "place_id": "ChIJ...",
      "rating": 1475.5,
      "games_played": 5,
      "score10": 4.8
    }
  ]
}
```

#### Get My Rankings
```bash
GET /rankings-me
```

Returns all BEEN hotels sorted by Elo rating.

**Response:**
```json
{
  "rankings": [
    {
      "place_id": "ChIJ...",
      "name": "Hotel Name",
      "city": "New York",
      "country": "USA",
      "chain": "Marriott",
      "rating": 1650.5,
      "games_played": 12,
      "sentiment": "LIKED",
      "score10": 7.2,
      "stayed_at": "2024-01-15T00:00:00Z",
      "photo": "photo_ref"
    }
  ],
  "total": 15
}
```

### Social Features

#### Create Post
```bash
POST /posts
Content-Type: application/json

{
  "place_id": "ChIJ...",
  "text": "Amazing hotel with great service!",
  "tags": ["luxury", "business"]
}
```

#### Follow User
```bash
POST /follow/:userId
```

#### Unfollow User
```bash
DELETE /follow/:userId
```

#### Get User Profile
```bash
GET /profile/:userId
```

**Response:**
```json
{
  "profile": {
    "id": "uuid",
    "username": "johndoe",
    "avatar_url": "https://...",
    "created_at": "2024-01-01T00:00:00Z",
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

#### Update Own Profile
```bash
PATCH /profile
Content-Type: application/json

{
  "username": "newusername",
  "avatar_url": "https://..."
}
```

#### Get Activity Feed
```bash
GET /feed?limit=20&cursor=2024-01-15T12:00:00Z
```

Returns activity from followed users, paginated.

**Response:**
```json
{
  "events": [
    {
      "id": "uuid",
      "actor_id": "uuid",
      "event_type": "MARK_BEEN",
      "payload": {
        "username": "johndoe",
        "place_id": "ChIJ...",
        "place_name": "Hotel Name",
        "sentiment": "LIKED"
      },
      "created_at": "2024-01-15T12:00:00Z"
    }
  ],
  "next_cursor": "2024-01-14T10:30:00Z"
}
```

**Event Types:**
- `FOLLOW`: User followed someone
- `POST`: User created a post
- `ELO_MATCH`: User completed a comparison
- `MARK_BEEN`: User marked hotel as visited
- `WISHLIST`: User added hotel to want list

## Database Schema

### Tables

#### `profiles`
- Extends `auth.users`
- Fields: `id`, `username` (unique), `avatar_url`, `created_at`, `updated_at`

#### `follows`
- Social graph
- PK: `(follower_id, following_id)`
- Constraint: No self-follows

#### `stays`
- User's hotel list
- Fields: `user_id`, `place_id`, `status` (WANT/BEEN), `sentiment` (LIKED/FINE/DISLIKED)
- Unique: `(user_id, place_id)`
- Constraint: Sentiment required for BEEN, null for WANT

#### `elo_ratings`
- Per-user per-place ratings
- PK: `(user_id, place_id)`
- Default rating: 1500
- Fields: `rating`, `games_played`, `updated_at`

#### `elo_matches`
- Match history
- Fields: `user_id`, `place_a`, `place_b`, `winner_place_id`, `created_at`

#### `posts`
- User-generated reviews
- Fields: `user_id`, `place_id`, `text`, `tags[]`, `created_at`

#### `feed_events`
- Activity stream
- Fields: `actor_id`, `event_type`, `payload` (JSONB), `created_at`

#### `place_cache`
- Google Places data cache
- PK: `place_id`
- TTL: 7 days
- Fields: `name`, `chain`, `city`, `country`, `details` (JSONB)

### Row Level Security (RLS)

All tables have RLS enabled. General pattern:
- **Read**: All authenticated users
- **Write**: Owner only (user_id = auth.uid())
- **Exceptions**: `feed_events` and `place_cache` only writable by service role

## Google Places API

### Quota Management

The backend implements two-tier caching:

1. **Search Results**: Basic info cached on first search
2. **Details**: Full details cached for 7 days

**Tips to minimize quota usage:**
- Search results are cached opportunistically
- Details are only fetched when explicitly requested
- Cache hit rate improves over time as popular hotels are reused

### API Key Setup

1. Enable **Places API** in Google Cloud Console
2. Restrict key to server IP addresses (recommended for production)
3. Set daily quota limits as needed
4. Store key as Supabase secret (never commit to git)

## Scoring Algorithm

### Elo Rating
- Default: 1500
- K-factor: 24
- Expected score: `1 / (1 + 10^((opponent_rating - your_rating) / 400))`
- New rating: `rating + K * (actual_score - expected_score)`

### Score out of 10
```typescript
base10 = clamp((rating - 1000) / 100, 0, 10)
sentiment_offset = { LIKED: +0.7, FINE: 0, DISLIKED: -0.7 }
score10 = clamp(base10 + sentiment_offset, 0, 10)
```

**Examples:**
- Rating 1500, LIKED → `5.0 + 0.7 = 5.7`
- Rating 1800, FINE → `8.0 + 0.0 = 8.0`
- Rating 1200, DISLIKED → `2.0 - 0.7 = 1.3`

## Local Development

### Test Edge Functions Locally

```bash
# Start Supabase local stack
supabase start

# Serve a function locally
supabase functions serve places-search --env-file .env.local

# Test with curl
curl -X GET "http://localhost:54321/functions/v1/places-search?query=Marriott" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get Test JWT Token

Use Supabase Auth in your frontend or generate via:

```bash
# Sign in and get session token from Supabase Auth
supabase auth login
```

## Testing Examples

### Full Flow Example

```bash
# 1. Add hotel to WANT list
curl -X PUT "https://your-project.supabase.co/functions/v1/stays/ChIJ123" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"WANT"}'

# 2. Mark as BEEN with sentiment
curl -X PUT "https://your-project.supabase.co/functions/v1/stays/ChIJ123" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"BEEN","sentiment":"LIKED"}'

# 3. Get battle pair
curl -X POST "https://your-project.supabase.co/functions/v1/elo-battle-pair" \
  -H "Authorization: Bearer $TOKEN"

# 4. Submit match
curl -X POST "https://your-project.supabase.co/functions/v1/elo-submit-match" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"placeAId":"ChIJ123","placeBId":"ChIJ456","winnerPlaceId":"ChIJ123"}'

# 5. Get rankings
curl -X GET "https://your-project.supabase.co/functions/v1/rankings-me" \
  -H "Authorization: Bearer $TOKEN"
```

## Security

### Authentication
- All endpoints verify Supabase JWT
- User ID derived from token (never from request body)
- Service role key used only for feed/cache writes

### RLS Policies
- Profiles: Read all, write own
- Follows: Read all, write own follows only
- Stays/Posts: Read all (hackathon simplicity), write own
- Elo: Read all, write own
- Feed/Cache: Read all, write only via edge functions

### Best Practices
- ✅ JWT verification on every request
- ✅ User ID from auth context, not request body
- ✅ RLS as defense-in-depth
- ✅ Service key only in edge functions
- ✅ Input validation with Zod schemas
- ✅ Transaction safety for Elo updates

## Frontend Integration

### Supabase Client Setup

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

// Auth is handled by Supabase Auth in Expo app
// JWT is automatically included in requests
```

### Calling Edge Functions

```typescript
const { data, error } = await supabase.functions.invoke('stays', {
  method: 'PUT',
  body: {
    place_id: 'ChIJ123',
    status: 'BEEN',
    sentiment: 'LIKED'
  }
})
```

### Direct Database Access (with RLS)

For simple queries, you can use Supabase client directly:

```typescript
// Read user's stays
const { data: stays } = await supabase
  .from('stays')
  .select('*')
  .eq('user_id', user.id)

// Follow user (RLS ensures follower_id matches auth.uid())
await supabase
  .from('follows')
  .insert({ follower_id: user.id, following_id: targetUserId })
```

## Troubleshooting

### "Invalid JWT" error
- Ensure token is fresh (check expiration)
- Verify `Authorization: Bearer <token>` header format
- Check Supabase project URL matches

### "Failed to fetch from Google Places"
- Verify API key is set: `supabase secrets list`
- Check quota limits in Google Cloud Console
- Ensure Places API is enabled

### "Sentiment required for BEEN status"
- BEEN status requires sentiment: LIKED, FINE, or DISLIKED
- WANT status requires sentiment to be null/omitted

### RLS policy errors
- Verify user is authenticated
- Check that `auth.uid()` matches expected user_id
- Review RLS policies in Supabase dashboard

## Production Checklist

- [ ] Set all environment variables/secrets
- [ ] Run database migrations
- [ ] Deploy all edge functions
- [ ] Configure Google Places API key restrictions
- [ ] Set up monitoring/logging
- [ ] Configure CORS for your frontend domain
- [ ] Test all endpoints with real auth tokens
- [ ] Review RLS policies for security
- [ ] Set up database backups
- [ ] Configure rate limiting (Supabase dashboard)

## License

MIT

## Support

For issues or questions, please open an issue on GitHub or contact the team.

---

Built with ❤️ for hackathons. Happy hacking! 🚀
