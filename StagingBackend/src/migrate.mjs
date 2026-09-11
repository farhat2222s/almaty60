import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createPool,transaction} from './db.mjs';
export async function migrate(pool){
  await transaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(606024)');
    const existing=await db.query("SELECT to_regclass('public.schema_migrations') AS name");
    if(existing.rows[0].name){const version=await db.query('SELECT max(version) AS version FROM schema_migrations');if(version.rows[0].version!==1)throw new Error('Unsupported schema version');}
    else{const schema=await fs.readFile(new URL('../sql/001_staging.sql',import.meta.url),'utf8');await db.query(schema);}
    if(process.env.APP_DB_ROLE){
      if(process.env.APP_DB_ROLE!=='al60_app')throw new Error('APP_DB_ROLE must be al60_app');
      await db.query('GRANT USAGE ON SCHEMA public TO al60_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO al60_app; REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM al60_app');
    }
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const pool=createPool();try{await migrate(pool);console.log('ALMATY 60 staging schema ready (v1).');}finally{await pool.end();}}
