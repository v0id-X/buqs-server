import jwt from 'jsonwebtoken';

export const protectRoute = async(req,res,next)=>{
    let token;
    
    if(req.headers.authorization && req.headers.authorization.startsWith(`Bearer`)){
        try {
            token = req.headers.authorization.split(' ')[1];

            const decoded = jwt.verify(token,process.env.JWT_SECRET);

            req.user = decoded;

            next();
        } catch (error) {
            console.log(`middleware catchblock error: ${error}`);
            return res.status(401).json({success:false,message:"Not authorized, token failed"});
        }
    }

    if(!token){
        return res.status(401).json({success:false,message:"Not authorized, token not found"});
    }
}