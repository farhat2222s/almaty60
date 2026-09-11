import {randomUUID} from 'node:crypto';
import {createPool,transaction} from './db.mjs';
import {email,password,text,hashPassword} from './security.mjs';
// Operator-only offline provisioning. There is deliberately no public admin route.
const role=process.env.BOOTSTRAP_ROLE||'admin';
if(!['admin','staff','brand'].includes(role))throw new Error('BOOTSTRAP_ROLE: admin, staff or brand');
const address=email(process.env.BOOTSTRAP_EMAIL),pass=password(process.env.BOOTSTRAP_PASSWORD),name=text(process.env.BOOTSTRAP_NAME||'Staging operator','name',30);
const brandId=role==='admin'?null:text(process.env.BOOTSTRAP_BRAND_ID,'brandId',40),hash=await hashPassword(pass),pool=createPool();
try{await transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(606025)');
  if(role==='admin'&&(await db.query("SELECT id FROM users WHERE role='admin' LIMIT 1")).rows.length)throw new Error('An admin exists. Use the existing account; bootstrap cannot replace it.');
  if(brandId&&!(await db.query('SELECT id FROM brands WHERE id=$1',[brandId])).rows.length)throw new Error('Unknown brand');
  const id=randomUUID();await db.query('INSERT INTO users(id,email,password_hash,name,role,brand_id) VALUES($1,$2,$3,$4,$5,$6)',[id,address,hash,name,role,brandId]);
  await db.query('INSERT INTO audit_events(id,actor_id,type) VALUES($1,$2,$3)',[randomUUID(),id,'operator_provisioned']);
});console.log(`Operator account provisioned with role ${role}; credentials were not printed.`);}finally{await pool.end();}
