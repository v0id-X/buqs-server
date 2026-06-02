import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import googleClient from '../utils/googleClientConfig.js';
import pool from  '../db/db.js';
import {generateToken} from '../utils/generateToken.js';
import { trackEvent } from '../queues/analytics.queue.js';


export const register = async (req,res)=>{
    try {

        const {email,password,name} = req.body;
        

    const userExists = await pool.query(`SELECT * FROM USERS WHERE email = $1`,[email]);

    if(userExists.rows.length>0){
        return res.status(400).json({success:false,message:"User with this email already exits!"});
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password,salt);

    const newUser = await pool.query(`INSERT INTO USERS(email,password_hash,name) VALUES($1,$2,$3) RETURNING id, name, email`,[email,hashedPassword,name]);

    if(!newUser){
        return res.status(500).json({success:false,message:"Failed to create user."});
    }

    const user = newUser.rows[0];
    const token = generateToken(user.id);

    trackEvent(user.id,'user_signup',{provider:'email'})

    return res.status(201).json({user,token});
    
    } catch (error) {
        console.error(`Registration error: ${error}`);
        return res.status(500).json({success:false,message:"Internal server error, unable to register user."});
    }
    
};


export const login = async(req,res)=>{

    try {

    const {email,password} = req.body;

    const userExists = await pool.query(`SELECT * FROM users WHERE email = $1`,[email]);
    
    if(userExists.rows.length === 0){ 
        return res.status(401).json({success:false,message:"User does not exist, please register."});
    }

    const user = userExists.rows[0];

    if(!user.password_hash){  
        return res.status(400).json({success:false,message:"This account was created using google. Please use google login."});
    }


    const isValidPassword = await bcrypt.compare(password,user.password_hash);

    if(!isValidPassword){   
        return res.status(400).json({success:false,message:"Invalid email or password."});
    }

    let displayName = user.name;
    if(user.email === process.env.SP_EMAIL) displayName = process.env.SP_NAME;

    trackEvent(user.id,'user_login',{device:req.headers['user-agent']});

    const token = generateToken(user.id);
    return res.status(200).json({
        user :{
            id: user.id,
            name: displayName,
            email: user.email,
        },token
    });

    } catch (error) {
        console.error(`login error-catch block: ${error}`);
        return res.status(500).json({success:false,message:"Internal server error, unable to login at the moment."});
    }

}


export const googleAuth = async(req,res)=>{
    try {
        const {token} = req.body; 
       
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const {sub:googleId,email,name} = payload; 
        
        let userExists = await pool.query(`SELECT * FROM users WHERE email = $1`,[email]);
        let user;

        if(userExists.rows.length > 0){
             user = userExists.rows[0];
            if(!user.google_id){
                await pool.query(`UPDATE users SET google_id = $1 WHERE email = $2`,[googleId,email]);

                trackEvent(user.id,'user_login',{provider:'google'});
            }
        }else{

            let newUser = await pool.query(`INSERT INTO users(name,email,google_id) VALUES ($1,$2,$3) RETURNING id, name, email`,[name,email,googleId]);

            user = newUser.rows[0];

            trackEvent(user.id,'user_signup',{provider:'google'});
        }

        const jwtToken = generateToken(user.id);

        let displayName = user.name;
        if(user.email===process.env.SP_EMAIL) displayName = process.env.SP_NAME

        return res.status(200).json({user:{
            id:user.id,
            email: user.email,
            name:displayName
        },jwtToken});

    } catch (error) {
        console.error(`google auth error: ${error}`);
        return res.status(401).json({success:false,message:"Invalid google auth token."});
    }
  
}

export const forgotPassword = async(req,res)=>{

        const {email} = req.body;

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSCODE
            }
        });

        try {
            const userExists = await pool.query(`SELECT * FROM  users WHERE email = $1`,[email]);

            if(userExists.rows.length === 0){ 
                return res.status(200).json({success:true,message:"If an account exists, a reset link has been sent."});
            }

            const user = userExists.rows[0];

            if(!user.password_hash && user.google_id){ 
                console.log(`User registred with google`);
                return res.status(400).json({success:false,message:"User registred via google."});
            }

            const resetToken = crypto.randomBytes(20).toString('hex');
            const expireDate = new Date(Date.now()+3600000);

            await pool.query(`UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE email = $3`,[resetToken,expireDate,email]);

            const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

            await transporter.sendMail({
                from: `"buqs-reset-password" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Password reset link',
                 html: `
                <h3>Password Reset</h3>
                <p>Click below to reset your password:</p>

                <a href="${resetUrl}">
                    Reset Password
                </a>

                <p>This link expires in 1 hour.</p>
            `
            })

            return res.status(200).json({success:true,message:`Email sent succesfully.`});
        } catch (error) {
            console.error(`nodemailer catch block error: ${error}`);
            return res.status(500).json({success:false,message:"Internal server error"});
        }

    }

    export const resetPassword = async(req,res)=>{
        const {resetToken} = req.params;
        const {password: newPassword} = req.body;

        try {
            const userExists = await pool.query(`SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()`,[resetToken]);

            if(userExists.rows.length === 0){
                return res.status(400).json({success:false,message:"Password link has expired/Invalid token"});
            }

            const user = userExists.rows[0];

            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(newPassword,salt);

            await pool.query(`UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2`,[passwordHash,user.id]);

            res.status(200).json({success:true,message:"Password Updated Succesfully. Login with your new password."});
        } catch (error) {
            
        }
    }