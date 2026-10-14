// Two "catch-all" middlewares used at the end of app.js.
// Every error response has the same shape:
//   { success: false, message, code?, errors?: [{ field, message }] }
const ApiError = require('../utils/ApiError');

// 1. Any URL that no route matched -> 404
function notFound(req, res) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND',
  });
}

// MySQL reports a clash on a multi-column unique index (e.g. "users_type_email_unique")
// by the index name, so map it back to the field the client sent.
function uniqueField(path = '') {
  if (/email/i.test(path)) return 'email';
  if (/mobile/i.test(path)) return 'mobile';
  if (/farmer_id_tin|farmerIdTin/i.test(path)) return 'farmerIdTin';
  if (/id_number_tin|idNumberTin/i.test(path)) return 'idNumberTin';
  if (/registration_number_tin|registrationNumberTin/i.test(path)) return 'registrationNumberTin';
  return path;
}
const FIELD_LABELS = {
  email: 'email address',
  mobile: 'mobile number',
  farmerIdTin: 'Farmer ID / TIN',
  idNumberTin: 'ID Number / Business TIN',
  registrationNumberTin: 'Business Registration Number / TIN',
};

// Turn any error into { status, body }.
function toResponse(err) {
  // Errors we threw on purpose
  if (err instanceof ApiError) {
    return {
      status: err.statusCode,
      body: { message: err.message, code: err.code, errors: err.errors },
    };
  }

  // Sequelize: unique column clash (e.g. email already used for this user type)
  if (err.name === 'SequelizeUniqueConstraintError') {
    return {
      status: 409,
      body: {
        message: 'Some details are already registered',
        code: 'DUPLICATE_VALUE',
        errors: (err.errors || []).map((e) => {
          const field = uniqueField(e.path);
          return { field, message: `This ${FIELD_LABELS[field] || field} is already registered` };
        }),
      },
    };
  }

  // Sequelize: model validation failed
  if (err.name === 'SequelizeValidationError') {
    return {
      status: 422,
      body: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors: (err.errors || []).map((e) => ({ field: e.path, message: e.message })),
      },
    };
  }

  // Sequelize: a linked record (e.g. location id) doesn't exist
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return {
      status: 422,
      body: { message: 'A selected value does not exist', code: 'INVALID_REFERENCE' },
    };
  }

  // Sequelize: database down / wrong credentials
  if (err.name === 'SequelizeConnectionError' || err.name === 'SequelizeConnectionRefusedError') {
    return {
      status: 503,
      body: { message: 'Database is unavailable, please try again later', code: 'DB_UNAVAILABLE' },
    };
  }

  // express.json(): body is not valid JSON
  if (err.type === 'entity.parse.failed') {
    return {
      status: 400,
      body: { message: 'Request body is not valid JSON', code: 'INVALID_JSON' },
    };
  }

  // express.json(): body too big
  if (err.type === 'entity.too.large') {
    return {
      status: 413,
      body: { message: 'Request body is too large', code: 'PAYLOAD_TOO_LARGE' },
    };
  }

  // Anything else is a bug: hide the details from the client
  return {
    status: 500,
    body: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
  };
}

// 2. Any error thrown anywhere in the app -> one consistent JSON response
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const { status, body } = toResponse(err);
  if (status >= 500) console.error(err);

  res.status(status).json({
    success: false,
    ...body,
    // show the stack trace only while developing
    ...(process.env.NODE_ENV === 'development' && status >= 500 && { stack: err.stack }),
  });
}

module.exports = { notFound, errorHandler };
