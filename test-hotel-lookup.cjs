#!/usr/bin/env node

/**
 * Test the hotel-lookup edge function
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
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Test place IDs
const TEST_PLACE_IDS = [
  'ChIJ42jWmyb7BnwRvITHyt_VlUY', // 1 Hotel Hanalei Bay (should exist)
  'ChIJLcpxhKcFdkgRfWjpSLIzZ_4', // 1 Hotel Mayfair (should exist)
  'invalid_place_id_12345',       // Should return null
];

async function testHotelLookup(placeId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/functions/v1/hotel-lookup`);
    url.searchParams.append('place_id', placeId);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({ status: res.statusCode, data: response });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing hotel-lookup edge function');
  console.log(`🔗 URL: ${SUPABASE_URL}/functions/v1/hotel-lookup`);
  console.log('');

  for (const placeId of TEST_PLACE_IDS) {
    console.log(`\n📍 Testing place_id: ${placeId}`);
    console.log('─'.repeat(60));

    try {
      const result = await testHotelLookup(placeId);

      if (result.status === 200) {
        if (result.data.hotel) {
          console.log(`✅ Found hotel: ${result.data.hotel.name}`);
          console.log(`   Program: ${result.data.hotel.program}`);
          console.log(`   Breakfast: ${result.data.hotel.free_breakfast || 'N/A'}`);
          console.log(`   Upgrade: ${result.data.hotel.room_upgrade || 'N/A'}`);
          console.log(`   Credit: ${result.data.hotel.credit || 'N/A'}`);
        } else {
          console.log(`✅ No hotel found (returned null as expected)`);
        }
      } else {
        console.log(`❌ Error: HTTP ${result.status}`);
        console.log(`   ${JSON.stringify(result.data)}`);
      }
    } catch (error) {
      console.log(`❌ Request failed: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Testing complete!');
}

runTests().catch(console.error);
