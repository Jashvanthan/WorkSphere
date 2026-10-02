import { NextRequest } from "next/server";
import {
  GET as getAmenityVotes,
  POST as postAmenityVoteByVenue,
} from "@/app/api/venues/[venueId]/amenity-votes/route";
import { GET as getLeaderboard } from "@/app/api/venues/[venueId]/amenity-votes/leaderboard/route";
import { POST as postAmenityVoteGeneral } from "@/app/api/venues/amenity-vote/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "user-123" }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    amenityValidation: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    amenityVote: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    userBadge: {
      findMany: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

function makeRequest(url: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("Venue Amenity Voting and Leaderboard API", () => {
  const mockVenueId = "venue-abc-123";

  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: mockVenueId,
      name: "Cozy Workspace Cafe",
    });
  });

  describe("Submitting Amenity Upvotes & Vote Incrementing", () => {
    it("submitting an upvote increments count via /api/venues/[venueId]/amenity-votes", async () => {
      (prisma.amenityValidation.upsert as jest.Mock).mockResolvedValue({
        id: "val-wifi-1",
        venueId: mockVenueId,
        amenity: "wifi",
        upvotes: 2,
        downvotes: 0,
      });

      // User has not voted before
      (prisma.amenityVote.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.amenityVote.create as jest.Mock).mockResolvedValue({
        id: "vote-1",
        validationId: "val-wifi-1",
        userId: "user-123",
        isUpvote: true,
      });

      (prisma.amenityValidation.update as jest.Mock).mockResolvedValue({
        id: "val-wifi-1",
        venueId: mockVenueId,
        amenity: "wifi",
        upvotes: 3,
        downvotes: 0,
      });

      const req = makeRequest(
        `http://localhost/api/venues/${mockVenueId}/amenity-votes`,
        "POST",
        { amenity: "wifi", isUpvote: true },
      );

      const res = await postAmenityVoteByVenue(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.amenity).toBe("wifi");
      expect(data.upvotes).toBe(3);
      expect(data.downvotes).toBe(0);
      expect(data.confidenceScore).toBe(100);

      expect(prisma.amenityVote.create).toHaveBeenCalledWith({
        data: {
          validationId: "val-wifi-1",
          userId: "user-123",
          isUpvote: true,
        },
      });

      expect(prisma.amenityValidation.update).toHaveBeenCalledWith({
        where: { id: "val-wifi-1" },
        data: { upvotes: { increment: 1 } },
      });
    });

    it("submitting an upvote via general /api/venues/amenity-vote route increments count", async () => {
      (prisma.amenityValidation.upsert as jest.Mock).mockResolvedValue({
        id: "val-outlets-1",
        venueId: mockVenueId,
        amenity: "outlets",
        upvotes: 4,
        downvotes: 1,
      });

      (prisma.amenityVote.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.amenityVote.create as jest.Mock).mockResolvedValue({
        id: "vote-2",
        validationId: "val-outlets-1",
        userId: "user-123",
        isUpvote: true,
      });

      (prisma.amenityValidation.update as jest.Mock).mockResolvedValue({
        id: "val-outlets-1",
        venueId: mockVenueId,
        amenity: "outlets",
        upvotes: 5,
        downvotes: 1,
      });

      (prisma.amenityVote.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.userBadge.findMany as jest.Mock).mockResolvedValue([]);

      const req = makeRequest(
        "http://localhost/api/venues/amenity-vote",
        "POST",
        { venueId: mockVenueId, amenity: "outlets", isUpvote: true },
      );

      const res = await postAmenityVoteGeneral(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.upvotes).toBe(5);
      expect(data.downvotes).toBe(1);
      expect(data.confidenceScore).toBe(83); // 5 / (5 + 1) * 100 = 83%
    });
  });

  describe("Duplicate Vote Handling & Toggling", () => {
    it("returns current vote counts without incrementing when user submits duplicate identical vote", async () => {
      (prisma.amenityValidation.upsert as jest.Mock).mockResolvedValue({
        id: "val-wifi-1",
        venueId: mockVenueId,
        amenity: "wifi",
        upvotes: 5,
        downvotes: 1,
      });

      // User has already upvoted
      (prisma.amenityVote.findUnique as jest.Mock).mockResolvedValue({
        id: "existing-vote-1",
        validationId: "val-wifi-1",
        userId: "user-123",
        isUpvote: true,
      });

      const req = makeRequest(
        `http://localhost/api/venues/${mockVenueId}/amenity-votes`,
        "POST",
        { amenity: "wifi", isUpvote: true },
      );

      const res = await postAmenityVoteByVenue(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.upvotes).toBe(5);
      expect(data.downvotes).toBe(1);

      // Verify no create or update was made
      expect(prisma.amenityVote.create).not.toHaveBeenCalled();
      expect(prisma.amenityVote.update).not.toHaveBeenCalled();
      expect(prisma.amenityValidation.update).not.toHaveBeenCalled();
    });

    it("toggles vote from downvote to upvote and adjusts vote counts accordingly", async () => {
      (prisma.amenityValidation.upsert as jest.Mock).mockResolvedValue({
        id: "val-coffee-1",
        venueId: mockVenueId,
        amenity: "coffee",
        upvotes: 3,
        downvotes: 2,
      });

      // User previously downvoted
      (prisma.amenityVote.findUnique as jest.Mock).mockResolvedValue({
        id: "vote-coffee-1",
        validationId: "val-coffee-1",
        userId: "user-123",
        isUpvote: false,
      });

      (prisma.amenityVote.update as jest.Mock).mockResolvedValue({
        id: "vote-coffee-1",
        isUpvote: true,
      });

      (prisma.amenityValidation.update as jest.Mock).mockResolvedValue({
        id: "val-coffee-1",
        venueId: mockVenueId,
        amenity: "coffee",
        upvotes: 4,
        downvotes: 1,
      });

      const req = makeRequest(
        `http://localhost/api/venues/${mockVenueId}/amenity-votes`,
        "POST",
        { amenity: "coffee", isUpvote: true },
      );

      const res = await postAmenityVoteByVenue(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.upvotes).toBe(4);
      expect(data.downvotes).toBe(1);

      expect(prisma.amenityVote.update).toHaveBeenCalledWith({
        where: { id: "vote-coffee-1" },
        data: { isUpvote: true },
      });

      expect(prisma.amenityValidation.update).toHaveBeenCalledWith({
        where: { id: "val-coffee-1" },
        data: {
          upvotes: { increment: 1 },
          downvotes: { decrement: 1 },
        },
      });
    });
  });

  describe("Non-existent Venue ID Handling", () => {
    it("returns 404 when venue ID does not exist on GET /amenity-votes", async () => {
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

      const req = makeRequest(
        "http://localhost/api/venues/non-existent-venue/amenity-votes",
      );
      const res = await getAmenityVotes(req, {
        params: Promise.resolve({ venueId: "non-existent-venue" }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Venue not found");
    });

    it("returns 404 when venue ID does not exist on POST /amenity-votes", async () => {
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

      const req = makeRequest(
        "http://localhost/api/venues/non-existent-venue/amenity-votes",
        "POST",
        { amenity: "wifi", isUpvote: true },
      );
      const res = await postAmenityVoteByVenue(req, {
        params: Promise.resolve({ venueId: "non-existent-venue" }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Venue not found");
    });

    it("returns 404 when venue ID does not exist on GET /amenity-votes/leaderboard", async () => {
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

      const req = makeRequest(
        "http://localhost/api/venues/non-existent-venue/amenity-votes/leaderboard",
      );
      const res = await getLeaderboard(req, {
        params: Promise.resolve({ venueId: "non-existent-venue" }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Venue not found");
    });

    it("returns 404 when venue does not exist on POST /api/venues/amenity-vote", async () => {
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

      const req = makeRequest(
        "http://localhost/api/venues/amenity-vote",
        "POST",
        { venueId: "non-existent-venue", amenity: "wifi", isUpvote: true },
      );
      const res = await postAmenityVoteGeneral(req);

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Venue not found");
    });
  });

  describe("Leaderboard Sorting", () => {
    it("returns amenities sorted by vote count descending", async () => {
      (prisma.amenityValidation.findMany as jest.Mock).mockResolvedValue([
        {
          id: "val-quiet",
          venueId: mockVenueId,
          amenity: "quiet_area",
          upvotes: 4,
          downvotes: 1,
          votes: [
            { userId: "user-1", isUpvote: true },
            { userId: "user-2", isUpvote: true },
          ],
        },
        {
          id: "val-wifi",
          venueId: mockVenueId,
          amenity: "high_speed_wifi",
          upvotes: 15,
          downvotes: 2,
          votes: [
            { userId: "user-1", isUpvote: true },
            { userId: "user-3", isUpvote: true },
          ],
        },
        {
          id: "val-coffee",
          venueId: mockVenueId,
          amenity: "free_coffee",
          upvotes: 9,
          downvotes: 0,
          votes: [{ userId: "user-1", isUpvote: true }],
        },
      ]);

      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        {
          id: "user-1",
          firstName: "Alice",
          lastName: "Walker",
          accurateVotes: 12,
        },
        { id: "user-2", firstName: "Bob", lastName: "Smith", accurateVotes: 3 },
        {
          id: "user-3",
          firstName: "Charlie",
          lastName: "Brown",
          accurateVotes: 7,
        },
      ]);

      const req = makeRequest(
        `http://localhost/api/venues/${mockVenueId}/amenity-votes/leaderboard`,
      );
      const res = await getLeaderboard(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify amenities are sorted descending by upvotes
      expect(data.amenities).toHaveLength(3);
      expect(data.amenities[0].amenity).toBe("high_speed_wifi");
      expect(data.amenities[0].upvotes).toBe(15);
      expect(data.amenities[1].amenity).toBe("free_coffee");
      expect(data.amenities[1].upvotes).toBe(9);
      expect(data.amenities[2].amenity).toBe("quiet_area");
      expect(data.amenities[2].upvotes).toBe(4);

      // Verify leaderboard of voters is sorted descending by total votes
      expect(data.leaderboard.length).toBeGreaterThan(0);
      expect(data.leaderboard[0].userId).toBe("user-1"); // 3 votes total
      expect(data.leaderboard[0].totalVotes).toBe(3);
      expect(data.leaderboard[0].name).toBe("Alice Walker");
    });
  });

  describe("Authentication & Request Validation", () => {
    it("returns 401 when unauthorized user attempts to submit a vote", async () => {
      (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

      const req = makeRequest(
        `http://localhost/api/venues/${mockVenueId}/amenity-votes`,
        "POST",
        { amenity: "wifi", isUpvote: true },
      );
      const res = await postAmenityVoteByVenue(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 400 when amenity or isUpvote parameter is missing", async () => {
      const req = makeRequest(
        `http://localhost/api/venues/${mockVenueId}/amenity-votes`,
        "POST",
        { amenity: "" },
      );
      const res = await postAmenityVoteByVenue(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Missing required parameters");
    });

    it("returns 400 when request body contains invalid JSON", async () => {
      const req = new NextRequest(
        `http://localhost/api/venues/${mockVenueId}/amenity-votes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "invalid-json{",
        },
      );
      const res = await postAmenityVoteByVenue(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Invalid JSON body");
    });
  });

  describe("GET /api/venues/[venueId]/amenity-votes endpoint", () => {
    it("returns userVote and confidence metrics for all amenities", async () => {
      (prisma.amenityValidation.findMany as jest.Mock).mockResolvedValue([
        {
          id: "val-1",
          venueId: mockVenueId,
          amenity: "wifi",
          upvotes: 10,
          downvotes: 2,
          votes: [{ userId: "user-123", isUpvote: true }],
        },
        {
          id: "val-2",
          venueId: mockVenueId,
          amenity: "outlets",
          upvotes: 1,
          downvotes: 5,
          votes: [{ userId: "other-user", isUpvote: false }],
        },
      ]);

      const req = makeRequest(
        `http://localhost/api/venues/${mockVenueId}/amenity-votes`,
      );
      const res = await getAmenityVotes(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Wifi has userVote: true
      expect(data.metrics.wifi.userVote).toBe(true);
      expect(data.metrics.wifi.confidenceScore).toBe(83); // 10 / 12 * 100
      expect(data.metrics.wifi.hidden).toBe(false);

      // Outlets has userVote: null (current user didn't vote on it)
      expect(data.metrics.outlets.userVote).toBeNull();
      expect(data.metrics.outlets.confidenceScore).toBe(17); // 1 / 6 * 100
      expect(data.metrics.outlets.hidden).toBe(true); // total >= 5 and score < 60
    });
  });
});
