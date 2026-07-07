import { pool } from './db.js';
import { SCHEMA_SQL } from './schema.js';

if (process.env.RESET_DB === '1') {
  await pool.query('drop table if exists achievements cascade; drop table if exists busts cascade; drop table if exists users cascade;');
  console.log('Existing BUST tables dropped.');
}

await pool.query(SCHEMA_SQL);
console.log('Database schema ready.');
await pool.end();
