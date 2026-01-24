# Local Testing Guide

How to run and test the Stayca backend locally with Postman.

---

## Quick Start

### 1. Serve Edge Functions Locally

```bash
cd /Users/k0an/Code/stayca

# Serve all functions (connects to your production Supabase DB)
npx supabase functions serve --env-file .env
```

This starts a local server at: `http://localhost:54321/functions/v1/`

### 2. Get a Test JWT Token

You need a valid JWT to call the APIs. Options:

**Option A: Create a test user and get token**
```bash
# In a new terminal, use curl to sign up
curl -X POST 'https://jtuxuahigeqnmjsomuld.supabase.co/auth/v1/signup' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0dXh1YWhpZ2Vxbm1qc29tdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMTM4NzAsImV4cCI6MjA4NDc4OTg3MH0.An-Y2KghyXfPsRIDFWc_cteMRONtBtAAtBAJ2ukqrho' \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"testpassword123"}'
```

**Option B: Sign in existing user**
```bash
curl -X POST 'https://jtuxuahigeqnmjsomuld.supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0dXh1YWhpZ2Vxbm1qc29tdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMTM4NzAsImV4cCI6MjA4NDc4OTg3MH0.An-Y2KghyXfPsRIDFWc_cteMRONtBtAAtBAJ2ukqrho' \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"testpassword123"}'
```

Copy the `access_token` from the response.

### 3. Test with Postman

**Base URL:** `http://localhost:54321/functions/v1`

**Headers (required for all requests):**
```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

---

## Postman Setup

### Create Environment

1. Open Postman → Environments → Create New
2. Add variables:

| Variable | Value |
|----------|-------|
| `base_url` | `http://localhost:54321/functions/v1` |
| `token` | `<paste your access_token here>` |

### Create Collection

Import or create these requests:

---

## API Test Requests

### 1. Places Search
```
GET {{base_url}}/places-search?query=Marriott+NYC
Authorization: Bearer {{token}}
```

### 2. Places Details
```
GET {{base_url}}/places-details?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4
Authorization: Bearer {{token}}
```

### 3. Add to Want List
```
PUT {{base_url}}/stays/ChIJN1t_tDeuEmsRUsoyG83frY4
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "status": "WANT"
}
```

### 4. Mark as Been (with sentiment)
```
PUT {{base_url}}/stays/ChIJN1t_tDeuEmsRUsoyG83frY4
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "status": "BEEN",
  "sentiment": "LIKED"
}
```

### 5. Get Battle Pair
```
POST {{base_url}}/elo-battle-pair
Authorization: Bearer {{token}}
```

### 6. Submit Match
```
POST {{base_url}}/elo-submit-match
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "placeAId": "ChIJN1t_tDeuEmsRUsoyG83frY4",
  "placeBId": "ChIJ2eUgeAK6j4ARbn5u_wAGqWA",
  "winnerPlaceId": "ChIJN1t_tDeuEmsRUsoyG83frY4"
}
```

### 7. Get My Rankings
```
GET {{base_url}}/rankings-me
Authorization: Bearer {{token}}
```

### 8. Get Feed
```
GET {{base_url}}/feed?limit=20
Authorization: Bearer {{token}}
```

### 9. Create Post
```
POST {{base_url}}/posts
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
  "text": "Amazing hotel! Great service.",
  "tags": ["luxury", "business"]
}
```

### 10. Get Profile
```
GET {{base_url}}/profile/<user-id>
Authorization: Bearer {{token}}
```

### 11. Follow User
```
POST {{base_url}}/follow/<user-id>
Authorization: Bearer {{token}}
```

### 12. Unfollow User
```
DELETE {{base_url}}/follow/<user-id>
Authorization: Bearer {{token}}
```

---

## Terminal Commands Reference

```bash
# Start functions server
npx supabase functions serve --env-file .env

# Start specific function only
npx supabase functions serve rankings-me --env-file .env

# View logs (in another terminal)
npx supabase functions logs

# Stop server
Ctrl+C
```

---

## Troubleshooting

### "Not authenticated" or 401 error
- Token expired → Get a new one
- Missing `Authorization` header
- Token format should be: `Bearer <token>` (with space)

### "Function not found" or 404
- Check function name in URL matches folder name
- Ensure `supabase functions serve` is running

### "Google Places API error"
- Check `GOOGLE_PLACES_API_KEY` in `.env`
- Verify API key has Places API enabled

### CORS errors
- Functions include CORS headers automatically
- Make sure you're hitting the correct URL

### Database errors
- Check your Supabase project has the tables created
- Verify RLS policies are applied

---

## Testing Flow Example

1. **Create profile first** (required for other operations):
```bash
# After signing up, create your profile
curl -X POST 'https://jtuxuahigeqnmjsomuld.supabase.co/rest/v1/profiles' \
  -H 'apikey: <anon-key>' \
  -H 'Authorization: Bearer <access-token>' \
  -H 'Content-Type: application/json' \
  -d '{"id":"<your-user-id>","username":"testuser"}'
```

2. **Search for a hotel**
3. **Add to WANT list**
4. **Mark as BEEN with sentiment**
5. **Repeat for 2+ hotels**
6. **Get battle pair**
7. **Submit match**
8. **Check rankings**

---

## Quick Test Script

Save as `test-api.sh`:

```bash
#!/bin/bash
BASE_URL="http://localhost:54321/functions/v1"
TOKEN="<your-token-here>"

echo "Testing Places Search..."
curl -s "$BASE_URL/places-search?query=Hilton" \
  -H "Authorization: Bearer $TOKEN" | head -c 200
echo ""

echo "Testing Rankings..."
curl -s "$BASE_URL/rankings-me" \
  -H "Authorization: Bearer $TOKEN"
echo ""
```

Run with: `chmod +x test-api.sh && ./test-api.sh`

---

## Next Steps

Once local testing works:

1. **Deploy to production:**
   ```bash
   npm run deploy
   ```

2. **Set production secrets:**
   ```bash
   npx supabase secrets set GOOGLE_PLACES_API_KEY=<key>
   npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key>
   ```

3. **Test production endpoints:**
   Change base URL to: `https://jtuxuahigeqnmjsomuld.supabase.co/functions/v1`
