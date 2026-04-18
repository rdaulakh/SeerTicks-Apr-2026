import mysql from 'mysql2/promise';

async function check() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  const [positions] = await conn.execute(`
    SELECT id, symbol, exitReason, 
           DATE_FORMAT(entryTime, '%Y-%m-%d %H:%i:%s') as entryTime,
           DATE_FORMAT(exitTime, '%Y-%m-%d %H:%i:%s') as exitTime,
           TIMESTAMPDIFF(SECOND, entryTime, exitTime) as holdSeconds
    FROM paperPositions 
    WHERE userId = 1 
    ORDER BY id DESC 
    LIMIT 5
  `);
  console.log('Recent Positions with Exit Reasons:', JSON.stringify(positions, null, 2));
  
  await conn.end();
}

check().catch(console.error);
