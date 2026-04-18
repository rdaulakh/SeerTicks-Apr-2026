import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const testKey = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIJIekg/Rh8BRmJCsHf/Zb4s1IzJ+0uz1ciDT2gtUQql2oAoGCCqGSM49
AwEHoUQDQgAETsz2obU92jAXmFACRt0qA8JRM4gUPMMXwNLwpoDX/Osclf2Nn6FF
jmLC8eQoDmisqovVpKvEH/aTX1OTY2n5wQ==
-----END EC PRIVATE KEY-----`;

console.log("Testing different key formats...");
console.log("\n1. Direct PEM string:");
try {
  const token = jwt.sign({ test: "data" }, testKey, { algorithm: 'ES256' });
  console.log("✅ SUCCESS with direct PEM string");
} catch (e) {
  console.log("❌ FAILED:", e.message);
}

console.log("\n2. Using crypto.createPrivateKey:");
try {
  const keyObject = crypto.createPrivateKey(testKey);
  const token = jwt.sign({ test: "data" }, keyObject, { algorithm: 'ES256' });
  console.log("✅ SUCCESS with crypto.createPrivateKey");
} catch (e) {
  console.log("❌ FAILED:", e.message);
}

console.log("\n3. With passphrase option:");
try {
  const token = jwt.sign({ test: "data" }, { key: testKey, passphrase: '' }, { algorithm: 'ES256' });
  console.log("✅ SUCCESS with passphrase option");
} catch (e) {
  console.log("❌ FAILED:", e.message);
}
