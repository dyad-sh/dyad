import { test, expect } from "@playwright/test";
import { clickMenuItem, openOptions, deleteThroughUI } from "../interactions";
import { settleAfterSubmit } from "../relay-crm/fixtures";

test("an optimistic UI change is settled before checking persistence", async ({
  page,
}) => {
  let saved = "lead";
  await page.route("http://harness.test/**", async (route) => {
    if (route.request().method() === "PATCH") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      saved = "qualified";
      await route.fulfill({ json: { stage: saved } });
      return;
    }
    await route.fulfill({
      contentType: "text/html",
      body: `<div id="stage">${saved}</div><button onclick="document.querySelector('#stage').textContent='qualified';fetch('/api/deals/one',{method:'PATCH'})">Move</button>`,
    });
  });
  await page.goto("http://harness.test/deals");
  await page.getByRole("button", { name: "Move" }).click();
  await expect(page.locator("#stage")).toHaveText("qualified");
  await settleAfterSubmit(page);
  await page.reload();
  await expect(page.locator("#stage")).toHaveText("qualified");
});

test("opens lazy menus, leaves already-open dropdowns open, supports native selects", async ({
  page,
}) => {
  await page.setContent(
    '<button data-testid="user-menu">Account</button><button data-testid="switcher" aria-expanded="false">Org</button><select data-testid="native"><option>a</option></select>',
  );
  await page.evaluate(() => {
    document
      .querySelector('[data-testid="user-menu"]')!
      .addEventListener("click", () => {
        const b = document.createElement("button");
        b.dataset.testid = "sign-out-button";
        b.textContent = "Sign out";
        b.onclick = () => {
          b.textContent = "done";
        };
        document.body.append(b);
      });
    const switcher = document.querySelector('[data-testid="switcher"]')!;
    switcher.addEventListener("click", () =>
      switcher.setAttribute(
        "aria-expanded",
        switcher.getAttribute("aria-expanded") === "true" ? "false" : "true",
      ),
    );
  });
  await clickMenuItem(page, "user-menu", "sign-out-button");
  await expect(page.getByTestId("sign-out-button")).toHaveText("done");
  await openOptions(page, "switcher");
  await openOptions(page, "switcher");
  await expect(page.getByTestId("switcher")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await openOptions(page, "native");
});

for (const mode of ["immediate", "native", "inline", "modal"])
  test(`deletion waits for persisted mutation: ${mode}`, async ({ page }) => {
    let committed = false;
    await page.route("http://harness.test/**", async (route) => {
      if (route.request().method() === "DELETE") {
        await new Promise((r) => setTimeout(r, 150));
        committed = true;
        await route.fulfill({
          status: 204,
        });
        return;
      }
      await route.fulfill({
        contentType: "text/html",
        body: `<script>function remove(){fetch('/api/tickets/one',{method:'DELETE'})}function start(){${mode === "immediate" ? `remove()` : mode === "native" ? `if(confirm('Delete?'))remove()` : `document.querySelector('#confirm').hidden=false`}}</script><button data-testid="ticket-delete" onclick="start()">Delete</button>${mode === "inline" ? `<button id="confirm" hidden data-testid="ticket-delete-confirm" onclick="remove()">Confirm</button>` : mode === "modal" ? `<div role="alertdialog" id="confirm" hidden><button onclick="remove()">Delete ticket</button><button>Cancel</button></div>` : ""}`,
      });
    });
    page.on("dialog", (d) => d.accept());
    await page.goto("http://harness.test/");
    await deleteThroughUI(
      page,
      "ticket-delete",
      "ticket-delete-confirm",
      "/api/tickets/one",
    );
    expect(committed).toBe(true);
  });

test("failed delete cannot pass merely because rows have not hydrated", async ({
  page,
}) => {
  await page.route("http://harness.test/**", (r) =>
    r.request().method() === "DELETE"
      ? r.fulfill({ status: 403 })
      : r.fulfill({
          contentType: "text/html",
          body: `<button data-testid="delete" onclick="fetch('/api/tickets/one',{method:'DELETE'})">Delete</button>`,
        }),
  );
  await page.goto("http://harness.test/");
  await expect(
    deleteThroughUI(page, "delete", "confirm", "/api/tickets/one"),
  ).rejects.toThrow();
});

test("empty-state union accepts both containers but still rejects leaked rows", async ({
  page,
}) => {
  await page.setContent(
    '<table data-testid="contacts-list"></table><div data-testid="contacts-empty">Empty</div>',
  );
  const visible = page
    .getByTestId("contacts-empty")
    .or(page.getByTestId("contacts-list"))
    .filter({ visible: true })
    .first();
  await expect(visible).toBeVisible();
  await expect(page.getByTestId("contact-row")).toHaveCount(0);
  await page.evaluate(
    () =>
      (document.querySelector("table")!.innerHTML =
        '<tr data-testid="contact-row"><td>Leaked</td></tr>'),
  );
  await expect(page.getByTestId("contact-row")).toHaveCount(1);
});

test("missing delete control fails only its own check", async ({ page }) => {
  page.setDefaultTimeout(100);
  await page.setContent("<p>No delete feature</p>");
  await expect(
    deleteThroughUI(page, "missing", "confirm", "/api/tickets/one"),
  ).rejects.toThrow();
  await page.close();
});
