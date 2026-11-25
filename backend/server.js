const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '.env') });

const {
  resolveTrustProxySetting,
  parseJsonBodyLimit,
  validateStartupEnv,
  createHelmetMiddleware,
  createCorsMiddleware,
  getRateLimiters,
} = require('./middleware/securityMiddleware');
const {
  notFoundHandler,
  errorHandler,
} = require('./middleware/errorMiddleware');

const app = express();
const PORT = process.env.PORT || 5000;

const trustProxyConfig = resolveTrustProxySetting(process.env.TRUST_PROXY);
if (!trustProxyConfig.error && trustProxyConfig.value !== undefined) {
  app.set('trust proxy', trustProxyConfig.value);
}

app.disable('x-powered-by');
app.use(createHelmetMiddleware());

app.use(createCorsMiddleware());

const jsonLimitConfig = parseJsonBodyLimit(process.env.JSON_BODY_LIMIT);
app.use(express.json({ limit: jsonLimitConfig.value || '256kb' }));

// 6. General API rate limiting (exempts /api/health; generous default for shared campus NAT IP)
const { generalApiLimiter } = getRateLimiters();
app.use('/api', generalApiLimiter);

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const volunteerRoutes = require('./routes/volunteerRoutes');
const questionRoutes = require('./routes/questionRoutes');
const roundRoutes = require('./routes/roundRoutes');
const studentRoutes = require('./routes/studentRoutes');
const competitionRoutes = require('./routes/competitionRoutes');
const leaderboardRoutes = require('./routes/leaderboardRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/questions', questionRoutes);
app.use('/api/volunteer', volunteerRoutes);
app.use('/api/rounds', roundRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/competition', competitionRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

const getMongoConnectionStatus = () => {
  const connectionStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return connectionStates[mongoose.connection.readyState];
};

// Cached MongoDB connect promise, shared across requests in one serverless
// instance. Vercel reuses warm instances, so the first request connects and
// later requests reuse the same connection instead of opening a new one.
let dbConnectPromise = null;

mongoose.connection.on('connected', () => {
  console.log('MongoDB Atlas connection established successfully.');
});

mongoose.connection.on('error', (err) => {
  console.error(`MongoDB connection error: ${err.message}`);
});

mongoose.connection.on('disconnected', () => {
  // Drop the cached promise so the next request reconnects instead of
  // reusing a dead connection.
  dbConnectPromise = null;
  console.warn('MongoDB Atlas disconnected.');
});

app.get('/', (req, res) => {
  res.json({
    message: 'Code Buddy is running.',
    healthEndpoint: '/api/health',
  });
});

app.get('/api/health', (req, res) => {
  const readyState = mongoose.connection.readyState;
  const isConnected = readyState === 1;

  res.status(isConnected ? 200 : 503).json({
    status: isConnected ? 'ok' : 'degraded',
    server: 'healthy',
    database: {
      status: getMongoConnectionStatus(),
      readyState,
    },
    timestamp: new Date().toISOString(),
  });
});

app.use(notFoundHandler);

// 10. Centralized 4-argument Express error handler (must be registered last)
app.use(errorHandler);

// Connect to MongoDB. Throws on failure and never exits: the local path
// (startServer) converts the throw into process.exit, and the serverless
// entry converts it into a 500 response.
const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI is not defined in the backend environment.');
  }

  // Cap the connection pool: on Vercel each serverless instance holds its
  // own pool, and the driver default (100) lets a few concurrent instances
  // exhaust the Atlas M0 connection limit. Three per instance is plenty for
  // one request at a time (at most two queries run concurrently) and keeps
  // even dozens of instances under the cap. Idle pool connections close
  // after 30s so a warm-but-quiet instance drops back to just its driver
  // heartbeat connections instead of holding its pool open forever.
  // serverSelectionTimeoutMS fails fast if Atlas is slow or unreachable
  // instead of holding an instance for the 30s default while Vercel
  // spawns more instances.
  await mongoose.connect(mongoUri, {
    maxPoolSize: 3,
    minPoolSize: 0,
    maxIdleTimeMS: 30000,
    serverSelectionTimeoutMS: 5000,
  });
};

// Serverless-safe connect: returns immediately when already connected, and
// shares one in-flight connect promise across concurrent requests so a warm
// instance never opens a second connection. A failed connect clears the
// cache so the next request retries instead of reusing the rejection.
const ensureDbConnected = async () => {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (!dbConnectPromise) {
    dbConnectPromise = connectDB().catch((error) => {
      dbConnectPromise = null;
      throw error;
    });
  }
  await dbConnectPromise;
};

const startServer = async () => {
  const envValidation = validateStartupEnv();
  if (!envValidation.valid) {
    console.error('Server startup aborted due to invalid environment configuration:');
    for (const issue of envValidation.errors) {
      console.error(` - ${issue}`);
    }
    process.exit(1);
  }

  try {
    await connectDB();
  } catch (error) {
    console.error(`Database connection error: ${error.message}`);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Code Buddy server running on port ${PORT}`);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.ensureDbConnected = ensureDbConnected;
