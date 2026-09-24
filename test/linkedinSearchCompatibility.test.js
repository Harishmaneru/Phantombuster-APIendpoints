const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toUnipileService,
  validateSearchCombination,
  buildParameterSearchUrl,
  buildLinkedInSearchRequest,
} = require('../uniplieApi/linkedinSearchCompatibility');

test('existing API/category combinations remain accepted', () => {
  for (const category of ['people', 'companies', 'posts', 'jobs']) {
    assert.equal(validateSearchCombination('classic', category), null);
  }
  for (const category of ['people', 'companies']) {
    assert.equal(validateSearchCombination('sales_navigator', category), null);
  }
  assert.equal(validateSearchCombination('recruiter', 'people'), null);
});

test('only unsupported API/category pairs are rejected', () => {
  assert.match(validateSearchCombination('sales_navigator', 'jobs'), /does not support category/);
  assert.match(validateSearchCombination('recruiter', 'companies'), /does not support category/);
  assert.match(validateSearchCombination('unknown', 'people'), /Invalid api/);
});

test('parameter lookups map public api values to Unipile service values', () => {
  assert.equal(toUnipileService('classic'), 'CLASSIC');
  assert.equal(toUnipileService('sales_navigator'), 'SALES_NAVIGATOR');
  assert.equal(toUnipileService('recruiter'), 'RECRUITER');
  const url = new URL(buildParameterSearchUrl('https://unipile.example', {
    accountId: 'account-1', type: 'SALES_INDUSTRY', keywords: 'food', limit: 25, api: 'sales_navigator',
  }));
  assert.equal(url.searchParams.get('service'), 'SALES_NAVIGATOR');
  assert.equal(url.searchParams.get('api'), null);
  assert.equal(url.searchParams.get('keywords'), 'food');
  const classicUrl = new URL(buildParameterSearchUrl('https://unipile.example', {
    accountId: 'account-1', type: 'LOCATION', limit: 25, api: 'classic',
  }));
  assert.equal(classicUrl.searchParams.get('service'), 'CLASSIC');
});

test('cursor and nested Sales Navigator filters pass through without dropping headcount', () => {
  const body = {
    api: 'sales_navigator', category: 'companies',
    industry: { include: ['food-industry-id'] },
    location: { include: ['us-location-id'] },
    headcount: [{ min: 51, max: 1000 }],
    future_filter: { include: ['kept'] },
  };
  const request = buildLinkedInSearchRequest('https://unipile.example', {
    accountId: 'account-1', limit: 10, cursor: 'cursor-value', body,
  });
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('cursor'), 'cursor-value');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.deepEqual(request.body, body);
  assert.deepEqual(request.body.headcount, [{ min: 51, max: 1000 }]);
});

