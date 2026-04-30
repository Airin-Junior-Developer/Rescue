const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function hashPlainPasswords() {
    console.log("Connecting bounds...");
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    try {
        const [users] = await pool.query('SELECT id, password FROM users');
        for (let u of users) {
            if (!u.password.startsWith('$2b$')) { // Not yet hashed
                const hashed = await bcrypt.hash(u.password, 10);
                await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashed, u.id]);
                console.log(`Hashed password for User ${u.id}`);
            }
        }
        console.log("Migration finished.");
    } catch (e) { console.error(e); }
    process.exit(0);
}

hashPlainPasswords();
