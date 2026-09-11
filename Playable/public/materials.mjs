// Local surface textures use world coordinates, so a 200 m road never stretches one tile.
export function createSurfaceLibrary(THREE, renderer) {
  const textures=new Map(),materials=new Set();let disposed=false;
  let seed=7621;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
  function texture(kind) {
    if(textures.has(kind))return textures.get(kind);
    const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');
    const fill=kind==='asphalt'?142:kind==='foliage'?205:kind==='wood'?180:222;
    g.fillStyle=`rgb(${fill},${fill},${fill})`;g.fillRect(0,0,512,512);
    const pixels=g.getImageData(0,0,512,512);
    for(let i=0;i<pixels.data.length;i+=4){const value=fill+(random()-.5)*(kind==='asphalt'?57:kind==='foliage'?65:25);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;pixels.data[i+3]=255}g.putImageData(pixels,0,0);
    if(kind==='paving'||kind==='stone') {
      const bw=kind==='paving'?128:256,bh=kind==='paving'?64:128;
      for(let row=0;row<512/bh;row++)for(let col=-1;col<512/bw+1;col++) {
        const x=col*bw+(row%2)*bw/2,y=row*bh,tone=214+random()*28;
        g.fillStyle=`rgba(${tone},${tone},${tone},.24)`;g.fillRect(x+2,y+2,bw-4,bh-4);
        g.strokeStyle='rgba(60,68,73,.4)';g.lineWidth=2;g.strokeRect(x+1,y+1,bw-2,bh-2);
        g.strokeStyle='rgba(255,255,255,.55)';g.lineWidth=1;g.beginPath();g.moveTo(x+3,y+bh-3);g.lineTo(x+3,y+3);g.lineTo(x+bw-3,y+3);g.stroke();
      }
    }
    if(kind==='asphalt')for(let i=0;i<6500;i++){const x=random()*512,y=random()*512;g.fillStyle=random()>.5?'#c7c8c4':'#646a6a';g.globalAlpha=.13;g.fillRect(x,y,random()*1.4+.4,random()*1.3+.4)}
    if(kind==='wood')for(let i=0;i<220;i++){g.strokeStyle=`rgba(75,64,52,${random()*.18})`;g.beginPath();g.moveTo(random()*512,0);g.bezierCurveTo(random()*512,150,random()*512,350,random()*512,512);g.stroke()}
    if(kind==='foliage')for(let i=0;i<1800;i++){g.fillStyle=random()>.5?'rgba(255,255,230,.22)':'rgba(25,43,25,.32)';g.beginPath();g.ellipse(random()*512,random()*512,2+random()*5,1+random()*3,random()*6.28,0,6.28);g.fill()}
    g.globalAlpha=1;
    const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.set(kind,t);
    if(kind==='paving')new THREE.TextureLoader().load(new URL('./assets/visual-v3/arbat-paving-albedo-v3.png',import.meta.url).href,loaded=>{if(disposed){loaded.dispose();return;}
      // The GPU copy was allocated at 512×512 (texStorage2D); release it so the larger bitmap is re-uploaded instead of hitting glTexSubImage2D 'offset overflows'.
      t.dispose();t.image=loaded.image;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1,1);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());t.needsUpdate=true;loaded.dispose();},undefined,()=>{});
    return t;
  }
  function apply(material,kind) {
    const surface=texture(kind),density={asphalt:.33,paving:.32,stone:.16,wood:.8,foliage:1.0}[kind]||.35;
    material.onBeforeCompile=shader=>{
      shader.uniforms.almatySurface={value:surface};shader.uniforms.almatyDensity={value:density};
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 almatyPosition;varying vec3 almatyNormal;');
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
        vec4 almatyVertex=vec4(transformed,1.0);
        vec3 almatyLocalNormal=objectNormal;
        #ifdef USE_INSTANCING
          almatyVertex=instanceMatrix*almatyVertex;
          almatyLocalNormal=mat3(instanceMatrix)*almatyLocalNormal;
        #endif
        almatyPosition=(modelMatrix*almatyVertex).xyz;
        almatyNormal=abs(normalize(mat3(modelMatrix)*almatyLocalNormal));`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D almatySurface;uniform float almatyDensity;varying vec3 almatyPosition;varying vec3 almatyNormal;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
        vec2 almatyUV=almatyNormal.y>.55?almatyPosition.xz:(almatyNormal.x>.55?almatyPosition.zy:almatyPosition.xy);
        vec3 almatyTexel=texture2D(almatySurface,almatyUV*almatyDensity).rgb;
        diffuseColor.rgb*=mix(vec3(.64),vec3(1.2),almatyTexel);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor*(.82+almatyTexel.g*.25),.035,1.0);');
    };
    material.customProgramCacheKey=()=>`almaty-surface-${kind}`;material.needsUpdate=true;materials.add(material);return material;
  }
  return {apply,dispose(){disposed=true;for(const t of textures.values())t.dispose();textures.clear();materials.clear()}};
}
