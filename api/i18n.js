const i18next = require('i18next');
const i18nextMiddleware = require('i18next-http-middleware');
const Backend = require('i18next-fs-backend');

const i18n = i18next
  .use(Backend)
  .use(i18nextMiddleware.LanguageDetector)
  .init({
    fallbackLng: 'en',
    debug: process.env.NODE_ENV !== 'production',
    interpolation: {
      escapeValue: false,
    },
    backend: {
      loadPath: __dirname + '/locales/{{lng}}/{{ns}}.json',
    },
    detection: {
      order: ['header', 'querystring', 'cookie', 'session'],
      lookupHeader: 'Accept-Language',
      lookupQuerystring: 'lng',
      lookupCookie: 'i18next',
      lookupSession: 'lng',
    },
    supportedLngs: ['en', 'zh'],
    ns: ['translation'],
    defaultNS: 'translation',
  });

module.exports = {
  i18n,
  middleware: i18nextMiddleware.handle(i18next),
};