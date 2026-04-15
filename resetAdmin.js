const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

(async () => {
   try {
       const pool = mysql.createPool({
           host: process.env.DB_HOST, 
           user: process.env.DB_USER, 
           password: process.env.DB_PASSWORD, 
           database: process.env.DB_NAME
       });
       
       const hash = await bcrypt.hash('password', 10);
       await pool.query('UPDATE users SET password = ?, role = "admin" WHERE username = "AdminA"', [hash]);
       console.log("AdminA password has been forcefully reset to 'password'");
       
       const [rows] = await pool.query('SELECT * FROM users WHERE username = "AdminA"');
       console.log("Verified Record:", rows[0]);
       
       process.exit(0);
   } catch (e) {
       console.error("Error resetting password:", e);
       process.exit(1);
   }
})();
