# Stayca Backend - Production Deployment Checklist

Complete this checklist before launching to production.

## ✅ Pre-Deployment

### 1. Supabase Project Setup

- [ ] Create Supabase project (or link existing)
- [ ] Note project URL and keys
- [ ] Enable billing (if needed for production usage)
- [ ] Configure project settings:
  - [ ] Set project name
  - [ ] Configure region (close to users)
  - [ ] Set up custom domain (optional)

### 2. Google Places API

- [ ] Create Google Cloud project
- [ ] Enable Places API
- [ ] Create API key
- [ ] Restrict API key:
  - [ ] Set application restrictions (HTTP referrers or IP)
  - [ ] Set API restrictions (Places API only)
- [ ] Set quota limits
- [ ] Enable billing alerts
- [ ] Note API key securely

### 3. Environment Configuration

- [ ] Copy `.env.example` to `.env.local`
- [ ] Fill in all required values:
  ```bash
  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_ANON_KEY=your-anon-key
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  GOOGLE_PLACES_API_KEY=your-google-api-key
  ```
- [ ] Set Supabase secrets:
  ```bash
  supabase secrets set GOOGLE_PLACES_API_KEY=your-key
  supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-key
  ```
- [ ] Verify secrets are set:
  ```bash
  supabase secrets list
  ```

### 4. Database Setup

- [ ] Link to Supabase project:
  ```bash
  supabase link --project-ref your-project-ref
  ```
- [ ] Review migrations:
  - [ ] `001_schema.sql` - Tables and constraints
  - [ ] `002_rls_policies.sql` - Security policies
  - [ ] `003_elo_function.sql` - Elo update function
- [ ] Run migrations:
  ```bash
  supabase db push
  ```
- [ ] Verify tables created in Supabase dashboard
- [ ] Verify RLS policies enabled
- [ ] Test PostgreSQL function:
  ```sql
  SELECT update_elo_ratings(
    'test-user-id'::uuid,
    'place_a',
    'place_b',
    'place_a',
    24
  );
  ```

## ✅ Deployment

### 5. Edge Functions

- [ ] Review all function code for hardcoded values
- [ ] Make deploy script executable:
  ```bash
  chmod +x deploy.sh
  ```
- [ ] Deploy all functions:
  ```bash
  ./deploy.sh
  ```
- [ ] Verify deployment in Supabase dashboard
- [ ] Check function logs for errors

### 6. Testing

- [ ] Get test JWT token from frontend
- [ ] Test each endpoint:

**Places:**
```bash
# Search
curl -X GET "https://your-project.supabase.co/functions/v1/places-search?query=Marriott" \
  -H "Authorization: Bearer $TOKEN"

# Details
curl -X GET "https://your-project.supabase.co/functions/v1/places-details?place_id=ChIJ..." \
  -H "Authorization: Bearer $TOKEN"
```

**Stays:**
```bash
curl -X PUT "https://your-project.supabase.co/functions/v1/stays/ChIJ..." \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"WANT"}'
```

**Elo:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/elo-battle-pair" \
  -H "Authorization: Bearer $TOKEN"

curl -X POST "https://your-project.supabase.co/functions/v1/elo-submit-match" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"placeAId":"...","placeBId":"...","winnerPlaceId":"..."}'
```

**Rankings:**
```bash
curl -X GET "https://your-project.supabase.co/functions/v1/rankings-me" \
  -H "Authorization: Bearer $TOKEN"
```

**Social:**
```bash
# Profile
curl -X GET "https://your-project.supabase.co/functions/v1/profile/USER_ID" \
  -H "Authorization: Bearer $TOKEN"

# Follow
curl -X POST "https://your-project.supabase.co/functions/v1/follow/USER_ID" \
  -H "Authorization: Bearer $TOKEN"

