import path from "node:path";
import { backupDatabase } from "../src/ops/databaseBackup.js";

const uri=process.env.MONGODB_URI;
const databaseName=process.env.DB_BACKUP_DATABASE;
const timestamp=new Date().toISOString().replace(/[:.]/g,"-");
const outputPath=process.env.DB_BACKUP_PATH||path.resolve("backups",`aqaba-seago-${databaseName||"database"}-${timestamp}.json.gz`);

const result=await backupDatabase({uri,databaseName,outputPath});
console.log(JSON.stringify({
  ok:true,
  outputPath:result.outputPath,
  createdAt:result.createdAt,
  database:result.sourceDatabase,
  collections:result.collections,
  documents:result.documents,
  bytes:result.bytes
},null,2));
