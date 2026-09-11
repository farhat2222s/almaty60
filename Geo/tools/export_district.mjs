import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {projectGeoJSON,validateBBox,pointInBBox} from '../../Playable/public/geo/georef.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),publicDir=path.resolve(base,'../Playable/public/geo');
const input=process.argv[2]||path.join(base,'exports/arbat.geojson'),metadataFile=process.argv[3]||path.join(base,'exports/source-metadata.json');
const raw=fs.readFileSync(input,'utf8'),collection=JSON.parse(raw),metadata=JSON.parse(fs.readFileSync(metadataFile,'utf8')),origin=JSON.parse(fs.readFileSync(path.join(base,'origin.json'),'utf8'));
const sourceHash=createHash('sha256').update(fs.readFileSync(path.join(base,'source/arbat-osm.xml'))).digest('hex');
if(metadata.source?.rawSha256!==sourceHash)throw new Error('Metadata does not match the preserved OSM source');
validateBBox(origin.bbox);
if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features)||collection.features.length>20000)throw new Error('Invalid or excessive FeatureCollection');
const kinds=new Set(['road','building','poi','plaza','green']);
const ids=new Set();let vertices=0;
function verifyCoordinates(c){
  if(!Array.isArray(c))throw new Error('Invalid coordinate nesting');
  if(typeof c[0]==='number'){if(!pointInBBox({lon:c[0],lat:c[1],alt:c[2]??0},origin.bbox))throw new Error('Feature exceeds district bbox');if(++vertices>200000)throw new Error('District too complex');}
  else c.forEach(verifyCoordinates);
}
for(const f of collection.features){if(!f.id||ids.has(f.id)||!kinds.has(f.properties?.kind)||f.properties?.source!=='OpenStreetMap')throw new Error('Invalid feature ID/kind/provenance');ids.add(f.id);if(!['Point','LineString','MultiLineString','Polygon'].includes(f.geometry?.type))throw new Error('Unsupported geometry');verifyCoordinates(f.geometry.coordinates);}
collection.attribution='© OpenStreetMap contributors';collection.license='ODbL-1.0';
const local=projectGeoJSON(collection,origin.wgs84);local.source=metadata.source;local.counts=metadata.counts;local.requestedBBox=origin.bbox;local.sourceGeoJSONSha256=createHash('sha256').update(raw).digest('hex');
let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
function extent(c){if(typeof c[0]==='number'){minX=Math.min(minX,c[0]);maxX=Math.max(maxX,c[0]);minZ=Math.min(minZ,c[1]);maxZ=Math.max(maxZ,c[1]);}else c.forEach(extent);}
local.features.forEach(f=>extent(f.geometry.coordinates));local.bounds={minX,maxX,minZ,maxZ};
function parts(f){const {type,coordinates:c}=f.geometry;return type==='Point'?[[c]]:type==='LineString'?[c]:c;}
const rows=local.features.map(f=>({Name:f.id.replace(/[^A-Za-z0-9_]/g,'_'),SourceId:f.id,Kind:f.properties.kind,DisplayName:f.properties.name||'',GeometryType:f.geometry.type,HeightCm:Number(f.properties.heightMeters||0)*100,HeightEstimated:Boolean(f.properties.heightEstimated),HeightSource:f.properties.heightSource||'',SourceUrl:f.properties.sourceUrl||'',SourceLicense:'ODbL-1.0',SourcePropertiesJson:JSON.stringify(f.properties),Rings:parts(f).map(ring=>({Vertices:ring.map(([x,z,y])=>({X:x*100,Y:z*100,Z:y*100}))}))}));
const flat=[];for(const row of rows)row.Rings.forEach((ring,part)=>ring.Vertices.forEach((p,i)=>flat.push({Name:`${row.Name}_${part}_${i}`,FeatureId:row.SourceId,Kind:row.Kind,Part:part,Vertex:i,X:p.X,Y:p.Y,Z:p.Z})));
const stringify=value=>JSON.stringify(value,null,2)+'\n';fs.mkdirSync(publicDir,{recursive:true});
fs.writeFileSync(path.join(base,'exports/district-local.json'),stringify(local));fs.writeFileSync(path.join(publicDir,'district-local.json'),stringify(local));
fs.writeFileSync(path.join(publicDir,'arbat.geojson'),stringify(collection));fs.writeFileSync(path.join(publicDir,'source-metadata.json'),stringify(metadata));fs.writeFileSync(path.join(publicDir,'origin.json'),stringify(origin));
fs.writeFileSync(path.join(base,'exports/ue-datatable.json'),stringify(rows));
const columns=['Name','FeatureId','Kind','Part','Vertex','X','Y','Z'],csv=columns.join(',')+'\n'+flat.map(r=>columns.map(k=>JSON.stringify(r[k])).join(',')).join('\n')+'\n';fs.writeFileSync(path.join(base,'exports/ue-vertices.csv'),csv);
console.log(JSON.stringify({features:rows.length,vertices,bounds:local.bounds,counts:local.counts,origin:origin.wgs84,sourceSha256:metadata.source?.rawSha256},null,2));
