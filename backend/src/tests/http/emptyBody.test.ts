import request from "supertest";
import { createApp } from "../../app/index";
import * as review from "../../adapters/supabase/reviewRepositories";
import { getSupabaseClient } from "../../adapters/supabase/client";

jest.mock("../../adapters/supabase/reviewRepositories");
jest.mock("../../adapters/supabase/client");

const mockGetUser = jest.fn();
(getSupabaseClient as jest.Mock).mockReturnValue({ auth: { getUser: mockGetUser } });

// Express 5 leaves req.body undefined when a request carries no body, so a
// handler that destructures it throws and the client gets a 500.
describe("body-less requests", () => {
  const app = createApp();

  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "lead-1" } }, error: null });
    (review.getAppUserById as jest.Mock).mockResolvedValue({
      id: "lead-1", email: "lead@shpe.test", displayName: "Lead", role: "lead", membershipStatus: "active",
    });
  });

  const routes: Array<["post" | "put", string]> = [
    ["post", "/api/system/kill-switch"],
    ["post", "/api/strategies/configs"],
    ["put", "/api/strategies/configs/x"],
    ["post", "/api/strategies/start"],
    ["post", "/api/strategies/x/versions"],
    ["post", "/api/proposals"],
    ["post", "/api/proposals/x/approve"],
    ["post", "/api/proposals/x/reject"],
    ["post", "/api/proposals/x/comments"],
    ["post", "/api/backtests/run"],
  ];

  test.each(routes)("%s %s without a body is a 400, not a 500", async (method, path) => {
    const res = await request(app)[method](path).set("Authorization", "Bearer valid");
    expect(res.status).toBe(400);
  });
});
