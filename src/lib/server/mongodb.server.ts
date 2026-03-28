/**
 * @file mongodb.server.ts
 * @description Creates and shares the MongoDB Atlas client used by server-side features.
 * @module server
 */
import { MongoClient, ServerApiVersion } from "mongodb";
import { getServerEnv } from "@/lib/env/server";

let mongoClient: MongoClient | undefined;

function createMongoClient() {
  const serverEnv = getServerEnv();

  return new MongoClient(serverEnv.MONGODB_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
}

/**
 * Returns the shared MongoDB client for this process.
 * @returns The singleton `MongoClient` instance.
 * @remarks
 * - Delays the actual network connection so imports remain cheap during tests and build-time route analysis.
 * - Keeps every repository on the same underlying client once database work begins.
 */
export async function getMongoClient() {
  mongoClient ??= createMongoClient();
  return mongoClient;
}

/**
 * Opens the configured application database.
 * @returns The MongoDB database selected by `MONGODB_DB_NAME`.
 * @remarks
 * - Performs `connect()` here instead of in module scope so only real database usage pays connection cost.
 * - Uses the same lazily created client as every other repository in the app.
 */
export async function getDatabase() {
  const serverEnv = getServerEnv();
  const client = await getMongoClient();
  await client.connect();
  return client.db(serverEnv.MONGODB_DB_NAME);
}
