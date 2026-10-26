import { describe, expect, it } from "vitest";
import { buildCreativeWhere, parseCreativeFilters, resolveExportFields } from "./filters";

describe("creative filters", () => {
  it("normalizes URL search params into a reusable creative filter model", () => {
    const filters = parseCreativeFilters(new URLSearchParams({
      advertiserId: "adv-1",
      country: "gb",
      status: "ACTIVE",
      format: "VIDEO",
      store: "GOOGLE_PLAY",
      appId: "cheap",
      dateField: "lastShownAt",
      dateFrom: "2026-01-01",
      dateTo: "2026-05-24",
      creativeIds: "CR1, CR2"
    }));

    expect(filters).toMatchObject({
      advertiserId: "adv-1",
      country: "GB",
      status: "ACTIVE",
      format: "VIDEO",
      store: "GOOGLE_PLAY",
      appId: "cheap",
      dateField: "lastShownAt",
      creativeIds: ["CR1", "CR2"]
    });
  });

  it("parses repeated selected creative ids from bulk export URLs", () => {
    const params = new URLSearchParams();
    params.append("creativeIds", "CR1");
    params.append("creativeIds", "CR2, CR3");

    expect(parseCreativeFilters(params).creativeIds).toEqual(["CR1", "CR2", "CR3"]);
  });

  it("supports collection activity filters for new and disappeared creatives", () => {
    const newToday = buildCreativeWhere({ activity: "NEW_TODAY" });
    const disappeared = buildCreativeWhere({ activity: "DISAPPEARED" });

    expect(newToday.firstFoundAt).toBeTruthy();
    expect(disappeared).toMatchObject({ status: "STOPPED" });
  });

  it("builds a Prisma where object shared by list and export screens", () => {
    const where = buildCreativeWhere({
      advertiserId: "adv-1",
      country: "GB",
      status: "ACTIVE",
      format: "VIDEO",
      store: "GOOGLE_PLAY",
      dateField: "firstShownAt",
      dateFrom: "2026-01-01",
      dateTo: "2026-05-24"
    });

    expect(where).toMatchObject({
      advertiserId: "adv-1",
      status: "ACTIVE",
      format: "VIDEO",
      firstShownAt: {
        gte: new Date("2026-01-01T00:00:00.000Z"),
        lte: new Date("2026-05-24T23:59:59.999Z")
      },
      app: { store: "GOOGLE_PLAY" },
      countries: { some: { countryCode: "GB" } }
    });
  });

  it("ignores empty filter fields submitted by dashboard forms", () => {
    const where = buildCreativeWhere({
      advertiserId: "",
      country: "",
      q: "CR063"
    });

    expect(where).toMatchObject({
      OR: [
        { creativeId: { contains: "CR063" } },
        { advertiser: { name: { contains: "CR063" } } },
        { advertiser: { googleAdvertiserId: { contains: "CR063" } } },
        { app: { appId: { contains: "CR063" } } },
        { app: { name: { contains: "CR063" } } }
      ]
    });
    expect(where).not.toHaveProperty("advertiserId");
    expect(where).not.toHaveProperty("countries");
  });

  it("keeps export fields ordered and limited to known columns", () => {
    expect(resolveExportFields("creativeId,unknown,status,appName")).toEqual(["creativeId", "appName", "status"]);
    expect(resolveExportFields(undefined)).toContain("creativeId");
  });
});
