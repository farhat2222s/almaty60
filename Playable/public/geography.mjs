import {GeoWorld} from './geo-world.mjs';
import {loadHero} from './hero.mjs';
import {createMapAdapter} from './geo/map-adapters.mjs';

export async function openGeography({onExit=()=>{}}={}) {
  const shell=document.createElement('section');shell.className='geo-experience';shell.setAttribute('aria-label','Арбат · реальная география');
  shell.innerHTML=`<canvas class="geo-scene" aria-label="Трёхмерный Арбат по реальным контурам OSM"></canvas><header class="geo-toolbar"><div><small>АЛМАТЫ · РЕАЛЬНЫЙ РАЙОН</small><h1>Прогулка по Арбату</h1></div><button class="ghost" data-geo-exit>← В игру</button></header><div class="geo-caption card"><b data-geo-status>Загружаем район…</b><p>Реальные улицы и контуры. Фасады и часть высот — игровые модели.</p><small data-geo-position>Виртуальный игрок · WGS84</small></div><aside class="geo-map card"><div class="geo-map-head"><b>Карта района</b><select aria-label="Источник карты"><option value="osm-local">OSM · без ключа</option><option value="2gis">2ГИС</option></select><button data-geo-map-toggle aria-label="Свернуть карту">−</button></div><div class="geo-map-body"></div><div class="geo-map-status"></div></aside><div class="geo-pad"><button data-geo-move="0,-1" aria-label="Идти вперёд">▲</button><button data-geo-move="-1,0" aria-label="Идти влево">◀</button><button data-geo-move="0,1" aria-label="Идти назад">▼</button><button data-geo-move="1,0" aria-label="Идти вправо">▶</button></div><div class="geo-hint">WASD — идти · Shift — бег · мышь — камера · колесо — обзор</div>`;
  document.body.append(shell);const find=s=>shell.querySelector(s);
  let viewer,map,closed=false,mapVersion=0,config={},position=null;
  const exit=()=>{if(closed)return;closed=true;mapVersion++;map?.destroy();viewer?.dispose();shell.remove();onExit()};
  find('[data-geo-exit]').onclick=exit;
  find('[data-geo-map-toggle]').onclick=()=>{const collapsed=shell.classList.toggle('geo-map-collapsed');find('[data-geo-map-toggle]').textContent=collapsed?'+':'−';find('[data-geo-map-toggle]').setAttribute('aria-label',collapsed?'Развернуть карту':'Свернуть карту')};
  try {
    const json=async path=>{const r=await fetch(path);if(!r.ok)throw new Error('Не удалось загрузить район');return r.json()};
    const [origin,collection]=await Promise.all([json('geo/origin.json'),json('geo/arbat.geojson')]);
    try{const r=await fetch('geo/provider-config.json');if(r.ok)config=await r.json()}catch{}
    if(closed)return {close:exit};
    const renderMap=async provider=>{
      const generation=++mapVersion;map?.destroy();map=null;find('.geo-map-body').replaceChildren();find('.geo-map-status').textContent=provider==='osm-local'?'© OpenStreetMap contributors · ODbL':'Проверяем настройку 2ГИС…';
      try{const candidate=await createMapAdapter(provider,find('.geo-map-body'),{origin:origin.wgs84,bbox:origin.bbox,collection,apiKey:config.twoGis?.apiKey||'',player:position,onStatus:status=>{if(closed||generation!==mapVersion)return;find('.geo-map-status').textContent=({ready:'2ГИС подключена',loading:'2ГИС загружается…','needs-key':'2ГИС ещё не подключена · нужен ключ',error:'Ошибка 2ГИС · выбери карту OSM',unverified:'Загрузка 2ГИС не подтверждена'})[status.state]||status.state}});if(closed||generation!==mapVersion){candidate.destroy();return}map=candidate;if(position)map.setPlayerWGS84(position)}catch(error){if(!closed&&generation===mapVersion){find('.geo-map-status').textContent=error.message;find('.geo-map-body').textContent='Выбери OSM, чтобы продолжить без внешнего сервиса.'}}
    };
    find('select').onchange=e=>renderMap(e.target.value);
    if(innerWidth<700){shell.classList.add('geo-map-collapsed');find('[data-geo-map-toggle]').textContent='+';find('[data-geo-map-toggle]').setAttribute('aria-label','Развернуть карту');}
    viewer=new GeoWorld(find('canvas'),{onExit:exit,onProgress:text=>{if(!closed&&!shell.dataset.loaded)find('[data-geo-status]').textContent=text},onPosition:p=>{if(closed)return;position=p;map?.setPlayerWGS84(p);find('[data-geo-position]').textContent=`Игрок: ${p.lat.toFixed(6)}° N, ${p.lon.toFixed(6)}° E`;shell.dataset.playerX=p.x.toFixed(3);shell.dataset.playerZ=p.z.toFixed(3)},onReady:stats=>{find('[data-geo-status]').textContent=`Арбат · ${stats.buildings} зданий · 1 × 0,5 км`;shell.dataset.loaded='true'}});
    await Promise.all([viewer.load('geo/district-local.json'),renderMap('osm-local'),loadHero().then(hero=>{if(closed)hero.dispose();else{hero.root.scale.setScalar(1.8/3.2);viewer.setHero(hero)}}).catch(error=>{console.warn('Geo hero unavailable; local avatar is active.',error)})]);
    if(closed)return {close:exit};
    for(const button of shell.querySelectorAll('[data-geo-move]')){
      button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);const [x,z]=button.dataset.geoMove.split(',').map(Number);viewer.setInput({x,z})};
      const stop=()=>viewer.setInput({x:0,z:0});button.onpointerup=stop;button.onpointercancel=stop;
    }
    find('canvas').focus();
  }catch(error){if(!closed){find('[data-geo-status]').textContent=error.message;shell.dataset.error='true';console.error('Geography load failed',error)}}
  return {close:exit};
}
