/**
 * Rate limiters have been completely disabled and removed per application configuration.
 * All functions below are unrestricted pass-through middlewares (zero rate-limiting).
 */

const noopLimiter = (_req, _res, next) => next();

module.exports = {
  apiLimiter: noopLimiter,
  adminLoginLimiter: noopLimiter,
  orderCreateLimiter: noopLimiter,
};
