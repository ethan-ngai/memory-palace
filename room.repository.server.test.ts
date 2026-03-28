import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const roomsState: Array<{
  _id: ObjectId;
  userId: string;
  name: string;
  slug: string;
  description: string;
  conceptCount: number;
  createdAt: Date;
  updatedAt: Date;
}> = [];

const roomsCollection = {
  createIndex: vi.fn(async () => "ok"),
  find: vi.fn((query: { userId: string }) => ({
    sort: (sort: { updatedAt: 1 | -1 }) => ({
      toArray: async () =>
        [...roomsState]
          .filter((room) => room.userId === query.userId)
          .sort((left, right) =>
            sort.updatedAt === -1
              ? right.updatedAt.getTime() - left.updatedAt.getTime()
              : left.updatedAt.getTime() - right.updatedAt.getTime(),
          ),
    }),
  })),
  findOne: vi.fn(async (query: { userId: string; slug: string }) => {
    return (
      roomsState.find((room) => room.userId === query.userId && room.slug === query.slug) ?? null
    );
  }),
  findOneAndUpdate: vi.fn(
    async (
      query: { userId?: string; slug?: string; _id?: ObjectId },
      update: {
        $setOnInsert?: Omit<(typeof roomsState)[number], never>;
        $inc?: { conceptCount: number };
        $set?: { updatedAt: Date };
      },
    ) => {
      if (query.userId && query.slug && update.$setOnInsert) {
        const existing = roomsState.find(
          (room) => room.userId === query.userId && room.slug === query.slug,
        );

        if (existing) {
          return existing;
        }

        roomsState.push(update.$setOnInsert);
        return update.$setOnInsert;
      }

      if (query._id && update.$inc && update.$set) {
        const existing = roomsState.find((room) => room._id.equals(query._id!));

        if (!existing) {
          return null;
        }

        existing.conceptCount += update.$inc.conceptCount;
        existing.updatedAt = update.$set.updatedAt;
        return existing;
      }

      return null;
    },
  ),
};

vi.mock("@/lib/server/mongodb.server", () => ({
  getDatabase: vi.fn(async () => ({
    collection: () => roomsCollection,
  })),
}));

describe("room repository", () => {
  beforeEach(() => {
    roomsState.length = 0;
    vi.clearAllMocks();
  });

  it("creates and lists user-scoped rooms", async () => {
    const { createRoomForUser, listRoomsByUserId } =
      await import("@/features/concept-extraction/server/room.repository.server");

    const created = await createRoomForUser({
      userId: "user-1",
      name: "Science",
      slug: "science",
      description: "STEM concepts",
    });

    expect(created.slug).toBe("science");

    const listed = await listRoomsByUserId("user-1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("Science");
  });

  it("allows the same slug for different users because uniqueness is scoped by userId", async () => {
    const { createRoomForUser, findRoomByUserIdAndSlug } =
      await import("@/features/concept-extraction/server/room.repository.server");

    await createRoomForUser({
      userId: "user-1",
      name: "Science",
      slug: "science",
      description: "STEM concepts",
    });
    await createRoomForUser({
      userId: "user-2",
      name: "Science",
      slug: "science",
      description: "Different owner",
    });

    const userOneRoom = await findRoomByUserIdAndSlug("user-1", "science");
    const userTwoRoom = await findRoomByUserIdAndSlug("user-2", "science");

    expect(userOneRoom?.id).not.toBe(userTwoRoom?.id);
  });

  it("increments concept counts on existing rooms", async () => {
    const { createRoomForUser, incrementRoomConceptCount } =
      await import("@/features/concept-extraction/server/room.repository.server");

    const created = await createRoomForUser({
      userId: "user-1",
      name: "Science",
      slug: "science",
      description: "STEM concepts",
    });

    const updated = await incrementRoomConceptCount(created.id, 2);
    expect(updated.conceptCount).toBe(2);
  });
});
