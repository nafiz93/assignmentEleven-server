const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./assetverseFirebaseAdmingKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


app.use(cors());
app.use(express.json());

const verifyFireBaseToken = async (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
    const token = authorization.split(' ')[1];
    
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        console.log('inside token', decoded)
        req.token_email = decoded.email;
        next();
    }
    catch (error) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
}

app.get("/", (req, res) => res.send("Server running"));

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

  // Collections
  const usersCollection = db.collection("users");
  const assetsCollection = db.collection("assets");
  const employeeCompanyCollection = db.collection("employeeCompany");
  const requestsCollection = db.collection("requests"); // NEW

  // ==========================================================
  // USERS (Register/Login role data)
  // ==========================================================

  app.post("/users/register", async (req, res) => {
    try {
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
        companyLogo,

        // HR-only
        companyName: role === "hr" ? companyName : undefined,
     
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
    } catch (err) {
      console.error("POST /users/register error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get("/users/me", async (req, res) => {
    try {
      const { uid } = req.query;
      if (!uid) return res.status(400).send({ message: "uid is required" });

      const user = await usersCollection.findOne({ uid });
      if (!user) return res.status(404).send({ message: "User not found" });

      res.send(user);
    } catch (err) {
      console.error("GET /users/me error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Returns all users (projection only companyName)
  app.get("/users/list", async (req, res) => {
    try {
      const list = await usersCollection
        .find({}, { projection: { companyName: 1 } })
        .toArray();
      res.json(list);
    } catch (err) {
      console.error("GET /users/list error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  //*******************************approve all API is here ******************************************
  app.get("/users",verifyFireBaseToken, async (req, res) => {
    try {
      const { uid } = req.query;
      if (!uid) return res.status(400).send({ message: "uid is required" });

      const user = await usersCollection.findOne({ uid });
      if (!user) return res.status(404).send({ message: "User not found" });

      res.send(user);
    } catch (err) {
      console.error("GET /users error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });


  app.patch("/users",verifyFireBaseToken, async (req, res) => {   
  try {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ message: "uid is required" });

    const { name, email, companyLogo } = req.body;

    const updateDoc = {};
    if (name !== undefined) updateDoc.name = name;
    if (email !== undefined) updateDoc.email = email;
    if (companyLogo !== undefined) updateDoc.companyLogo = companyLogo;

    const result = await usersCollection.updateOne(
      { uid },
      { $set: updateDoc }
    );

    return res.json({ message: "User updated", modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error("PATCH /users error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});


  app.patch("/requests/:requestId/approve",verifyFireBaseToken, async (req, res) => {
    try {
      const { requestId } = req.params;
      const { userId } = req.body; // Firebase UID of HR

      if (!requestId)
        return res.status(400).send({ message: "request id is required" });
      if (!userId)
        return res.status(400).send({ message: "user ID is required" });

      // Validate requestId ObjectId
      let requestObjectId;
      try {
        requestObjectId = new ObjectId(requestId);
      } catch {
        return res.status(400).json({ message: "Invalid requestId" });
      }

      const hrUser = await usersCollection.findOne({ uid: userId });
      if (!hrUser) return res.status(400).json({ message: "HR not found" });
      if (hrUser.role !== "hr")
        return res.status(400).json({ message: "not HR" });

      // IMPORTANT FIX: companyId must be HR user's Mongo _id, not Firebase UID
      const requestDoc = await requestsCollection.findOne({
        _id: requestObjectId,
        companyId: hrUser._id,
      });

      if (!requestDoc)
        return res.status(404).send({ message: "request not found" });

      if (requestDoc.status !== "pending") {
        return res
          .status(400)
          .json({ message: `request already ${requestDoc.status}` });
      }

      const asset = await assetsCollection.findOne({
        _id: new ObjectId(requestDoc.assetId),
        companyId: hrUser._id,
      });

      if (!asset) {
        return res.status(404).json({ message: "asset not found" });
      }

      if (asset.quantity <= 0)
        return res.status(400).json({ message: "item is out of stock" });

      const exist = await employeeCompanyCollection.findOne({
        companyId: hrUser._id,
        employeeUid: requestDoc.employeeUid,
      });

      if (!exist) {
        const limit = hrUser.packageLimit ?? 5;
        const current = hrUser.currentEmployees ?? 0;

        if (current >= limit) {
          return res.status(400).json({ message: "Employee limit reached" });
        }

        await employeeCompanyCollection.insertOne({
          companyId: hrUser._id,
          employeeUid: requestDoc.employeeUid, // FIX: requestDoc not reqDoc
          joinedAt: new Date(),
        });

        await usersCollection.updateOne(
          { _id: hrUser._id },
          { $inc: { currentEmployees: 1 } }
        );
      }

      // 8) reduce asset qty
      await assetsCollection.updateOne(
        { _id: asset._id },
        { $inc: { quantity: -1 } }
      );

      // 9) approve request
      await requestsCollection.updateOne(
        { _id: requestDoc._id }, // FIX: requestDoc not reqDoc
        { $set: { status: "approved", approvedAt: new Date() } }
      );

      res.json({
        message: exist ? "Approved (old employee)" : "Approved (new employee)", // FIX: exist not exits
      });
    } catch (err) {
      console.error("error is here", err);
      res.status(500).json({ message: "internal server error" });
    }
  });

  // PATCH /requests/:requestId/reject
  // Purpose: HR rejects request (only status update)
  app.patch("/requests/:requestId/reject",verifyFireBaseToken, async (req, res) => {
    try {
      const { requestId } = req.params;

      await requestsCollection.updateOne(
        { _id: new ObjectId(requestId) },
        { $set: { status: "rejected", rejectedAt: new Date() } }
      );

      res.json({ message: "Rejected" });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  //******************************approve************************************************ */
  // ==========================================================
  // EMPLOYEE FIRST LOGIN SUPPORT
  // ==========================================================

  // Employee dropdown: show ONLY HR companies
  app.get("/companies/list",verifyFireBaseToken,async (req, res) => {
    try {
      const list = await usersCollection
        .find(
          { role: "hr" },
          { projection: { companyName: 1, companyLogo: 1 } }
        )
        .toArray();

      res.json(list);
    } catch (err) {
      console.error("GET /companies/list error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Check if employee already affiliated
  app.get("/employee-company",verifyFireBaseToken, async (req, res) => {
    try {
      const { employeeUid } = req.query;
      if (!employeeUid) {
        return res.status(400).json({ message: "employeeUid is required" });
      }

      const record = await employeeCompanyCollection.findOne({ employeeUid });
      if (!record) {
        return res.status(404).json({ message: "No company yet" });
      }

      res.json(record); // { employeeUid, companyId, joinedAt }
    } catch (err) {
      console.error("GET /employee-company error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // NEW: persist employee affiliation when employee selects a company
  // Body: { employeeUid, companyId }
  app.post("/employee-company", async (req, res) => {
    try {
      const { employeeUid, companyId } = req.body;

      if (!employeeUid || !companyId) {
        return res
          .status(400)
          .json({ message: "employeeUid and companyId are required" });
      }

      // Validate companyId is a valid ObjectId and exists as an HR user
      let companyObjectId;
      try {
        companyObjectId = new ObjectId(companyId);
      } catch {
        return res.status(400).json({ message: "Invalid companyId" });
      }

      const hrCompany = await usersCollection.findOne({
        _id: companyObjectId,
        role: "hr",
      });

      if (!hrCompany) {
        return res.status(404).json({ message: "Company (HR) not found" });
      }

      // Upsert: employee can only have 1 company in this model
      await employeeCompanyCollection.updateOne(
        { employeeUid },
        {
          $set: {
            employeeUid,
            companyId: companyObjectId,
            joinedAt: new Date(),
          },
        },
        { upsert: true }
      );

      res.json({ message: "Employee company saved", companyId });
    } catch (err) {
      console.error("POST /employee-company error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // ==========================================================
  // ASSETS (HR CRUD) + (Employee view by company)
  // ==========================================================

  // HR adds asset (companyId = HR user's _id)
  app.post("/assets",verifyFireBaseToken, async (req, res) => {
    try {
      const hrUid = req.body.hrUid || req.body.hruid; // accept both keys
      const { name, type, quantity, image } = req.body;

      if (!hrUid || !name || quantity === undefined) {
        return res
          .status(400)
          .json({ message: "hrUid/hruid, name, quantity are required" });
      }

      const hrUser = await usersCollection.findOne({ uid: hrUid });
      if (!hrUser)
        return res.status(404).json({ message: "HR user not found" });
      if (hrUser.role !== "hr")
        return res.status(403).json({ message: "Only HR can add assets" });

      await assetsCollection.insertOne({
        companyId: hrUser._id, // company = HR user's _id
        hrUid: hrUser.uid,
        name,
        type: type || "general",
        quantity: Number(quantity),
        image,
        createdAt: new Date(),
      });

      res.json({ message: "Asset added" });
    } catch (err) {
      console.error("POST /assets error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // HR lists assets of their own company
  // GET /assets?uid=HR_UID
  app.get("/assets",verifyFireBaseToken, async (req, res) => {
    try {
      const { uid } = req.query;
      if (!uid) return res.status(400).json({ message: "uid is required" });

      const user = await usersCollection.findOne({ uid });
      if (!user) return res.status(404).json({ message: "User not found" });

      const list = await assetsCollection
        .find({ companyId: user._id })
        .toArray();
      res.json(list);
    } catch (err) {
      console.error("GET /assets error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Employee loads assets (query version)
  // GET /assets/by-company?companyId=xxx
  app.get("/assets/by-company", async (req, res) => {
    try {
      const { companyId } = req.query;
      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const list = await assetsCollection
        .find({ companyId: new ObjectId(companyId) })
        .toArray();

      res.json(list);
    } catch (err) {
      console.error("GET /assets/by-company error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

app.get('/employees/incompany',verifyFireBaseToken, async (req, res) => {
  try {
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({ message: "company id is required" });
    }

    const employees = await employeeCompanyCollection
      .find({ companyId: new ObjectId(companyId) })
      .toArray();

    res.json(employees);
  } catch (err) {
    console.log("GET /employees/incompany error:", err);
    res.status(500).json({ message: "internal server error" });
  }
});


  // Employee loads assets (param version) - FIXED (no double slash)
  // GET /assets/:companyId
  app.get("/assets/:companyId", verifyFireBaseToken, async (req, res) => {
    try {
      const { companyId } = req.params;

      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const companyObjectId = new ObjectId(companyId);

      const assets = await assetsCollection
        .find({ companyId: companyObjectId })
        .toArray();

      res.json(assets);
    } catch (err) {
      console.error("GET /assets/:companyId error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // DELETE /assets/:id?uid=HR_UID
  app.delete("/assets/:id",verifyFireBaseToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { uid } = req.query;

      if (!uid) return res.status(400).json({ message: "uid is required" });

      const asset = await assetsCollection.findOne({ _id: new ObjectId(id) });
      if (!asset) return res.status(404).json({ message: "Asset not found" });

      if (asset.hrUid !== uid) {
        return res.status(403).json({ message: "Not allowed" });
      }

      await assetsCollection.deleteOne({ _id: new ObjectId(id) });
      res.json({ message: "Asset deleted" });
    } catch (err) {
      console.error("DELETE /assets/:id error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // PATCH /assets/:id?uid=HR_UID
  app.patch("/assets/:id",verifyFireBaseToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { uid } = req.query;
      const { name, type, quantity, image } = req.body;

      if (!uid) return res.status(400).json({ message: "uid is required" });

      const asset = await assetsCollection.findOne({ _id: new ObjectId(id) });
      if (!asset) return res.status(404).json({ message: "Asset not found" });

      if (asset.hrUid !== uid) {
        return res.status(403).json({ message: "Not allowed" });
      }

      if (quantity !== undefined && Number(quantity) > 15) {
        return res
          .status(400)
          .json({ message: "Quantity cannot be more than 15" });
      }

      const updateDoc = {};
      if (name !== undefined) updateDoc.name = name;
      if (type !== undefined) updateDoc.type = type;
      if (quantity !== undefined) updateDoc.quantity = Number(quantity);
      if (image !== undefined) updateDoc.image = image;

      await assetsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateDoc }
      );

      res.json({ message: "Asset updated" });
    } catch (err) {
      console.error("PATCH /assets/:id error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // ==========================================================
  // REQUESTS (Employee -> HR)
  // ==========================================================

  // Frontend calls POST http://localhost:3000/requests
  // Body: { employeeUid, employeeEmail, companyId, assetId }
  app.post("/requests", async (req, res) => {
    try {
      const { employeeUid, employeeEmail, companyId, assetId } = req.body;

      if (!employeeUid || !employeeEmail || !companyId || !assetId) {
        return res.status(400).json({
          message:
            "employeeUid, employeeEmail, companyId, assetId are required",
        });
      }

      const companyObjectId = new ObjectId(companyId);
      const assetObjectId = new ObjectId(assetId);

      // Optional: validate asset belongs to company
      const asset = await assetsCollection.findOne({ _id: assetObjectId });
      if (!asset) return res.status(404).json({ message: "Asset not found" });

      if (String(asset.companyId) !== String(companyObjectId)) {
        return res
          .status(400)
          .json({ message: "Asset does not belong to this company" });
      }

      // Optional: block if out of stock
      if (Number(asset.quantity) <= 0) {
        return res.status(400).json({ message: "Asset out of stock" });
      }

      // Create request
      const doc = {
        employeeUid,
        employeeEmail,
        companyId: companyObjectId,
        assetId: assetObjectId,
        status: "pending",
        createdAt: new Date(),
      };

      const result = await requestsCollection.insertOne(doc);

      res.json({ message: "Request created", requestId: result.insertedId });
    } catch (err) {
      console.error("POST /requests error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Optional: HR fetch requests by company
  // GET /requests?companyId=...
  app.get("/requests", async (req, res) => {
    try {
      const { companyId } = req.query;
      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const list = await requestsCollection
        .find({ companyId: new ObjectId(companyId) })
        .sort({ createdAt: -1 })
        .toArray();

      res.json(list);
    } catch (err) {
      console.error("GET /requests error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });
  app.get("/requests/myasset",verifyFireBaseToken , async (req, res) => {
    try {
      const { empid } = req.query;
      if (!empid) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const list = await requestsCollection
        .find({employeeUid:empid})
        .sort({ createdAt: -1 })
        .toArray();

      res.json(list);
    } catch (err) {
      console.error("GET /requests error:", err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });


// SIMPLE PLAN DATA 

const PLANS = {
  standard: { plan: "standard", priceCents: 1200, limit: 10 }, // $12, limit 10
  premium: { plan: "premium", priceCents: 1500, limit: 15 },   // $15, limit 15
};

//make the json from the PREMIUM_PLAN

app.get("/plans", async (req, res) => {
  res.json(Object.values(PLANS));
});




//Create the session of stripe

app.post("/create-checkout", async (req, res) => {
  try {
    const { uId, plan } = req.body;

    if (!uId) return res.status(400).json({ message: "uId is required" });
    if (!plan) return res.status(400).json({ message: "plan is required" });

    const chosenPlan = PLANS[plan];
    if (!chosenPlan) return res.status(400).json({ message: "Invalid plan" });

    // Verify HR user
    const hrUser = await usersCollection.findOne({ uid: uId });
    if (!hrUser) return res.status(404).json({ message: "User not found" });
    if (hrUser.role !== "hr")
      return res.status(403).json({ message: "Only HR can upgrade" });

    // (UX-level block should be frontend; backend still protects DB later)
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Upgrade: ${chosenPlan.plan}` },
            unit_amount: chosenPlan.priceCents,
          },
          quantity: 1,
        },
      ],
      success_url: `http://localhost:5173/payment-success?uId=${uId}&plan=${chosenPlan.plan}`,
      cancel_url: `http://localhost:5173/payment-cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("POST /create-checkout error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


//set the patch method for the after the successfull payment 

app.patch("/upgrade-after-payment", async (req, res) => {
  try {
    const { uId, plan } = req.body;

    if (!uId) return res.status(400).json({ message: "uId is required" });
    if (!plan) return res.status(400).json({ message: "plan is required" });

    const chosenPlan = PLANS[plan];
    if (!chosenPlan) return res.status(400).json({ message: "Invalid plan" });

    const hrUser = await usersCollection.findOne({ uid: uId });
    if (!hrUser) return res.status(404).json({ message: "User not found" });
    if (hrUser.role !== "hr")
      return res.status(403).json({ message: "Only HR can upgrade" });

    // Prevent double-upgrade DB update (safety net)
    if (
      hrUser.subscription === chosenPlan.plan &&
      hrUser.packageLimit === chosenPlan.limit
    ) {
      return res.json({ message: `Already on ${chosenPlan.plan}` });
    }

    await usersCollection.updateOne(
      { uid: uId },
      {
        $set: {
          subscription: chosenPlan.plan,  // "standard" or "premium"
          packageLimit: chosenPlan.limit, // 10 or 15
        },
      }
    );

    res.json({ message: `Upgraded to ${chosenPlan.plan}` });
  } catch (err) {
    console.error("PATCH /upgrade-after-payment error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
  console.log("MongoDB connected");
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
