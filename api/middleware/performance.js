const express = require('express')
const compression = require('compression')
const responseTime = require('response-time')

const app = express()

app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false
    return compression.filter(req, res)
  },
}))

app.use(responseTime())

app.use((req, res, next) => {
  res.setHeader('X-Response-Time', res.getHeader('X-Response-Time'))
  next()
})

module.exports = app
