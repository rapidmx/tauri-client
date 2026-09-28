///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
//! Desktop application menu - a port of `electron-client`'s `src/main/menu.ts` to Tauri v2's
//! `tauri::menu` API, for the same reason that file documents: the OS/webview shell can claim a
//! keyboard accelerator before `@rapidmx/web-client`'s own keyboard layer (`apps/shared/keyboard`)
//! ever sees the key, so the menu this module builds is deliberately shaped to avoid every
//! accelerator that layer owns (`RENDERER_SHORTCUTS` below, copied 1:1 from the Electron source of
//! truth - keep the two lists in sync by hand, nothing links them mechanically, exactly as that
//! file's own comment warns).
//!
//! **Desktop only** - never called on `mobile` (see `lib.rs`'s `#[cfg(desktop)]` guard around this
//! module and its call site). Mobile platforms have no application menu bar concept; Tauri's own
//! `tauri::menu` types simply aren't meaningful there.
//!
//! **Not verified against a real build** (see `.claude/NOTES.md`) - Tauri v2's menu API has a
//! smaller predefined-role surface than Electron's (`tauri::menu::SubmenuBuilder`'s fluent
//! `.undo()`/`.redo()`/`.cut()`/`.copy()`/`.paste()`/`.select_all()`/`.close_window()`/`.quit()`/
//! `.minimize()`/`.fullscreen()`/`.hide()`/`.hide_others()`/`.show_all()`/`.about()`/`.services()`
//! methods are used here on the strength of general Tauri v2 API familiarity, not confirmed
//! against this exact crate version's docs). Reload/Force Reload/Toggle DevTools have no
//! predefined-role equivalent at all in Tauri (Electron has `role: "reload"` etc., Tauri does not),
//! so they're implemented here as plain `MenuItemBuilder` items with explicit ids, handled
//! centrally by `handle_menu_event` (wired via `Builder::on_menu_event` in `lib.rs`) rather than a
//! per-item closure, matching how Tauri v2 menu event handling is documented to work.

use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};

/// Every accelerator `@rapidmx/web-client`'s own keyboard layer binds itself - copied verbatim
/// from `electron-client`'s `src/main/menu.ts`'s own `RENDERER_SHORTCUTS` (see that file for the
/// full per-key rationale: which are Windows/Linux vs. macOS spellings, which are literal on every
/// platform). **When `@rapidmx/web-client` changes its bindings, update this list too** - nothing
/// links the two mechanically, on either side of the Electron/Tauri split.
pub const RENDERER_SHORTCUTS: &[&str] = &[
    "Ctrl+R",
    "Ctrl+Shift+R",
    "Ctrl+D",
    "Ctrl+E",
    "Ctrl+U",
    "Ctrl+Shift+F",
    "Ctrl+Shift+V",
    "Ctrl+Enter",
    "Ctrl+S",
    "Ctrl+.",
    "Ctrl+,",
    "Ctrl+/",
    "Cmd+R",
    "Cmd+Shift+R",
    "Cmd+D",
    "Cmd+E",
    "Cmd+U",
    "Cmd+Shift+F",
    "Cmd+Shift+V",
    "Cmd+Enter",
    "Cmd+S",
    "Cmd+.",
    "Cmd+,",
    "Cmd+/",
    "Cmd+N",
    "Cmd+Left",
    "Cmd+Right",
    "Ctrl+N",
    "Ctrl+Q",
    "Ctrl+Shift+A",
    "Ctrl+Shift+B",
    "Ctrl+Shift+C",
    "Ctrl+Shift+L",
    "Ctrl+Shift+M",
    "Ctrl+Shift+S",
    "Ctrl+Shift+T",
    "Ctrl+Alt+1",
    "Ctrl+Alt+2",
    "Ctrl+Alt+3",
    "Ctrl+Alt+4",
    "Alt+N",
    "Delete",
    "Shift+Delete",
    "Insert",
    "Ctrl+Left",
    "Ctrl+Right",
];

pub const MENU_ID_RELOAD: &str = "rapidmx-view-reload";
pub const MENU_ID_FORCE_RELOAD: &str = "rapidmx-view-force-reload";
pub const MENU_ID_TOGGLE_DEVTOOLS: &str = "rapidmx-view-toggle-devtools";

