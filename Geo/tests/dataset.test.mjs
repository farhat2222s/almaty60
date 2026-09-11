import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createGeoReference,pointInBBox} from '../../Playable/public/geo/georef.mjs';

const root=new URL('../',import.meta.url);
const read=file=>JSON.parse(fs.readFileSync(new URL(file,root),'utf8'));
const geographic=read('exports/arbat.geojson'),local=read('exports/district-local.json');
const metadata=read('exports/source-metadata.json'),origin=read('origin.json'),rows=read('exports/ue-datatable.json');
const raw=fs.readFileSync(new URL('source/arbat-osm.xml',root));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const vertices=coordinates=>typeof coordinates[0]==='number'?[coordinates]:coordinates.flatMap(vertices);

test('preserved source checksum, retrieval provenance and Arbat origin match actual XML',()=>{
  assert.equal(hash(raw),metadata.source.rawSha256);
  assert.equal(raw.length,metadata.source.rawBytes);
  assert.match(metadata.source.retrievedAtBasis,/modification time/);
  const xml=raw.toString('utf8');
  const node=xml.match(new RegExp(`<node\\b[^>]*\\bid="${origin.osmNodeId}"[^>]*>`))?.[0];
  assert.ok(node,'canonical origin node exists in preserved source');
  assert.equal(Number(node.match(/\blon="([^"]+)"/)[1]),origin.wgs84.lon);
  assert.equal(Number(node.match(/\blat="([^"]+)"/)[1]),origin.wgs84.lat);
  const way=xml.match(new RegExp(`<way\\b[^>]*\\bid="${origin.osmWayId}"[^>]*>[\\s\\S]*?</way>`))?.[0];
  assert.ok(way?.includes(`ref="${origin.osmNodeId}"`),'origin belongs to actual Arbat way');
  assert.match(way,/<tag k="highway" v="pedestrian"/);
  assert.match(way,/<tag k="loc_name" v="Арбат"/);
  assert.equal(metadata.source.license,'ODbL-1.0');
});

test('every imported geographic vertex is within bounds and keeps unique source identity',()=>{
  assert.equal(geographic.features.length,metadata.counts.total);
  assert.equal(geographic.features.length,1268);
  const ids=new Set(),counts={road:0,building:0,poi:0,plaza:0,green:0};let count=0;
  for(const f of geographic.features){
    assert.ok(!ids.has(f.id));ids.add(f.id);counts[f.properties.kind]++;
    assert.equal(f.properties.source,'OpenStreetMap');
    assert.equal(f.properties.sourceUrl,metadata.source.url);
    assert.ok(['node','way'].includes(f.properties.osmType));
    assert.ok(Number.isSafeInteger(f.properties.osmId)&&f.properties.osmId>0);
    for(const p of vertices(f.geometry.coordinates)){
      assert.ok(pointInBBox({lon:p[0],lat:p[1],alt:p[2]??0},origin.bbox),f.id);count++;
    }
  }
  assert.equal(count,4717);
  assert.deepEqual(counts,{road:530,building:165,poi:461,plaza:4,green:108});
  const buildings=geographic.features.filter(f=>f.properties.kind==='building');
  assert.equal(buildings.filter(f=>!f.properties.heightEstimated).length,7);
  assert.equal(buildings.filter(f=>f.properties.heightEstimated).length,158);
  assert.ok(metadata.skipped.relations===130&&metadata.skipped.multipolygonRelations===1);
});

test('all actual district vertices round trip, and UE export uses the same meter coordinates',()=>{
  const ref=createGeoReference(origin.wgs84);
  assert.equal(local.type,'AL60LocalFeatureCollection');
  assert.deepEqual(local.coordinateSystem.origin,origin.wgs84);
  assert.equal(hash(fs.readFileSync(new URL('exports/arbat.geojson',root))),local.sourceGeoJSONSha256);
  assert.equal(rows.length,local.features.length);
  assert.ok(local.bounds.maxX-local.bounds.minX>1000&&local.bounds.maxX-local.bounds.minX<1030);
  assert.ok(local.bounds.maxZ-local.bounds.minZ>490&&local.bounds.maxZ-local.bounds.minZ<510);
  for(let i=0;i<local.features.length;i++){
    const original=geographic.features[i],projected=local.features[i],row=rows[i];
    assert.equal(original.id,projected.id);assert.equal(row.SourceId,projected.id);
    const degreePoints=vertices(original.geometry.coordinates),meterPoints=vertices(projected.geometry.coordinates);
    const uePoints=row.Rings.flatMap(r=>r.Vertices);
    assert.equal(degreePoints.length,meterPoints.length);assert.equal(uePoints.length,meterPoints.length);
    for(let j=0;j<meterPoints.length;j++){
      const [x,z,y]=meterPoints[j],restored=ref.fromLocal({x,z,y}),point=degreePoints[j],ue=uePoints[j];
      assert.ok(Math.abs(restored.lon-point[0])<1e-10&&Math.abs(restored.lat-point[1])<1e-10,original.id);
      assert.ok(Math.abs(restored.alt-(point[2]??0))<1e-5,original.id);
      assert.equal(ue.X,x*100);assert.equal(ue.Y,z*100);assert.equal(ue.Z,y*100);
    }
  }
});

test('served district and UE rows retain source license and complete source properties',()=>{
  const served=JSON.parse(fs.readFileSync(new URL('../Playable/public/geo/district-local.json',root),'utf8'));
  assert.deepEqual(served,local);
  assert.equal(served.license,'ODbL-1.0');assert.equal(served.attribution,'© OpenStreetMap contributors');
  for(let i=0;i<rows.length;i++){
    assert.equal(rows[i].SourceLicense,'ODbL-1.0');
    assert.deepEqual(JSON.parse(rows[i].SourcePropertiesJson),local.features[i].properties);
  }
});
