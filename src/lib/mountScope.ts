///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Makes one account's `mountRouter()` call removable. `@rapidrest/react`'s `mountRouter()` creates a
 * React root on the container and adds `pagehide`/`popstate`/`beforeunload` listeners to `window` and a
 * `click` listener to `document`, and hands back neither the root nor a way to remove them. `App.tsx`
 * mounts a fresh router for every account switch, so without this each switch would leave the previous
 * account's whole `apps/www` shell running in a detached root (its live connection, local-index timers,
 * outbox jobs) and its document click listener registered ahead of the new one - the first router ever
 * mounted would catch every plain-anchor click and `preventDefault()` it before the visible one saw it.
 *
 * `mountRouter()` takes the `window` and `document` it uses as arguments, so a scope gives it views of
 * both whose `addEventListener` adds the scope's `AbortSignal`, and wraps the page shell in a component
 * that renders nothing once the scope is disposed. `dispose()` therefore removes every listener the router
 * added and unmounts every page and shell component under it (running their effect cleanups); the root
 * itself is left holding an empty tree, which costs nothing. A mount still in flight when the scope is
 * disposed adds no listeners and renders nothing.
 */
import { createElement, useSyncExternalStore, type ComponentType, type ReactNode } from "react";

/** One account's mount: the `window`/`document` views and shell to hand `mountRouter()`, and `dispose()`. */
export interface MountScope {
    readonly signal: AbortSignal;
    readonly win: Window;
    readonly doc: Document;
    /** `shell` (or a pass-through, when there is none) that renders nothing once the scope is disposed. */
    wrapShell(shell: ComponentType<any> | undefined): ComponentType<any>;
    dispose(): void;
}

type ListenerOptions = boolean | AddEventListenerOptions | undefined;

/** `options` with `signal` added, keeping a caller's own signal working too. */
function withSignal(options: ListenerOptions, signal: AbortSignal): AddEventListenerOptions {
    const base: AddEventListenerOptions = typeof options === "object" ? options : { capture: options === true };
    return { ...base, signal: base.signal ? AbortSignal.any([base.signal, signal]) : signal };
}

/**
 * A view of `target` whose `addEventListener` registers with `signal`. Every other property is read from
 * and written to `target` itself (methods bound to it), since DOM getters, setters and methods refuse a
 * proxy as their receiver.
 */
export function scopeEventTarget<T extends EventTarget>(target: T, signal: AbortSignal): T {
    const addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: ListenerOptions): void => {
        // The DOM ignores a listener whose signal has already aborted, but not every implementation does (jsdom).
        if (!signal.aborted) {
            target.addEventListener(type, listener, withSignal(options, signal));
        }
    };
    return new Proxy(target, {
        get(object, property) {
            if (property === "addEventListener") {
                return addEventListener;
            }
            const value: unknown = Reflect.get(object, property);
            return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(object) : value;
        },
        set(object, property, value) {
            return Reflect.set(object, property, value);
        },
    });
}

/** Creates a mount scope over `win`/`doc` (the real ones by default). */
export function createMountScope(win: Window = window, doc: Document = document): MountScope {
    const controller = new AbortController();
    const { signal } = controller;
    const subscribe = (onChange: () => void): (() => void) => {
        signal.addEventListener("abort", onChange);
        return () => signal.removeEventListener("abort", onChange);
    };
    const isDisposed = (): boolean => signal.aborted;

    return {
        signal,
        win: scopeEventTarget(win, signal),
        doc: scopeEventTarget(doc, signal),
        wrapShell(shell) {
            function ScopedShell({ children, ...props }: { children?: ReactNode }): ReactNode {
                const disposed = useSyncExternalStore(subscribe, isDisposed);
                if (disposed) {
                    return null;
                }
                return shell ? createElement(shell, props, children) : children;
            }
            return ScopedShell;
        },
        dispose() {
            controller.abort();
        },
    };
}
