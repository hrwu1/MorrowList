#!/usr/bin/env node
/**
 * Generate a VAPID key pair for web push (GAP-13 step 7): `node scripts/generate-vapid.mjs`.
 *
 * The pair identifies this deployment to the push services it talks to. It is generated
 * once and kept: rotating it invalidates every registration, because a browser subscribes
 * with the public key and the push service checks that the sender holds the private half.
 *
 * The private key is a signing credential. It belongs in the environment, never in the
 * repository and never in a browser bundle.
 */
import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

const publicKey = ecdh.getPublicKey().toString("base64url");
const privateKey = ecdh.getPrivateKey().toString("base64url");
const subject = process.argv[2] ?? "mailto:you@example.com";

console.log(`# Web push (GAP-13). Keep VAPID_PRIVATE_KEY secret.
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=${subject}`);
