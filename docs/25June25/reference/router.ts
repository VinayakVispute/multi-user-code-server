import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;
dotenv.config();

app.use(
  cors({
    origin: "http://ec2-52-90-35-13.compute-1.amazonaws.com", // or use '*' for all origins
    methods: ["GET", "POST"],
    credentials: true, // if you're using cookies
  })
);

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.post("/ping", (req: Request, res: Response) => {
  // This endpoint can be used to keep the server alive
  console.log("Ping received");
  res.status(200).send("Pong");
});

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
