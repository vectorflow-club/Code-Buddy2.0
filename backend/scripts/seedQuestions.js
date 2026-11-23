const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const { Question } = require('../models');
const QUESTION_BANK = require('./questionBank.json');

const VALID_DIFFICULTIES = ['EASY', 'HARD'];

/**
 * Validate one bank entry. Returns an array of failure reasons
 * (empty when the entry is valid).
 */
const validateQuestion = (q) => {
  const reasons = [];
  const label = `${q.bankId || '?'} (${q.title || 'untitled'})`;

  if (typeof q.title !== 'string' || q.title.trim() === '') {
    reasons.push(`${label}: title must be a non-empty string`);
  }
  if (typeof q.statement !== 'string' || q.statement.trim() === '') {
    reasons.push(`${label}: statement must be a non-empty string`);
  }
  if (!Number.isInteger(q.levelNumber) || q.levelNumber < 1 || q.levelNumber > 6) {
    reasons.push(`${label}: levelNumber must be an integer from 1 to 6`);
  }
  if (!VALID_DIFFICULTIES.includes(q.difficulty)) {
    reasons.push(`${label}: difficulty must be EASY or HARD`);
  }
  if (!Array.isArray(q.constraints) || q.constraints.some((c) => typeof c !== 'string')) {
    reasons.push(`${label}: constraints must be an array of strings`);
  }
  if (!Array.isArray(q.examples) || q.examples.length < 1) {
    reasons.push(`${label}: at least one example is required`);
  } else {
    q.examples.forEach((ex, i) => {
      if (typeof ex.input !== 'string' || typeof ex.output !== 'string') {
        reasons.push(`${label}: example ${i + 1} needs string input and output`);
      }
    });
  }
  if (!Array.isArray(q.hiddenTestCases) || q.hiddenTestCases.length < 1) {
    reasons.push(`${label}: at least one hidden test case is required`);
  } else {
    q.hiddenTestCases.forEach((tc, i) => {
      if (typeof tc.input !== 'string' || typeof tc.expectedOutput !== 'string') {
        reasons.push(`${label}: hidden test case ${i + 1} needs string input and expectedOutput`);
      }
    });
  }
  return reasons;
};

/**
 * Bulk-import script for the CodeBuddy 2.0 question bank.
 *
 * The 90 questions live in questionBank.json, transcribed from the six
 * Level question-bank PDFs (10 Easy + 10 Hard per level for L1-L3,
 * 5 Easy + 5 Hard per level for L4-L6). Each question's case #1 is the
 * visible example; cases #2-6 are the hidden test cases.
 *
 * Matching is by { levelNumber, title } exact match. A question that
 * already exists is skipped and NEVER overwritten, so manual edits made
 * in the admin form survive a re-run. Imported questions are ordinary
 * Question documents — they stay fully editable in Admin afterwards.
 *
 * Idempotent: a second run inserts 0 and skips 90.
 *
 * Usage (from the backend directory):
 *
 *   node scripts/seedQuestions.js --dry-run   # validate + preview, no writes
 *   node scripts/seedQuestions.js             # live import
 */
const seedQuestions = async (options = {}) => {
  const dryRun = options.dryRun === true;
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error('[seedQuestions] Error: MONGO_URI environment variable is required.');
    process.exit(1);
  }

  // Validate ALL 90 questions BEFORE touching the database.
  const failures = QUESTION_BANK.flatMap(validateQuestion);
  if (failures.length > 0) {
    console.error(`[seedQuestions] Validation failed for ${failures.length} check(s). Nothing was written.`);
    failures.forEach((reason) => console.error(`  - ${reason}`));
    process.exit(1);
  }
  console.log(`[seedQuestions] All ${QUESTION_BANK.length} questions passed validation.`);

  try {
    await mongoose.connect(mongoUri);

    const perLevel = {};
    for (let n = 1; n <= 6; n++) {
      perLevel[n] = { inserted: 0, skipped: 0 };
    }

    for (const q of QUESTION_BANK) {
      const existing = await Question.findOne({ levelNumber: q.levelNumber, title: q.title });

      if (existing) {
        perLevel[q.levelNumber].skipped++;
        console.log(
          `[seedQuestions] Level ${q.levelNumber} "${q.title}" already exists. Skipped without modifying.`
        );
      } else if (dryRun) {
        perLevel[q.levelNumber].inserted++;
        console.log(`[seedQuestions] [dry-run] Level ${q.levelNumber} "${q.title}" would be inserted.`);
      } else {
        // bankId is deliberately NOT written: the Question model has no
        // such field. It stays in questionBank.json for a later addition.
        await Question.create({
          title: q.title,
          statement: q.statement,
          constraints: q.constraints,
          examples: q.examples,
          difficulty: q.difficulty,
          levelNumber: q.levelNumber,
          hiddenTestCases: q.hiddenTestCases,
          isActive: true,
        });
        perLevel[q.levelNumber].inserted++;
        console.log(`[seedQuestions] Level ${q.levelNumber} "${q.title}" successfully inserted.`);
      }
    }

    let totalInserted = 0;
    let totalSkipped = 0;
    for (let n = 1; n <= 6; n++) {
      totalInserted += perLevel[n].inserted;
      totalSkipped += perLevel[n].skipped;
      console.log(
        `[seedQuestions] Level ${n}: ${perLevel[n].inserted} ${dryRun ? 'would be inserted' : 'inserted'}, ${perLevel[n].skipped} already existed.`
      );
    }
    console.log(
      `[seedQuestions] Seeding summary${dryRun ? ' (dry run, nothing written)' : ''}: ${totalInserted} ${dryRun ? 'would be inserted' : 'newly inserted'}, ${totalSkipped} already existed (total: ${totalInserted + totalSkipped}).`
    );

    await mongoose.disconnect();
    if (require.main === module) {
      process.exit(0);
    }
    return { insertedCount: totalInserted, existingCount: totalSkipped, dryRun };
  } catch (error) {
    console.error(`[seedQuestions] Failed to seed question documents: ${error.message}`);
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
  const dryRun = process.argv.includes('--dry-run');
  seedQuestions({ dryRun });
}

module.exports = seedQuestions;
module.exports.QUESTION_BANK = QUESTION_BANK;
module.exports.validateQuestion = validateQuestion;
