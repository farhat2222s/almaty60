import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable, Writable} from 'node:stream';
import {once} from 'node:events';
import {createGameService, createGameServer} from '../server.mjs';
import {WORLD} from '../public/world-data.mjs';

function fixture(options={}){
  let monotonic=0,wall=Date.UTC(2026,8,8,12);
  const game=createGameService({dataDir:false,clock:{now:()=>wall,monotonic:()=>monotonic},...options});
  const get=()=>game.handle('GET','/api/state');
  const post=(url,body={})=>game.handle('POST',url,body);
  const advance=(ms)=>{monotonic+=ms;};
  const trail=[];
  function walkStraight(x,z){
    for(let i=0;i<400;i++){
      const p=get().player.position,dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz);
      if(d<.05)return true;
      const speed=get().player.vehicle?36:22;
      advance(250);const s=post('/api/input',{x:dx/d*Math.min(1,d/(speed*.25)),z:dz/d*Math.min(1,d/(speed*.25)),sprint:true});trail.push({...s.player.position});
      if(Math.hypot(s.player.position.x-p.x,s.player.position.z-p.z)<.01)return false;
    }
    return false;
  }
  // Streets in the real city bend around buildings: plan a path on a 4 m grid, then walk it leg by leg.
  function walkTo(x,z){
    if(walkStraight(x,z))return get();
    const CELL=3;let box=140;
    for(let attempt=0;attempt<4;attempt++,box*=1.8){
      const start=get().player.position;
      const minX=Math.min(start.x,x)-box,maxX=Math.max(start.x,x)+box,minZ=Math.min(start.z,z)-box,maxZ=Math.max(start.z,z)+box;
      const cx=v=>Math.round((v-minX)/CELL),cz=v=>Math.round((v-minZ)/CELL),W=cx(maxX)+1,H=cz(maxZ)+1;
      const free=(i,j)=>i>=0&&j>=0&&i<W&&j<H&&WORLD.canWalk(minX+i*CELL,minZ+j*CELL);
      // Snap start and goal to the nearest free cell: a road point can round into a building footprint.
      const nearestFree=(i,j)=>{for(let r=0;r<=3;r++)for(let di=-r;di<=r;di++)for(let dj=-r;dj<=r;dj++)if(free(i+di,j+dj))return [i+di,j+dj];return null;};
      const s0=nearestFree(cx(start.x),cz(start.z)),g=nearestFree(cx(x),cz(z));if(!s0||!g)continue;
      const prev=new Map();const q=[s0];prev.set(s0.join(','),null);let found=false;
      while(q.length){const [i,j]=q.shift();if(i===g[0]&&j===g[1]){found=true;break;}
        for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
          if(di&&dj&&!(free(i+di,j)&&free(i,j+dj)))continue; // no corner cutting through buildings
          const k=[i+di,j+dj].join(',');if(prev.has(k)||!free(i+di,j+dj))continue;prev.set(k,[i,j]);q.push([i+di,j+dj]);}}
      if(!found)continue;
      const path=[];let cur=g;while(cur){path.push(cur);cur=prev.get(cur.join(','));}path.reverse();
      let ok=true;for(const [i,j] of path.slice(1)){if(!walkStraight(minX+i*CELL,minZ+j*CELL)){ok=false;break;}}
      if(walkStraight(x,z))return get();
      if(!ok)continue;
    }
    assert.fail(`Destination unreachable: ${x},${z}; current ${JSON.stringify(get().player.position)}`);
  }
  function winReaction(missionId='aporta-reaction'){
    post(`/api/missions/${missionId}/start`);
    for(let step=0;step<8;step++){
      const s=get(),r=s.activeAttempt.reaction;
      advance(r.readyAt-s.serverNow+251);
      post('/api/attempt/action',{symbol:r.symbol});
    }
    return get();
  }
  return {game,get,post,advance,walkTo,winReaction,trail,setWall:value=>{wall=value;}};
}
function throwsCode(fn,code){assert.throws(fn,error=>error.error===code);}

