import {createGeoReference,validateWGS84} from './georef.mjs';

export const MAP_PROVIDERS=Object.freeze([
  {id:'osm-local',name:'Географическая схема OSM',requiresKey:false,network:false},
  {id:'2gis',name:'2ГИС · интерактивная карта',requiresKey:true,network:true},
  {id:'google',name:'Google Maps',requiresKey:true,network:true}
]);
export const MAP_ATTRIBUTION='© OpenStreetMap contributors · ODbL';
function checkedCollection(collection){
  if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features))throw new TypeError('Expected WGS84 FeatureCollection');
  if(collection.features.length>20000)throw new RangeError('District is too large');return collection;
}
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** True geographic vector drawing from bundled licensed data. No map tiles, iframe or API key. */
export function createOfflineMap(container,{collection,origin,onFeatureSelect}={}){
  checkedCollection(collection);const reference=createGeoReference(origin),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas unavailable');
  canvas.setAttribute('aria-label','Географическая схема Арбата в Алматы. Перетащите для перемещения, используйте колесо для масштаба.');canvas.setAttribute('role','img');canvas.tabIndex=0;
  Object.assign(canvas.style,{width:'100%',height:'100%',display:'block',touchAction:'none',cursor:'grab'});
  const wrapper=document.createElement('div');Object.assign(wrapper.style,{position:'relative',width:'100%',height:'100%',minHeight:'280px',overflow:'hidden',background:'#0a1829'});
  const attribution=document.createElement('a');attribution.textContent=MAP_ATTRIBUTION;attribution.href='https://www.openstreetmap.org/copyright';attribution.target='_blank';attribution.rel='noopener noreferrer';
  Object.assign(attribution.style,{position:'absolute',right:'8px',bottom:'8px',font:'11px system-ui',color:'#d9e8f5',background:'rgba(5,14,26,.9)',padding:'5px 8px',borderRadius:'7px',zIndex:'2'});
  const selection=document.createElement('div');Object.assign(selection.style,{position:'absolute',left:'10px',top:'10px',maxWidth:'70%',font:'12px system-ui',color:'#fff',background:'rgba(5,14,26,.88)',padding:'8px 10px',borderRadius:'9px',pointerEvents:'none'});selection.textContent='Арбат · реальные улицы и контуры OSM';
  wrapper.append(canvas,attribution,selection);container.replaceChildren(wrapper);
  function project(c){const p=reference.toLocal({lon:c[0],lat:c[1],alt:c[2]??0});return [p.x,p.z];}
  function projected(c){return typeof c[0]==='number'?project(c):c.map(projected);}
  const features=collection.features.map(feature=>({feature,coordinates:projected(feature.geometry.coordinates)}));
  const all=[];function collect(c){if(typeof c[0]==='number')all.push(c);else c.forEach(collect);}features.forEach(f=>collect(f.coordinates));
  if(!all.length)throw new Error('No geographic features');
  const ext={minX:Math.min(...all.map(p=>p[0])),maxX:Math.max(...all.map(p=>p[0])),minZ:Math.min(...all.map(p=>p[1])),maxZ:Math.max(...all.map(p=>p[1]))};
  let width=1,height=1,dpr=1,scale=1,center=[0,0],player=null,disposed=false,drag=null;
  const screen=p=>[(p[0]-center[0])*scale+width/2,(p[1]-center[1])*scale+height/2];
  function trace(line,close=false){if(!line.length)return;let p=screen(line[0]);ctx.moveTo(...p);for(const c of line.slice(1)){p=screen(c);ctx.lineTo(...p);}if(close)ctx.closePath();}
  function draw(){
    if(disposed)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#0a1829';ctx.fillRect(0,0,width,height);
    ctx.strokeStyle='#17314a';ctx.lineWidth=.6;const grid=100;
    for(let x=Math.floor((center[0]-width/2/scale)/grid)*grid;x<center[0]+width/2/scale;x+=grid){const sx=screen([x,0])[0];ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,height);ctx.stroke();}
    for(let z=Math.floor((center[1]-height/2/scale)/grid)*grid;z<center[1]+height/2/scale;z+=grid){const sy=screen([0,z])[1];ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(width,sy);ctx.stroke();}
    for(const {feature,coordinates:c} of features.filter(f=>['green','plaza'].includes(f.feature.properties.kind))){
      ctx.beginPath();for(const ring of c)trace(ring,true);ctx.fillStyle=feature.properties.kind==='green'?'#174943':'#3d453b';ctx.fill('evenodd');
    }
    for(const {feature,coordinates:c} of features.filter(f=>f.feature.properties.kind==='building')){
      ctx.beginPath();for(const ring of c)trace(ring,true);ctx.fillStyle='#213b54';ctx.fill('evenodd');ctx.strokeStyle='#35556e';ctx.lineWidth=.7;ctx.stroke();
    }
    for(const {feature,coordinates:c} of features.filter(f=>f.feature.properties.kind==='road')){
      const t=feature.properties.tags||{},pedestrian=['pedestrian','footway','path','steps'].includes(t.highway),lines=feature.geometry.type==='LineString'?[c]:c;
      ctx.beginPath();lines.forEach(line=>trace(line));ctx.lineCap='round';ctx.lineJoin='round';
      const meters=Number.parseFloat(t.width)||(['pedestrian'].includes(t.highway)?10:pedestrian?2.2:7);
      ctx.lineWidth=clamp(meters*scale,1,36);ctx.strokeStyle=String(feature.properties.osmId)==='387242322'?'#ffd339':pedestrian?'#3c9d99':'#536b80';ctx.stroke();
    }
    for(const {feature,coordinates:c} of features.filter(f=>f.feature.properties.kind==='poi')){
      const p=screen(c);if(p[0]<-20||p[0]>width+20||p[1]<-20||p[1]>height+20)continue;
      ctx.beginPath();ctx.arc(...p,scale>.8?3:2,0,Math.PI*2);ctx.fillStyle='#43dacf';ctx.fill();
      if(scale>1.5&&feature.properties.name){ctx.font='10px system-ui';ctx.fillStyle='#d4e3ee';ctx.fillText(feature.properties.name.slice(0,26),p[0]+6,p[1]+3);}
    }
    const originPoint=screen([0,0]);ctx.beginPath();ctx.arc(...originPoint,5,0,Math.PI*2);ctx.strokeStyle='#ffd339';ctx.lineWidth=2;ctx.stroke();
    if(player){const p=screen(player);ctx.beginPath();ctx.arc(...p,7,0,Math.PI*2);ctx.fillStyle='#ffd339';ctx.fill();ctx.strokeStyle='#091528';ctx.lineWidth=3;ctx.stroke();}
    const metersPerBar=scale>=1?50:100,barPixels=metersPerBar*scale;ctx.strokeStyle='#b8cbda';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(15,height-22);ctx.lineTo(15+barPixels,height-22);ctx.stroke();ctx.font='11px system-ui';ctx.fillStyle='#b8cbda';ctx.fillText(`${metersPerBar} м`,15,height-30);
    ctx.fillStyle='#d7e4ee';ctx.font='bold 12px system-ui';ctx.fillText('С ↑',width-40,25);
  }
  function fit(){center=[(ext.minX+ext.maxX)/2,(ext.minZ+ext.maxZ)/2];scale=Math.max(.05,Math.min(Math.max(1,width-40)/Math.max(1,ext.maxX-ext.minX),Math.max(1,height-70)/Math.max(1,ext.maxZ-ext.minZ)));draw();}
  function resize(){const rect=wrapper.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(280,rect.height);dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);fit();}
  const observer=new ResizeObserver(resize);observer.observe(wrapper);
  const pointerDown=e=>{drag={id:e.pointerId,x:e.clientX,y:e.clientY,center:[...center],moved:false};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';};
  const pointerMove=e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>4)drag.moved=true;center=[drag.center[0]-dx/scale,drag.center[1]-dy/scale];draw();};
  const pointerUp=e=>{if(!drag||drag.id!==e.pointerId)return;const moved=drag.moved;drag=null;canvas.style.cursor='grab';if(!moved){const rect=canvas.getBoundingClientRect(),p=[e.clientX-rect.left,e.clientY-rect.top];const hits=features.filter(f=>f.feature.properties.kind==='poi').map(f=>({f,d:Math.hypot(screen(f.coordinates)[0]-p[0],screen(f.coordinates)[1]-p[1])})).filter(h=>h.d<14).sort((a,b)=>a.d-b.d);if(hits[0]){const feature=hits[0].f.feature;selection.textContent=`${feature.properties.name||'Место на карте'} · данные OSM, не партнёр акции`;onFeatureSelect?.(feature);}}};
  const zoomAt=(factor,x=width/2,y=height/2)=>{const old=scale;scale=clamp(scale*factor,.12,8);center[0]+=(x-width/2)*(1/old-1/scale);center[1]+=(y-height/2)*(1/old-1/scale);draw();};
  const wheel=e=>{e.preventDefault();const rect=canvas.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*.001),e.clientX-rect.left,e.clientY-rect.top);};
  const key=e=>{if(e.key==='+'||e.key==='='){e.preventDefault();zoomAt(1.3);}else if(e.key==='-'){e.preventDefault();zoomAt(1/1.3);}else if(e.key==='Home'){e.preventDefault();fit();}};
  canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('keydown',key);resize();
  return {provider:'osm-local',fit,zoom:factor=>zoomAt(factor),setPlayerWGS84(point){const p=reference.toLocal(validateWGS84(point));player=[p.x,p.z];draw();},destroy(){disposed=true;observer.disconnect();canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerUp);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('keydown',key);wrapper.remove();}};
}

