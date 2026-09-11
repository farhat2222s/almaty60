const PRESETS={
 day:{sky:'#4f92d0',horizon:'#d9e8ed',fog:'#c3d9e1',sun:'#fff0d5',sunPower:3.0,hemi:1.85,exposure:1.03,fogNear:135,fogFar:760,sunX:-85,sunY:135,sunZ:70,wet:0,lamps:.1,backdrop:'#ffffff'},
 sunset:{sky:'#667da7',horizon:'#efbd96',fog:'#c5adb0',sun:'#ffbb72',sunPower:3.1,hemi:1.08,exposure:1.02,fogNear:105,fogFar:660,sunX:-125,sunY:42,sunZ:45,wet:0,lamps:.65,backdrop:'#e3bd9e'},
 night:{sky:'#07162e',horizon:'#1b354a',fog:'#172c40',sun:'#98c9ff',sunPower:.45,hemi:.52,exposure:1.05,fogNear:90,fogFar:420,sunX:-70,sunY:125,sunZ:-60,wet:0,lamps:1.75,backdrop:'#30445d'},
 rain:{sky:'#5e788f',horizon:'#a8b8c0',fog:'#8ea8b9',sun:'#d4e6f1',sunPower:.85,hemi:1.3,exposure:.93,fogNear:60,fogFar:340,sunX:-75,sunY:115,sunZ:60,wet:1,lamps:.65,backdrop:'#8a9ca5'}
};
export class CityAtmosphere {
 constructor(THREE,world){
  this.THREE=THREE;this.world=world;this.mode='day';this.target=PRESETS.day;this.wet=0;this.lights=[];
  const positions=new Float32Array(1700*6);this.drops=[];
  for(let i=0;i<1700;i++)this.drops.push({x:Math.sin(i*42.31)*43,z:Math.cos(i*91.13)*43,y:(i*.137)%31,speed:20+(i%7)*1.9});
  this.rainGeometry=new THREE.BufferGeometry();this.rainGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  this.rain=new THREE.LineSegments(this.rainGeometry,new THREE.LineBasicMaterial({color:'#c8e4ed',transparent:true,opacity:0,depthWrite:false}));this.rain.frustumCulled=false;world.scene.add(this.rain);
  for(let i=0;i<4;i++){const light=new THREE.PointLight('#ffd4a2',0,24,2);world.scene.add(light);this.lights.push(light)}
  this.wetMaterials=[...world.materials.values()].filter(m=>m.userData.surface==='asphalt'||m.userData.surface==='paving');
  this.wetMaterials.forEach(m=>m.userData.dryRoughness=m.roughness);
  this.emissiveMaterials=[...world.materials.values()].filter(m=>m.emissive&&m.emissive.getHex()!==0);
  this.emissiveMaterials.forEach(m=>m.userData.dayEmission=m.emissiveIntensity);
  this.sunPosition=new THREE.Vector3(-85,135,70);
 }
 set(mode){if(!PRESETS[mode])return false;this.mode=mode;this.target=PRESETS[mode];this.world.canvas.dataset.atmosphere=mode;return true}
 update(dt,time,position){
  const {THREE,world}=this,p=this.target,k=1-Math.exp(-dt*.8);
  const blend=(color,value)=>color.lerp(new THREE.Color(value),k);
  blend(world.sky.material.uniforms.top.value,p.sky);blend(world.sky.material.uniforms.bottom.value,p.horizon);blend(world.scene.fog.color,p.fog);blend(world.sun.color,p.sun);
  world.sun.intensity+=(p.sunPower-world.sun.intensity)*k;world.hemi.intensity+=(p.hemi-world.hemi.intensity)*k;
  world.renderer.toneMappingExposure+=(p.exposure-world.renderer.toneMappingExposure)*k;
  world.scene.fog.near+=(p.fogNear-world.scene.fog.near)*k;world.scene.fog.far+=(p.fogFar-world.scene.fog.far)*k;
  this.sunPosition.lerp(new THREE.Vector3(p.sunX,p.sunY,p.sunZ),k);world.sun.position.copy(this.sunPosition).add(new THREE.Vector3(position.x,0,position.z));world.sun.target.position.set(position.x,0,position.z);
  if(world.backdrop)blend(world.backdrop.material.color,p.backdrop);
  this.wet+=(p.wet-this.wet)*k;
  for(const m of this.wetMaterials){m.roughness=m.userData.dryRoughness*(1-this.wet)+.14*this.wet;m.envMapIntensity=.5+this.wet*.9;}
  for(const m of this.emissiveMaterials)m.emissiveIntensity=m.userData.dayEmission*(.6+p.lamps*2);
  this.lights.forEach((light,i)=>{const lane=Math.round(position.x/64)*64;light.position.set(lane+(i%2?-8.5:8.5),5.6,Math.round(position.z/25)*25+(i<2?-12:13));light.intensity+=(p.lamps*28-light.intensity)*k;});
  this.rain.visible=this.wet>.02;this.rain.material.opacity=this.wet*.36;
  if(this.rain.visible){
   const array=this.rainGeometry.attributes.position.array;
   this.drops.forEach((drop,i)=>{drop.y-=dt*drop.speed;if(drop.y<0)drop.y+=31;const at=i*6,x=drop.x+position.x,z=drop.z+position.z;array[at]=x;array[at+1]=drop.y;array[at+2]=z;array[at+3]=x-.28;array[at+4]=drop.y+1.0;array[at+5]=z+.1;});
   this.rainGeometry.attributes.position.needsUpdate=true;
  }
 }
 dispose(){this.rainGeometry.dispose();this.rain.material.dispose();this.world.scene.remove(this.rain);for(const light of this.lights)this.world.scene.remove(light)}
}
