import mongoose from "mongoose";
export async function connectDb(uri) { mongoose.set("strictQuery", true); await mongoose.connect(uri); }
