const { createHash } = require("crypto");
const { config } = require("../config");
const { AppError } = require("../utils/errors");

function hashApiKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

let userCache = null;

async function loadUserCache(store) {
  if (userCache) return userCache;

  const users = await store.listUsers();
  const map = new Map();
  for (const user of users) {
    if (user.apiKeyHash) {
      map.set(user.apiKeyHash, user);
    } else if (user.apiKey) {
      // Legacy: plaintext key — match by hashing the stored key
      map.set(hashApiKey(user.apiKey), user);
    }
  }
  userCache = map;
  return map;
}

function invalidateUserCache() {
  userCache = null;
}

function authMiddleware(store) {
  return async (req, _res, next) => {
    const apiKey = req.headers["x-api-key"];

    if (!config.requireAuth) {
      if (apiKey) {
        try {
          const cache = await loadUserCache(store);
          const user = cache.get(hashApiKey(apiKey));
          req.user = user || null;
        } catch {
          req.user = null;
        }
      } else {
        req.user = null;
      }
      return next();
    }

    // Admin key bypass
    if (config.adminApiKey && apiKey === config.adminApiKey) {
      req.user = { id: "admin", name: "Admin", isAdmin: true };
      return next();
    }

    if (!apiKey) {
      return next(new AppError("Authentication required. Provide X-API-Key header.", 401));
    }

    try {
      const cache = await loadUserCache(store);
      const user = cache.get(hashApiKey(apiKey));
      if (!user) {
        return next(new AppError("Invalid API key.", 403));
      }
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireAdmin(req, _res, next) {
  if (!req.user || !req.user.isAdmin) {
    return next(new AppError("Admin access required.", 403));
  }
  next();
}

module.exports = { authMiddleware, requireAdmin, invalidateUserCache, hashApiKey };
