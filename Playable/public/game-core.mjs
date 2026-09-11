// ALMATY 60 game rules shared by the Node server and the static (GitHub Pages) build.
// No Node imports here: this file must run unchanged in the browser.
import {SPAWN, LANDMARKS, BRANDS, NPCS, COLLECTIBLES, INITIAL_MISSIONS, canWalk} from './world-data.mjs';

const DURATIONS = new Set([15,30,45,60,90,120]);
const TYPES = new Set(['collect','checkpoint','delivery','reaction']);
const SYMBOLS = ['↑','→','↓','←'];
const QUESTS = {
  aida:{title:'Знакомство с Алматы',description:'Откройте любые три достопримечательности и вернитесь к Аиде.',total:3,xp:200,coins:100},
  timur:{title:'Яблоки большого города',description:'Соберите восемь городских яблок и вернитесь к Тимуру.',total:8,xp:250,coins:120},
  dana:{title:'Истории побед',description:'Выиграйте три брендовых испытания и вернитесь к Дане.',total:3,xp:300,coins:150}
};
const clone = value => structuredClone(value);
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const levelFor = xp => 1+Math.floor(xp/300);
export class GameError extends Error {
  constructor(status,error,message){super(message);this.status=status;this.error=error;}
}
function reject(status,error,message){throw new GameError(status,error,message);}
function finiteNumber(value,name,min,max){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)reject(400,'INVALID_INPUT',`Поле ${name}: число от ${min} до ${max}.`);
  return value;
}
function shortString(value,name,max=100){
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)reject(400,'INVALID_INPUT',`Некорректное поле ${name}.`);
  return value.trim();
}
function pathIdentifier(value){try{return decodeURIComponent(value);}catch{reject(400,'INVALID_PATH','Некорректный адрес.');}}

