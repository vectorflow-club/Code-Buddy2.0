// CodeBuddy 2.0 load test (k6) - 1000 concurrent students + 20 organizers.
//
// This models REALISTIC event-day behaviour, not hammering: a student loads
// the dashboard, allocates a question, then polls the active round every
// 10 seconds exactly like the real Round page does, and checks the wallet.
// Organizers sign in and read. Nothing here clicks faster than a human.
//
// Setup (do this first):
//   1. Seed the test database:  node backend/scripts/seedLevels.js
//                               node backend/scripts/seedQuestions.js
//                               node backend/scripts/seedLoadTest.js
//      (all three with LOAD_TEST_MONGO_URI set to the test database)
//   2. Copy backend/loadtest-tokens.json next to THIS script file.
//   3. Deploy the backend to a Vercel Preview with LOAD_TEST_MODE=true
//      and MONGO_URI pointing at the test database.
//
// Run (from this folder):
//   k6 run --env BASE_URL=https://<preview-backend-url> codebuddy-load-test.js
//
// What this test does NOT cover (v1 limits):
//   - Google sign-in: k6 cannot click through Google. Student tokens are
//     minted directly by seedLoadTest.js using the backend's own signing
//     path, so everything AFTER sign-in is tested. Sign-in itself is one
//     request per student and is not the load bottleneck.
//   - Organizer WRITES (start round, evaluate, settle, progress) are out
//     of scope for v1; the organizer scenario only signs in and reads.
//   - The student flow stops after allocating Level 1 and polling it; it
//     does not play through all 6 levels.
//
// Reading the result: the run FAILS (non-zero exit) if the failed-request
// rate is 5% or more, if p95 latency is 2 seconds or more, or if ANY
// response is a 429. A 429 means the run measured the rate limiter, not
// the app - check that LOAD_TEST_MODE=true is set on the Preview.

import http from 'k6/http';
import { check, sleep, fail, group } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) {
  fail('BASE_URL is required: k6 run --env BASE_URL=https://<preview-backend-url> codebuddy-load-test.js');
}

// Any 429 invalidates the run: it means the limiter, not the app, answered.
const rateLimited = new Counter('rate_limited_requests');

const tokens = new SharedArray('loadtest-tokens', () => {
  return JSON.parse(open('./loadtest-tokens.json'));
});

const students = tokens.students || [];
const organizers = tokens.organizers || [];

if (students.length < 1000) {
  fail(
    `loadtest-tokens.json has ${students.length} student tokens but the stages ramp to 1000 student VUs. ` +
      'Seed 1000 students first: node backend/scripts/seedLoadTest.js (with LOAD_TEST_MONGO_URI set).'
  );
}
if (organizers.length < 1) {
  fail('loadtest-tokens.json has no organizer tokens. Seed organizers first: node backend/scripts/seedLoadTest.js');
}

console.log(
  `CodeBuddy load test: BASE_URL=${BASE_URL} students=${students.length} organizers=${organizers.length}`
);

export const options = {
  scenarios: {
    students: {
      executor: 'ramping-vus',
      exec: 'studentFlow',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 100 },
        { duration: '1m', target: 250 },
        { duration: '1m', target: 500 },
        { duration: '2m', target: 1000 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    organizers: {
      executor: 'constant-vus',
      exec: 'organizerFlow',
      vus: 20,
      duration: '6m30s',
      startTime: '0s',
    },
  },
  thresholds: {
    // Same pass bars as the Kalaa Bhadra load test (Oct 2026).
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    rate_limited_requests: ['count==0'],
  },
};

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

// Every response passes through here so a 429 is counted even when a
// check would otherwise swallow it.
function track(res) {
  if (res.status === 429) {
    rateLimited.add(1);
  }
  return res;
}

export function studentFlow() {
  // __VU is global across ALL scenarios, so the 20 organizer VUs shift
  // student VU ids; modulo keeps every student VU on a valid token. With
  // 1000 tokens and 1000 student VUs, at most 20 students are shared by
  // two VUs, which allocate handles idempotently (200, existing round).
  const student = students[(__VU - 1) % students.length];
  const headers = authHeaders(student.token);

  group('student dashboard', () => {
    const me = track(http.get(`${BASE_URL}/api/auth/me`, headers));
    check(me, { 'dashboard profile loads (200)': (r) => r.status === 200 });

    const config = track(http.get(`${BASE_URL}/api/competition/config`, headers));
    check(config, { 'competition config loads (200)': (r) => r.status === 200 });
  });

  sleep(1);

  group('allocate', () => {
    // Allocate takes NO body fields (the API rejects any with 400), so the
    // body is null. 201 = newly allocated, 200 = round already existed
    // (idempotent: re-running the test reuses the same round).
    const res = track(http.post(`${BASE_URL}/api/rounds/allocate`, null, headers));
    check(res, {
      'allocate succeeds (200 existing or 201 new)': (r) => r.status === 200 || r.status === 201,
    });
  });

  group('poll active round', () => {
    // The real Round page polls every 10 seconds; six polls is ~60 seconds
    // of a student sitting on the round page.
    for (let i = 0; i < 6; i += 1) {
      const res = track(http.get(`${BASE_URL}/api/rounds/active`, headers));
      check(res, { 'active round poll (200)': (r) => r.status === 200 });
      sleep(10);
    }
  });

  group('wallet', () => {
    const res = track(http.get(`${BASE_URL}/api/student/transactions?page=1&limit=10`, headers));
    check(res, { 'wallet transactions load (200)': (r) => r.status === 200 });
  });
}

export function organizerFlow() {
  const organizer = organizers[(__VU - 1) % organizers.length];

  group('organizer login', () => {
    const res = track(
      http.post(
        `${BASE_URL}/api/volunteer/login`,
        JSON.stringify({ username: organizer.username, password: organizer.password }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );
    const ok = check(res, { 'organizer login (200)': (r) => r.status === 200 });
    if (!ok) {
      return;
    }
    const token = res.json('token');
    if (!token) {
      check(res, { 'login returned a token': () => false });
      return;
    }
    const headers = authHeaders(token);

    const me = track(http.get(`${BASE_URL}/api/volunteer/me`, headers));
    check(me, { 'organizer profile loads (200)': (r) => r.status === 200 });

    // A read every organizer side can make; the USN round lookup is left
    // out because it legitimately 404s before a student allocates, and a
    // legitimate 404 would pollute the failed-request rate.
    const records = track(http.get(`${BASE_URL}/api/competition/records`, headers));
    check(records, { 'competition records load (200)': (r) => r.status === 200 });
  });

  sleep(5);
}
