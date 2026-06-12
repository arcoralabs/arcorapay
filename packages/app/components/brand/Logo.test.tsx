import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ArcoraLogo, ArcoraSymbol } from "./Logo";

afterEach(() => cleanup());

describe("ArcoraLogo", () => {
  it("renders the two-tone Arcorapay wordmark", () => {
    const { container } = render(<ArcoraLogo />);
    expect(container.textContent).toContain("Arcorapay");
  });

  it("symbol matches canonical mark (4 paths, no settlement dot)", () => {
    const { container } = render(<ArcoraSymbol />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(4);
    // Exactly one path is the white "smile arc" stroke.
    expect(
      Array.from(paths).filter((p) => p.getAttribute("stroke") === "#ffffff").length,
    ).toBe(1);
    // No path is the old settlement-dot circle (d started with "M270").
    expect(
      Array.from(paths).some((p) => p.getAttribute("d")?.startsWith("M270")),
    ).toBe(false);
  });
});