test('new local game exposes 20 missions and empty real activity',()=>{
  const f=fixture(),s=f.get(),a=f.game.handle('GET','/api/analytics');
  assert.equal(s.demo,true);assert.equal(s.missions.length,30);assert.equal(s.brands.length,5);
  assert.equal(s.player.level,1);assert.equal(s.rewards.length,0);assert.equal(a.starts,0);assert.equal(a.uniquePlayers,0);
});

test('movement is authoritative: rejects forged coordinates, normalizes diagonal, caps elapsed time and blocks buildings',()=>{
  const f=fixture(),before=f.get().player.position;
  f.advance(60_000);
  // Pick a diagonal that is free for 5.5 m from the spawn, then check the capped 0.25 s sprint step exactly.
  const dir=[[1,1],[-1,1],[1,-1],[-1,-1]].find(([dx,dz])=>Array.from({length:12},(_,i)=>(i+1)/2).every(d=>WORLD.canWalk(before.x+dx/Math.SQRT2*d,before.z+dz/Math.SQRT2*d)));
  assert.ok(dir,'spawn has an open diagonal');
  let s=f.post('/api/input',{x:dir[0],z:dir[1],sprint:true,position:{x:100,z:100},elapsed:60000});
  assert.ok(Math.abs(Math.hypot(s.player.position.x-before.x,s.player.position.z-before.z)-5.5)<1e-8);
  throwsCode(()=>f.post('/api/input',{x:100,z:100}),'INVALID_INPUT');
  throwsCode(()=>f.post('/api/input',{x:NaN,z:0}),'INVALID_INPUT');
  const same={...s.player.position};s=f.post('/api/input',{x:1,z:0,sprint:true});assert.deepEqual(s.player.position,same);
  const p0=f.get().player.position,target=WORLD.buildingsNear(p0.x,p0.z,80).sort((a,b)=>Math.hypot((a.box.minX+a.box.maxX)/2-p0.x,(a.box.minZ+a.box.maxZ)/2-p0.z)-Math.hypot((b.box.minX+b.box.maxX)/2-p0.x,(b.box.minZ+b.box.maxZ)/2-p0.z))[0];
  assert.ok(target,'a building exists near the spawn');
  const c={x:(target.box.minX+target.box.maxX)/2,z:(target.box.minZ+target.box.maxZ)/2};
  for(let i=0;i<60;i++){const p=f.get().player.position,d=Math.hypot(c.x-p.x,c.z-p.z);f.advance(250);f.post('/api/input',{x:(c.x-p.x)/d,z:(c.z-p.z)/d,sprint:true});}
  s=f.get();assert.equal(WORLD.buildingAt(s.player.position.x,s.player.position.z),-1,'never inside a building');
});

for(const type of ['collect','checkpoint','delivery','race'])test(`${type} mission: world targets produce one win, progress, unique reward and history`,()=>{
  const f=fixture();const m=f.get().missions.find(x=>x.id===`aporta-${type}`);f.walkTo(m.start.x,m.start.z);
  const s=f.post(`/api/missions/aporta-${type}/start`),a=s.activeAttempt;
  assert.equal(a.duration,type==='race'?90:60);assert.equal(a.status,'active');assert.equal(a.targets.length,type==='delivery'?3:type==='race'?6:5);
  for(const t of a.targets)f.walkTo(t.x,t.z);
  const won=f.get();assert.equal(won.activeAttempt,null);assert.equal(won.lastAttempt.status,'won');
  assert.equal(won.player.stats.wins,1);assert.ok(won.player.xp>=100);assert.equal(won.rewards.length,1);
  assert.match(won.rewards[0].code,/^DEMO-/);assert.equal(won.rewards[0].status,'AVAILABLE');
  assert.equal(won.history.filter(h=>h.type==='mission_won').length,1);
  throwsCode(()=>f.post('/api/attempt/action',{symbol:'↑'}),'NO_REACTION');
  assert.equal(f.get().rewards.length,1);
});

