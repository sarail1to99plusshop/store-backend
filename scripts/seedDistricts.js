/**
 * Seed all 64 districts of Bangladesh into MongoDB Atlas
 */

require('dotenv').config();
const mongoose = require('mongoose');
const District = require('../models/District');
const { BANGLADESH_DISTRICTS } = require('../data/bangladeshDistricts');

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI in environment!');
    process.exit(1);
  }

  console.log('[Seed] Connecting to MongoDB Atlas...');
  await mongoose.connect(uri);
  console.log('[Seed] Connected successfully.');

  const existing = await District.countDocuments();
  console.log(`[Seed] Current districts in DB: ${existing}`);

  if (existing < 64) {
    console.log(`[Seed] Seeding ${BANGLADESH_DISTRICTS.length} districts...`);
    for (const d of BANGLADESH_DISTRICTS) {
      await District.findOneAndUpdate(
        { name: d.name },
        { $set: d },
        { upsert: true, new: true }
      );
    }
    const updatedCount = await District.countDocuments();
    console.log(`[Seed] Successfully seeded. Total districts in DB: ${updatedCount}`);
  } else {
    console.log('[Seed] All 64 districts already present in database. Updating details...');
    for (const d of BANGLADESH_DISTRICTS) {
      await District.findOneAndUpdate(
        { name: d.name },
        { $set: d },
        { upsert: true }
      );
    }
    console.log('[Seed] All 64 districts verified and updated.');
  }

  await mongoose.disconnect();
  console.log('[Seed] Disconnected from MongoDB.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});

