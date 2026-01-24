# Stayca Backend - File Structure

Complete backend implementation for the hotel ranking app.

## 📁 Project Structure

```
stayca/
├── README.md                          # Complete documentation
├── API.md                             # Quick API reference
├── .env.example                       # Environment template
├── .gitignore                         # Git ignore rules
├── deploy.sh                          # Deployment script
│
├── supabase/
│   ├── config.toml                    # Supabase configuration
│   │
│   ├── migrations/
│   │   ├── 001_schema.sql            # Database schema
│   │   ├── 002_rls_policies.sql      # Row Level Security
│   │   └── 003_elo_function.sql      # Atomic Elo update function
│   │
│   └── functions/
│       ├── package.json               # Dependencies
│       ├── tsconfig.json              # TypeScript config
│       │
│       ├── _shared/
│       │   └── utils.ts               # Shared utilities (auth, errors)
│       │
│       ├── places-search/
│       │   └── index.ts               # Google Places search proxy
│       │
│       ├── places-details/
│       │   └── index.ts               # Google Places details proxy
│       │
│       ├── stays/
│       │   └── index.ts               # Add/update hotel to user list
│       │
│       ├── elo-battle-pair/
│       │   └── index.ts               # Get two hotels for comparison
│       │
│       ├── elo-submit-match/
│       │   └── index.ts               # Submit comparison result
│       │
│       ├── rankings-me/
│       │   └── index.ts               # Get user's ranked hotels
│       │
│       ├── feed/
│       │   └── index.ts               # Activity feed
│       │
│       ├── posts/
│       │   └── index.ts               # Create post/review
│       │
│       ├── follow/
│       │   └── index.ts               # Follow/unfollow users
│       │
│       └── profile/
│           └── index.ts               # View/update profile
```

## 📊 Database Schema

### Tables Created
1. **profiles** - User profiles extending auth.users
2. **follows** - Social graph (follower/following)
3. **stays** - User's hotel list (WANT/BEEN + sentiment)
4. **elo_ratings** - Per-user per-place Elo ratings
5. **elo_matches** - Pairwise comparison history
6. **posts** - User-generated reviews
7. **feed_events** - Activity stream
8. **place_cache** - Google Places data cache (7-day TTL)

### Key Constraints
- Sentiment required for BEEN status, null for WANT
- No self-follows
- Unique (user_id, place_id) for stays
- Rating bounds: 0-3000
- Username format: 3-30 chars, alphanumeric + underscore

## 🔒 Security

### RLS Policies
- All tables require authentication
- Users can only write their own data
- All data readable by authenticated users (hackathon simplicity)
- feed_events and place_cache writable only by service role

### Auth
- JWT verification on every request
- User ID derived from token, never from request body
- Service role key only used in edge functions for system writes

## 🚀 Edge Functions (10 endpoints)

| Function | Method | Purpose |
|----------|--------|---------|
| places-search | GET | Search hotels via Google Places |
| places-details | GET | Get hotel details with caching |
| stays | PUT | Add/update hotel status & sentiment |
| elo-battle-pair | POST | Get two hotels for comparison |
| elo-submit-match | POST | Submit comparison & update Elo |
| rankings-me | GET | Get user's ranked BEEN list |
| feed | GET | Activity feed from followed users |
| posts | POST | Create hotel review |
| follow | POST/DELETE | Follow/unfollow users |
| profile | GET/PATCH | View/update user profile |

## 🎯 Key Features

### Elo Rating System
- Default rating: 1500
- K-factor: 24
- Smart pairing: prefers close ratings + low games played
- Atomic updates via PostgreSQL function

### Score Calculation
```
base10 = (elo - 1000) / 100, clamped [0, 10]
sentiment_offset = LIKED: +0.7, FINE: 0, DISLIKED: -0.7
score10 = base10 + offset, clamped [0, 10]
```

### Caching Strategy
- Search: Basic info cached on first fetch
- Details: Full cache for 7 days
- Reduces Google Places API quota usage

### Feed System
- Events: FOLLOW, POST, ELO_MATCH, MARK_BEEN, WISHLIST
- Cursor-based pagination
- Shows activity from followed users only

## 📦 Dependencies

```json
{
  "@supabase/supabase-js": "^2.39.0",
  "zod": "^3.22.4"
}
```

## ⚙️ Setup Commands

```bash
# Link to Supabase project
supabase link --project-ref your-project-ref

# Set secrets
supabase secrets set GOOGLE_PLACES_API_KEY=your-key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-key

# Run migrations
supabase db push

# Deploy all functions
./deploy.sh

# Or deploy individually
supabase functions deploy places-search
```

## 🧪 Testing

```bash
# Start local Supabase
supabase start

# Test function locally
supabase functions serve stays --env-file .env.local

# Example curl
curl -X PUT "http://localhost:54321/functions/v1/stays/ChIJ123" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"BEEN","sentiment":"LIKED"}'
```

## 📝 API Response Examples

### Rankings
```json
{
  "rankings": [
    {
      "place_id": "ChIJ...",
      "name": "Grand Hotel",
      "rating": 1650.5,
      "score10": 7.2,
      "sentiment": "LIKED",
      "games_played": 12,
      "city": "New York"
    }
  ]
}
```

### Feed Event
```json
{
  "events": [
    {
      "event_type": "MARK_BEEN",
      "payload": {
        "username": "alice",
        "place_name": "Marriott",
        "sentiment": "LIKED"
      },
      "created_at": "2024-01-15T12:00:00Z"
    }
  ]
}
```

## 🎓 Design Decisions

1. **Hackathon-optimized**: Public read access for simplicity
2. **Server-side Places API**: Keeps key secure, enables caching
3. **Sentiment + Elo**: Elo for ordering, sentiment for UX bias
4. **Denormalized feed**: Write on action, fast reads
5. **Atomic Elo updates**: PostgreSQL function for race condition safety
6. **7-day cache**: Balance between freshness and quota
7. **Zod validation**: Type-safe input validation
8. **RLS defense-in-depth**: Even though edge functions verify JWT

## 🔮 Future Enhancements

- [ ] Photo uploads to Supabase Storage
- [ ] Search users endpoint
- [ ] Pagination for rankings
- [ ] Elo rating history/charts
- [ ] Hotel recommendations based on friend rankings
- [ ] Batch Elo updates
- [ ] WebSocket real-time feed
- [ ] Admin moderation tools
- [ ] Analytics dashboard
- [ ] Export rankings to PDF/CSV

## 📄 Files Delivered

### Documentation (3 files)
- `README.md` - Complete setup guide
- `API.md` - Quick API reference
- `SUMMARY.md` - This file

### Database (3 files)
- `001_schema.sql` - Tables, constraints, indexes
- `002_rls_policies.sql` - Security policies
- `003_elo_function.sql` - Atomic Elo update function

### Edge Functions (11 files)
- `_shared/utils.ts` - Common utilities
- `places-search/index.ts`
- `places-details/index.ts`
- `stays/index.ts`
- `elo-battle-pair/index.ts`
- `elo-submit-match/index.ts`
- `rankings-me/index.ts`
- `feed/index.ts`
- `posts/index.ts`
- `follow/index.ts`
- `profile/index.ts`

### Configuration (5 files)
- `.env.example` - Environment template
- `.gitignore` - Git ignore rules
- `config.toml` - Supabase config
- `package.json` - Dependencies
- `tsconfig.json` - TypeScript config

### Scripts (1 file)
- `deploy.sh` - One-command deployment

**Total: 23 files**

---

Built for hackathons. Ship fast! 🚀