test('ordered checkpoints do not advance from a later target',()=>{
  const f=fixture();const m=f.get().missions.find(x=>x.id==='aporta-checkpoint');f.walkTo(m.start.x,m.start.z);f.post('/api/missions/aporta-checkpoint/start');
  const t=f.get().activeAttempt.targets;f.trail.length=0;f.trail.push({...f.get().player.position});f.walkTo(t[2].x,t[2].z);
  // Server checks proximity on 0.8 m substeps, so test the walked segments, not only the sampled points.
  const segDist=(a,b,p)=>{const dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz||1;const u=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l2));return Math.hypot(a.x+dx*u-p.x,a.z+dz*u-p.z);};
  // Expected progress: walking the trail, only the *next* target in order may count, even when a later one was crossed.
  let expected=0;for(let i=1;i<f.trail.length&&expected<t.length;i++)if(segDist(f.trail[i-1],f.trail[i],t[expected])<=4.5)expected++;
  const a=f.get().activeAttempt;
  assert.equal(a.progress,expected,'progress follows the ordered route only');
  assert.ok(a.targets.slice(expected).every(x=>!x.done),'later targets are never marked done out of order');
  f.post('/api/attempt/abandon');assert.equal(f.get().lastAttempt.reason,'abandoned');assert.equal(f.get().rewards.length,0);
});

test('reaction generates server cues, rejects early presses and completes after 8 valid responses',()=>{
  const f=fixture();const s=f.post('/api/missions/aporta-reaction/start');
  assert.equal(s.activeAttempt.reaction.cue,'wait');
  let a=f.post('/api/attempt/action',{symbol:s.activeAttempt.reaction.symbol}).activeAttempt;
  assert.equal(a.reaction.errors,1);assert.equal(a.progress,0);
  for(let i=0;i<8;i++){
    const current=f.get();f.advance(current.activeAttempt.reaction.readyAt-current.serverNow+251);
    f.post('/api/attempt/action',{symbol:current.activeAttempt.reaction.symbol});
  }
  assert.equal(f.get().lastAttempt.status,'won');assert.equal(f.get().rewards.length,1);
});

test('three reaction errors fail without any reward',()=>{
  const f=fixture();f.post('/api/missions/aporta-reaction/start');
  for(let i=0;i<3;i++)f.post('/api/attempt/action',{symbol:f.get().activeAttempt.reaction.symbol});
  assert.equal(f.get().lastAttempt.reason,'too_many_errors');assert.equal(f.get().rewards.length,0);assert.equal(f.get().player.xp,0);
});

test('only one attempt; timeout is monotonic and late input cannot turn a failure into a win',()=>{
  const f=fixture();f.post('/api/missions/aporta-reaction/start');
  throwsCode(()=>f.post('/api/missions/alma-reaction/start'),'ATTEMPT_ACTIVE');
  f.setWall(Date.UTC(2000,0,1));f.advance(59_000);assert.equal(Math.round(f.get().activeAttempt.remainingSeconds),1);
  f.advance(1000);const s=f.get();assert.equal(s.activeAttempt,null);assert.equal(s.lastAttempt.reason,'timeout');assert.equal(s.rewards.length,0);
  throwsCode(()=>f.post('/api/attempt/action',{symbol:'↑'}),'NO_REACTION');
  const a=f.game.handle('GET','/api/analytics');assert.equal(a.starts,1);assert.equal(a.completions,1);assert.equal(a.wins,0);
});

