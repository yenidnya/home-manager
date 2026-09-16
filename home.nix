{
  config,
  inputs,
  pkgs,
  username,
  ...
}:
let
  configRepository = "${config.xdg.configHome}/home-manager";
  unstable = inputs.nixpkgs-unstable.legacyPackages.${pkgs.stdenv.hostPlatform.system};
  logcat-colorize = pkgs.callPackage ./packages/logcat-colorize.nix { };
in
{
  home = {
    inherit username;
    homeDirectory = "/Users/${username}";
    stateVersion = "24.11";

    packages = with pkgs; [
      age
      bat
      btop
      cargo-binstall
      cargo-nextest
      cargo-sweep
      cmake
      curl
      docker
      gnu-tar
      graphviz
      grcov
      jq
      just
      lazygit
      logcat-colorize
      luajitPackages.luacheck
      mdbook
      mitmproxy
      nerd-fonts.jetbrains-mono
      ninja
      pkg-config
      ripgrep
      rust-analyzer
      rustup
      taplo
      tree
      tree-sitter
      unison
      uv
      unstable.opencode
    ];

    sessionPath = [
      "$HOME/.nix-profile/bin"
      "$HOME/.local/bin"
      "$HOME/.cargo/bin"
      "${configRepository}/bin"
      "/opt/homebrew/bin"
      "/opt/homebrew/sbin"
    ];

    sessionVariables = {
      CARGO_HOME = "$HOME/.cargo";
      EDITOR = "nvim";
      LUA_CPATH = ";;?.dylib";
      LUA_PATH = ";;${config.xdg.configHome}/nvim/lua/yenidnya/?.lua";
      VISUAL = "nvim";
    };

  };

  xdg = {
    enable = true;

    configFile = {
      ".taplo.toml".source = ./.taplo.toml;
      "alacritty/alacritty.toml".source = ./alacritty/alacritty.toml;
      "btop/btop.conf".source =
        config.lib.file.mkOutOfStoreSymlink "${configRepository}/btop/btop.conf";
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
      globalConfig.tools.node = "20.19.2";
    };

    neovim = {
      enable = true;
      defaultEditor = true;
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
        setw -g monitor-activity on
        set -g bell-action any
        set -g visual-bell off
        set -g visual-activity off

        set-option -g status-left-length 100
        set-option -g status-right-length 500
        set-option -g status-right "#(tmux-spotify) < %H:%M #(date '+%%d/%%m/%%Y')"
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
        bind y run -b "tmux show-buffer | pbcopy"\; display-message "copied tmux buffer"
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
      historySubstringSearch.enable = true;
      syntaxHighlighting.enable = true;

      plugins = [
        {
          name = "powerlevel10k";
          src = pkgs.zsh-powerlevel10k;
          file = "share/zsh-powerlevel10k/powerlevel10k.zsh-theme";
        }
      ];

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