let googlePromise=null,loadedGoogleKey=null;
export function loadGoogleMaps({apiKey,language='ru',region='KZ',nonce}={}){
  if(typeof apiKey!=='string'||apiKey.trim().length<20)return Promise.reject(new Error('Укажите свой browser API key Google Maps с ограничением по HTTP referrer.'));
  if(loadedGoogleKey&&loadedGoogleKey!==apiKey)return Promise.reject(new Error('Чтобы сменить ключ Google Maps, перезагрузите страницу.'));
  if(globalThis.google?.maps?.Map)return Promise.resolve(globalThis.google.maps);
  if(googlePromise)return googlePromise;loadedGoogleKey=apiKey;
  googlePromise=new Promise((resolve,reject)=>{
    const callback=`__al60GoogleReady_${Date.now()}`,script=document.createElement('script');let timer;
    const cleanup=()=>{clearTimeout(timer);delete globalThis[callback];};
    globalThis[callback]=()=>{cleanup();resolve(globalThis.google.maps);};
    script.async=true;script.referrerPolicy='strict-origin-when-cross-origin';if(nonce)script.nonce=nonce;
    const params=new URLSearchParams({key:apiKey,loading:'async',callback,v:'quarterly',language,region,auth_referrer_policy:'origin'});
    script.src=`https://maps.googleapis.com/maps/api/js?${params}`;
    script.onerror=()=>{cleanup();script.remove();googlePromise=null;loadedGoogleKey=null;reject(new Error('Google Maps не загрузился. Проверьте сеть, API key и ограничения проекта.'));};
    timer=setTimeout(()=>{cleanup();script.remove();googlePromise=null;loadedGoogleKey=null;reject(new Error('Google Maps не ответил за 20 секунд.'));},20000);
    document.head.append(script);
  });return googlePromise;
}
/** Commercial map is an optional separate map view, never a substitute for 3D game geometry. */
export async function createGoogleMap(container,{apiKey,origin,bbox,collection,mapId,onFeatureSelect}={}){
  const maps=await loadGoogleMaps({apiKey});validateWGS84(origin);const options={center:{lat:origin.lat,lng:origin.lon},zoom:17,mapTypeControl:true,streetViewControl:false,fullscreenControl:true,gestureHandling:'cooperative'};if(mapId)options.mapId=mapId;
  const map=new maps.Map(container,options);
  if(bbox)map.fitBounds({west:bbox[0],south:bbox[1],east:bbox[2],north:bbox[3]});
  let clickListener;
  if(collection){checkedCollection(collection);map.data.addGeoJson(collection);map.data.setStyle(feature=>({strokeColor:feature.getProperty('kind')==='road'?'#f1c422':'#2f7892',strokeWeight:feature.getProperty('kind')==='road'?3:1,fillColor:'#3bbcb3',fillOpacity:.18}));clickListener=map.data.addListener('click',event=>event.feature.toGeoJson(feature=>onFeatureSelect?.(feature)));}
  const credit=document.createElement('div');credit.textContent=MAP_ATTRIBUTION;Object.assign(credit.style,{background:'#fff',padding:'4px 7px',color:'#172a3c',font:'11px system-ui'});map.controls[maps.ControlPosition.BOTTOM_LEFT].push(credit);
  return {provider:'google',map,fit(){if(bbox)map.fitBounds({west:bbox[0],south:bbox[1],east:bbox[2],north:bbox[3]});},setPlayerWGS84(point){validateWGS84(point);map.panTo({lat:point.lat,lng:point.lon});},destroy(){clickListener?.remove();map.data.forEach(feature=>map.data.remove(feature));maps.event.clearInstanceListeners(map);container.replaceChildren();}};
}

