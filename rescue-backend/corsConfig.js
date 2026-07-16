const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3002',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3002',
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // mobile apps, curl, server-to-server calls send no Origin header
  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true;
  if (origin.endsWith('.railway.app')) return true;
  return false;
}

module.exports = { allowedOrigins, isAllowedOrigin };
