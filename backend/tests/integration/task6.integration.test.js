const assert = require('assert');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

const {
  IntegrationTestEnvironment,
  assertSafeTestMongoUri,
} = require('./testHarness');

let passedAssertions = 0;
let failedAssertions = 0;
const suiteResults = [];

function check(condition, message) {
  if (condition) {
    passedAssertions += 1;
  } else {
    failedAssertions += 1;
    throw new Error(`Assertion failed: ${message}`);
  }
}

function checkEqual(actual, expected, message) {
  if (Object.is(actual, expected)) {
    passedAssertions += 1;
  } else {
    failedAssertions += 1;
    assert.strictEqual(actual, expected, message);
  }
}

function assertNoSensitiveLeak(payload, contextLabel, { allowStudentEmail = false } = {}) {
  const serialized = JSON.stringify(payload);
  if (!allowStudentEmail) {
    check(!/@vvce\.ac\.in/i.test(serialized), `${contextLabel}: must not leak participant @vvce.ac.in email`);
  }
  check(!/"passwordHash"/i.test(serialized), `${contextLabel}: must not leak passwordHash`);
  check(!/"googleSubjectId"/i.test(serialized), `${contextLabel}: must not leak googleSubjectId`);
  check(!/"hiddenTestCases"/i.test(serialized), `${contextLabel}: must not leak hiddenTestCases`);
}

async function runSuite(name, fn) {
  const beforePass = passedAssertions;
  try {
    await fn();
    const count = passedAssertions - beforePass;
    suiteResults.push({ name, status: 'PASS', assertions: count });
    console.log(`[PASS] ${name} (${count} assertions)`);
  } catch (err) {
    suiteResults.push({ name, status: 'FAIL', error: err.message });
    console.error(`[FAIL] ${name}: ${err.stack || err.message}`);
    throw err;
  }
}

