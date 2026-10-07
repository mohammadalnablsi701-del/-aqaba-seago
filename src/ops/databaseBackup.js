import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import mongoose from "mongoose";

const gzipAsync=promisify(gzip);
const gunzipAsync=promisify(gunzip);
const { MongoClient, BSON }=mongoose.mongo;

function safeDbName(name){
  const value=String(name||"").trim();
  if(!/^[A-Za-z0-9._-]+$/.test(value))throw new Error("A valid database name is required");
  return value;
}

function serializeDocument(document){
  return BSON.serialize(document).toString("base64");
}

function deserializeDocument(encoded){
  return BSON.deserialize(Buffer.from(encoded,"base64"));
}

function sanitizeIndex(index){
  const {v,ns,...rest}=index;
  return rest;
}

export function assertRestoreAllowed({env=process.env,targetDatabase,sourceDatabase}){
  const target=safeDbName(targetDatabase);
  if(env.NODE_ENV==="production")throw new Error("Database restore is blocked when NODE_ENV=production");
  if(env.PUBLIC_LAUNCH==="true")throw new Error("Database restore is blocked when PUBLIC_LAUNCH=true");
  if(env.ALLOW_DB_RESTORE!=="true")throw new Error("Set ALLOW_DB_RESTORE=true to enable restore");
  if(String(env.RESTORE_CONFIRM_DATABASE||"")!==target){
    throw new Error("RESTORE_CONFIRM_DATABASE must exactly match the restore target database");
  }
  if(sourceDatabase && target===sourceDatabase){
    throw new Error("Restore target database must differ from the backup source database");
  }
  return target;
}

export async function backupDatabase({uri,databaseName,outputPath}){
  if(!uri)throw new Error("A MongoDB URI is required for backup");
  const dbName=safeDbName(databaseName);
  if(!outputPath)throw new Error("An output path is required for backup");

  const client=new MongoClient(uri,{readPreference:"primaryPreferred"});
  await client.connect();
  try{
    const db=client.db(dbName);
    const collections=(await db.listCollections({}, {nameOnly:true}).toArray())
      .map(item=>item.name)
      .filter(name=>!name.startsWith("system."))
      .sort();

    const archive={
      format:"aqaba-seago-bson-backup-v1",
      createdAt:new Date().toISOString(),
      sourceDatabase:dbName,
      collections:[]
    };

    for(const name of collections){
      const collection=db.collection(name);
      const indexes=(await collection.indexes()).map(sanitizeIndex);
      const documents=[];
      const cursor=collection.find({});
      for await (const document of cursor){
        documents.push(serializeDocument(document));
      }
      archive.collections.push({name,indexes,documents,count:documents.length});
    }

    const payload=await gzipAsync(Buffer.from(JSON.stringify(archive),"utf8"),{level:9});
    await fs.mkdir(path.dirname(outputPath),{recursive:true});
    await fs.writeFile(outputPath,payload,{mode:0o600});
    return {
      outputPath,
      createdAt:archive.createdAt,
      sourceDatabase:dbName,
      collections:archive.collections.length,
      documents:archive.collections.reduce((sum,item)=>sum+item.count,0),
      bytes:payload.length
    };
  }finally{
    await client.close();
  }
}

export async function readBackupManifest(backupPath){
  const compressed=await fs.readFile(backupPath);
  const archive=JSON.parse((await gunzipAsync(compressed)).toString("utf8"));
  if(archive.format!=="aqaba-seago-bson-backup-v1")throw new Error("Unsupported backup format");
  return archive;
}

export async function restoreDatabase({uri,databaseName,backupPath,env=process.env}){
  if(!uri)throw new Error("A separate restore MongoDB URI is required");
  if(!backupPath)throw new Error("A backup path is required for restore");
  const archive=await readBackupManifest(backupPath);
  const targetDb=assertRestoreAllowed({env,targetDatabase:databaseName,sourceDatabase:archive.sourceDatabase});

  const client=new MongoClient(uri);
  await client.connect();
  try{
    const db=client.db(targetDb);
    const existing=new Set((await db.listCollections({}, {nameOnly:true}).toArray()).map(item=>item.name));
    for(const item of archive.collections){
      if(existing.has(item.name))await db.collection(item.name).drop();
      await db.createCollection(item.name);
      const collection=db.collection(item.name);
      const docs=item.documents.map(deserializeDocument);
      for(let i=0;i<docs.length;i+=500){
        const batch=docs.slice(i,i+500);
        if(batch.length)await collection.insertMany(batch,{ordered:true});
      }
      for(const index of item.indexes||[]){
        if(index.name==="_id_")continue;
        const {key,...options}=index;
        await collection.createIndex(key,options);
      }
    }
    return {
      targetDatabase:targetDb,
      sourceDatabase:archive.sourceDatabase,
      collections:archive.collections.length,
      documents:archive.collections.reduce((sum,item)=>sum+(item.count||0),0)
    };
  }finally{
    await client.close();
  }
}
