const { config } = require("../config");
const { AppError } = require("../utils/errors");

let userCache = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60000;

async function loadUserCache(store) {
  const now = Date.now();
  if (userCache && now - cacheLoadedAt < CACHE_TTL_MS) return userCache;

  const users = await store.listUsers();
  const map = new Map();
  for (const user of users) {
    if (user.apiKey) map.set(user.apiKey, user);
  }
  userCache = map;
  cacheLoadedAt = now;
  return map;
}

function invalidateUserCache() {
  userCache = null;
  cacheLoadedAt = 0;
}

function authMiddleware(store) {
  return async (req, _res, next) => {
    const apiKey = req.headers["x-api-key"] || req.query.apiKey;

    if (!config.requireAuth) {
      if (apiKey) {
        try {
          const cache = await loadUserCache(store);
          const user = cache.get(apiKey);
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
      const user = cache.get(apiKey);
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

module.exports = { authMiddleware, requireAdmin, invalidateUserCache };
