// ALMATY 60 world builder: turns the OSM-derived local dataset (geo/city-local.json, metres, x east / z south)
// into the playable world used by both the Node server and the browser. No THREE.js here.
import {CHASE} from './chase.mjs';
export const TYPE_LABELS={collect:'Сбор',checkpoint:'Маршрут',delivery:'Доставка',reaction:'Реакция',race:'Гонка',chase:'Погоня'};
export const SPEEDS={walk:14,sprint:22,scooter:36,drive:48,boost:64};
export const CAR_ENTER_RADIUS=7;
export const WORLD_VERSION=3;

const DRIVE=new Set(['primary','secondary','tertiary','residential','living_street','unclassified']);
const WALK=new Set(['pedestrian','footway','path','cycleway','service','living_street','residential','tertiary','secondary','primary','unclassified']);
export const hash=n=>{let h=2166136261;for(const c of String(n))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const finite=c=>Array.isArray(c)&&Number.isFinite(c[0])&&Number.isFinite(c[1]);
export function insideRing(x,z,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function insidePolygon(x,z,rings){if(!insideRing(x,z,rings[0]))return false;for(let i=1;i<rings.length;i++)if(insideRing(x,z,rings[i]))return false;return true;}
const d2=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const centroid=ring=>{const xs=ring.map(c=>c[0]),zs=ring.map(c=>c[1]);return {x:(Math.min(...xs)+Math.max(...xs))/2,z:(Math.min(...zs)+Math.max(...zs))/2};};
const roadWidth=hw=>hw==='pedestrian'?11:hw==='primary'?16:hw==='secondary'?13:hw==='tertiary'?10:['residential','living_street','unclassified'].includes(hw)?7:hw==='service'?4.5:['footway','path','cycleway'].includes(hw)?2.4:2;
const roadSpeed=hw=>hw==='primary'||hw==='secondary'?15:hw==='tertiary'?12:hw==='residential'||hw==='unclassified'?8:6;

export function buildWorld(district){
  const bounds={...district.bounds};const origin=district.coordinateSystem?.origin||{lon:0,lat:0,alt:0};
  const buildings=[],roads=[],greens=[],plazas=[],pois=[];
  for(const f of district.features||[]){
    const g=f.geometry,p=f.properties||{},tags=p.tags||{};if(!g)continue;
    const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    const safeRings=rings=>rings.map(r=>r.filter(finite).map(c=>[c[0],c[1]])).filter(r=>r.length>=3);
    if(p.kind==='building'){for(const rings of polygons){const safe=safeRings(rings);if(!safe.length)continue;const xs=safe[0].map(c=>c[0]),zs=safe[0].map(c=>c[1]);
      buildings.push({id:f.id,rings:safe,box:{minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)},height:Math.max(3,Math.min(110,Number(p.heightMeters)||(Number(tags['building:levels'])||3)*3.2)),name:p.name||'',levels:Number(tags['building:levels'])||0,seed:hash(f.id),use:tags.building||''});}}
    else if(p.kind==='green'||p.kind==='plaza'){for(const rings of polygons){const safe=safeRings(rings);if(safe.length)(p.kind==='green'?greens:plazas).push({id:f.id,rings:safe,name:p.name||'',seed:hash(f.id),center:centroid(safe[0])});}}
    else if(p.kind==='road'){const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];const hw=tags.highway||'';const drive=DRIVE.has(hw),walk=(WALK.has(hw)||drive)&&hw!=='steps';
      for(const line of lines){const pts=line.filter(finite).map(c=>[c[0],c[1]]);if(pts.length>=2)roads.push({id:f.id,points:pts,width:Math.max(1.5,Math.min(30,drive?Math.max(roadWidth(hw)*.75,Number.parseFloat(tags.width)||roadWidth(hw)):Number.parseFloat(tags.width)||roadWidth(hw))),highway:hw,drive,walk,steps:hw==='steps',name:p.name||'',oneway:tags.oneway==='yes',speed:roadSpeed(hw)});}}
    else if(p.kind==='poi'&&g.type==='Point'&&finite(g.coordinates))pois.push({id:f.id,x:g.coordinates[0],z:g.coordinates[1],name:p.name||'',tags});
  }
  // Building lookup grid (25 m cells) for walkability and camera collision.
  const CELL=25,grid=new Map(),key=(cx,cz)=>cx*100003+cz;
  buildings.forEach((b,i)=>{for(let cx=Math.floor(b.box.minX/CELL);cx<=Math.floor(b.box.maxX/CELL);cx++)for(let cz=Math.floor(b.box.minZ/CELL);cz<=Math.floor(b.box.maxZ/CELL);cz++){const k=key(cx,cz);let arr=grid.get(k);if(!arr)grid.set(k,arr=[]);arr.push(i);}});
  function buildingAt(x,z){const arr=grid.get(key(Math.floor(x/CELL),Math.floor(z/CELL)));if(!arr)return -1;for(const i of arr){const b=buildings[i];if(x<b.box.minX||x>b.box.maxX||z<b.box.minZ||z>b.box.maxZ)continue;if(insidePolygon(x,z,b.rings))return i;}return -1;}
  const margin=8;
  const inBounds=(x,z)=>x>bounds.minX+margin&&x<bounds.maxX-margin&&z>bounds.minZ+margin&&z<bounds.maxZ-margin;
  const canWalk=(x,z)=>Number.isFinite(x)&&Number.isFinite(z)&&inBounds(x,z)&&buildingAt(x,z)<0;
  function buildingsNear(x,z,r){const out=new Set();for(let cx=Math.floor((x-r)/CELL);cx<=Math.floor((x+r)/CELL);cx++)for(let cz=Math.floor((z-r)/CELL);cz<=Math.floor((z+r)/CELL);cz++){for(const i of grid.get(key(cx,cz))||[])out.add(i);}return [...out].map(i=>buildings[i]);}
  // Road samples every ~6 m: walkSamples for missions/apples/NPCs, driveSamples for cars and races.
  const walkSamples=[],driveSamples=[];
  for(const r of roads){if(!r.walk)continue;for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);const n=Math.max(1,Math.round(len/6));
    for(let k=0;k<n;k++){const t=k/n,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;if(!canWalk(x,z))continue;const s={x,z,road:r,heading:Math.atan2(-(b[0]-a[0]),-(b[1]-a[1]))};walkSamples.push(s);if(r.drive)driveSamples.push(s);}}}
  // Drive graph for traffic: nodes at shared vertices (0.5 m snap), edges along drive roads.
  const nodes=[],nodeIndex=new Map(),edges=[];
  const nodeAt=(x,z)=>{const k=Math.round(x*2)+':'+Math.round(z*2);let i=nodeIndex.get(k);if(i===undefined){i=nodes.length;nodes.push({id:i,x,z,edges:[]});nodeIndex.set(k,i);}return i;};
  for(const r of roads){if(!r.drive)continue;for(let i=1;i<r.points.length;i++){const a=nodeAt(...r.points[i-1]),b=nodeAt(...r.points[i]);if(a===b)continue;const e={id:edges.length,a,b,len:Math.hypot(nodes[a].x-nodes[b].x,nodes[a].z-nodes[b].z),road:r,speed:r.speed,oneway:r.oneway};edges.push(e);nodes[a].edges.push(e.id);nodes[b].edges.push(e.id);}}
  for(const n of nodes)n.signal=n.edges.length>=3&&n.edges.some(e=>['secondary','tertiary','primary'].includes(edges[e].road.highway));
  const graph={nodes,edges};
  // Chase routes: a courier drives ~2.6 km of connected streets starting at the graph node nearest to the brand.
  // Deterministic per brand (hash), prefers going straight and bigger roads, never U-turns unless at a dead end.
  const CHASE_ROADS=['primary','secondary','tertiary','residential','living_street','unclassified'];
  // Connected components of the drivable graph: a courier must start on the big network, not on an isolated stub.
  let components=null;
  function componentSizes(){
    if(components)return components;
    const comp=new Int32Array(nodes.length).fill(-1),sizes=[];
    for(let i=0;i<nodes.length;i++){
      if(comp[i]>=0)continue;const id=sizes.length,stack=[i];comp[i]=id;let n=0;
      while(stack.length){const k=stack.pop();n++;for(const eid of nodes[k].edges){const e=edges[eid];if(!CHASE_ROADS.includes(e.road.highway))continue;const o=e.a===k?e.b:e.a;if(comp[o]<0){comp[o]=id;stack.push(o);}}}
      sizes.push(n);
    }
    return components={comp,sizes};
  }
  function chaseRoute(origin,seed,minLength=2600){
    const {comp,sizes}=componentSizes(),big=Math.max(0,...sizes);
    let start=null,bd=Infinity;
    for(const n of nodes){if(sizes[comp[n.id]]<Math.min(150,big))continue;if(!n.edges.some(id=>CHASE_ROADS.includes(edges[id].road.highway)))continue;const d=Math.hypot(n.x-origin.x,n.z-origin.z);if(d<bd){bd=d;start=n;}}
    if(!start)return [];
    const inside=n=>n.x>bounds.minX+45&&n.x<bounds.maxX-45&&n.z>bounds.minZ+45&&n.z<bounds.maxZ-45;
    const points=[{x:start.x,z:start.z}];const visits=new Map();let node=start,prev=null,dir=null,length=0;
    for(let step=0;step<900&&length<minLength;step++){
      visits.set(node.id,(visits.get(node.id)||0)+1);
      const roads=node.edges.map(id=>edges[id]).filter(e=>CHASE_ROADS.includes(e.road.highway));
      const next=e=>e.a===node.id?nodes[e.b]:nodes[e.a];
      // Soft penalties instead of hard filters, so a one-way pocket at the city edge cannot trap the courier in a ping-pong:
      // U-turns, driving against a one-way and revisits all cost points; leaving the playable area is a last resort.
      const scored=roads.map(e=>{const nx=next(e);const ang=Math.atan2(nx.z-node.z,nx.x-node.x);const dev=dir===null?0:Math.abs(Math.atan2(Math.sin(ang-dir),Math.cos(ang-dir)));const rank=['primary','secondary','tertiary'].includes(e.road.highway)?0:.8;const against=e.oneway&&e.a!==node.id?6:0,uturn=e===prev?5:0,outside=inside(nx)?0:1000;return {e,nx,score:dev*1.2+rank+(visits.get(nx.id)||0)*2.4+against+uturn+outside+(hash(seed+':'+step+':'+e.id)%100)/100*1.5};}).sort((a,b)=>a.score-b.score);
      if(!scored.length||scored[0].score>=1000)break;
      const best=scored[0];
      dir=Math.atan2(best.nx.z-node.z,best.nx.x-node.x);length+=best.e.len;points.push({x:best.nx.x,z:best.nx.z});prev=best.e;node=best.nx;
    }
    return points;
  }
  // Named places: data-driven with safe fallbacks. Everything snaps onto walkable road samples.
  const nearestSample=(x,z,list=walkSamples,r=80)=>{let best=null,bd=Infinity;for(const p of list){const d=Math.hypot(p.x-x,p.z-z);if(d<bd){bd=d;best=p;}}return best&&bd<=r?best:null;};
  const snap=(x,z,list=walkSamples,r=80)=>{const s=nearestSample(x,z,list,r);return s?{x:s.x,z:s.z}:canWalk(x,z)?{x,z}:null;};
  const byName=(list,re)=>list.find(p=>re.test(p.name||''));
  const taken=[];
  const snapAway=(x,z,r)=>{let best=null,bd=Infinity;for(const p of walkSamples){if(taken.some(t=>Math.hypot(t.x-p.x,t.z-p.z)<40))continue;const d=Math.hypot(p.x-x,p.z-z);if(d<bd){bd=d;best=p;}}return best&&bd<=r?{x:best.x,z:best.z}:null;};
  // Named places never share a street sample: each one is at least 40 m from the previous ones.
  const place=(fallback,...finders)=>{let out=null;for(const f of finders){const p=f();if(p){out=snapAway(p.x,p.z,120);if(out)break;}}out=out||snapAway(fallback.x,fallback.z,500)||fallback;taken.push(out);return out;};
  const bCenter=b=>b&&{x:(b.box.minX+b.box.maxX)/2,z:(b.box.minZ+b.box.maxZ)/2};
  const arbat=place({x:0,z:0});
  const park=place({x:790,z:330},()=>byName(greens,/панфилов|panfilov/i)?.center);
  const cathedral=place({x:810,z:390},()=>bCenter(byName(buildings,/вознесен|ascension/i)),()=>byName(pois,/вознесен|собор/i));
  const bazaar=place({x:960,z:20},()=>byName(pois,/зел[её]ный базар|green bazaar/i),()=>bCenter(byName(buildings,/зел[её]ный базар|базар/i)));
  const theatre=place({x:-60,z:-330},()=>bCenter(byName(buildings,/театр|филармон|theatre/i)),()=>byName(pois,/театр|филармон|theatre/i));
  const square=place({x:-250,z:520},()=>byName(plazas,/астана|площад/i)?.center,()=>byName(greens,/астана/i)?.center);
  const tsum=place({x:350,z:60},()=>bCenter(byName(buildings,/цум|tsum/i)),()=>byName(pois,/^цум$|tsum/i));
  const name=(list,re,fallback)=>byName(list,re)?.name||fallback;
  const landmarks=[
    {id:'arbat',name:'Арбат',...arbat,color:'#45e3dd',description:'Пешеходная улица Жибек Жолы, музыканты и художники.'},
    {id:'park',name:'Парк 28 панфиловцев',...park,color:'#80da8b',description:'Тянь-шаньские ели и мемориал Славы.'},
    {id:'cathedral',name:'Вознесенский собор',...cathedral,color:'#ffd334',description:'Деревянный собор 1907 года без единого гвоздя.'},
    {id:'bazaar',name:'Зелёный базар',...bazaar,color:'#4edfc5',description:'Главный рынок города: курт, казы и яблоки.'},
    {id:'opera',name:name(buildings,/театр|филармон/i,'Театр'),...theatre,color:'#fcaf88',description:'Вечерние огни и городская сцена.'},
    {id:'republic',name:'Площадь Астана',...square,color:'#a6b5ff',description:'Простор, фонтаны и вид на горы.'}
  ];
  const brands=[
    {id:'aporta',name:'APORTA',category:'Городская кофейня',symbol:'A',color:'#ffcb30',...place({x:arbat.x+38,z:arbat.z+2})},
    {id:'steppe',name:'STEPPE',category:'Движение и спорт',symbol:'S',color:'#45ded6',...place({x:tsum.x,z:tsum.z})},
    {id:'alma',name:'ALMA',category:'Вкус города',symbol:'a',color:'#ff857a',...place({x:bazaar.x-24,z:bazaar.z+10})},
    {id:'nomad',name:'NOMAD',category:'Городские маршруты',symbol:'N',color:'#a99bff',...place({x:park.x-30,z:park.z-40})},
    {id:'sary',name:'SARY',category:'Музыка и культура',symbol:'♪',color:'#f8b962',...place({x:theatre.x+20,z:theatre.z+16})}
  ];
  const spawn=snap(arbat.x-6,arbat.z+9)||arbat;
  const npcs=[
    {id:'aida',name:'Аида',role:'Городской проводник',color:'#45ded6',...(snap(spawn.x-9,spawn.z-4)||spawn)},
    {id:'timur',name:'Тимур',role:'Курьер на колёсах',color:'#ffcb30',...(snap(bazaar.x+14,bazaar.z-6)||bazaar)},
    {id:'dana',name:'Дана',role:'Хранительница историй',color:'#a99bff',...(snap(park.x+12,park.z+8)||park)}
  ];
  // Deterministic spread picks: apples on walkable streets, cars on drivable streets, both away from each other.
  function spread(list,count,minGap,maxRadius,seed,filter=()=>true){const out=[];const cands=list.filter(s=>Math.hypot(s.x,s.z)<=maxRadius&&filter(s));let i=0;while(out.length<count&&i<cands.length*4){const s=cands[(hash(seed+i*7)%Math.max(1,cands.length))];i++;if(!s||out.some(o=>d2(o,s)<minGap))continue;out.push(s);}return out;}
  const collectibles=spread(walkSamples,18,90,760,'apples').map((s,i)=>({id:'alma-'+i,x:s.x,z:s.z}));
  const carSpots=spread(driveSamples,12,55,650,'cars',s=>['residential','tertiary','secondary','living_street'].includes(s.road.highway));
  // One extra car near every brand (chases start behind the wheel) and one at the spawn, on quiet streets, 12 m apart.
  const CAR_ROADS=['residential','tertiary','secondary','living_street','unclassified'];
  const chaseRoutes=Object.fromEntries(brands.map(b=>[b.id,chaseRoute(b,b.id+':chase')]));
  const brandCars=[];
  for(const [anchor,maxD] of [...brands.map(b=>[chaseRoutes[b.id][0]||b,80]),[spawn,140]]){
    const pick=driveSamples.filter(s=>CAR_ROADS.includes(s.road.highway)).map(s=>({s,d:d2(s,anchor)})).filter(o=>o.d>=8&&o.d<=maxD&&!carSpots.some(c=>d2(c,o.s)<12)&&!brandCars.some(c=>d2(c,o.s)<12)).sort((a,b)=>a.d-b.d)[0];
    if(pick)brandCars.push(pick.s);
  }
  const cars=[...carSpots,...brandCars].map((s,i)=>{const w=Math.max(0,s.road.width/2-1.4);let x=s.x+Math.cos(s.heading)*w,z=s.z-Math.sin(s.heading)*w; /* right kerb: right=(cos h,-sin h), same as traffic and the exit-car step */if(!canWalk(x,z)){x=s.x;z=s.z;}return {id:'car-'+i,x,z,heading:s.heading,model:i%8,color:['#9ebfc6','#be9569','#d0cbb3','#244a69','#c9c0aa','#e8c24a','#a7b2b8','#c6a27d'][i%8],speed:0,damage:0};});
  // Missions: targets are road samples picked in distance bands, keeping direction so the route reads naturally.
  function route(originPoint,bands,samples,seed){const out=[];let prev=originPoint,dir=null;for(const [lo,hi] of bands){const cands=samples.filter(s=>{const d=d2(s,originPoint);return d>=lo&&d<=hi&&!out.some(o=>d2(o,s)<10);});if(!cands.length)continue;const scored=cands.map(s=>{const ang=Math.atan2(s.z-prev.z,s.x-prev.x);const dev=dir===null?0:Math.abs(Math.atan2(Math.sin(ang-dir),Math.cos(ang-dir)));return {s,score:dev*30+d2(s,prev)*.35+(hash(seed+s.x+':'+s.z)%7)};}).sort((a,b)=>a.score-b.score);const s=scored[0].s;dir=Math.atan2(s.z-prev.z,s.x-prev.x);prev=s;out.push({x:s.x,z:s.z});}return out;}
  function ring(originPoint,count,lo,hi,samples,seed){const out=[];for(let k=0;k<count;k++){const a0=k/count*Math.PI*2,a1=(k+1)/count*Math.PI*2;const cands=samples.filter(s=>{const d=d2(s,originPoint);if(d<lo||d>hi)return false;let a=Math.atan2(s.z-originPoint.z,s.x-originPoint.x);if(a<0)a+=Math.PI*2;return a>=a0&&a<a1;}).sort((p,q)=>d2(p,originPoint)-d2(q,originPoint));const pick=cands.find(c=>!out.some(o=>d2(o,c)<10));if(pick)out.push({x:pick.x,z:pick.z});}return out;}
  const titles={collect:['Кофейный маршрут','Ритм Арбата','Яблочный сбор','След кочевника','Ноты города'],checkpoint:['Пять поворотов','Темп улиц','Тропами базара','Аллея парка','Культурный круг'],delivery:['Заказ к фонтану','Эстафета STEPPE','Доставка корзины','Письмо путешественника','Билет в театр'],reaction:['Поймай момент','Быстрая реакция','Сочный ритм','Ритм степи','Попади в ноту'],race:['Гонка по Жибек Жолы','Спринт у ЦУМа','Базарный круг','Круг у парка','Театральный заезд'],chase:['Догони курьера','Перехват у ЦУМа','Погоня за фургоном','По следу кочевника','Скорость и ноты']};
  const rewards=['Демо-кофе','Демо-бонус 15%','Демо-набор яблок','Демо-сувенир','Демо-билет'];
  const missions=brands.flatMap((b,bi)=>['collect','checkpoint','delivery','reaction','race','chase'].map((type,i)=>{
    const near=walkSamples.filter(s=>d2(s,b)<=90),drive=driveSamples.filter(s=>d2(s,b)<=420);
    let targets=[];
    if(type==='collect'){targets=ring(b,5,9,34,near,b.id+'c');if(targets.length<5)targets=targets.concat(route(b,[[8,16],[18,28],[30,40],[42,52],[54,64]],near,b.id+'c2').filter(t=>!targets.some(o=>d2(o,t)<10))).slice(0,5);}
    else if(type==='checkpoint')targets=route(b,[[8,16],[18,28],[30,40],[42,52],[54,64]],near,b.id+'k');
    else if(type==='delivery')targets=route(b,[[10,20],[28,40],[46,60]],near,b.id+'d');
    else if(type==='race'){const pool=drive.length>=40?drive:driveSamples.filter(s=>d2(s,b)<=700);const ro=nearestSample(b.x,b.z,driveSamples,400)||b;targets=route(ro,[[35,70],[85,125],[140,185],[200,250],[265,320],[330,395]],pool,b.id+'r');if(targets.length<6)targets=route(ro,[[30,90],[100,170],[180,260],[270,360],[370,470],[480,600]],driveSamples.filter(s=>d2(s,ro)<=700),b.id+'r2');}
    const race=type==='race',chase=type==='chase';
    if(chase)return {id:`${b.id}-${type}`,brandId:b.id,title:titles[type][bi],type,duration:CHASE.duration,difficulty:'Hard',xp:300,coins:160,rewardLabel:'Демо-приз погони',start:{...(chaseRoutes[b.id][0]||{x:b.x,z:b.z})},targets:[],route:chaseRoutes[b.id],courierSpeed:CHASE.speed,campaignId:`campaign-${b.id}`,active:true,mode:'virtual',maxRewards:500};
    return {id:`${b.id}-${type}`,brandId:b.id,title:titles[type][bi],type,duration:race?90:60,difficulty:race?'Hard':i===1?'Medium':'Easy',xp:race?260:100+i*30,coins:race?140:50+i*15,rewardLabel:race?'Демо-приз гонки':rewards[bi],start:{x:b.x,z:b.z},targets,campaignId:`campaign-${b.id}`,active:true,mode:'virtual',maxRewards:500};
  }));
  return {version:WORLD_VERSION,origin,bounds,buildings,roads,greens,plazas,pois,graph,walkSamples,driveSamples,spawn,landmarks,brands,npcs,collectibles,cars,missions,canWalk,buildingAt,buildingsNear,inBounds,
    stats:{buildings:buildings.length,roads:roads.length,driveEdges:edges.length,signals:nodes.filter(n=>n.signal).length,greens:greens.length,pois:pois.length}};
}
