import {randomUUID} from 'node:crypto';
import {transaction} from './db.mjs';
import {fail,text,email,password,number,uuid,digest,opaque,hashPassword,verifyPassword,cipher,canonical,idempotencyKey,publicUser,requireRole,requireBrand} from './security.mjs';

const DURATIONS=[15,30,45,60,90,120];
const iso=value=>new Date(value).toISOString();
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const profileView=p=>({xp:p.xp,coins:p.coins,level:1+Math.floor(p.xp/300)});
function missionView(m){return {id:m.id,brandId:m.brand_id,campaignId:m.campaign_id,title:m.title,description:m.description,type:m.type,timeLimitSeconds:m.time_limit_seconds,totalCheckpoints:m.targets.length,targets:m.targets,start:m.start_position,movement:m.movement,rewardXp:m.reward_xp,rewardCoins:m.reward_coins,rewardTitle:m.reward_title,demo:true};}
function canMove(position,movement){const b=movement.worldBounds;return position.x>=b.minX&&position.x<=b.maxX&&position.z>=b.minZ&&position.z<=b.maxZ;}
/** Pure bounded planar input simulation shared by database service and unit tests. */
export function simulateInput(attempt,input,now){
  const x=number(input.x,'x',-1,1),z=number(input.z,'z',-1,1),seq=number(input.seq,'seq',1,2_147_483_647);
  if(!Number.isInteger(seq)||typeof input.sprint!=='boolean')fail(400,'INVALID_INPUT');
  if(seq<=Number(attempt.last_input_seq))return {replay:true};
  if(seq!==Number(attempt.last_input_seq)+1)fail(409,'INPUT_SEQUENCE','Resume from lastInputSeq + 1');
  const m=attempt.mission_snapshot,dt=Math.min(.25,Math.max(0,(now-new Date(attempt.last_input_at).getTime())/1000));
  const speed=input.sprint?m.movement.sprintSpeed:m.movement.walkSpeed,divisor=Math.max(1,Math.hypot(x,z));
  const dx=x/divisor*speed*dt,dz=z/divisor*speed*dt,steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.5));
  const position={...attempt.position},completed=[...attempt.completed],newlyCompleted=[];
  for(let step=0;step<steps;step++){
    const proposed={x:position.x+dx/steps,z:position.z+dz/steps};if(canMove(proposed,m.movement)){position.x=proposed.x;position.z=proposed.z;}
    const indices=m.type==='collect'?m.targets.map((_,i)=>i):[completed.length];
    for(const i of indices)if(m.targets[i]&&!completed.includes(i)&&dist(position,m.targets[i])<=m.movement.goalRadius){completed.push(i);newlyCompleted.push(i);}
  }
  return {position,completed,newlyCompleted,seq,replay:false};
}

