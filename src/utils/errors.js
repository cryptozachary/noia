class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function toAppError(error, fallbackMessage = "Unexpected error") {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(fallbackMessage, 500, {
    originalMessage: error && error.message ? error.message : String(error)
  });
}

module.exports = { AppError, toAppError };
