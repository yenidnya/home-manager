# Personal Home Environment

This public repository manages a user environment with standalone Home Manager on
Apple Silicon macOS (`yenidnya@macos`) and x86_64 Linux (`yenidnya@linux`).
It contains no private or work-specific configuration.
It does not manage the operating system, Homebrew, applications, services, or login items.

## Requirements

Install upstream Nix, then clone this repository to the required path:

```sh
sh <(curl -L https://nixos.org/nix/install)
git clone PUBLIC_REMOTE ~/.config/home-manager
```

## Install

Clone the optional private overlay once, then apply:

```sh
~/.config/home-manager/bootstrap --private PRIVATE_REMOTE
```

Bootstrap selects the configuration for the current platform. Every later run detects
the overlay at `~/.config/home-manager-yenidnya` and applies it:

```sh
~/.config/home-manager/bootstrap
```

Bootstrap prints the layer it resolved. Pass `--no-private` to apply the personal
environment alone; omitting the overlay removes every file and package it owns.

Install the tools Nix does not package:

```sh
restore-runtimes
```

## Update

```sh
nix flake update
~/.config/home-manager/bootstrap
```

The overlay is never written to `flake.lock`, so the private path stays out of this
repository.

## Private Backup

Create and restore an encrypted archive when private files must move between machines:

```sh
backup-private /secure/path/home-private.tar.gz.age
restore-private /secure/path/home-private.tar.gz.age
```

Credentials and generated authentication state do not belong in either repository.

## Managed Configuration

`home.nix` manages packages, Git, Zsh, Powerlevel10k, mise, Neovim, tmux, fzf, and zoxide.
It links Neovim, btop, OpenCode, Alacritty, and steering files from this repository.

Configuration sources remain writable inside this repository.
Private modules can add packages, settings, and files without changing the public repository.

`neovimTools` in `home.nix` installs Neovim's language servers, formatters, and linters.
Mason stays available as a catalogue: its window lists these packages as managed by Nix,
and it refuses to install them. Add a tool to `neovimTools` under its Mason package name;
a language server also needs its name in the `vim.lsp.enable` list in `p-lsp.lua`.

GUI packages, Homebrew paths, and the Spotlight alias step apply only on macOS. Linux
enables Home Manager's non-NixOS integration and keeps tmux sockets in `/tmp`, so
sessions survive logout. mise installs Node from the `glibc-217` unofficial builds on
Linux, because the official builds need glibc 2.28.

Work-specific values belong in the overlay. Neovim reaches them through
`require("optional")("local.NAME")`, which returns `nil` when the overlay is absent.
