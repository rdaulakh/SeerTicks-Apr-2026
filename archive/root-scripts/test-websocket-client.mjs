import WebSocket from 'ws';

console.log('=== WebSocket Client Test ===');

const ws = new WebSocket('ws://localhost:3000/ws/seer-multi');

ws.on('open', () => {
  console.log('✅ Connected to WebSocket server');
  
  console.log('📤 Sending auth message...');
  ws.send(JSON.stringify({ type: 'auth', userId: 1 }));
  
  setTimeout(() => {
    console.log('📤 Sending request_status message...');
    ws.send(JSON.stringify({ type: 'request_status' }));
  }, 1000);
  
  setTimeout(() => {
    console.log('Closing connection...');
    ws.close();
  }, 3000);
});

ws.on('message', (data) => {
  console.log('📨 Received message:', data.toString());
});

ws.on('close', () => {
  console.log('❌ Connection closed');
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
  process.exit(1);
});
