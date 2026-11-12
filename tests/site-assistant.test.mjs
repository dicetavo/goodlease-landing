import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { assistantVisibleText, parseAssistantTurn, canApproveAssistantAction } from '../src/scripts/site-assistant.ts';
import { matchWebAppApiRule, authorizationMatchesRule, contentTypeMatchesRule } from '../src/server/webapp-api-policy.ts';

const actionId = '12345678-1234-4234-9234-123456789abc';
const actionPath = 'assistant/conversations/42/actions/' + actionId;
const readPaths = ['assistant/conversations', 'assistant/conversations/42'];
const writePaths = ['assistant/conversations', 'assistant/conversations/42/messages', actionPath];

test('assistant routes are exact, authenticated and never public catalogue payloads', () => {
  for (const [method, paths] of [['GET', readPaths], ['POST', writePaths]]) {
    for (const path of paths) {
      const rule = matchWebAppApiRule(path, method);
      assert.ok(rule, method + ' ' + path);
      assert.equal(rule.requiresBearer, true);
      assert.equal(rule.publicPayload, undefined);
      for (const auth of ['', 'Basic test', 'Bearer', 'Bearer two tokens']) assert.equal(authorizationMatchesRule(rule, auth), false);
      assert.equal(authorizationMatchesRule(rule, 'Bearer fixture-token'), true);
      if (method === 'POST') {
        assert.equal(contentTypeMatchesRule(rule, 'application/json'), true);
        assert.equal(contentTypeMatchesRule(rule, 'text/plain'), false);
      }
    }
  }
  for (const path of ['assistant/cart', 'assistant/event-types', 'assistant/conversations/0', 'assistant/conversations/-1',
    'assistant/conversations/42/stream', 'assistant/conversations/42/messages/stream', 'assistant/conversations/42/actions/not-a-uuid',
    'assistant/conversations/42/actions/' + actionId + '/extra', 'assistant/conversations/42/private', 'admin/ai']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.equal(matchWebAppApiRule(path, method), undefined, method + ' ' + path);
  }
  for (const path of readPaths) assert.equal(matchWebAppApiRule(path, 'DELETE'), undefined);
  assert.equal(matchWebAppApiRule('assistant/conversations/42/messages', 'GET'), undefined);
  assert.equal(matchWebAppApiRule(actionPath, 'GET'), undefined);
});

test('only public user/assistant messages can be displayed; tool calls stay hidden', () => {
  const result = parseAssistantTurn({
    conversationId: 42, status: 'COMPLETED',
    messages: [{role:'system',text:'PRIVATE SYSTEM'}, {role:'tool',text:'PRIVATE TOOL'}, {role:'user',text:'Bonjour'},
      {role:'assistant',text:'Voici <tool_call>{"secret":"PRIVATE"}</tool_call> la réponse.'}],
    profile: {private: 'PRIVATE PROFILE'},
  });
  assert.deepEqual(result.messages.map(m => m.role), ['user', 'assistant']);
  assert.equal('profile' in result, false);
  assert.equal(assistantVisibleText(result.messages[1].text), 'Voici  la réponse.');
  assert.equal(assistantVisibleText('Public <TOOL_CALL>unfinished private'), 'Public');
  assert.throws(() => parseAssistantTurn({conversationId:'42',messages:[]}));
  assert.throws(() => parseAssistantTurn({conversationId:42,messages:'invalid'}));
});

const now = Date.parse('2026-10-15T12:00:00Z');
const preview = {
  action: 'cart_add_item', line: {title:'Micro HF', item:{leaseId:214,quantity:1,startDate:'2026-11-01',endDate:'2026-11-02'},lineTotal:20,deposit:100},
  cart: {items:[],subtotal:20,serviceFee:1,total:21,totalDeposits:100},
};
const action = {actionId, tool:'cart_add_item', expiresAt:'2026-10-15T12:05:00Z', preview};

test('cart proposals require a complete server preview and an unexpired explicit action', () => {
  assert.equal(canApproveAssistantAction(action, now), true);
  for (const change of [
    {tool:'unknown'}, {tool:'__proto__'}, {actionId:'bad'}, {expiresAt:'2026-10-15T11:59:00Z'},
    {preview:{...preview,action:'cart_remove_item'}},
    {preview:{...preview,line:{...preview.line,item:{...preview.line.item,quantity:0}}}},
    {preview:{...preview,line:{...preview.line,item:{...preview.line.item,leaseId:0}}}},
    {preview:{...preview,line:{...preview.line,deposit:undefined}}},
    {preview:{...preview,cart:{...preview.cart,total:NaN}}},
  ]) assert.equal(canApproveAssistantAction({...action,...change}, now), false);
  assert.equal(canApproveAssistantAction({...action,tool:'report_missing_product',preview:{action:'report_missing_product',need:'Une sono'}},now),true);
  assert.equal(canApproveAssistantAction({...action,tool:'report_missing_product',preview:{action:'report_missing_product',need:''}},now),false);
});

const compiled = (await build({ entryPoints:['functions/api/app/[[path]].ts'],bundle:true,write:false,format:'cjs',platform:'browser' })).outputFiles[0].text;
function proxyHarness() {
  const calls = [], module = {exports:{}};
  runInNewContext(compiled, {module,exports:module.exports,Headers,Response,URL,
    fetch:async (url,options) => {calls.push({url,options}); return Response.json({conversationId:42,status:'IDLE',messages:[]});}
  });
  return {calls,handle:(path,options={})=>module.exports.onRequest({
    request:new Request('https://goodlease.fr/api/app/' + path,options),params:{path:path.split('/')},
    env:{GOODLEASE_API_BASE_URL:'https://fixture.example.invalid'},waitUntil(){},
  })};
}
test('real Pages handler forwards only bearer-protected assistant requests, without caching', async () => {
  const proxy = proxyHarness();
  for (const path of readPaths) {
    assert.equal((await proxy.handle(path)).status,401);
    assert.equal((await proxy.handle(path,{headers:{Authorization:'Basic fixture'}})).status,401);
  }
  assert.equal(proxy.calls.length,0);
  const response = await proxy.handle('assistant/conversations/42',{headers:{Authorization:'Bearer fixture-token',Cookie:'private-cookie=never-forward'}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal(proxy.calls[0].url.href,'https://fixture.example.invalid/api/assistant/conversations/42');
  assert.equal(proxy.calls[0].options.headers.get('authorization'),'Bearer fixture-token');
  assert.equal(proxy.calls[0].options.headers.get('cookie'),null);
  assert.equal(proxy.calls[0].options.headers.get('x-goodlease-client'),'web');
  assert.equal((await proxy.handle(actionPath,{method:'POST',headers:{Authorization:'Bearer fixture-token','Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal(proxy.calls.length,1);
  const decision = JSON.stringify({decision:'APPROVE'});
  assert.equal((await proxy.handle(actionPath,{method:'POST',headers:{Authorization:'Bearer fixture-token','Content-Type':'application/json',
    'X-GoodLease-Analytics':'YW5hbHl0aWNz','X-GoodLease-Marketing':'bWFya2V0aW5n'},body:decision})).status,200);
  assert.equal(proxy.calls.length,2);
  assert.equal(await new Response(proxy.calls[1].options.body).text(),decision);
  assert.equal(proxy.calls[1].options.headers.get('x-goodlease-analytics'),'YW5hbHl0aWNz');
  assert.equal(proxy.calls[1].options.headers.get('x-goodlease-marketing'),'bWFya2V0aW5n');
});

