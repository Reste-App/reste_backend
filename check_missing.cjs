const fs = require('fs');
const data = JSON.parse(fs.readFileSync('amex_hotels_with_place_id.json', 'utf8'));

const notFound = data.filter(h => !h.google_place_id || h.google_place_id === null);

console.log('Hotels without Google Place IDs (' + notFound.length + ' total):');
console.log('===========================================');
notFound.forEach((hotel, i) => {
  console.log((i + 1) + '. ' + hotel.name);
  console.log('   Location: ' + hotel.latitude + ', ' + hotel.longitude);
  console.log('');
});
