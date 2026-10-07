import { restoreDatabase } from "../src/ops/databaseBackup.js";

const uri=process.env.RESTORE_MONGODB_URI;
const databaseName=process.env.RESTORE_DATABASE;
const backupPath=process.env.DB_BACKUP_PATH;

const result=await restoreDatabase({uri,databaseName,backupPath,env:process.env});
console.log(JSON.stringify({ok:true,...result},null,2));
