
import { logger } from "../../utils/logger";

describe("logger error serialization", () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  test("Error instances are serialized with name, message, and stack", () => {
    const err = new Error("boom");
    logger.error("Failed", { err });

    const output = stderrSpy.mock.calls[0][0];
    const contextJson = output.substring(output.indexOf("{"));
    const parsed = JSON.parse(contextJson);

    expect(parsed.err.message).toBe("boom");
    expect(parsed.err.name).toBe("Error");
    expect(parsed.err.stack).toBeDefined();
  });

  test("Nested cause is preserved", () => {
    const cause = new Error("root cause");
    const err = new Error("outer", { cause });
    logger.error("Failed", { err });

    const output = stderrSpy.mock.calls[0][0];
    const contextJson = output.substring(output.indexOf("{"));
    const parsed = JSON.parse(contextJson);

    expect(parsed.err.cause.message).toBe("root cause");
  });

  test("Non-Error context is unchanged", () => {
    logger.error("Failed", { user: "alice", count: 42 });

    const output = stderrSpy.mock.calls[0][0];
    const contextJson = output.substring(output.indexOf("{"));
    const parsed = JSON.parse(contextJson);

    expect(parsed.user).toBe("alice");
    expect(parsed.count).toBe(42);
  });
});
