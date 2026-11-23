const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Load environment variables from backend/.env and current environment
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const { Level } = require('../models');
const { INITIAL_LEVELS } = require('./seedLevels');

/**
 * One-time script: apply the stage-3 level changes to the STORED Level
 * documents. The seed script never overwrites existing documents, so editing
 * the seed alone changes nothing in a live database — this script closes
 * that gap. It updates ONLY the fields listed below, reading the target
 * values from the seed ladder (the single source of truth); every other
 * field — including any timer an admin changed — is left untouched.
 *
 *   - Level 1: losingPayout -> seed value (0; failing L1 pays nothing)
 *   - Levels 4, 5, 6: durationSeconds -> seed value (300; 5-minute rounds)
 *
 * Idempotent: re-running changes nothing and reports every level as already
 * correct. Run once, manually, from the backend directory:
 *
 *   node scripts/updateLevels.js
 */
const LEVEL_UPDATES = [
  { number: 1, fields: ['losingPayout'] },
  { number: 4, fields: ['durationSeconds'] },
  { number: 5, fields: ['durationSeconds'] },
  { number: 6, fields: ['durationSeconds'] },
];

const updateLevels = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error('[updateLevels] Error: MONGO_URI environment variable is required.');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);

    let updatedCount = 0;
    let alreadyCorrectCount = 0;
    let missingCount = 0;

    for (const { number, fields } of LEVEL_UPDATES) {
      const seedLevel = INITIAL_LEVELS.find((level) => level.number === number);
      const stored = await Level.findOne({ number });

      if (!stored) {
        missingCount++;
        console.log(`[updateLevels] Level ${number} not found in the database. Skipped (run the seed script to create it).`);
        continue;
      }

      const changes = {};
      for (const field of fields) {
        if (stored[field] !== seedLevel[field]) {
          changes[field] = seedLevel[field];
        }
      }

      if (Object.keys(changes).length === 0) {
        alreadyCorrectCount++;
        console.log(`[updateLevels] Level ${number} already correct. No change.`);
        continue;
      }

      await Level.updateOne({ number }, { $set: changes }, { runValidators: true });
      updatedCount++;
      for (const [field, newValue] of Object.entries(changes)) {
        console.log(`[updateLevels] Level ${number}: ${field} ${stored[field]} -> ${newValue}.`);
      }
    }

    console.log(`[updateLevels] Summary: ${updatedCount} updated, ${alreadyCorrectCount} already correct, ${missingCount} missing (total: ${LEVEL_UPDATES.length}).`);

    await mongoose.disconnect();
    if (require.main === module) {
      process.exit(0);
    }
    return { updatedCount, alreadyCorrectCount, missingCount };
  } catch (error) {
    console.error(`[updateLevels] Failed to update level documents: ${error.message}`);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    if (require.main === module) {
      process.exit(1);
    }
    throw error;
  }
};

// Execute update if run directly
if (require.main === module) {
  updateLevels();
}

module.exports = updateLevels;
