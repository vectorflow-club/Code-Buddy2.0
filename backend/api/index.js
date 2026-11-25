const { validateStartupEnv } = require('../middleware/securityMiddleware');
const app = require('../server');

// Vercel serverless entry point for the CodeBuddy backend. Vercel reuses
// warm function instances, so the Express app and the MongoDB connection
// are created once per instance and shared across invocations.
//
// Local development is unchanged: `npm start` / `npm run dev` still run
// backend/server.js directly, which listens on PORT.

// Validate the environment once per cold start and cache the result. A bad
// config is a deployment problem, not a per-request problem, so every
// request fails fast with a 500 until the config is fixed and redeployed.
let startupError = null;
try {
  const envValidation = validateStartupEnv();
  if (!envValidation.valid) {
    startupError = new Error(
      `Invalid environment configuration: ${envValidation.errors.join('; ')}`
    );
  }
} catch (error) {
  startupError = error;
}

if (startupError) {
  // Server-side logs only: the response below never carries these details.
  console.error(`Serverless startup aborted: ${startupError.message}`);
}

module.exports = async (req, res) => {
  if (startupError) {
    return res.status(500).json({
      success: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is not configured correctly.',
    });
  }

  // The root and health endpoints need no database: the health handler
  // reads mongoose.connection.readyState directly. Skip the connect here
  // so a health ping or uptime check never opens a connection pool on a
  // cold instance. Every other path connects first, as before.
  try {
    const pathname = (req.url || '').split('?')[0];
    const isNoDbPath = pathname === '/' || pathname === '/api/health';
    if (!isNoDbPath) {
      await app.ensureDbConnected();
    }
    return app(req, res);
  } catch (error) {
    // Never leak the raw error: it can contain connection details.
    console.error(`Serverless request failed: ${error.message}`);
    if (res.headersSent) {
      return;
    }
    return res.status(500).json({
      success: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable.',
    });
  }
};
