import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export class ApiError extends Error{constructor(status,code,message=code){super(message);this.status=status;this.code=code;}}
export const fail=(status,code,message)=>{throw new ApiError(status,code,message);};
export function text(value,name,max=100){if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(400,'INVALID_INPUT',`Invalid ${name}`);return value.trim();}
export function email(value){const result=text(value,'email',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))fail(400,'INVALID_INPUT','Invalid email');return result;}
export function password(value){if(typeof value!=='string'||value.length<12||Buffer.byteLength(value)>256)fail(400,'INVALID_INPUT','Password must be 12–256 bytes');return value;}
export function number(value,name,min,max){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(400,'INVALID_INPUT',`Invalid ${name}`);return value;}
export function uuid(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail(400,'INVALID_ID');return value;}
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const opaque=()=>randomBytes(32).toString('base64url');
export async function hashPassword(value){const salt=randomBytes(16).toString('hex'),derived=await scrypt(password(value),salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return `scrypt$32768$8$1$${salt}$${derived.toString('hex')}`;}
export async function verifyPassword(value,stored){
  if(typeof value!=='string'||Buffer.byteLength(value)>256)return false;
  const parts=stored.split('$');if(parts.length!==6||parts[0]!=='scrypt'||parts[1]!=='32768'||parts[2]!=='8'||parts[3]!=='1')return false;
  const expected=Buffer.from(parts[5],'hex');if(expected.length!==64)return false;
  const actual=await scrypt(value,parts[4],64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return timingSafeEqual(actual,expected);
}
export function cipher(secret){
  if(!/^[a-f0-9]{64}$/i.test(secret||''))throw new Error('TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters');
  const key=Buffer.from(secret,'hex');
  return {
    encrypt(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64url');},
    decrypt(value){const bytes=Buffer.from(value,'base64url');if(bytes.length<29)throw new Error('Invalid ciphertext');const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString());}
  };
}
export function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')}}`;return JSON.stringify(value);}
export function idempotencyKey(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(value))fail(400,'IDEMPOTENCY_KEY_REQUIRED','Supply a unique 16–128 character Idempotency-Key and reuse it for retries');return value;}
export function publicUser(user){return {id:user.id,email:user.email,name:user.name,role:user.role,brandId:user.brand_id};}
export function requireRole(user,...roles){if(!roles.includes(user.role))fail(403,'FORBIDDEN');}
export function requireBrand(user,brandId){if(user.role!=='admin'&&user.brand_id!==brandId)fail(403,'BRAND_FORBIDDEN');}
