const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const { Level } = require('../models');
const {
  DEFAULT_LEVEL_DURATION_SECONDS,
  EXTENDED_LEVEL_DURATION_SECONDS,
} = require('../constants');

const INITIAL_LEVELS = [
  {
    number: 1,
    name: 'Level 1',
    entryRiskAmount: 0,
    winningPayout: 50,
    losingPayout: 0,
    safeZoneAmount: 50,
    isSafeZone: true,
    isFinal: false,
    durationSeconds: DEFAULT_LEVEL_DURATION_SECONDS,
    isActive: true,
  },
  {
    number: 2,
    name: 'Level 2',
    entryRiskAmount: 50,
    winningPayout: 100,
    losingPayout: 50,
    safeZoneAmount: 0,
    isSafeZone: false,
    isFinal: false,
    durationSeconds: DEFAULT_LEVEL_DURATION_SECONDS,
    isActive: true,
  },
  {
    number: 3,
    name: 'Level 3',
    entryRiskAmount: 100,
    winningPayout: 150,
    losingPayout: 50,
    safeZoneAmount: 0,
    isSafeZone: false,
    isFinal: false,
    durationSeconds: DEFAULT_LEVEL_DURATION_SECONDS,
    isActive: true,
  },
  {
    number: 4,
    name: 'Level 4',
    entryRiskAmount: 150,
    winningPayout: 250,
    losingPayout: 50,
    safeZoneAmount: 250,
    isSafeZone: true,
    isFinal: false,
    durationSeconds: EXTENDED_LEVEL_DURATION_SECONDS,
    isActive: true,
  },
  {
    number: 5,
    name: 'Level 5',
    entryRiskAmount: 0,
    winningPayout: 350,
    losingPayout: 250,
    safeZoneAmount: 0,
    isSafeZone: false,
    isFinal: false,
    durationSeconds: EXTENDED_LEVEL_DURATION_SECONDS,
    isActive: true,
  },
  {
    number: 6,
    name: 'Level 6',
    entryRiskAmount: 100,
    winningPayout: 500,
    losingPayout: 250,
    safeZoneAmount: 0,
    isSafeZone: false,
    isFinal: true,
    durationSeconds: EXTENDED_LEVEL_DURATION_SECONDS,
    isActive: true,
  },
];

/**
 * Seed script to create initial competition Level documents.
 * Safe to execute multiple times (strictly idempotent, never overwrites or resets existing levels).
 */
const seedLevels = async () => {
  // Load-test runs point at a separate test database via LOAD_TEST_MONGO_URI;
  // normal runs use MONGO_URI exactly as before.
  const mongoUri = process.env.LOAD_TEST_MONGO_URI || process.env.MONGO_URI;

  if (!mongoUri) {
    console.error('[seedLevels] Error: MONGO_URI (or LOAD_TEST_MONGO_URI) environment variable is required.');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);

    let insertedCount = 0;
    let existingCount = 0;

    for (const levelData of INITIAL_LEVELS) {
      const existing = await Level.findOne({ number: levelData.number });

      if (existing) {
        existingCount++;
        console.log(`[seedLevels] Level ${levelData.number} (${existing.name}) already exists. Skipped without modifying.`);
      } else {
        await Level.create(levelData);
        insertedCount++;
        console.log(`[seedLevels] Level ${levelData.number} (${levelData.name}) successfully inserted.`);
      }
    }

    console.log(`[seedLevels] Seeding summary: ${insertedCount} newly inserted, ${existingCount} already existed (total: ${insertedCount + existingCount}).`);

    await mongoose.disconnect();
    if (require.main === module) {
      process.exit(0);
    }
    return { insertedCount, existingCount };
  } catch (error) {
    console.error(`[seedLevels] Failed to seed level documents: ${error.message}`);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    if (require.main === module) {
      process.exit(1);
    }
    throw error;
  }
};

if (require.main === module) {
  seedLevels();
}

module.exports = seedLevels;
module.exports.INITIAL_LEVELS = INITIAL_LEVELS;
