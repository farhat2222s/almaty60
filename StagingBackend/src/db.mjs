import {Pool} from 'pg';
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
export function createPool(env=process.env){
  if(!env.DATABASE_URL)throw new Error('DATABASE_URL is required');
  let databaseUrl;try{databaseUrl=new URL(env.DATABASE_URL);}catch{throw new Error('Invalid DATABASE_URL');}
  if(!['postgres:','postgresql:'].includes(databaseUrl.protocol))throw new Error('DATABASE_URL must use postgres or postgresql');
  // pg connection-string SSL options otherwise replace the explicit verified TLS config.
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])databaseUrl.searchParams.delete(key);
  const ssl=env.DATABASE_SSL==='true'?{rejectUnauthorized:true,...(env.DATABASE_CA_FILE?{ca:fs.readFileSync(env.DATABASE_CA_FILE,'utf8')}:{})}:undefined;
  if(env.NODE_ENV==='production'&&env.DATABASE_SSL!=='true'&&env.DATABASE_INTERNAL!=='true')throw new Error('Production database requires verified TLS or explicit private Docker network');
  return new Pool({connectionString:databaseUrl.toString(),ssl,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:10000,application_name:'almaty60-staging'});
}
export async function transaction(pool,fn){
  for(let attempt=0;attempt<3;attempt++){
    const client=await pool.connect();let retry=false;
    try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
    catch(error){try{await client.query('ROLLBACK');}catch{}if(attempt<2&&['40P01','40001'].includes(error.code))retry=true;else throw error;}
    finally{client.release();}
    // Only PostgreSQL errors that guarantee rollback are retried. Ambiguous network
    // failures must use the caller's durable idempotency key on a fresh request.
    if(retry)await delay(20+Math.floor(Math.random()*30));
  }
}
