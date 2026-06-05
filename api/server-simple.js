const express = require('express');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const app = express();

console.log('Step 1: Creating Express app');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

console.log('Step 2: Middleware configured');

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'GlobalReach API' });
});

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

console.log('Step 3: Routes configured');
console.log('Step 4: Starting server on port', PORT);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});