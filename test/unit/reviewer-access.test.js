import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminSecurity } from '../../src/admin-security.js';

const safeEqual = (a,b) => a === b;

function req(token) {
  return {
    headers: token ? { authorization:`Bearer ${token}` } : {},
    socket:{ remoteAddress:'203.0.113.10' }
  };
}

function url(path='/anchor/api/session') {
  return new URL(`https://example.test${path}`);
}

test('reviewer bearer token authenticates as reviewer',()=>{
  const old = process.env.AW_REVIEWER_TOKEN;
  process.env.AW_REVIEWER_TOKEN = 'reviewer-test-token';

  try {
    const admin = new AdminSecurity({
      secret:'test-secret',
      dashboardToken:'admin-test-token',
      allowQueryAdminToken:false
    });

    assert.equal(admin.role(req('reviewer-test-token'),url(),safeEqual),'reviewer');
  } finally {
    if (old === undefined) delete process.env.AW_REVIEWER_TOKEN;
    else process.env.AW_REVIEWER_TOKEN = old;
  }
});

test('reviewer token is bearer-only and never accepted from query string',()=>{
  const old = process.env.AW_REVIEWER_TOKEN;
  process.env.AW_REVIEWER_TOKEN = 'reviewer-test-token';

  try {
    const admin = new AdminSecurity({
      secret:'test-secret',
      dashboardToken:'admin-test-token',
      allowQueryAdminToken:true
    });

    assert.equal(
      admin.role(
        req(),
        url('/anchor/api/session?token=reviewer-test-token'),
        safeEqual
      ),
      null
    );
  } finally {
    if (old === undefined) delete process.env.AW_REVIEWER_TOKEN;
    else process.env.AW_REVIEWER_TOKEN = old;
  }
});

test('reviewer capabilities remain read-only',()=>{
  const admin = new AdminSecurity({secret:'test-secret'});
  const cap = admin.capabilitiesForRole('reviewer');

  assert.equal(cap.canReadInvestigations,true);
  assert.equal(cap.canWriteReviews,false);
  assert.equal(cap.canChangeConfig,false);
  assert.equal(cap.canEnforce,false);
  assert.equal(cap.canIssueCsrf,false);
});

test('admin retains full operator capabilities',()=>{
  const admin = new AdminSecurity({secret:'test-secret'});
  const cap = admin.capabilitiesForRole('admin');

  assert.equal(cap.canReadInvestigations,true);
  assert.equal(cap.canWriteReviews,true);
  assert.equal(cap.canChangeConfig,true);
  assert.equal(cap.canEnforce,true);
  assert.equal(cap.canIssueCsrf,true);
});
