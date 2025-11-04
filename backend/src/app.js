import express from "express";
import { createServer } from "node:http";
import mongoose from "mongoose";
import cors from "cors";
import { connectToSocket } from "./controllers/socketmanager.js";
import userRoutes from "./routes/users.routes.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ limit: "40kb", extended: true }));

const server = createServer(app);
const io = connectToSocket(server);

app.set("port", process.env.PORT || 8000);

app.use("/api/v1/users", userRoutes);


const start = async () => {
  try {
    console.log("Connecting to MongoDB...");
    const connectionDb = await mongoose.connect(
      "mongodb+srv://malakara460_db_user:KRSvBs6rr89aC56B@cluster0.0mfwsfi.mongodb.net/nexcall?retryWrites=true&w=majority&appName=Cluster0"
    );
    console.log(`Mongo connected: ${connectionDb.connection.host}`);

    server.listen(app.get("port"), () =>
      console.log(`Server running on port ${app.get("port")}`)
    );
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
  }
};

start();
