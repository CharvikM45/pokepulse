/** Transport-stub regression tests. These verify UI/API wiring, not hosted auth. */
import { test, expect, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  ruleInputSchema,
  preferencesSchema,
  preferencesPatchSchema,
} from "../../packages/contracts/src";
const user = "41111111-1111-4111-8111-111111111111";
const setId = "10000000-0000-4000-8000-000000000001";
const moss = "20000000-0000-4000-8000-000000000001";
const lantern = "20000000-0000-4000-8000-000000000003";
const respond = (route: Route, data: unknown) =>
  route.fulfill({
    status: 200,
    json: {
      data,
      meta: { request_id: crypto.randomUUID(), next_cursor: null },
    },
  });
const preferences = {
  in_app: true,
  web_push: false,
  zip: null,
  time_zone: "UTC",
  quiet_hours: null,
  daily_cap: 20,
};

test("adapter: report stays pending, staff publishes only reviewed notes, and unknown release dates stay unknown", async ({
  page,
  request,
}) => {
  const storeId = "30000000-0000-4000-8000-000000000001",
    reportId = "50000000-0000-4000-8000-000000000001";
  const products = (
    await (await request.get("/api/v1/products?limit=50")).json()
  ).data;
  let report: {
    moderation: string;
    revision: number;
    private_notes: string;
    public_notes: string | null;
    observed_at: string;
    expires_at: string;
  } | null = null;
  let release: Record<string, unknown> | null = null;
  await page.route("**/api/v1/me/session", (route) =>
    respond(route, { id: user }),
  );
  await page.route("**/api/v1/stores?*", (route) =>
    respond(route, {
      stores: [
        {
          id: storeId,
          name: "Lumen Demo Store",
          address: "Fictional address — do not visit",
          region: "DEMO",
          distance_mi: 0,
          latitude: 0,
          longitude: 0,
          directory_source: "Original synthetic directory",
          is_demo: true,
        },
      ],
      next_cursor: null,
    }),
  );
  await page.route(`**/api/v1/stores/${storeId}/sightings?*`, (route) =>
    respond(
      route,
      report?.moderation === "approved"
        ? [
            {
              id: reportId,
              store_id: storeId,
              product_id: setId,
              report_type: "found_stock",
              observed_at: report.observed_at,
              expires_at: report.expires_at,
              moderation: "approved",
              submitted_at: new Date().toISOString(),
              independent_confirmations: 0,
              conflict_count: 0,
              public_notes: report.public_notes,
              is_demo: true,
            },
          ]
        : [],
    ),
  );
  await page.route("**/api/v1/sightings", (route) => {
    const body = route.request().postDataJSON();
    expect(body).not.toHaveProperty("user_id");
    expect(body.product_id).toBe(setId);
    report = {
      moderation: "pending",
      revision: 0,
      private_notes: body.notes,
      public_notes: null,
      observed_at: body.observed_at,
      expires_at: new Date(Date.now() + 7200000).toISOString(),
    };
    return respond(route, { id: reportId, moderation: "pending" });
  });
  await page.route("**/api/v1/admin/collector", (route) =>
    respond(route, {
      authorized: true,
      hosts: ["example.com"],
      products: products.map((p: { id: string; name: string }) => ({
        id: p.id,
        name: p.name,
      })),
      releases: release ? [release] : [],
    }),
  );
  await page.route("**/api/v1/admin/sightings?*", (route) => {
    const state = new URL(route.request().url()).searchParams.get("state");
    return respond(route, {
      reports:
        report?.moderation === state
          ? [
              {
                id: reportId,
                store_name: "Lumen Demo Store",
                product_name: "Demo Starlight 1",
                report_type: "found_stock",
                is_demo: true,
                submitted_by_current_staff: false,
                ...report,
              },
            ]
          : [],
      next_cursor: null,
    });
  });
  await page.route(
    `**/api/v1/admin/sightings/${reportId}/moderate`,
    (route) => {
      const body = route.request().postDataJSON();
      expect(body.expected_revision).toBe(report!.revision);
      expect(body).not.toHaveProperty("actor_id");
      expect(body.public_notes).toBeNull();
      report = {
        ...report!,
        moderation: body.decision,
        public_notes: body.public_notes,
        revision: report!.revision + 1,
      };
      return respond(route, {
        id: reportId,
        moderation: report.moderation,
        revision: report.revision,
      });
    },
  );
  await page.route("**/api/v1/admin/collector/releases", (route) => {
    const body = route.request().postDataJSON();
    expect(body.entry.date).toBeNull();
    expect(body.entry.date_precision).toBe("unconfirmed");
    release = {
      ...body.entry,
      id: "95555555-5555-4555-8555-555555555555",
      revision: 1,
    };
    return respond(route, release);
  });
  await page.route("**/api/v1/releases?*", (route) =>
    respond(route, release ? [release] : []),
  );
  await page.goto("/local");
  await page.getByLabel("ZIP code").fill("00000");
  await page.getByRole("button", { name: "Find stores" }).click();
  await page
    .getByRole("button", { name: "Report at Lumen Demo Store" })
    .click();
  await page.getByLabel("Reported product (optional)").selectOption(setId);
  const local = await page.evaluate(() => {
    const date = new Date(Date.now() - 60000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  });
  await page.getByLabel("Observed time (your local time)").fill(local);
  await page.getByLabel("Optional notes").fill("Original private report draft");
  await page.getByRole("button", { name: "Submit for moderation" }).click();
  await expect(
    page.getByRole("heading", { name: "Report received for moderation" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View reports for Lumen Demo Store" })
    .click();
  await expect(page.getByText(/No current approved reports/)).toBeVisible();
  await page.goto("/staff/collector");
  await page
    .getByRole("button", { name: "Review report at Lumen Demo Store" })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Audit reason")
    .fill("Reviewed original synthetic observation");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(
    page.getByRole("heading", { name: "No reports in this queue" }),
  ).toBeVisible();
  await page.getByLabel("Release name").fill("Fictional date not announced");
  await page
    .getByLabel("Approved announcement URL")
    .fill("https://example.com/demo");
  await page
    .getByLabel("Source verified at (ISO UTC)")
    .fill(new Date(Date.now() - 1000).toISOString());
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Original fictional calendar fixture");
  await page.getByRole("button", { name: "Save sourced release" }).click();
  await expect(
    page.getByRole("option", { name: /Fictional date not announced/ }),
  ).toHaveCount(1);
  await page.goto("/local");
  await page.getByLabel("ZIP code").fill("00000");
  await page.getByRole("button", { name: "Find stores" }).click();
  await page
    .getByRole("button", { name: "View reports for Lumen Demo Store" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Found stock reported" }),
  ).toBeVisible();
  await expect(page.getByText("Original private report draft")).toHaveCount(0);
  await page.goto("/calendar");
  await expect(
    page.getByRole("heading", { name: "Fictional date not announced" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Date unconfirmed", exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/b-calendar-unconfirmed-360.png",
    fullPage: true,
  });
});

test("adapter: lost pack acknowledgment reuses its key, reload restores saved results and real edits stay separate", async ({
  page,
  request,
}) => {
  const catalog = (await (await request.get("/api/v1/sets")).json()).data;
  catalog.enabled = true;
  catalog.sets[0].enabled = true;
  catalog.sets[0].enabled_for_simulation = true;
  const saved = {
    id: "91111111-1111-4111-8111-111111111111",
    set_id: setId,
    set_name: "Lumen Grove",
    opened_at: new Date().toISOString(),
    spent_coins: 10,
    used_free_open: false,
    odds_version: "fictional-1",
    opening_status: "committed",
    cards: [
      {
        card_variant_id: moss,
        slot_index: 0,
        card_name: "Moss Courier",
        card_number: "001",
        finish: "standard",
      },
      {
        card_variant_id: lantern,
        slot_index: 1,
        card_name: "Harbor Lantern",
        card_number: "002",
        finish: "standard",
      },
    ],
  };
  let committed = false,
    charges = 0,
    realQuantity = 0;
  const calls: { key: string | undefined; body: unknown }[] = [];
  await page.route("**/api/v1/sets?*", (route) => respond(route, catalog));
  await page.route("**/api/v1/packs/open", async (route) => {
    calls.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON(),
    });
    if (!committed) {
      committed = true;
      charges++;
      await route.abort("connectionreset");
    } else await respond(route, saved);
  });
  await page.route("**/api/v1/me/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.slice("/api/v1/".length);
    if (path === "me/session") return respond(route, { id: user });
    const summary = {
      id: saved.id,
      set_name: saved.set_name,
      opened_at_label: saved.opened_at,
      odds_version: saved.odds_version,
    };
    if (path === "me/lab")
      return respond(route, {
        balance: committed ? 90 : 100,
        welcome_grant_on_first_open: 0,
        free_open_available: false,
        allowance_note: "Fictional adapter fixture; UTC reset.",
        history: committed ? [summary] : [],
        next_cursor: null,
      });
    if (path === `me/pack-openings/${saved.id}`) return respond(route, saved);
    if (path === "me/pack-openings")
      return respond(route, {
        openings: committed ? [summary] : [],
        next_cursor: null,
      });
    if (path === "me/collections/real") {
      const edit = route.request().postDataJSON();
      expect(edit).not.toHaveProperty("user_id");
      realQuantity = edit.quantity;
      return respond(route, { id: edit.card_variant_id });
    }
    if (path === "me/collections") {
      const real = url.searchParams.get("mode") === "real";
      expect(url.searchParams.get("manifest_version")).toBe("fictional-1");
      return respond(route, {
        mode: real ? "real" : "virtual",
        realNotes: realQuantity ? { [moss]: "Physical copy" } : {},
        entries: real
          ? realQuantity
            ? [{ variant_id: moss, quantity: realQuantity }]
            : []
          : [
              { variant_id: moss, quantity: 1 },
              { variant_id: lantern, quantity: 1 },
            ],
        progress: {
          set_id: setId,
          mode: real ? "real" : "virtual",
          base_collected: real ? (realQuantity ? 1 : 0) : 2,
          base_required: 3,
          master_collected: real ? (realQuantity ? 1 : 0) : 2,
          master_required: 4,
          extended_collected: real ? (realQuantity ? 1 : 0) : 2,
          extended_required: 5,
          manifest_version: "fictional-1",
        },
      });
    }
    return route.continue();
  });
  await page.goto("/lab");
  await page
    .getByRole("button", { name: "Open Lumen Grove simulation" })
    .click();
  await expect(page.getByText(/response was not acknowledged/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Pending opening request" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry pending opening" }).click();
  await page.getByRole("button", { name: "Reveal all" }).click();
  await expect(
    page.getByText("All cards shown.", { exact: false }),
  ).toBeVisible();
  expect(charges).toBe(1);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Reveal all" })).toBeVisible();
  expect(calls).toHaveLength(2);
  await page.goto("/collection");
  await expect(
    page.getByRole("region", { name: "Virtual collection" }),
  ).toBeVisible();
  await expect(
    page.locator(".pp-binder-grid").getByText("Owned: 1"),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Real collection", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Real collection" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit 001 standard" }).click();
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Private notes").fill("Physical copy");
  await page.getByRole("button", { name: "Save real quantity" }).click();
  await expect(
    page.locator(".pp-binder-grid").getByText("Owned: 2"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Real collection", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Virtual collection", exact: true })
    .click();
  await expect(
    page.locator(".pp-binder-grid").getByText("Owned: 1"),
  ).toHaveCount(2);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/b-private-binder-360.png",
    fullPage: true,
  });
});

test("adapter: watch, wizard, pause/edit/delete, inbox and privacy queue use A's contracts", async ({
  page,
}) => {
  let watches: {
    id: string;
    product_id: string;
    listing_id: null;
    created_at: string;
  }[] = [];
  let rules: ReturnType<typeof ruleInputSchema.parse>[] = [];
  let currentPreferences = preferencesSchema.parse(preferences);
  const ruleId = "92222222-2222-4222-8222-222222222222",
    watchId = "93333333-3333-4333-8333-333333333333";
  const notification = {
    id: "94444444-4444-4444-8444-444444444444",
    rule_id: null,
    event_id: null,
    channel: "in_app",
    created_at: new Date().toISOString(),
    read_at: null as string | null,
    title: "Synthetic source event",
    body: "Transport fixture for inbox rendering.",
    action_url: `/products/${setId}`,
    evidence_type: "editorial",
    observed_at: new Date().toISOString(),
  };
  await page.route("**/api/v1/me/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(
        "/api/v1/".length,
      ),
      method = route.request().method();
    if (path === "me/session") return respond(route, { id: user });
    if (path === "me/preferences") {
      if (method === "PATCH")
        currentPreferences = {
          ...currentPreferences,
          ...preferencesPatchSchema.parse(route.request().postDataJSON()),
        };
      return respond(route, currentPreferences);
    }
    if (path === "me/privacy-jobs") return respond(route, []);
    if (path === "me/export") {
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      return respond(route, { id: crypto.randomUUID(), status: "pending" });
    }
    if (path === "me/watchlist") {
      if (method === "POST") {
        expect(route.request().postDataJSON()).toEqual({
          product_id: setId,
          listing_id: null,
        });
        watches = [
          {
            id: watchId,
            product_id: setId,
            listing_id: null,
            created_at: new Date().toISOString(),
          },
        ];
        return respond(route, watches[0]);
      }
      if (method === "DELETE") {
        watches = [];
        return respond(route, { id: watchId });
      }
      return respond(route, watches);
    }
    if (path === "me/alert-rules") {
      if (method === "POST") {
        rules = [ruleInputSchema.parse(route.request().postDataJSON())];
        return respond(route, { ...rules[0], id: ruleId });
      }
      if (method === "PATCH") {
        const { id, ...input } = route.request().postDataJSON();
        expect(id).toBe(ruleId);
        rules = [ruleInputSchema.parse(input)];
        return respond(route, { ...rules[0], id: ruleId });
      }
      if (method === "DELETE") {
        rules = [];
        return respond(route, { id: ruleId });
      }
      return respond(
        route,
        rules.map((rule) => ({ ...rule, id: ruleId })),
      );
    }
    if (path === "me/notifications") {
      if (method === "PATCH") notification.read_at = new Date().toISOString();
      return respond(route, method === "PATCH" ? notification : [notification]);
    }
    return route.continue();
  });
  await page.goto(`/products/${setId}`);
  await page
    .getByRole("button", { name: "Watch product", exact: true })
    .click();
  await expect(page.getByText("Saved to your watchlist.")).toBeVisible();
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Followed products and offers" }),
  ).toBeVisible();
  await expect(page.locator(".pp-offer")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "Recent alert activity" }),
  ).toBeVisible();
  await page.goto("/watchlist");
  await page.getByRole("button", { name: "Remove watch" }).click();
  await expect(
    page.getByText("No saved watches.", { exact: false }),
  ).toBeVisible();
  await page.goto("/alerts");
  await page
    .getByLabel("Products (select multiple with Control or Command)")
    .selectOption(setId);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "restock · Active" }),
  ).toBeVisible();
  expect(rules[0].product_ids).toEqual([setId]);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "restock · Paused" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit rule", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Daily cap", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(page.getByText(/daily cap 7/)).toBeVisible();
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mark read", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Delete rule", exact: true }).click();
  await expect(page.getByText("No rules yet.")).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.goto("/settings");
  await page.getByLabel("Use account quiet hours").check();
  await page
    .getByLabel("Account quiet-hours time zone")
    .fill("America/New_York");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByLabel("Account quiet-hours time zone")).toHaveValue(
    "America/New_York",
  );
  expect(currentPreferences.quiet_hours?.time_zone).toBe("America/New_York");
  await page.getByRole("button", { name: "Request data export" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Export request queued." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue account deletion" }),
  ).toBeDisabled();
});
