import crypto from 'node:crypto';

function required(name){
  const value=String(process.env[name]||'').trim();
  if(!value) throw new Error(`Missing ${name}`);
  return value;
}

export async function readProductionDiagnosticsEncrypted(){
  if(process.env.PRODUCTION_DIAGNOSTIC_CLIENT_ON_START!=='true') return;

  const url=required('PRODUCTION_DIAGNOSTIC_URL');
  const token=required('PRODUCTION_DIAGNOSTIC_TOKEN');
  const publicKey=Buffer.from(required('DIAGNOSTIC_PUBLIC_KEY_B64'),'base64').toString('utf8');

  const response=await fetch(url,{
    method:'GET',
    headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},
    cache:'no-store',
    signal:AbortSignal.timeout(20000)
  });
  if(!response.ok) throw new Error(`Production diagnostic request failed with HTTP ${response.status}`);
  const plaintext=Buffer.from(await response.text(),'utf8');

  const aesKey=crypto.randomBytes(32);
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',aesKey,iv);
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const tag=cipher.getAuthTag();
  const encryptedKey=crypto.publicEncrypt({
    key:publicKey,
    padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:'sha256'
  },aesKey);

  const envelope={
    alg:'RSA-OAEP-SHA256+A256GCM',
    encryptedKey:encryptedKey.toString('base64'),
    iv:iv.toString('base64'),
    tag:tag.toString('base64'),
    ciphertext:ciphertext.toString('base64')
  };
  console.log(`PROD_DIAGNOSTIC_ENCRYPTED=${Buffer.from(JSON.stringify(envelope)).toString('base64')}`);
}