/** Keys are supplied by the caller's settings UI; they are never hardcoded or logged here. */
export async function createMapAdapter(provider,container,options){
  if(provider==='osm-local')return createOfflineMap(container,options);
  if(provider==='2gis')return create2GISMap(container,options);
  if(provider==='google')return createGoogleMap(container,options);
  throw new Error('Для этого провайдера в данном срезе нет настроенной SDK-интеграции.');
}

export function providerConfigurationState(provider,options={}){
  if(provider==='osm-local')return {state:'ready',requiresKey:false};
  if(!['2gis','google'].includes(provider))return {state:'unsupported',requiresKey:false};
  return {state:typeof options.apiKey==='string'&&options.apiKey.trim().length>=10?'configured':'needs-key',requiresKey:true};
}
let mapglPromise=null;
export function load2GISMapGL(){
  if(globalThis.mapgl?.Map)return Promise.resolve(globalThis.mapgl);if(mapglPromise)return mapglPromise;
  mapglPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');let timer;script.src='https://mapgl.2gis.com/api/js/v1';script.async=true;script.referrerPolicy='strict-origin-when-cross-origin';
    const fail=()=>{clearTimeout(timer);script.remove();mapglPromise=null;reject(new Error('Не удалось загрузить 2ГИС MapGL. Проверьте подключение.'));};
    script.onload=()=>{clearTimeout(timer);if(globalThis.mapgl?.Map)resolve(globalThis.mapgl);else fail();};script.onerror=fail;timer=setTimeout(fail,20000);document.head.append(script);
  });return mapglPromise;
}
/** No key means a truthful setup card, without loading the commercial SDK or tiles. */
export async function create2GISMap(container,{apiKey,origin,bbox,onConfigure,onStatus,player}={}){
  if(providerConfigurationState('2gis',{apiKey}).state==='needs-key'){
    const card=document.createElement('div');Object.assign(card.style,{display:'grid',placeContent:'center',gap:'12px',minHeight:'280px',padding:'24px',background:'#102138',color:'#e8f2fb',font:'14px system-ui'});
    const title=document.createElement('strong');title.textContent='2ГИС ещё не подключён';const description=document.createElement('p');description.textContent='Для интерактивной карты нужен ваш ключ Map Tiles API / MapGL. Географический район OSM уже доступен отдельно.';
    const link=document.createElement('a');link.textContent='Настроить ключ в кабинете 2ГИС';link.href='https://platform.2gis.ru/';link.target='_blank';link.rel='noopener noreferrer';link.style.color='#55dfc9';card.append(title,description,link);
    if(onConfigure){const button=document.createElement('button');button.textContent='Ввести свой ключ';button.onclick=onConfigure;card.append(button);}container.replaceChildren(card);onStatus?.({state:'needs-key',provider:'2gis'});
    return {provider:'2gis',state:'needs-key',fit(){},setPlayerWGS84(){},destroy(){card.remove();}};
  }
  validateWGS84(origin);const sdk=await load2GISMapGL(),map=new sdk.Map(container,{center:[origin.lon,origin.lat],zoom:17,key:apiKey.trim(),pitch:0,rotation:0});
  let marker=null,disposed=false,timer;
  const api={provider:'2gis',state:'loading',map,fit(){if(bbox)map.fitBounds({southWest:[bbox[0],bbox[1]],northEast:[bbox[2],bbox[3]]});},setPlayerWGS84(point){const p=validateWGS84(point);if(marker)marker.setCoordinates([p.lon,p.lat]);else marker=new sdk.Marker(map,{coordinates:[p.lon,p.lat]});},destroy(){disposed=true;clearTimeout(timer);marker?.destroy();map.destroy();}};
  const report=state=>{if(disposed)return;api.state=state;onStatus?.({provider:'2gis',state});};
  map.once('styleload',()=>{clearTimeout(timer);report('ready');api.fit();});
  map.on('styleloaderror',()=>{clearTimeout(timer);report('error');});timer=setTimeout(()=>report('unverified'),25000);
  if(player)api.setPlayerWGS84(player);report('loading');return api;
}
