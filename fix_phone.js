require('dotenv').config();
const mysql = require('mysql2/promise');

async function fix() {
    try {
        const pool = mysql.createPool({
            host: process.env.DB_HOST || '127.0.0.1',
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
        });

        await pool.query('ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL').catch(()=>{});
        await pool.query('UPDATE users SET phone = "081-111-2222" WHERE username = "rescueA1"');
        await pool.query('UPDATE users SET phone = "089-999-4444" WHERE username = "rescueB1"');
        console.log("Database updated successfully with rescue phone numbers!");
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
fix();
