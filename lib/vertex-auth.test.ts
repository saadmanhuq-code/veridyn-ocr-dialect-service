import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";

import { clearVertexAuthTokenCache, getVertexAccessToken } from "./vertex-auth";

const tokenUrl = "https://oauth2.googleapis.com/token";

let savedServiceAccount: string | undefined;
let savedFetch: typeof globalThis.fetch;

function decodeJwtSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

beforeEach(() => {
  savedServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  savedFetch = globalThis.fetch;
  clearVertexAuthTokenCache();
});

afterEach(() => {
  if (savedServiceAccount === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = savedServiceAccount;
  globalThis.fetch = savedFetch;
  clearVertexAuthTokenCache();
});

test("Vertex auth exchanges an RS256 JWT bearer assertion with the expected claims", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const clientEmail = "vertex-test@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: clientEmail,
    private_key: privatePem,
  });

  let requestUrl = "";
  let requestBody = "";
  globalThis.fetch = (async (url, init) => {
    requestUrl = String(url);
    requestBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({ access_token: "test-access-token", expires_in: 3600, token_type: "Bearer" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const token = await getVertexAccessToken();

  assert.equal(token, "test-access-token");
  assert.equal(requestUrl, tokenUrl);
  const form = new URLSearchParams(requestBody);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");

  const assertion = form.get("assertion");
  assert.ok(assertion, "JWT assertion should be sent");
  const [headerSegment, payloadSegment, signatureSegment] = assertion.split(".");
  assert.ok(headerSegment);
  assert.ok(payloadSegment);
  assert.ok(signatureSegment);

  assert.deepEqual(decodeJwtSegment(headerSegment), { alg: "RS256", typ: "JWT" });
  const payload = decodeJwtSegment(payloadSegment);
  assert.equal(payload.iss, clientEmail);
  assert.equal(payload.scope, "https://www.googleapis.com/auth/cloud-platform");
  assert.equal(payload.aud, tokenUrl);
  assert.equal((payload.exp as number) - (payload.iat as number), 3600);

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerSegment}.${payloadSegment}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(signatureSegment, "base64url")), true);
});
