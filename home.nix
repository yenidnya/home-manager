{
  config,
  inputs,
  lib,
  pkgs,
  username,
  ...
}:
let
  inherit (pkgs.stdenv.hostPlatform) isDarwin isLinux;
  configRepository = "${config.xdg.configHome}/home-manager";
  unstable = inputs.nixpkgs-unstable.legacyPackages.${pkgs.stdenv.hostPlatform.system};
  logcat-colorize = pkgs.callPackage ./packages/logcat-colorize.nix { };

  # Keyed by Mason package name: Neovim labels these as Nix-managed and Mason refuses to install them.
  neovimTools = {
    eslint_d = pkgs.eslint_d;
    json-lsp = pkgs.vscode-langservers-extracted;
    lua-language-server = pkgs.lua-language-server;
    mdformat = pkgs.mdformat;
    prettierd = pkgs.prettierd;
    # Unwrapped, so it reads std sources from the rustup toolchain instead of nixpkgs' Rust.
    # rustup also ships a rust-analyzer proxy, which fails without the toolchain component.
    rust-analyzer = lib.hiPrio unstable.rust-analyzer-unwrapped;
    shfmt = pkgs.shfmt;
    stylua = pkgs.stylua;
    taplo = pkgs.taplo;
    typescript-language-server = pkgs.typescript-language-server;
    typos-lsp = pkgs.typos-lsp;
    zls = pkgs.zls;
  };
