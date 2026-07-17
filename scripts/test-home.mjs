/**
 * Lightweight checks for home IP / Private Relay helpers.
 * Run: node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-home.mjs
 * (falls back to dynamic import via tsx in npm script)
 */
import assert from "node:assert/strict";

const {
  expandIpv6,
  normalizeIp,
  isPrivacyProxyIp,
  isHomeIp,
  distanceMeters,
  parseCoordsFromRequest,
} = await import("../src/lib/home.ts");

assert.equal(
  expandIpv6("2a09:bac3:5369:28c::41:12a"),
  "2a09:bac3:5369:028c:0000:0000:0041:012a",
);

assert.equal(normalizeIp("203.0.113.45"), "203.0.113.45");
assert.equal(normalizeIp("::ffff:203.0.113.45"), "203.0.113.45");

assert.equal(isPrivacyProxyIp("2a09:bac3:5369:28c::41:12a"), true);
assert.equal(isPrivacyProxyIp("90.227.83.182"), false);

process.env.HOME_WAN_IPS = "90.227.83.182,2001:db8:abcd::/64";
assert.equal(isHomeIp("90.227.83.182"), true);
assert.equal(isHomeIp("2a09:bac3:5369:28c::41:12a"), false);
assert.equal(isHomeIp("2001:db8:abcd::1"), true);
assert.equal(isHomeIp("2001:db8:abce::1"), false);
assert.equal(isHomeIp("90.227.83.183"), false);

process.env.HOME_WAN_IPS = "10.0.0.0/8";
assert.equal(isHomeIp("10.1.2.3"), true);
assert.equal(isHomeIp("11.0.0.1"), false);

const d = distanceMeters(
  { lat: 59.3293, lng: 18.0686 },
  { lat: 59.3293, lng: 18.0686 },
);
assert.ok(d < 1);

const req = new Request("https://example.com/api/me?lat=59.3&lng=18.1");
const coords = parseCoordsFromRequest(req);
assert.deepEqual(coords, { lat: 59.3, lng: 18.1 });

console.log("home checks ok");
