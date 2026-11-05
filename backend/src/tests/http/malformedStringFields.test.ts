import request from "supertest";
import { createApp } from "../../app/index";
import * as review from "../../adapters/supabase/reviewRepositories";
import { getSupabaseClient } from "../../adapters/supabase/client";

jest.mock("../../adapters/supabase/reviewRepositories");
jest.mock("../../adapters/supabase/client");

const mockGetUser = jest.fn();
(getSupabaseClient as jest.Mock).mockReturnValue({ auth: { getUser: mockGetUser } });

// name, strategy_type, change_summary and the decision note are all text
// columns, and the writes that carry them throw on a database error. A field
// checked only for truthiness lets an object or array through to the insert,
// where the client's own mistake comes back as a 500.
describe("wrong-typed string fields", () => {
  const app = createApp();

  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "lead-1" } }, error: null });
    (review.getAppUserById as jest.Mock).mockResolvedValue({
      id: "lead-1", email: "lead@shpe.test", displayName: "Lead", role: "lead", membershipStatus: "active",
    });
  });

  const cases: Array<["post" | "put", string, object, string]> = [
    // An array stringifies to a known key, so the type lookup alone misses it.
    ["post", "/api/strategies/configs", { strategy_type: ["pairs"], name: "n", config: {} }, "strategy_type is an array"],
    ["post", "/api/strategies/configs", { strategy_type: "pairs", name: {}, config: {} }, "name is an object"],
    ["put", "/api/strategies/configs/x", { name: [], config: {} }, "name is an array"],
    ["put", "/api/strategies/configs/x", { name: "n", config: {}, changeSummary: 5 }, "changeSummary is a number"],
    ["post", "/api/strategies/x/versions", { config: {}, changeSummary: [] }, "changeSummary is an array"],
    ["post", "/api/proposals/x/approve", { expectedHeadVersionId: "h", note: {} }, "note is an object"],
  ];

  test.each(cases)("%s %s with %p (%s) is a 400", async (method, path, body) => {
    const res = await request(app)[method](path).set("Authorization", "Bearer valid").send(body);
    expect(res.status).toBe(400);
  });
});
