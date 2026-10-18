import mongoose from 'mongoose';
import { reject } from './policy.mjs';
mongoose.mongo.MongoClient.prototype.connect = async function () { reject(); };
mongoose.connect = async function () { reject(); };
mongoose.createConnection = function () { reject(); };
