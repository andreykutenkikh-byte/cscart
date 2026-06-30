import dotenv from 'dotenv';
import { importDvKeramikFeed } from './importer.js';
import { pool } from './db.js';

dotenv.config();

importDvKeramikFeed()
  .then(async (result) => {
    console.log(JSON.stringify(result, null, 2));
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
