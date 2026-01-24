const fs = require('fs');

const data = JSON.parse(fs.readFileSync('amex_hotels_with_place_id.json', 'utf8'));

// Find duplicates, keeping first occurrence
const seen = new Set();
const unique = [];

data.forEach(hotel => {
  if (hotel.google_place_id) {
    if (!seen.has(hotel.google_place_id)) {
      seen.add(hotel.google_place_id);
      unique.push(hotel);
    }
  }
});

console.log('Original: ' + data.length);
console.log('Unique: ' + unique.length);
console.log('Duplicates removed: ' + (data.length - unique.length));

// Write deduplicated file
fs.writeFileSync('amex_hotels_unique.json', JSON.stringify(unique, null, 2));
console.log('✓ Saved to amex_hotels_unique.json');
