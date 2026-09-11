import test from 'node:test';
import assert from 'node:assert/strict';
import {providerConfigurationState,create2GISMap} from '../../Playable/public/geo/map-adapters.mjs';
test('2GIS is explicitly unavailable without a supplied key; OSM needs no network key',()=>{
  assert.deepEqual(providerConfigurationState('2gis'),{state:'needs-key',requiresKey:true});
  assert.equal(providerConfigurationState('2gis',{apiKey:'demo-public-key-configured'}).state,'configured');
  assert.deepEqual(providerConfigurationState('osm-local'),{state:'ready',requiresKey:false});assert.equal(providerConfigurationState('unknown').state,'unsupported');
});
test('no-key 2GIS setup state creates no script or tile request and does not pretend to be connected',async()=>{
  const old=globalThis.document,created=[];
  globalThis.document={createElement(tag){created.push(tag);return {tag,style:{},children:[],append(...nodes){this.children.push(...nodes);},remove(){}};}};
  try{const container={replaceChildren(card){this.card=card;}},statuses=[];const adapter=await create2GISMap(container,{onStatus:s=>statuses.push(s)});assert.equal(adapter.state,'needs-key');assert.ok(!created.includes('script'));assert.match(container.card.children[0].textContent,/не подключён/);assert.equal(statuses[0].state,'needs-key');adapter.destroy();}
  finally{globalThis.document=old;}
});
