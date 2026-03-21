const { randomUUID } = require("crypto");

function requestIdMiddleware() {
  return (req, res, next) => {
    const id = req.headers["x-request-id"] || randomUUID().slice(0, 12);
    req.id = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
}

module.exports = { requestIdMiddleware };