test('physical movement proximity and once-only discovery/collectible rewards; NPC quest claim is one-time',()=>{
  const f=fixture();throwsCode(()=>f.post('/api/missions/alma-collect/start'),'TOO_FAR');
  throwsCode(()=>f.post('/api/npc',{id:'timur'}),'TOO_FAR');
  f.post('/api/npc',{id:'aida'});throwsCode(()=>f.post('/api/npc',{id:'aida'}),'QUEST_INCOMPLETE');
  const L=id=>WORLD.landmarks.find(l=>l.id===id);
  f.walkTo(L('arbat').x,L('arbat').z);f.walkTo(L('opera').x,L('opera').z);f.walkTo(L('bazaar').x,L('bazaar').z);
  assert.equal(f.get().player.discovered.length,3);
  const earned=f.get().player.xp;f.walkTo(L('bazaar').x+2,L('bazaar').z);f.walkTo(L('bazaar').x,L('bazaar').z);assert.equal(f.get().player.xp,earned);
  const aida=WORLD.npcs.find(n=>n.id==='aida');f.walkTo(aida.x,aida.z);
  const before=f.get().player;f.post('/api/npc',{id:'aida'});const after=f.get().player;
  assert.equal(after.xp-before.xp,200);assert.equal(after.coins-before.coins,100);
  assert.equal(after.quests[0].status,'completed');throwsCode(()=>f.post('/api/npc',{id:'aida'}),'QUEST_COMPLETED');
  const apple=WORLD.collectibles[0];f.walkTo(apple.x,apple.z);
  const collected=f.get().player;assert.ok(collected.collected.includes(apple.id));
  f.advance(250);f.post('/api/input',{x:0,z:0});assert.equal(f.get().player.xp,collected.xp);
});

test('demo reward inspection, redemption, repeat rejection and expiry are authoritative',()=>{
  const f=fixture();let s=f.winReaction(),reward=s.rewards[0];
  const inspected=f.post('/api/rewards/inspect',{code:reward.code});assert.equal(inspected.valid,true);
  s=f.post('/api/rewards/redeem',{code:reward.code});assert.equal(s.reward.status,'USED');assert.ok(s.reward.redeemedAt);
  throwsCode(()=>f.post('/api/rewards/redeem',{code:reward.code}),'REWARD_USED');
  throwsCode(()=>f.post('/api/rewards/redeem',{code:'DEMO-FORGED'}),'REWARD_NOT_FOUND');
  f.advance(10_000);s=f.winReaction();reward=s.rewards[0];f.advance(7*24*60*60*1000);
  assert.equal(f.post('/api/rewards/inspect',{code:reward.code}).reward.status,'EXPIRED');
  throwsCode(()=>f.post('/api/rewards/redeem',{code:reward.code}),'REWARD_EXPIRED');
  const a=f.game.handle('GET','/api/analytics');assert.equal(a.wins,2);assert.equal(a.rewards,2);assert.equal(a.redemptions,1);assert.equal(a.uniquePlayers,1);
});

test('replays cannot mint a second result; next legitimate attempt has a new reward code',()=>{
  const f=fixture();const first=f.winReaction();
  throwsCode(()=>f.post('/api/attempt/action',{symbol:'↑'}),'NO_REACTION');
  throwsCode(()=>f.post('/api/missions/aporta-reaction/start'),'COOLDOWN');
  f.advance(10_000);const next=f.winReaction();
  assert.equal(next.rewards.length,2);assert.notEqual(next.rewards[0].code,first.rewards[0].code);assert.notEqual(next.rewards[0].id,first.rewards[0].id);
});

test('campaign validation, activation, server dates and shared reward limits are enforced',()=>{
  const f=fixture(),body={brandId:'aporta',title:'Тестовая акция',type:'reaction',duration:30,xp:150,coins:60,rewardLabel:'Демо-подарок',maxRewards:1};
  throwsCode(()=>f.post('/api/campaigns',{...body,duration:17}),'INVALID_INPUT');
  throwsCode(()=>f.post('/api/campaigns',{...body,xp:-10}),'INVALID_INPUT');
  throwsCode(()=>f.post('/api/campaigns',{...body,end:'invalid'}),'INVALID_INPUT');
  const created=f.post('/api/campaigns',body).created;
  f.game.handle('PATCH',`/api/campaigns/${created.campaign.id}`,{active:false});
  throwsCode(()=>f.post(`/api/missions/${created.mission.id}/start`),'CAMPAIGN_CLOSED');
  f.game.handle('PATCH',`/api/campaigns/${created.campaign.id}`,{active:true});
  f.winReaction(created.mission.id);f.advance(10_000);
  throwsCode(()=>f.post(`/api/missions/${created.mission.id}/start`),'REWARD_LIMIT');
  const future=new Date(f.get().serverNow+120_000).toISOString();
  const pending=f.post('/api/campaigns',{...body,start:future}).created;
  throwsCode(()=>f.post(`/api/missions/${pending.mission.id}/start`),'CAMPAIGN_CLOSED');
  f.advance(120_000);assert.ok(f.post(`/api/missions/${pending.mission.id}/start`).activeAttempt);
});