async function run() {
  await runSuite('Safety Guard: assertSafeTestMongoUri rejects unsafe targets', async () => {
    assert.throws(
      () => assertSafeTestMongoUri('mongodb+srv://user:pass@cluster0.abcde.mongodb.net/codebuddy'),
      /SAFETY_BLOCK/
    );
    passedAssertions += 1;

    assert.throws(
      () => assertSafeTestMongoUri('mongodb://192.168.1.50:27017/codebuddy'),
      /SAFETY_BLOCK/
    );
    passedAssertions += 1;

    const prodSim = 'mongodb://127.0.0.1:27017/codebuddy_prod';
    assert.throws(() => assertSafeTestMongoUri(prodSim, prodSim), /SAFETY_BLOCK/);
    passedAssertions += 1;

    assert.throws(() => assertSafeTestMongoUri(''), /SAFETY_BLOCK/);
    passedAssertions += 1;
  });

  const env = new IntegrationTestEnvironment();
  let volunteerToken = null;
  let volunteerId = null;
  let adminToken = null;

  const loginAdmin = async () => {
    const res = await env.http().post('/api/admin/login').send({
      username: env.seededAdminCredentials.username,
      password: env.seededAdminCredentials.password,
    });
    checkEqual(res.status, 200, 'Admin login HTTP 200');
    checkEqual(res.body.success, true, 'Admin login success true');
    check(typeof res.body.token === 'string' && res.body.token.length > 20, 'Admin JWT issued');
    return res.body.token;
  };

  const provisionAndRegisterStudent = async ({ tag, name, usn, year }) => {
    const tokenKey = `google-id-token-${tag}`;
    const sub = `google-sub-${tag}`;
    const email = `${tag.toLowerCase()}@vvce.ac.in`;

    env.registerGoogleIdentity(tokenKey, {
      payload: {
        sub,
        email,
        email_verified: true,
        name,
        iss: 'https://accounts.google.com',
      },
    });

    const authRes = await env.http().post('/api/auth/google').send({ idToken: tokenKey });
    checkEqual(authRes.status, 200, `Google login ${tag} -> 200`);
    checkEqual(authRes.body.success, true, `Google login ${tag} success`);
    const jwtToken = authRes.body.token;
    const studentId = authRes.body.student?.id;
    check(Boolean(studentId), `Student ${tag} ID returned`);
    env.trackStudentId(studentId);

    if (usn && year) {
      const regRes = await env
        .http()
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ usn, year });
      checkEqual(
        regRes.status,
        200,
        `Register ${tag} (${usn}) -> 200 (got ${regRes.status}: ${JSON.stringify(regRes.body)})`
      );
      checkEqual(regRes.body.student.usn, usn.toUpperCase(), `Registered USN matches for ${tag}`);
      checkEqual(regRes.body.student.year, year, `Registered year matches for ${tag}`);
      checkEqual(regRes.body.student.registrationComplete, true, `registrationComplete true for ${tag}`);
      checkEqual(regRes.body.student.walletBalance, 0, `Initial walletBalance 0 for ${tag}`);
      checkEqual(regRes.body.student.competitionStatus, 'registered', `Initial status registered for ${tag}`);
      return { token: jwtToken, studentId, usn: regRes.body.student.usn, email, tokenKey };
    }

    return { token: jwtToken, studentId, usn: null, email, tokenKey };
  };

  const playOneLevel = async ({
    studentToken,
    usn,
    vToken,
    result,
    expectedDifficulty = null,
    explicitSettle = true,
    expectLevelNumber = null,
    expectedAllocStatus = 201,
  }) => {
    const allocRes = await env
      .http()
      .post('/api/rounds/allocate')
      .set('Authorization', `Bearer ${studentToken}`);
    checkEqual(
      allocRes.status,
      expectedAllocStatus,
      `Allocate L${expectLevelNumber || '?'} for ${usn} -> ${expectedAllocStatus}`
    );
    checkEqual(allocRes.body.round.status, 'ready', `Allocated round status ready for ${usn}`);
    if (expectLevelNumber !== null) {
      checkEqual(allocRes.body.round.levelNumber, expectLevelNumber, `Round levelNumber ${expectLevelNumber}`);
    }
    if (expectedDifficulty) {
      checkEqual(
        allocRes.body.round.question.difficulty,
        expectedDifficulty,
        `Allocated difficulty ${expectedDifficulty} for ${usn}`
      );
    }
    assertNoSensitiveLeak(allocRes.body, `allocate ${usn}`);

    const startRes = await env
      .http()
      .post(`/api/volunteer/students/${usn}/round/start`)
      .set('Authorization', `Bearer ${vToken}`);
    checkEqual(startRes.status, 200, `Start round ${usn} -> 200`);
    checkEqual(startRes.body.round.status, 'inProgress', `Round inProgress for ${usn}`);

    const evalRes = await env
      .http()
      .post(`/api/volunteer/students/${usn}/round/evaluate`)
      .set('Authorization', `Bearer ${vToken}`)
      .send({
        result,
        remarks: `Evaluated ${result} for ${usn}`,
        programmingLanguage: 'javascript',
      });
    checkEqual(evalRes.status, 200, `Evaluate ${result} for ${usn} -> 200`);
    checkEqual(evalRes.body.evaluation.status, result, `Evaluation status ${result} for ${usn}`);

    let settleRes = null;
    if (explicitSettle) {
      settleRes = await env
        .http()
        .post(`/api/volunteer/students/${usn}/round/settle`)
        .set('Authorization', `Bearer ${vToken}`);
      checkEqual(settleRes.status, 200, `Settle ${usn} -> 200`);
    }

    const progRes = await env
      .http()
      .post(`/api/volunteer/students/${usn}/round/progress`)
      .set('Authorization', `Bearer ${vToken}`);
    checkEqual(progRes.status, 200, `Progress ${usn} -> 200`);

    return { allocRes, startRes, evalRes, settleRes, progRes };
  };

  try {
    await env.start();
    await env.seedBaseData();

    await runSuite('Suite A: Core Auth, Volunteer Provisioning & Student Registration + All 4 Academic Years Allocation', async () => {
      const healthRes = await env.http().get('/api/health');
      checkEqual(healthRes.status, 200, 'GET /api/health returns 200');
      checkEqual(healthRes.body.status, 'ok', 'Health check status ok');
      checkEqual(healthRes.body.server, 'healthy', 'Health check server healthy');

      adminToken = await loginAdmin();
      const aliasAdminRes = await env.http().post('/api/auth/admin/login').send({
        username: env.seededAdminCredentials.username,
        password: env.seededAdminCredentials.password,
      });
      checkEqual(aliasAdminRes.status, 200, 'POST /api/auth/admin/login alias returns 200');

      const adminMeRes = await env
        .http()
        .get('/api/admin/me')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(adminMeRes.status, 200, 'GET /api/admin/me -> 200');

      const createVolRes = await env
        .http()
        .post('/api/admin/volunteers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Integration Volunteer One',
          username: 'vol_int_1',
          password: 'VolPassword!123',
          assignedLab: 'CCD',
        });
      checkEqual(createVolRes.status, 201, 'POST /api/admin/volunteers -> 201');
      volunteerId = createVolRes.body.volunteer.id;
      env.trackStaffId(volunteerId);

      const vLoginRes = await env.http().post('/api/volunteer/login').send({
        username: 'vol_int_1',
        password: 'VolPassword!123',
      });
      checkEqual(vLoginRes.status, 200, 'POST /api/volunteer/login -> 200');
      volunteerToken = vLoginRes.body.token;

      const vAliasRes = await env.http().post('/api/auth/volunteer/login').send({
        username: 'vol_int_1',
        password: 'VolPassword!123',
      });
      checkEqual(vAliasRes.status, 200, 'POST /api/auth/volunteer/login alias -> 200');

      env.registerGoogleIdentity('gmail-token', {
        payload: {
          sub: 'sub-gmail',
          email: 'outsider@gmail.com',
          email_verified: true,
          name: 'Outside User',
          iss: 'https://accounts.google.com',
        },
      });
      const nonCollegeRes = await env.http().post('/api/auth/google').send({ idToken: 'gmail-token' });
      check(nonCollegeRes.status >= 400 && nonCollegeRes.status < 500, 'Rejects non-@vvce.ac.in domain');

      env.registerGoogleIdentity('expired-google-token', { expired: true });
      const expiredGoogleRes = await env
        .http()
        .post('/api/auth/google')
        .send({ idToken: 'expired-google-token' });
      checkEqual(expiredGoogleRes.status, 401, 'Expired Google token rejected 401');

      const missingIdTokenRes = await env.http().post('/api/auth/google').send({});
      checkEqual(missingIdTokenRes.status, 400, 'Empty Google auth payload rejected 400');

      const unregistered = await provisionAndRegisterStudent({
        tag: 'unreg',
        name: 'Unregistered Student',
        usn: null,
        year: null,
      });
      const unregAllocRes = await env
        .http()
        .post('/api/rounds/allocate')
        .set('Authorization', `Bearer ${unregistered.token}`);
      checkEqual(unregAllocRes.status, 403, 'Unregistered student cannot allocate round');

      const deactL6Res = await env
        .http()
        .patch('/api/admin/levels/6/deactivate')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(deactL6Res.status, 200, 'Unused Level 6 can be deactivated -> 200');
      checkEqual(deactL6Res.body.level.isActive, false, 'Level 6 isActive false after deactivate');

      const reactL6Res = await env
        .http()
        .patch('/api/admin/levels/6/activate')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(reactL6Res.status, 200, 'Level 6 can be reactivated -> 200');
      checkEqual(reactL6Res.body.level.isActive, true, 'Level 6 isActive true after activate');

      const y1 = await provisionAndRegisterStudent({
        tag: 'yr1check',
        name: 'Year 1 Student',
        usn: '4VV24CS001',
        year: '1st Year',
      });
      const y2 = await provisionAndRegisterStudent({
        tag: 'yr2check',
        name: 'Year 2 Student',
        usn: '4VV23CS002',
        year: '2nd Year',
      });
      const y3 = await provisionAndRegisterStudent({
        tag: 'yr3check',
        name: 'Year 3 Student',
        usn: '4VV22CS003',
        year: '3rd Year',
      });
      const y4 = await provisionAndRegisterStudent({
        tag: 'yr4check',
        name: 'Year 4 Student',
        usn: '4VV21CS004',
        year: '4th Year',
      });

      const dupUsnStudent = await provisionAndRegisterStudent({
        tag: 'dupUsn',
        name: 'Dup USN Candidate',
        usn: null,
        year: null,
      });
      const dupRegRes = await env
        .http()
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${dupUsnStudent.token}`)
        .send({ usn: '4VV24CS001', year: '1st Year' });
      checkEqual(dupRegRes.status, 409, 'Duplicate USN returns 409');
      checkEqual(dupRegRes.body.code, 'DUPLICATE_USN', 'Duplicate USN code matches');

      const [allocY1A, allocY1B] = await Promise.all([
        env.http().post('/api/rounds/allocate').set('Authorization', `Bearer ${y1.token}`),
        env.http().post('/api/rounds/allocate').set('Authorization', `Bearer ${y1.token}`),
      ]);
      check(
        [200, 201].includes(allocY1A.status) && [200, 201].includes(allocY1B.status),
        'Concurrent allocation requests resolve cleanly'
      );
      checkEqual(
        allocY1A.body.round.id,
        allocY1B.body.round.id,
        'Concurrent allocations return identical Round ID'
      );
      const y1RoundsCount = await env.models.Round.countDocuments({ studentId: y1.studentId, levelNumber: 1 });
      checkEqual(y1RoundsCount, 1, 'Exactly one Round document exists in DB after concurrent allocate');
      checkEqual(allocY1A.body.round.question.difficulty, 'EASY', 'Year 1 allocates EASY');
      assertNoSensitiveLeak(allocY1A.body, 'allocate response');

      const idempRes = await env
        .http()
        .post('/api/rounds/allocate')
        .set('Authorization', `Bearer ${y1.token}`);
      checkEqual(idempRes.status, 200, 'Repeated allocate returns 200');
      checkEqual(idempRes.body.isExisting, true, 'Repeated allocate marks isExisting: true');
      checkEqual(idempRes.body.round.id, allocY1A.body.round.id, 'Same round kept');

      const allocY2 = await env.http().post('/api/rounds/allocate').set('Authorization', `Bearer ${y2.token}`);
      const allocY3 = await env.http().post('/api/rounds/allocate').set('Authorization', `Bearer ${y3.token}`);
      const allocY4 = await env.http().post('/api/rounds/allocate').set('Authorization', `Bearer ${y4.token}`);
      checkEqual(allocY2.status, 201, 'Year 2 alloc -> 201');
      checkEqual(allocY2.body.round.question.difficulty, 'HARD', 'Year 2 allocates HARD');
      checkEqual(allocY3.status, 201, 'Year 3 alloc -> 201');
      checkEqual(allocY3.body.round.question.difficulty, 'HARD', 'Year 3 allocates HARD');
      checkEqual(allocY4.status, 201, 'Year 4 alloc -> 201');
      checkEqual(allocY4.body.round.question.difficulty, 'HARD', 'Year 4 allocates HARD');

      const meRes = await env.http().get('/api/auth/me').set('Authorization', `Bearer ${y1.token}`);
      checkEqual(meRes.status, 200, 'GET /api/auth/me -> 200');
      checkEqual(meRes.body.student.currentLevel, 1, 'GET /api/auth/me currentLevel=1');

      const lvlInfoRes = await env
        .http()
        .get('/api/rounds/level-info')
        .set('Authorization', `Bearer ${y1.token}`);
      checkEqual(lvlInfoRes.status, 200, 'GET /api/rounds/level-info -> 200');

      const activeRes = await env.http().get('/api/rounds/active').set('Authorization', `Bearer ${y1.token}`);
      checkEqual(activeRes.status, 200, 'GET /api/rounds/active -> 200');
      checkEqual(activeRes.body.round.status, 'ready', 'Active round status ready');

      const lookupRes = await env
        .http()
        .get(`/api/volunteer/students/${y2.usn}/round`)
        .set('Authorization', `Bearer ${volunteerToken}`);
      checkEqual(lookupRes.status, 200, 'Volunteer student USN lookup -> 200');
      assertNoSensitiveLeak(lookupRes.body, 'volunteer lookup', { allowStudentEmail: true });

      const startY2Res = await env
        .http()
        .post(`/api/volunteer/students/${y2.usn}/round/start`)
        .set('Authorization', `Bearer ${volunteerToken}`);
      checkEqual(startY2Res.status, 200, 'Start y2 round -> 200');
      checkEqual(startY2Res.body.round.status, 'inProgress', 'y2 round inProgress');

      const extendRes = await env
        .http()
        .post(`/api/volunteer/students/${y2.usn}/round/extend`)
        .set('Authorization', `Bearer ${volunteerToken}`)
        .send({ extensionSeconds: 45, reason: 'Workstation froze briefly' });
      checkEqual(extendRes.status, 200, 'Timer extend -> 200');
      checkEqual(extendRes.body.extensionSeconds, 45, 'Extension seconds reported');
      checkEqual(extendRes.body.round.timerExtensions.length, 1, 'One extension logged');

      await env.models.Round.findByIdAndUpdate(startY2Res.body.round.id, {
        $set: { deadline: new Date(Date.now() - 10000) },
      });
      const expiredSyncRes = await env
        .http()
        .get('/api/rounds/active')
        .set('Authorization', `Bearer ${y2.token}`);
      checkEqual(expiredSyncRes.status, 200, 'Active check after deadline -> 200');
      checkEqual(expiredSyncRes.body.round.status, 'timeExpired', 'Controller synced round status to timeExpired in DB');
      const dbY2Round = await env.models.Round.findById(startY2Res.body.round.id).lean();
      checkEqual(dbY2Round.status, 'timeExpired', 'DB Round.status persisted as timeExpired');
    });

    await runSuite('Suite B: Full L1-L6 PASS Journey, L1-L6 FAIL Paths, Safe Zones, Concurrency & History/Transactions', async () => {
      const champ = await provisionAndRegisterStudent({
        tag: 'champion',
        name: 'Champion Student',
        usn: '4VV23CS100',
        year: '2nd Year',
      });

      const expectedPassProgression = [
        { lvl: 1, wallet: 50, safeZone: 50, status: 'inProgress', completed: false, explicitSettle: true },
        { lvl: 2, wallet: 100, safeZone: 50, status: 'inProgress', completed: false, explicitSettle: false }, // tests auto-settle during progress!
        { lvl: 3, wallet: 150, safeZone: 50, status: 'inProgress', completed: false, explicitSettle: true },
        { lvl: 4, wallet: 250, safeZone: 250, status: 'inProgress', completed: false, explicitSettle: false },
        { lvl: 5, wallet: 350, safeZone: 250, status: 'inProgress', completed: false, explicitSettle: true },
        { lvl: 6, wallet: 500, safeZone: 250, status: 'completed', completed: true, explicitSettle: true },
      ];

      for (const step of expectedPassProgression) {
        const res = await playOneLevel({
          studentToken: champ.token,
          usn: champ.usn,
          vToken: volunteerToken,
          result: 'PASS',
          expectedDifficulty: 'HARD',
          explicitSettle: step.explicitSettle,
          expectLevelNumber: step.lvl,
        });
        checkEqual(res.progRes.body.student.walletBalance, step.wallet, `Champ L${step.lvl} PASS wallet=${step.wallet}`);
        checkEqual(res.progRes.body.student.safeZoneAmount, step.safeZone, `Champ L${step.lvl} PASS safeZone=${step.safeZone}`);
        checkEqual(res.progRes.body.student.competitionStatus, step.status, `Champ L${step.lvl} PASS status=${step.status}`);
        checkEqual(res.progRes.body.progression.isCompleted, step.completed, `Champ L${step.lvl} isCompleted=${step.completed}`);
        if (!step.explicitSettle) {
          checkEqual(res.progRes.body.settlement.didSettleNow, true, `Auto-settle executed on L${step.lvl}`);
        }
      }

      const postCompleteAlloc = await env
        .http()
        .post('/api/rounds/allocate')
        .set('Authorization', `Bearer ${champ.token}`);
      checkEqual(postCompleteAlloc.status, 409, 'Completed student cannot allocate more rounds -> 409');

      const histRes = await env
        .http()
        .get('/api/student/rounds/history')
        .set('Authorization', `Bearer ${champ.token}`);
      checkEqual(histRes.status, 200, 'Champion round history -> 200');
      checkEqual(histRes.body.rounds.length, 6, 'Champion has 6 completed rounds in history');

      const txRes = await env
        .http()
        .get('/api/student/transactions')
        .set('Authorization', `Bearer ${champ.token}`);
      checkEqual(txRes.status, 200, 'Champion transactions -> 200');
      const championCredits = txRes.body.transactions.filter((tx) => tx.type === 'REWARD_CREDIT');
      const championDebits = txRes.body.transactions.filter((tx) => tx.type === 'STAKE_DEBIT');
      checkEqual(txRes.body.transactions.length, 10, 'Champion has 10 immutable ledger transactions');
      checkEqual(championCredits.length, 6, 'Champion has 6 REWARD_CREDIT transactions (one per passed level)');
      checkEqual(championDebits.length, 4, 'Champion has 4 STAKE_DEBIT transactions (risk levels L2/L3/L4/L6; L1 and L5 are free)');
      checkEqual(txRes.body.walletBalance, 500, 'Champion transactions endpoint walletBalance=500');

      const raceStudent = await provisionAndRegisterStudent({
        tag: 'racer',
        name: 'Race Guard Student',
        usn: '4VV24CS101',
        year: '1st Year',
      });
      const rAlloc = await env
        .http()
        .post('/api/rounds/allocate')
        .set('Authorization', `Bearer ${raceStudent.token}`);
      checkEqual(rAlloc.status, 201, 'Race student L1 allocated');
      const rStart = await env
        .http()
        .post(`/api/volunteer/students/${raceStudent.usn}/round/start`)
        .set('Authorization', `Bearer ${volunteerToken}`);
      checkEqual(rStart.status, 200, 'Race student L1 started');

      const [evA, evB] = await Promise.all([
        env
          .http()
          .post(`/api/volunteer/students/${raceStudent.usn}/round/evaluate`)
          .set('Authorization', `Bearer ${volunteerToken}`)
          .send({ result: 'PASS', remarks: 'Concurrent pass A', programmingLanguage: 'python' }),
        env
          .http()
          .post(`/api/volunteer/students/${raceStudent.usn}/round/evaluate`)
          .set('Authorization', `Bearer ${volunteerToken}`)
          .send({ result: 'PASS', remarks: 'Concurrent pass B', programmingLanguage: 'python' }),
      ]);
      const evStatuses = [evA.status, evB.status].sort((a, b) => a - b);
      checkEqual(evStatuses[0], 200, 'Concurrent evaluate: one 200');
      checkEqual(evStatuses[1], 409, 'Concurrent evaluate: second 409');
      const evalDbCount = await env.models.Evaluation.countDocuments({ roundId: rAlloc.body.round.id });
      checkEqual(evalDbCount, 1, 'Exactly 1 Evaluation document exists in DB');

      const [stA, stB] = await Promise.all([
        env
          .http()
          .post(`/api/volunteer/students/${raceStudent.usn}/round/settle`)
          .set('Authorization', `Bearer ${volunteerToken}`),
        env
          .http()
          .post(`/api/volunteer/students/${raceStudent.usn}/round/settle`)
          .set('Authorization', `Bearer ${volunteerToken}`),
      ]);
      const stStatuses = [stA.status, stB.status].sort((a, b) => a - b);
      checkEqual(stStatuses[0], 200, 'Concurrent settle: one 200');
      checkEqual(stStatuses[1], 409, 'Concurrent settle: second 409');
      const txDbCount = await env.models.Transaction.countDocuments({ roundId: rAlloc.body.round.id });
      checkEqual(txDbCount, 1, 'Exactly 1 Transaction document exists in DB');

      const dupSettle = await env
        .http()
        .post(`/api/volunteer/students/${raceStudent.usn}/round/settle`)
        .set('Authorization', `Bearer ${volunteerToken}`);
      checkEqual(dupSettle.status, 409, 'Duplicate settle rejected 409');

      const [prA, prB] = await Promise.all([
        env
          .http()
          .post(`/api/volunteer/students/${raceStudent.usn}/round/progress`)
          .set('Authorization', `Bearer ${volunteerToken}`),
        env
          .http()
          .post(`/api/volunteer/students/${raceStudent.usn}/round/progress`)
          .set('Authorization', `Bearer ${volunteerToken}`),
      ]);
      const prStatuses = [prA.status, prB.status].sort((a, b) => a - b);
      checkEqual(prStatuses[0], 200, 'Concurrent progress: one 200');
      checkEqual(prStatuses[1], 409, 'Concurrent progress: second 409');
      const racerInDb = await env.models.Student.findById(raceStudent.studentId).lean();
      checkEqual(racerInDb.currentLevel, 2, 'Race student progressed exactly once to level 2');
      checkEqual(racerInDb.walletBalance, 50, 'Race student wallet settled once to 50');

      const failScenarios = [
        { failAt: 1, expectedWallet: 0, expectedSafeZone: 0 },
        { failAt: 2, expectedWallet: 50, expectedSafeZone: 50 },
        { failAt: 3, expectedWallet: 50, expectedSafeZone: 50 },
        { failAt: 4, expectedWallet: 50, expectedSafeZone: 50 },
        { failAt: 5, expectedWallet: 250, expectedSafeZone: 250 },
        { failAt: 6, expectedWallet: 250, expectedSafeZone: 250 },
      ];

      for (const scenario of failScenarios) {
        const s = await provisionAndRegisterStudent({
          tag: `failL${scenario.failAt}`,
          name: `Fail Level ${scenario.failAt}`,
          usn: `4VV24CS20${scenario.failAt}`,
          year: '1st Year',
        });
        for (let lvl = 1; lvl < scenario.failAt; lvl += 1) {
          await playOneLevel({
            studentToken: s.token,
            usn: s.usn,
            vToken: volunteerToken,
            result: 'PASS',
            expectLevelNumber: lvl,
          });
        }
        const failOutcome = await playOneLevel({
          studentToken: s.token,
          usn: s.usn,
          vToken: volunteerToken,
          result: 'FAIL',
          expectLevelNumber: scenario.failAt,
        });
        checkEqual(
          failOutcome.progRes.body.student.walletBalance,
          scenario.expectedWallet,
          `L${scenario.failAt} FAIL final wallet=${scenario.expectedWallet}`
        );
        checkEqual(
          failOutcome.progRes.body.student.safeZoneAmount,
          scenario.expectedSafeZone,
          `L${scenario.failAt} FAIL safeZone=${scenario.expectedSafeZone}`
        );
        checkEqual(
          failOutcome.progRes.body.student.competitionStatus,
          'eliminated',
          `L${scenario.failAt} FAIL sets competitionStatus='eliminated'`
        );

        const blockedAlloc = await env
          .http()
          .post('/api/rounds/allocate')
          .set('Authorization', `Bearer ${s.token}`);
        checkEqual(blockedAlloc.status, 409, `Eliminated L${scenario.failAt} student blocked from allocation -> 409`);
      }
    });

    await runSuite('Suite C: Volunteer Management, Admin Monitoring, Dashboard, Level Config & Guarded Recovery', async () => {
      const tempVolRes = await env
        .http()
        .post('/api/admin/volunteers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Temp Volunteer Two',
          username: 'vol_temp_2',
          password: 'InitialVolPass!99',
          assignedLab: 'M Block Entrance',
        });
      checkEqual(tempVolRes.status, 201, 'Create temp volunteer -> 201');
      const tempVolId = tempVolRes.body.volunteer.id;
      env.trackStaffId(tempVolId);

      const tempLogin = await env.http().post('/api/volunteer/login').send({
        username: 'vol_temp_2',
        password: 'InitialVolPass!99',
      });
      checkEqual(tempLogin.status, 200, 'Temp volunteer login -> 200');
      const tempToken = tempLogin.body.token;

      const deactVol = await env
        .http()
        .patch(`/api/admin/volunteers/${tempVolId}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(deactVol.status, 200, 'Deactivate temp volunteer -> 200');

      const blockedMe = await env
        .http()
        .get('/api/volunteer/me')
        .set('Authorization', `Bearer ${tempToken}`);
      checkEqual(blockedMe.status, 403, 'Deactivated volunteer existing JWT immediately blocked -> 403');

      const reactVol = await env
        .http()
        .patch(`/api/admin/volunteers/${tempVolId}/reactivate`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(reactVol.status, 200, 'Reactivate temp volunteer -> 200');

      const resetPw = await env
        .http()
        .patch(`/api/admin/volunteers/${tempVolId}/reset-password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'RotatedVolPass!2026' });
      checkEqual(resetPw.status, 200, 'Reset volunteer password -> 200');

      const oldPwFail = await env.http().post('/api/volunteer/login').send({
        username: 'vol_temp_2',
        password: 'InitialVolPass!99',
      });
      checkEqual(oldPwFail.status, 401, 'Old password fails after reset -> 401');

      const newPwOk = await env.http().post('/api/volunteer/login').send({
        username: 'vol_temp_2',
        password: 'RotatedVolPass!2026',
      });
      checkEqual(newPwOk.status, 200, 'New password succeeds after reset -> 200');

      const qCreate = await env
        .http()
        .post('/api/admin/questions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Admin Custom Graph Test',
          statement: 'Compute shortest path length across weighted edges in connected directed graph.',
          constraints: ['1 <= V <= 100'],
          examples: [{ id: '1', title: 'Sample', input: '3 2', output: '5', explanation: 'Sum.' }],
          difficulty: 'EASY',
          levelNumber: 1,
          hiddenTestCases: [{ input: '10 20', expectedOutput: '30' }],
        });
      checkEqual(qCreate.status, 201, 'Admin create question -> 201');
      const customQId = qCreate.body.question.id;
      env.createdTracker.questionIds.add(customQId);

      const qDeact = await env
        .http()
        .patch(`/api/admin/questions/${customQId}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(qDeact.status, 200, 'Admin deactivate question -> 200');

      const qReact = await env
        .http()
        .patch(`/api/admin/questions/${customQId}/reactivate`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(qReact.status, 200, 'Admin reactivate question -> 200');

      const qDelCreate = await env
        .http()
        .post('/api/admin/questions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Permanent Delete Test Question',
          statement: 'Return the product of two integers.',
          constraints: ['1 <= a, b <= 100'],
          examples: [{ id: '1', title: 'Sample', input: '2 3', output: '6', explanation: 'Product.' }],
          difficulty: 'EASY',
          levelNumber: 1,
          hiddenTestCases: [{ input: '4 5', expectedOutput: '20' }],
        });
      checkEqual(qDelCreate.status, 201, 'Create question for permanent delete test -> 201');
      const delQId = qDelCreate.body.question.id;
      env.createdTracker.questionIds.add(delQId);

      const qDel = await env
        .http()
        .delete(`/api/admin/questions/${delQId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(qDel.status, 200, 'Delete unreferenced question -> 200');
      checkEqual(qDel.body.success, true, 'Delete unreferenced question success');

      const qDelGone = await env
        .http()
        .get(`/api/admin/questions/${delQId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(qDelGone.status, 404, 'Deleted question GET -> 404');

      const qDelAgain = await env
        .http()
        .delete(`/api/admin/questions/${delQId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(qDelAgain.status, 404, 'Delete already-deleted question -> 404');

      const qDelBadId = await env
        .http()
        .delete('/api/admin/questions/not-an-object-id')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(qDelBadId.status, 400, 'Delete with invalid ObjectId -> 400');

      const recStudent = await provisionAndRegisterStudent({
        tag: 'recovery_user',
        name: 'Recovery Target Student',
        usn: '4VV24CS301',
        year: '1st Year',
      });
      const recAlloc = await env
        .http()
        .post('/api/rounds/allocate')
        .set('Authorization', `Bearer ${recStudent.token}`);
      checkEqual(recAlloc.status, 201, 'Allocated round for recovery scenario -> 201');
      const recRoundId = recAlloc.body.round.id;

      const nonAbandRes = await env
        .http()
        .post(`/api/admin/rounds/${recRoundId}/recover`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(nonAbandRes.status, 409, 'Recovering non-abandoned round rejected 409');
      checkEqual(nonAbandRes.body.code, 'ROUND_NOT_ABANDONED', 'Code ROUND_NOT_ABANDONED');

      const guardQId = recAlloc.body.round.questionId;
      check(Boolean(guardQId), 'Allocated round carries its question id');
      const qGuardDel = await env
        .http()
        .delete(`/api/admin/questions/${guardQId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(qGuardDel.status, 409, 'Delete question in an active round -> 409');
      checkEqual(qGuardDel.body.code, 'QUESTION_HAS_ACTIVE_ROUNDS', 'Code QUESTION_HAS_ACTIVE_ROUNDS');

      const qTermCreate = await env
        .http()
        .post('/api/admin/questions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Delete Guard Terminal Round Test',
          statement: 'Return the sum of two integers.',
          constraints: ['1 <= a, b <= 100'],
          examples: [{ id: '1', title: 'Sample', input: '1 2', output: '3', explanation: 'Sum.' }],
          difficulty: 'EASY',
          levelNumber: 1,
          hiddenTestCases: [{ input: '4 5', expectedOutput: '9' }],
        });
      checkEqual(qTermCreate.status, 201, 'Create question for terminal-round delete test -> 201');
      const termQId = qTermCreate.body.question.id;
      env.createdTracker.questionIds.add(termQId);
      const termRound = await env.models.Round.create({
        studentId: recStudent.studentId,
        // Level 2: the studentId+levelNumber index is unique and this
        // student already holds the level-1 round (recRound). The guard
        // only looks at questionId and status, so the level is irrelevant.
        levelNumber: 2,
        questionId: termQId,
        questionSnapshot: {
          questionId: termQId,
          title: 'Delete Guard Terminal Round Test',
          statement: 'Return the sum of two integers.',
          difficulty: 'EASY',
          levelNumber: 1,
        },
        status: 'evaluated',
      });
      const qTermDel = await env
        .http()
        .delete(`/api/admin/questions/${termQId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(qTermDel.status, 200, 'Delete question referenced only by a finished round -> 200');
      await env.models.Round.findByIdAndDelete(termRound._id);
      const termRoundGone = await env.models.Round.findById(termRound._id);
      checkEqual(termRoundGone, null, 'Terminal test round removed after the delete test');

      await env.models.Round.findByIdAndUpdate(recRoundId, { $set: { status: 'abandoned' } });

      const badIdRec = await env
        .http()
        .post('/api/admin/rounds/not-an-object-id/recover')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(badIdRec.status, 400, 'Invalid ObjectId on recover -> 400');

      const missingIdRec = await env
        .http()
        .post(`/api/admin/rounds/${new mongoose.Types.ObjectId().toString()}/recover`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(missingIdRec.status, 404, 'Nonexistent roundId on recover -> 404');

      const [recA, recB] = await Promise.all([
        env
          .http()
          .post(`/api/admin/rounds/${recRoundId}/recover`)
          .set('Authorization', `Bearer ${adminToken}`),
        env
          .http()
          .post(`/api/admin/rounds/${recRoundId}/recover`)
          .set('Authorization', `Bearer ${adminToken}`),
      ]);
      const recStatuses = [recA.status, recB.status].sort((a, b) => a - b);
      checkEqual(recStatuses[0], 200, 'Concurrent recovery: one 200');
      checkEqual(recStatuses[1], 409, 'Concurrent recovery: second 409');
      const okRecBody = recA.status === 200 ? recA.body : recB.body;
      checkEqual(okRecBody.round.id, recRoundId, 'Recovered round preserved exact same _id');
      checkEqual(okRecBody.round.status, 'ready', 'Recovered round reset to ready');
      checkEqual(
        okRecBody.round.question.id,
        recAlloc.body.round.question.id,
        'Recovered round preserved original questionId'
      );

      const recPlay = await playOneLevel({
        studentToken: recStudent.token,
        usn: recStudent.usn,
        vToken: volunteerToken,
        result: 'PASS',
        expectLevelNumber: 1,
        expectedAllocStatus: 200,
      });
      checkEqual(recPlay.allocRes.body.isExisting, true, 'Recovered round returned via existing ready round');
      checkEqual(recPlay.allocRes.body.round.id, recRoundId, 'Re-allocated recovered round preserves _id');
      checkEqual(recPlay.progRes.body.student.walletBalance, 50, 'Recovered round completes and settles cleanly');

      const levelsRes = await env
        .http()
        .get('/api/admin/levels')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(levelsRes.status, 200, 'GET /api/admin/levels -> 200');
      checkEqual(levelsRes.body.levels.length, 6, 'All 6 levels returned');
      const lvl1 = levelsRes.body.levels.find((l) => l.number === 1);
      checkEqual(lvl1.isUsedInCompetition, true, 'Level 1 flagged isUsedInCompetition=true');

      const lockUpdateRes = await env
        .http()
        .put('/api/admin/levels/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ winningPayout: 999 });
      checkEqual(lockUpdateRes.status, 409, 'Modifying financial field on used Level 1 returns 409');
      checkEqual(lockUpdateRes.body.code, 'LEVEL_CONFIGURATION_LOCKED', 'Code LEVEL_CONFIGURATION_LOCKED');

      const safeDescUpdate = await env
        .http()
        .put('/api/admin/levels/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Level 1 Updated Name', durationSeconds: 200 });
      checkEqual(safeDescUpdate.status, 200, 'Non-financial name/duration update allowed -> 200');

      const deactUsedL1 = await env
        .http()
        .patch('/api/admin/levels/1/deactivate')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(deactUsedL1.status, 409, 'Deactivating in-use Level 1 blocked with 409');

      const txBefore = await env.models.Transaction.countDocuments({});
      const rndBefore = await env.models.Round.countDocuments({});

      const [dashRes, partsRes, partDetailRes, roundsMonRes, txMonRes] = await Promise.all([
        env.http().get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`),
        env.http().get('/api/admin/participants?page=1&limit=10').set('Authorization', `Bearer ${adminToken}`),
        env.http().get('/api/admin/participants/4VV23CS100').set('Authorization', `Bearer ${adminToken}`),
        env.http().get('/api/admin/rounds?page=1&limit=20').set('Authorization', `Bearer ${adminToken}`),
        env.http().get('/api/admin/transactions?page=1&limit=20').set('Authorization', `Bearer ${adminToken}`),
      ]);

      checkEqual(dashRes.status, 200, 'GET /api/admin/dashboard -> 200');
      checkEqual(partsRes.status, 200, 'GET /api/admin/participants -> 200');
      checkEqual(partDetailRes.status, 200, 'GET /api/admin/participants/:usn -> 200');
      checkEqual(roundsMonRes.status, 200, 'GET /api/admin/rounds -> 200');
      checkEqual(txMonRes.status, 200, 'GET /api/admin/transactions -> 200');

      assertNoSensitiveLeak(dashRes.body, 'admin dashboard');
      assertNoSensitiveLeak(partsRes.body, 'admin participants');
      assertNoSensitiveLeak(partDetailRes.body, 'admin participant details');
      assertNoSensitiveLeak(roundsMonRes.body, 'admin rounds');
      assertNoSensitiveLeak(txMonRes.body, 'admin transactions');

      const dbCompletedStudents = await env.models.Student.countDocuments({ competitionStatus: 'completed' });
      const dbEliminatedStudents = await env.models.Student.countDocuments({ competitionStatus: 'eliminated' });
      checkEqual(
        dashRes.body.dashboard.participants.completed,
        dbCompletedStudents,
        'Dashboard completed count matches DB'
      );
      checkEqual(
        dashRes.body.dashboard.participants.eliminated,
        dbEliminatedStudents,
        'Dashboard eliminated count matches DB'
      );
      checkEqual(dashRes.body.dashboard.transactions.total, txBefore, 'Dashboard tx count matches DB');
      checkEqual(dashRes.body.dashboard.rounds.total, rndBefore, 'Dashboard rounds count matches DB');

      const txAfter = await env.models.Transaction.countDocuments({});
      const rndAfter = await env.models.Round.countDocuments({});
      checkEqual(txAfter, txBefore, 'Monitoring did not mutate Transactions');
      checkEqual(rndAfter, rndBefore, 'Monitoring did not mutate Rounds');
    });

    await runSuite('Suite D: Leaderboard Integration (Student, Volunteer & Admin)', async () => {
      const lbStudent = await provisionAndRegisterStudent({
        tag: 'lb_viewer',
        name: 'Leaderboard Viewer',
        usn: '4VV24CS401',
        year: '1st Year',
      });

      for (const [role, tok] of [
        ['STUDENT', lbStudent.token],
        ['VOLUNTEER', volunteerToken],
        ['ADMIN', adminToken],
      ]) {
        const lbRes = await env
          .http()
          .get('/api/leaderboard?page=1&limit=10')
          .set('Authorization', `Bearer ${tok}`);
        checkEqual(lbRes.status, 200, `GET /api/leaderboard as ${role} -> 200`);
        check(Array.isArray(lbRes.body.leaderboard), `Leaderboard array returned for ${role}`);
        check(lbRes.body.leaderboard.length >= 1, `Leaderboard populated for ${role}`);
        checkEqual(lbRes.body.leaderboard[0].usn, '4VV23CS100', `Champion USN ranks #1 for ${role}`);
        assertNoSensitiveLeak(lbRes.body, `leaderboard (${role})`);

        const recRes = await env
          .http()
          .get('/api/competition/records')
          .set('Authorization', `Bearer ${tok}`);
        checkEqual(recRes.status, 200, `GET /api/competition/records as ${role} -> 200`);
        assertNoSensitiveLeak(recRes.body, `records (${role})`);
      }

      const meLbOk = await env
        .http()
        .get('/api/leaderboard/me')
        .set('Authorization', `Bearer ${lbStudent.token}`);
      checkEqual(meLbOk.status, 200, 'GET /api/leaderboard/me as Student -> 200');

      const meLbVolBlock = await env
        .http()
        .get('/api/leaderboard/me')
        .set('Authorization', `Bearer ${volunteerToken}`);
      checkEqual(meLbVolBlock.status, 403, 'GET /api/leaderboard/me as Volunteer -> 403');

      const meLbAdminBlock = await env
        .http()
        .get('/api/leaderboard/me')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(meLbAdminBlock.status, 403, 'GET /api/leaderboard/me as Admin -> 403');
    });

    await runSuite('Suite E: Task 5 Security Middleware, RBAC, Validation & Real Rate-Limiting Negative Tests', async () => {
      const noAuth = await env.http().get('/api/admin/dashboard');
      checkEqual(noAuth.status, 401, 'Missing Authorization header -> 401');

      const badJwt = await env
        .http()
        .get('/api/admin/dashboard')
        .set('Authorization', 'Bearer not.a.valid.jwt');
      checkEqual(badJwt.status, 401, 'Malformed JWT -> 401');

      const expiredJwt = jwt.sign(
        { sub: new mongoose.Types.ObjectId().toString(), role: 'ADMIN' },
        process.env.JWT_SECRET,
        { expiresIn: -60 }
      );
      const expRes = await env
        .http()
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${expiredJwt}`);
      checkEqual(expRes.status, 401, 'Expired JWT -> 401');

      const futureJwt = jwt.sign(
        { sub: new mongoose.Types.ObjectId().toString(), role: 'ADMIN' },
        process.env.JWT_SECRET,
        { notBefore: 3600, expiresIn: 7200 }
      );
      const nbfRes = await env
        .http()
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${futureJwt}`);
      checkEqual(nbfRes.status, 401, 'Future nbf JWT -> 401');

      const badSubJwt = jwt.sign(
        { sub: 'not-a-mongo-objectid', role: 'ADMIN' },
        process.env.JWT_SECRET,
        { expiresIn: 300 }
      );
      const badSubRes = await env
        .http()
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${badSubJwt}`);
      checkEqual(badSubRes.status, 401, 'Invalid ObjectId sub claim -> 401');

      const ghostJwt = jwt.sign(
        { sub: new mongoose.Types.ObjectId().toString(), role: 'STUDENT' },
        process.env.JWT_SECRET,
        { expiresIn: 300 }
      );
      const ghostRes = await env
        .http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${ghostJwt}`);
      checkEqual(ghostRes.status, 401, 'Nonexistent/deleted Student subject JWT -> 401');

      const volToAdmin = await env
        .http()
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${volunteerToken}`);
      checkEqual(volToAdmin.status, 403, 'Volunteer hitting /api/admin/dashboard -> 403');

      const adminToRound = await env
        .http()
        .post('/api/rounds/allocate')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(adminToRound.status, 403, 'Admin hitting /api/rounds/allocate -> 403');

      const badOriginRes = await env
        .http()
        .get('/api/health')
        .set('Origin', 'https://untrusted-attacker.example.com');
      checkEqual(badOriginRes.status, 403, 'Disallowed CORS origin -> 403');
      checkEqual(badOriginRes.body.code, 'CORS_ORIGIN_NOT_ALLOWED', 'CORS code matches');

      const goodOriginRes = await env
        .http()
        .get('/api/health')
        .set('Origin', 'https://codebuddy.vvce.ac.in');
      checkEqual(goodOriginRes.status, 200, 'Approved CORS origin -> 200');
      checkEqual(
        goodOriginRes.headers['access-control-allow-origin'],
        'https://codebuddy.vvce.ac.in',
        'Approved CORS header echoed'
      );
      checkEqual(goodOriginRes.headers['x-content-type-options'], 'nosniff', 'Helmet nosniff present');
      checkEqual(goodOriginRes.headers['x-frame-options'], 'DENY', 'Helmet x-frame-options DENY');
      checkEqual(goodOriginRes.headers['x-powered-by'], undefined, 'X-Powered-By stripped');

      const malformedRes = await env
        .http()
        .post('/api/admin/login')
        .set('Content-Type', 'application/json')
        .send('{"username": "intadmin", "password": ');
      checkEqual(malformedRes.status, 400, 'Malformed JSON body -> 400');
      checkEqual(malformedRes.body.code, 'INVALID_JSON_BODY', 'Code INVALID_JSON_BODY');

      const hugeString = 'x'.repeat(160 * 1024); // > 128kb JSON_BODY_LIMIT
      const oversizedRes = await env
        .http()
        .post('/api/admin/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ username: hugeString, password: 'abc' }));
      checkEqual(oversizedRes.status, 413, 'Oversized JSON > 128kb -> 413');
      checkEqual(oversizedRes.body.code, 'PAYLOAD_TOO_LARGE', 'Code PAYLOAD_TOO_LARGE');

      const unknownRes = await env.http().get('/api/nonexistent-phase8-route');
      checkEqual(unknownRes.status, 404, 'Unknown API route -> 404');
      checkEqual(unknownRes.body.code, 'ROUTE_NOT_FOUND', 'Code ROUTE_NOT_FOUND');

      for (const errBody of [badOriginRes.body, malformedRes.body, oversizedRes.body, unknownRes.body]) {
        const s = JSON.stringify(errBody);
        check(!/"stack"/i.test(s), 'Error response must not expose stack field');
        check(!s.includes(process.env.JWT_SECRET), 'Error response must not contain JWT_SECRET');
        check(!s.includes('127.0.0.1'), 'Error response must not leak Mongo URI');
      }

      const { app: tightApp } = env.reloadAppWithEnv({
        API_RATE_LIMIT_MAX: '5',
        LOGIN_RATE_LIMIT_MAX: '2',
        LOGIN_IP_RATE_LIMIT_MAX: '2',
      });
      const tightReq = request(tightApp);

      const rl1 = await tightReq
        .post('/api/admin/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ username: 'wrong', password: 'wrong' });
      const rl2 = await tightReq
        .post('/api/admin/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ username: 'wrong', password: 'wrong' });
      const rl3 = await tightReq
        .post('/api/admin/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ username: 'wrong', password: 'wrong' });
      checkEqual(rl1.status, 401, 'Login attempt 1 within limit -> 401');
      checkEqual(rl2.status, 401, 'Login attempt 2 within limit -> 401');
      checkEqual(rl3.status, 429, 'Login attempt 3 exceeds LOGIN_RATE_LIMIT_MAX -> 429');
      checkEqual(rl3.body.code, 'RATE_LIMIT_EXCEEDED', 'Login rate limiter returns RATE_LIMIT_EXCEEDED');

      for (let i = 1; i <= 5; i += 1) {
        const r = await tightReq
          .get('/api/admin/me')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Forwarded-For', '203.0.113.20');
        checkEqual(r.status, 200, `General API call ${i}/5 succeeds -> 200`);
      }
      const api6 = await tightReq
        .get('/api/admin/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '203.0.113.20');
      checkEqual(api6.status, 429, 'General API call 6/5 hits 429 RATE_LIMIT_EXCEEDED');
      checkEqual(api6.body.code, 'RATE_LIMIT_EXCEEDED', 'General API rate limit code matches');

      const healthExempt = await tightReq.get('/api/health').set('X-Forwarded-For', '203.0.113.20');
      checkEqual(healthExempt.status, 200, 'GET /api/health remains exempt -> 200');

      // LOAD_TEST_MODE: the general limiter is relaxed even when
      // API_RATE_LIMIT_MAX is tight, but login brute-force limiters stay live.
      const { app: loadTestApp } = env.reloadAppWithEnv({
        LOAD_TEST_MODE: 'true',
        API_RATE_LIMIT_MAX: '5',
        LOGIN_RATE_LIMIT_MAX: '2',
        LOGIN_IP_RATE_LIMIT_MAX: '2',
      });
      const loadTestReq = request(loadTestApp);

      for (let i = 1; i <= 6; i += 1) {
        const r = await loadTestReq
          .get('/api/admin/me')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Forwarded-For', '203.0.113.30');
        checkEqual(r.status, 200, `LOAD_TEST_MODE general API call ${i}/6 succeeds despite API_RATE_LIMIT_MAX=5 -> 200`);
      }

      for (let i = 1; i <= 2; i += 1) {
        const r = await loadTestReq
          .post('/api/admin/login')
          .set('X-Forwarded-For', '203.0.113.31')
          .send({ username: 'wrong', password: 'wrong' });
        checkEqual(r.status, 401, `LOAD_TEST_MODE login attempt ${i} within limit -> 401`);
      }
      const loadTestRl3 = await loadTestReq
        .post('/api/admin/login')
        .set('X-Forwarded-For', '203.0.113.31')
        .send({ username: 'wrong', password: 'wrong' });
      checkEqual(loadTestRl3.status, 429, 'LOAD_TEST_MODE login attempt 3 still exceeds LOGIN_RATE_LIMIT_MAX -> 429');
    });

    await runSuite('Suite F: Organizer Delete Guard, Bulk Add, Location Enum & Plain-Text Passwords', async () => {
      // Location enum: a spot outside the three event locations is rejected.
      const badLocCreate = await env
        .http()
        .post('/api/admin/volunteers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Bad Location Volunteer',
          username: 'vol_bad_loc',
          password: 'BadLocPass!123',
          assignedLab: 'Lab 1',
        });
      checkEqual(badLocCreate.status, 400, 'Create with non-enum location -> 400');
      checkEqual(badLocCreate.body.code, 'INVALID_ASSIGNED_LAB', 'Code INVALID_ASSIGNED_LAB');

      // Bulk add: one valid row, one duplicate username, one bad location.
      const bulkRes = await env
        .http()
        .post('/api/admin/volunteers/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          volunteers: [
            { name: 'Bulk Plain One', username: 'bulk_plain_1', password: 'BulkPlainPass!1', assignedLab: 'ccd' },
            { name: 'Bulk Duplicate', username: 'vol_int_1', password: 'BulkDupPass!123', assignedLab: 'CCD' },
            { name: 'Bulk Bad Spot', username: 'bulk_bad_spot', password: 'BulkBadPass!123', assignedLab: 'Lab 9' },
          ],
        });
      checkEqual(bulkRes.status, 200, 'POST /api/admin/volunteers/bulk -> 200');
      checkEqual(bulkRes.body.summary.created, 1, 'Bulk summary created 1');
      checkEqual(bulkRes.body.summary.skipped, 2, 'Bulk summary skipped 2');
      checkEqual(bulkRes.body.results[0].status, 'created', 'Bulk row 0 created');
      checkEqual(bulkRes.body.results[1].status, 'skipped', 'Bulk duplicate row skipped');
      checkEqual(bulkRes.body.results[2].status, 'skipped', 'Bulk bad-location row skipped');
      check(
        bulkRes.body.results[2].reason.includes('M Block Entrance'),
        'Bulk bad-location reason names the valid locations'
      );
      const bulkVol = await env.models.Staff.findOne({ username: 'bulk_plain_1' });
      check(Boolean(bulkVol), 'Bulk-created organizer exists in DB');
      env.trackStaffId(bulkVol._id);
      checkEqual(bulkVol.assignedLab, 'CCD', 'Bulk location stored with canonical spelling');

      // Organizer passwords are stored as plain text by the event team's decision.
      checkEqual(bulkVol.passwordHash, 'BulkPlainPass!1', 'Organizer password stored as plain text');

      // Detail endpoint exposes the password for admin eyes only; the list never does.
      const detailRes = await env
        .http()
        .get(`/api/admin/volunteers/${bulkVol._id.toString()}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(detailRes.status, 200, 'Organizer detail -> 200');
      checkEqual(detailRes.body.volunteer.password, 'BulkPlainPass!1', 'Detail response includes the password');
      const listRes = await env
        .http()
        .get('/api/admin/volunteers')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(listRes.status, 200, 'Organizer list -> 200');
      check(
        listRes.body.volunteers.every((vol) => !('password' in vol)),
        'List response never includes passwords'
      );

      // Dual-mode login: the plain-text row logs in, and so does a row whose
      // password is still bcrypt-hashed from before the change.
      const plainLogin = await env.http().post('/api/volunteer/login').send({
        username: 'bulk_plain_1',
        password: 'BulkPlainPass!1',
      });
      checkEqual(plainLogin.status, 200, 'Plain-text organizer password logs in -> 200');
      const hashedHash = await env.models.Staff.hashPassword('HashedPass!123');
      const hashedVol = await env.models.Volunteer.create({
        name: 'Hashed Legacy Volunteer',
        username: 'vol_hashed_legacy',
        passwordHash: hashedHash,
        role: 'VOLUNTEER',
        isActive: true,
        assignedLab: 'CCD',
      });
      env.trackStaffId(hashedVol._id);
      const hashedLogin = await env.http().post('/api/volunteer/login').send({
        username: 'vol_hashed_legacy',
        password: 'HashedPass!123',
      });
      checkEqual(hashedLogin.status, 200, 'Bcrypt-hashed organizer row still logs in -> 200');
      const wrongLogin = await env.http().post('/api/volunteer/login').send({
        username: 'bulk_plain_1',
        password: 'WrongPassword!1',
      });
      checkEqual(wrongLogin.status, 401, 'Wrong organizer password still rejected -> 401');

      // Update: lowercase location canonicalizes; a non-enum location is refused.
      const updateOk = await env
        .http()
        .patch(`/api/admin/volunteers/${bulkVol._id.toString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedLab: 'mangaluru canteen' });
      checkEqual(updateOk.status, 200, 'Update location with lowercase value -> 200');
      checkEqual(updateOk.body.volunteer.assignedLab, 'Mangaluru Canteen', 'Update stores canonical location');
      const updateBad = await env
        .http()
        .patch(`/api/admin/volunteers/${bulkVol._id.toString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedLab: 'Lab 1' });
      checkEqual(updateBad.status, 400, 'Update with non-enum location -> 400');

      // Delete guard: the Suite A volunteer ran rounds in Suite B, so the
      // delete must be refused and the account must survive.
      const linkedEvaluations = await env.models.Evaluation.countDocuments({
        $or: [{ evaluatedBy: volunteerId }, { settledBy: volunteerId }, { progressedBy: volunteerId }],
      });
      const linkedRounds = await env.models.Round.countDocuments({ startedBy: volunteerId });
      check(linkedEvaluations + linkedRounds > 0, 'Suite A volunteer has linked records for the guard test');
      const deleteBlocked = await env
        .http()
        .delete(`/api/admin/volunteers/${volunteerId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(deleteBlocked.status, 409, 'Delete organizer with linked records -> 409');
      checkEqual(deleteBlocked.body.code, 'VOLUNTEER_HAS_LINKED_RECORDS', 'Code VOLUNTEER_HAS_LINKED_RECORDS');
      const stillThere = await env
        .http()
        .get(`/api/admin/volunteers/${volunteerId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(stillThere.status, 200, 'Blocked delete leaves the account intact -> 200');

      // Delete never touches the admin account and rejects malformed ids.
      const adminDoc = await env.models.Staff.findOne({ username: env.seededAdminCredentials.username });
      const deleteAdmin = await env
        .http()
        .delete(`/api/admin/volunteers/${adminDoc._id.toString()}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(deleteAdmin.status, 404, 'Delete admin via volunteer endpoint -> 404');
      const deleteBadId = await env
        .http()
        .delete('/api/admin/volunteers/not-an-object-id')
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(deleteBadId.status, 400, 'Delete with invalid id -> 400');

      // Delete succeeds for an organizer with no linked records.
      const tempDelRes = await env
        .http()
        .post('/api/admin/volunteers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Delete Me Volunteer',
          username: 'vol_delete_me',
          password: 'DeleteMePass!1',
          assignedLab: 'Mangaluru Canteen',
        });
      checkEqual(tempDelRes.status, 201, 'Create deletable organizer -> 201');
      const tempDelId = tempDelRes.body.volunteer.id;
      env.trackStaffId(tempDelId);
      const deleteOk = await env
        .http()
        .delete(`/api/admin/volunteers/${tempDelId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(deleteOk.status, 200, 'Delete unlinked organizer -> 200');
      const goneRes = await env
        .http()
        .get(`/api/admin/volunteers/${tempDelId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      checkEqual(goneRes.status, 404, 'Deleted organizer detail -> 404');
      const goneLogin = await env.http().post('/api/volunteer/login').send({
        username: 'vol_delete_me',
        password: 'DeleteMePass!1',
      });
      checkEqual(goneLogin.status, 401, 'Deleted organizer login -> 401');

      // Bulk cap: 51 rows are refused before anything is created.
      const capRows = Array.from({ length: 51 }, (_, i) => ({
        name: `Cap Volunteer ${i}`,
        username: `bulk_cap_${i}`,
        password: 'BulkCapPass!123',
        assignedLab: 'CCD',
      }));
      const capRes = await env
        .http()
        .post('/api/admin/volunteers/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ volunteers: capRows });
      checkEqual(capRes.status, 400, 'Bulk with 51 rows -> 400');
      checkEqual(capRes.body.code, 'BULK_LIMIT_EXCEEDED', 'Code BULK_LIMIT_EXCEEDED');
      const capProbe = await env
        .http()
        .post('/api/admin/volunteers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Cap Probe Volunteer',
          username: 'bulk_cap_0',
          password: 'BulkCapPass!123',
          assignedLab: 'CCD',
        });
      checkEqual(capProbe.status, 201, 'Capped bulk created nothing (probe username still free) -> 201');
      env.trackStaffId(capProbe.body.volunteer.id);
    });
  } finally {
    await env.stop();
  }

  console.log('\n=== TASK 6 REAL-DB INTEGRATION TEST SUMMARY ===');
  for (const s of suiteResults) {
    console.log(` - ${s.name}: ${s.status} (${s.assertions || 0} assertions)`);
  }
  console.log(
    `TOTAL ASSERTIONS: ${passedAssertions + failedAssertions} | PASSED: ${passedAssertions} | FAILED: ${failedAssertions}`
  );
  if (failedAssertions > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Integration suite failed:', err);
  process.exit(1);
});

