const mysql = require('mysql2/promise');

module.exports = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  socketPath: process.env.DB_SOCKET || undefined,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smarthall',
  dateStrings: true, // keep DATETIME as 'YYYY-MM-DD HH:MM:SS' text, no timezone shifts
});
