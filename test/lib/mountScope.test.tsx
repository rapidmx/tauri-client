///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { act, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { mountRouter, type ClientRoute } from "@rapidrest/react/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMountScope, scopeEventTarget } from "../../src/lib/mountScope.js";

afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
});

describe("scopeEventTarget", () => {
    it("adds listeners that stop firing once the signal aborts, whatever options they were given", () => {
        const controller = new AbortController();
        const scoped = scopeEventTarget(document, controller.signal);
        const plain = vi.fn();
        const capture = vi.fn();
        const withOptions = vi.fn();
        scoped.addEventListener("ping", plain);
        scoped.addEventListener("ping", capture, true);
        scoped.addEventListener("ping", withOptions, { passive: true });

        document.dispatchEvent(new Event("ping"));
        expect([plain, capture, withOptions].map((listener) => listener.mock.calls.length)).toEqual([1, 1, 1]);

        controller.abort();
        document.dispatchEvent(new Event("ping"));
        expect([plain, capture, withOptions].map((listener) => listener.mock.calls.length)).toEqual([1, 1, 1]);
    });

    it("keeps a caller's own signal working alongside the scope's", () => {
        const scope = new AbortController();
        const own = new AbortController();
        const listener = vi.fn();
        scopeEventTarget(window, scope.signal).addEventListener("ping", listener, { signal: own.signal });
        own.abort();
        window.dispatchEvent(new Event("ping"));
        expect(listener).not.toHaveBeenCalled();
    });

    it("adds nothing once the signal has already aborted", () => {
        const controller = new AbortController();
        controller.abort();
        const listener = vi.fn();
        scopeEventTarget(document, controller.signal).addEventListener("ping", listener);
        document.dispatchEvent(new Event("ping"));
        expect(listener).not.toHaveBeenCalled();
    });

    it("reads, writes and calls everything else on the real target", () => {
        document.body.innerHTML = '<div id="here"></div>';
        const scoped = scopeEventTarget(document, new AbortController().signal);
        expect(scoped.getElementById("here")).toBe(document.getElementById("here"));
        expect(scoped.body).toBe(document.body);
        scoped.title = "Scoped title";
        expect(document.title).toBe("Scoped title");
        expect(scopeEventTarget(window, new AbortController().signal).location.href).toBe(window.location.href);
    });
});

describe("createMountScope", () => {
    function Shell({ label, children }: { label?: string; children?: ReactNode }): ReactNode {
        return (
            <section data-testid="shell" data-label={label}>
                {children}
            </section>
        );
    }

    it("wraps a shell so it renders with its props and children until the scope is disposed", () => {
        const scope = createMountScope();
        const Wrapped = scope.wrapShell(Shell);
        render(
            <Wrapped label="a">
                <p>page</p>
            </Wrapped>
        );
        expect(screen.getByTestId("shell")).toHaveAttribute("data-label", "a");
        expect(screen.getByText("page")).toBeInTheDocument();

        act(() => scope.dispose());
        expect(scope.signal.aborted).toBe(true);
        expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
        expect(screen.queryByText("page")).not.toBeInTheDocument();
    });

    it("passes the page straight through when there is no shell, and drops it on dispose", () => {
        const scope = createMountScope();
        const Wrapped = scope.wrapShell(undefined);
        render(
            <Wrapped>
                <p>page</p>
            </Wrapped>
        );
        expect(screen.getByText("page")).toBeInTheDocument();
        act(() => scope.dispose());
        expect(screen.queryByText("page")).not.toBeInTheDocument();
    });

    it("removes the real mountRouter()'s click listener and unmounts its pages on dispose", async () => {
        document.body.innerHTML = '<div id="mount-a"></div><a id="link" href="/other" data-router-shallow>other</a>';
        const pageCleanup = vi.fn();
        function Home(): ReactNode {
            useEffect(() => pageCleanup, []);
            return <p>home</p>;
        }
        const routes: ClientRoute[] = [
            { template: "/", load: () => Promise.resolve({ default: Home }) },
            { template: "/other", load: () => Promise.resolve({ default: () => <p>other page</p> }) },
        ];
        const scope = createMountScope();
        await act(async () => {
            await mountRouter(routes, { rootId: "mount-a", shell: scope.wrapShell(Shell) }, scope.win, scope.doc);
        });
        expect(screen.getByText("home")).toBeInTheDocument();
        expect(screen.getByTestId("shell")).toBeInTheDocument();

        // Runs after the router's document listener (window is the last stop of a bubbling click):
        // records whether the router took the click, then stops jsdom from following the link.
        const routerTook: boolean[] = [];
        const record = (event: Event): void => {
            routerTook.push(event.defaultPrevented);
            event.preventDefault();
        };
        window.addEventListener("click", record);
        const link = document.getElementById("link")!;
        const click = (): MouseEvent => new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
        await act(async () => {
            link.dispatchEvent(click());
        });

        act(() => scope.dispose());
        expect(pageCleanup).toHaveBeenCalled();
        expect(screen.queryByTestId("shell")).not.toBeInTheDocument();

        link.dispatchEvent(click());
        window.removeEventListener("click", record);
        expect(routerTook).toEqual([true, false]);
    });
});
