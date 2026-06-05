const http = require('http');

function doPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(data);
    req.end();
  });
}

async function main() {
  try {
    // Test 1: Register
    console.log('=== TEST: POST /api/auth/register ===');
    const r1 = await doPost('/api/auth/register', { email:'d02test@test.com', password:'Test12345678', name:'D02Test' });
    console.log('Status:', r1.status, 'Body:', r1.body.substring(0, 200));

    if (r1.status === 201) {
      const token = JSON.parse(r1.body).data.token;
      console.log('\nGot token:', token.substring(0, 30) + '...');

      // Test 2: Get accounts list with token
      console.log('\n=== TEST: GET /api/accounts ===');
      const req2 = http.request({
        hostname:'localhost', port:3000, path:'/api/accounts', method:'GET',
        headers: { 'Authorization': 'Bearer ' + token }
      }, (res2) => { let d=''; res2.on('data',c=>d+=c); res2.on('end',()=>console.log('Status:',res2.statusCode,'Body:',d.substring(0,200))); });
      req2.on('error', e => console.error('ERR:', e.message));
      req2.setTimeout(5000, ()=>{req2.destroy();console.error('TIMEOUT')});
      req2.end();

      // Test 3: Root endpoint for engine status
      console.log('\n=== TEST: GET / (engine status) ===');
      const req3 = http.request({hostname:'localhost',port:3000,path:'/',method:'GET'},(res3)=>{let d='';res3.on('data',c=>d+=c);res3.on('end',()=>console.log('Body:',d));});
      req3.end();

      await new Promise(r => setTimeout(r, 2000));
    }

    process.exit(0);
  } catch(e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }
}

main();
