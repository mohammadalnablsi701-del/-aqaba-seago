import test from "node:test";
import assert from "node:assert/strict";
import {jwtExpiresIn,validateJwtSecurity} from "../src/config/security.js";

test("production JWT policy accepts strong secret with 24-hour expiry",()=>{
  const env={
    NODE_ENV:"production",
    JWT_SECRET:"A9!very-long-random-production-secret-1234567890",
    JWT_EXPIRES_IN:"1d"
  };
  assert.deepEqual(validateJwtSecurity(env),{expiry:"1d"});
});

test("production JWT policy rejects a short secret",()=>{
  assert.throws(()=>validateJwtSecurity({
    NODE_ENV:"production",
    JWT_SECRET:"too-short",
    JWT_EXPIRES_IN:"1d"
  }),/at least 32 characters/);
});

test("production JWT policy rejects placeholder secrets",()=>{
  assert.throws(()=>validateJwtSecurity({
    NODE_ENV:"production",
    JWT_SECRET:"replace-with-a-random-secret-at-least-32-characters",
    JWT_EXPIRES_IN:"1d"
  }),/placeholder value/);
});

test("production JWT policy rejects expiry longer than 24 hours",()=>{
  assert.throws(()=>validateJwtSecurity({
    NODE_ENV:"production",
    JWT_SECRET:"A9!very-long-random-production-secret-1234567890",
    JWT_EXPIRES_IN:"7d"
  }),/must not exceed 24 hours/);
});

test("production JWT policy rejects ambiguous expiry strings",()=>{
  assert.throws(()=>validateJwtSecurity({
    NODE_ENV:"production",
    JWT_SECRET:"A9!very-long-random-production-secret-1234567890",
    JWT_EXPIRES_IN:"86400"
  }),/explicit duration/);
});

test("production JWT expiry defaults to one day; development remains seven days",()=>{
  assert.equal(jwtExpiresIn({NODE_ENV:"production"}),"1d");
  assert.equal(jwtExpiresIn({NODE_ENV:"development"}),"7d");
});
