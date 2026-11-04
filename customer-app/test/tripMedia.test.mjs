import test from "node:test";
import assert from "node:assert/strict";
import {trustedTripImages} from "../src/tripMedia.js";
test("Only operator-supplied HTTPS trip photos are shown",()=>{
 assert.deepEqual(trustedTripImages(["https://example.com/photo.jpg",{url:"https://cdn.example.org/vessel.webp"},
  "http://example.org/insecure.jpg","javascript:alert(1)","data:image/png;base64,AA",
  "https://user:secret@example.com/photo.jpg",null,42]),
  ["https://example.com/photo.jpg","https://cdn.example.org/vessel.webp"]);
});
test("empty and invalid images have a clear fallback; limit at 10",()=>{
 assert.deepEqual(trustedTripImages(undefined),[]);
 assert.deepEqual(trustedTripImages(["javascript:alert(1)"]),[]);
 assert.equal(trustedTripImages(Array(12).fill("https://example.com/p.png")).length,10);
});
