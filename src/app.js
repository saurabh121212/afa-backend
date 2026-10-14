// Builds the Express app: security, logging, body parsing, routes, errors.
// It does NOT start the server — server.js does that.
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const config = require('./config');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();

// Security headers
app.use(helmet());

// Allow only our website / apps to call the API
app.use(
  cors({
    origin: config.corsOrigins.length ? config.corsOrigins : '*',
    credentials: true,
  })
);

// Log every request in the terminal (e.g. "GET /api/v1/health 200 3ms")
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// Read JSON and form bodies
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Uploaded files are split in two folders:
//   uploads/public/  -> anyone can open (product images, banners...) at /uploads/...
//   uploads/private/ -> NEVER served here (KYC documents). Only through protected
//                       API routes that check who is asking.
app.use('/uploads', express.static(path.resolve(config.upload.dir, 'public')));

// All API routes live under /api/v1
app.use(config.apiPrefix, routes);

// Must come last
app.use(notFound);
app.use(errorHandler);

module.exports = app;
