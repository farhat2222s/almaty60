import {GeoWorld} from './geo-world.mjs';
import {loadHero} from './hero.mjs';
import {createMapAdapter,PROVIDER_NAMES} from './geo/map-adapters.mjs';
const KEY_STORE='al60-map-keys';
export function storedMapKeys(){try{return JSON.parse(localStorage.getItem(KEY_STORE)||'{}')}catch{return {}}}
export function storeMapKey(provider,key){const keys=storedMapKeys();if(key)keys[provider]=key;else delete keys[provider];try{localStorage.setItem(KEY_STORE,JSON.stringify(keys))}catch{}return keys}

export async function openGeography({onExit=()=>{}}={}) {
  const shell=document.createElement('section');shell.className='geo-experience';shell.setAttribute('aria-label','Арбат · реальная география');
  shell.innerHTML=`<canvas class="geo-scene" aria-label="Трёхмерный Арбат по реальным контурам OSM"></canvas><header class="geo-toolbar"><div><small>АЛМАТЫ · РЕАЛЬНЫЙ РАЙОН</small><h1>Прогулка по Арбату</h1></div><button class="ghost" data-geo-exit>← В игру</button></header><div class="geo-caption card"><b data-geo-status>Загружаем район…</b><p>Реальные улицы и контуры. Фасады и часть высот — игровые модели.</p><small data-geo-position>Виртуальный игрок · WGS84</small></div><aside class="geo-map card"><div class="geo-map-head"><b>Карта района</b><select aria-label="Источник карты"><option value="osm-tiles">OpenStreetMap · онлайн</option><option value="osm-local">Схема OSM · без сети</option><option value="2gis">2ГИС · ключ</option><option value="google">Google Maps · ключ</option><option value="yandex">Яндекс Карты · ключ</option></select><button data-geo-key aria-label="Ввести ключ API карты" title="Ключ API карты">🔑</button><button data-geo-map-toggle aria-label="Свернуть карту">−</button></div><div class="geo-map-body"></div><div class="geo-map-status"></div></aside><div class="geo-pad"><button data-geo-move="0,-1" aria-label="Идти вперёд">▲</button><button data-geo-move="-1,0" aria-label="Идти влево">◀</button><button data-geo-move="0,1" aria-label="Идти назад">▼</button><button data-geo-move="1,0" aria-label="Идти вправо">▶</button></div><div class="geo-hint">WASD — идти · Shift — бег · мышь — камера · колесо — обзор</div>`;
  document.body.append(shell);const find=s=>shell.querySelector(s);
  let viewer,map,closed=false,mapVersion=0,config={},position=null;
  const exit=()=>{if(closed)return;closed=true;mapVersion++;map?.destroy();viewer?.dispose();shell.remove();onExit()};
  find('[data-geo-exit]').onclick=exit;
  find('[data-geo-map-toggle]').onclick=()=>{const collapsed=shell.classList.toggle('geo-map-collapsed');find('[data-geo-map-toggle]').textContent=collapsed?'+':'−';find('[data-geo-map-toggle]').setAttribute('aria-label',collapsed?'Развернуть карту':'Свернуть карту');if(!collapsed)setTimeout(()=>map?.invalidate?.(),60)};
  try {
    const json=async path=>{const r=await fetch(path);if(!r.ok)throw new Error('Не удалось загрузить район');return r.json()};
    const [origin,collection]=await Promise.all([json('geo/origin.json'),json('geo/arbat.geojson')]);
    try{const r=await fetch('geo/provider-config.json');if(r.ok)config=await r.json()}catch{}
    if(closed)return {close:exit};
    const keyFor=provider=>storedMapKeys()[provider]||({'2gis':config.twoGis?.apiKey,google:config.google?.apiKey,yandex:config.yandex?.apiKey})[provider]||'';
    let currentProvider=navigator.onLine===false?'osm-local':'osm-tiles';
    const askKey=()=>{const provider=find('select').value;if(!['2gis','google','yandex'].includes(provider)){alert('Ключ нужен только для 2ГИС, Google Maps и Яндекс Карт. Выбери один из них в списке.');return}const entered=prompt(`Ключ API для ${PROVIDER_NAMES[provider]} (хранится только в этом браузере):`,keyFor(provider));if(entered===null)return;storeMapKey(provider,entered.trim());renderMap(provider)};
    find('[data-geo-key]').onclick=askKey;
    const renderMap=async provider=>{
      currentProvider=provider;const generation=++mapVersion;map?.destroy();map=null;find('.geo-map-body').replaceChildren();
      const name=PROVIDER_NAMES[provider]||provider;find('.geo-map-status').textContent=provider==='osm-local'?'© OpenStreetMap contributors · ODbL':provider==='osm-tiles'?'© OpenStreetMap contributors · онлайн-тайлы, только для демо':`Проверяем настройку ${name}…`;
      try{const candidate=await createMapAdapter(provider,find('.geo-map-body'),{origin:origin.wgs84,bbox:origin.bbox,collection,apiKey:keyFor(provider),player:position,onConfigure:askKey,onStatus:status=>{if(closed||generation!==mapVersion)return;find('.geo-map-status').textContent=({ready:`${name} подключены`,loading:`${name} загружаются…`,'needs-key':`${name} · нужен ключ, нажми 🔑`,error:`Ошибка ${name} · выбери OpenStreetMap`,unverified:`Загрузка ${name} не подтверждена`})[status.state]||status.state}});if(closed||generation!==mapVersion){candidate.destroy();return}map=candidate;if(position)map.setPlayerWGS84(position);if(provider==='osm-tiles')map.fit()}catch(error){if(!closed&&generation===mapVersion){find('.geo-map-status').textContent=error.message;find('.geo-map-body').textContent='Выбери OpenStreetMap или схему OSM, чтобы продолжить без внешнего сервиса.'}}
    };
    find('select').value=currentProvider;find('select').onchange=e=>renderMap(e.target.value);
    if(innerWidth<700){shell.classList.add('geo-map-collapsed');find('[data-geo-map-toggle]').textContent='+';find('[data-geo-map-toggle]').setAttribute('aria-label','Развернуть карту');}
    viewer=new GeoWorld(find('canvas'),{onExit:exit,onProgress:text=>{if(!closed&&!shell.dataset.loaded)find('[data-geo-status]').textContent=text},onPosition:p=>{if(closed)return;position=p;map?.setPlayerWGS84(p);find('[data-geo-position]').textContent=`Игрок: ${p.lat.toFixed(6)}° N, ${p.lon.toFixed(6)}° E`;shell.dataset.playerX=p.x.toFixed(3);shell.dataset.playerZ=p.z.toFixed(3)},onReady:stats=>{find('[data-geo-status]').textContent=`Арбат · ${stats.buildings} зданий · 1 × 0,5 км`;shell.dataset.loaded='true'}});
    await Promise.all([viewer.load('geo/district-local.json'),renderMap(currentProvider),loadHero().then(hero=>{if(closed)hero.dispose();else{hero.root.scale.setScalar(1.8/3.2);viewer.setHero(hero)}}).catch(error=>{console.warn('Geo hero unavailable; local avatar is active.',error)})]);
    if(closed)return {close:exit};
    for(const button of shell.querySelectorAll('[data-geo-move]')){
      button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);const [x,z]=button.dataset.geoMove.split(',').map(Number);viewer.setInput({x,z})};
      const stop=()=>viewer.setInput({x:0,z:0});button.onpointerup=stop;button.onpointercancel=stop;
    }
    find('canvas').focus();
  }catch(error){if(!closed){find('[data-geo-status]').textContent=error.message;shell.dataset.error='true';console.error('Geography load failed',error)}}
  return {close:exit};
}
