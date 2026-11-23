const assert = require('assert');
const mongoose = require('mongoose');

const {
  getLevelInfo,
  allocateQuestion,
} = require('../controllers/roundController');
const {
  getStudentTransactions,
  getCompetitionConfig,
} = require('../controllers/studentController');
const {
  settleStudentRoundByUsn,
  progressStudentRoundByUsn,
} = require('../controllers/volunteer');
const {
  Student,
  Round,
  Question,
  Level,
  Evaluation,
  Transaction,
  Staff,
} = require('../models');

// Single ladder: level definitions live in the seed script, not in a second fixture copy.
const { INITIAL_LEVELS } = require('../scripts/seedLevels');
const { TOTAL_LEVELS } = require('../constants');

const mockRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
};

async function runWalletWorkflowTests() {
  console.log('===============================================================');
  console.log('Code Buddy 2.0: Wallet Deduction & Round Entry Automated Tests');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(`       Error: ${err.message}`);
      if (err.stack) {
        console.error(`       Stack: ${err.stack.split('\n').slice(1, 4).join('\n')}`);
      }
      failed++;
    }
  };

  const store = {
    students: new Map(),
    rounds: new Map(),
    questions: new Map(),
    levels: new Map(),
    evaluations: new Map(),
    transactions: new Map(),
  };

  INITIAL_LEVELS.forEach((lvl) => {
    const doc = { ...lvl, _id: new mongoose.Types.ObjectId() };
    store.levels.set(lvl.number, doc);
  });

  for (let lvl = 1; lvl <= TOTAL_LEVELS; lvl++) {
    for (const diff of ['EASY', 'HARD']) {
      const qId = new mongoose.Types.ObjectId();
      store.questions.set(qId.toString(), {
        _id: qId,
        title: `L${lvl} ${diff} Question 1`,
        statement: `Sample problem for level ${lvl}`,
        constraints: ['1 <= N <= 100'],
        examples: [{ id: 'ex-1', title: 'Sample 1', input: '1', output: '2', explanation: 'Double' }],
        difficulty: diff,
        levelNumber: lvl,
        hiddenTestCases: [{ input: '5', expectedOutput: '10' }],
        isActive: true,
      });
    }
  }

  const origStudentFindById = Student.findById;
  const origStudentFindOne = Student.findOne;
  const origStudentFindOneAndUpdate = Student.findOneAndUpdate;
  const origStudentFindByIdAndUpdate = Student.findByIdAndUpdate;

  const origRoundFindOne = Round.findOne;
  const origRoundFind = Round.find;
  const origRoundSave = Round.prototype.save;

  const origLevelFindOne = Level.findOne;
  const origLevelFind = Level.find;

  const origQuestionFind = Question.find;

  const origTransactionFindOne = Transaction.findOne;
  const origTransactionFind = Transaction.find;
  const origTransactionCountDocuments = Transaction.countDocuments;
  const origTransactionExists = Transaction.exists;
  const origTransactionSave = Transaction.prototype.save;

  const origEvaluationFindOne = Evaluation.findOne;
  const origEvaluationFindOneAndUpdate = Evaluation.findOneAndUpdate;
  const origEvaluationFindByIdAndUpdate = Evaluation.findByIdAndUpdate;

  const origMongooseStartSession = mongoose.startSession;

  mongoose.startSession = async function () {
    return {
      withTransaction: async (callback) => {
        const studentSnap = new Map(Array.from(store.students.entries()).map(([k, v]) => [k, { ...v }]));
        const roundSnap = new Map(Array.from(store.rounds.entries()).map(([k, v]) => [k, { ...v }]));
        const txSnap = new Map(Array.from(store.transactions.entries()).map(([k, v]) => [k, { ...v }]));
        const evalSnap = new Map(Array.from(store.evaluations.entries()).map(([k, v]) => [k, { ...v }]));
        try {
          return await callback();
        } catch (err) {
          store.students = studentSnap;
          store.rounds = roundSnap;
          store.transactions = txSnap;
          store.evaluations = evalSnap;
          throw err;
        }
      },
      endSession: async () => {},
    };
  };

  Student.findById = function (id) {
    const doc = store.students.get(id?.toString());
    const copy = doc ? { ...doc } : null;
    const query = {
      session() { return this; },
      then(resolve) { resolve(copy); },
      exec: async () => copy,
    };
    if (copy) Object.assign(query, copy);
    return query;
  };

  Student.findOne = async function (filter) {
    for (const s of store.students.values()) {
      if (filter.usn && s.usn === filter.usn) return { ...s };
      if (filter._id && s._id.toString() === filter._id.toString()) return { ...s };
    }
    return null;
  };

  Student.findOneAndUpdate = async function (filter, update, opts = {}) {
    const student = store.students.get(filter._id?.toString());
    if (!student) return null;

    if (filter.walletBalance && filter.walletBalance.$gte !== undefined) {
      if ((student.walletBalance ?? 0) < filter.walletBalance.$gte) {
        return null; // Conditional update fails!
      }
    }

    if (update.$inc) {
      if (update.$inc.walletBalance !== undefined) {
        student.walletBalance = (student.walletBalance ?? 0) + update.$inc.walletBalance;
      }
      if (update.$inc.totalRisked !== undefined) {
        student.totalRisked = (student.totalRisked ?? 0) + update.$inc.totalRisked;
      }
    }
    if (update.$set) {
      Object.assign(student, update.$set);
    }
    store.students.set(student._id.toString(), student);
    return { ...student };
  };

  Student.findByIdAndUpdate = async function (id, update, opts = {}) {
    const student = store.students.get(id?.toString());
    if (!student) return null;

    if (update.$inc) {
      if (update.$inc.walletBalance !== undefined) {
        student.walletBalance = (student.walletBalance ?? 0) + update.$inc.walletBalance;
      }
      if (update.$inc.totalRisked !== undefined) {
        student.totalRisked = (student.totalRisked ?? 0) + update.$inc.totalRisked;
      }
    }
    if (update.$set) {
      Object.assign(student, update.$set);
    }
    store.students.set(student._id.toString(), student);
    return { ...student };
  };

  Level.findOne = function (filter) {
    let match = null;
    if (filter.number !== undefined) {
      const lvl = store.levels.get(filter.number);
      if (lvl && (filter.isActive === undefined || lvl.isActive === filter.isActive)) {
        match = { ...lvl };
      }
    }
    const query = {
      session() { return this; },
      then(resolve) { resolve(match); },
      exec: async () => match,
    };
    if (match) Object.assign(query, match);
    return query;
  };

  Level.find = function (filter = {}) {
    const list = Array.from(store.levels.values()).filter((l) =>
      filter.isActive === undefined || l.isActive === filter.isActive
    );
    list.sort((a, b) => a.number - b.number);
    return {
      sort() {
        return Promise.resolve(list.map((l) => ({ ...l })));
      },
      then(resolve) {
        resolve(list.map((l) => ({ ...l })));
      },
    };
  };

  Round.findOne = function (filter) {
    let match = null;
    for (const r of store.rounds.values()) {
      if (filter.studentId && r.studentId.toString() !== filter.studentId.toString()) continue;
      if (filter.levelNumber && r.levelNumber !== filter.levelNumber) continue;
      if (filter.status && filter.status.$ne && r.status === filter.status.$ne) continue;
      match = { ...r };
      break;
    }
    return {
      session() { return this; },
      then(resolve) { resolve(match); },
      exec: async () => match,
    };
  };

  Round.find = function (filter) {
    const matches = [];
    for (const r of store.rounds.values()) {
      if (filter.studentId && r.studentId.toString() !== filter.studentId.toString()) continue;
      matches.push({ ...r });
    }
    return {
      select() {
        return {
          then(res) { res(matches); },
        };
      },
      sort() {
        return {
          skip() {
            return {
              limit() {
                return Promise.resolve(matches);
              },
            };
          },
        };
      },
      then(resolve) { resolve(matches); },
    };
  };

  Round.prototype.save = async function () {
    const r = this.toObject ? this.toObject() : { ...this._doc };
    if (!r._id) r._id = new mongoose.Types.ObjectId();
    for (const existing of store.rounds.values()) {
      if (
        existing.studentId.toString() === r.studentId.toString() &&
        existing.levelNumber === r.levelNumber &&
        existing._id.toString() !== r._id.toString()
      ) {
        const err = new Error('E11000 duplicate key error');
        err.code = 11000;
        throw err;
      }
    }
    store.rounds.set(r._id.toString(), r);
    return r;
  };

  Question.find = async function (filter) {
    const results = [];
    for (const q of store.questions.values()) {
      if (filter.levelNumber && q.levelNumber !== filter.levelNumber) continue;
      if (filter.difficulty && q.difficulty !== filter.difficulty) continue;
      if (filter.isActive !== undefined && q.isActive !== filter.isActive) continue;
      results.push({ ...q });
    }
    return results;
  };

  Transaction.findById = function (id) {
    const doc = store.transactions.get(id?.toString());
    const copy = doc ? { ...doc } : null;
    const query = {
      session() { return this; },
      then(resolve) { resolve(copy); },
      exec: async () => copy,
    };
    if (copy) Object.assign(query, copy);
    return query;
  };

  Transaction.findOne = function (filter) {
    let match = null;
    for (const tx of store.transactions.values()) {
      if (filter.roundId && (!tx.roundId || tx.roundId.toString() !== filter.roundId.toString())) continue;
      if (filter.type && tx.type !== filter.type) continue;
      if (filter.settlementKey && tx.settlementKey !== filter.settlementKey) continue;
      match = { ...tx };
      break;
    }
    return {
      session() { return this; },
      then(resolve) { resolve(match); },
      exec: async () => match,
    };
  };

  Transaction.exists = function (filter) {
    let exists = false;
    for (const tx of store.transactions.values()) {
      if (filter.roundId && (!tx.roundId || tx.roundId.toString() !== filter.roundId.toString())) continue;
      if (filter.type && tx.type !== filter.type) continue;
      exists = true;
      break;
    }
    return {
      session() { return this; },
      then(resolve) { resolve(exists ? { _id: 'mock' } : null); },
    };
  };

  Transaction.find = function (filter) {
    const results = [];
    for (const tx of store.transactions.values()) {
      if (filter.studentId && tx.studentId.toString() !== filter.studentId.toString()) continue;
      results.push({ ...tx });
    }
    return {
      sort() {
        return {
          skip() {
            return {
              limit() {
                return Promise.resolve(results);
              },
            };
          },
        };
      },
    };
  };

  Transaction.countDocuments = async function (filter) {
    let count = 0;
    for (const tx of store.transactions.values()) {
      if (filter.studentId && tx.studentId.toString() !== filter.studentId.toString()) continue;
      count++;
    }
    return count;
  };

  Transaction.prototype.save = async function () {
    const tx = this.toObject ? this.toObject() : { ...this._doc };
    if (!tx._id) tx._id = new mongoose.Types.ObjectId();
    if (tx.settlementKey) {
      for (const existing of store.transactions.values()) {
        if (existing.settlementKey === tx.settlementKey) {
          const err = new Error('E11000 duplicate key error collection transactions settlementKey');
          err.code = 11000;
          throw err;
        }
      }
    }
    store.transactions.set(tx._id.toString(), tx);
    return tx;
  };

  try {
    await test('1. GET /api/competition/config returns authoritative 6 levels with entryRiskAmount', async () => {
      const req = {};
      const res = mockRes();
      await getCompetitionConfig(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.totalLevels, 6);
      assert.strictEqual(res.body.levels.length, 6);

      const l1 = res.body.levels[0];
      assert.strictEqual(l1.number, 1);
      assert.strictEqual(l1.entryRiskAmount, 0);
      assert.strictEqual(l1.winningPayout, 50);

      const l2 = res.body.levels[1];
      assert.strictEqual(l2.number, 2);
      assert.strictEqual(l2.entryRiskAmount, 50);
      assert.strictEqual(l2.winningPayout, 100);

      const l6 = res.body.levels[5];
      assert.strictEqual(l6.number, 6);
      assert.strictEqual(l6.entryRiskAmount, 100);
      assert.strictEqual(l6.winningPayout, 500);
    });

    await test('2. GET /api/rounds/level-info returns wallet balance and entry fee eligibility', async () => {
      const studentId = new mongoose.Types.ObjectId();
      const studentDoc = {
        _id: studentId,
        name: 'Alice Student',
        email: 'alice@vvce.ac.in',
        usn: '4VV21CS001',
        year: '1st Year',
        currentLevel: 1,
        walletBalance: 0,
        registrationComplete: true,
        competitionStatus: 'registered',
      };
      store.students.set(studentId.toString(), studentDoc);

      const req = { student: studentDoc };
      const res = mockRes();
      await getLevelInfo(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.currentLevel, 1);
      assert.strictEqual(res.body.walletBalance, 0);
      assert.strictEqual(res.body.hasSufficientBalance, true); // Level 1 is free (0 fee)
      assert.strictEqual(res.body.level.entryRiskAmount, 0);
      assert.strictEqual(res.body.level.winningPayout, 50);
    });

    let allocatedL1Round = null;
    await test('3. POST /api/rounds/allocate for Level 1 succeeds with 0 fee (no deduction)', async () => {
      const student = store.students.get(Array.from(store.students.keys())[0]);
      const req = { student, body: {} };
      const res = mockRes();

      await allocateQuestion(req, res);

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.isExisting, false);
      assert.strictEqual(res.body.walletBalance, 0);
      assert.strictEqual(res.body.entryFee, 0);
      assert.strictEqual(res.body.transaction, null); // 0 fee -> no debit transaction needed
      assert.ok(res.body.round);
      assert.strictEqual(res.body.round.levelNumber, 1);
      assert.strictEqual(res.body.round.status, 'ready');

      allocatedL1Round = res.body.round;
      const dbStudent = store.students.get(student._id.toString());
      assert.strictEqual(dbStudent.walletBalance, 0);
    });

    await test('4. Repeated POST /api/rounds/allocate is idempotent (isExisting: true, no deduction)', async () => {
      const student = store.students.get(Array.from(store.students.keys())[0]);
      const req = { student, body: {} };
      const res = mockRes();

      await allocateQuestion(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.isExisting, true);
      assert.strictEqual(res.body.walletBalance, 0);
      assert.strictEqual(res.body.entryFee, 0);
      assert.strictEqual(res.body.round.id, allocatedL1Round.id);
    });

    await test('5. POST /api/rounds/allocate rejects when wallet balance is insufficient (HTTP 400)', async () => {
      const studentId = new mongoose.Types.ObjectId();
      const brokeStudent = {
        _id: studentId,
        name: 'Bob Broke',
        email: 'bob@vvce.ac.in',
        usn: '4VV21CS002',
        year: '2nd Year',
        currentLevel: 2, // Level 2 entry fee = 50
        walletBalance: 0, // Has 0
        registrationComplete: true,
        competitionStatus: 'inProgress',
      };
      store.students.set(studentId.toString(), brokeStudent);

      const req = { student: brokeStudent, body: {} };
      const res = mockRes();

      await allocateQuestion(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'INSUFFICIENT_BALANCE');
      assert.strictEqual(res.body.walletBalance, 0);
      assert.strictEqual(res.body.requiredAmount, 50);

      let roundFound = false;
      for (const r of store.rounds.values()) {
        if (r.studentId.toString() === studentId.toString() && r.levelNumber === 2) {
          roundFound = true;
        }
      }
      assert.strictEqual(roundFound, false, 'No round should be created on insufficient balance');

      let txFound = false;
      for (const tx of store.transactions.values()) {
        if (tx.studentId.toString() === studentId.toString()) txFound = true;
      }
      assert.strictEqual(txFound, false, 'No transaction should be created on insufficient balance');
    });

    let l2Round = null;
    let l2DebitTx = null;
    await test('6. POST /api/rounds/allocate succeeds when student has 50, deducts 50, records STAKE_DEBIT', async () => {
      const studentId = new mongoose.Types.ObjectId();
      const fundedStudent = {
        _id: studentId,
        name: 'Charlie Funded',
        email: 'charlie@vvce.ac.in',
        usn: '4VV21CS003',
        year: '2nd Year',
        currentLevel: 2,
        walletBalance: 50, // Has 50
        totalRisked: 0,
        registrationComplete: true,
        competitionStatus: 'inProgress',
      };
      store.students.set(studentId.toString(), fundedStudent);

      const req = { student: fundedStudent, body: {} };
      const res = mockRes();

      await allocateQuestion(req, res);

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.isExisting, false);
      assert.strictEqual(res.body.walletBalance, 0); // 50 - 50 = 0
      assert.strictEqual(res.body.entryFee, 50);
      assert.ok(res.body.transaction);
      assert.strictEqual(res.body.transaction.type, 'STAKE_DEBIT');
      assert.strictEqual(res.body.transaction.amount, 50);
      assert.strictEqual(res.body.transaction.balanceAfter, 0);
      assert.strictEqual(res.body.transaction.levelNumber, 2);
      assert.strictEqual(res.body.transaction.status, 'SUCCESS');
      assert.ok(res.body.round);
      assert.strictEqual(res.body.round.levelNumber, 2);

      l2Round = res.body.round;
      l2DebitTx = res.body.transaction;

      const dbStudent = store.students.get(studentId.toString());
      assert.strictEqual(dbStudent.walletBalance, 0);
      assert.strictEqual(dbStudent.totalRisked, 50);

      const dbTx = store.transactions.get(res.body.transaction.id);
      assert.ok(dbTx);
      assert.strictEqual(dbTx.type, 'STAKE_DEBIT');
      assert.strictEqual(dbTx.amount, 50);
      assert.strictEqual(dbTx.balanceAfter, 0);
      assert.strictEqual(dbTx.settlementKey, `round_entry:${l2Round.id}`);
    });

    await test('7. Repeated Level 2 allocate returns existing round and previous debit transaction without double charge', async () => {
      const student = store.students.get(l2Round.studentId);
      const req = { student, body: {} };
      const res = mockRes();

      await allocateQuestion(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.isExisting, true);
      assert.strictEqual(res.body.walletBalance, 0); // Still 0, not -50!
      assert.strictEqual(res.body.entryFee, 0);
      assert.strictEqual(res.body.round.id, l2Round.id);
      assert.ok(res.body.transaction);
      assert.strictEqual(res.body.transaction.id, l2DebitTx.id);

      let txCount = 0;
      for (const tx of store.transactions.values()) {
        if (tx.studentId.toString() === student._id.toString()) txCount++;
      }
      assert.strictEqual(txCount, 1, 'Only 1 transaction should exist (no duplicate debit)');
    });

    await test('8. Failed round allocation cleanly refunds student wallet and does not record charge', async () => {
      const studentId = new mongoose.Types.ObjectId();
      const testStudent = {
        _id: studentId,
        name: 'David Test',
        email: 'david@vvce.ac.in',
        usn: '4VV21CS004',
        year: '2nd Year',
        currentLevel: 2,
        walletBalance: 100,
        totalRisked: 0,
        registrationComplete: true,
        competitionStatus: 'inProgress',
      };
      store.students.set(studentId.toString(), testStudent);

      const failingSave = Round.prototype.save;
      Round.prototype.save = async function () {
        throw new Error('Database disk write failure during round save simulation');
      };

      try {
        const req = { student: testStudent, body: {} };
        const res = mockRes();
        await allocateQuestion(req, res);

        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(res.body.success, false);
      } finally {
        Round.prototype.save = failingSave;
      }

      const dbStudent = store.students.get(studentId.toString());
      assert.strictEqual(dbStudent.walletBalance, 100, 'Student balance must be restored to 100!');
      assert.strictEqual(dbStudent.totalRisked, 0, 'Total risked must be restored to 0!');

      let rCount = 0;
      for (const r of store.rounds.values()) {
        if (r.studentId.toString() === studentId.toString()) rCount++;
      }
      assert.strictEqual(rCount, 0, 'No round should persist after failed allocation');
    });

    await test('9. GET /api/student/transactions returns accurate ledger with STAKE_DEBIT', async () => {
      const student = store.students.get(l2Round.studentId);
      const req = { student, query: {} };
      const res = mockRes();

      await getStudentTransactions(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.walletBalance, 0);
      assert.strictEqual(res.body.totalRisked, 50);
      assert.strictEqual(res.body.count, 1);
      assert.strictEqual(res.body.transactions.length, 1);

      const tx = res.body.transactions[0];
      assert.strictEqual(tx.type, 'STAKE_DEBIT');
      assert.strictEqual(tx.amount, 50);
      assert.strictEqual(tx.balanceAfter, 0);
      assert.strictEqual(tx.levelNumber, 2);
      assert.strictEqual(tx.status, 'SUCCESS');
    });

    await test('10. Level settlement credits winning payout (REWARD_CREDIT) and prevents duplicate credits', async () => {
      const student = store.students.get(l2Round.studentId);
      const volunteerId = new mongoose.Types.ObjectId();
      const evalId = new mongoose.Types.ObjectId();

      const evaluationDoc = {
        _id: evalId,
        roundId: new mongoose.Types.ObjectId(l2Round.id),
        studentId: student._id,
        levelNumber: 2,
        status: 'PASS',
        isSettled: false,
        evaluatedBy: volunteerId,
      };
      store.evaluations.set(evalId.toString(), evaluationDoc);

      Evaluation.findOne = function (filter) {
        let match = null;
        for (const ev of store.evaluations.values()) {
          if (filter.roundId && ev.roundId.toString() === filter.roundId.toString()) {
            match = { ...ev };
            break;
          }
        }
        const query = {
          session() { return this; },
          then(resolve) { resolve(match); },
          exec: async () => match,
        };
        if (match) Object.assign(query, match);
        return query;
      };

      Evaluation.findOneAndUpdate = async function (filter, update) {
        for (const ev of store.evaluations.values()) {
          if (filter.roundId && ev.roundId.toString() === filter.roundId.toString()) {
            if (filter.$or) {
              const matchesOr = filter.$or.some((clause) => {
                if (clause.isSettled === false) return ev.isSettled === false;
                if (clause.isSettled && clause.isSettled.$exists === false) return ev.isSettled === undefined;
                if (clause.isProgressed === false) return ev.isProgressed !== true;
                if (clause.isProgressed && clause.isProgressed.$exists === false) return ev.isProgressed === undefined;
                return false;
              });
              if (!matchesOr) return null;
            }
            if (update.$set) Object.assign(ev, update.$set);
            return { ...ev };
          }
        }
        return null;
      };

      Evaluation.findByIdAndUpdate = async function (id, update) {
        const ev = store.evaluations.get(id?.toString());
        if (ev) Object.assign(ev, update.$set);
        return ev ? { ...ev } : null;
      };

      const volunteer = {
        _id: volunteerId,
        name: 'Volunteer 1',
        username: 'vol1',
        role: 'VOLUNTEER',
      };

      const roundDoc = store.rounds.get(l2Round.id);
      roundDoc.status = 'evaluated';
      store.rounds.set(l2Round.id, roundDoc);

      const settleReq = {
        volunteer,
        params: { usn: student.usn },
        body: {},
      };
      const settleRes = mockRes();

      await settleStudentRoundByUsn(settleReq, settleRes);

      assert.strictEqual(settleRes.statusCode, 200);
      assert.strictEqual(settleRes.body.success, true);
      assert.strictEqual(settleRes.body.evaluation.isSettled, true);
      assert.strictEqual(settleRes.body.transaction.type, 'REWARD_CREDIT');
      assert.strictEqual(settleRes.body.transaction.amount, 100);
      assert.strictEqual(settleRes.body.transaction.balanceAfter, 100);
      assert.strictEqual(settleRes.body.settlement.previousWalletBalance, 0);
      assert.strictEqual(settleRes.body.settlement.targetBalance, 100);
      assert.strictEqual(settleRes.body.settlement.deltaAmount, 100);

      const updatedStudent = store.students.get(student._id.toString());
      assert.strictEqual(updatedStudent.walletBalance, 100);

      const repeatRes = mockRes();
      await settleStudentRoundByUsn(settleReq, repeatRes);

      assert.strictEqual(repeatRes.statusCode, 409);
      assert.strictEqual(repeatRes.body.success, false);
      assert.strictEqual(repeatRes.body.code, 'ROUND_ALREADY_SETTLED');

      assert.strictEqual(updatedStudent.walletBalance, 100);
    });

    await test('11. Level 5 free entry (entryRiskAmount = 0) allocates without deducting balance', async () => {
      const studentId = new mongoose.Types.ObjectId();
      const l5Student = {
        _id: studentId,
        name: 'Eva Level5',
        email: 'eva@vvce.ac.in',
        usn: '4VV21CS005',
        year: '3rd Year',
        currentLevel: 5,
        walletBalance: 250,
        totalRisked: 300,
        registrationComplete: true,
        competitionStatus: 'inProgress',
      };
      store.students.set(studentId.toString(), l5Student);

      const req = { student: l5Student, body: {} };
      const res = mockRes();

      await allocateQuestion(req, res);

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.isExisting, false);
      assert.strictEqual(res.body.walletBalance, 250); // Unchanged!
      assert.strictEqual(res.body.entryFee, 0);
      assert.strictEqual(res.body.transaction, null);
      assert.strictEqual(res.body.round.levelNumber, 5);
      assert.strictEqual(res.body.round.status, 'ready');

      const dbStudent = store.students.get(studentId.toString());
      assert.strictEqual(dbStudent.walletBalance, 250);
      assert.strictEqual(dbStudent.totalRisked, 300); // Not changed!
    });

    await test('12. Unregistered student allocation is rejected with 403 REGISTRATION_INCOMPLETE', async () => {
      const studentId = new mongoose.Types.ObjectId();
      const unregStudent = {
        _id: studentId,
        name: 'Frank Unreg',
        email: 'frank@vvce.ac.in',
        usn: null,
        year: null,
        currentLevel: 1,
        walletBalance: 0,
        registrationComplete: false,
        competitionStatus: 'registered',
      };

      const req = { student: unregStudent, body: {} };
      const res = mockRes();

      await allocateQuestion(req, res);

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'REGISTRATION_INCOMPLETE');
    });

    await test('13. Eliminated student allocation is rejected with 409 STUDENT_ELIMINATED', async () => {
      const studentId = new mongoose.Types.ObjectId();
      const elimStudent = {
        _id: studentId,
        name: 'Grace Elim',
        email: 'grace@vvce.ac.in',
        usn: '4VV21CS006',
        year: '2nd Year',
        currentLevel: 3,
        walletBalance: 50,
        registrationComplete: true,
        competitionStatus: 'eliminated',
      };

      const req = { student: elimStudent, body: {} };
      const res = mockRes();

      await allocateQuestion(req, res);

      assert.strictEqual(res.statusCode, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'STUDENT_ELIMINATED');
    });

    await test('14. Completed competition student allocation is rejected with 409 COMPETITION_COMPLETED', async () => {
      const studentId = new mongoose.Types.ObjectId();
      const champStudent = {
        _id: studentId,
        name: 'Henry Champ',
        email: 'henry@vvce.ac.in',
        usn: '4VV21CS007',
        year: '4th Year',
        currentLevel: 6,
        walletBalance: 500,
        registrationComplete: true,
        competitionStatus: 'completed',
      };

      const req = { student: champStudent, body: {} };
      const res = mockRes();

      await allocateQuestion(req, res);

      assert.strictEqual(res.statusCode, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'COMPETITION_COMPLETED');
    });

    await test('15. Student progression advances to Level 3 and preserves totalRisked accurately', async () => {
      const student = store.students.get(l2Round.studentId);
      const volunteer = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Volunteer 1',
        username: 'vol1',
        role: 'VOLUNTEER',
      };

      const progReq = {
        volunteer,
        params: { usn: student.usn },
        body: {},
      };
      const progRes = mockRes();

      await progressStudentRoundByUsn(progReq, progRes);

      assert.strictEqual(progRes.statusCode, 200);
      assert.strictEqual(progRes.body.success, true);
      assert.strictEqual(progRes.body.evaluation.isProgressed, true);
      assert.strictEqual(progRes.body.progression.advancedToLevel, 3);
      assert.strictEqual(progRes.body.student.currentLevel, 3);
      assert.strictEqual(progRes.body.student.walletBalance, 100);
      assert.strictEqual(progRes.body.student.totalRisked, 50, 'totalRisked must remain 50 (not 100!)');

      const repeatProgRes = mockRes();
      await progressStudentRoundByUsn(progReq, repeatProgRes);

      assert.strictEqual(repeatProgRes.statusCode, 409);
      assert.strictEqual(repeatProgRes.body.success, false);
      assert.strictEqual(repeatProgRes.body.code, 'ROUND_ALREADY_PROGRESSED');
    });

    await test('16. Concurrent race-allocated round in session.withTransaction returns HTTP 200 with isExisting: true and no double deduction', async () => {
      const studentId = new mongoose.Types.ObjectId();
      const raceStudent = {
        _id: studentId,
        name: 'Ian Race',
        email: 'ian@vvce.ac.in',
        usn: '4VV21CS008',
        year: '2nd Year',
        currentLevel: 2, // fee is 50
        walletBalance: 150,
        totalRisked: 50,
        registrationComplete: true,
        competitionStatus: 'inProgress',
      };
      store.students.set(studentId.toString(), raceStudent);

      const raceRoundId = new mongoose.Types.ObjectId();
      const sampleQId = new mongoose.Types.ObjectId();
      const existingRoundDoc = {
        _id: raceRoundId,
        studentId,
        levelNumber: 2,
        questionId: sampleQId,
        status: 'ready',
        questionSnapshot: { questionId: sampleQId, title: 'Concurrent Race Q', levelNumber: 2 },
        durationSeconds: 180,
      };
      store.rounds.set(raceRoundId.toString(), existingRoundDoc);

      const raceTxId = new mongoose.Types.ObjectId();
      const existingTxDoc = {
        _id: raceTxId,
        studentId,
        roundId: raceRoundId,
        type: 'STAKE_DEBIT',
        status: 'SUCCESS',
        amount: 50,
        balanceAfter: 150,
        levelNumber: 2,
        timestamp: new Date(),
      };
      store.transactions.set(raceTxId.toString(), existingTxDoc);

      let step5Checked = false;
      const baseRoundFindOne = Round.findOne;
      Round.findOne = function (filter) {
        if (filter.studentId && filter.studentId.toString() === studentId.toString() && filter.levelNumber === 2) {
          const query = {
            session(sess) {
              return {
                then(resolve) { resolve({ ...existingRoundDoc }); },
                exec: async () => ({ ...existingRoundDoc }),
              };
            },
            then(resolve) {
              if (!step5Checked) {
                step5Checked = true;
                resolve(null); // Step 5 pre-check returns null
              } else {
                resolve({ ...existingRoundDoc });
              }
            },
            exec: async () => {
              if (!step5Checked) {
                step5Checked = true;
                return null;
              }
              return { ...existingRoundDoc };
            },
          };
          return query;
        }
        return baseRoundFindOne(filter);
      };

      try {
        const req = { student: raceStudent, body: {} };
        const res = mockRes();

        await allocateQuestion(req, res);

        assert.strictEqual(res.statusCode, 200, 'Must return HTTP 200 for existing round');
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.isExisting, true, 'isExisting must be true');
        assert.strictEqual(res.body.entryFee, 0, 'entryFee must be 0 for idempotent existing round');
        assert.strictEqual(res.body.round.id, raceRoundId.toString());
        assert.ok(res.body.transaction, 'Transaction must be returned');
        assert.strictEqual(res.body.transaction.id, raceTxId.toString());
        assert.strictEqual(res.body.transaction.type, 'STAKE_DEBIT');

        const dbStudent = store.students.get(studentId.toString());
        assert.strictEqual(dbStudent.walletBalance, 150, 'Wallet balance must not be deducted again');
        assert.strictEqual(dbStudent.totalRisked, 50, 'Total risked must remain 50');
      } finally {
        Round.findOne = baseRoundFindOne;
      }
    });

  } finally {
    Student.findById = origStudentFindById;
    Student.findOne = origStudentFindOne;
    Student.findOneAndUpdate = origStudentFindOneAndUpdate;
    Student.findByIdAndUpdate = origStudentFindByIdAndUpdate;

    Round.findOne = origRoundFindOne;
    Round.find = origRoundFind;
    Round.prototype.save = origRoundSave;

    Level.findOne = origLevelFindOne;
    Level.find = origLevelFind;

    Question.find = origQuestionFind;

    Transaction.findOne = origTransactionFindOne;
    Transaction.find = origTransactionFind;
    Transaction.countDocuments = origTransactionCountDocuments;
    Transaction.exists = origTransactionExists;
    Transaction.prototype.save = origTransactionSave;

    Evaluation.findOne = origEvaluationFindOne;
    Evaluation.findOneAndUpdate = origEvaluationFindOneAndUpdate;
    Evaluation.findByIdAndUpdate = origEvaluationFindByIdAndUpdate;

    mongoose.startSession = origMongooseStartSession;
  }

  console.log('\n---------------------------------------------------------------');
  console.log(`Summary: ${passed} passed, ${failed} failed (total: ${passed + failed})`);
  console.log('---------------------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runWalletWorkflowTests();
}

module.exports = runWalletWorkflowTests;
