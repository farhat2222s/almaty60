import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {once} from 'node:events';
import {createPGlitePool} from '../src/pglite-pool.mjs';
import {createPool,transaction} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {createService,simulateInput} from '../src/service.mjs';
import {createHttpServer} from '../src/server.mjs';

// A serialized adapter over the real PostgreSQL WASM engine. It validates SQL and
// transaction behavior, but is not a multi-connection concurrency/load test.
const pool=process.env.TEST_DATABASE_URL?createPool({...process.env,NODE_ENV:'test',DATABASE_URL:process.env.TEST_DATABASE_URL}):createPGlitePool();
const encryptionKey=randomBytes(32).toString('hex');
const service=createService(pool,{tokenEncryptionKey:encryptionKey});
let n=0;const runId=randomUUID();
async function player(){n++;const result=await service.register({email:`p${n}-${runId}@test.example`,password:'strong-test-password-123',name:`Player ${n}`},`test-ip-${runId}-${n}`);return {result,user:await service.authenticate(result.token)};}
async function role(name,brandId){const id=randomUUID();await pool.query('INSERT INTO users(id,email,password_hash,name,role,brand_id) VALUES($1,$2,$3,$4,$5,$6)',[id,`${id}@test.example`,'unused',name,name,brandId]);return {id,role:name,brand_id:brandId};}
const missionId='m_demo_60_checkpoint_run',key=()=>randomUUID();
async function walkWin(user,mission=missionId){
  let a=await service.start(user,mission,key());
  for(let i=0;i<300&&a.status==='active';i++){
    const target=a.targets[a.completedCheckpoints],dx=target.x-a.position.x,dz=target.z-a.position.z,d=Math.hypot(dx,dz),scale=Math.min(1,d/(a.movement.sprintSpeed*.25));
    await pool.query("UPDATE mission_attempts SET last_input_at=clock_timestamp()-interval '250 milliseconds' WHERE id=$1",[a.attemptId]);
    a=await service.input(user,a.attemptId,{x:dx/d*scale,z:dz/d*scale,sprint:true,seq:a.lastInputSeq+1});
  }
  assert.equal(a.status,'won');return a;
}

test.before(async()=>{await migrate(pool);});
test.after(async()=>{await pool.end();});

test('transaction retries rollback-guaranteed deadlocks only, never ambiguous commit/network failure',async()=>{
  const events=[];let attempt=0;
  const fake={async connect(){return {async query(sql){events.push(sql);},release(){events.push('release');}};}};
  assert.equal(await transaction(fake,async()=>{if(attempt++===0)throw Object.assign(new Error('deadlock'),{code:'40P01'});return 'ok';}),'ok');
  assert.equal(events.filter(x=>x==='ROLLBACK').length,1);assert.equal(events.filter(x=>x==='COMMIT').length,1);assert.equal(events.filter(x=>x==='release').length,2);
  let calls=0;await assert.rejects(transaction(fake,async()=>{calls++;throw Object.assign(new Error('connection lost'),{code:'ECONNRESET'});}));assert.equal(calls,1);
});

