import { Redis } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL environment variable is not set");
}

const client = new Redis(process.env.REDIS_URL);

export default client;
