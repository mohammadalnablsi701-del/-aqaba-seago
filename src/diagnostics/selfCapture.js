import crypto from 'node:crypto';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function encryptForLog(plaintext,publicKeyB64){
  const publicKey=Buffer.from(publicKeyB64,'base64').toString('utf8');
  const aesKey=crypto.randomBytes(32);
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',aesKey,iv);
  const ciphertext=Buffer.concat([cipher.update(Buffer.from(plaintext,'utf8')),cipher.final()]);
  const tag=cipher.getAuthTag();
  const encryptedKey=crypto.publicEncrypt({
    key:publicKey,
    padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:'sha256'
  },aesKey);
  return Buffer.from(JSON.stringify({
    alg:'RSA-OAEP-SHA256+A256GCM',
    encryptedKey:encryptedKey.toString('base64'),
    iv:iv.toString('base64'),
    tag:tag.toString('base64'),
    ciphertext:ciphertext.toString('base64')
  })).toString('base64');
}

async function localGet({port,token}){
  return fetch(`http://127.0.0.1:${port}/internal/diagnostics/sea-breeze`,{
    method:'GET',
    headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},
    cache:'no-store',
    signal:AbortSignal.timeout(20000)
  });
}

export async function runDiagnosticSelfCapture({port,env=process.env,log=console.log,errorLog=console.error}={}){
  if(env.PRODUCTION_DIAGNOSTIC_SELF_CAPTURE==='true'){
    const token=String(env.PRODUCTION_DIAGNOSTIC_TOKEN||'');
    const publicKeyB64=String(env.DIAGNOSTIC_PUBLIC_KEY_B64||'');
    if(!/^[a-f0-9]{64}$/.test(token)||!publicKeyB64){
      errorLog('Diagnostic self-capture configuration invalid');
      return;
    }
    await sleep(500);
    const response=await localGet({port,token});
    if(!response.ok){
      errorLog(`Diagnostic self-capture failed with HTTP ${response.status}`);
      return;
    }
    const plaintext=await response.text();
    log(`PROD_DIAGNOSTIC_ENCRYPTED=${encryptForLog(plaintext,publicKeyB64)}`);
    const second=await localGet({port,token});
    log(`PROD_DIAGNOSTIC_SECOND_READ_STATUS=${second.status}`);
    return;
  }

  if(env.PRODUCTION_DIAGNOSTIC_VERIFY_DISABLED==='true'){
    await sleep(500);
    const response=await localGet({port,token:'0'.repeat(64)});
    log(`PROD_DIAGNOSTIC_DISABLED_STATUS=${response.status}`);
  }
}
