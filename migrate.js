const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixSchema() {
    console.log("Connecting to Database...");
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    try {
        console.log("Adding assigned_user_id...");
        await pool.query('ALTER TABLE incidents ADD COLUMN assigned_user_id INT DEFAULT NULL');
    } catch (e) { console.log(e.message); }

    try {
        console.log("Adding foundation_id...");
        await pool.query('ALTER TABLE incidents ADD COLUMN foundation_id INT DEFAULT NULL');
    } catch (e) { console.log(e.message); }

    console.log("Adding foreign keys...");
    try {
        await pool.query('ALTER TABLE incidents ADD FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL');
    } catch (e) {}
    try {
        await pool.query('ALTER TABLE incidents ADD FOREIGN KEY (foundation_id) REFERENCES foundations(id) ON DELETE CASCADE');
    } catch (e) {}

    console.log("Schema migration complete!");
    process.exit(0);
}

fixSchema();
