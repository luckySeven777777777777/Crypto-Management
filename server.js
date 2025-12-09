
// Minimal server.js placeholder with update endpoint
const express = require("express");
const app = express();
app.use(express.json());

function verifyAdmin(req){ return {id:"发财"}; } // placeholder
const db = {
  collection: (name)=>({
    doc:(id)=>({
      async get(){ return { exists:true, data:()=>({}) }; },
      async update(obj){ console.log("update", name, id, obj); }
    })
  })
};

app.post("/api/transaction/update", async (req,res)=>{
  try{
    const admin = await verifyAdmin(req);
    if(!admin) return res.status(401).json({ok:false});
    const {orderId,type,status,note} = req.body;
    return res.json({ok:true});
  }catch(e){
    return res.status(500).json({ok:false});
  }
});

app.listen(3000, ()=>console.log("server running"));
