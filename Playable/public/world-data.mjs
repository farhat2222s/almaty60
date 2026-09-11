export const WORLD_LIMIT = 112;
export const SPAWN = {x:0,z:18};
export const LANDMARKS = [
 {id:'arbat',name:'Арбат',x:0,z:-64,color:'#45e3dd',description:'Пешеходная улица и уличная музыка.'},
 {id:'park',name:'Парк Панфилова',x:-64,z:-64,color:'#80da8b',description:'Тихие аллеи под тянь-шаньскими елями.'},
 {id:'cathedral',name:'Вознесенский собор',x:-64,z:0,color:'#ffd334',description:'Золотые купола среди зелени.'},
 {id:'bazaar',name:'Зелёный базар',x:64,z:-64,color:'#4edfc5',description:'Вкус города и яркие торговые ряды.'},
 {id:'opera',name:'Театр оперы',x:64,z:0,color:'#fcaf88',description:'Вечерние огни и городская сцена.'},
 {id:'republic',name:'Площадь Республики',x:64,z:64,color:'#a6b5ff',description:'Просторная площадь с видом на горы.'}
];
export const BRANDS=[
 {id:'aporta',name:'APORTA',category:'Городская кофейня',symbol:'A',color:'#ffcb30',x:0,z:0},
 {id:'steppe',name:'STEPPE',category:'Движение и спорт',symbol:'S',color:'#45ded6',x:0,z:-64},
 {id:'alma',name:'ALMA',category:'Вкус города',symbol:'a',color:'#ff857a',x:64,z:-64},
 {id:'nomad',name:'NOMAD',category:'Городские маршруты',symbol:'N',color:'#a99bff',x:64,z:64},
 {id:'sary',name:'SARY',category:'Музыка и культура',symbol:'♪',color:'#f8b962',x:-64,z:0}
];
export const NPCS=[
 {id:'aida',name:'Аида',role:'Городской проводник',x:-9,z:16,color:'#45ded6'},
 {id:'timur',name:'Тимур',role:'Курьер на колёсах',x:12,z:-64,color:'#ffcb30'},
 {id:'dana',name:'Дана',role:'Хранительница историй',x:60,z:15,color:'#a99bff'}
];
export const COLLECTIBLES=Array.from({length:18},(_,i)=>({id:'alma-'+i,x:[0,-64,64][i%3]+(i%2?5:-5),z:-98+Math.floor(i/3)*36}));
export const BUILDINGS=[];
for(const x of [-94,-32,32,94])for(const z of [-94,-32,32,94]){
 if((x===-94&&z===-94)||(x===-32&&z===-94))continue;
 BUILDINGS.push({x,z,w:25,d:24,h:10+((Math.abs(x+z)*7)%26),color:['#e6d7b5','#9baebc','#d4b995','#adc7ce'][(Math.abs(x+z)/2)%4|0]});
}
export function canWalk(x,z){return Math.abs(x)<WORLD_LIMIT&&Math.abs(z)<WORLD_LIMIT&&!BUILDINGS.some(b=>Math.abs(x-b.x)<b.w/2+1.2&&Math.abs(z-b.z)<b.d/2+1.2)}
// Drivable cars. Positions persist in the save; `model` indexes the Kenney model list on the client.
export const CARS=[[-5.6,-82,Math.PI,0,'#9ebfc6'],[5.6,52,0,1,'#be9569'],[-5.6,90,Math.PI,2,'#d0cbb3'],[58.4,-29,Math.PI,3,'#244a69'],[69.6,24,0,4,'#c9c0aa'],[58.4,30,Math.PI,5,'#e8c24a'],[-69.6,52,0,6,'#d0cbb3'],[-58.4,-20,Math.PI,7,'#9ebfc6'],[30,-69.6,Math.PI/2,1,'#a7b2b8'],[-30,5.6,-Math.PI/2,2,'#c6a27d'],[30,58.4,Math.PI/2,3,'#5a7d95'],[-36,-58.4,-Math.PI/2,5,'#e8c24a']].map(([x,z,heading,model,color],i)=>({id:'car-'+i,x,z,heading,model,color}));
export const CAR_ENTER_RADIUS=7;
export const SPEEDS={walk:14,sprint:22,scooter:36,drive:48,boost:64};
export const TYPE_LABELS={collect:'Сбор',checkpoint:'Маршрут',delivery:'Доставка',reaction:'Реакция'};
export const INITIAL_MISSIONS=BRANDS.flatMap((b,bi)=>['collect','checkpoint','delivery','reaction'].map((type,i)=>({
 id:`${b.id}-${type}`,brandId:b.id,title:[['Кофейный маршрут','Ритм Арбата','Яблочный сбор','След кочевника','Ноты города'][bi],['Пять поворотов','Темп улиц','Тропами базара','Площадь на скорости','Культурный круг'][bi],['Заказ к фонтану','Эстафета STEPPE','Доставка корзины','Письмо путешественника','Билет в театр'][bi],['Поймай момент','Быстрая реакция','Сочный ритм','Ритм степи','Попади в ноту'][bi]][i],
 type,duration:60,difficulty:i===1?'Medium':'Easy',xp:100+i*30,coins:50+i*15,rewardLabel:['Демо-кофе','Демо-бонус 15%','Демо-набор яблок','Демо-сувенир','Демо-билет'][bi],
 start:{x:b.x,z:b.z},targets:type==='reaction'?[]:type==='delivery'?[{x:b.x+10,z:b.z},{x:b.x+10,z:b.z+22},{x:b.x,z:b.z+38}]:Array.from({length:type==='collect'?5:5},(_,k)=>({x:b.x+(type==='collect'?(k%2?7:-7):0),z:b.z+10+k*7})),
 campaignId:`campaign-${b.id}`,active:true,mode:'virtual',maxRewards:500
})));
