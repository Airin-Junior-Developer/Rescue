const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrateGrab() {
    console.log("Upgrading architecture for Auto-Dispatch...");
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    try {
        await pool.query('ALTER TABLE users ADD COLUMN phone VARCHAR(20) DEFAULT "0800000000"');
        console.log("✅ Added phone to users table.");
    } catch(e) { console.log("Info: phone column may already exist.", e.message); }

    try {
        await pool.query('ALTER TABLE incidents ADD COLUMN citizen_phone VARCHAR(20)');
        console.log("✅ Added citizen_phone to incidents table.");
    } catch(e) { console.log("Info: citizen_phone column may already exist.", e.message); }

    console.log("Migration Complete!");
    process.exit(0);
}

migrateGrab();
