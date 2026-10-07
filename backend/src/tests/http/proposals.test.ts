/**
 * tests/http/proposals.test.ts
 *
 * Route-level gating for the review workflow: every endpoint requires a valid
 * session, and only a lead may settle a proposal.
 *
 * The Supabase auth call and the repositories are mocked — what's under test is
 * the middleware chain wiring, not Supabase itself.
 */

jest.mock("../../adapters/supabase/client");
jest.mock("../../adapters/supabase/reviewRepositories");
jest.mock("../../adapters/supabase/repositories");

import request from "supertest";
import { createApp } from "../../app/index";
import { getSupabaseClient } from "../../adapters/supabase/client";
import * as review from "../../adapters/supabase/reviewRepositories";

const mockGetUser = jest.fn();
(getSupabaseClient as jest.Mock).mockReturnValue({ auth: { getUser: mockGetUser } });

const mockGetAppUser = review.getAppUserById as jest.Mock;
const mockListPending = review.listPendingApprovals as jest.Mock;
const mockGetProposal = review.getProposalById as jest.Mock;

/** Signs the next request in as a member or a lead. */
function signedInAs(role: "member" | "lead", id = `user-${role}`) {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
  mockGetAppUser.mockResolvedValue({
    id,
    email: `${role}@shpe.test`,
    displayName: role,
    role,
    membershipStatus: "active",
  });
}

const app = createApp();

beforeEach(() => {
  jest.clearAllMocks();
  mockListPending.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
describe("authentication", () => {
  test("GET /api/proposals without a token returns 401", async () => {
    const res = await request(app).get("/api/proposals");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not signed in/i);
    expect(mockListPending).not.toHaveBeenCalled();
  });

  test("a signed-in account without active club membership returns 403", async () => {
    signedInAs("member");
    mockGetAppUser.mockResolvedValueOnce({
      id: "user-member", email: "member@shpe.test", displayName: "Member", role: "member", membershipStatus: "pending",
    });

    const res = await request(app).get("/api/proposals").set("Authorization", "Bearer valid");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/membership/i);
    expect(mockListPending).not.toHaveBeenCalled();
  });

  test("a malformed Authorization header is treated as signed out", async () => {
    const res = await request(app).get("/api/proposals").set("Authorization", "Basic abc123");

    expect(res.status).toBe(401);
  });

  test("a rejected token returns 401 and never reaches the handler", async () => {
    mockGetUser.mockResolvedValue({ data: null, error: { message: "bad jwt" } });

    const res = await request(app).get("/api/proposals").set("Authorization", "Bearer expired");

    expect(res.status).toBe(401);
    expect(mockListPending).not.toHaveBeenCalled();
  });

  test("a valid token with no club profile returns 403, not a blank queue", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "ghost" } }, error: null });
    mockGetAppUser.mockResolvedValue(null);

    const res = await request(app).get("/api/proposals").set("Authorization", "Bearer valid");

    // Signals that migration 0008's provisioning trigger hasn't been applied.
    expect(res.status).toBe(403);
    expect(res.body.detail).toMatch(/0008/);
  });

  test("a signed-in member reaches the queue", async () => {
    signedInAs("member");

    const res = await request(app).get("/api/proposals").set("Authorization", "Bearer valid");

    expect(res.status).toBe(200);
    expect(mockListPending).toHaveBeenCalled();
  });

  test("GET /api/auth/me returns the caller's profile and role", async () => {
    signedInAs("lead");

    const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer valid");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: "lead", email: "lead@shpe.test" });
  });
});

// ---------------------------------------------------------------------------
// Role gating — approving is what actually moves money
// ---------------------------------------------------------------------------
describe("role gating", () => {
  test("a member cannot approve a proposal", async () => {
    signedInAs("member");

    const res = await request(app)
      .post("/api/proposals/prop-1/approve")
      .set("Authorization", "Bearer valid")
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/lead/i);
    // The gate must stop the request before any proposal lookup happens.
    expect(mockGetProposal).not.toHaveBeenCalled();
  });

  test("a member cannot reject a proposal", async () => {
    signedInAs("member");

    const res = await request(app)
      .post("/api/proposals/prop-1/reject")
      .set("Authorization", "Bearer valid")
      .send({ reason: "no" });

    expect(res.status).toBe(403);
  });

  test("a lead passes the role gate and reaches the handler", async () => {
    signedInAs("lead");
    // No orchestrator on this app instance, so the handler's own 503 proves the
    // request got past both requireAuth and requireRole.
    mockGetProposal.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/proposals/prop-1/approve")
      .set("Authorization", "Bearer valid")
      .send({ expectedHeadVersionId: "ver-1" });

    expect(res.status).toBe(503);
    expect(res.body.detail).toMatch(/trading process/i);
  });

  test("a member may still withdraw — the author gate lives in the handler", async () => {
    signedInAs("member", "user-author");
    mockGetProposal.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/proposals/prop-1/withdraw")
      .set("Authorization", "Bearer valid")
      .send({});

    // 404 rather than 403: withdraw is not role-gated, so it reached the handler.
    expect(res.status).toBe(404);
  });
});
