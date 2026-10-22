import {Router} from 'express';
const router =Router();
router.post('/verify',(req,res)=>{
    res.json({uid:req.user.uid,email:req.user.email});
});

export default router;