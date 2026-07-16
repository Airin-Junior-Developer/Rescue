const mysql = require('mysql2/promise');
require('dotenv').config();

const DEMO_USERNAMES = ['adminA', 'rescueA1', 'adminB', 'rescueB1'];

async function removeDemoAccounts() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [result] = await pool.query('DELETE FROM users WHERE username IN (?)', [DEMO_USERNAMES]);
  console.log(`Deleted ${result.affectedRows} demo account(s): ${DEMO_USERNAMES.join(', ')}`);
  await pool.end();
}

removeDemoAccounts().catch((e) => {
  console.error('Failed to remove demo accounts:', e);
  process.exit(1);
});