test('inventory purchases debit once, cannot overspend, and persist selected equipment',()=>{
  const f=fixture();throwsCode(()=>f.post('/api/vehicle',{buy:true}),'INSUFFICIENT_COINS');
  throwsCode(()=>f.post('/api/player',{skin:'gold'}),'INSUFFICIENT_COINS');
  throwsCode(()=>f.post('/api/player',{skin:'__proto__'}),'INVALID_INPUT');
  throwsCode(()=>f.post('/api/player',{skin:'constructor'}),'INVALID_INPUT');
  assert.equal(f.get().player.coins,0);
  for(let i=0;i<3;i++){f.winReaction();f.advance(10_000);}
  let s=f.get(),coins=s.player.coins;
  s=f.post('/api/vehicle',{buy:true});assert.equal(s.player.vehicle,true);assert.equal(s.player.coins,coins-120);
  s=f.post('/api/vehicle');assert.equal(s.player.vehicle,false);assert.equal(s.player.coins,coins-120);
  coins=s.player.coins;s=f.post('/api/player',{name:'Алия',skin:'cyan'});assert.equal(s.player.name,'Алия');assert.equal(s.player.coins,coins-80);
  s=f.post('/api/player',{skin:'cyan'});assert.equal(s.player.coins,coins-80);assert.equal(s.player.inventory.filter(x=>x==='cyan').length,1);
});

test('driving: enter a nearby car only, car speed applies, the car follows and stays where the player leaves it',()=>{
  const f=fixture();
  throwsCode(()=>f.post('/api/car'),'NO_CAR');
  assert.equal(f.get().cars.length,WORLD.cars.length);assert.ok(WORLD.cars.length>=13,'brand and spawn cars exist');
  const spot=WORLD.cars[1];f.walkTo(spot.x,spot.z);
  let s=f.post('/api/car');assert.equal(s.player.driving,'car-1');assert.equal(s.player.vehicle,false);
  assert.ok(s.player.achievements.some(a=>a.id==='driver'));
  const start={...s.player.position};
  for(let i=0;i<6;i++){f.advance(250);s=f.post('/api/input',{x:0,z:-1,sprint:false});}
  let car=s.cars.find(c=>c.id==='car-1');
  assert.ok(car.speed>20&&car.speed<=48,`accelerates under throttle, speed ${car.speed}`);
  assert.ok(Math.hypot(s.player.position.x-start.x,s.player.position.z-start.z)>8,'the car moved along its heading');
  assert.equal(car.x,s.player.position.x);assert.equal(car.z,s.player.position.z);
  throwsCode(()=>f.post('/api/vehicle'),'DRIVING');
  for(let i=0;i<8;i++){f.advance(250);s=f.post('/api/input',{x:0,z:-1,sprint:true});}
  car=s.cars.find(c=>c.id==='car-1');assert.ok(car.speed>48||car.damage>0,'boost exceeds the normal limit unless a wall was hit');
  for(let i=0;i<6;i++){f.advance(250);s=f.post('/api/input',{x:0,z:1,sprint:false});}
  s=f.post('/api/car');assert.equal(s.player.driving,null);
  const parked=s.cars.find(c=>c.id==='car-1');assert.equal(parked.speed,0);
  assert.ok(Math.hypot(parked.x-s.player.position.x,parked.z-s.player.position.z)<3.5,'player steps out beside the car');
  assert.ok(Math.hypot(parked.x-spot.x,parked.z-spot.z)>5,'car position persisted away from its original spot');
  assert.ok(s.history.some(h=>h.type==='car_enter')&&s.history.some(h=>h.type==='car_exit'));
});

