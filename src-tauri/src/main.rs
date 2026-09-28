///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Prevents an extra console window from opening on Windows release builds - standard Tauri v2
// project-template boilerplate, harmless on every other platform.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri_client_lib::run();
}
