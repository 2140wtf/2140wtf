import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { TestnetSurface } from "./TestnetSurface";

function LocationDisplay() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationDisplay />
      <Routes>
        <Route
          path="/testnet/bao/markets"
          element={
            <TestnetSurface>
              <div data-testid="surface">markets</div>
            </TestnetSurface>
          }
        />
        <Route
          path="/testnet/bao/fund"
          element={
            <TestnetSurface>
              <div data-testid="surface">fund</div>
            </TestnetSurface>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestnetSurface", () => {
  it("adds network=testnet so the surface never renders against demo endpoints", () => {
    renderAt("/testnet/bao/markets");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/testnet/bao/markets?network=testnet",
    );
    // The redirect replaces the entry, so the surface mounts on the parameter.
    expect(screen.getByTestId("surface")).toHaveTextContent("markets");
  });

  it("keeps the parameters the link already carried", () => {
    renderAt("/testnet/bao/fund?fundraiser=abc123");
    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain("fundraiser=abc123");
    expect(location).toContain("network=testnet");
    expect(screen.getByTestId("surface")).toHaveTextContent("fund");
  });

  it("does not re-enter the redirect when testnet is already set", () => {
    renderAt("/testnet/bao/markets?network=testnet");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/testnet/bao/markets?network=testnet",
    );
  });

  it("honours an explicit demo choice instead of trapping the reader", () => {
    renderAt("/testnet/bao/markets?network=demo");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/testnet/bao/markets?network=demo",
    );
    expect(screen.getByTestId("surface")).toHaveTextContent("markets");
  });
});
