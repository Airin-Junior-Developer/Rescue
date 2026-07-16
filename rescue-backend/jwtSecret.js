function getJwtSecret(env = process.env) {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return env.JWT_SECRET;
}

module.exports = { getJwtSecret };
