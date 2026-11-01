// Creates (or recreates) the database from schema.sql, using the login in .env. Run: npm run setup
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function setup() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    socketPath: process.env.DB_SOCKET || undefined,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true, // schema.sql is many statements in one file
  });
  await conn.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await conn.end();
  console.log('Database created.');
}

setup().catch((err) => { console.error('Setup failed:', err.message); process.exit(1); });
