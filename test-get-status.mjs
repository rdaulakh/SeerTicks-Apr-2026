import { getSEERMultiEngine } from './server/seerMainMulti.ts';

console.log('Getting engine status for userId 1...');
const engine = getSEERMultiEngine(1);
const status = engine.getStatus();
console.log('Engine status:', JSON.stringify(status, null, 2));
process.exit(0);
