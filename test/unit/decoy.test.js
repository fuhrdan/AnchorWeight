import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDecoy } from '../../src/decoy.js';

test('decoy HTML is deterministic, inert, and contains no links',()=>{
  const c={secret:'secret'}; const u=new URL('https://example.test/private'); const req={headers:{accept:'text/html'}};
  const a=renderDecoy(c,'key',u,req), b=renderDecoy(c,'key',u,req);
  assert.equal(a.body,b.body); assert.equal(/<a\b/i.test(a.body),false); assert.equal(a.type.startsWith('text/html'),true);
});

test('decoy returns empty JSON result surface for API requests',()=>{
  const d=renderDecoy({secret:'secret'},'key',new URL('https://x/api/items'),{headers:{accept:'application/json'}});
  const body=JSON.parse(d.body); assert.equal(body.status,'ok'); assert.deepEqual(body.results,[]);
});
