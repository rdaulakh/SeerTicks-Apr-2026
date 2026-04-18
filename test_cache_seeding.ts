import { getSEERMultiEngine } from './server/seerMainMulti.js';

console.log("=== Testing Cache Seeding on Engine Creation ===\n");

const userId = 1;
console.log(`Calling getSEERMultiEngine(${userId})...`);

const engine = await getSEERMultiEngine(userId);

console.log("\n✅ Engine instance created");
console.log("Status:", await engine.getStatus());

process.exit(0);
