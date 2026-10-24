// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWindow } from "@/lib/landscape/explore";
import { NOW, S3, muscles, sessions } from "@/test/landscape-fixture";
import { LandscapeExplorer, type Selection } from "./landscape-explorer";

afterEach(cleanup);

const empty: Selection = { templateId: null, exerciseId: null, week: null, session: null };

function setup(overrides: Partial<React.ComponentProps<typeof LandscapeExplorer>> = {}) {
  const onRangeChange = vi.fn();
  const onSelectionChange = vi.fn();
  const utils = render(
    <LandscapeExplorer
      sessions={sessions}
      range="4w"
      window={buildWindow("4w", NOW, "UTC")}
      timeZone="UTC"
      seed="user-1"
      unit="kg"
      muscles={muscles}
      totalSessionsEver={sessions.length}
      initial={empty}
      onRangeChange={onRangeChange}
      onSelectionChange={onSelectionChange}
      {...overrides}
    />,
  );
  return { ...utils, onRangeChange, onSelectionChange, user: userEvent.setup() };
}

const map = () => screen.getByRole("group", { name: /Training landscape/ });
const markers = () => within(map()).getAllByRole("button");
const details = () => screen.getByRole("complementary", { name: "Details" });

describe("LandscapeExplorer", () => {
  it("draws one landmark per recorded session, marking records in its label", () => {
    setup();
    expect(markers()).toHaveLength(4);
    expect(markers().filter((m) => /personal record/.test(m.getAttribute("aria-label")!))).toHaveLength(1);
    // baselines and estimates are never presented as records
    expect(within(details()).getByText("Records in this period").nextElementSibling!.textContent).toContain("Bench Press");
  });

  it("selecting a session shows its recorded sets and records", async () => {
    const { user, onSelectionChange } = setup();
    await user.click(markers()[2]);
    const panel = within(details());
    expect(panel.getByRole("heading", { level: 2 }).textContent).toContain("Upper Body");
    expect(panel.getByText("65 kg × 8")).toBeTruthy();
    expect(panel.getByText("65 kg × 7")).toBeTruthy();
    expect(panel.getByText("Heaviest")).toBeTruthy();
    expect(panel.getByText("Most reps")).toBeTruthy();
    expect(panel.getByText(/est\. 1RM 82\.3/).getAttribute("title")).toMatch(/not a measured lift/);
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ session: S3, week: "2026-10-19" }));
    expect(markers()[2].getAttribute("aria-pressed")).toBe("true");
  });

  it("supports the keyboard: Enter selects a landmark, Escape clears", async () => {
    const { user } = setup();
    markers()[0].focus();
    await user.keyboard("{Enter}");
    expect(within(details()).getAllByText("60 kg × 8")).toHaveLength(2);
    await user.keyboard("{Escape}");
    expect(within(details()).getByRole("heading", { level: 2 }).textContent).toBe("Overview");
  });

  it("filters by exercise: the terrain measures that exercise and its sets are highlighted", async () => {
    const { user, onSelectionChange } = setup();
    await user.selectOptions(screen.getByLabelText("Exercise"), screen.getByRole("option", { name: "Back Squat" }));
    expect(markers()).toHaveLength(2);
    expect(within(details()).getByRole("heading", { level: 2 }).textContent).toBe("Back Squat");
    expect(within(details()).getByText("80 kg × 5")).toBeTruthy(); // heaviest set
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ exerciseId: expect.any(String) }));
  });

  it("filters by workout", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Workout"), screen.getByRole("option", { name: /Upper Body/ }));
    expect(markers()).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(markers()).toHaveLength(4);
  });

  it("navigates weeks and lists a week's sessions with a comparison to the week before", async () => {
    const { user } = setup();
    const strip = screen.getByRole("toolbar", { name: "Select a week" });
    await user.click(within(strip).getByRole("button", { name: /Week of Oct 19/ }));
    const panel = within(details());
    expect(panel.getByText(/Previous week: 1 session/)).toBeTruthy();
    expect(panel.getAllByRole("button", { name: /Body/ })).toHaveLength(2);
    // sessions outside the week are dimmed, inside stay solid
    const opacity = (el: Element) => (el.firstElementChild as SVGGElement).style.opacity;
    expect(opacity(markers()[0])).toBe("0.28");
    expect(opacity(markers()[3])).toBe("1");

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(panel.getByRole("heading", { level: 2 }).textContent).toMatch(/^Oct 12/);
    fireEvent.keyDown(within(strip).getByRole("button", { name: /Week of Oct 12/ }), { key: "ArrowLeft" });
    expect(panel.getByRole("heading", { level: 2 }).textContent).toMatch(/^Oct 5/);

    await user.click(panel.getByRole("button", { name: /Upper Body/ }));
    expect(panel.getAllByText("60 kg × 8")).toHaveLength(2);
  });

  it("changing the period asks for new data", async () => {
    const { user, onRangeChange } = setup();
    await user.selectOptions(screen.getByLabelText("Period"), "52w");
    expect(onRangeChange).toHaveBeenCalledWith("52w");
  });

  it("restores a selection from the URL", () => {
    setup({ initial: { ...empty, session: S3, week: "2026-10-19" } });
    expect(within(details()).getByText("65 kg × 7")).toBeTruthy();
  });

  it("explains an empty record and an empty period", async () => {
    setup({ sessions: [], totalSessionsEver: 0 });
    expect(screen.getByText("Your landscape begins with your first session.")).toBeTruthy();
    cleanup();

    const { user, onRangeChange } = setup({ sessions: [], totalSessionsEver: 12 });
    expect(screen.getByText("No sessions in this period.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show all time" }));
    expect(onRangeChange).toHaveBeenCalledWith("all");
  });

  it("labels sparse terrain honestly", () => {
    setup({ sessions: sessions.slice(0, 2) });
    expect(screen.getByText(/Early terrain/)).toBeTruthy();
  });
});
