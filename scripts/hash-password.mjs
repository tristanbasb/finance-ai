#!/usr/bin/env node
// Lit le mot de passe sur stdin et imprime le hash à mettre dans APP_PASSWORD_HASH.
// Même algorithme que src/lib/auth/password.ts (scrypt N=16384, r=8, p=1, 64 octets).
import { randomBytes, scrypt } from "node:crypto";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");

if (password.length === 0) {
  console.error("Mot de passe vide.");
  process.exit(1);
}

const salt = randomBytes(16);
scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
  if (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`scrypt:${salt.toString("hex")}:${key.toString("hex")}`);
});
