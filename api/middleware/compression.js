const compression = require('compression');
const zlib = require('zlib');

const compressionMiddleware = compression({
  level: zlib.constants.Z_BEST_COMPRESSION,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024,
});

module.exports = {
  compressionMiddleware,
};