// Live map providers for ALMATY 60.
//  - 'osm-tiles': Leaflet (BSD-2, vendored) + OpenStreetMap raster tiles. Needs internet, no key.
//    Demo/low-traffic use only: https://operations.osmfoundation.org/policies/tiles/ forbids heavy app traffic,
//    so a public release must switch to 2GIS / Google / Yandex / a commercial tile host.
//  - 'yandex': Yandex Maps JS API 2.1 with the owner's API key.
// Keys never live in this file; they come from the caller (provider-config.json or the in-game key dialog).
import * as L from '../vendor/leaflet/leaflet-src.esm.js';
import {validateWGS84} from './georef.mjs';

export const OSM_TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_TILE_ATTRIBUTION='© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

const pinHtml=(label,color)=>`<span class="al60-pin" style="--pin:${color}"><b>${label}</b></span>`;

/** Slippy map with the player and optional brand pins. `center` is {lat,lon}. */
export function createLeafletMap(container,{center,zoom=16,bbox,collection,player,brands=[],onBrandSelect}={}){
  validateWGS84(center);
  const host=document.createElement('div');Object.assign(host.style,{width:'100%',height:'100%',minHeight:'220px',background:'#0c1a36'});
  container.replaceChildren(host);
  const map=L.map(host,{center:[center.lat,center.lon],zoom,zoomControl:true,attributionControl:true,preferCanvas:true});
  map.attributionControl.setPrefix(false);
  const tiles=L.tileLayer(OSM_TILE_URL,{maxZoom:19,attribution:OSM_TILE_ATTRIBUTION,crossOrigin:'anonymous'}).addTo(map);
  let tileErrors=0;tiles.on('tileerror',()=>{tileErrors++;if(tileErrors===4)host.dataset.offline='true';});
  let district=null;
  if(collection?.type==='FeatureCollection'){
    district=L.geoJSON(collection,{
      filter:f=>['road','green','plaza','building'].includes(f.properties?.kind),
      style:f=>({color:f.properties.kind==='road'?'#ffc800':f.properties.kind==='green'?'#36d673':'#4da3ff',weight:f.properties.kind==='road'?2:1,opacity:.7,fillOpacity:f.properties.kind==='building'?.08:.15}),
      interactive:false
    }).addTo(map);
  }
  const brandLayer=L.layerGroup().addTo(map);
  for(const b of brands){
    const marker=L.marker([b.lat,b.lon],{icon:L.divIcon({className:'al60-pin-wrap',html:pinHtml(b.symbol||'●',b.color||'#ffc800'),iconSize:[34,42],iconAnchor:[17,42],popupAnchor:[0,-40]}),title:b.name});
    marker.bindPopup(`<div class="al60-popup"><b>${b.name}</b><small>${b.subtitle||''}</small>${b.missionId?`<button class="primary small" data-mission="${b.missionId}">Задания</button>`:''}</div>`,{closeButton:false});
    marker.on('click',()=>onBrandSelect?.(b));brandLayer.addLayer(marker);
  }
  let playerMarker=null;
  const api={
    provider:'osm-tiles',map,
    fit(){if(bbox)map.fitBounds([[bbox[1],bbox[0]],[bbox[3],bbox[2]]],{padding:[10,10]});else if(brands.length)map.fitBounds(brands.map(b=>[b.lat,b.lon]),{padding:[24,24],maxZoom:16});},
    setPlayerWGS84(point,{follow=false}={}){
      const p=validateWGS84(point);
      if(!playerMarker){playerMarker=L.marker([p.lat,p.lon],{icon:L.divIcon({className:'al60-pin-wrap',html:'<span class="al60-player-pin"></span>',iconSize:[22,22],iconAnchor:[11,11]}),zIndexOffset:1000,interactive:false}).addTo(map);}
      else playerMarker.setLatLng([p.lat,p.lon]);
      if(follow)map.panTo([p.lat,p.lon],{animate:false});
    },
    invalidate(){map.invalidateSize();},
    destroy(){map.remove();host.remove();}
  };
  if(player)api.setPlayerWGS84(player);
  setTimeout(()=>map.invalidateSize(),50);
  return api;
}

let yandexPromise=null,yandexKey=null;
export function loadYandexMaps(apiKey){
  if(typeof apiKey!=='string'||apiKey.trim().length<20)return Promise.reject(new Error('Укажите ключ JavaScript API Яндекс Карт из кабинета разработчика.'));
  if(yandexKey&&yandexKey!==apiKey)return Promise.reject(new Error('Чтобы сменить ключ Яндекс Карт, перезагрузите страницу.'));
  if(globalThis.ymaps?.Map)return Promise.resolve(globalThis.ymaps);
  if(yandexPromise)return yandexPromise;yandexKey=apiKey;
  yandexPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');let timer;
    const fail=message=>{clearTimeout(timer);script.remove();yandexPromise=null;yandexKey=null;reject(new Error(message));};
    script.src=`https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey.trim())}&lang=ru_RU`;script.async=true;script.referrerPolicy='strict-origin-when-cross-origin';
    script.onload=()=>{if(!globalThis.ymaps){fail('Яндекс Карты не загрузились.');return}globalThis.ymaps.ready(()=>{clearTimeout(timer);resolve(globalThis.ymaps);});};
    script.onerror=()=>fail('Яндекс Карты не загрузились. Проверьте сеть и ключ.');
    timer=setTimeout(()=>fail('Яндекс Карты не ответили за 20 секунд.'),20000);document.head.append(script);
  });return yandexPromise;
}

export async function createYandexMap(container,{apiKey,origin,bbox,player,onStatus}={}){
  validateWGS84(origin);onStatus?.({provider:'yandex',state:'loading'});
  const ymaps=await loadYandexMaps(apiKey);
  const host=document.createElement('div');Object.assign(host.style,{width:'100%',height:'100%',minHeight:'220px'});container.replaceChildren(host);
  const map=new ymaps.Map(host,{center:[origin.lat,origin.lon],zoom:17,controls:['zoomControl']},{suppressMapOpenBlock:true});
  let placemark=null;
  const api={provider:'yandex',state:'ready',map,
    fit(){if(bbox)map.setBounds([[bbox[1],bbox[0]],[bbox[3],bbox[2]]],{checkZoomRange:true});},
    setPlayerWGS84(point){const p=validateWGS84(point);if(placemark)placemark.geometry.setCoordinates([p.lat,p.lon]);else{placemark=new ymaps.Placemark([p.lat,p.lon],{hintContent:'Игрок'},{preset:'islands#yellowCircleDotIcon'});map.geoObjects.add(placemark);}},
    invalidate(){map.container.fitToViewport();},
    destroy(){map.destroy();host.remove();}};
  if(player)api.setPlayerWGS84(player);api.fit();onStatus?.({provider:'yandex',state:'ready'});return api;
}
