import jwt from "jsonwebtoken";
import User from "../models/User.js";
export async function requireAuth(req,res,next){try{const h=req.headers.authorization||"";const token=h.startsWith("Bearer ")?h.slice(7):null;if(!token)return res.status(401).json({error:"Authentication required"});const p=jwt.verify(token,process.env.JWT_SECRET);const user=await User.findById(p.sub).select("-passwordHash");if(!user||!user.isActive)return res.status(401).json({error:"Invalid account"});req.user=user;next();}catch{return res.status(401).json({error:"Invalid or expired token"});}}
export function requireRole(...roles){return(req,res,next)=>{if(!req.user||!roles.includes(req.user.role))return res.status(403).json({error:"Forbidden"});next();};}
