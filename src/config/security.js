const PLACEHOLDER_SECRET_PATTERNS=[
  "replace-with",
  "change-me",
  "changeme",
  "your-secret",
  "jwt-secret",
  "secret-key"
];

function parseDurationSeconds(value){
  const input=String(value||"").trim().toLowerCase();
  const match=input.match(/^(\d+)(s|m|h|d)$/);
  if(!match)return null;
  const amount=Number(match[1]);
  if(!Number.isSafeInteger(amount)||amount<=0)return null;
  const multiplier={s:1,m:60,h:3600,d:86400}[match[2]];
  return amount*multiplier;
}

export function jwtExpiresIn(env=process.env){
  const configured=String(env.JWT_EXPIRES_IN||"").trim();
  if(configured)return configured;
  return env.NODE_ENV==="production"?"1d":"7d";
}

export function validateJwtSecurity(env=process.env){
  const secret=String(env.JWT_SECRET||"");
  if(!secret)throw new Error("JWT_SECRET is required");

  const expiry=jwtExpiresIn(env);
  if(env.NODE_ENV!=="production")return {expiry};

  if(secret.length<32){
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }

  const normalized=secret.trim().toLowerCase();
  if(PLACEHOLDER_SECRET_PATTERNS.some(pattern=>normalized.includes(pattern))){
    throw new Error("JWT_SECRET must not use a placeholder value in production");
  }

  const expirySeconds=parseDurationSeconds(expiry);
  if(!expirySeconds){
    throw new Error("JWT_EXPIRES_IN must use an explicit duration such as 15m, 1h, or 1d in production");
  }
  if(expirySeconds>86400){
    throw new Error("JWT_EXPIRES_IN must not exceed 24 hours in production");
  }

  return {expiry};
}
