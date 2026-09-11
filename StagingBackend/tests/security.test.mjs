import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {hashPassword,verifyPassword,opaque,digest,cipher,canonical,email,password,idempotencyKey,requireRole,requireBrand,uuid} from '../src/security.mjs';

test('scrypt verifies only the right password and uses a fresh salt',async()=>{
  const first=await hashPassword('a-good-staging-password-123'),second=await hashPassword('a-good-staging-password-123');
  assert.notEqual(first,second);assert.equal(await verifyPassword('a-good-staging-password-123',first),true);
  assert.equal(await verifyPassword('wrong-password',first),false);assert.equal(await verifyPassword('x'.repeat(300),first),false);
});
test('session tokens have 256 bits of entropy and hashes do not contain tokens',()=>{
  const tokens=new Set(Array.from({length:1000},opaque));assert.equal(tokens.size,1000);for(const token of tokens){assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.equal(digest(token).length,64);assert.ok(!digest(token).includes(token));}
});
test('AES-GCM protects persisted reward and retry payloads, rejects tampering and other keys',()=>{
  const c=cipher(randomBytes(32).toString('hex')),payload={code:`AL60S_${opaque()}`,playerId:'test'},encrypted=c.encrypt(payload);
  assert.deepEqual(c.decrypt(encrypted),payload);assert.ok(!encrypted.includes(payload.code));
  const damaged=Buffer.from(encrypted,'base64url');damaged[30]^=1;assert.throws(()=>c.decrypt(damaged.toString('base64url')));
  assert.throws(()=>cipher(randomBytes(32).toString('hex')).decrypt(encrypted));assert.throws(()=>cipher('default-secret'));
});
test('request validation, canonical idempotency hashes and explicit role boundaries',()=>{
  assert.equal(email(' Player@Example.COM '),'player@example.com');assert.throws(()=>email('bad'));assert.throws(()=>password('short'));
  assert.equal(canonical({z:2,a:{b:1,a:2}}),canonical({a:{a:2,b:1},z:2}));assert.throws(()=>idempotencyKey('short'));
  assert.throws(()=>uuid('any-string'));assert.throws(()=>requireRole({role:'player'},'admin'));assert.throws(()=>requireBrand({role:'staff',brand_id:'a'},'b'));
  assert.doesNotThrow(()=>requireBrand({role:'admin'},'b'));assert.doesNotThrow(()=>requireRole({role:'staff'},'staff','admin'));
});
