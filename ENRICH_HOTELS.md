# Hotel Data Enrichment Guide

This script adds Google Place IDs to the Amex hotels dataset for Supabase upload.

## Features

✅ **Cost Control**: Uses `X-Goog-FieldMask: places.id` to fetch only place IDs (Essentials tier)
✅ **Safety**: Saves progress every 100 entries - no data loss if interrupted
✅ **Resumable**: Automatically resumes from last processed index
✅ **Smart Search**: Uses hotel name + location from coordinates + city from URL

## Prerequisites

```bash
# Set your Google Places API key
export GOOGLE_PLACES_API_KEY=your-api-key-here
```

**Important**: Make sure your Google Cloud project has the Places API (New) enabled.

## Usage

### From the stayca_backend directory:

```bash
# Run the enrichment script
GOOGLE_PLACES_API_KEY=your-key node enrich-hotels.js
```

## What It Does

1. **Reads**: `amex_hotels.json` (3,106 hotels)
2. **Searches**: Google Places API (New) using:
   - Hotel name
   - Location bias from lat/long
   - City/region extracted from Amex URL
3. **Adds**: `google_place_id` field to each hotel
4. **Saves**:
   - Progress every 100 entries → `enrichment_progress.json`
   - Final output → `amex_hotels_with_place_id.json`

## Cost Control

The script uses the **Google Places API (New)** with field masking to minimize costs:

```javascript
X-Goog-FieldMask: places.id  // Only fetch place ID, nothing else
```

This keeps requests in the **Essentials tier** (free tier includes 10,000 requests/day).

**Estimated cost for 3,106 hotels:**
- With field mask: ~3,106 Essentials requests = **FREE** (within daily quota)
- Without field mask: ~3,106 "Advanced" requests = ~$62.12

## Output Files

### `amex_hotels_with_place_id.json`
Enriched dataset with new field:
```json
{
  "name": "1 Hotel Hanalei Bay",
  "latitude": 22.2206,
  "longitude": -159.497,
  "google_place_id": "ChIJLY7YSYh5AhQAGXWn0DExN6o",
  ...
}
```

### `enrichment_progress.json`
Resume capability:
```json
{
  "lastProcessedIndex": 500
}
```

## Example Output

```
🏨 Hotel Data Enrichment Started
📂 Input: amex_hotels.json
📤 Output: amex_hotels_with_place_id.json
💾 Progress: enrichment_progress.json
🔄 Save interval: every 100 entries

📖 Loading hotel data...
   Found 3106 hotels

🔍 Starting from hotel #1...

[1/3106] Searching: 1 Hotel Hanalei Bay... ✓ ChIJLY7YSYh5AhQAGXWn0DExN6o
[2/3106] Searching: 1 Hotel Mayfair... ✓ ChIJAVkDPzdOahcRc11c3W7XU6Y
[3/3106] Searching: 1 Hotel Nashville... ✓ ChIJ9Y0xRnjxeVgR7q2YBqk5l2g

💾 Progress saved (100/3106)

...

============================================================
✅ Processing complete!
============================================================
📊 Statistics:
   Total processed: 3106
   ✓ Place IDs found: 2987 (96.2%)
   ✗ Not found: 98 (3.2%)
   ⚠ Errors: 21 (0.7%)

📤 Output saved to: amex_hotels_with_place_id.json
💾 Progress saved to: enrichment_progress.json

🚀 Ready for Supabase upload!
```

## Troubleshooting

### "GOOGLE_PLACES_API_KEY not set"
```bash
export GOOGLE_PLACES_API_KEY=your-key
```

### API quota exceeded
- Wait 24 hours for quota to reset
- Or upgrade to paid plan

### Script interrupted
- Just run again - it will resume from last save point
- Progress is saved every 100 entries

### High "Not found" rate
- Some hotels may not be on Google Places
- Manual verification needed for missing entries

## Next Steps

After enrichment:

1. **Review results**: Check match rate in summary
2. **Manual verification**: Verify hotels without place IDs
3. **Upload to Supabase**: Use the enriched JSON for database import

## Rate Limiting

The script includes 100ms delay between requests to avoid rate limiting:
- Total time for 3,106 hotels: ~5 minutes
- Respects API rate limits

## Safety Features

✅ Progress saved every 100 entries
✅ Automatic resume on restart
✅ Continues on API errors (doesn't stop)
✅ Rate limiting to avoid throttling
✅ Clear console output for monitoring

## License

MIT