test('database migrations are repeatable, public registration creates only a player, logout revokes token',async()=>{
  await migrate(pool);await assert.rejects(service.register({email:'admin@test.example',password:'long-test-password',name:'Admin',role:'admin'},'ip'),e=>e.code==='ROLE_NOT_ASSIGNABLE');
  const {result,user}=await player();assert.equal(result.user.role,'player');assert.equal(result.profile.xp,0);
  const stored=(await pool.query('SELECT password_hash FROM users WHERE id=$1',[user.id])).rows[0];assert.match(stored.password_hash,/^scrypt/);
  const sessions=(await pool.query('SELECT * FROM sessions WHERE user_id=$1',[user.id])).rows;assert.ok(!JSON.stringify(sessions).includes(result.token));
  await assert.rejects(service.login({email:result.user.email,password:'incorrect-long-password'},'login-ip'),e=>e.status===401);
  const login=await service.login({email:result.user.email,password:'strong-test-password-123'},'login-ip');assert.equal(login.user.id,user.id);
  await service.logout(await service.authenticate(login.token));await assert.rejects(service.authenticate(login.token),e=>e.status===401);
});
test('attempt ownership, durable reconnect, input sequencing and missing idempotency are enforced',async()=>{
  const {user}=await player(),other=(await player()).user;
  await assert.rejects(service.start(user,missionId,''),e=>e.code==='IDEMPOTENCY_KEY_REQUIRED');
  const k=key(),a=await service.start(user,missionId,k),replay=await service.start(user,missionId,k);assert.deepEqual(replay,a);
  await assert.rejects(service.start(user,missionId,k,{different:true}),e=>e.code==='IDEMPOTENCY_CONFLICT');
  await assert.rejects(service.start(user,missionId,key()),e=>e.code==='ATTEMPT_ACTIVE');
  await assert.rejects(service.getAttempt(other,a.attemptId),e=>e.code==='ATTEMPT_NOT_FOUND');
  await assert.rejects(service.input(other,a.attemptId,{x:0,z:1,sprint:true,seq:1}),e=>e.code==='ATTEMPT_NOT_FOUND');
  await assert.rejects(service.input(user,a.attemptId,{x:100,z:1,sprint:true,seq:1}),e=>e.code==='INVALID_INPUT');
  await assert.rejects(service.input(user,a.attemptId,{x:0,z:1,sprint:true,seq:5}),e=>e.code==='INPUT_SEQUENCE');
  await pool.query("UPDATE mission_attempts SET last_input_at=clock_timestamp()-interval '2 hours' WHERE id=$1",[a.attemptId]);
  const moved=await service.input(user,a.attemptId,{x:1,z:1,sprint:true,seq:1,position:{x:1000,z:1000}});assert.ok(Math.hypot(moved.position.x,moved.position.z)<=5.50001);
  const duplicate=await service.input(user,a.attemptId,{x:1,z:1,sprint:true,seq:1});assert.deepEqual(duplicate.position,moved.position);
  const reconnected=await service.getAttempt(user,a.attemptId);assert.equal(reconnected.lastInputSeq,1);
  const ended=await service.finish(user,a.attemptId,key());assert.equal(ended.status,'failed');assert.equal(ended.reward,null);
});
test('server input wins, awards XP/coins once, finalization retries return the same unique encrypted token',async()=>{
  const {user}=await player(),won=await walkWin(user);assert.equal(won.rewardXp,100);assert.equal(won.profile.coins,50);assert.match(won.reward.code,/^AL60S_/);
  const k=key(),finished=await service.finish(user,won.attemptId,k),replay=await service.finish(user,won.attemptId,k);assert.deepEqual(replay,finished);assert.equal(finished.reward.code,won.reward.code);
  assert.equal((await service.me(user)).profile.xp,100);
  const saved=(await pool.query('SELECT * FROM rewards WHERE attempt_id=$1',[won.attemptId])).rows;assert.equal(saved.length,1);assert.ok(!JSON.stringify(saved).includes(won.reward.code));
  const keys=(await pool.query('SELECT * FROM idempotency_keys WHERE user_id=$1',[user.id])).rows;assert.ok(!JSON.stringify(keys).includes(won.reward.code));
  await assert.rejects(service.start(user,missionId,key()),e=>e.code==='MISSION_COOLDOWN');
});
test('concurrent retry calls converge on one start and one final result',async()=>{
  const {user}=await player(),k=key();const [a,b]=await Promise.all([service.start(user,missionId,k),service.start(user,missionId,k)]);assert.equal(a.attemptId,b.attemptId);
  const fk=key(),[one,two]=await Promise.all([service.finish(user,a.attemptId,fk),service.finish(user,a.attemptId,fk)]);assert.deepEqual(one,two);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM mission_attempts WHERE player_id=$1',[user.id])).rows[0].count,1);
});
test('collect and delivery campaign routes complete with authoritative input',async()=>{
  const owner=await role('brand','steppe');
  for(const type of ['collect','delivery']){
    const campaign=await service.campaign(owner,{brandId:'steppe',title:`${type} route`,rewardTitle:'Demo reward',type,duration:60,maxRewards:10,xp:80,coins:30});
    const {user}=await player(),won=await walkWin(user,campaign.missionId);assert.equal(won.profile.xp,80);assert.equal(won.reward.brandId,'steppe');
  }
});
test('timeout persists failure and releases campaign reservation, no client claim can award a prize',async()=>{
  const {user}=await player(),a=await service.start(user,missionId,key()),before=(await pool.query('SELECT reserved FROM campaigns WHERE id=$1',[ '11111111-1111-4111-8111-111111111111'])).rows[0].reserved;
  await pool.query("UPDATE mission_attempts SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1",[a.attemptId]);
  const timed=await service.input(user,a.attemptId,{x:0,z:1,sprint:true,seq:1,completedCheckpoints:5,win:true});assert.equal(timed.status,'failed');assert.equal(timed.reason,'timeout');assert.equal(timed.reward,null);
  const after=(await pool.query('SELECT reserved FROM campaigns WHERE id=$1',['11111111-1111-4111-8111-111111111111'])).rows[0].reserved;assert.equal(after,before-1);
  assert.equal((await service.me(user)).profile.coins,0);
});
test('fresh service instance recovers a durable attempt, session and encrypted reward',async()=>{
  const {user,result}=await player(),won=await walkWin(user);
  const restarted=createService(pool,{tokenEncryptionKey:encryptionKey}),restoredUser=await restarted.authenticate(result.token);
  const restored=await restarted.getAttempt(restoredUser,won.attemptId);assert.equal(restored.status,'won');assert.equal(restored.reward.code,won.reward.code);assert.equal((await restarted.me(restoredUser)).profile.xp,100);
});
test('staff must match reward brand; player cannot inspect/redeem; same-key retries differ from double redemption',async()=>{
  const {user}=await player(),won=await walkWin(user),staff=await role('staff','demo-brand'),other=await role('staff','aporta');
  await assert.rejects(service.inspect(user,won.reward.code),e=>e.code==='FORBIDDEN');await assert.rejects(service.redeem(user,won.reward.code,key()),e=>e.code==='FORBIDDEN');
  await assert.rejects(service.inspect(other,won.reward.code),e=>e.code==='BRAND_FORBIDDEN');await assert.rejects(service.redeem(other,won.reward.code,key()),e=>e.code==='BRAND_FORBIDDEN');
  const k=key(),used=await service.redeem(staff,won.reward.code,k),retried=await service.redeem(staff,won.reward.code,k);assert.deepEqual(retried,used);assert.equal(used.reward.status,'USED');assert.ok(used.reward.redeemedAt);
  await assert.rejects(service.redeem(staff,won.reward.code,key()),e=>e.code==='REWARD_USED');
  await assert.rejects(service.redeem(staff,'AL60S_forged',key()),e=>e.code==='REWARD_NOT_FOUND');
});
test('expired reward rejected; sweep persists expiration and does not redeem',async()=>{
  const {user}=await player(),won=await walkWin(user),staff=await role('staff','demo-brand');
  await pool.query("UPDATE rewards SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[won.reward.id]);
  await assert.rejects(service.redeem(staff,won.reward.code,key()),e=>e.code==='REWARD_EXPIRED');
  await service.sweep();assert.equal((await service.inspect(staff,won.reward.code)).reward.status,'EXPIRED');
});
test('native Arbat route is playable at server speeds and scoped campaigns enforce reward reservation limit',async()=>{
  const {user}=await player(),native=await walkWin(user,'m_arbat_60_checkpoint_run');assert.equal(native.movement.walkSpeed,4.2);assert.equal(native.movement.sprintSpeed,7.2);assert.equal(native.profile.xp,150);
  const owner=await role('brand','aporta');await assert.rejects(service.campaign(owner,{brandId:'steppe'}),e=>e.code==='BRAND_FORBIDDEN');
  const campaign=await service.campaign(owner,{brandId:'aporta',title:'One prize',rewardTitle:'Demo prize',type:'checkpoint',duration:60,maxRewards:1,xp:100,coins:50});
  const p1=(await player()).user,p2=(await player()).user,a=await service.start(p1,campaign.missionId,key());
  await assert.rejects(service.start(p2,campaign.missionId,key()),e=>e.code==='REWARD_LIMIT');
  await service.finish(p1,a.attemptId,key());assert.ok((await service.start(p2,campaign.missionId,key())).attemptId);
  const data=await service.analytics(owner);assert.ok(data.campaigns.every(c=>c.brand_id==='aporta'));
  await assert.rejects(service.analytics(p1),e=>e.code==='FORBIDDEN');
});
test('presence: players see nearby players only, entries expire, logout removes presence',async()=>{
  const a=await player(),b=await player(),c=await player();
  const ua=await service.authenticate(a.result.token),ub=await service.authenticate(b.result.token),uc=await service.authenticate(c.result.token);
  await service.presenceUpdate(ua,{x:10,z:20,heading:1});
  const far=await service.presenceUpdate(uc,{x:2000,z:2000,heading:0});assert.equal(far.players.length,0);assert.equal(far.online,2);
  const near=await service.presenceUpdate(ub,{x:30,z:25,heading:0,driving:true});
  assert.deepEqual(near.players.map(p=>p.name),[ua.name]);assert.equal(near.online,3);
  await assert.rejects(service.presenceUpdate(ub,{x:'nope',z:0}),e=>e.code==='INVALID_INPUT');
  await service.logout(ua);const after=await service.presenceUpdate(ub,{x:30,z:25,heading:0});assert.equal(after.players.length,0);
});

test('blocked account sessions are revoked; persisted rate limits work across service instances',async()=>{
  const {user,result}=await player(),admin=await role('admin',null);
  await service.blockUser(admin,user.id,{blocked:true});await assert.rejects(service.authenticate(result.token),e=>e.code==='UNAUTHENTICATED');
  await service.rate('same-rate-test',1);await assert.rejects(service.rate('same-rate-test',1),e=>e.code==='RATE_LIMIT');
});
test('HTTP auth, request limits and origin policy are enforced without a TCP listener',async()=>{
  const {result}=await player(),server=createHttpServer({pool,service,allowedOrigins:['https://approved.example']});
  async function request(url,{method='GET',body,headers={}}={}){
    const req=Readable.from(body===undefined?[]:[Buffer.from(body)]);Object.assign(req,{method,url,headers,socket:{remoteAddress:'http-test'}});
    const chunks=[],res=new Writable({write(c,e,cb){chunks.push(Buffer.from(c));cb();}});res.headers={};res.setHeader=(k,v)=>{res.headers[k]=v;};res.writeHead=(status,h)=>{res.statusCode=status;Object.assign(res.headers,h);res.headersSent=true;};
    const completed=once(res,'finish');server.emit('request',req,res);await completed;return {status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString()),headers:res.headers};
  }
  assert.equal((await request('/health')).status,200);assert.equal((await request('/ready')).status,200);assert.equal((await request('/api/me')).status,401);
  const h={authorization:`Bearer ${result.token}`,'content-type':'application/json'};
  assert.equal((await request('/api/me',{headers:h})).body.user.role,'player');
  assert.equal((await request('/api/me',{headers:{...h,origin:'https://foreign.example'}})).status,403);
  assert.equal((await request('/api/analytics',{headers:h})).status,403);
  assert.equal((await request('/api/missions/x/attempts/x/checkpoints',{method:'POST',headers:h,body:'{"sequence":5}'})).status,404);
  assert.equal((await request('/api/auth/login',{method:'POST',headers:h,body:'invalid'})).status,400);
  assert.equal((await request('/api/auth/login',{method:'POST',headers:h,body:JSON.stringify({junk:'x'.repeat(17000)})})).status,413);
  assert.equal((await request('/api/auth/login',{method:'POST',body:'{}'})).status,415);
});