export function createService(pool,config){
  const secrets=cipher(config.tokenEncryptionKey),sessionHours=config.sessionHours||24;
  if(!Number.isInteger(sessionHours)||sessionHours<1||sessionHours>168)throw new Error('SESSION_HOURS must be an integer from 1 to 168');
  const dbNow=async db=>new Date((await db.query('SELECT clock_timestamp() AS now')).rows[0].now).getTime();
  const audit=async(db,userId,type,subject=null,metadata={})=>db.query('INSERT INTO audit_events(id,actor_id,type,subject_id,metadata) VALUES($1,$2,$3,$4,$5)',[randomUUID(),userId,type,subject,JSON.stringify(metadata)]);
  async function rate(key,limit,seconds=60){
    const r=await pool.query(`INSERT INTO rate_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.window_start<clock_timestamp()-($2*interval '1 second') THEN 1 ELSE rate_limits.hits+1 END,window_start=CASE WHEN rate_limits.window_start<clock_timestamp()-($2*interval '1 second') THEN clock_timestamp() ELSE rate_limits.window_start END RETURNING hits`,[digest(key),seconds]);
    if(r.rows[0].hits>limit)fail(429,'RATE_LIMIT','Please wait before retrying');
  }
  async function authenticate(token){
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))fail(401,'UNAUTHENTICATED');
    const r=await pool.query(`SELECT u.*,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND NOT u.blocked`,[digest(token)]);
    if(!r.rows[0])fail(401,'UNAUTHENTICATED');return r.rows[0];
  }
  async function newSession(db,user){
    const token=opaque();const r=await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+($3*interval '1 hour')) RETURNING expires_at",[digest(token),user.id,sessionHours]);
    const profile=(await db.query('SELECT * FROM profiles WHERE player_id=$1',[user.id])).rows[0];
    return {token,expiresAt:iso(r.rows[0].expires_at),user:publicUser(user),profile:profile?profileView(profile):null};
  }
  async function register(body,ip){
    if(Object.hasOwn(body,'role')||Object.hasOwn(body,'brandId'))fail(400,'ROLE_NOT_ASSIGNABLE');
    const address=email(body.email),pass=password(body.password),name=text(body.name,'name',30);
    await rate(`register:${ip}`,5,3600);const hash=await hashPassword(pass);
    try{return await transaction(pool,async db=>{
      const user=(await db.query("INSERT INTO users(id,email,password_hash,name,role) VALUES($1,$2,$3,$4,'player') RETURNING *",[randomUUID(),address,hash,name])).rows[0];
      await db.query('INSERT INTO profiles(player_id) VALUES($1)',[user.id]);await audit(db,user.id,'registered');return newSession(db,user);
    });}catch(e){if(e.code==='23505')fail(409,'REGISTRATION_UNAVAILABLE','Registration unavailable for this address');throw e;}
  }
  let dummyHashPromise;
  async function login(body,ip){
    const address=email(body.email);password(body.password);await rate(`login-ip:${ip}`,30);await rate(`login-account:${address}`,8);
    const user=(await pool.query('SELECT * FROM users WHERE email=$1',[address])).rows[0];
    dummyHashPromise ||= hashPassword(opaque());
    const valid=await verifyPassword(body.password,user?.password_hash||await dummyHashPromise);
    if(!user||!valid||user.blocked){await audit(pool,user?.id||null,'login_failed',null,{addressHash:digest(address)});fail(401,'INVALID_CREDENTIALS');}
    return transaction(pool,async db=>{await audit(db,user.id,'login');return newSession(db,user);});
  }
  async function logout(user){presence.delete(user.id);await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[user.token_hash]);return {ok:true};}
  // Live presence for the browser game: in-process memory (one instance), 15 s TTL, positions in world metres.
  // Multi-instance deployments need a shared store (Redis) here; nothing about rewards depends on it.
  const presence=new Map();const PRESENCE_TTL=15000,PRESENCE_RADIUS=400;
  async function presenceUpdate(user,body={}){
    requireRole(user,'player');await rate(`presence:${user.id}`,120);
    const x=number(body.x,'x',-10000,10000),z=number(body.z,'z',-10000,10000),rawHeading=number(body.heading??0,'heading',-1e6,1e6),heading=Math.atan2(Math.sin(rawHeading),Math.cos(rawHeading)); // any finite angle, stored wrapped to (-π, π]
    const now=Date.now();presence.set(user.id,{id:user.id,name:user.name,x,z,heading,driving:body.driving===true,updatedAt:now});
    const players=[];for(const [id,p] of presence){if(now-p.updatedAt>PRESENCE_TTL){presence.delete(id);continue;}if(id===user.id)continue;if(Math.hypot(p.x-x,p.z-z)<=PRESENCE_RADIUS)players.push({id:p.id,name:p.name,x:p.x,z:p.z,heading:p.heading,driving:p.driving,age:now-p.updatedAt});}
    return {players,online:presence.size,radius:PRESENCE_RADIUS,demo:true};
  }
  async function expireAttempt(db,a,now){
    if(a.status!=='active'||new Date(a.deadline_at).getTime()>now)return false;
    await db.query("UPDATE mission_attempts SET status='failed',failure_reason='timeout',finished_at=clock_timestamp() WHERE id=$1",[a.id]);
    await db.query('UPDATE campaigns SET reserved=reserved-1 WHERE id=$1',[a.campaign_id]);
    await audit(db,a.player_id,'attempt_failed',a.id,{reason:'timeout'});a.status='failed';a.failure_reason='timeout';a.finished_at=new Date(now);return true;
  }
  async function sweep(){return transaction(pool,async db=>{
    const now=await dbNow(db),rows=(await db.query("SELECT * FROM mission_attempts WHERE status='active' AND deadline_at<=clock_timestamp() ORDER BY deadline_at LIMIT 100 FOR UPDATE SKIP LOCKED")).rows;
    for(const a of rows)await expireAttempt(db,a,now);
    await db.query("UPDATE rewards SET status='EXPIRED' WHERE status='AVAILABLE' AND expires_at<=clock_timestamp()");
    await db.query("DELETE FROM rate_limits WHERE window_start<clock_timestamp()-interval '2 days'");
    await db.query("DELETE FROM sessions WHERE expires_at<clock_timestamp()-interval '7 days'");
    await db.query("DELETE FROM audit_events WHERE type='request_rejected' AND created_at<clock_timestamp()-interval '7 days'");return rows.length;
  });}
  async function rewardView(db,reward,includeToken=false){
    if(reward.status==='AVAILABLE'&&new Date(reward.expires_at).getTime()<=await dbNow(db)){
      const changed=await db.query("UPDATE rewards SET status='EXPIRED' WHERE id=$1 AND status='AVAILABLE' RETURNING *",[reward.id]);
      reward=changed.rows[0]||(await db.query('SELECT * FROM rewards WHERE id=$1',[reward.id])).rows[0]||reward;
    }
    return {id:reward.id,attemptId:reward.attempt_id,playerId:reward.player_id,brandId:reward.brand_id,campaignId:reward.campaign_id,title:reward.title,status:reward.status,createdAt:iso(reward.created_at),expiresAt:iso(reward.expires_at),redeemedAt:reward.redeemed_at?iso(reward.redeemed_at):null,...(includeToken?{code:secrets.decrypt(reward.token_encrypted)}:{}),demo:true};
  }
  async function attemptView(db,a){
    const now=await dbNow(db),m=a.mission_snapshot,profile=(await db.query('SELECT * FROM profiles WHERE player_id=$1',[a.player_id])).rows[0];
    const reward=(await db.query('SELECT * FROM rewards WHERE attempt_id=$1',[a.id])).rows[0];
    return {attemptId:a.id,missionId:a.mission_id,status:a.status,startedAt:iso(a.started_at),deadlineAt:iso(a.deadline_at),finishedAt:a.finished_at?iso(a.finished_at):null,reason:a.failure_reason,timeLimitSeconds:m.time_limit_seconds,totalCheckpoints:m.targets.length,completedCheckpoints:a.completed.length,completed:a.completed,targets:m.targets,position:a.position,movement:m.movement,lastInputSeq:Number(a.last_input_seq),remainingSeconds:a.status==='active'?Math.max(0,(new Date(a.deadline_at).getTime()-now)/1000):0,serverNow:now,rewardXp:a.status==='won'?m.reward_xp:0,rewardCoins:a.status==='won'?m.reward_coins:0,profile:profileView(profile),reward:reward?await rewardView(db,reward,true):null,demo:true};
  }
  async function lockedPlayer(db,user){requireRole(user,'player');return (await db.query('SELECT * FROM profiles WHERE player_id=$1 FOR UPDATE',[user.id])).rows[0];}
  async function ownedAttempt(db,user,id){const a=(await db.query('SELECT * FROM mission_attempts WHERE id=$1 AND player_id=$2 FOR UPDATE',[uuid(id),user.id])).rows[0];if(!a)fail(404,'ATTEMPT_NOT_FOUND');return a;}
  async function idempotent(db,user,scope,key,body,fn){
    idempotencyKey(key);const hash=digest(canonical(body));
    await db.query('INSERT INTO idempotency_keys(user_id,scope,key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[user.id,scope,key,hash]);
    const row=(await db.query('SELECT * FROM idempotency_keys WHERE user_id=$1 AND scope=$2 AND key=$3 FOR UPDATE',[user.id,scope,key])).rows[0];
    if(row.request_hash!==hash)fail(409,'IDEMPOTENCY_CONFLICT');
    if(row.response_encrypted)return secrets.decrypt(row.response_encrypted);
    const response=await fn();await db.query('UPDATE idempotency_keys SET response_encrypted=$4 WHERE user_id=$1 AND scope=$2 AND key=$3',[user.id,scope,key,secrets.encrypt(response)]);return response;
  }
  async function start(user,id,key,body={}){
    requireRole(user,'player');await rate(`start:${user.id}`,12);text(id,'missionId',100);idempotencyKey(key);
    return transaction(pool,db=>idempotent(db,user,`start:${id}`,key,body,async()=>{
      await lockedPlayer(db,user);const now=await dbNow(db);
      const previous=(await db.query("SELECT * FROM mission_attempts WHERE player_id=$1 AND status='active' FOR UPDATE",[user.id])).rows[0];
      if(previous){await expireAttempt(db,previous,now);if(previous.status==='active')fail(409,'ATTEMPT_ACTIVE');}
      const m=(await db.query('SELECT m.* FROM missions m JOIN brands b ON b.id=m.brand_id WHERE m.id=$1 AND m.active AND b.active',[id])).rows[0];if(!m)fail(404,'MISSION_NOT_FOUND');
      const c=(await db.query('SELECT * FROM campaigns WHERE id=$1 FOR UPDATE',[m.campaign_id])).rows[0];
      if(!c.active||(c.starts_at&&new Date(c.starts_at).getTime()>now)||(c.ends_at&&new Date(c.ends_at).getTime()<=now))fail(409,'CAMPAIGN_CLOSED');
      if(c.reserved+c.issued>=c.max_rewards)fail(409,'REWARD_LIMIT');
      const recent=(await db.query("SELECT id FROM mission_attempts WHERE player_id=$1 AND mission_id=$2 AND status='won' AND finished_at>clock_timestamp()-interval '1 minute'",[user.id,id])).rows[0];if(recent)fail(429,'MISSION_COOLDOWN');
      await db.query('UPDATE campaigns SET reserved=reserved+1 WHERE id=$1',[c.id]);
      const a=(await db.query('INSERT INTO mission_attempts(id,mission_id,campaign_id,player_id,deadline_at,mission_snapshot,position) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),id,c.id,user.id,new Date(now+m.time_limit_seconds*1000),JSON.stringify(m),JSON.stringify(m.start_position)])).rows[0];
      await audit(db,user.id,'attempt_started',a.id,{missionId:id,campaignId:c.id});return attemptView(db,a);
    }));
  }
  async function win(db,a){
    if(a.status!=='active')return;
    const m=a.mission_snapshot,token=`AL60S_${opaque()}`;
    const campaign=(await db.query('SELECT * FROM campaigns WHERE id=$1 FOR UPDATE',[a.campaign_id])).rows[0];
    if(!campaign||campaign.reserved<1)throw new Error('Campaign reservation invariant violated');
    await db.query("UPDATE mission_attempts SET status='won',finished_at=clock_timestamp() WHERE id=$1",[a.id]);
    await db.query('UPDATE campaigns SET reserved=reserved-1,issued=issued+1 WHERE id=$1',[a.campaign_id]);
    await db.query('UPDATE profiles SET xp=xp+$2,coins=coins+$3 WHERE player_id=$1',[a.player_id,m.reward_xp,m.reward_coins]);
    await db.query("INSERT INTO rewards(id,attempt_id,player_id,brand_id,campaign_id,title,token_hash,token_encrypted,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+($9*interval '1 hour'))",[randomUUID(),a.id,a.player_id,m.brand_id,a.campaign_id,m.reward_title,digest(token),secrets.encrypt(token),m.reward_valid_hours]);
    await audit(db,a.player_id,'attempt_won',a.id,{missionId:a.mission_id,campaignId:a.campaign_id});await audit(db,a.player_id,'reward_issued',a.id,{brandId:m.brand_id});a.status='won';a.finished_at=new Date(await dbNow(db));
  }
  async function input(user,id,body){
    requireRole(user,'player');await rate(`input:${user.id}`,1800);
    return transaction(pool,async db=>{
      await lockedPlayer(db,user);const a=await ownedAttempt(db,user,id),now=await dbNow(db);await expireAttempt(db,a,now);
      if(a.status!=='active')return attemptView(db,a);
      const simulation=simulateInput(a,body,now);if(simulation.replay)return attemptView(db,a);
      a.position=simulation.position;a.completed=simulation.completed;a.last_input_seq=simulation.seq;a.last_input_at=new Date(now);
      await db.query('UPDATE mission_attempts SET position=$2,completed=$3,last_input_seq=$4,last_input_at=$5 WHERE id=$1',[a.id,JSON.stringify(a.position),JSON.stringify(a.completed),a.last_input_seq,a.last_input_at]);
      for(const index of simulation.newlyCompleted)await db.query('INSERT INTO checkpoint_events(id,attempt_id,sequence) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[randomUUID(),a.id,index+1]);
      if(a.completed.length===a.mission_snapshot.targets.length)await win(db,a);
      return attemptView(db,a);
    });
  }
  async function getAttempt(user,id){return transaction(pool,async db=>{await lockedPlayer(db,user);const a=await ownedAttempt(db,user,id);await expireAttempt(db,a,await dbNow(db));return attemptView(db,a);});}
  async function finish(user,id,key,body={}){
    requireRole(user,'player');idempotencyKey(key);
    return transaction(pool,db=>idempotent(db,user,`finish:${uuid(id)}`,key,body,async()=>{
      await lockedPlayer(db,user);const a=await ownedAttempt(db,user,id);await expireAttempt(db,a,await dbNow(db));
      if(a.status==='active'){
        if(a.completed.length===a.mission_snapshot.targets.length)await win(db,a);
        else{await db.query("UPDATE mission_attempts SET status='failed',failure_reason='incomplete',finished_at=clock_timestamp() WHERE id=$1",[a.id]);await db.query('UPDATE campaigns SET reserved=reserved-1 WHERE id=$1',[a.campaign_id]);await audit(db,user.id,'attempt_failed',a.id,{reason:'incomplete'});a.status='failed';a.failure_reason='incomplete';a.finished_at=new Date(await dbNow(db));}
      }
      return attemptView(db,a);
    }));
  }
  async function me(user){
    let activeAttempt=null;
    if(user.role==='player'){
      const a=(await pool.query("SELECT id FROM mission_attempts WHERE player_id=$1 AND status='active'",[user.id])).rows[0];if(a)activeAttempt=await getAttempt(user,a.id);
    }
    const p=(await pool.query('SELECT * FROM profiles WHERE player_id=$1',[user.id])).rows[0];
    const rewards=(await pool.query('SELECT * FROM rewards WHERE player_id=$1 ORDER BY created_at DESC LIMIT 100',[user.id])).rows;
    return {user:publicUser(user),profile:p?profileView(p):null,activeAttempt,rewards:await Promise.all(rewards.map(r=>rewardView(pool,r,true)))};
  }
  async function missions(id){
    const rows=(await pool.query(`SELECT m.* FROM missions m JOIN campaigns c ON c.id=m.campaign_id JOIN brands b ON b.id=m.brand_id WHERE m.active AND c.active AND b.active ${id?'AND m.id=$1':''} ORDER BY m.id`,id?[text(id,'missionId',100)]:[])).rows;
    if(id&&!rows[0])fail(404,'MISSION_NOT_FOUND');return id?missionView(rows[0]):{missions:rows.map(missionView),demo:true};
  }
  async function redeem(user,code,key){
    requireRole(user,'staff','admin');await rate(`redeem:${user.id}`,30);text(code,'code',100);idempotencyKey(key);
    return transaction(pool,db=>idempotent(db,user,'redeem',key,{code},async()=>{
      const r=(await db.query('SELECT * FROM rewards WHERE token_hash=$1 FOR UPDATE',[digest(code)])).rows[0];if(!r)fail(404,'REWARD_NOT_FOUND');requireBrand(user,r.brand_id);
      if(r.status!=='AVAILABLE')fail(409,`REWARD_${r.status}`);
      if(new Date(r.expires_at).getTime()<=await dbNow(db))fail(409,'REWARD_EXPIRED');
      const used=(await db.query("UPDATE rewards SET status='USED',redeemed_at=clock_timestamp(),redeemed_by=$2 WHERE id=$1 RETURNING *",[r.id,user.id])).rows[0];
      await audit(db,user.id,'reward_redeemed',r.id,{brandId:r.brand_id,campaignId:r.campaign_id});return {reward:await rewardView(db,used),demo:true};
    }));
  }
  async function inspect(user,code){
    requireRole(user,'staff','admin');await rate(`inspect:${user.id}`,60);text(code,'code',100);
    return transaction(pool,async db=>{const r=(await db.query('SELECT * FROM rewards WHERE token_hash=$1 FOR UPDATE',[digest(code)])).rows[0];if(!r)fail(404,'REWARD_NOT_FOUND');requireBrand(user,r.brand_id);return {reward:await rewardView(db,r),demo:true};});
  }
  async function campaign(user,body){
    requireRole(user,'brand','admin');const brandId=text(body.brandId,'brandId',40);requireBrand(user,brandId);
    const title=text(body.title,'title',80),rewardTitle=text(body.rewardTitle,'rewardTitle',120),type=text(body.type,'type',20);
    if(!['checkpoint','collect','delivery'].includes(type)||!DURATIONS.includes(body.duration))fail(400,'INVALID_INPUT');
    const maxRewards=number(body.maxRewards,'maxRewards',1,10000),xp=number(body.xp,'xp',0,500),coins=number(body.coins,'coins',0,500);
    if(![maxRewards,xp,coins].every(Number.isInteger))fail(400,'INVALID_INPUT');
    const start=body.startsAt?new Date(body.startsAt):null,end=body.endsAt?new Date(body.endsAt):null;
    if((start&&!Number.isFinite(start.getTime()))||(end&&!Number.isFinite(end.getTime()))||(start&&end&&start>=end))fail(400,'INVALID_DATES');
    return transaction(pool,async db=>{
      if(end&&end.getTime()<=await dbNow(db))fail(400,'INVALID_DATES');
      if(!(await db.query('SELECT id FROM brands WHERE id=$1 AND active',[brandId])).rows[0])fail(400,'INVALID_BRAND');
      const id=randomUUID(),missionId=`m_${randomUUID()}`;
      await db.query('INSERT INTO campaigns(id,brand_id,title,max_rewards,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',[id,brandId,title,maxRewards,start,end]);
      await db.query(`INSERT INTO missions(id,campaign_id,brand_id,title,description,type,time_limit_seconds,targets,start_position,movement,reward_xp,reward_coins,reward_title) SELECT $1,$2,$3,$4,'Demonstration campaign',$5,$6,targets,start_position,movement,$7,$8,$9 FROM missions WHERE id='m_arbat_60_checkpoint_run'`,[missionId,id,brandId,title,type,body.duration,xp,coins,rewardTitle]);
      await audit(db,user.id,'campaign_created',id,{brandId});return {campaignId:id,missionId,demo:true};
    });
  }
  async function setCampaign(user,id,body){
    requireRole(user,'brand','admin');uuid(id);if(typeof body.active!=='boolean')fail(400,'INVALID_INPUT');
    return transaction(pool,async db=>{const c=(await db.query('SELECT * FROM campaigns WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!c)fail(404,'CAMPAIGN_NOT_FOUND');requireBrand(user,c.brand_id);await db.query('UPDATE campaigns SET active=$2 WHERE id=$1',[id,body.active]);await audit(db,user.id,'campaign_updated',id,{active:body.active});return {ok:true};});
  }
  async function analytics(user){
    requireRole(user,'brand','admin');const b=user.role==='admin'?null:user.brand_id;
    const counts=(await pool.query(`SELECT c.id,c.title,c.brand_id,c.max_rewards,c.reserved,c.issued,(SELECT count(*)::int FROM mission_attempts a WHERE a.campaign_id=c.id) AS starts,(SELECT count(*)::int FROM mission_attempts a WHERE a.campaign_id=c.id AND a.status='won') AS wins,(SELECT count(DISTINCT player_id)::int FROM mission_attempts a WHERE a.campaign_id=c.id) AS unique_players,(SELECT count(*)::int FROM rewards r WHERE r.campaign_id=c.id AND r.status='USED') AS redemptions FROM campaigns c WHERE ($1::text IS NULL OR c.brand_id=$1) ORDER BY c.title`,[b])).rows;return {campaigns:counts,demo:true};
  }
  async function history(user){requireRole(user,'player');return {attempts:(await pool.query('SELECT id,mission_id,status,started_at,finished_at,failure_reason FROM mission_attempts WHERE player_id=$1 ORDER BY started_at DESC LIMIT 100',[user.id])).rows};}
  async function blockUser(user,id,body){requireRole(user,'admin');uuid(id);if(id===user.id)fail(409,'CANNOT_BLOCK_SELF');if(typeof body.blocked!=='boolean')fail(400,'INVALID_INPUT');return transaction(pool,async db=>{const r=await db.query('UPDATE users SET blocked=$2 WHERE id=$1 RETURNING id',[id,body.blocked]);if(!r.rows[0])fail(404,'USER_NOT_FOUND');if(body.blocked)await db.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[id]);await audit(db,user.id,'user_blocked',id,{blocked:body.blocked});return {ok:true};});}
  return {register,login,logout,authenticate,rate,me,missions,start,input,finish,getAttempt,redeem,inspect,campaign,setCampaign,analytics,history,blockUser,sweep,audit,presenceUpdate};
}
