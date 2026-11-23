const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const { Question } = require('../models');

/**
 * One-time script: backfill the bankNumber field on the questions the bulk
 * import created, from the import's own data file (questionBank.json).
 *
 *   - Matches each bank entry to its stored question by {levelNumber, title}.
 *   - Sets bankNumber = bankId ONLY when the stored question has no number
 *     yet; a manually set number is never overwritten.
 *   - Skips an entry when its number is already used by another question in
 *     the same level, so the backfill can never create a duplicate number.
 *
 * Idempotent: re-running changes nothing and reports every question as
 * already set or skipped. Run AFTER the bulk import has run (the questions
 * must exist in the database), from the backend directory:
 *
 *   node scripts/backfillBankNumbers.js [--dry-run]
 *
 * --dry-run prints what would change and writes nothing.
 */
const backfillBankNumbers = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const bankPath = path.join(__dirname, 'questionBank.json');

  if (!fs.existsSync(bankPath)) {
    console.error('[backfillBankNumbers] Error: questionBank.json not found — apply the question-import patch first.');
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error('[backfillBankNumbers] Error: MONGO_URI environment variable is required.');
    process.exit(1);
  }

  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
  } catch (error) {
    console.error(`[backfillBankNumbers] Error: could not parse questionBank.json: ${error.message}`);
    process.exit(1);
  }

  if (!Array.isArray(entries)) {
    console.error('[backfillBankNumbers] Error: questionBank.json must contain a JSON array of questions.');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);

    let updatedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;
    let invalidCount = 0;

    for (const entry of entries) {
      const bankId = typeof entry.bankId === 'string' ? entry.bankId.trim() : '';
      const title = typeof entry.title === 'string' ? entry.title.trim() : '';
      const levelNumber = Number(entry.levelNumber);

      if (!bankId || !title || !Number.isInteger(levelNumber)) {
        invalidCount++;
        console.log('[backfillBankNumbers] Skipped an entry with a missing bankId, title or levelNumber.');
        continue;
      }

      const stored = await Question.findOne({ levelNumber, title });

      if (!stored) {
        notFoundCount++;
        console.log(`[backfillBankNumbers] Level ${levelNumber} "${title}" not found in the database. Skipped (run the import first).`);
        continue;
      }

      if (stored.bankNumber) {
        skippedCount++;
        console.log(`[backfillBankNumbers] Level ${levelNumber} "${title}" already has number "${stored.bankNumber}". Kept as-is.`);
        continue;
      }

      const clash = await Question.findOne({
        levelNumber,
        bankNumber: bankId,
        _id: { $ne: stored._id },
      });
      if (clash) {
        skippedCount++;
        console.log(`[backfillBankNumbers] Level ${levelNumber} "${title}": number "${bankId}" is already used by "${clash.title}". Skipped.`);
        continue;
      }

      if (dryRun) {
        updatedCount++;
        console.log(`[backfillBankNumbers] [dry-run] Level ${levelNumber} "${title}" would get number "${bankId}".`);
        continue;
      }

      await Question.updateOne({ _id: stored._id }, { $set: { bankNumber: bankId } }, { runValidators: true });
      updatedCount++;
      console.log(`[backfillBankNumbers] Level ${levelNumber} "${title}": bankNumber -> "${bankId}".`);
    }

    console.log(`[backfillBankNumbers] Summary: ${updatedCount} ${dryRun ? 'would update' : 'updated'}, ${skippedCount} skipped, ${notFoundCount} not found, ${invalidCount} invalid (total: ${entries.length}).`);

    await mongoose.disconnect();
    if (require.main === module) {
      process.exit(0);
    }
    return { updatedCount, skippedCount, notFoundCount, invalidCount };
  } catch (error) {
    console.error(`[backfillBankNumbers] Failed to backfill bank numbers: ${error.message}`);
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
  backfillBankNumbers();
}

module.exports = backfillBankNumbers;
