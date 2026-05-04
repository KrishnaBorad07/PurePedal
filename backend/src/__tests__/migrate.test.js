jest.mock("../db/connection", () => ({
  pool: { connect: jest.fn() },
}));

jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock("fs");

const { pool } = require("../db/connection");
const fs = require("fs");
const { migrate } = require("../db/migrate");

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(mockClient);
  mockClient.query.mockResolvedValue({ rows: [] });
  mockClient.release.mockResolvedValue();
});

describe("migrate()", () => {
  it("creates schema_migrations table if it does not exist", async () => {
    fs.readdirSync.mockReturnValue([]);

    await migrate();

    const createCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("CREATE TABLE IF NOT EXISTS schema_migrations")
    );
    expect(createCall).toBeDefined();
  });

  it("applies unapplied migrations in filename order", async () => {
    fs.readdirSync.mockReturnValue(["002_bar.sql", "001_foo.sql"]);
    fs.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).includes("001_foo.sql")) return "ALTER TABLE foo ADD COLUMN x INT;";
      if (String(filePath).includes("002_bar.sql")) return "ALTER TABLE bar ADD COLUMN y INT;";
      return "";
    });

    // SELECT returns no previously applied migrations
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }) // SELECT applied
      .mockResolvedValueOnce({ rows: [] }) // run 001_foo.sql
      .mockResolvedValueOnce({ rows: [] }) // INSERT 001_foo.sql
      .mockResolvedValueOnce({ rows: [] }) // run 002_bar.sql
      .mockResolvedValueOnce({ rows: [] }); // INSERT 002_bar.sql

    await migrate();

    const insertCalls = mockClient.query.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO schema_migrations")
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1][0]).toBe("001_foo.sql");
    expect(insertCalls[1][1][0]).toBe("002_bar.sql");
  });

  it("does not re-apply already applied migrations", async () => {
    fs.readdirSync.mockReturnValue(["001_foo.sql", "002_bar.sql"]);
    fs.readFileSync.mockReturnValue("SELECT 1;");

    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [{ filename: "001_foo.sql" }] }) // SELECT applied
      .mockResolvedValueOnce({ rows: [] }) // run 002_bar.sql
      .mockResolvedValueOnce({ rows: [] }); // INSERT 002_bar.sql

    await migrate();

    const insertCalls = mockClient.query.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO schema_migrations")
    );
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][1][0]).toBe("002_bar.sql");
  });

  it("records each applied migration with its filename", async () => {
    fs.readdirSync.mockReturnValue(["001_foo.sql"]);
    fs.readFileSync.mockReturnValue("SELECT 1;");

    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }) // SELECT applied
      .mockResolvedValueOnce({ rows: [] }) // run migration
      .mockResolvedValueOnce({ rows: [] }); // INSERT

    await migrate();

    const insertCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO schema_migrations")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBe("001_foo.sql");
  });

  it("releases the db client in all cases", async () => {
    fs.readdirSync.mockReturnValue([]);

    await migrate();

    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
