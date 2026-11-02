// Entry point: connect to MySQL first, then start listening for requests.
const app = require('./src/app');
const config = require('./src/config');
const { connectDatabase } = require('./src/database/connection');
const { verifyEmailConnection } = require('./src/services/email.service');
const orderJobs = require('./src/jobs/orderJobs');

async function start() {
  try {
    await connectDatabase();
    await verifyEmailConnection(); // only logs a warning if Gmail login fails
    app.listen(config.port, () => {
      console.log(
        `🚀 AFA API running at http://localhost:${config.port}${config.apiPrefix}`
      );
      // Cancel unpaid orders / complete delivered ones every minute
      if (config.runJobs) orderJobs.start();
    });
  } catch (err) {
    console.error('❌ Could not start server:', err.message);
    process.exit(1);
  }
}

start();
