const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const user = process.env.MONGO_USER;
const password = encodeURIComponent(process.env.MONGO_PASSWORD);

const uri = `mongodb+srv://${user}:${password}@${process.env.MONGO_CLUSTER}/${process.env.MONGO_DB}?appName=Cluster0`;

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db(process.env.MONGO_DB);
    const usersCollection = db.collection("users");

    // GET users (optional)
    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // Register (HR / Employee) -> upsert by email
    app.post("/users/register", async (req, res) => {
      const {
        name,
        companyName,
        companyLogo,
        email,
        password,
        dateOfBirth,
        role,
        packageLimit,
        currentEmployees,
        subscription,
      } = req.body;

      // Basic required fields (company fields only required for HR)
      if (!email || !password || !dateOfBirth || !role || !name) {
        return res.status(400).send({ message: "required fields missing" });
      }

      if (role === "hr") {
        if (!companyName || !companyLogo) {
          return res
            .status(400)
            .send({ message: "companyName and companyLogo are required for HR" });
        }
      }

      const payload = {
        name,
        email,
        password,
        dateOfBirth,
        role,
        companyName: role==="hr" ? companyName || "":undefined,
        companyLogo: role==="hr"?  companyLogo || "":undefined,
        packageLimit: role === "hr" ? packageLimit ?? 5 : undefined,
        currentEmployees: role === "hr" ? currentEmployees ?? 0 : undefined,
        subscription: role === "hr" ? subscription || "basic" : undefined,
      };

      await usersCollection.updateOne(
        { email },
        { $set: payload, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );

      res.send({ message: "User registered successfully" });
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // do not close client; keep server running
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`assetverse is running on port,${port}`);
});
