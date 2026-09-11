// World access shared by game rules and renderers. The world is built once from geo/city-local.json
// (see world-builder.mjs); the server does it at startup, the browser after fetching the dataset.
export {TYPE_LABELS,SPEEDS,CAR_ENTER_RADIUS,WORLD_VERSION} from './world-builder.mjs';
export let WORLD=null;
export function setWorld(world){WORLD=world;return world;}
export function canWalk(x,z){return WORLD?WORLD.canWalk(x,z):false;}