/** Single local demo player. No production authentication or GPS verification. */
export function createGameCore(options={}){
  // Pure game rules. I/O is injected: `storage` {load()->string|null, save(json)}, `clock`, `random` {uuid(), int(n)}.
  const storage = options.storage || null;
  const clock = options.clock || {now:()=>Date.now(),monotonic:()=>performance.now()};
  const random = options.random || {uuid:()=>globalThis.crypto.randomUUID(),int:n=>Math.floor(Math.random()*n)};
  const randomUUID = random.uuid, randomInt = random.int;
  const mono = () => clock.monotonic();
  const epochStart = clock.now();
  const monoStart = mono();
  const now = () => epochStart + (mono()-monoStart);
  const iso = (time=now()) => new Date(time).toISOString();
  let state;
  const saved = storage ? storage.load() : null;
  if(saved){
    state=JSON.parse(saved);
    if(state.version!==1||!state.player||!Array.isArray(state.missions))throw new Error('Неподдерживаемый файл сохранения; сохраните резервную копию и проверьте data/game-state.json.');
  }else{
    state={version:1,player:{id:'local-player',name:'Исследователь',xp:0,coins:0,level:1,position:{...SPAWN},skin:'night',vehicle:false,inventory:['night'],discovered:[],collected:[],quests:[],achievements:[],stats:{wins:0,attempts:0,distance:0}},missions:clone(INITIAL_MISSIONS),rewards:[],history:[],activeAttempt:null,events:[],campaigns:BRANDS.map(b=>({id:`campaign-${b.id}`,brandId:b.id,title:`Городская коллекция ${b.name}`,active:true,maxRewards:500,start:null,end:null,createdAt:iso()}))};
  }
  let lastInputMono=mono();
  let attemptEndMono=null;
  let reactionReadyMono=null;
  let inputSinceSave=0;
  let pendingSave=false;
  function persist(){
    if(!pendingSave)return;
    if(storage)storage.save(JSON.stringify(state,null,2));
    pendingSave=false;inputSinceSave=0;
  }
  const dirty = () => {pendingSave=true;};
  function record(type,details={}){
    state.history.unshift({id:randomUUID(),type,at:iso(),...details});
    // Persist the complete local audit trail; gameplay event counts never reset.
    dirty();
  }
  function event(type,missionId,details={}){
    const mission=state.missions.find(m=>m.id===missionId);
    state.events.push({id:randomUUID(),type,at:iso(),playerId:state.player.id,missionId:missionId||null,brandId:mission?.brandId||details.brandId||null,campaignId:mission?.campaignId||details.campaignId||null,...details});
    dirty();
  }
  function achievement(id,title){
    if(!state.player.achievements.some(a=>a.id===id)){
      const a={id,title,earnedAt:iso()};state.player.achievements.push(a);record('achievement',{achievementId:id,title});
    }
  }
  function grant(xp,coins){
    const oldLevel=state.player.level;
    state.player.xp+=xp;state.player.coins+=coins;state.player.level=levelFor(state.player.xp);
    if(state.player.level>oldLevel)record('level',{level:state.player.level,title:`Новый уровень: ${state.player.level}`});
    dirty();
  }
  function questProgress(id){return id==='aida'?state.player.discovered.length:id==='timur'?state.player.collected.length:state.player.stats.wins;}
  function updateQuests(){for(const q of state.player.quests)q.progress=Math.min(q.total,questProgress(q.id));}
  function expireRewards(){
    for(const r of state.rewards){
      if(r.status==='AVAILABLE' && Date.parse(r.expiresAt)<=now()){
        r.status='EXPIRED';record('reward_expired',{rewardId:r.id,title:r.title});
      }
    }
  }
  function campaignFor(mission){return state.campaigns.find(c=>c.id===mission.campaignId);}
  function campaignIssued(campaignId){return state.rewards.filter(r=>r.campaignId===campaignId).length;}
  function campaignOpen(mission){
    const c=campaignFor(mission);
    return mission.active!==false && c?.active!==false && (!c?.start||Date.parse(c.start)<=now()) && (!c?.end||Date.parse(c.end)>now());
  }
  function newReaction(attempt){
    reactionReadyMono=mono()+450+randomInt(500);
    attempt.reaction={symbol:SYMBOLS[randomInt(SYMBOLS.length)],cue:'wait',readyAt:now()+reactionReadyMono-mono(),step:attempt.progress,errors:attempt.errors||0};
    dirty();
  }
  function finish(success,reason){
    const a=state.activeAttempt;
    if(!a)return;
    const mission=state.missions.find(m=>m.id===a.missionId);
    a.status=success?'won':'failed';a.finishedAt=iso();a.reason=reason;
    if(success){
      grant(mission.xp,mission.coins);state.player.stats.wins++;
      achievement('first-win','Первая победа');
      if(state.player.stats.wins>=3)achievement('challenger','Три истории побед');
      const campaign=campaignFor(mission);
      // Only one active local attempt; issuance and persistence occur in one synchronous transaction.
      if(campaignOpen(mission) && campaignIssued(mission.campaignId)<(campaign?.maxRewards??mission.maxRewards??500)){
        const reward={id:randomUUID(),code:`DEMO-${randomUUID().replaceAll('-','').slice(0,16).toUpperCase()}`,brandId:mission.brandId,campaignId:mission.campaignId,playerId:state.player.id,missionId:mission.id,title:mission.rewardLabel,status:'AVAILABLE',createdAt:iso(),expiresAt:iso(now()+7*24*60*60*1000),redeemedAt:null,demo:true};
        state.rewards.unshift(reward);a.rewardId=reward.id;
        event('reward_issued',mission.id,{rewardId:reward.id});
      }
      event('win',mission.id,{attemptId:a.id});
    }
    event('completion',mission.id,{attemptId:a.id,success,reason});
    record(success?'mission_won':'mission_failed',{attemptId:a.id,missionId:a.missionId,title:mission.title,status:a.status,reason,xp:success?mission.xp:0,coins:success?mission.coins:0,rewardId:a.rewardId||null,startedAt:a.startedAt,finishedAt:a.finishedAt});
    state.lastAttempt=clone(a);state.activeAttempt=null;attemptEndMono=null;reactionReadyMono=null;
    updateQuests();dirty();persist();
  }
  // Monotonic timers cannot be resumed across process restarts. Fail safely, without rewards.
  if(state.activeAttempt)finish(false,'server_restarted');
  function tick(){
    expireRewards();
    if(state.activeAttempt && mono()>=attemptEndMono)finish(false,'timeout');
  }
  function inspectWorld(){
    const p=state.player;
    for(const landmark of LANDMARKS){
      if(!p.discovered.includes(landmark.id)&&distance(p.position,landmark)<=10){
        p.discovered.push(landmark.id);grant(60,20);record('discovery',{landmarkId:landmark.id,title:landmark.name,xp:60,coins:20});achievement('explorer','Первое открытие');
      }
    }
    for(const apple of COLLECTIBLES){
      if(!p.collected.includes(apple.id)&&distance(p.position,apple)<=3){
        p.collected.push(apple.id);grant(15,5);record('collectible',{collectibleId:apple.id,title:'Городское яблоко',xp:15,coins:5});
      }
    }
    if(p.collected.length>=8)achievement('collector','Яблочный след');
    if(p.discovered.length===LANDMARKS.length)achievement('city-expert','Знаток Алматы');
    updateQuests();
    const a=state.activeAttempt;
    if(a && a.type!=='reaction'){
      if(a.type==='collect'){
        for(const t of a.targets)if(!t.done&&distance(p.position,t)<=4.5){t.done=true;a.progress++;dirty();}
      }else{
        const target=a.targets[a.progress];
        if(target && distance(p.position,target)<=4.5){target.done=true;a.progress++;dirty();}
      }
      if(a.progress===a.total)finish(true,'objectives_complete');
    }
  }
  function snapshot(){
    tick();updateQuests();
    const a=state.activeAttempt?clone(state.activeAttempt):null;
    if(a){
      a.remainingSeconds=Math.max(0,(attemptEndMono-mono())/1000);
      if(a.reaction)a.reaction.cue=mono()>=reactionReadyMono?'go':'wait';
    }
    const missions=state.missions.map(m=>{
      const c=campaignFor(m);return {...clone(m),active:campaignOpen(m),rewardsRemaining:Math.max(0,(c?.maxRewards??m.maxRewards??500)-campaignIssued(m.campaignId))};
    });
    return {player:clone(state.player),missions,brands:clone(BRANDS),landmarks:clone(LANDMARKS),npcs:NPCS.map(n=>({...n,quest:{...QUESTS[n.id],id:n.id,progress:Math.min(QUESTS[n.id].total,questProgress(n.id))}})),rewards:clone(state.rewards),history:clone(state.history.slice(0,200)),activeAttempt:a,lastAttempt:clone(state.lastAttempt||null),campaigns:clone(state.campaigns),serverNow:now(),demo:true};
  }
  function movement(body){
    // Direction is the only accepted movement input; supplied client coordinates/timestamps have no authority.
    const x=finiteNumber(body.x,'x',-1,1),z=finiteNumber(body.z,'z',-1,1);
    if(body.sprint!==undefined&&typeof body.sprint!=='boolean')reject(400,'INVALID_INPUT','sprint должен быть логическим значением.');
    const current=mono(),dt=Math.min(.25,Math.max(0,(current-lastInputMono)/1000));lastInputMono=current;
    const length=Math.hypot(x,z),divisor=Math.max(1,length);
    const speed=state.player.vehicle?36:body.sprint?22:14;
    const old={...state.player.position},position=state.player.position;
    const dx=x/divisor*speed*dt,dz=z/divisor*speed*dt;
    // Substeps prevent tunneling through corners even at maximum vehicle speed.
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.8));
    for(let i=0;i<steps;i++){
      if(canWalk(position.x+dx/steps,position.z))position.x+=dx/steps;
      if(canWalk(position.x,position.z+dz/steps))position.z+=dz/steps;
      inspectWorld();
    }
    state.player.stats.distance+=distance(old,position);dirty();
    if(++inputSinceSave>=30)persist();
  }
  function startMission(id){
    const mission=state.missions.find(m=>m.id===id);
    if(!mission)reject(404,'NOT_FOUND','Миссия не найдена.');
    if(state.activeAttempt)reject(409,'ATTEMPT_ACTIVE','Сначала завершите текущую попытку.');
    if(!campaignOpen(mission))reject(409,'CAMPAIGN_CLOSED','Кампания сейчас недоступна.');
    const campaign=campaignFor(mission);
    if(campaignIssued(mission.campaignId)>=(campaign?.maxRewards??mission.maxRewards??500))reject(409,'REWARD_LIMIT','Демонстрационные награды этой кампании закончились.');
    if(mission.type!=='reaction'&&distance(state.player.position,mission.start)>14)reject(409,'TOO_FAR','Подойдите к брендовой точке в игровом мире.');
    const previous=state.history.find(h=>h.type==='mission_won'&&h.missionId===id);
    if(previous && now()-Date.parse(previous.at)<10_000)reject(429,'COOLDOWN','Следующая попытка станет доступна через 10 секунд после победы.');
    const a={id:randomUUID(),missionId:mission.id,type:mission.type,status:'active',startedAt:iso(),expiresAt:iso(now()+mission.duration*1000),duration:mission.duration,targets:mission.targets.map(t=>({...t,done:false})),progress:0,total:mission.type==='reaction'?8:mission.targets.length,errors:0,reaction:null};
    state.activeAttempt=a;attemptEndMono=mono()+mission.duration*1000;
    if(a.type==='reaction')newReaction(a);
    state.player.stats.attempts++;event('start',mission.id,{attemptId:a.id});record('mission_started',{attemptId:a.id,missionId:a.missionId,title:mission.title});dirty();
  }
  function npcInteraction(id){
    const npc=NPCS.find(n=>n.id===id);
    if(!npc)reject(404,'NOT_FOUND','Персонаж не найден.');
    if(distance(state.player.position,npc)>12)reject(409,'TOO_FAR','Подойдите ближе к персонажу.');
    const existing=state.player.quests.find(q=>q.id===id);
    if(!existing){
      state.player.quests.push({id,...QUESTS[id],status:'active',progress:Math.min(QUESTS[id].total,questProgress(id)),acceptedAt:iso()});
      record('quest_started',{questId:id,title:QUESTS[id].title});
    }else if(existing.status==='completed')reject(409,'QUEST_COMPLETED','Награда за это поручение уже получена.');
    else if(questProgress(id)<existing.total)reject(409,'QUEST_INCOMPLETE',existing.description);
    else{existing.status='completed';existing.completedAt=iso();grant(existing.xp,existing.coins);record('quest_completed',{questId:id,title:existing.title,xp:existing.xp,coins:existing.coins});achievement(`quest-${id}`,`Друг: ${npc.name}`);}
    dirty();
  }
  function reactionAction(body){
    const a=state.activeAttempt;
    if(!a||a.type!=='reaction')reject(409,'NO_REACTION','Нет активного испытания реакции.');
    if(!SYMBOLS.includes(body.symbol))reject(400,'INVALID_INPUT','Нужна одна из стрелок ↑ → ↓ ←.');
    const correct=body.symbol===a.reaction.symbol && mono()-reactionReadyMono>=250;
    if(correct){a.progress++;a.reaction.step=a.progress;}
    else{a.errors++;a.progress=0;a.reaction.errors=a.errors;}
    if(a.errors>=3)finish(false,'too_many_errors');
    else if(a.progress>=8)finish(true,'reaction_complete');
    else newReaction(a);
    dirty();
  }
  function findReward(body){
    const code=shortString(body.code,'code',100);
    const r=state.rewards.find(r=>r.code===code||r.id===code);
    if(!r)reject(404,'REWARD_NOT_FOUND','Демонстрационный код не найден.');
    return r;
  }
  function analytics(){
    const count=(events,type)=>events.filter(e=>e.type===type).length;
    function summary(events){
      const opens=count(events,'open'),starts=count(events,'start'),completions=count(events,'completion'),wins=count(events,'win'),rewards=count(events,'reward_issued'),redemptions=count(events,'redemption');
      return {opens,starts,completions,wins,rewards,redemptions,uniquePlayers:new Set(events.filter(e=>e.type==='start').map(e=>e.playerId)).size,repeatVisits:Math.max(0,starts-new Set(events.filter(e=>e.type==='start').map(e=>e.playerId)).size),startToWin:starts?wins/starts:0,rewardToRedemption:rewards?redemptions/rewards:0};
    }
    return {...summary(state.events),byBrand:BRANDS.map(b=>({brandId:b.id,name:b.name,...summary(state.events.filter(e=>e.brandId===b.id))})),byCampaign:state.campaigns.map(c=>({campaignId:c.id,title:c.title,brandId:c.brandId,...summary(state.events.filter(e=>e.campaignId===c.id))})),byMission:state.missions.map(m=>({missionId:m.id,title:m.title,...summary(state.events.filter(e=>e.missionId===m.id))})),demo:true,note:'Фактические события одного локального игрока. Погашения демонстрационные, физическое посещение и реальные покупки не подтверждаются.'};
  }
  function createCampaign(body){
    const brand=BRANDS.find(b=>b.id===body.brandId);
    if(!brand)reject(400,'INVALID_INPUT','Неизвестный демонстрационный бренд.');
    const title=shortString(body.title,'title',80),rewardLabel=shortString(body.rewardLabel,'rewardLabel',120);
    if(!TYPES.has(body.type))reject(400,'INVALID_INPUT','Неизвестный тип миссии.');
    if(!DURATIONS.has(body.duration))reject(400,'INVALID_INPUT','Продолжительность: 15, 30, 45, 60, 90 или 120 секунд.');
    const xp=finiteNumber(body.xp,'xp',0,500),coins=finiteNumber(body.coins,'coins',0,500),maxRewards=finiteNumber(body.maxRewards,'maxRewards',1,10000);
    if(![xp,coins,maxRewards].every(Number.isInteger))reject(400,'INVALID_INPUT','XP, монеты и лимит должны быть целыми числами.');
    function dateField(value,name){
      if(value===undefined||value===null||value==='')return null;
      if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))reject(400,'INVALID_INPUT',`Некорректная дата ${name}.`);
      return new Date(value).toISOString();
    }
    const start=dateField(body.start,'start'),end=dateField(body.end,'end');
    if(end&&Date.parse(end)<=now())reject(400,'INVALID_INPUT','Окончание кампании должно быть в будущем.');
    if(start&&end&&Date.parse(start)>=Date.parse(end))reject(400,'INVALID_INPUT','Окончание должно быть позже начала.');
    const campaignId=`campaign-${randomUUID()}`,id=`mission-${randomUUID()}`;
    const source=INITIAL_MISSIONS.find(m=>m.brandId===brand.id&&m.type===body.type);
    const campaign={id:campaignId,brandId:brand.id,title,active:true,maxRewards,start,end,createdAt:iso()};
    const mission={...clone(source),id,campaignId,title,type:body.type,duration:body.duration,xp,coins,rewardLabel,maxRewards,active:true};
    state.campaigns.push(campaign);state.missions.push(mission);record('campaign_created',{campaignId,title});dirty();
    return {campaign,mission};
  }
  function handle(method,rawPath,body={}){
    tick();
    if(body===null||typeof body!=='object'||Array.isArray(body))reject(400,'INVALID_INPUT','Ожидается JSON-объект.');
    const pathname=rawPath.split('?')[0];
    let result;
    if(method==='GET'&&pathname==='/api/state')result=snapshot();
    else if(method==='GET'&&pathname==='/api/analytics')result=analytics();
    else if(method==='POST'&&pathname==='/api/input'){movement(body);result=snapshot();}
    else if(method==='POST'&&pathname==='/api/npc'){npcInteraction(body.id);result=snapshot();}
    else if(method==='POST'&&/^\/api\/missions\/[^/]+\/start$/.test(pathname)){startMission(pathIdentifier(pathname.split('/')[3]));result=snapshot();}
    else if(method==='POST'&&pathname==='/api/attempt/action'){reactionAction(body);result=snapshot();}
    else if(method==='POST'&&pathname==='/api/attempt/abandon'){
      if(!state.activeAttempt)reject(409,'NO_ATTEMPT','Нет активной попытки.');
      finish(false,'abandoned');result=snapshot();
    }
    else if(method==='POST'&&pathname==='/api/rewards/inspect'){
      const reward=findReward(body);result={reward:clone(reward),valid:reward.status==='AVAILABLE',demo:true};
    }
    else if(method==='POST'&&pathname==='/api/rewards/redeem'){
      const reward=findReward(body);
      if(reward.status!=='AVAILABLE')reject(409,`REWARD_${reward.status}`,reward.status==='USED'?'Этот код уже погашен.':reward.status==='EXPIRED'?'Срок кода истёк.':'Код отменён.');
      reward.status='USED';reward.redeemedAt=iso();record('reward_redeemed',{rewardId:reward.id,title:reward.title,brandId:reward.brandId});event('redemption',reward.missionId,{rewardId:reward.id});dirty();persist();result={reward:clone(reward),...snapshot()};
    }
    else if(method==='POST'&&pathname==='/api/vehicle'){
      if(body.buy===true&&!state.player.inventory.includes('scooter')){
        if(state.player.coins<120)reject(409,'INSUFFICIENT_COINS','Самокат стоит 120 монет.');
        state.player.coins-=120;state.player.inventory.push('scooter');record('purchase',{item:'scooter',coins:-120,title:'Городской самокат'});achievement('on-wheels','На колёсах');
      }
      if(!state.player.inventory.includes('scooter'))reject(409,'VEHICLE_LOCKED','Сначала купите самокат за 120 монет.');
      state.player.vehicle=!state.player.vehicle;dirty();result=snapshot();
    }
    else if(method==='POST'&&pathname==='/api/player'){
      const name=body.name===undefined?undefined:shortString(body.name,'name',30);
      if(body.skin!==undefined){
        const prices={night:0,cyan:80,gold:150};
        if(typeof body.skin!=='string'||!Object.hasOwn(prices,body.skin))reject(400,'INVALID_INPUT','Неизвестный стиль.');
        const price=prices[body.skin];
        if(!state.player.inventory.includes(body.skin)){
          if(state.player.coins<price)reject(409,'INSUFFICIENT_COINS',`Этот стиль стоит ${price} монет.`);
          state.player.coins-=price;state.player.inventory.push(body.skin);record('purchase',{item:body.skin,coins:-price,title:'Новый стиль'});
        }
        state.player.skin=body.skin;
      }
      if(name!==undefined)state.player.name=name;
      dirty();result=snapshot();
    }
    else if(method==='POST'&&pathname==='/api/campaigns'){const created=createCampaign(body);result={...snapshot(),created};}
    else if(method==='PATCH'&&/^\/api\/campaigns\/[^/]+$/.test(pathname)){
      const campaign=state.campaigns.find(c=>c.id===pathIdentifier(pathname.split('/')[3]));
      if(!campaign)reject(404,'NOT_FOUND','Кампания не найдена.');
      if(typeof body.active!=='boolean')reject(400,'INVALID_INPUT','active должен быть логическим значением.');
      campaign.active=body.active;record('campaign_updated',{campaignId:campaign.id,active:campaign.active,title:campaign.title});dirty();result=snapshot();
    }
    else if(method==='POST'&&pathname==='/api/events'){
      if(body.type!=='open'||!state.missions.some(m=>m.id===body.missionId))reject(400,'INVALID_INPUT','Поддерживается событие open для существующей миссии.');
      event('open',body.missionId);result={ok:true,demo:true};
    }
    else reject(404,'NOT_FOUND','Маршрут не найден.');
    if(pathname!=='/api/input')persist();
    return result;
  }
  return {handle,flush:persist,close:persist};
}

