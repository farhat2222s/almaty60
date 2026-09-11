import * as THREE from './vendor/three.module.js';
import {createGeoReference} from './geo/georef.mjs';
import {createSurfaceLibrary} from './materials.mjs';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finitePoint=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
const hash=n=>{let h=2166136261;for(const c of String(n))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
function insideRing(x,z,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function insidePolygon(x,z,rings){return insideRing(x,z,rings[0])&&!rings.slice(1).some(r=>insideRing(x,z,r));}
function distanceToSegment(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?clamp(((x-a[0])*dx+(z-a[1])*dz)/d,0,1):0;return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);}

/** Independent, local OSM geometry view. Never sends movement to the main game server. */
export class GeoWorld {
 constructor(canvas,{onPosition=()=>{},onReady=()=>{},onError=()=>{},onExit=()=>{},onProgress=()=>{}}={}){
  this.canvas=canvas;this.onPosition=onPosition;this.onReady=onReady;this.onError=onError;this.onExit=onExit;this.onProgress=onProgress;
  this.position={x:0,z:0};this.keys=new Set();this.touch={x:0,z:0,sprint:false};this.paused=false;this.loaded=false;this.disposed=false;this.lastTime=0;this.lastPosition=0;this.heading=Math.PI/2;
  this.orbit={yaw:Math.PI/2,pitch:.26,distance:8};this.colliders=[];this.materials=new Map();this.windowTransforms=[];this.ownedGeometries=new Set();this.labels=[];
  try{
   this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.08;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  }catch(error){this.onError(error);throw error;}
  this.surfaces=createSurfaceLibrary(THREE,this.renderer);this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#a8c8df');this.scene.fog=new THREE.Fog('#bdd4df',140,720);
  this.camera=new THREE.PerspectiveCamera(60,1,.15,1800);this.camera.position.set(0,6,13);
  this.scene.add(new THREE.HemisphereLight('#d7ebfa','#7b806d',1.9));this.sun=new THREE.DirectionalLight('#ffefd1',2.7);this.sun.position.set(-70,100,60);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-100,right:100,top:100,bottom:-100,near:1,far:360});this.sun.shadow.normalBias=.08;this.scene.add(this.sun,this.sun.target);
  this.city=new THREE.Group();this.scene.add(this.city);
  this.avatar=this.makeAvatar();this.scene.add(this.avatar);
  this.origin=new THREE.Group();const originRing=new THREE.Mesh(new THREE.TorusGeometry(2,.08,8,48),new THREE.MeshBasicMaterial({color:'#ffdc55'}));originRing.rotation.x=-Math.PI/2;originRing.position.y=.2;this.origin.add(originRing);this.scene.add(this.origin);
  this.credit=document.createElement('div');this.credit.textContent='© OpenStreetMap contributors · ODbL · Высоты части зданий оценочные';Object.assign(this.credit.style,{position:'absolute',left:'12px',bottom:'10px',maxWidth:'calc(100% - 24px)',padding:'6px 9px',borderRadius:'7px',color:'#dbeaf3',background:'#071a2bcf',font:'10px system-ui',pointerEvents:'none',zIndex:'2'});canvas.parentNode?.append(this.credit);
  this.setupInput();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();
  this.frame=time=>{if(this.disposed)return;this.raf=requestAnimationFrame(this.frame);this.render(time)};this.raf=requestAnimationFrame(this.frame);
 }
 material(color,{surface,roughness=.75,metalness=0,...opts}={}){
  const key=JSON.stringify([color,surface,roughness,metalness,opts]);if(!this.materials.has(key)){const m=new THREE.MeshStandardMaterial({color,roughness,metalness,...opts});if(surface)this.surfaces.apply(m,surface);this.materials.set(key,m);}return this.materials.get(key);
 }
 async load(source='./geo/district-local.json'){
  try{
   this.onProgress('Загружаем данные района…');
   const data=typeof source==='string'?await (async()=>{const response=await fetch(source);if(!response.ok)throw new Error(`Геоданные не загрузились: ${response.status}`);return response.json()})():source;
   if(data?.type!=='AL60LocalFeatureCollection'||!Array.isArray(data.features)||data.features.length>20000)throw new Error('Ожидалась локальная коллекция географических объектов AL60.');
   if(!data.coordinateSystem?.origin||data.coordinateSystem.units!=='meters')throw new Error('Геоданные должны содержать начало координат WGS84 и метры.');
   if(this.disposed)return null;
   this.onProgress(`Строим ${data.counts?.building??''} зданий и улицы…`.replace('  ',' '));
   // Let the status text paint before the synchronous CPU build.
   await new Promise(resolve=>setTimeout(resolve,40));if(this.disposed)return null;
   this.reference=createGeoReference(data.coordinateSystem.origin);this.data=data;this.build(data);this.loaded=true;
   this.emitPosition();this.onReady(this.stats);return this.stats;
  }catch(error){this.onError(error);throw error;}
 }
 shapeFromRings(rings){
  const safe=rings.map(r=>r.filter(finitePoint)).filter(r=>r.length>=3);if(!safe.length)return null;
  const outer=new THREE.Shape(safe[0].map(p=>new THREE.Vector2(p[0],-p[1])));for(const ring of safe.slice(1))outer.holes.push(new THREE.Path(ring.map(p=>new THREE.Vector2(p[0],-p[1]))));return outer;
 }
 polygon(rings,height,material,y=0){
  const shape=this.shapeFromRings(rings);if(!shape)return null;
  const geometry=height>0?new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,curveSegments:1,steps:1}):new THREE.ShapeGeometry(shape,1);
  geometry.rotateX(-Math.PI/2);geometry.translate(0,y,0);const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=height>0;mesh.receiveShadow=true;this.city.add(mesh);this.ownedGeometries.add(geometry);return mesh;
 }
 build(data){
  // A second load replaces only this preview's geometry, never the game's state.
  for(const geometry of this.ownedGeometries)geometry.dispose();this.ownedGeometries.clear();this.city.clear();this.colliders=[];this.windowTransforms=[];
  for(const label of this.labels){this.scene.remove(label);label.material.map?.dispose();label.material.dispose();}this.labels=[];
  this.bounds={minX:0,maxX:0,minZ:0,maxZ:0};
  const visit=c=>{if(finitePoint(c)){this.bounds.minX=Math.min(this.bounds.minX,c[0]);this.bounds.maxX=Math.max(this.bounds.maxX,c[0]);this.bounds.minZ=Math.min(this.bounds.minZ,c[1]);this.bounds.maxZ=Math.max(this.bounds.maxZ,c[1]);}else if(Array.isArray(c))c.forEach(visit)};
  data.features.forEach(f=>visit(f.geometry?.coordinates));
  const b=this.bounds,ground=new THREE.Mesh(new THREE.PlaneGeometry(b.maxX-b.minX+80,b.maxZ-b.minZ+80),this.material('#a8b6a1',{surface:'stone'}));ground.rotation.x=-Math.PI/2;ground.position.set((b.minX+b.maxX)/2,-.10,(b.minZ+b.maxZ)/2);ground.receiveShadow=true;this.city.add(ground);this.ownedGeometries.add(ground.geometry);
  const stats={buildings:0,roads:0,green:0,pois:0,estimatedHeights:0,origin:data.coordinateSystem.origin,attribution:data.attribution||'© OpenStreetMap contributors · ODbL',source:'OSM local geometry',positionKind:'virtual-georeferenced'};
  const roads={drive:[],walk:[]};const pedestal=this.material('#b7bab0',{surface:'stone'});
  for(const f of data.features){
   const {geometry:g,properties:p={}}=f;if(!g)continue;
   const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
   if(p.kind==='building')for(const rings of polygons){
    const safe=rings.map(r=>r.filter(finitePoint)).filter(r=>r.length>=3);if(!safe.length)continue;
    const height=clamp(Number(p.heightMeters)||Number.parseFloat(p.tags?.height)||(Number(p.tags?.['building:levels'])||3)*3.2,3,110);
    const palette=['#cfcbc0','#bfc9cc','#d8c7ac','#c7c9bf','#c0b9a8'];const color=palette[hash(f.id)%palette.length];
    this.polygon(safe,height,this.material(color,{surface:'stone'}),.12);this.polygon(safe,0,pedestal,height+.14);
    const ring=safe[0],box={minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),minZ:Math.min(...ring.map(p=>p[1])),maxZ:Math.max(...ring.map(p=>p[1]))};
    this.colliders.push({rings:safe,box,height});this.facadeWindows(ring,height,hash(f.id));stats.buildings++;if(p.heightEstimated||!p.tags?.height)stats.estimatedHeights++;
   }
   if((p.kind==='green'||p.kind==='plaza')&&polygons.length)for(const rings of polygons){this.polygon(rings,0,this.material(p.kind==='green'?'#7e9a72':'#c1bba8',{surface:p.kind==='green'?'foliage':'paving'}),.015);if(p.kind==='green'){stats.green++;this.parkTrees(rings,hash(f.id));}}
   if(p.kind==='road'){
    const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
    const tags=p.tags||{},walk=['pedestrian','footway','path','steps','living_street'].includes(tags.highway),width=clamp(Number.parseFloat(tags.width)||(tags.highway==='pedestrian'?11:walk?2.5:['primary','secondary'].includes(tags.highway)?14:8),1.2,32);
    for(const line of lines){const safe=line.filter(finitePoint);this.roadRibbon(safe,width,walk?roads.walk:roads.drive,walk?.12:.08);stats.roads++;}
   }
   if(p.kind==='poi'&&g.type==='Point'&&finitePoint(g.coordinates)){stats.pois++;if(p.name&&Math.hypot(g.coordinates[0],g.coordinates[1])<95&&this.labels.length<14)this.label(p.name,g.coordinates[0],3.6,g.coordinates[1]);}
  }
  for(const [kind,positions]of Object.entries(roads)){if(!positions.length)continue;const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,this.material(kind==='walk'?'#ccc5b0':'#58656c',{surface:kind==='walk'?'paving':'asphalt',side:THREE.DoubleSide}));mesh.receiveShadow=true;this.city.add(mesh);this.ownedGeometries.add(geo);}
  this.flushWindows();this.mergeStaticMeshes();this.stats={...stats,renderBatches:this.batchStats};
  this.position={x:0,z:0};if(!this.canWalk(0,0)){let found=false;for(let radius=2;radius<=80&&!found;radius+=2)for(let i=0;i<24;i++){const x=Math.sin(i/24*Math.PI*2)*radius,z=Math.cos(i/24*Math.PI*2)*radius;if(this.canWalk(x,z)){this.position={x,z};found=true;break}}}
  this.credit.textContent=`© OpenStreetMap contributors · ODbL · ${stats.buildings} зданий · Высоты оценочные: ${stats.estimatedHeights}`;
 }
 roadRibbon(line,width,positions,y){
  for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.03)continue;const nx=-dz/length*width/2,nz=dx/length*width/2,A=[a[0]+nx,y,a[1]+nz],B=[b[0]+nx,y,b[1]+nz],C=[b[0]-nx,y,b[1]-nz],D=[a[0]-nx,y,a[1]-nz];positions.push(...A,...B,...C,...A,...C,...D);}
 }
 mergeStaticMeshes(){
  this.city.updateMatrixWorld(true);
  const inverseCity=new THREE.Matrix4().copy(this.city.matrixWorld).invert(),groups=new Map(),before=this.city.children.filter(o=>o.isMesh&&!o.isInstancedMesh).length;
  // Only geography-owned static meshes are merged. Avatars, labels and window instances stay independent.
  this.city.traverse(mesh=>{
   if(!mesh.isMesh||mesh.isInstancedMesh||mesh.isSkinnedMesh||Array.isArray(mesh.material)||mesh.geometry.morphAttributes.position?.length)return;
   const key=[mesh.material.uuid,mesh.castShadow,mesh.receiveShadow,mesh.renderOrder,mesh.visible].join('|');
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(mesh);
  });
  let batches=0;const removedGeometry=new Set();
  for(const meshes of groups.values()){
   if(meshes.length<2)continue;
   const transformed=[];
   for(const mesh of meshes){
    const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
    // Imported roads omit UVs; material shaders use world-space UVs, so a zero channel is safe.
    for(const key of Object.keys(geometry.attributes))if(!['position','normal','uv'].includes(key))geometry.deleteAttribute(key);
    if(!geometry.attributes.normal)geometry.computeVertexNormals();
    if(!geometry.attributes.uv)geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*2),2));
    geometry.clearGroups();geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseCity,mesh.matrixWorld));transformed.push(geometry);
   }
   const geometry=mergeGeometries(transformed,false);transformed.forEach(g=>g.dispose());
   if(!geometry)continue;
   geometry.computeBoundingBox();geometry.computeBoundingSphere();
   const first=meshes[0],merged=new THREE.Mesh(geometry,first.material);merged.name='OSM static batch';merged.castShadow=first.castShadow;merged.receiveShadow=first.receiveShadow;merged.renderOrder=first.renderOrder;merged.visible=first.visible;
   meshes.forEach(mesh=>{removedGeometry.add(mesh.geometry);mesh.parent.remove(mesh);});this.city.add(merged);this.ownedGeometries.add(geometry);batches++;
  }
  const stillReferenced=new Set();this.city.traverse(mesh=>{if(mesh.geometry)stillReferenced.add(mesh.geometry);});
  for(const geometry of removedGeometry)if(!stillReferenced.has(geometry)){geometry.dispose();this.ownedGeometries.delete(geometry);}
  const after=this.city.children.filter(o=>o.isMesh&&!o.isInstancedMesh).length;
  this.batchStats={staticMeshesBefore:before,staticMeshesAfter:after,mergedBatches:batches,windowBatches:this.city.children.filter(o=>o.isInstancedMesh).length};
 }
 getMetrics(){return{...this.batchStats,drawCalls:this.renderer?.info.render.calls??null,triangles:this.renderer?.info.render.triangles??null};}
 facadeWindows(ring,height,seed){
  let area=0;for(let i=1;i<ring.length;i++)area+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];const sign=area>=0?1:-1;
  for(let i=1;i<ring.length;i++){
   const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<4||length>180)continue;
   const count=Math.floor(length/3.3),spacing=length/count;
   for(let floor=0;floor<Math.min(16,Math.floor((height-1)/3.2));floor++)for(let k=0;k<count;k++){
    if(this.windowTransforms.length>=14000)return;const t=(k+.5)*spacing/length;
    this.windowTransforms.push({x:a[0]+dx*t+sign*dz/length*.045,y:2.1+floor*3.2,z:a[1]+dz*t-sign*dx/length*.045,angle:-Math.atan2(dz,dx),warm:(k+floor+seed)%9===0});
   }
  }
 }
 flushWindows(){
  const geometry=new THREE.PlaneGeometry(1.35,1.65),dummy=new THREE.Object3D();this.ownedGeometries.add(geometry);
  for(const warm of [false,true]){const items=this.windowTransforms.filter(x=>x.warm===warm);if(!items.length)continue;
   const mesh=new THREE.InstancedMesh(geometry,this.material(warm?'#bfb99c':'#516f80',{metalness:.45,roughness:.22,side:THREE.DoubleSide,...(warm?{emissive:'#d3b88a',emissiveIntensity:.14}:{})}),items.length);
   items.forEach((item,i)=>{dummy.position.set(item.x,item.y,item.z);dummy.rotation.set(0,item.angle,0);dummy.scale.set(1,1,1);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix)});mesh.receiveShadow=true;this.city.add(mesh);
  }
 }
 parkTrees(rings,seed){
  const ring=rings[0]?.filter(finitePoint);if(!ring||ring.length<3)return;const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),count=Math.min(30,Math.ceil((maxX-minX)*(maxZ-minZ)/160));
  const trunkGeo=new THREE.CylinderGeometry(.16,.24,3.2,7),crownGeo=new THREE.SphereGeometry(1,10,8);this.ownedGeometries.add(trunkGeo);this.ownedGeometries.add(crownGeo);
  for(let i=0;i<count;i++){const x=minX+(hash(seed+i)/4294967296)*(maxX-minX),z=minZ+(hash(seed+i+976)/4294967296)*(maxZ-minZ);if(!insidePolygon(x,z,rings))continue;const trunk=new THREE.Mesh(trunkGeo,this.material('#77624c'));trunk.position.set(x,1.6,z);const crown=new THREE.Mesh(crownGeo,this.material('#64864e',{surface:'foliage'}));crown.position.set(x,4.2,z);crown.scale.set(2.2,2.5,2.1);trunk.castShadow=crown.castShadow=true;this.city.add(trunk,crown);}
 }
 label(text,x,y,z){
  const c=document.createElement('canvas');c.width=512;c.height=100;const g=c.getContext('2d');g.fillStyle='#0d293ddd';g.beginPath();g.roundRect(3,3,506,94,16);g.fill();g.fillStyle='#dfedf1';g.font='bold 28px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText(String(text).slice(0,42),256,52,480);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthWrite:false}));sprite.position.set(x,y,z);sprite.scale.set(8,1.55,1);this.labels.push(sprite);this.scene.add(sprite);
 }
 makeAvatar(){
  const root=new THREE.Group(),skin=this.material('#bb8968'),dark=this.material('#153448'),accent=this.material('#ffd23f'),blue=this.material('#314b5c');
  const part=(geometry,material,x,y,z)=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;root.add(m);return m;};
  part(new THREE.CapsuleGeometry(.28,.55,5,12),dark,0,1.16,0);part(new THREE.SphereGeometry(.22,16,12),skin,0,1.9,-.035);part(new THREE.SphereGeometry(.225,16,8,0,Math.PI*2,0,Math.PI*.55),dark,0,1.94,-.02);
  const legs=[];for(const side of [-1,1]){const leg=part(new THREE.CapsuleGeometry(.115,.53,4,8),blue,side*.14,.48,0);legs.push(leg);part(new THREE.CapsuleGeometry(.095,.49,4,8),dark,side*.37,1.13,0);}
  part(new THREE.BoxGeometry(.43,.52,.22),dark,0,1.2,.30);part(new THREE.BoxGeometry(.12,.20,.025),accent,0,1.25,.425);root.userData.legs=legs;return root;
 }
 setHero(hero){if(!hero?.root?.isObject3D)return false;if(this.hero){this.scene.remove(this.hero.root);this.hero.dispose?.();}this.hero=hero;this.avatar.visible=false;this.scene.add(hero.root);return true;}
 canWalk(x,z){
  const b=this.bounds;if(!b||x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ)return false;
  return !this.colliders.some(c=>{if(x<c.box.minX-.45||x>c.box.maxX+.45||z<c.box.minZ-.45||z>c.box.maxZ+.45)return false;if(insidePolygon(x,z,c.rings))return true;return c.rings.some(r=>r.some((p,i)=>i&&distanceToSegment(x,z,r[i-1],p)<.42));});
 }
 setupInput(){
  this.canvas.style.touchAction='none';this.canvas.tabIndex=0;
  this.keyDown=e=>{if(this.paused||e.target?.closest?.('input,textarea,select,[contenteditable]'))return;if(e.code==='Escape'){this.onExit();return;}if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();e.stopPropagation();this.keys.add(e.code);}};
  this.keyUp=e=>this.keys.delete(e.code);this.blur=()=>{this.keys.clear();this.drag=null;this.touch={x:0,z:0,sprint:false};};
  this.pointerDown=e=>{if(this.paused||e.button>0)return;this.canvas.focus();this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};this.canvas.setPointerCapture(e.pointerId);};
  this.pointerMove=e=>{if(!this.drag||this.drag.id!==e.pointerId)return;this.orbit.yaw-=(e.clientX-this.drag.x)*.004;this.orbit.pitch=clamp(this.orbit.pitch+(e.clientY-this.drag.y)*.003,.08,1.16);this.drag.x=e.clientX;this.drag.y=e.clientY;};
  this.pointerUp=e=>{if(this.drag?.id===e.pointerId)this.drag=null;};this.wheel=e=>{if(this.paused)return;e.preventDefault();this.orbit.distance=clamp(this.orbit.distance+e.deltaY*.018,6,100);};
  window.addEventListener('keydown',this.keyDown);window.addEventListener('keyup',this.keyUp);window.addEventListener('blur',this.blur);this.canvas.addEventListener('pointerdown',this.pointerDown);this.canvas.addEventListener('pointermove',this.pointerMove);this.canvas.addEventListener('pointerup',this.pointerUp);this.canvas.addEventListener('pointercancel',this.pointerUp);this.canvas.addEventListener('wheel',this.wheel,{passive:false});
 }
 input(){
  if(this.paused)return{x:0,z:0,sprint:false};let x=(this.keys.has('KeyD')||this.keys.has('ArrowRight')?1:0)-(this.keys.has('KeyA')||this.keys.has('ArrowLeft')?1:0)+(Number(this.touch.x)||0),z=(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0)-(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)+(Number(this.touch.z)||0);const n=Math.max(1,Math.hypot(x,z));x/=n;z/=n;const c=Math.cos(this.orbit.yaw),s=Math.sin(this.orbit.yaw);return{x:x*c+z*s,z:-x*s+z*c,sprint:!!this.touch.sprint||this.keys.has('ShiftLeft')||this.keys.has('ShiftRight')};
 }
 setInput(value={}){this.touch={x:clamp(Number(value.x)||0,-1,1),z:clamp(Number(value.z)||0,-1,1),sprint:!!value.sprint};}
 setPaused(value){this.paused=!!value;if(value)this.blur();}
 getPosition(){return this.reference?{...this.position,...this.reference.fromLocal({...this.position,y:0}),source:'virtual-georeferenced'}:{...this.position};}
 emitPosition(){this.onPosition(this.getPosition());}
 resize(){if(this.disposed)return;const r=this.canvas.getBoundingClientRect();this.renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);this.camera.aspect=Math.max(1,r.width)/Math.max(1,r.height);this.camera.updateProjectionMatrix();}
 render(time){
  const dt=Math.min(.05,(time-(this.lastTime||time))/1000);this.lastTime=time;const input=this.input(),moving=this.loaded&&Math.hypot(input.x,input.z)>.03,speed=input.sprint?11:5.8;
  if(moving){const steps=Math.max(1,Math.ceil(speed*dt/.3));for(let i=0;i<steps;i++){const x=this.position.x+input.x*speed*dt/steps,z=this.position.z+input.z*speed*dt/steps;if(this.canWalk(x,this.position.z))this.position.x=x;if(this.canWalk(this.position.x,z))this.position.z=z;}const target=Math.atan2(-input.x,-input.z);this.heading+=Math.atan2(Math.sin(target-this.heading),Math.cos(target-this.heading))*(1-Math.exp(-12*dt));}
  const avatar=this.hero?.root||this.avatar;avatar.position.set(this.position.x,.15,this.position.z);avatar.rotation.y=this.heading;
  if(this.hero)this.hero.update?.({dt,time:time/1000,moving,sprint:input.sprint,vehicle:false,jump:0});else this.avatar.userData.legs.forEach((leg,i)=>{leg.rotation.x=moving?Math.sin(time*.011)*(i?1:-1)*.5:0;});
  const {yaw,pitch,distance}=this.orbit,target=new THREE.Vector3(this.position.x,1.6,this.position.z),desired=new THREE.Vector3(this.position.x+Math.sin(yaw)*Math.cos(pitch)*distance,1.6+Math.sin(pitch)*distance,this.position.z+Math.cos(yaw)*Math.cos(pitch)*distance),direction=desired.clone().sub(target).normalize(),ray=new THREE.Ray(target,direction),hit=new THREE.Vector3();
  let distanceLimit=target.distanceTo(desired);for(const c of this.colliders){const b=c.box;if(Math.hypot((b.minX+b.maxX)/2-this.position.x,(b.minZ+b.maxZ)/2-this.position.z)>distance+150)continue;const box=new THREE.Box3(new THREE.Vector3(b.minX,.1,b.minZ),new THREE.Vector3(b.maxX,c.height,b.maxZ));if(ray.intersectBox(box,hit))distanceLimit=Math.min(distanceLimit,Math.max(2,hit.distanceTo(target)-.35));}
  desired.copy(target).addScaledVector(direction,distanceLimit);this.camera.position.lerp(desired,1-Math.exp(-9*dt));this.camera.lookAt(target);this.sun.position.set(this.position.x-70,100,this.position.z+60);this.sun.target.position.set(this.position.x,0,this.position.z);
  this.renderer.render(this.scene,this.camera);if(this.loaded&&time-this.lastPosition>200){this.lastPosition=time;this.canvas.dataset.geoDrawCalls=String(this.renderer.info.render.calls);this.emitPosition();}
 }
 dispose(){
  this.disposed=true;cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();this.credit.remove();window.removeEventListener('keydown',this.keyDown);window.removeEventListener('keyup',this.keyUp);window.removeEventListener('blur',this.blur);for(const [name,fn]of[['pointerdown',this.pointerDown],['pointermove',this.pointerMove],['pointerup',this.pointerUp],['pointercancel',this.pointerUp],['wheel',this.wheel]])this.canvas.removeEventListener(name,fn);this.hero?.dispose?.();this.scene.traverse(o=>{o.geometry?.dispose();if(o.material?.map)o.material.map.dispose()});for(const m of this.materials.values())m.dispose();for(const label of this.labels)label.material.dispose();this.surfaces.dispose();this.renderer.dispose();
 }
}
