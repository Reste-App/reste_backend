#!/usr/bin/env node

/**
 * Upload Amex Hotels to Supabase
 *
 * Loads enriched hotel data and uploads to the hotels table
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INPUT_FILE = 'amex_hotels_unique.json';
const BATCH_SIZE = 100; // Insert in batches of 100

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

// Insert a batch of hotels into Supabase
function insertHotels(hotels) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/hotels`);

    const postData = JSON.stringify(hotels);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=minimal'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 200) {
          resolve();
        } else {
          console.error(`  ❌ Insert failed with status ${res.statusCode}: ${data}`);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error(`  ❌ Request error: ${error.message}`);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

// Transform hotel data to match database schema
function transformHotel(hotel) {
  return {
    name: hotel.name,
    latitude: hotel.latitude,
    longitude: hotel.longitude,
    google_place_id: hotel.google_place_id || null,
    program: hotel.Program || null,
    credit: hotel.Credit || null,
    early_checkin: hotel.EarlyCheckin || null,
    free_breakfast: hotel.FreeBreakfast || null,
    free_wifi: hotel.FreeWiFi || null,
    late_checkout: hotel.LateCheckout || null,
    room_upgrade: hotel.RoomUpgrade || null,
    price_calendar: hotel.Price_Calendar || null,
    amex_reservation: hotel.Amex_Reservation || null,
    hotelft_link: hotel.hotelft_link || null
  };
}

// Main upload function
async function uploadHotels() {
  console.log('🏨 Uploading Amex Hotels to Supabase');
  console.log(`📂 Input: ${INPUT_FILE}`);
  console.log(`🔗 URL: ${SUPABASE_URL}`);
  console.log(`📦 Batch size: ${BATCH_SIZE}`);
  console.log('');

  // Load hotel data
  console.log('📖 Loading hotel data...');
  const hotels = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

  // Filter out hotels without google_place_id
  const validHotels = hotels.filter(h => h.google_place_id && h.google_place_id !== null);
  const skipped = hotels.length - validHotels.length;

  console.log(`   Total hotels: ${hotels.length}`);
  console.log(`   ✓ With place IDs: ${validHotels.length}`);
  if (skipped > 0) {
    console.log(`   ✗ Skipping ${skipped} without place IDs`);
  }
  console.log('');

  // Transform data
  console.log('🔄 Transforming data...');
  const transformedHotels = validHotels.map(transformHotel);
  console.log(`   Transformed ${transformedHotels.length} hotels`);
  console.log('');

  // Upload in batches
  console.log('📤 Uploading to Supabase...');
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < transformedHotels.length; i += BATCH_SIZE) {
    const batch = transformedHotels.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(transformedHotels.length / BATCH_SIZE);

    process.stdout.write(`[Batch ${batchNum}/${totalBatches}] Uploading ${batch.length} hotels... `);

    try {
      await insertHotels(batch);
      successCount += batch.length;
      console.log(`✓ Total uploaded: ${successCount}`);
    } catch (error) {
      errorCount += batch.length;
      console.error(`✗ Failed: ${error.message}`);
    }

    // Small delay between batches
    if (i + BATCH_SIZE < transformedHotels.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Summary
  console.log('');
  console.log('='.repeat(60));
  console.log('✅ Upload complete!');
  console.log('='.repeat(60));
  console.log(`📊 Statistics:`);
  console.log(`   Successfully uploaded: ${successCount}`);
  console.log(`   Failed: ${errorCount}`);
  console.log(`   Total processed: ${transformedHotels.length}`);
  console.log('');
  console.log('💡 Next steps:');
  console.log('   1. Verify data in Supabase dashboard');
  console.log('   2. Test lookup via SQL: SELECT * FROM hotels LIMIT 5;');
  console.log('   3. Integrate with frontend to fetch Amex benefits');
}

// Run the upload
uploadHotels().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
