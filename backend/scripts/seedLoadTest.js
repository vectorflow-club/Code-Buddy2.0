const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const { Student, Volunteer, Round, Evaluation, Transaction } = require('../models');
const { signStudentToken, signVolunteerToken } = require('../middleware/authMiddleware');
const { ACADEMIC_YEARS, ORGANIZER_LOCATIONS, USN_REGEX } = require('../constants');

// Load-test seed data. Everything this script creates is recognisable by
// prefix so --cleanup can remove exactly these documents and nothing else.
const STUDENT_EMAIL_PREFIX = 'loadtest';
const ORGANIZER_USERNAME_PREFIX = 'loadorg';
const STUDENT_WALLET_BALANCE = 500; // Covers the full ladder: stakes total 400 (50+100+150+100).
const MAX_STUDENTS = 10000;
const MAX_ORGANIZERS = 500;
const INSERT_CHUNK_SIZE = 200;

const pad = (num, width) => String(num).padStart(width, '0');

const studentEmail = (index) => `${STUDENT_EMAIL_PREFIX}${pad(index, 4)}@vvce.ac.in`;
const studentUsn = (index) => `4VV24LT${pad(index, 4)}`;
const organizerUsername = (index) => `${ORGANIZER_USERNAME_PREFIX}${pad(index, 2)}`;
const organizerPassword = (index) => `LoadTest!${pad(index, 2)}`;

/**
 * Extract the database name from a MongoDB connection string.
 * Returns null when the URI has no usable database name. A URI with no
 * database segment makes Mongoose default to the "test" database, so
 * callers must treat a missing name as "test" when comparing.
 */
const parseDbName = (uri) => {
  try {
    const parsed = new URL(uri);
    const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || '');
    return name || null;
  } catch (_) {
    return null;
  }
};

const parseHost = (uri) => {
  try {
    return new URL(uri).host;
  } catch (_) {
    return '(unparseable host)';
  }
};