in
{
  home = {
    inherit username;
    homeDirectory = if isDarwin then "/Users/${username}" else "/home/${username}";
    stateVersion = "24.11";

    packages =
      with pkgs;
      [
        age
        bat
        btop
        bun
        cargo-binstall
        cargo-nextest
        cargo-sweep
        ccache
        cmake
        ffmpeg
        gettext
        graphviz
        grcov
        gnupg
        jq
        just
        lazygit
        libjpeg
        logcat-colorize
        luajitPackages.luacheck
        mdbook
        mitmproxy
        ninja
        openssl
        pkg-config
        python3
        ripgrep
        rustup
        tree
        tree-sitter
        uv
        unstable.opencode
        zig
      ]
      ++ lib.attrValues neovimTools
      ++ lib.optionals isDarwin [
        alacritty
        docker
        nerd-fonts.jetbrains-mono
      ];

    sessionPath = [
      "$HOME/.nix-profile/bin"
      "$HOME/.local/bin"
      "$HOME/.cargo/bin"
      "${configRepository}/bin"
    ]
    ++ lib.optionals isDarwin [
      "/opt/homebrew/bin"
      "/opt/homebrew/sbin"
    ];

    sessionVariables = {
      CARGO_HOME = "$HOME/.cargo";
      EDITOR = "nvim";
      LUA_CPATH = ";;?${pkgs.stdenv.hostPlatform.extensions.sharedLibrary}";
      LUA_PATH = ";;${config.xdg.configHome}/nvim/lua/yenidnya/?.lua";
      VISUAL = "nvim";
    };

    # Spotlight refuses to index /nix, so store symlinks stay invisible to
    # Alfred. Real APFS aliases are indexable.
    activation.aliasNixApplications = lib.mkIf isDarwin (
      lib.hm.dag.entryAfter
        [
          "writeBoundary"
          "linkGeneration"
        ]
        ''
          aliasDir="$HOME/Applications/Nix Apps"
          run rm -rf "$aliasDir"
          run mkdir -p "$aliasDir"
          for app in "$HOME/Applications/Home Manager Apps"/*.app; do
            [ -e "$app" ] || continue
            run ${pkgs.mkalias}/bin/mkalias \
              "$(${pkgs.coreutils}/bin/readlink -f "$app")" \
              "$aliasDir/$(${pkgs.coreutils}/bin/basename "$app")"
          done
          run /usr/bin/mdimport "$aliasDir"
        ''
    );

  };

  targets.genericLinux = lib.mkIf isLinux {
    enable = true;
    gpu.enable = false;
  };

  xdg = {
    enable = true;

    configFile = {
      ".taplo.toml".source = ./.taplo.toml;
      "alacritty/alacritty.toml".source = ./alacritty/alacritty.toml;
      "btop/btop.conf".source = config.lib.file.mkOutOfStoreSymlink "${configRepository}/btop/btop.conf";
      "git/ignore".source = ./git/ignore;
      "nvim".source = config.lib.file.mkOutOfStoreSymlink "${configRepository}/nvim";
      "opencode".source = config.lib.file.mkOutOfStoreSymlink "${configRepository}/opencode";
      "steering".source = config.lib.file.mkOutOfStoreSymlink "${configRepository}/steering";
      "typos.toml".source = ./typos.toml;
      "zsh/.p10k.zsh".source = ./zsh/p10k.zsh;
    };
  };

  programs = {
    fzf = {
      enable = true;
      enableZshIntegration = true;
    };

    git = {
      enable = true;
      lfs.enable = true;
      settings = {
        user = {
          name = "Batuhan Yenidunya";
          email = "batuhanyndny@gmail.com";
        };
        pull.rebase = true;
        core.excludesFile = "${config.xdg.configHome}/git/ignore";
      };
    };

    home-manager.enable = true;

    mise = {
      enable = true;
      enableZshIntegration = true;
      globalConfig = lib.mkMerge [
        { tools.node = "20.19.2"; }
        # Official Linux Node builds need glibc 2.28; glibc-217 builds also run on older distributions.
        (lib.mkIf isLinux {
          settings.node = {
            mirror_url = "https://unofficial-builds.nodejs.org/download/release/";
            flavor = "glibc-217";
          };
        })
      ];
    };

    neovim = {
      enable = true;
      defaultEditor = true;
      withRuby = false;
      withPython3 = false;
      sideloadInitLua = true;
      initLua = "vim.g.nix_mason_packages = ${lib.generators.toLua { } (lib.attrNames neovimTools)}";
    };

    tmux = {
      enable = true;
      aggressiveResize = true;
      baseIndex = 1;
      clock24 = true;
      escapeTime = 0;
      focusEvents = true;
      historyLimit = 10000;
      keyMode = "vi";
      mouse = true;
      prefix = "C-a";
      # Remote sessions must survive logout; logind deletes /run/user/<uid> at the last logout.
      secureSocket = false;
      shell = "${pkgs.zsh}/bin/zsh";
      terminal = "alacritty";

      plugins = with pkgs.tmuxPlugins; [
        sensible
        vim-tmux-navigator
        {
          plugin = resurrect;
          extraConfig = ''
            set -g @resurrect-save 'S'
            set -g @resurrect-restore 'R'
          '';
        }
      ];

      extraConfig = ''
        set -g default-command "$SHELL"
        set -g allow-rename on
        set -g renumber-windows on
        set -ag terminal-overrides ",alacritty:RGB"
        set -as terminal-overrides ',*:Smulx=\E[4::%p1%dm'
        set -as terminal-overrides ',*:Setulc=\E[58::2::%p1%{65536}%/%d::%p1%{256}%/%{255}%&%d::%p1%{255}%&%d%;m'
        set -g detach-on-destroy off
        # Forward OSC 52 copies from programs in panes, such as Neovim over SSH, to the terminal.
        set -s set-clipboard on
        setw -g monitor-activity on
        set -g bell-action any
        set -g visual-bell off
        set -g visual-activity off

        set-option -g status-left-length 100
        set-option -g status-right-length 500
        set-option -g status-right "${lib.optionalString isDarwin "#(tmux-spotify) < "}%H:%M #(date '+%%d/%%m/%%Y')"
        set-option -g status-left "yenidnya > "
        set-option -g status-style "fg=#7C7D83 bg=default"
        set-option -g window-status-format "#{window_index}:#{window_name}#{window_flags} "
        set-option -g window-status-current-format "#{window_index}:#{window_name}#{window_flags} "
        set-option -g window-status-current-style "fg=#dcc7a0"
        set-option -g window-status-activity-style none
        set-option -g status-interval 5

        unbind r
        bind r source-file ~/.config/tmux/tmux.conf\; display-message 'tmux.conf reloaded'
        bind C-p previous-window
        bind C-n next-window
        bind h select-pane -L
        bind j select-pane -D
        bind k select-pane -U
        bind l select-pane -R
        bind -r C-h swap-window -d -t -1
        bind -r C-l swap-window -d -t +1
        bind -r n next-window
        bind -r p previous-window
        bind -r s command-prompt -p "swap this with" "swap-window -s '%%'"
        bind Space last-window
        bind b switch-client -l
        bind q kill-session
        bind | split-window -h -c "#{pane_current_path}"
        bind - split-window -v -c "#{pane_current_path}"
        bind c new-window -c "#{pane_current_path}"
        bind y run -b "tmux show-buffer | tmux load-buffer -w -"\; display-message "copied tmux buffer"
      '';
    };

    zoxide = {
      enable = true;
      enableZshIntegration = true;
      options = [ "--cmd cd" ];
    };

    zsh = {
      enable = true;
      defaultKeymap = "viins";
      dotDir = "${config.xdg.configHome}/zsh";
      enableCompletion = true;
      historySubstringSearch = {
        enable = true;
        searchUpKey = [
          "^[[A"
          "$terminfo[kcuu1]"
        ];
        searchDownKey = [
          "^[[B"
          "$terminfo[kcud1]"
        ];
      };
      syntaxHighlighting.enable = true;

      plugins = [
        {
          name = "powerlevel10k";
          src = pkgs.zsh-powerlevel10k;
          file = "share/zsh-powerlevel10k/powerlevel10k.zsh-theme";
        }
      ];

      oh-my-zsh = {
        enable = true;
        plugins = [ "git" ];
      };

      shellAliases = {
        lg = "lazygit";
        oldvim = "/usr/bin/vim";
        vim = "nvim";
      };

      initContent = ''
        source ${config.xdg.configHome}/zsh/.p10k.zsh
      '';
    };
  };
}