# Feed
curl -X GET "https://your-project.supabase.co/functions/v1/feed?limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Post
curl -X POST "https://your-project.supabase.co/functions/v1/posts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"place_id":"...","text":"Great hotel!"}'
```

- [ ] All endpoints return 200/201 on success
- [ ] Error cases return appropriate status codes
- [ ] JWT validation works (test with invalid token)
- [ ] RLS policies enforce ownership

## ✅ Security Review

### 7. Authentication & Authorization

- [ ] JWT verification enabled on all endpoints
- [ ] User ID derived from token, not request body
- [ ] Service role key only used for system writes
- [ ] RLS policies enabled on all tables
- [ ] Test: Cannot read/write other users' data
- [ ] Test: Cannot bypass RLS with direct Postgres access

### 8. API Security

- [ ] CORS configured correctly
- [ ] Rate limiting configured (Supabase dashboard)
- [ ] Google API key restrictions applied
- [ ] No secrets in code or logs
- [ ] Error messages don't leak sensitive info

### 9. Data Validation

- [ ] All inputs validated with Zod schemas
- [ ] SQL injection protected (parameterized queries)
- [ ] XSS protected (JSON responses, no HTML)
- [ ] Sentiment validation: BEEN requires sentiment
- [ ] Elo winner validation: must be A or B

## ✅ Performance & Monitoring

### 10. Performance Optimization

- [ ] Database indexes created (automatic from schema)
- [ ] Place cache TTL configured (7 days)
- [ ] Elo updates use atomic transaction
- [ ] Feed events denormalized for fast reads
- [ ] Verify query performance in dashboard

### 11. Monitoring & Logging

- [ ] Enable Supabase logging
- [ ] Set up log aggregation
- [ ] Configure alerts:
  - [ ] Error rate threshold
  - [ ] High latency warnings
  - [ ] Database connection errors
- [ ] Monitor Google Places API quota usage
- [ ] Set up cost alerts

### 12. Backup & Recovery

- [ ] Enable automatic database backups
- [ ] Test database restore procedure
- [ ] Document recovery steps
- [ ] Export schema for version control

## ✅ Frontend Integration

### 13. Frontend Configuration

- [ ] Update frontend `.env` with production URLs:
  ```
  EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
  ```
- [ ] Test Supabase Auth in frontend
- [ ] Test all edge function calls
- [ ] Verify JWT auto-renewal works
- [ ] Test offline behavior

### 14. User Experience

- [ ] Error messages are user-friendly
- [ ] Loading states implemented
- [ ] Retry logic for failed requests
- [ ] Graceful degradation if API down

## ✅ Documentation

### 15. Documentation Review

- [ ] README.md is complete
- [ ] API.md has all endpoints documented
- [ ] ARCHITECTURE.md explains system design
- [ ] Environment variables documented
- [ ] Deployment steps documented
- [ ] Troubleshooting guide included

### 16. Code Quality

- [ ] Code follows TypeScript best practices
- [ ] No hardcoded secrets or magic numbers
- [ ] Consistent error handling
- [ ] Console.log statements reviewed
- [ ] TODOs resolved or documented

## ✅ Launch Preparation

### 17. Load Testing

- [ ] Test with 100+ concurrent users
- [ ] Monitor database connection pool
- [ ] Check Elo calculation performance
- [ ] Verify cache hit rates
- [ ] Measure API response times

### 18. Cost Estimation

- [ ] Calculate expected Supabase costs:
  - [ ] Database size projection
  - [ ] API request volume
  - [ ] Edge function invocations
  - [ ] Storage requirements
- [ ] Calculate Google Places API costs:
  - [ ] Search requests per day
  - [ ] Details requests per day
  - [ ] Cache hit rate impact
- [ ] Set budget alerts

### 19. Compliance & Legal

- [ ] Privacy policy covers data collection
- [ ] Terms of service updated
- [ ] GDPR compliance (if EU users):
  - [ ] Data export capability
  - [ ] Account deletion flow
  - [ ] Consent mechanisms
- [ ] Google Places attribution displayed in UI

## ✅ Post-Launch

### 20. Monitoring (First 24 Hours)

- [ ] Monitor error rates
- [ ] Check API response times
- [ ] Verify cache is populating
- [ ] Monitor database load
- [ ] Check Google Places quota usage
- [ ] Review user feedback

### 21. Incident Response

- [ ] Document rollback procedure
- [ ] Set up on-call rotation
- [ ] Create incident response template
- [ ] Test alerting system

### 22. Continuous Improvement

- [ ] Set up analytics
- [ ] Track key metrics:
  - [ ] DAU/MAU
  - [ ] Elo matches per user
  - [ ] Average hotels per user
  - [ ] Cache hit rate
  - [ ] API latency percentiles
- [ ] Collect user feedback
- [ ] Plan next features

## 🚨 Emergency Contacts

```
Supabase Support: support@supabase.io
Google Cloud Support: [your support level]
Team Contact: [your team email/slack]
On-Call Engineer: [rotation schedule]
```

## 📊 Success Metrics

Track these KPIs post-launch:

- **Technical:**
  - API uptime: > 99.9%
  - P95 latency: < 500ms
  - Error rate: < 0.1%
  - Cache hit rate: > 80%

- **Business:**
  - User signups
  - Hotels marked as BEEN
  - Elo matches completed
  - Social interactions (follows, posts)

- **Cost:**
  - Supabase monthly cost
  - Google Places API cost
  - Cost per active user

## 🎯 Launch Day Checklist

**T-1 Day:**
- [ ] Final code freeze
- [ ] All tests passing
- [ ] Staging environment validated
- [ ] Team briefed on launch plan

**Launch Day:**
- [ ] Deploy at low-traffic time
- [ ] Monitor dashboard continuously
- [ ] Test critical user flows
- [ ] Announce to users
- [ ] Team on standby for issues

**T+1 Day:**
- [ ] Review metrics
- [ ] Check error logs
- [ ] Optimize hot paths
- [ ] Document learnings

---

## ✅ Final Sign-Off

| Item | Status | Signed By | Date |
|------|--------|-----------|------|
| Database | ☐ Ready | _______ | ____ |
| Functions | ☐ Ready | _______ | ____ |
| Security | ☐ Ready | _______ | ____ |
| Testing | ☐ Ready | _______ | ____ |
| Monitoring | ☐ Ready | _______ | ____ |

**Approved for Production:** ☐ Yes ☐ No

**Launch Date:** ________________

**Notes:**
```
[Add any last-minute notes or concerns here]
```

---

🚀 **Ready to ship!** Good luck with your launch!
