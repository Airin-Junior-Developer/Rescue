const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

const { databaseConfig } = require('../databaseConfig');

const DEMO_DATABASE_NAME = 'rescue_demo';
const DEMO_PASSWORD = 'RescueDemo!2026';
const DEMO_ACCOUNTS = Object.freeze([
  { username: 'demo.admin', role: 'Admin', phone: null },
  { username: 'demo.rescue1', role: 'Rescue', phone: '0000000001' },
  { username: 'demo.rescue2', role: 'Rescue', phone: '0000000002' },
  { username: 'demo.rescue3', role: 'Rescue', phone: '0000000003' },
]);
const APP_TABLES = Object.freeze([
  'foundations',
  'users',
  'incidents',
  'vehicles',
  'citizens',
  'chat_messages',
]);

function validateSeedTarget(databaseName, confirmation) {
  if (databaseName !== DEMO_DATABASE_NAME) {
    throw new Error(`Demo seed is restricted to DB_NAME=${DEMO_DATABASE_NAME}`);
  }
  if (confirmation !== DEMO_DATABASE_NAME) {
    throw new Error(`Set DEMO_SEED_CONFIRM=${DEMO_DATABASE_NAME} to confirm the disposable demo database`);
  }
}

async function seedDemoAccounts({ pool, databaseName, confirmation }) {
  validateSeedTarget(databaseName, confirmation);

  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;

    for (const table of APP_TABLES) {
      const [[row]] = await connection.query(`SELECT COUNT(*) AS count FROM ${table}`);
      if (Number(row.count) !== 0) {
        throw new Error(`Demo database must be empty; found data in ${table}`);
      }
    }

    const [foundationResult] = await connection.query(
      'INSERT INTO foundations (name, contact_info) VALUES (?, ?)',
      ['มูลนิธิสาธิต Rescue', 'ข้อมูลสาธิตเท่านั้น'],
    );

    const hashes = await Promise.all(
      DEMO_ACCOUNTS.map(() => bcrypt.hash(DEMO_PASSWORD, 10)),
    );
    for (let index = 0; index < DEMO_ACCOUNTS.length; index += 1) {
      const account = DEMO_ACCOUNTS[index];
      await connection.query(
        'INSERT INTO users (username, password, role, foundation_id, phone, is_approved) VALUES (?, ?, ?, ?, ?, ?)',
        [account.username, hashes[index], account.role, foundationResult.insertId, account.phone, 1],
      );
    }

    await connection.commit();
    return {
      foundationId: foundationResult.insertId,
      accounts: DEMO_ACCOUNTS.map(({ username, role }) => ({ username, role })),
    };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function main() {
  const pool = mysql.createPool(databaseConfig(process.env));
  try {
    const result = await seedDemoAccounts({
      pool,
      databaseName: process.env.DB_NAME,
      confirmation: process.env.DEMO_SEED_CONFIRM,
    });
    console.log(`Created ${result.accounts.length} demo accounts in ${DEMO_DATABASE_NAME}.`);
    for (const account of result.accounts) {
      console.log(`${account.username} (${account.role})`);
    }
    console.log(`Demo password: ${DEMO_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Demo seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEMO_ACCOUNTS,
  DEMO_DATABASE_NAME,
  DEMO_PASSWORD,
  seedDemoAccounts,
  validateSeedTarget,
};
