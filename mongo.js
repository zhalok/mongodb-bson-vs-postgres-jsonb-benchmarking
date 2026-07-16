import { MongoClient } from "mongodb";

const client = new MongoClient(`mongodb://mongo:mongo@${process.env.HOST || "localhost"}:27017`);

await client.connect();

export const db = client.db("jsonb_experiments");
