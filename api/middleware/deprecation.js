/**
 * Deprecation Middleware for Legacy API Routes
 * Adds RFC 8594 Sunset + Warning + Deprecation headers to legacy endpoints
 *
 * Usage: app.use('/api', deprecationMiddleware({
 *   sunsetDate: '2027-06-01',
 *   replacementUrl: '/api/v1',
 *   version: '1.0'
 * }))
 */

const LEGACY_ROUTES_METRIC = 'globalreach_legacy_api_requests_total';

function deprecationMiddleware(options = {}) {
  const {
    sunsetDate = '2027-06-01',       // Default: 1 year from now
    replacementUrl = '/api/v1',      // Migration target
    version = '1.0',
    policyLink = 'https://docs.globalreach.com/api-migration-guide'
  } = options;

  // RFC 3339 format sunset date
  const sunsetRFC = new Date(sunsetDate).toISOString().split('T')[0];

  return (req, res, next) => {
    // Skip non-legacy routes or options requests
    if (req.path.startsWith('/v1') || req.method === 'OPTIONS') {
      return next();
    }

    // 1. Sunset header (RFC 8594)
    res.setHeader('Sunset', sunsetRFC);

    // 2. Warning header (RFC 7234)
    res.setHeader('Warning', `299 - "This API version is deprecated. Migrate to ${replacementUrl} before ${sunsetDate}. See ${policyLink}"`);

    // 3. Deprecation header (proposed standard)
    res.setHeader('Deprecation', 'true');

    // 4. Link header pointing to migration guide
    const existingLink = res.getHeader('Link') || '';
    res.setHeader('Link', `${existingLink ? existingLink + ', ' : ''}<${policyLink}>; rel="deprecation"; type="text/html"`);

    // 5. Capture legacy usage metric placeholder
    // (In production, this would increment a Prometheus counter)
    req._isLegacyRoute = true;
    req._legacyVersion = version;

    next();
  };
}

module.exports = deprecationMiddleware;
module.exports.LEGACY_ROUTES_METRIC = LEGACY_ROUTES_METRIC;
