import jwt from 'jsonwebtoken';
import 'dotenv/config';

export const generateToken = (userId)=>{
    return jwt.sign({id:userId},process.env.JWT_SECRET,{expiresIn:'7d'});
}