test('atomic save survives service restart and in-progress attempt fails safely',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'almaty60-test-'));
  try{
    const first=fixture({dataDir:directory});let s=first.winReaction();const code=s.rewards[0].code;
    first.post('/api/rewards/redeem',{code});first.advance(10_000);first.post('/api/missions/aporta-reaction/start');first.game.close();
    const second=fixture({dataDir:directory});s=second.get();
    assert.equal(s.player.stats.wins,1);assert.equal(s.rewards[0].status,'USED');assert.equal(s.activeAttempt,null);assert.equal(s.lastAttempt.reason,'server_restarted');
    throwsCode(()=>second.post('/api/rewards/redeem',{code}),'REWARD_USED');
    assert.equal(s.rewards.length,1);assert.deepEqual(fs.readdirSync(directory),['game-state.json']);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('analytics use actual events and separate branded campaign funnels',()=>{
  const f=fixture();f.post('/api/events',{type:'open',missionId:'alma-reaction'});f.winReaction('alma-reaction');
  const a=f.game.handle('GET','/api/analytics');assert.equal(a.opens,1);assert.equal(a.starts,1);assert.equal(a.startToWin,1);assert.equal(a.rewardToRedemption,0);
  assert.equal(a.byBrand.find(b=>b.brandId==='alma').wins,1);assert.equal(a.byBrand.find(b=>b.brandId==='aporta').wins,0);
  throwsCode(()=>f.post('/api/events',{type:'win',missionId:'alma-reaction'}),'INVALID_INPUT');
});

test('HTTP boundary rejects foreign origins, invalid hosts, oversized bodies and invalid JSON without opening a port',async()=>{
  const f=fixture(),server=createGameServer({game:f.game});
  async function request(url,options={}){
    const req=Readable.from(options.body===undefined?[]:[Buffer.from(options.body)]);
    req.url=url;req.method=options.method||'GET';req.headers={host:'127.0.0.1:3060',...options.headers};
    const chunks=[];
    const res=new Writable({write(chunk,encoding,cb){chunks.push(Buffer.from(chunk));cb();}});
    res.writeHead=(status,headers)=>{res.statusCode=status;res.headers=headers;res.headersSent=true;};
    const finished=once(res,'finish');server.emit('request',req,res);await finished;
    const text=Buffer.concat(chunks).toString('utf8');
    return {status:res.statusCode,headers:res.headers,body:res.headers['Content-Type'].includes('application/json')?JSON.parse(text):text};
  }
  let r=await request('/api/state');assert.equal(r.status,200);assert.equal(r.body.demo,true);
  r=await request('/api/state',{headers:{host:'malicious.example:3060'}});assert.equal(r.status,403);
  r=await request('/api/input',{method:'POST',headers:{origin:'https://malicious.example','content-type':'application/json'},body:'{"x":1,"z":0}'});assert.equal(r.status,403);
  r=await request('/api/input',{method:'POST',headers:{origin:'http://127.0.0.1:9999','content-type':'application/json'},body:'{"x":1,"z":0}'});assert.equal(r.status,403);
  r=await request('/api/input',{method:'POST',headers:{'content-type':'text/plain'},body:'{"x":1,"z":0}'});assert.equal(r.status,415);
  r=await request('/api/input',{method:'POST',headers:{'content-type':'application/json'},body:'{broken'});assert.equal(r.status,400);assert.equal(r.body.error,'INVALID_JSON');
  r=await request('/api/input',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:0,z:0,junk:'x'.repeat(17000)})});assert.equal(r.status,413);
  r=await request('/api/input',{method:'POST',headers:{'content-type':'application/json'},body:'null'});assert.equal(r.status,400);
  r=await request('/%2e%2e%2fserver.mjs');assert.equal(r.status,403);
  r=await request('/world-data.mjs');assert.equal(r.status,200);assert.match(r.body,/setWorld|WORLD_VERSION/);
  r=await request('/missing.mjs');assert.equal(r.status,404);
  r=await request('/world-data.mjs',{method:'POST'});assert.equal(r.status,405);
  server.game.close();
});
