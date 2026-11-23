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

mongoose.connection.on('connected', () => {
  console.log('MongoDB Atlas connection established successfully.');
});

mongoose.connection.on('error', (err) => {
  console.error(`MongoDB connection error: ${err.message}`);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB Atlas disconnected.');
});

app.get('/', (req, res) => {
  res.json({
    message: 'Code Buddy Backend API is running.',
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

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error('Database connection error: MONGO_URI is not defined in the backend environment.');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
  } catch (error) {
    console.error(`Database connection error: ${error.message}`);
    process.exit(1);
  }
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

  await connectDB();

  app.listen(PORT, () => {
    console.log(`Code Buddy server running on port ${PORT}`);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = app;
