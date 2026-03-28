import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/server/mongodb.server";
import type { AuthUser } from "@/features/auth/types";

type AuthUserDocument = {
  _id: ObjectId;
  auth0Sub: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: Date;
  updatedAt: Date;
};

function toAuthUser(document: AuthUserDocument): AuthUser {
  return {
    id: document._id.toHexString(),
    auth0Sub: document.auth0Sub,
    email: document.email,
    name: document.name,
    picture: document.picture,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

async function getUsersCollection() {
  const database = await getDatabase();
  return database.collection<AuthUserDocument>("users");
}

export async function findAuthUserById(id: string) {
  const users = await getUsersCollection();
  const user = await users.findOne({ _id: new ObjectId(id) });
  return user ? toAuthUser(user) : null;
}

export async function upsertAuthUserFromClaims(claims: {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}) {
  const users = await getUsersCollection();
  const now = new Date();

  const result = await users.findOneAndUpdate(
    { auth0Sub: claims.sub },
    {
      $set: {
        email: claims.email || `${claims.sub}@auth0.local`,
        name: claims.name || claims.email || "Memory Explorer",
        picture: claims.picture,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    {
      upsert: true,
      returnDocument: "after",
      includeResultMetadata: false,
    },
  );

  if (!result) {
    throw new Error("Failed to upsert Auth0 user.");
  }

  return toAuthUser(result);
}
