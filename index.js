const express=require('express');
const cors=require ('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const user = process.env.MONGO_USER;
const password = encodeURIComponent(process.env.MONGO_PASSWORD);

const uri = `mongodb+srv://${user}:${password}@${process.env.MONGO_CLUSTER}/${process.env.MONGO_DB}?appName=Cluster0`;



//run the express

const app=express();
const port=process.env.PORT || 3000;

//middleware

app.use(cors());
app.use(express.json());

//Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
   
  }
}
run().catch(console.dir);

app.listen(port,()=>{
    console.log(`assetverse is running on port,${port}`)
})
