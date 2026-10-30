{
  description = "yenidnya Home Manager environment for macOS and Linux";

  inputs = {
    nixpkgs-darwin.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin";
    nixpkgs-linux.url = "github:NixOS/nixpkgs/nixos-26.05";
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    home-manager = {
      url = "github:nix-community/home-manager/release-26.05";
      inputs.nixpkgs.follows = "nixpkgs-linux";
    };

    private-config = {
      url = "path:./profiles/no-private";
      flake = false;
    };
  };

  outputs =
    inputs@{
      home-manager,
      nixpkgs-darwin,
      nixpkgs-linux,
      private-config,
      ...
    }:
    let
      inherit (nixpkgs-linux) lib;
      username = "yenidnya";

      # A stable channel branch only guarantees binary-cache coverage for its own platform.
      platforms = {
        macos = {
          system = "aarch64-darwin";
          nixpkgs = nixpkgs-darwin;
        };
        linux = {
          system = "x86_64-linux";
          nixpkgs = nixpkgs-linux;
        };
      };

      pkgsFor =
        platform:
        import platform.nixpkgs {
          inherit (platform) system;
          config.allowUnfree = true;
        };

      privateDevShells =
        pkgs:
        if builtins.pathExists "${private-config}/dev-shells.nix" then
          import "${private-config}/dev-shells.nix" { inherit pkgs; }
        else
          { };
    in
    {
      devShells = lib.mapAttrs' (
        _: platform: lib.nameValuePair platform.system (privateDevShells (pkgsFor platform))
      ) platforms;

      homeConfigurations = lib.mapAttrs' (
        name: platform:
        lib.nameValuePair "${username}@${name}" (
          home-manager.lib.homeManagerConfiguration {
            pkgs = pkgsFor platform;
            extraSpecialArgs = { inherit inputs username; };
            modules = [
              ./home.nix
              (import "${private-config}/home.nix")
            ];
          }
        )
      ) platforms;
    };
}