const parseArgs = (argv) => {
  const options = { students: 1000, organizers: 20, out: null, cleanup: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (flag) => {
      const inline = arg.indexOf('=');
      if (inline !== -1) return arg.slice(inline + 1);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${flag} requires a value.`);
      }
      i += 1;
      return next;
    };
    if (arg === '--cleanup') options.cleanup = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--students' || arg.startsWith('--students=')) {
      options.students = Number(takeValue('--students'));
    } else if (arg === '--organizers' || arg.startsWith('--organizers=')) {
      options.organizers = Number(takeValue('--organizers'));
    } else if (arg === '--out' || arg.startsWith('--out=')) {
      options.out = takeValue('--out');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

const printHelp = () => {
  console.log('Usage: node scripts/seedLoadTest.js [--students N] [--organizers M] [--out <path>] [--cleanup]');
  console.log('');
  console.log('  Seeds N test students (default 1000) and M test organizers (default 20)');
  console.log('  into the database named by LOAD_TEST_MONGO_URI, and writes their JWTs to');
  console.log('  backend/loadtest-tokens.json (or --out) for the k6 load test.');
  console.log('');
  console.log('  --cleanup   Delete ONLY the load-test documents (students, organizers,');
  console.log('              and their rounds, evaluations, and transactions).');
  console.log('');
  console.log('  Safety: the script REFUSES to run when LOAD_TEST_MONGO_URI names the');
  console.log('  same database as MONGO_URI. Always point it at a separate test database');
  console.log('  on the same cluster (same connection/compute limits, no real-data risk).');
};

/**
 * Safety gate: resolve the target database and refuse when it is the same
 * database the live app uses. Fails closed: an unparseable URI refuses.
 */
const resolveTarget = () => {
  const loadTestUri = process.env.LOAD_TEST_MONGO_URI;
  if (!loadTestUri || loadTestUri.trim() === '') {
    console.error('[seedLoadTest] Error: LOAD_TEST_MONGO_URI is required (a SEPARATE test database, never the live one).');
    process.exit(1);
  }

  const loadTestDb = parseDbName(loadTestUri);
  if (!loadTestDb) {
    console.error('[seedLoadTest] Error: LOAD_TEST_MONGO_URI must include an explicit database name (e.g. mongodb+srv://.../codebuddy_loadtest). Refusing to run.');
    process.exit(1);
  }

  const liveUri = process.env.MONGO_URI;
  if (liveUri && liveUri.trim() !== '') {
    const liveDb = parseDbName(liveUri);
    if (!liveDb) {
      console.error('[seedLoadTest] Error: MONGO_URI is set but its database name cannot be parsed, so the safety check cannot run. Fix MONGO_URI or unset it for this run. Refusing to run.');
      process.exit(1);
    }
    if (liveDb.toLowerCase() === loadTestDb.toLowerCase()) {
      console.error(`[seedLoadTest] REFUSED: LOAD_TEST_MONGO_URI names the same database ("${loadTestDb}") as MONGO_URI. Point it at a separate test database. Nothing was written.`);
      process.exit(1);
    }
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
    console.error('[seedLoadTest] Error: JWT_SECRET is required to mint load-test tokens.');
    process.exit(1);
  }

  return { loadTestUri, loadTestDb };
};

const validateCounts = (options) => {
  if (!Number.isInteger(options.students) || options.students < 1 || options.students > MAX_STUDENTS) {
    console.error(`[seedLoadTest] Error: --students must be an integer between 1 and ${MAX_STUDENTS}.`);
    process.exit(1);
  }
  if (!Number.isInteger(options.organizers) || options.organizers < 0 || options.organizers > MAX_ORGANIZERS) {
    console.error(`[seedLoadTest] Error: --organizers must be an integer between 0 and ${MAX_ORGANIZERS}.`);
    process.exit(1);
  }
  // Validate the generated identifiers against the model rules before writing anything.
  if (!USN_REGEX.test(studentUsn(1)) || !USN_REGEX.test(studentUsn(options.students))) {
    console.error('[seedLoadTest] Error: generated USN does not match the model USN format. Nothing was written.');
    process.exit(1);
  }
  if (!/^[^\s@]+@vvce\.ac\.in$/i.test(studentEmail(1))) {
    console.error('[seedLoadTest] Error: generated student email does not match the @vvce.ac.in rule. Nothing was written.');
    process.exit(1);
  }
};

const seedLoadTest = async (cliOptions = {}) => {
  const options = { ...parseArgs(process.argv.slice(2)), ...cliOptions };

  if (options.help) {
    printHelp();
    return { help: true };
  }

  validateCounts(options);
  const { loadTestUri, loadTestDb } = resolveTarget();
  const outPath = options.out
    ? path.resolve(options.out)
    : path.join(__dirname, '../loadtest-tokens.json');

  console.log(`[seedLoadTest] Target database: "${loadTestDb}" on ${parseHost(loadTestUri)}`);

  await mongoose.connect(loadTestUri);

  try {
    if (options.cleanup) {
      return await runCleanup();
    }
    return await runSeed(options, outPath);
  } finally {
    await mongoose.disconnect();
  }
};

const runCleanup = async () => {
  const studentEmailPattern = new RegExp(`^${STUDENT_EMAIL_PREFIX}[0-9]+@vvce\\.ac\\.in$`, 'i');
  const organizerUsernamePattern = new RegExp(`^${ORGANIZER_USERNAME_PREFIX}[0-9]+$`, 'i');

  const testStudents = await Student.find({ email: studentEmailPattern }).select('_id');
  const testOrganizers = await Volunteer.find({ username: organizerUsernamePattern }).select('_id');
  const studentIds = testStudents.map((doc) => doc._id);
  const organizerIds = testOrganizers.map((doc) => doc._id);

  let evaluationsDeleted = 0;
  let roundsDeleted = 0;
  let transactionsDeleted = 0;
  let studentsDeleted = 0;
  let organizersDeleted = 0;

  if (studentIds.length > 0) {
    evaluationsDeleted = (await Evaluation.deleteMany({ studentId: { $in: studentIds } })).deletedCount;
    roundsDeleted = (await Round.deleteMany({ studentId: { $in: studentIds } })).deletedCount;
    // Transactions carry pre('deleteMany') immutability hooks that throw, so
    // cleanup deletes through the raw driver collection instead. This is
    // deliberately scoped to load-test student ids only.
    transactionsDeleted = (
      await Transaction.collection.deleteMany({ studentId: { $in: studentIds } })
    ).deletedCount;
    studentsDeleted = (await Student.deleteMany({ _id: { $in: studentIds } })).deletedCount;
  }
  if (organizerIds.length > 0) {
    // Rounds a test organizer started (none in the v1 k6 flow, but cheap to cover).
    roundsDeleted += (await Round.deleteMany({ startedBy: { $in: organizerIds } })).deletedCount;
    organizersDeleted = (await Volunteer.deleteMany({ _id: { $in: organizerIds } })).deletedCount;
  }

  console.log('[seedLoadTest] Cleanup done (only load-test documents were touched):');
  console.log(`  students: ${studentsDeleted}, organizers: ${organizersDeleted}, rounds: ${roundsDeleted}, evaluations: ${evaluationsDeleted}, transactions: ${transactionsDeleted}`);
  console.log('[seedLoadTest] Remember to delete the tokens file (backend/loadtest-tokens.json) as well.');

  return { studentsDeleted, organizersDeleted, roundsDeleted, evaluationsDeleted, transactionsDeleted };
};

const runSeed = async (options, outPath) => {
  const studentEmails = Array.from({ length: options.students }, (_, i) => studentEmail(i + 1));
  const existingStudents = await Student.find({ email: { $in: studentEmails } }).select('email');
  const existingEmails = new Set(existingStudents.map((doc) => doc.email));
  const missingStudents = [];
  for (let i = 1; i <= options.students; i += 1) {
    if (existingEmails.has(studentEmail(i))) continue;
    missingStudents.push({
      googleSubjectId: `loadtest-google-${pad(i, 4)}`,
      name: `LoadTest ${pad(i, 4)}`,
      email: studentEmail(i),
      emailVerified: true,
      role: 'STUDENT',
      usn: studentUsn(i),
      year: ACADEMIC_YEARS[(i - 1) % ACADEMIC_YEARS.length],
      registrationComplete: true,
      currentLevel: 1,
      highestLevelReached: 1,
      levelsCleared: 0,
      competitionStatus: 'registered',
      roundAvailability: 'ready',
      // Balance is a field on the Student document (not a ledger row):
      // the wallet check in allocate reads walletBalance directly.
      walletBalance: STUDENT_WALLET_BALANCE,
      totalEarned: 0,
      totalRisked: 0,
      safeZoneAmount: 0,
    });
  }

  let studentsCreated = 0;
  for (let i = 0; i < missingStudents.length; i += INSERT_CHUNK_SIZE) {
    const chunk = missingStudents.slice(i, i + INSERT_CHUNK_SIZE);
    const created = await Student.insertMany(chunk);
    studentsCreated += created.length;
  }

  const organizerUsernames = Array.from({ length: options.organizers }, (_, i) => organizerUsername(i + 1));
  const existingOrganizers = await Volunteer.find({ username: { $in: organizerUsernames } }).select('username');
  const existingUsernames = new Set(existingOrganizers.map((doc) => doc.username));
  const missingOrganizers = [];
  for (let j = 1; j <= options.organizers; j += 1) {
    if (existingUsernames.has(organizerUsername(j))) continue;
    missingOrganizers.push({
      name: `Load Organizer ${pad(j, 2)}`,
      username: organizerUsername(j),
      // Plain-text storage, matching the event team's organizer decision:
      // Staff.comparePassword tries bcrypt first, then plain equality.
      passwordHash: organizerPassword(j),
      role: 'VOLUNTEER',
      isActive: true,
      assignedLab: ORGANIZER_LOCATIONS[(j - 1) % ORGANIZER_LOCATIONS.length],
    });
  }

  let organizersCreated = 0;
  for (let i = 0; i < missingOrganizers.length; i += INSERT_CHUNK_SIZE) {
    const chunk = missingOrganizers.slice(i, i + INSERT_CHUNK_SIZE);
    const created = await Volunteer.insertMany(chunk);
    organizersCreated += created.length;
  }

  // Mint tokens with the backend's own signing path (same secret, payload, expiry).
  const allStudents = await Student.find({ email: { $in: studentEmails } }).select('_id email usn').sort({ email: 1 });
  const allOrganizers = await Volunteer.find({ username: { $in: organizerUsernames } }).select('_id username').sort({ username: 1 });

  const studentTokens = allStudents.map((doc) => ({
    email: doc.email,
    usn: doc.usn,
    token: signStudentToken(doc._id),
  }));
  const organizerTokens = allOrganizers.map((doc) => {
    const index = Number(doc.username.replace(ORGANIZER_USERNAME_PREFIX, ''));
    return {
      username: doc.username,
      password: organizerPassword(index),
      token: signVolunteerToken(doc._id),
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    students: studentTokens,
    organizers: organizerTokens,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log('[seedLoadTest] Seeding summary:');
  console.log(`  students: ${studentsCreated} created, ${options.students - studentsCreated} already existed (total ${options.students})`);
  console.log(`  organizers: ${organizersCreated} created, ${options.organizers - organizersCreated} already existed (total ${options.organizers})`);
  console.log(`  tokens written: ${studentTokens.length} students, ${organizerTokens.length} organizers -> ${outPath}`);
  console.log('[seedLoadTest] WARNING: that file holds live session tokens. Never commit it, never share it, delete it when the test is done.');

  return {
    studentsCreated,
    studentsSkipped: options.students - studentsCreated,
    organizersCreated,
    organizersSkipped: options.organizers - organizersCreated,
    outPath,
  };
};

if (require.main === module) {
  seedLoadTest()
    .then((result) => {
      if (!result || result.help) process.exit(0);
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[seedLoadTest] Failed: ${error.message}`);
      mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = seedLoadTest;
module.exports.parseDbName = parseDbName;
