import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise the dormant handler in isolation without starting the server or
// removing the legacy safety gate. All provider operations are synthetic.
const source = ts.createSourceFile('server.ts', readFileSync(new URL('../../server.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const route = source.statements.find(statement => {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const [path] = statement.expression.arguments;
  return path && ts.isStringLiteral(path) && path.text === '/api/payments/paypal/capture';
});
assert.ok(route, 'legacy capture route must be covered until removed');
const script = ts.transpileModule(route.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;

function fixture() {
  let handler: (req: any, res: any) => Promise<unknown>;
  let tokenCalls = 0;
  const requests: { url: string; options: any }[] = [];
  runInNewContext(script, {
    app: { post(_path: string, callback: typeof handler) { handler = callback; } },
    process: { env: { PAYPAL_CLIENT_ID: 'synthetic-client', PAYPAL_CLIENT_SECRET: 'synthetic-secret' } },
    getPayPalBaseUrl: () => 'https://api-m.sandbox.paypal.com',
    getPayPalAccessToken: async () => { tokenCalls++; return 'synthetic-token'; },
    fetch: async (url: string, options: any) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'synthetic-capture' }] } }] }) };
    },
    console,
  });
  return {
    requests,
    get tokenCalls() { return tokenCalls; },
    async capture(paypalOrderId: unknown) {
      let status = 200;
      let body: any;
      const res = { status(value: number) { status = value; return res; }, json(value: any) { body = value; return res; } };
      await handler!({ body: { paypalOrderId, orderId: 'synthetic-order' } }, res);
      return { status, body };
    },
  };
}

test('legacy capture rejects malformed IDs before token lookup or outbound requests', async () => {
  const provider = fixture();
  for (const value of [null, undefined, 1234567890, {}, ['5O190127TN364715T'], '', 'short', 'A'.repeat(65),
    '../capture', 'AAAAAAAAAA/../other', 'AAAAAAAAAA?x=1', 'AAAAAAAAAA#fragment',
    'https://example.test/order', 'AAAAAAAAAA%2Fcapture', 'AAAAAAAAAA\\capture',
    'AAAAAAAAAA\n', ' AAAAAAAAAA', 'AAAAAAAAAA ', 'Ａ'.repeat(17)]) {
    const result = await provider.capture(value);
    assert.equal(result.status, 400, `invalid ID: ${JSON.stringify(value)}`);
  }
  assert.equal(provider.tokenCalls, 0);
  assert.equal(provider.requests.length, 0);
});

test('legacy capture preserves the provider path and success response for valid IDs', async () => {
  const provider = fixture();
  for (const value of ['5O190127TN364715T', 'abcDEF0123-', 'A'.repeat(10), 'A'.repeat(64)]) {
    const result = await provider.capture(value);
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.paymentId, 'synthetic-capture');
    const request = provider.requests.at(-1)!;
    assert.equal(request.url, `https://api-m.sandbox.paypal.com/v2/checkout/orders/${value}/capture`);
    assert.equal(request.options.method, 'POST');
  }
});
