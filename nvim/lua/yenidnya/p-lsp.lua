return {
	{ "neovim/nvim-lspconfig" },
	{
		"williamboman/mason.nvim",
		config = function()
			require("mason").setup()
			require("mason-install").ensure_formatters_installed()
		end,
	},
	{
		"williamboman/mason-lspconfig.nvim",
		config = function()
			require("mason-lspconfig").setup({
				ensure_installed = {
					"rust_analyzer",
					"jsonls",
					"lua_ls",
					"ts_ls",
					"typos_lsp",
					"zls",
				},
			})

			vim.lsp.config("lua_ls", {
				settings = {
					Lua = {
						diagnostics = {
							globals = { "vim" },
						},
					},
				},
			})

			local eslint_cmd = { "vscode-eslint-language-server", "--stdio" }
			local eslint_rules_dir = require("optional")("local.eslint")
			if eslint_rules_dir then
				vim.list_extend(eslint_cmd, { "--rulesdir", eslint_rules_dir })
			end

			vim.lsp.config("eslint", { cmd = eslint_cmd })

			vim.lsp.config("typos_lsp", {
				init_options = {
					-- Custom config. Used together with a config file found in the workspace or its parents,
					-- taking precedence for settings declared in both.
					-- Equivalent to the typos `--config` cli argument.
					config = "~/.config/typos.toml",
					-- How typos are rendered in the editor, can be one of an Error, Warning, Info or Hint.
					diagnosticSeverity = "Hint",
				},
			})

			vim.lsp.config("rust_analyzer", {
				settings = {
					["rust-analyzer"] = {
						checkOnSave = true,
						check = {
							workspace = true,
							allTargets = false,
						},
						cargo = {
							targetDir = true,
							buildScripts = { rebuildOnSave = false },
						},
					},
				},
			})
		end,
	},
}
