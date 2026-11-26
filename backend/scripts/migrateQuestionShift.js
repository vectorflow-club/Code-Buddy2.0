const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const { Question, Round } = require('../models');
const QUESTION_BANK = require('./questionBank.json');
const { validateQuestion } = require('./seedQuestions');

// Active round statuses — the SAME list as the admin question delete guard
// (backend/controllers/questionController.js), so this script never deletes
// a question the app itself would refuse to delete. Rounds snapshot the
// question at allocation, so deleting a question referenced only by
// finished rounds is safe; a question in a live round is deactivated
// instead (leaves the allocation pool, live round untouched) and reported.
const ACTIVE_ROUND_STATUSES = ['ready', 'inProgress', 'timeExpired', 'submitted'];

// The 20 questions the shift drops: all of old L6 plus the unpicked old
// L3 5+5. Titles are unique in the bank, so title is the match key.
// Anything else in the database that is not in the new bank (for example
// the E11 stray "Sum of Two Integers", which lives only in Atlas) is
// NEVER touched — it is counted and listed as untouched.
const DROP_TITLES = [
  // Old L6 (10) — the wall that drops out entirely.
  'Rain Water Trap',
  'Minimum Coins',
  'Edit Distance',
  'Largest Rectangle in Histogram',
  'Longest Valid Parentheses',
  'Egg Drop Challenge',
  'Shortest Secret Code',
  'Stone Merge Cost',
  'Unique Mirror Words',
  'Burst Balloons',
  // Unpicked old L3 (10).
  'Squares of a Sorted Array',
  'Find All Disappeared Numbers',
  'Ransom Note',
  'Third Maximum Number',
  'Summary Ranges',
  'Maximum Subarray Sum',
  'Best Time to Buy and Sell Stock II',
  'Longest Palindrome Length',
  'Valid Mountain Array',
  'Merge Intervals',
];

const EXPECTED_COUNTS = {
  1: { EASY: 10, HARD: 10 },
  2: { EASY: 10, HARD: 10 },
  3: { EASY: 10, HARD: 10 },
  4: { EASY: 5, HARD: 5 },
  5: { EASY: 5, HARD: 5 },
  6: { EASY: 5, HARD: 5 },
};

// Hide the password when printing where this script is about to write.
const describeTarget = (mongoUri) => {
  try {
    const url = new URL(mongoUri);
    return `${url.protocol}//${url.host}${url.pathname || ''}`;
  } catch (_) {
    return '(could not parse MONGO_URI)';
  }
};

const countByLevel = (docs, bankTitleSet) => {
  // Counts ACTIVE bank questions only: the E11 stray (active, L1 EASY)
  // and any deactivated dropped question (e.g. one held back by a live
  // round) must not pollute the per-level bank counts.
  const out = {};
  for (let n = 1; n <= 6; n++) {
    out[n] = { EASY: 0, HARD: 0 };
  }
  for (const doc of docs) {
    if (doc.isActive === false) continue;
    if (bankTitleSet && !bankTitleSet.has(doc.title)) continue;
    if (out[doc.levelNumber] && out[doc.levelNumber][doc.difficulty] !== undefined) {
      out[doc.levelNumber][doc.difficulty] += 1;
    }
  }
  return out;
};

const printCounts = (label, counts) => {
  console.log(`[migrateQuestionShift] ${label}:`);
  for (let n = 1; n <= 6; n++) {
    console.log(
      `[migrateQuestionShift]   Level ${n}: EASY ${counts[n].EASY}, HARD ${counts[n].HARD}`
    );
  }
};

/**
 * Shift-down migration for the CodeBuddy 2.0 question bank.
 *
 * Every level takes the questions of the level below it (L2 <- old L1,
 * L3 <- old L2, L4 <- picked old L3, L5 <- old L4, L6 <- old L5) and L1
 * becomes 20 brand-new easiest questions. The source of truth is
 * questionBank.json in this same directory (90 questions).
 *
 * Why shifted questions are updated IN PLACE instead of deleted and
 * re-inserted: the allocation exclusion is by question _id
 * (backend/controllers/roundController.js keeps a set of past
 * questionIds per student). Keeping the _id means a student who already
 * had "Two Sum" at old L1 can never draw it again at new L2. A
 * delete + re-insert would mint new _ids and break that guarantee.
 *
 * This script talks to MongoDB directly, so it deliberately bypasses the
 * admin API rule that refuses level changes for already-assigned
 * questions (QUESTION_ALREADY_ASSIGNED). That rule protects the admin UI
 * from casual edits; this migration is the event owner's explicit
 * decision to move assigned questions. Existing rounds keep working:
 * every round freezes its own question snapshot at allocation.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless --apply is passed.
 *
 * Usage (from the backend directory, with backend/.env holding the LIVE
 * MONGO_URI — check the printed target line before applying):
 *
 *   node scripts/migrateQuestionShift.js              # dry run, no writes
 *   node scripts/migrateQuestionShift.js --apply      # perform the shift
 */
