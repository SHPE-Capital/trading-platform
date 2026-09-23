/**
 * tests/http/governance.test.ts
 *
 * The contention summary: signed-in members only, bounded window.
 */

jest.mock("../../adapters/supabase/client");
jest.mock("../../adapters/supabase/reviewRepositories");
jest.mock("../../adapters/supabase/repositories");
jest.mock("../../adapters/supabase/riskRejectionRepository");

import request from "supertest";
import { createApp } from "../../app/index";
import { getSupabaseClient } from "../../adapters/supabase/client";
import * as review from "../../adapters/supabase/reviewRepositories";
import * as rejections from "../../adapters/supabase/riskRejectionRepository";

const mockGetUser = jest.fn();
(getSupabaseClient as jest.Mock).mockReturnValue({ auth: { getUser: mockGetUser } });
const mockSummary = rejections.getContentionSummary as jest.Mock;

function signIn() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  (review.getAppUserById as jest.Mock).mockResolvedValue({ id: "u1", email: "m@shpe.test", displayName: "M", role: "member" });
}

const app = createApp();

beforeEach(() => jest.clearAllMocks());

describe("GET /api/governance/contention", () => {
  test("requires a signed-in member", async () => {
    const res = await request(app).get("/api/governance/contention");
    expect(res.status).toBe(401);
    expect(mockSummary).not.toHaveBeenCalled();
  });

  test("defaults to a 7-day window", async () => {
    signIn();
    mockSummary.mockResolvedValue([{ ownerId: "u1", failedCheck: "STRATEGY_BUDGET", rejections: 12 }]);

    const res = await request(app).get("/api/governance/contention").set("Authorization", "Bearer t");

    expect(res.status).toBe(200);
    expect(mockSummary).toHaveBeenCalledWith(7);
    expect(res.body).toMatchObject({ days: 7, rows: [{ rejections: 12 }] });
  });

  test("rejects a window outside 1–90 days", async () => {
    signIn();
    const res = await request(app).get("/api/governance/contention?days=365").set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
  });
});
