const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

const { databaseConfig } = require('../databaseConfig');

function validateAdminInput({ username, password, foundationId }) {
  if (typeof username !== 'string' || username.length < 3 || username.length > 100 || /\s/.test(username)) {
    throw new Error('Username must be 3-100 characters with no whitespace');
  }
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password must be at least 12 characters');
  }
  if (!Number.isSafeInteger(foundationId) || foundationId < 1) {
    throw new Error('Foundation ID must be a positive integer');
  }
}

async function createAdmin({ pool, username, password, foundationId }) {
  validateAdminInput({ username, password, foundationId });

  const [foundations] = await pool.query('SELECT id FROM foundations WHERE id = ?', [foundationId]);
  if (foundations.length === 0) throw new Error(`Foundation ${foundationId} does not exist`);

  const [existingUsers] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (existingUsers.length !== 0) throw new Error(`Username ${username} already exists; no changes made`);

  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    'INSERT INTO users (username, password, role, foundation_id, phone, is_approved) VALUES (?, ?, ?, ?, ?, ?)',
    [username, passwordHash, 'Admin', foundationId, null, 1],
  );
  return { id: result.insertId, username, foundationId };
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--password-stdin') {
      values.passwordStdin = true;
    } else if (argument === '--username' || argument === '--foundation-id') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
      values[argument === '--username' ? 'username' : 'foundationId'] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!values.passwordStdin) throw new Error('Use --password-stdin so the password is not stored in shell history');
  return values;
}

async function readPasswordFromStdin(input) {
  if (input.isTTY) {
    throw new Error('Pipe the password to stdin; do not put it in a command argument');
  }
  let password = '';
  for await (const chunk of input) password += chunk.toString('utf8');
  return password.replace(/\r?\n$/, '');
}

async function main(args = process.argv.slice(2), input = process.stdin) {
  const parsed = parseArguments(args);
  const password = await readPasswordFromStdin(input);
  const foundationId = Number(parsed.foundationId);
  const pool = mysql.createPool(databaseConfig(process.env));
  try {
    const admin = await createAdmin({
      pool,
      username: parsed.username,
      password,
      foundationId,
    });
    console.log(`Created Admin ${admin.username} with ID ${admin.id} in foundation ${admin.foundationId}.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Admin creation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createAdmin,
  main,
  parseArguments,
  readPasswordFromStdin,
  validateAdminInput,
};
