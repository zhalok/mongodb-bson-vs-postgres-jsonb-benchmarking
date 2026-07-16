import { MongoClient } from "mongodb";

const client = new MongoClient("mongodb://mongo:mongo@localhost:27017");

await client.connect();

export const db = client.db("jsonb_experiments");
