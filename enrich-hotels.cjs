#!/usr/bin/env node

/**
 * Hotel Data Enrichment Script
 *
 * Adds Google Place IDs to Amex hotels using Google Places API (New)
 *
 * Cost Control: Uses X-Goog-FieldMask to fetch only place.id (Essentials tier)
 * Safety: Saves progress every 100 entries
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=your-key node enrich-hotels.js
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

// Load .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    env.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        process.env[key.trim()] = value.trim();
      }
    });
  }
}

loadEnv();

const INPUT_FILE = 'amex_hotels.json';
const OUTPUT_FILE = 'amex_hotels_with_place_id.json';
const PROGRESS_FILE = 'enrichment_progress.json';
const BATCH_SIZE = 100; // Save progress every 100 entries

// Google Places API (New) endpoint
const API_BASE = 'places.googleapis.com';
const API_PATH = '/v1/places:searchText';

// Load or resume progress
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    console.log(`✓ Resuming from index ${data.lastProcessedIndex}`);
    return data;
  }
  return { lastProcessedIndex: 0 };
}

// Save progress
function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Extract location context from Amex reservation URL
// URL format: .../property/{Region}/{City}/{Hotel-Name}
function extractLocationFromUrl(url) {
  try {
    const match = url.match(/\/property\/([^/]+)\/([^/]+)\//);
    if (match) {
      const region = match[1].replace(/-/g, ' ');
      const city = match[2].replace(/-/g, ' ');
      return { region, city };
    }
  } catch (e) {
    // Ignore URL parse errors
  }
  return {};
}

// Search Google Places API for hotel
function searchGooglePlace(hotel, apiKey) {
  return new Promise((resolve, reject) => {
    const { name, latitude, longitude, Amex_Reservation } = hotel;

    // Extract location from URL for better search context
    const { city, region } = extractLocationFromUrl(Amex_Reservation || '');
    const locationContext = city ? `${city}, ${region}` : '';

    // Build search query
    const searchQuery = locationContext ? `${name}, ${locationContext}` : name;

    // Request body
    const requestBody = JSON.stringify({
      textQuery: searchQuery,
      locationBias: {
        circle: {
          center: {
            latitude: latitude,
            longitude: longitude
          },
          radius: 5000.0 // 5km radius
        }
      },
      includedType: 'lodging'
    });

    // Request options
    const options = {
      hostname: API_BASE,
      path: `${API_PATH}?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-FieldMask': 'places.id', // CRITICAL: Cost control - fetch only ID
        'X-Goog-Api-Key': apiKey
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const response = JSON.parse(data);

            if (response.places && response.places.length > 0) {
              // Return the first (most relevant) place ID
              resolve(response.places[0].id);
            } else {
              resolve(null); // No results found
            }
          } else {
            console.error(`  API Error ${res.statusCode}: ${data}`);
            resolve(null); // Continue on error
          }
        } catch (e) {
          console.error(`  Parse error: ${e.message}`);
          resolve(null);
        }
      });
    });

    req.on('error', (error) => {
      console.error(`  Request error: ${error.message}`);
      resolve(null); // Continue on error
    });

    req.write(requestBody);
    req.end();
  });
}

// Main processing function
async function processHotels() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    console.error('❌ Error: GOOGLE_PLACES_API_KEY environment variable not set');
    console.error('   Usage: GOOGLE_PLACES_API_KEY=your-key node enrich-hotels.js');
    process.exit(1);
  }

  console.log('🏨 Hotel Data Enrichment Started');
  console.log(`📂 Input: ${INPUT_FILE}`);
  console.log(`📤 Output: ${OUTPUT_FILE}`);
  console.log(`💾 Progress: ${PROGRESS_FILE}`);
  console.log(`🔄 Save interval: every ${BATCH_SIZE} entries\n`);

  // Load input data
  console.log('📖 Loading hotel data...');
  const hotels = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const totalHotels = hotels.length;
  console.log(`   Found ${totalHotels} hotels\n`);

  // Load progress
  const progress = loadProgress();
  let startIndex = progress.lastProcessedIndex;

  // Check if already completed
  if (startIndex >= totalHotels) {
    console.log('✅ All hotels already processed!');
    console.log(`   Output: ${OUTPUT_FILE}`);
    return;
  }

  // Process hotels
  let successCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  console.log(`🔍 Starting from hotel #${startIndex + 1}...\n`);

  for (let i = startIndex; i < totalHotels; i++) {
    const hotel = hotels[i];

    // Skip if already has google_place_id
    if (hotel.google_place_id) {
      console.log(`[${i + 1}/${totalHotels}] ✓ Already has place_id: ${hotel.name}`);
      continue;
    }

    process.stdout.write(`[${i + 1}/${totalHotels}] Searching: ${hotel.name}... `);

    try {
      // Rate limiting: wait 100ms between requests
      if (i > startIndex) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Search Google Places
      const placeId = await searchGooglePlace(hotel, apiKey);

      if (placeId) {
        hotel.google_place_id = placeId;
        successCount++;
        console.log(`✓ ${placeId}`);
      } else {
        hotel.google_place_id = null;
        notFoundCount++;
        console.log(`✗ Not found`);
      }

      // Save progress every BATCH_SIZE entries
      if ((i + 1) % BATCH_SIZE === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(hotels, null, 2));
        saveProgress({ lastProcessedIndex: i + 1 });
        console.log(`\n💾 Progress saved (${i + 1}/${totalHotels})\n`);
      }

    } catch (error) {
      errorCount++;
      console.error(`✗ Error: ${error.message}`);
      hotel.google_place_id = null;
    }
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(hotels, null, 2));
  saveProgress({ lastProcessedIndex: totalHotels });

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ Processing complete!');
  console.log('='.repeat(60));
  console.log(`📊 Statistics:`);
  console.log(`   Total processed: ${totalHotels}`);
  console.log(`   ✓ Place IDs found: ${successCount} (${((successCount/totalHotels)*100).toFixed(1)}%)`);
  console.log(`   ✗ Not found: ${notFoundCount} (${((notFoundCount/totalHotels)*100).toFixed(1)}%)`);
  console.log(`   ⚠ Errors: ${errorCount} (${((errorCount/totalHotels)*100).toFixed(1)}%)`);
  console.log(`\n📤 Output saved to: ${OUTPUT_FILE}`);
  console.log(`💾 Progress saved to: ${PROGRESS_FILE}`);
  console.log('\n🚀 Ready for Supabase upload!');
}

// Run the script
processHotels().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
