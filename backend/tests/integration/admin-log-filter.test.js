process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_1234567890';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  normalizeAdminLogFilters,
  matchesAdminLogFilters
} = require('../../utils/admin-log-filters');

const sampleLogs = [
  {
    id: 1,
    action: 'user:ban',
    target_type: 'user',
    target_id: '10',
    details: { reason: 'spam' },
    ip_address: '127.0.0.1',
    admin_email: 'admin@oic-ok.ac.jp',
    admin_name: 'admin',
    created_at: '2026-07-07T10:00:00.000Z'
  },
  {
    id: 2,
    action: 'group:delete',
    target_type: 'group',
    target_id: '3',
    details: { name: 'Project A' },
    ip_address: '127.0.0.1',
    admin_email: 'admin@oic-ok.ac.jp',
    admin_name: 'admin',
    created_at: '2026-07-06T10:00:00.000Z'
  },
  {
    id: 3,
    action: 'admin:login:success',
    target_type: 'system',
    target_id: 'login',
    details: { email: 'admin@oic-ok.ac.jp' },
    ip_address: '192.168.100.10',
    admin_email: 'admin@oic-ok.ac.jp',
    admin_name: 'admin',
    created_at: '2026-07-07T08:00:00.000Z'
  }
];

function createTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/api/admin/logs') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    const query = Object.fromEntries(url.searchParams.entries());
    const filters = normalizeAdminLogFilters(query);
    const logs = sampleLogs.filter(log => matchesAdminLogFilters(log, filters));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(logs.slice(0, filters.limit)));
  });
}

function listen(server) {
  return new Promise(resolve => {
    server.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test('admin log endpoint filters by action group and target type', async (t) => {
  const { server, baseUrl } = await listen(createTestServer());
  t.after(() => server.close());

  const res = await fetch(`${baseUrl}/api/admin/logs?action_group=user&target_type=user`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.length, 1);
  assert.equal(body[0].action, 'user:ban');
});

test('admin log endpoint filters by keyword and date', async (t) => {
  const { server, baseUrl } = await listen(createTestServer());
  t.after(() => server.close());

  const res = await fetch(`${baseUrl}/api/admin/logs?q=192.168.100.10&date=2026-07-07`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.length, 1);
  assert.equal(body[0].action, 'admin:login:success');
});
