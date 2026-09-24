const SERVICE_BY_API = Object.freeze({
  classic: 'CLASSIC',
  sales_navigator: 'SALES_NAVIGATOR',
  recruiter: 'RECRUITER',
});

const ALLOWED_CATEGORIES_BY_API = Object.freeze({
  classic: Object.freeze(['people', 'companies', 'posts', 'jobs']),
  sales_navigator: Object.freeze(['people', 'companies']),
  recruiter: Object.freeze(['people']),
});

function toUnipileService(api) {
  return SERVICE_BY_API[String(api || '').toLowerCase()] || 'CLASSIC';
}

function validateSearchCombination(api, category) {
  const allowed = ALLOWED_CATEGORIES_BY_API[String(api || '').toLowerCase()];
  if (!allowed) return `Invalid api: "${api}". Must be one of: ${Object.keys(SERVICE_BY_API).join(', ')}`;
  if (!allowed.includes(String(category || '').toLowerCase())) {
    return `Unsupported search combination: api "${api}" does not support category "${category}". Allowed categories: ${allowed.join(', ')}`;
  }
  return null;
}

function buildParameterSearchUrl(baseUrl, { accountId, type, keywords, limit, api }) {
  const params = new URLSearchParams();
  params.append('account_id', accountId);
  params.append('type', type);
  if (keywords) params.append('keywords', keywords);
  params.append('limit', String(limit));
  params.append('service', toUnipileService(api));
  return `${baseUrl}/linkedin/search/parameters?${params.toString()}`;
}

function buildLinkedInSearchRequest(baseUrl, { accountId, limit, cursor, body }) {
  const params = new URLSearchParams();
  params.append('account_id', accountId);
  params.append('limit', String(limit));
  if (cursor) params.append('cursor', cursor);
  // Keep the caller's complete provider payload intact (e.g. headcount,
  // nested Sales Navigator filters, and future Unipile fields).
  return { url: `${baseUrl}/linkedin/search?${params.toString()}`, body };
}

module.exports = {
  toUnipileService,
  validateSearchCombination,
  buildParameterSearchUrl,
  buildLinkedInSearchRequest,
};
