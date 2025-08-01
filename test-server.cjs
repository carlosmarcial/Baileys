const http = require('http');

// Test health endpoint
const testHealth = () => {
    http.get('http://localhost:3000/health', (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log('Health check response:', data);
        });
    }).on('error', (err) => {
        console.error('Health check error:', err.message);
    });
};

// Test status endpoint
const testStatus = () => {
    http.get('http://localhost:3000/status', (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log('Status response:', data);
        });
    }).on('error', (err) => {
        console.error('Status error:', err.message);
    });
};

// Test QR endpoint
const testQR = () => {
    http.get('http://localhost:3000/qr', (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log('QR response:', data.substring(0, 100) + '...');
        });
    }).on('error', (err) => {
        console.error('QR error:', err.message);
    });
};

console.log('Testing server endpoints...');
console.log('Make sure the server is running with: yarn dev');
console.log('');

setTimeout(() => {
    testHealth();
    setTimeout(() => testStatus(), 1000);
    setTimeout(() => testQR(), 2000);
}, 1000);