/// Builds the application menu for `platform` (`std::env::consts::OS` - `"macos"`/`"windows"`/
/// `"linux"`), shaped like Electron's own default menu minus the same three collisions
/// `electron-client`'s `buildMenuTemplate()` documents:
///
/// - Reload/Force Reload are plain `F5`/`Shift+F5` items instead of Ctrl/Cmd+R and
///   Ctrl/Cmd+Shift+R (the renderer's Reply/Reply all).
/// - Quit on Linux gets an explicit `Ctrl+Shift+Q` instead of the predefined role's usual
///   `Ctrl+Q` (the renderer's mark-read). Windows' Exit has no default accelerator to collide with;
///   macOS' `Cmd+Q` is the OS's own Quit, not one of `RENDERER_SHORTCUTS` (mark read there is a
///   literal `Ctrl+Q`).
/// - There is no "Paste and Match Style" item at all - Tauri's predefined Edit role set doesn't
///   include one in the first place, so nothing needed removing.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>, platform: &str) -> tauri::Result<Menu<R>> {
    let is_mac = platform == "macos";
    let is_linux = platform == "linux";

    let reload = MenuItemBuilder::with_id(MENU_ID_RELOAD, "Reload").accelerator("F5").build(app)?;
    let force_reload = MenuItemBuilder::with_id(MENU_ID_FORCE_RELOAD, "Force Reload")
        .accelerator("Shift+F5")
        .build(app)?;

    // Only reassigned under `#[cfg(debug_assertions)]` below (adding the DevTools toggle) - a
    // release build never mutates it, so `cargo build --release` alone would warn `unused_mut`
    // without this - both configurations are intentional, not a bug either way.
    #[allow(unused_mut)]
    let mut view_builder = SubmenuBuilder::new(app, "View").item(&reload).item(&force_reload).separator();
    // DevTools toggle is only wired in debug builds - matches Tauri's own default posture (the
    // `WebviewWindow::open_devtools()`/`close_devtools()` pair this item's handler needs is only
    // unconditionally available under `debug_assertions`; a release build would need the `devtools`
    // Cargo feature explicitly opted into, which this app does not do - see this module's own doc
    // comment on scope).
    #[cfg(debug_assertions)]
    {
        let toggle_devtools = MenuItemBuilder::with_id(MENU_ID_TOGGLE_DEVTOOLS, "Toggle Developer Tools")
            .accelerator("Ctrl+Shift+I")
            .build(app)?;
        view_builder = view_builder.item(&toggle_devtools).separator();
    }
    let view_menu = view_builder.fullscreen().build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let file_menu = if is_mac {
        SubmenuBuilder::new(app, "File").close_window().build()?
    } else if is_linux {
        // Ctrl+Q is `RENDERER_SHORTCUTS`' mark-read - override the predefined Quit role's default
        // accelerator, mirroring `electron-client`'s own Linux-specific override.
        let quit = MenuItemBuilder::with_id("rapidmx-file-quit", "Quit").accelerator("Ctrl+Shift+Q").build(app)?;
        SubmenuBuilder::new(app, "File").item(&quit).build()?
    } else {
        SubmenuBuilder::new(app, "File").quit().build()?
    };

    let window_menu = if is_mac {
        SubmenuBuilder::new(app, "Window").minimize().separator().build()?
    } else {
        SubmenuBuilder::new(app, "Window").minimize().close_window().build()?
    };

    let mut menu_builder = MenuBuilder::new(app);
    if is_mac {
        let app_menu = SubmenuBuilder::new(app, "RapidMX")
            .about(None)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu_builder = menu_builder.item(&app_menu);
    }
    menu_builder = menu_builder.item(&file_menu).item(&edit_menu).item(&view_menu).item(&window_menu);
    menu_builder.build()
}

/// Installs this platform's application menu. Called once from `lib.rs`'s `setup()`, before the
/// main window is shown, so the window never briefly carries a default/empty menu.
pub fn apply_application_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_menu(app, std::env::consts::OS)?;
    app.set_menu(menu)?;
    Ok(())
}

/// Central menu-event handler, wired via `Builder::on_menu_event` in `lib.rs` - Tauri v2 dispatches
/// every menu item click through one app-level callback identified by the id the item was built
/// with (`MenuItemBuilder::with_id`), rather than a per-item closure.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match event.id().0.as_str() {
        MENU_ID_RELOAD | MENU_ID_FORCE_RELOAD => {
            // Tauri's WebviewWindow has no first-class `reload()` (unlike Electron's
            // `webContents.reload()`/`reloadIgnoringCache()`) - `eval`-ing a plain
            // `location.reload()` is the standard workaround. There is no separate
            // "ignore cache" primitive to give Force Reload a distinct effect from Reload here;
            // both items are kept distinct in the menu (matching Electron's own two entries and
            // this app's own accelerator layout) even though they currently behave identically.
            let _ = window.eval("window.location.reload();");
        }
        #[cfg(debug_assertions)]
        MENU_ID_TOGGLE_DEVTOOLS => {
            if window.is_devtools_open() {
                window.close_devtools();
            } else {
                window.open_devtools();
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_shortcuts_has_no_duplicate_entries() {
        let mut sorted = RENDERER_SHORTCUTS.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), RENDERER_SHORTCUTS.len(), "RENDERER_SHORTCUTS should not list the same accelerator twice");
    }

    #[test]
    fn none_of_this_menus_own_fixed_accelerators_collide_with_the_renderer() {
        // This module's own custom-item accelerators (not the predefined roles, which Tauri
        // controls and which electron-client's own reasoning already established don't collide -
        // see this module's doc comment) - a lightweight guard against a future edit accidentally
        // reintroducing Ctrl/Cmd+R for Reload.
        let fixed = ["F5", "Shift+F5", "Ctrl+Shift+I", "Ctrl+Shift+Q"];
        for accelerator in fixed {
            assert!(
                !RENDERER_SHORTCUTS.contains(&accelerator),
                "{accelerator} is used by this menu but is also claimed by RENDERER_SHORTCUTS"
            );
        }
    }
}
