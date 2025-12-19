const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server running");
});

const uri = `mongodb+srv://${process.env.MONGO_USER}:${encodeURIComponent(
  process.env.MONGO_PASSWORD
)}@${process.env.MONGO_CLUSTER}/${process.env.MONGO_DB}?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  await client.connect();

  const db = client.db(process.env.MONGO_DB);
  const usersCollection = db.collection("users");
  const assetsCollection = db.collection("assets"); // ✅ FIX: define assetsCollection

  // REGISTER USER (HR / EMPLOYEE)
  app.post("/users/register", async (req, res) => {
    const {
      uid,
      name,
      email,
      dateOfBirth,
      role,
      companyName,
      companyLogo,
      packageLimit,
      currentEmployees,
      subscription,
    } = req.body;

    if (!uid || !name || !email || !dateOfBirth || !role) {
      return res.status(400).send({ message: "Required fields missing" });
    }

    if (role === "hr" && (!companyName || !companyLogo)) {
      return res
        .status(400)
        .send({ message: "Company info required for HR" });
    }

    const payload = {
      uid,
      name,
      email,
      dateOfBirth,
      role,
      companyName: role === "hr" ? companyName : undefined,
      companyLogo: role === "hr" ? companyLogo : undefined,
      packageLimit: role === "hr" ? packageLimit ?? 5 : undefined,
      currentEmployees: role === "hr" ? currentEmployees ?? 0 : undefined,
      subscription: role === "hr" ? subscription ?? "basic" : undefined,
      createdAt: new Date(),
    };

    await usersCollection.updateOne(
      { uid },
      { $set: payload },
      { upsert: true }
    );

    res.send({ message: "User registered successfully" });
  });

  // GET CURRENT USER BY UID (LOGIN USES THIS)
  app.get("/users/me", async (req, res) => {
    const { uid } = req.query;

    if (!uid) {
      return res.status(400).send({ message: "uid is required" });
    }

    const user = await usersCollection.findOne({ uid });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send(user);
  });

  // POST /assets (fixed for your current frontend payload)
  app.post("/assets", async (req, res) => {
    try {
      const hrUid = req.body.hrUid || req.body.hruid; // accept both keys
      const { name, type, quantity, image } = req.body; // ✅ include image

      if (!hrUid || !name || quantity === undefined) {
        return res
          .status(400)
          .json({ message: "hrUid/hruid, name, quantity are required" });
      }

      const hrUser = await usersCollection.findOne({ uid: hrUid });
      if (!hrUser) return res.status(404).json({ message: "HR user not found" });
      if (hrUser.role !== "hr")
        return res.status(403).json({ message: "Only HR can add assets" });

      await assetsCollection.insertOne({
        companyId: hrUser._id,
        hrUid: hrUser.uid,
        name,
        type: type || "general",
        quantity: Number(quantity),
        image, // ✅ store image url sent from frontend
        createdAt: new Date(),
      });

      res.json({ message: "Asset added" });
    } catch (err) {
      console.error("POST /assets error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  console.log("MongoDB connected");
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