const migrateQuestionShift = async (options = {}) => {
  const apply = options.apply === true;
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error('[migrateQuestionShift] Error: MONGO_URI environment variable is required.');
    process.exit(1);
  }
  console.log(`[migrateQuestionShift] Target database: ${describeTarget(mongoUri)}`);
  console.log(
    `[migrateQuestionShift] Mode: ${apply ? 'APPLY — writes will happen' : 'DRY RUN — nothing will be written (pass --apply to write)'}`
  );

  // ---- validate the new bank before touching the database ---------------
  const failures = QUESTION_BANK.flatMap(validateQuestion);
  if (QUESTION_BANK.length !== 90) {
    failures.push(`questionBank.json has ${QUESTION_BANK.length} questions, expected 90`);
  }
  const bankCounts = countByLevel(QUESTION_BANK);
  for (let n = 1; n <= 6; n++) {
    for (const diff of ['EASY', 'HARD']) {
      if (bankCounts[n][diff] !== EXPECTED_COUNTS[n][diff]) {
        failures.push(
          `questionBank.json Level ${n} ${diff}: ${bankCounts[n][diff]}, expected ${EXPECTED_COUNTS[n][diff]}`
        );
      }
    }
  }
  const bankTitles = QUESTION_BANK.map((q) => q.title);
  const duplicateTitles = bankTitles.filter((t, i) => bankTitles.indexOf(t) !== i);
  if (duplicateTitles.length > 0) {
    failures.push(`questionBank.json has duplicate titles: ${[...new Set(duplicateTitles)].join(', ')}`);
  }
  for (const q of QUESTION_BANK) {
    if (q.examples.length !== 1) {
      failures.push(`L${q.levelNumber}${q.bankId} "${q.title}": ${q.examples.length} examples, expected exactly 1`);
    }
    if (q.hiddenTestCases.length !== 5) {
      failures.push(
        `L${q.levelNumber}${q.bankId} "${q.title}": ${q.hiddenTestCases.length} hidden test cases, expected exactly 5`
      );
    }
  }
  for (let n = 1; n <= 6; n++) {
    for (const diff of ['EASY', 'HARD']) {
      const ids = QUESTION_BANK.filter((q) => q.levelNumber === n && q.difficulty === diff).map(
        (q) => q.bankId
      );
      if (new Set(ids).size !== ids.length) {
        failures.push(`questionBank.json Level ${n} ${diff} has duplicate bank numbers`);
      }
    }
  }
  if (failures.length > 0) {
    console.error(`[migrateQuestionShift] Validation failed for ${failures.length} check(s). Nothing was written.`);
    failures.forEach((reason) => console.error(`  - ${reason}`));
    process.exit(1);
  }
  console.log('[migrateQuestionShift] New bank validated: 90 questions, counts exact, 1 example + 5 hidden each.');

  try {
    await mongoose.connect(mongoUri);

    const stored = await Question.find({});
    const bankTitleSet = new Set(bankTitles);
    const dropSet = new Set(DROP_TITLES);
    // BEFORE counts every active question at its CURRENT level (so the
    // table shows the real pre-shift bank, including the 20 questions the
    // shift drops and any strays). The AFTER table counts active BANK
    // questions only, so compare the two tables with that in mind.
    const beforeCounts = countByLevel(stored);
    printCounts('Counts BEFORE (all active questions, at current levels)', beforeCounts);
    console.log(`[migrateQuestionShift] Total Question documents before: ${stored.length}`);

    // Title is unique in the bank; a duplicate title in the database is a
    // data problem this script refuses to guess its way through.
    const byTitle = new Map();
    const ambiguousTitles = [];
    for (const doc of stored) {
      if (byTitle.has(doc.title)) {
        ambiguousTitles.push(doc.title);
      } else {
        byTitle.set(doc.title, doc);
      }
    }
    if (ambiguousTitles.length > 0) {
      console.error(
        `[migrateQuestionShift] Aborted: ${[...new Set(ambiguousTitles)].length} title(s) match more than one stored question: ${[...new Set(ambiguousTitles)].join(', ')}. Fix the duplicates first. Nothing was written.`
      );
      await mongoose.disconnect();
      process.exit(1);
    }

    // ---- plan -----------------------------------------------------------
    const toUpdate = []; // { doc, entry } — shifted, keep _id
    const toInsert = []; // bank entries with no stored question (new L1)
    for (const entry of QUESTION_BANK) {
      const doc = byTitle.get(entry.title);
      if (doc) {
        toUpdate.push({ doc, entry });
      } else {
        toInsert.push(entry);
      }
    }
    // The shift moves 70 existing questions and adds 20 new L1 questions.
    // Any other split means the bank file and the database disagree, and
    // writing anyway could duplicate or strand questions — abort instead.
    if (toUpdate.length !== 70 || toInsert.length !== 20) {
      console.error(
        `[migrateQuestionShift] Aborted: expected 70 questions to move and 20 new ones to insert, but found ${toUpdate.length} to move and ${toInsert.length} to insert. The database does not hold the old 90-question bank this script was written for. Nothing was written.`
      );
      if (toInsert.length > 0 && toInsert.length !== 20) {
        console.error(
          `[migrateQuestionShift] New titles not found in the database: ${toInsert.map((q) => q.title).join(', ')}`
        );
      }
      await mongoose.disconnect();
      process.exit(1);
    }

    const toDelete = []; // { doc, liveRounds }
    const toDeactivate = []; // dropped questions held back by live rounds
    const untouched = [];
    for (const doc of stored) {
      if (bankTitleSet.has(doc.title)) {
        continue; // handled as an update or an insert above
      }
      if (!dropSet.has(doc.title)) {
        untouched.push(doc); // strays (e.g. E11) — never modified
        continue;
      }
      const liveRounds = await Round.countDocuments({
        questionId: doc._id,
        status: { $in: ACTIVE_ROUND_STATUSES },
      });
      if (liveRounds > 0) {
        toDeactivate.push({ doc, liveRounds });
      } else {
        toDelete.push(doc);
      }
    }
    const missingDrops = DROP_TITLES.filter((title) => !byTitle.has(title));
    if (missingDrops.length > 0) {
      console.log(
        `[migrateQuestionShift] Note: ${missingDrops.length} dropped title(s) already absent from the database: ${missingDrops.join(', ')}`
      );
    }

    console.log('[migrateQuestionShift] Plan:');
    console.log(`[migrateQuestionShift]   Move (keep _id, new level + number): ${toUpdate.length}`);
    console.log(`[migrateQuestionShift]   Insert (new L1): ${toInsert.length}`);
    console.log(`[migrateQuestionShift]   Delete (dropped, no live rounds): ${toDelete.length}`);
    console.log(
      `[migrateQuestionShift]   Deactivate instead of delete (dropped, in a live round): ${toDeactivate.length}`
    );
    console.log(`[migrateQuestionShift]   Untouched (strays, e.g. E11): ${untouched.length}`);
    for (const { doc, liveRounds } of toDeactivate) {
      console.log(
        `[migrateQuestionShift]   - "${doc.title}" stays in the database but switched off: ${liveRounds} live round(s) still use it. Delete it later, after those rounds finish.`
      );
    }

    if (!apply) {
      console.log('[migrateQuestionShift] Dry run finished. Nothing was written. Re-run with --apply to perform the shift.');
      await mongoose.disconnect();
      return { dryRun: true, toUpdate: toUpdate.length, toInsert: toInsert.length, toDelete: toDelete.length, toDeactivate: toDeactivate.length, untouched: untouched.length };
    }

    // ---- apply ----------------------------------------------------------
    // Pass 1: move every shifted question to its new level first. Pass 2
    // then sets the bank numbers. Splitting the two avoids a transient
    // moment where two questions in one level carry the same number
    // (bank numbers are unique per level in the finished bank, but there
    // is no database index enforcing it — the split keeps the end state
    // provably clean even if the run is interrupted between passes).
    let moved = 0;
    for (const { doc, entry } of toUpdate) {
      await Question.updateOne(
        { _id: doc._id },
        { $set: { levelNumber: entry.levelNumber, isActive: true } }
      );
      moved += 1;
    }
    let numbered = 0;
    for (const { doc, entry } of toUpdate) {
      await Question.updateOne({ _id: doc._id }, { $set: { bankNumber: entry.bankId } });
      numbered += 1;
    }
    console.log(`[migrateQuestionShift] Moved ${moved} questions to their new levels, set ${numbered} bank numbers.`);

    let inserted = 0;
    for (const entry of toInsert) {
      await Question.create({
        title: entry.title,
        statement: entry.statement,
        constraints: entry.constraints,
        examples: entry.examples,
        difficulty: entry.difficulty,
        levelNumber: entry.levelNumber,
        hiddenTestCases: entry.hiddenTestCases,
        bankNumber: entry.bankId,
        showBankNumber: true,
        isActive: true,
      });
      inserted += 1;
    }
    console.log(`[migrateQuestionShift] Inserted ${inserted} new L1 questions.`);

    let deleted = 0;
    for (const doc of toDelete) {
      await Question.deleteOne({ _id: doc._id });
      deleted += 1;
    }
    let deactivated = 0;
    for (const { doc } of toDeactivate) {
      await Question.updateOne({ _id: doc._id }, { $set: { isActive: false } });
      deactivated += 1;
    }
    console.log(`[migrateQuestionShift] Deleted ${deleted} dropped questions, deactivated ${deactivated} (live rounds).`);

    // ---- verify the end state -------------------------------------------
    const after = await Question.find({});
    const afterCounts = countByLevel(after, bankTitleSet);
    printCounts('Counts AFTER (active bank questions)', afterCounts);
    console.log(`[migrateQuestionShift] Total Question documents after: ${after.length}`);

    const afterFailures = [];
    for (let n = 1; n <= 6; n++) {
      for (const diff of ['EASY', 'HARD']) {
        if (afterCounts[n][diff] !== EXPECTED_COUNTS[n][diff]) {
          afterFailures.push(`Level ${n} ${diff}: ${afterCounts[n][diff]}, expected ${EXPECTED_COUNTS[n][diff]}`);
        }
      }
    }
    for (let n = 1; n <= 6; n++) {
      const numbers = after
        .filter((d) => d.levelNumber === n && d.isActive !== false && bankTitleSet.has(d.title))
        .map((d) => d.bankNumber)
        .filter((b) => b);
      if (new Set(numbers).size !== numbers.length) {
        afterFailures.push(`Level ${n} has duplicate bank numbers among active bank questions`);
      }
    }
    const untouchedAfter = after.filter((d) => !bankTitleSet.has(d.title) && !dropSet.has(d.title));
    if (untouchedAfter.length !== untouched.length) {
      afterFailures.push(`untouched question count changed: ${untouched.length} before, ${untouchedAfter.length} after`);
    }
    if (afterFailures.length > 0) {
      console.error('[migrateQuestionShift] APPLIED, but the end state does not match the new bank:');
      afterFailures.forEach((reason) => console.error(`  - ${reason}`));
      console.error('[migrateQuestionShift] Check the counts above before letting students allocate. The per-question moves are already written.');
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log('[migrateQuestionShift] Done. End state matches the new bank exactly. New allocations now draw the shifted questions; rounds already in progress keep their frozen question.');
    console.log('[migrateQuestionShift] Remember: send the rebuilt organizer PDF to all three spots and tell organizers the old PDF is dead — question numbers now point at different questions.');

    await mongoose.disconnect();
    return { dryRun: false, moved, numbered, inserted, deleted, deactivated, untouched: untouched.length };
  } catch (error) {
    console.error(`[migrateQuestionShift] Failed: ${error.message}`);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
  }
};

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  migrateQuestionShift({ apply });
}

module.exports = migrateQuestionShift;
module.exports.DROP_TITLES = DROP_TITLES;
module.exports.ACTIVE_ROUND_STATUSES = ACTIVE_ROUND_STATUSES;
